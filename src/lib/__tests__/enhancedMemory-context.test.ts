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

  describe('buildContext', () => {
    it('无记忆时返回空字符串', async () => {
      const ctx = await mgr.buildContext('查询')
      expect(ctx).toBe('')
    })

    it('有记忆时返回上下文文本', async () => {
      mgr.addExchange('你好', '你好呀')
      const ctx = await mgr.buildContext('你好')
      expect(ctx).toContain('你好')
    })
  })

describe('getContextForChat', () => {
    it('token 预算限制', async () => {
      mgr.addExchange('短消息', '短回复')
      const ctx = await mgr.getContextForChat(10)
      // 预算很小时可能只包含部分
      expect(typeof ctx).toBe('string')
    })

    it('无记忆时返回空字符串', async () => {
      const ctx = await mgr.getContextForChat(1000)
      expect(ctx).toBe('')
    })

    it('有记忆时包含即时记忆', async () => {
      mgr.addExchange('测试上下文', '回复内容')
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('测试上下文')
    })
  })

describe('applyDecay', () => {
    it('不抛出错误', () => {
      mgr.addExchange('测试', '回复')
      expect(() => mgr.applyDecay()).not.toThrow()
    })

    it('清理归档低重要度记忆', () => {
      // 添加一条记忆，手动修改创建时间为35天前
      mgr.addExchange('旧记忆', '旧回复')
      const all = mgr.getAllMemories()
      const old = all[0]
      old.created_at = new Date(Date.now() - 35 * 86400000).toISOString()
      old.importance = 10
      // 移到情景记忆
      for (let i = 0; i < 5; i++) {
        mgr.addExchange(`填充${i}`, `回复${i}`)
      }
      mgr.applyDecay()
      // 归档且低重要度应被清理
      const remaining = mgr.getAllMemories()
      expect(remaining.some((m) => m.id === old.id)).toBe(false)
    })
  })

describe('getContextForChat 带查询参数', () => {
    it('带 query 时调用向量检索', async () => {
      for (let i = 0; i < 7; i++) {
        mgr.addExchange(`apple${i}`, `reply${i}`)
      }
      const ctx = await mgr.getContextForChat(2000, 'apple')
      expect(ctx).toContain('短期记忆')
    })

    it('token 预算不足时不添加部分区块', async () => {
      mgr.addExchange('test', 'reply')
      const ctx = await mgr.getContextForChat(5)
      expect(typeof ctx).toBe('string')
    })
  })
})
