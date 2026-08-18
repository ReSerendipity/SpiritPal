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

  describe('addExchange', () => {
    it('添加记忆到工作记忆', () => {
      const mem = mgr.addExchange('你好', '你好呀')
      expect(mem.id).toBeTruthy()
      expect(mem.user).toBe('你好')
      expect(mem.assistant).toBe('你好呀')
      expect(mem.importance).toBeGreaterThanOrEqual(30)
      expect(mgr.getWorkingMemories().length).toBe(1)
    })

    it('重要记忆同时加入自传记忆', () => {
      // 包含情感关键词，重要度较高
      const mem = mgr.addExchange('我今天好开心，好喜欢这个！', '太好了！')
      expect(mem.importance).toBeGreaterThan(30)
      if (mem.isAutobiographical) {
        expect(mgr.getAutobiographicalMemories().length).toBeGreaterThanOrEqual(1)
      }
    })

    it('工作记忆超过5条时溢出到情景记忆', () => {
      for (let i = 0; i < 7; i++) {
        mgr.addExchange(`用户消息${i}`, `回复${i}`)
      }
      expect(mgr.getWorkingMemories().length).toBeLessThanOrEqual(5)
      expect(mgr.getEpisodicMemories().length).toBeGreaterThanOrEqual(2)
    })

    it('触发 save 持久化', async () => {
      mgr.addExchange('测试', '回复')
      // 保存走 500ms 防抖，等待防抖定时器触发后再断言
      await vi.waitFor(() => {
        expect(setSetting).toHaveBeenCalled()
      })
    })
  })

describe('getAllMemories', () => {
    it('返回所有层级的记忆', () => {
      mgr.addExchange('消息1', '回复1')
      mgr.addExchange('消息2', '回复2')
      const all = mgr.getAllMemories()
      expect(all.length).toBeGreaterThanOrEqual(2)
    })
  })

describe('search', () => {
    it('空查询返回所有记忆', () => {
      mgr.addExchange('苹果', '好吃')
      const results = mgr.search('')
      expect(results.length).toBeGreaterThan(0)
    })

    it('按关键词搜索', () => {
      mgr.addExchange('我喜欢苹果', '苹果很好吃')
      const results = mgr.search('苹果')
      expect(results.length).toBeGreaterThan(0)
    })

    it('无匹配时返回空数组', () => {
      mgr.addExchange('苹果', '好吃')
      const results = mgr.search('xyz123')
      expect(results.length).toBe(0)
    })
  })

describe('deleteMemory', () => {
    it('删除指定记忆', () => {
      const mem = mgr.addExchange('测试', '回复')
      expect(mgr.getAllMemories().length).toBeGreaterThan(0)
      mgr.deleteMemory(mem.id)
      expect(mgr.getAllMemories().some((m) => m.id === mem.id)).toBe(false)
    })
  })

describe('clear', () => {
    it('清空所有记忆', () => {
      mgr.addExchange('测试1', '回复1')
      mgr.addExchange('测试2', '回复2')
      mgr.clear()
      expect(mgr.getAllMemories().length).toBe(0)
      expect(mgr.getSemanticSummary()).toBe('')
    })
  })

describe('export / import', () => {
    it('export 返回 JSON 字符串', () => {
      mgr.addExchange('测试', '回复')
      const json = mgr.export()
      expect(() => JSON.parse(json)).not.toThrow()
    })

    it('import 恢复记忆数据', () => {
      mgr.addExchange('原始', '数据')
      const json = mgr.export()
      mgr.clear()
      const ok = mgr.import(json)
      expect(ok).toBe(true)
      expect(mgr.getAllMemories().length).toBeGreaterThan(0)
    })

    it('import 无效 JSON 返回 false', () => {
      expect(mgr.import('invalid json')).toBe(false)
    })
  })

describe('getEnhancedMemoryManager 单例', () => {
    it('相同 characterId 返回同一实例', () => {
      const m1 = getEnhancedMemoryManager('char-x')
      const m2 = getEnhancedMemoryManager('char-x')
      expect(m1).toBe(m2)
    })

    it('不同 characterId 返回不同实例', () => {
      const m1 = getEnhancedMemoryManager('char-a')
      const m2 = getEnhancedMemoryManager('char-b')
      expect(m1).not.toBe(m2)
    })
  })
})
