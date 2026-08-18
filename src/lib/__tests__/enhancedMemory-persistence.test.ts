// enhancedMemory 测试（拆分自 enhancedMemory.test.ts，审计 P1-6 God Test 拆分）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === 'decrypt_data') return Promise.resolve('{}')
    if (cmd === 'encrypt_data') return Promise.resolve(JSON.stringify({}))
    return Promise.resolve('')
  }),
}))

vi.mock('../db', () => ({
  getSetting: vi.fn(() => Promise.resolve(null)),
  setSetting: vi.fn(() => Promise.resolve()),
  addMemory: vi.fn(() => Promise.resolve(1)),
  saveEmbedding: vi.fn(() => Promise.resolve()),
  getAllEmbeddings: vi.fn(() => Promise.resolve([])),
  updateMemoryLastAccessed: vi.fn(() => Promise.resolve()),
  clearMemories: vi.fn(() => Promise.resolve()),
}))

vi.mock('../vectorSearch', () => ({
  embed: vi.fn(() => Promise.resolve(new Float32Array([0.1, 0.2, 0.3]))),
  cosineSimilarity: vi.fn(() => 0.8),
  isVectorSearchAvailable: vi.fn(() => Promise.resolve(false)),
  searchSimilar: vi.fn(() => [{ id: 1, score: 0.8 }]),
}))

import { EnhancedMemoryManager, getEnhancedMemoryManager } from '../enhancedMemory'
import { getSetting, setSetting, getAllEmbeddings } from '../db'
import { invoke } from '@tauri-apps/api/core'
import { isVectorSearchAvailable, embed, searchSimilar } from '../vectorSearch'

describe('EnhancedMemoryManager', () => {
  let mgr: EnhancedMemoryManager

  beforeEach(async () => {
    vi.clearAllMocks()
    localStorage.clear()
    ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    mgr = new EnhancedMemoryManager('test-char')
    await mgr.ensureLoaded()
  })

  describe('加密数据加载', () => {
    it('加载 ENC1: 前缀数据时调用 decrypt', async () => {
      const encData = 'ENC1:someencrypteddata'
      ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(encData)
      ;(invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
        if (cmd === 'decrypt_data') {
          return Promise.resolve(JSON.stringify({
            workingMemory: [],
            episodicMemory: [],
            semanticMemory: '',
            autobiographicalMemory: [],
          }))
        }
        return Promise.resolve('')
      })
      const m = new EnhancedMemoryManager('enc-char')
      await m.ensureLoaded()
      expect(invoke).toHaveBeenCalledWith('decrypt_data', expect.any(Object))
    })

    it('D1：加载 ENC2: 前缀数据时调用 decrypt 并恢复记忆（新版 Rust 加密格式）', async () => {
      const encData = 'ENC2:someencrypteddata'
      const restored = [{
        id: 'mem-enc2',
        user: '上次说的话',
        assistant: '回复',
        created_at: new Date().toISOString(),
        importance: 60,
        emotionalIntensity: 0.2,
        category: '日常',
        tags: ['上次'],
        accessCount: 0,
        lastAccessed: Date.now(),
        decayFactor: 1,
        isAutobiographical: false,
      }]
      ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(encData)
      ;(invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
        if (cmd === 'decrypt_data') {
          return Promise.resolve(JSON.stringify({
            workingMemory: restored,
            episodicMemory: [],
            semanticMemory: '',
            autobiographicalMemory: [],
          }))
        }
        return Promise.resolve('')
      })
      const m = new EnhancedMemoryManager('enc2-char')
      await m.ensureLoaded()
      expect(invoke).toHaveBeenCalledWith('decrypt_data', expect.any(Object))
      const all = m.getAllMemories()
      expect(all.length).toBe(1)
      expect(all[0].user).toBe('上次说的话')
    })

    it('解密失败时使用默认空数据', async () => {
      ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue('ENC1:baddata')
      ;(invoke as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('decrypt failed'))
      const m = new EnhancedMemoryManager('fail-char')
      await m.ensureLoaded()
      expect(m.getAllMemories().length).toBe(0)
    })
  })

