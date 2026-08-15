/**
 * contextEpisodeManager.ts 单元测试
 *
 * 测试覆盖：
 * - 状态变迁记录（work_state 变化、空闲阈值跨越）
 * - 查询当日片段
 * - 查询指定日期片段
 * - 片段摘要文本构建
 * - LLM 浓缩为观察记忆
 * - 单例缓存
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock db — 使用 vi.hoisted 确保 mock 函数在 vi.mock 提升前已定义
const { mockDbExecute, mockDbSelect } = vi.hoisted(() => ({
  mockDbExecute: vi.fn(),
  mockDbSelect: vi.fn(),
}))

vi.mock('../db', () => ({
  getDb: vi.fn().mockResolvedValue({
    execute: mockDbExecute,
    select: mockDbSelect,
  }),
}))

import {
  ContextEpisodeManager,
  getContextEpisodeManager,
  type ContextEpisode,
} from '../contextEpisodeManager'

describe('ContextEpisodeManager', () => {
  let manager: ContextEpisodeManager

  beforeEach(() => {
    vi.clearAllMocks()
    mockDbExecute.mockResolvedValue(undefined)
    mockDbSelect.mockResolvedValue([])
    manager = new ContextEpisodeManager('test-char')
  })

  describe('状态变迁记录', () => {
    it('work_state 变化时应记录新片段', async () => {
      mockDbSelect.mockResolvedValue([{ id: 1 }])
      await manager.recordStateChange('coding', 'sunny', 5, 'pop')
      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('work_state 未变化且空闲未跨越阈值时不应记录', async () => {
      // 先记录一次状态
      mockDbSelect.mockResolvedValue([{ id: 1 }])
      await manager.recordStateChange('coding', 'sunny', 5, 'pop')
      vi.clearAllMocks()
      mockDbExecute.mockResolvedValue(undefined)
      mockDbSelect.mockResolvedValue([])

      // 相同状态，不应记录
      await manager.recordStateChange('coding', 'sunny', 3, 'pop')
      expect(mockDbExecute).not.toHaveBeenCalled()
    })

    it('空闲跨越 30 分钟阈值时应记录', async () => {
      mockDbSelect.mockResolvedValue([{ id: 1 }])
      // 先记录初始状态
      await manager.recordStateChange('coding', 'sunny', 5)
      vi.clearAllMocks()
      mockDbExecute.mockResolvedValue(undefined)
      mockDbSelect.mockResolvedValue([{ id: 2 }])

      // 空闲超过 30 分钟（需要 lastRecordAt > 0 且间隔 > 30s）
      await new Promise(resolve => setTimeout(resolve, 50)) // 等待一点时间
      await manager.recordStateChange('idle', 'sunny', 35)
      // 应该关闭旧 episode 并开启新的
      expect(mockDbExecute).toHaveBeenCalled()
    })

    it('应关闭前一个 episode 再开启新的', async () => {
      mockDbSelect.mockResolvedValue([{ id: 1 }])
      await manager.recordStateChange('coding', 'sunny', 5)
      vi.clearAllMocks()
      mockDbExecute.mockResolvedValue(undefined)
      mockDbSelect.mockResolvedValue([{ id: 2 }])

      await manager.recordStateChange('meeting', 'rainy', 2)
      // 第一次 execute 是 UPDATE（关闭旧 episode）
      expect(mockDbExecute.mock.calls[0][0]).toContain('UPDATE context_episodes SET ended_at')
    })

    it('DB 不可用时应静默失败', async () => {
      mockDbExecute.mockRejectedValue(new Error('DB error'))
      mockDbSelect.mockRejectedValue(new Error('DB error'))
      // 不应抛出异常
      await manager.recordStateChange('coding', 'sunny', 5)
      expect(true).toBe(true)
    })
  })

  describe('片段查询', () => {
    it('getTodayEpisodes 应查询今日片段', async () => {
      const mockEpisodes: ContextEpisode[] = [
        { id: 1, character_id: 'test-char', started_at: Date.now(), ended_at: null, work_state: 'coding', weather: null, idle_minutes: null, music: null, summary: null },
      ]
      mockDbSelect.mockResolvedValueOnce(mockEpisodes)
      const result = await manager.getTodayEpisodes()
      expect(result).toEqual(mockEpisodes)
      expect(mockDbSelect).toHaveBeenCalledOnce()
    })

    it('getEpisodesByDate 应查询指定日期片段', async () => {
      mockDbSelect.mockResolvedValueOnce([])
      await manager.getEpisodesByDate('2026-08-08')
      expect(mockDbSelect).toHaveBeenCalledOnce()
      const call = mockDbSelect.mock.calls[0]
      expect(call[0]).toContain('started_at >= $2 AND started_at < $3')
    })
  })

  describe('片段摘要文本构建', () => {
    it('空片段应返回空字符串', () => {
      expect(manager.buildEpisodesText([])).toBe('')
    })

    it('应正确格式化片段信息', () => {
      const episodes: ContextEpisode[] = [
        {
          id: 1,
          character_id: 'test-char',
          started_at: new Date(2026, 7, 8, 9, 0, 0).getTime(),
          ended_at: new Date(2026, 7, 8, 10, 0, 0).getTime(),
          work_state: 'coding',
          weather: 'sunny',
          idle_minutes: 5,
          music: 'pop',
          summary: null,
        },
      ]
      const text = manager.buildEpisodesText(episodes)
      expect(text).toContain('coding')
      expect(text).toContain('sunny')
      expect(text).toContain('5')
      expect(text).toContain('pop')
    })

    it('未关闭的 episode 应显示"至今"', () => {
      const episodes: ContextEpisode[] = [
        {
          id: 2,
          character_id: 'test-char',
          started_at: new Date(2026, 7, 8, 14, 0, 0).getTime(),
          ended_at: null,
          work_state: 'meeting',
          weather: null,
          idle_minutes: null,
          music: null,
          summary: null,
        },
      ]
      const text = manager.buildEpisodesText(episodes)
      expect(text).toContain('至今')
      expect(text).toContain('meeting')
    })
  })

  describe('LLM 浓缩', () => {
    it('无片段时应返回 null', async () => {
      mockDbSelect.mockResolvedValueOnce([])
      const result = await manager.condenseToObservation(vi.fn())
      expect(result).toBeNull()
    })

    it('有片段时应调用 LLM 浓缩', async () => {
      mockDbSelect.mockResolvedValueOnce([
        { id: 1, character_id: 'test-char', started_at: Date.now(), ended_at: null, work_state: 'coding', weather: null, idle_minutes: null, music: null, summary: null },
      ])
      const condenser = vi.fn().mockResolvedValue('今天主要在写代码')
      const result = await manager.condenseToObservation(condenser)
      expect(condenser).toHaveBeenCalledOnce()
      expect(result).toBe('今天主要在写代码')
    })

    it('LLM 浓缩失败时应返回 null', async () => {
      mockDbSelect.mockResolvedValueOnce([
        { id: 1, character_id: 'test-char', started_at: Date.now(), ended_at: null, work_state: 'coding', weather: null, idle_minutes: null, music: null, summary: null },
      ])
      const condenser = vi.fn().mockRejectedValue(new Error('LLM error'))
      const result = await manager.condenseToObservation(condenser)
      expect(result).toBeNull()
    })

    it('LLM 返回空字符串时应返回 null', async () => {
      mockDbSelect.mockResolvedValueOnce([
        { id: 1, character_id: 'test-char', started_at: Date.now(), ended_at: null, work_state: 'coding', weather: null, idle_minutes: null, music: null, summary: null },
      ])
      const condenser = vi.fn().mockResolvedValue('   ')
      const result = await manager.condenseToObservation(condenser)
      expect(result).toBeNull()
    })
  })

  describe('单例', () => {
    it('getContextEpisodeManager 应返回同一实例', () => {
      const m1 = getContextEpisodeManager('singleton-test')
      const m2 = getContextEpisodeManager('singleton-test')
      expect(m1).toBe(m2)
    })

    it('不同 characterId 应返回不同实例', () => {
      const m1 = getContextEpisodeManager('char-a')
      const m2 = getContextEpisodeManager('char-b')
      expect(m1).not.toBe(m2)
    })
  })
})
