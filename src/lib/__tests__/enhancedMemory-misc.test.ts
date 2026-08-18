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

  describe('recordTrigger 日志管理', () => {
    it('日志超过100条时截断为50条', () => {
      for (let i = 0; i < 101; i++) {
        mgr.recordTrigger('frequency')
      }
      expect(mgr.canTrigger('frequency')).toBe(false)
    })
  })

describe('getPetBirthday 异常处理', () => {
    it('localStorage 异常时返回 null', async () => {
      const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('localStorage error')
      })
      expect(await mgr.checkTriggers()).toBeNull()
      spy.mockRestore()
    })
  })
})

describe('第五轮修复验证', () => {
  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

  describe('F2：情绪一致性 moodFit', () => {
    it('当前情绪积极时，valence 相近的积极记忆在 RAG 路径排前', async () => {
      const m = new EnhancedMemoryManager('test-char')
      await m.ensureLoaded()

      // A/B：内容相同、仅 valence 不同（正/负），最终溢出到情景记忆
      const a = m.addExchange('我今天升职了特别开心', '恭喜呀！')
      const b = m.addExchange('我今天升职了特别开心', '恭喜呀！')
      a.emotionalValence = 1
      a.emotionalArousal = 0.4
      b.emotionalValence = -1
      b.emotionalArousal = 0.4

      // C/D/E：工作记忆中的积极情绪来源（valence=1），使 getCurrentMood 偏正
      const c = m.addExchange('今天心情特别好', '太好啦')
      const d = m.addExchange('今天心情特别好', '太好啦')
      const e = m.addExchange('今天心情特别好', '太好啦')
      c.emotionalValence = 1
      d.emotionalValence = 1
      e.emotionalValence = 1

      // F/G：填充工作记忆使 A/B 溢出到情景记忆（第 7 条后 working=[C,D,E,F,G]）
      m.addExchange('今天天气不错', '嗯嗯')
      m.addExchange('今天天气不错', '嗯嗯')

      // 构建 RAG 索引（BM25 可用，向量不可用）
      m.buildRAGIndex()
      await tick()

      // 测试隔离：向量通道置空，避免共享 RAG 检索器单例的 vectorAvailable 状态污染排序
      ;(isVectorSearchAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(false)
      ;(searchSimilar as ReturnType<typeof vi.fn>).mockReturnValue([])

      const results = await m.retrieve('我今天升职了特别开心', 2)
      expect(results.length).toBeGreaterThanOrEqual(2)
      // P0-1: retrieve() 现在返回 RetrievalResult[]，需访问 .memory 字段
      expect(results[0].memory.id).toBe(a.id)
    })
  })

  describe('F7：实体关联记忆并入检索', () => {
    it('RAG 路径下，仅靠实体链接关联的记忆即使 BM25 未命中也会并入结果', async () => {
      ;(getSetting as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
        if (key === 'spiritpal-entities-f7-char') {
          return Promise.resolve(JSON.stringify({
            entities: [{
              id: 'e1',
              name: '咪',
              type: 'thing',
              linkedMemoryIds: ['mem-x'],
              mentionCount: 1,
              firstSeen: 0,
              lastSeen: 0,
            }],
          }))
        }
        return Promise.resolve(null)
      })

      const m = new EnhancedMemoryManager('f7-char')
      await m.ensureLoaded()

      // X：仅通过实体链接关联（内容不含"咪"）；Y：BM25 命中"咪"（保证 RAG 分支进入）
      const x = m.addExchange('今天天气不错', '嗯嗯')
      x.id = 'mem-x'
      const y = m.addExchange('我的猫叫咪咪', '可爱')
      y.id = 'mem-y'
      // 填充工作记忆，使 X/Y 溢出到情景记忆
      for (let i = 0; i < 6; i++) {
        m.addExchange(`填充消息${i}`, 'ok')
      }

      m.buildRAGIndex()
      await tick()

      // 测试隔离：向量通道置空，避免共享 RAG 检索器单例的 vectorAvailable 状态污染
      ;(isVectorSearchAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(false)
      ;(searchSimilar as ReturnType<typeof vi.fn>).mockReturnValue([])

      const results = await m.retrieve('咪', 5)
      // P0-1: retrieve() 现在返回 RetrievalResult[]，需访问 .memory 字段
      expect(results.some((r) => r.memory.id === 'mem-x')).toBe(true)
      expect(results.some((r) => r.memory.id === 'mem-y')).toBe(true)
    })
  })

  describe('F10：校验和与损坏副本保留', () => {
    it('校验和不匹配时保留损坏副本到 *.corrupt 键', async () => {
      const corruptRaw = JSON.stringify({ workingMemory: [], _checksum: 'WRONG_CHECKSUM' })
      ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValueOnce(corruptRaw)
      const m = new EnhancedMemoryManager('f10-char')
      await m.ensureLoaded()
      expect(setSetting).toHaveBeenCalledWith('spiritpal-enhanced-memory-f10-char.corrupt', corruptRaw)
    })

    it('解密失败时保留损坏密文副本，而非静默丢弃', async () => {
      ;(getSetting as ReturnType<typeof vi.fn>).mockResolvedValueOnce('ENC2:broken-ciphertext')
      ;(invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('decrypt failed'))
      const m = new EnhancedMemoryManager('f10b-char')
      await m.ensureLoaded()
      expect(setSetting).toHaveBeenCalledWith('spiritpal-enhanced-memory-f10b-char.corrupt', 'ENC2:broken-ciphertext')
    })
  })
})
