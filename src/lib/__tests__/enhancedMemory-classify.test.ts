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

  describe('categorize 分类', () => {
    it('偏好关键词 → 偏好', () => {
      const mem = mgr.addExchange('我喜欢苹果', '好的')
      expect(mem.category).toBe('偏好')
    })

    it('情感关键词（非偏好）→ 情感', () => {
      const mem = mgr.addExchange('好开心啊', '太好了')
      expect(mem.category).toBe('情感')
    })

    it('事件关键词 → 事件', () => {
      const mem = mgr.addExchange('昨天出去了', '好玩吗')
      expect(mem.category).toBe('事件')
    })

    it('习惯关键词 → 习惯', () => {
      const mem = mgr.addExchange('我经常锻炼', '坚持真好')
      expect(mem.category).toBe('习惯')
    })

    it('关系关键词 → 关系', () => {
      const mem = mgr.addExchange('我朋友来了', '好的')
      expect(mem.category).toBe('关系')
    })

    it('无匹配关键词 → 日常', () => {
      const mem = mgr.addExchange('苹果', '好吃')
      expect(mem.category).toBe('日常')
    })
  })

describe('assessImportance 重要度评估', () => {
    it('长文本 (>100字符) 获得加分', () => {
      const longText = 'a'.repeat(101)
      const mem = mgr.addExchange(longText, '回复')
      expect(mem.importance).toBeGreaterThanOrEqual(45)
    })

    it('超长文本 (>200字符) 获得更多加分', () => {
      const longText = 'a'.repeat(201)
      const mem = mgr.addExchange(longText, '回复')
      expect(mem.importance).toBeGreaterThanOrEqual(55)
    })

    it('偏好关键词加分', () => {
      const mem = mgr.addExchange('我想要那个东西', '好的')
      expect(mem.importance).toBeGreaterThanOrEqual(40)
    })

    it('事件关键词加分', () => {
      const mem = mgr.addExchange('昨天的事情', '嗯')
      expect(mem.importance).toBeGreaterThanOrEqual(38)
    })

    it('情感关键词加分', () => {
      const mem = mgr.addExchange('好开心啊', '太好了')
      expect(mem.importance).toBeGreaterThanOrEqual(42)
    })

    it('重要度达到上限100', () => {
      const text = '我喜欢好开心记得昨天'.repeat(20)
      const mem = mgr.addExchange(text, '回复')
      expect(mem.importance).toBe(100)
    })
  })

describe('assessEmotion 情感强度', () => {
    it('感叹号增加情感强度', () => {
      const mem = mgr.addExchange('好开心!!!', '太好了')
      expect(mem.emotionalIntensity).toBeGreaterThan(0.2)
    })

    it('多个情感关键词提高强度', () => {
      const mem = mgr.addExchange('开心难过生气害怕', '我理解')
      expect(mem.emotionalIntensity).toBeGreaterThanOrEqual(0.7)
    })

    it('无情感关键词强度为0', () => {
      const mem = mgr.addExchange('苹果好吃', '是的')
      expect(mem.emotionalIntensity).toBe(0)
    })
  })

describe('extractTags 标签提取', () => {
    it('按频率排序取前5', () => {
      const mem = mgr.addExchange('apple apple banana cherry', 'ok')
      expect(mem.tags[0]).toBe('apple')
      expect(mem.tags.length).toBeLessThanOrEqual(5)
    })
  })
})
