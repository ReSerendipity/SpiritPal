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

  describe('记忆分层与格式化 formatMemoryByTier', () => {
    it('热记忆完整保留', async () => {
      mgr.addExchange('short', 'reply')
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('用户：short')
      expect(ctx).toContain('角色：reply')
    })

    it('温记忆截断摘要', async () => {
      mgr.addExchange('a'.repeat(60), 'b'.repeat(60))
      mgr.getWorkingMemories()[0].created_at = new Date(
        Date.now() - 3 * 86400000,
      ).toISOString()
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('…')
    })

    it('冷记忆仅保留关键词', async () => {
      mgr.addExchange('apple pie', 'great food')
      mgr.getWorkingMemories()[0].created_at = new Date(
        Date.now() - 15 * 86400000,
      ).toISOString()
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('关键词')
    })

    it('归档记忆仅保留标题', async () => {
      mgr.addExchange('a'.repeat(25), 'reply')
      mgr.getWorkingMemories()[0].created_at = new Date(
        Date.now() - 35 * 86400000,
      ).toISOString()
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('标题')
    })
  })

describe('formatCoreMemoryByTier 核心记忆格式化', () => {
    it('热核心记忆完整内容', async () => {
      mgr.addExchange('I love apple happy sad angry afraid', 'great')
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('核心记忆')
      expect(ctx).toContain('[偏好]')
    })

    it('冷核心记忆关键词', async () => {
      mgr.addExchange('I love apple happy sad angry afraid', 'great')
      const auto = mgr.getAutobiographicalMemories()
      if (auto.length > 0) {
        auto[0].created_at = new Date(Date.now() - 15 * 86400000).toISOString()
      }
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('关键词')
    })

    it('归档核心记忆标题', async () => {
      mgr.addExchange('I love apple happy sad angry afraid', 'great')
      const auto = mgr.getAutobiographicalMemories()
      if (auto.length > 0) {
        auto[0].created_at = new Date(Date.now() - 35 * 86400000).toISOString()
      }
      const ctx = await mgr.getContextForChat(2000)
      expect(ctx).toContain('标题')
    })
  })

describe('compressEpisodic 情景记忆压缩', () => {
    it('超过50条时触发压缩', () => {
      for (let i = 0; i < 56; i++) {
        mgr.addExchange(`message${i}`, `reply${i}`)
      }
      expect(mgr.getEpisodicMemories().length).toBeLessThanOrEqual(30)
      expect(mgr.getSemanticSummary().length).toBeGreaterThan(0)
    })
  })
})
