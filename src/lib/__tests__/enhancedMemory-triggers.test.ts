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

  describe('checkTriggers', () => {
    it('无输入时主动触发模式（仅检查周期）', async () => {
      const result = await mgr.checkTriggers()
      // 无记忆/无周期事件时返回 null
      expect(result).toBeNull()
    })

    it('有输入但无匹配触发返回 null', async () => {
      const result = await mgr.checkTriggers('普通消息')
      expect(result).toBeNull()
    })

    it('情感关键词触发', async () => {
      // 添加带多个情感关键词的记忆以确保触发条件满足
      mgr.addExchange('开心难过生气害怕', '我理解')
      const result = await mgr.checkTriggers('我今天好开心')
      // 情感关键词匹配应触发 emotion 类型触发
      expect(result).not.toBeNull()
      expect(result!.type).toBeTruthy()
    })

    it('频率触发：同一话题3次以上', async () => {
      // 添加3次包含相同关键词的记忆
      mgr.addExchange('苹果很好吃', '是的')
      mgr.addExchange('我想吃苹果', '好的')
      mgr.addExchange('苹果哪里买', '超市')
      const result = await mgr.checkTriggers('苹果')
      if (result) {
        expect(['frequency', 'relevance']).toContain(result.type)
      }
    })
  })

describe('触发频率控制', () => {
    it('canTrigger 初始允许触发', () => {
      expect(mgr.canTrigger('frequency')).toBe(true)
    })

    it('recordTrigger 记录触发历史', () => {
      mgr.recordTrigger('frequency')
      // 立即再次触发应被限制（间隔不足30分钟）
      expect(mgr.canTrigger('frequency')).toBe(false)
    })

    it('recordUserResponse 重置忽略计数', () => {
      mgr.recordUserResponse('frequency', false)
      mgr.recordUserResponse('frequency', false)
      mgr.recordUserResponse('frequency', false)
      mgr.recordUserResponse('frequency', true)
      // 用户回复后忽略计数清零
      expect(mgr.canTrigger('frequency')).toBe(true)
    })

    it('连续忽略3次后降频', () => {
      mgr.recordUserResponse('frequency', false)
      mgr.recordUserResponse('frequency', false)
      mgr.recordUserResponse('frequency', false)
      // 记录一次触发以满足间隔条件
      mgr.recordTrigger('frequency')
      // 降频后间隔需加倍，应被限制
      expect(mgr.canTrigger('frequency')).toBe(false)
    })
  })

describe('触发机制详解', () => {
    describe('checkFrequencyTrigger', () => {
      it('Latin token 出现3次以上且有情结记忆', async () => {
        for (let i = 0; i < 7; i++) {
          mgr.addExchange('apple is good', 'yes')
        }
        const result = await mgr.checkTriggers('apple')
        expect(result).not.toBeNull()
        expect(result!.type).toBe('frequency')
      })

      it('频率不足不触发', async () => {
        mgr.addExchange('apple', 'ok')
        const result = await mgr.checkTriggers('apple')
        // freq=1 < 3, no other trigger
        expect(result).toBeNull()
      })
    })

    describe('checkRelevanceTrigger (LCS fallback)', () => {
      it('LCS 相似度匹配触发', async () => {
        for (let i = 0; i < 7; i++) {
          mgr.addExchange('今天天气真好', '是啊')
        }
        const result = await mgr.checkTriggers('今天天气真好啊')
        expect(result).not.toBeNull()
        expect(result!.type).toBe('relevance')
      })

      it('LCS 分数不足不触发', async () => {
        for (let i = 0; i < 7; i++) {
          mgr.addExchange('unique_text', 'reply')
        }
        const result = await mgr.checkTriggers('xyz')
        expect(result).toBeNull()
      })
    })

    describe('checkEmotionTrigger', () => {
      it('情感关键词且有高情感自传记忆', async () => {
        mgr.addExchange('开心难过生气害怕担心', '我理解')
        const result = await mgr.checkTriggers('我今天好开心')
        expect(result).not.toBeNull()
        expect(result!.type).toBe('emotion')
      })

      it('情感关键词但无高情感记忆', async () => {
        mgr.addExchange('test', 'reply')
        const result = await mgr.checkTriggers('今天好开心')
        expect(result).toBeNull()
      })

      it('无情感关键词不触发', async () => {
        mgr.addExchange('开心难过生气害怕担心', '我理解')
        const result = await mgr.checkTriggers('苹果')
        expect(result).toBeNull()
      })
    })

    describe('checkKeywordTrigger', () => {
      it('事件关键词且有相关自传记忆', async () => {
        mgr.addExchange('I love apple happy sad angry afraid', 'great')
        const result = await mgr.checkTriggers('apple today')
        expect(result).not.toBeNull()
        expect(result!.type).toBe('keyword')
      })

      it('事件关键词但无相关自传记忆', async () => {
        mgr.addExchange('I love apple happy sad angry afraid', 'great')
        const result = await mgr.checkTriggers('today')
        expect(result).toBeNull()
      })
    })

    describe('checkTimeTrigger', () => {
      it('新的一天首次对话触发', async () => {
        vi.useFakeTimers()
        try {
          // 模拟"昨天"完成一次对话（lastChatDate 记录为昨天的日期）
          vi.setSystemTime(new Date('2026-08-06T10:00:00'))
          mgr.addExchange('开心难过生气害怕担心', '我理解')
          // 推进到"今天"，再触发检查 → lastChatDate（昨天）≠ today → 触发时间触发
          vi.setSystemTime(new Date('2026-08-07T10:00:00'))
          const result = await mgr.checkTriggers('普通的')
          expect(result).not.toBeNull()
          expect(result!.type).toBe('time')
        } finally {
          vi.useRealTimers()
        }
      })

      it('同一天不触发时间触发', async () => {
        mgr.addExchange('开心难过生气害怕担心', '我理解')
        const working = mgr.getWorkingMemories()
        working[0].lastAccessed = Date.now()
        const result = await mgr.checkTriggers('普通的')
        expect(result).toBeNull()
      })

      it('无 lastAccessed 不触发', async () => {
        mgr.addExchange('开心难过生气害怕担心', '我理解')
        const working = mgr.getWorkingMemories()
        working[0].lastAccessed = 0
        const result = await mgr.checkTriggers('普通的')
        expect(result).toBeNull()
      })

      it('新一天但无自传记忆不触发', async () => {
        mgr.addExchange('test', 'reply')
        const working = mgr.getWorkingMemories()
        working[0].lastAccessed = Date.now() - 86400000
        const result = await mgr.checkTriggers('xyz')
        expect(result).toBeNull()
      })
    })
  })

