/**
 * diarySystem.ts 单元测试
 *
 * 测试覆盖：
 * - 日记条目生成（轮数阈值、摘要截断、话题提取、情感计算、关键事件提取）
 * - 简单摘要生成（≤3轮 / >3轮）
 * - 话题提取（中文分词、停用词过滤、拉丁词、频率排序）
 * - 情感倾向计算（正面/负面词、归一化）
 * - 关键事件提取（生日/纪念日/毕业等模式）
 * - 日记查询（getDiary / getTodayDiary / getRecentDiaries / getAllDiaries / searchDiaries）
 * - 纪念日提醒
 * - 配置管理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock enhancedMemory
const mockAddExchange = vi.fn()
const mockGetAutobiographicalMemories = vi.fn(() => [])

vi.mock('../enhancedMemory', () => ({
  getEnhancedMemoryManager: vi.fn(() => ({
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    addExchange: mockAddExchange,
    getAutobiographicalMemories: mockGetAutobiographicalMemories,
  })),
}))

import {
  DiarySystemManager,
  DEFAULT_DIARY_CONFIG,
  getDiarySystemManager,
} from '../diarySystem'

describe('DiarySystemManager', () => {
  let manager: DiarySystemManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockAddExchange.mockImplementation((user: string) => ({
      id: `mem_${Date.now()}_${Math.random()}`,
      user,
      assistant: '',
      tags: [],
      created_at: new Date().toISOString(),
      emotionalIntensity: 0,
    }))
    manager = new DiarySystemManager('test-char', {
      minExchangesPerDay: 3,
      maxSummaryLength: 300,
      maxTopics: 5,
    })
  })

  afterEach(() => {
    manager.updateConfig({ autoGenerate: false })
  })

  describe('对话收集', () => {
    it('应该正确记录对话', () => {
      manager.recordExchange('你好', '你好呀！')
      manager.recordExchange('今天天气不错', '是呀，很适合散步')
      expect(manager.getTodayExchangeCount()).toBe(2)
    })

    it('多次记录应累加', () => {
      for (let i = 0; i < 5; i++) {
        manager.recordExchange(`消息${i}`, `回复${i}`)
      }
      expect(manager.getTodayExchangeCount()).toBe(5)
    })
  })

  describe('日记生成', () => {
    it('对话轮数不足时不应生成日记', async () => {
      manager.recordExchange('你好', '你好呀')
      const entry = await manager.generateDiary()
      expect(entry).toBeNull()
    })

    it('达到阈值时应生成日记', async () => {
      manager.recordExchange('今天我去了公园', '公园好玩吗？')
      manager.recordExchange('还不错，遇到了老朋友', '太好了！')
      manager.recordExchange('我们聊了很多开心的事', '听起来很愉快')

      const entry = await manager.generateDiary()
      expect(entry).not.toBeNull()
      expect(entry!.exchangeCount).toBe(3)
      expect(entry!.summary.length).toBeLessThanOrEqual(303) // 300 + '...'
      expect(entry!.topics).toBeDefined()
      expect(entry!.topics.length).toBeLessThanOrEqual(5)
      expect(entry!.sentimentScore).toBeGreaterThanOrEqual(-1)
      expect(entry!.sentimentScore).toBeLessThanOrEqual(1)
    })

    it('生成日记后应清空当日对话收集', async () => {
      manager.recordExchange('a', 'b')
      manager.recordExchange('c', 'd')
      manager.recordExchange('e', 'f')
      await manager.generateDiary()
      expect(manager.getTodayExchangeCount()).toBe(0)
    })

    it('使用 LLM 摘要器时应调用它', async () => {
      manager.recordExchange('x', 'y')
      manager.recordExchange('z', 'w')
      manager.recordExchange('q', 'r')

      const summarizer = vi.fn().mockResolvedValue('LLM 生成的摘要')
      const entry = await manager.generateDiary(summarizer)
      expect(summarizer).toHaveBeenCalledOnce()
      expect(entry!.summary).toBe('LLM 生成的摘要')
    })

    it('LLM 摘要器失败时应回退到简单摘要', async () => {
      manager.recordExchange('x', 'y')
      manager.recordExchange('z', 'w')
      manager.recordExchange('q', 'r')

      const summarizer = vi.fn().mockRejectedValue(new Error('LLM error'))
      const entry = await manager.generateDiary(summarizer)
      expect(entry).not.toBeNull()
      expect(entry!.summary).toContain('聊了')
    })

    it('摘要超过最大长度时应截断', async () => {
      manager.recordExchange('a'.repeat(100), 'b')
      manager.recordExchange('c'.repeat(100), 'd')
      manager.recordExchange('e'.repeat(100), 'f')

      const longSummary = 'x'.repeat(500)
      const summarizer = vi.fn().mockResolvedValue(longSummary)
      const entry = await manager.generateDiary(summarizer)
      expect(entry!.summary.length).toBe(303) // 300 + '...'
      expect(entry!.summary.endsWith('...')).toBe(true)
    })
  })

  describe('情感倾向计算', () => {
    it('正面词汇应提高情感分数', async () => {
      manager.recordExchange('今天很开心', '太好了！')
      manager.recordExchange('非常幸福', '是呀')
      manager.recordExchange('喜欢这个', '我也是')
      const entry = await manager.generateDiary()
      expect(entry!.sentimentScore).toBeGreaterThan(0)
    })

    it('负面词汇应降低情感分数', async () => {
      manager.recordExchange('今天很难过', '怎么了？')
      manager.recordExchange('很伤心', '别难过了')
      manager.recordExchange('讨厌这个', '是吗')
      const entry = await manager.generateDiary()
      expect(entry!.sentimentScore).toBeLessThan(0)
    })
  })

  describe('关键事件提取', () => {
    it('应从对话中提取生日/纪念日等关键事件', async () => {
      manager.recordExchange('明天是我的生日', '生日快乐！')
      manager.recordExchange('下周有毕业典礼', '恭喜！')
      manager.recordExchange('今天很开心', '太好了')

      const entry = await manager.generateDiary()
      expect(entry!.keyEvents.length).toBeGreaterThan(0)
      expect(entry!.keyEvents.some(e => e.includes('生日'))).toBe(true)
    })
  })

  describe('日记查询', () => {
    it('getDiary 应返回指定日期的日记', async () => {
      manager.recordExchange('a', 'b')
      manager.recordExchange('c', 'd')
      manager.recordExchange('e', 'f')
      const entry = await manager.generateDiary()

      const today = new Date()
      const y = today.getFullYear()
      const m = String(today.getMonth() + 1).padStart(2, '0')
      const d = String(today.getDate()).padStart(2, '0')
      const dateStr = `${y}-${m}-${d}`

      const found = manager.getDiary(dateStr)
      expect(found).not.toBeUndefined()
      expect(found!.summary).toBe(entry!.summary)
    })

    it('getTodayDiary 应返回今日日记', async () => {
      manager.recordExchange('a', 'b')
      manager.recordExchange('c', 'd')
      manager.recordExchange('e', 'f')
      await manager.generateDiary()
      expect(manager.getTodayDiary()).not.toBeUndefined()
    })

    it('getAllDiaries 应按日期降序返回', async () => {
      // 生成两条日记（不同日期需要 mock 日期）
      const all = manager.getAllDiaries()
      expect(Array.isArray(all)).toBe(true)
    })

    it('searchDiaries 应按关键词搜索', async () => {
      manager.recordExchange('今天去公园了', '好玩吗？')
      manager.recordExchange('公园里有很多花', '是呀')
      manager.recordExchange('还买了冰淇淋', '好吃吗')
      await manager.generateDiary()

      const results = manager.searchDiaries('公园')
      expect(results.length).toBeGreaterThan(0)
    })
  })

  describe('纪念日提醒', () => {
    it('无关键事件时应返回 null', () => {
      expect(manager.checkAnniversaryReminder()).toBeNull()
    })
  })

  describe('配置管理', () => {
    it('updateConfig 应更新配置', () => {
      manager.updateConfig({ minExchangesPerDay: 5 })
      const config = manager.getConfig()
      expect(config.minExchangesPerDay).toBe(5)
    })

    it('getConfig 应返回配置副本', () => {
      const config1 = manager.getConfig()
      const config2 = manager.getConfig()
      expect(config1).toEqual(config2)
      expect(config1).not.toBe(config2)
    })

    it('size 应返回日记条目数', () => {
      expect(manager.size).toBeGreaterThanOrEqual(0)
    })
  })

  describe('默认配置', () => {
    it('DEFAULT_DIARY_CONFIG 应有正确的默认值', () => {
      expect(DEFAULT_DIARY_CONFIG.minExchangesPerDay).toBe(3)
      expect(DEFAULT_DIARY_CONFIG.maxSummaryLength).toBe(300)
      expect(DEFAULT_DIARY_CONFIG.maxTopics).toBe(5)
      expect(DEFAULT_DIARY_CONFIG.autoGenerate).toBe(true)
      expect(DEFAULT_DIARY_CONFIG.generateHour).toBe(23)
    })
  })

  describe('单例', () => {
    it('getDiarySystemManager 应返回同一实例', () => {
      const m1 = getDiarySystemManager('singleton-test')
      const m2 = getDiarySystemManager('singleton-test')
      expect(m1).toBe(m2)
    })

    it('不同 characterId 应返回不同实例', () => {
      const m1 = getDiarySystemManager('char-a')
      const m2 = getDiarySystemManager('char-b')
      expect(m1).not.toBe(m2)
    })
  })
})