describe('持久化 load/save', () => {
    it('加载明文数据（非 ENC1: 前缀）', async () => {
      const plainData = JSON.stringify({
        workingMemory: [
          {
            id: 'plain-1',
            user: 'plaintext memory',
            assistant: 'reply',
            created_at: new Date().toISOString(),
            importance: 50,
            emotionalIntensity: 0,
            category: '日常',
            tags: [],
            accessCount: 0,
            lastAccessed: 0,
            decayFactor: 1,
            isAutobiographical: false,
          },
        ],
        episodicMemory: [],
        semanticMemory: 'test summary',
        autobiographicalMemory: [],
      })
      ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue(plainData)
      const m = new EnhancedMemoryManager('plain-char')
      await m.ensureLoaded()
      expect(m.getAllMemories().length).toBe(1)
      expect(m.getAllMemories()[0].user).toBe('plaintext memory')
      expect(m.getSemanticSummary()).toBe('test summary')
    })

    it('加载无效 JSON 数据时使用默认空数据', async () => {
      ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValue('not valid json')
      const m = new EnhancedMemoryManager('bad-json-char')
      await m.ensureLoaded()
      expect(m.getAllMemories().length).toBe(0)
    })

    it('加密失败时拒绝写入明文数据', async () => {
      ;(invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
        if (cmd === 'encrypt_data') return Promise.reject(new Error('encrypt failed'))
        if (cmd === 'decrypt_data') return Promise.resolve('{}')
        return Promise.resolve('')
      })
      ;(setSetting as ReturnType<typeof vi.fn>).mockClear()
      mgr.addExchange('test encrypt fail', 'reply')
      // 等待防抖触发 encrypt_data 调用（证明 save 流程已执行），再验证 setSetting 未被调用
      await vi.waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('encrypt_data', expect.any(Object))
      }, { timeout: 2000, interval: 50 })
      expect(setSetting).not.toHaveBeenCalled()
      ;(invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) => {
        if (cmd === 'decrypt_data') return Promise.resolve('{}')
        if (cmd === 'encrypt_data') return Promise.resolve(JSON.stringify({}))
        return Promise.resolve('')
      })
    })
  })

describe('searchEpisodic 检索', () => {
    it('查询无 token 时返回最近记忆', async () => {
      for (let i = 0; i < 7; i++) {
        mgr.addExchange(`test${i}`, `reply${i}`)
      }
      const ctx = await mgr.buildContext('...')
      expect(ctx).toContain('相关历史回忆')
    })

    it('空查询返回空', async () => {
      for (let i = 0; i < 7; i++) {
        mgr.addExchange(`test${i}`, `reply${i}`)
      }
      const ctx = await mgr.buildContext('')
      // buildContext with empty query: searchEpisodic returns []
      // But working memory still appears
      expect(ctx).toContain('最近对话')
    })
  })

describe('向量检索', () => {
    afterEach(() => {
      vi.mocked(isVectorSearchAvailable).mockResolvedValue(false)
      vi.mocked(getAllEmbeddings).mockResolvedValue([])
    })

    it('vectorAvailable 为 true 时走向量检索路径', async () => {
      vi.mocked(isVectorSearchAvailable).mockResolvedValue(true)
      mgr.addExchange('apple pie recipe', 'here is how')
      for (let i = 0; i < 5; i++) {
        mgr.addExchange(`filler${i}`, `reply${i}`)
      }
      // vectorSearchInMemories: vectorAvailable=true, but embeddings empty → candidates empty → []
      // Falls back to LCS
      const result = await mgr.checkTriggers('apple')
      // 向量检索路径不应抛出异常；返回值为 null 或包含 type 属性的 TriggerResult
      expect(result === null || (result !== null && typeof result.type === 'string')).toBe(true)
    })

    it('向量检索成功返回结果', async () => {
      vi.mocked(isVectorSearchAvailable).mockResolvedValue(true)
      vi.mocked(getAllEmbeddings).mockResolvedValue([
        { id: 1, embedding: new Float32Array([0.1, 0.2, 0.3]) },
      ])
      mgr.addExchange('apple pie recipe', 'here is how')
      for (let i = 0; i < 5; i++) {
        mgr.addExchange(`filler${i}`, `reply${i}`)
      }
      const result = await mgr.checkTriggers('apple')
      expect(result).not.toBeNull()
      expect(result!.type).toBe('relevance')
    })

    it('向量检索异常时返回空数组', async () => {
      vi.mocked(isVectorSearchAvailable).mockRejectedValue(new Error('check failed'))
      mgr.addExchange('apple', 'reply')
      for (let i = 0; i < 5; i++) {
        mgr.addExchange(`filler${i}`, `reply${i}`)
      }
      const result = await mgr.checkTriggers('apple')
      // 向量检索异常时应优雅降级，返回值为 null 或 TriggerResult
      expect(result === null || (result !== null && typeof result.type === 'string')).toBe(true)
    })

    it('saveToVectorStore 嵌入生成失败不影响记忆存储', async () => {
      vi.mocked(embed).mockRejectedValueOnce(new Error('embed failed'))
      mgr.addExchange('test embed fail', 'reply')
      expect(mgr.getWorkingMemories().length).toBe(1)
      // 等待 embed 异步调用完成（即使失败），证明异步流程已执行且未影响记忆存储
      await vi.waitFor(() => {
        expect(embed).toHaveBeenCalled()
      }, { timeout: 2000, interval: 50 })
    })

    it('ensureEmbeddingsLoaded 加载失败时不抛出', async () => {
      vi.mocked(isVectorSearchAvailable).mockResolvedValue(true)
      vi.mocked(getAllEmbeddings).mockRejectedValueOnce(new Error('load failed'))
      mgr.addExchange('test load fail', 'reply')
      for (let i = 0; i < 5; i++) {
        mgr.addExchange(`f${i}`, `r${i}`)
      }
      const result = await mgr.checkTriggers('test')
      // 加载失败时应优雅降级，返回值为 null 或 TriggerResult
      expect(result === null || (result !== null && typeof result.type === 'string')).toBe(true)
    })
  })
})