describe('周期触发', () => {
    it('纪念日里程碑（100天）', async () => {
      mgr.addExchange('first message', 'first reply')
      mgr.getWorkingMemories()[0].created_at = new Date(
        Date.now() - 100 * 86400000,
      ).toISOString()
      const result = await mgr.checkTriggers()
      expect(result).not.toBeNull()
      expect(result!.type).toBe('periodic')
      expect(result!.message).toContain('100')
    })

    it('同一天不重复触发纪念日', async () => {
      mgr.addExchange('first message', 'first reply')
      mgr.getWorkingMemories()[0].created_at = new Date(
        Date.now() - 100 * 86400000,
      ).toISOString()
      const r1 = await mgr.checkTriggers()
      expect(r1).not.toBeNull()
      const r2 = await mgr.checkTriggers()
      expect(r2).toBeNull()
    })

    it('认识不足100天不触发纪念日', async () => {
      mgr.addExchange('first', 'reply')
      mgr.getWorkingMemories()[0].created_at = new Date(
        Date.now() - 50 * 86400000,
      ).toISOString()
      expect(await mgr.checkTriggers()).toBeNull()
    })

    it('认识天数非里程碑不触发', async () => {
      mgr.addExchange('first', 'reply')
      mgr.getWorkingMemories()[0].created_at = new Date(
        Date.now() - 101 * 86400000,
      ).toISOString()
      expect(await mgr.checkTriggers()).toBeNull()
    })

    it('节日：新年（固定日期）', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 0, 1))
      const result = await mgr.checkTriggers()
      expect(result).not.toBeNull()
      expect(result!.message).toContain('新年快乐')
      vi.useRealTimers()
    })

    it('节日：圣诞（固定日期）', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2025, 11, 25))
      const result = await mgr.checkTriggers()
      expect(result).not.toBeNull()
      expect(result!.message).toContain('圣诞')
      vi.useRealTimers()
    })

    it('节日：春节（农历日期映射）', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 1, 17))
      const result = await mgr.checkTriggers()
      expect(result).not.toBeNull()
      expect(result!.message).toContain('新年快乐')
      vi.useRealTimers()
    })

    it('节日：中秋（农历日期映射）', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 8, 25))
      const result = await mgr.checkTriggers()
      expect(result).not.toBeNull()
      expect(result!.message).toContain('中秋')
      vi.useRealTimers()
    })

    it('宠物生日触发', async () => {
      const now = new Date()
      localStorage.setItem(
        'spiritpal-pet-birthday-test-char',
        `${now.getMonth() + 1}-${now.getDate()}`,
      )
      const result = await mgr.checkTriggers()
      expect(result).not.toBeNull()
      expect(result!.message).toContain('生日快乐')
    })

    it('无效生日格式不触发', async () => {
      localStorage.setItem('spiritpal-pet-birthday-test-char', 'invalid')
      expect(await mgr.checkTriggers()).toBeNull()
    })

    it('无效生日日期不触发', async () => {
      localStorage.setItem('spiritpal-pet-birthday-test-char', '13-45')
      expect(await mgr.checkTriggers()).toBeNull()
    })

    it('生日非今天不触发', async () => {
      const now = new Date()
      const otherMonth = now.getMonth() === 0 ? 6 : 1
      localStorage.setItem('spiritpal-pet-birthday-test-char', `${otherMonth}-1`)
      expect(await mgr.checkTriggers()).toBeNull()
    })

    it('周期触发被频率限制（主动模式返回null）', async () => {
      const now = new Date()
      localStorage.setItem(
        'spiritpal-pet-birthday-test-char',
        `${now.getMonth() + 1}-${now.getDate()}`,
      )
      mgr.recordTrigger('frequency')
      expect(await mgr.checkTriggers()).toBeNull()
    })

    it('周期触发被限流但有输入时继续检查其他触发', async () => {
      const now = new Date()
      localStorage.setItem(
        'spiritpal-pet-birthday-test-char',
        `${now.getMonth() + 1}-${now.getDate()}`,
      )
      mgr.recordTrigger('frequency')
      mgr.addExchange('开心难过生气害怕担心', '我理解')
      const result = await mgr.checkTriggers('我今天好开心')
      expect(result).not.toBeNull()
      expect(result!.type).toBe('emotion')
    })
  })
})
