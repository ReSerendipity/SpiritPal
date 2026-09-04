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

// Mock db — mock context_episodes 的语义化封装函数（走 invoke 的 sp_ctx_*）
const mocks = vi.hoisted(() => ({
  insertContextEpisode: vi.fn(),
  closeContextEpisode: vi.fn(),
  listContextEpisodes: vi.fn(),
}))

vi.mock('@/lib/data/db', () => mocks)

import {
  ContextEpisodeManager,
  getContextEpisodeManager,
  type ContextEpisode,
} from '@/lib/memory/contextEpisodeManager'

describe('ContextEpisodeManager', () => {
  let manager: ContextEpisodeManager

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.insertContextEpisode.mockResolvedValue(1)
    mocks.closeContextEpisode.mockResolvedValue(undefined)
    mocks.listContextEpisodes.mockResolvedValue([])
    manager = new ContextEpisodeManager('test-char')
  })

  describe('状态变迁记录', () => {
    it('work_state 变化时应记录新片段', async () => {
      mocks.insertContextEpisode.mockResolvedValueOnce(1)
      await manager.recordStateChange('coding', 'sunny', 5, 'pop')
      expect(mocks.insertContextEpisode).toHaveBeenCalled()
    })

    it('work_state 未变化且空闲未跨越阈值时不应记录', async () => {
      // 先记录一次状态
      await manager.recordStateChange('coding', 'sunny', 5, 'pop')
      vi.clearAllMocks()
      mocks.insertContextEpisode.mockResolvedValue(1)
      mocks.listContextEpisodes.mockResolvedValue([])

      // 相同状态，不应记录
      await manager.recordStateChange('coding', 'sunny', 3, 'pop')
      expect(mocks.insertContextEpisode).not.toHaveBeenCalled()
    })

    it('空闲跨越 30 分钟阈值时应记录', async () => {
      // 先记录初始状态
      await manager.recordStateChange('coding', 'sunny', 5)
      vi.clearAllMocks()
      mocks.insertContextEpisode.mockResolvedValue(2)
      mocks.listContextEpisodes.mockResolvedValue([])

      // 空闲超过 30 分钟（需要 lastRecordAt > 0 且间隔 > 30s）
      await new Promise(resolve => setTimeout(resolve, 50)) // 等待一点时间
      await manager.recordStateChange('idle', 'sunny', 35)
      expect(mocks.closeContextEpisode).toHaveBeenCalled() // 关闭旧 episode
      expect(mocks.insertContextEpisode).toHaveBeenCalled() // 开启新 episode
    })

    it('应关闭前一个 episode 再开启新的', async () => {
      await manager.recordStateChange('coding', 'sunny', 5)
      vi.clearAllMocks()
      mocks.insertContextEpisode.mockResolvedValue(2)
      mocks.listContextEpisodes.mockResolvedValue([])

      await manager.recordStateChange('meeting', 'rainy', 2)
      // 先关闭旧 episode，再开启新的
      expect(mocks.closeContextEpisode).toHaveBeenCalledTimes(1)
      expect(mocks.insertContextEpisode).toHaveBeenCalledTimes(1)
      const closeArgs = mocks.closeContextEpisode.mock.calls[0]
      expect(closeArgs[0]).toBe(1) // 旧 episode id
      expect(typeof closeArgs[1]).toBe('number') // ended_at
    })

    it('DB 不可用时应静默失败', async () => {
      mocks.closeContextEpisode.mockRejectedValue(new Error('DB error'))
      mocks.insertContextEpisode.mockRejectedValue(new Error('DB error'))
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
      mocks.listContextEpisodes.mockResolvedValueOnce(mockEpisodes)
      const result = await manager.getTodayEpisodes()
      expect(result).toEqual(mockEpisodes)
      expect(mocks.listContextEpisodes).toHaveBeenCalledOnce()
    })

    it('getEpisodesByDate 应查询指定日期片段', async () => {
      mocks.listContextEpisodes.mockResolvedValueOnce([])
      await manager.getEpisodesByDate('2026-08-08')
      expect(mocks.listContextEpisodes).toHaveBeenCalledOnce()
      const call = mocks.listContextEpisodes.mock.calls[0]
      expect(call[0]).toBe('test-char')
      expect(typeof call[1]).toBe('number') // start
      expect(typeof call[2]).toBe('number') // end
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
      mocks.listContextEpisodes.mockResolvedValueOnce([])
      const result = await manager.condenseToObservation(vi.fn())
      expect(result).toBeNull()
    })

    it('有片段时应调用 LLM 浓缩', async () => {
      mocks.listContextEpisodes.mockResolvedValueOnce([
        { id: 1, character_id: 'test-char', started_at: Date.now(), ended_at: null, work_state: 'coding', weather: null, idle_minutes: null, music: null, summary: null },
      ])
      const condenser = vi.fn().mockResolvedValue('今天主要在写代码')
      const result = await manager.condenseToObservation(condenser)
      expect(condenser).toHaveBeenCalledOnce()
      expect(result).toBe('今天主要在写代码')
    })

    it('LLM 浓缩失败时应返回 null', async () => {
      mocks.listContextEpisodes.mockResolvedValueOnce([
        { id: 1, character_id: 'test-char', started_at: Date.now(), ended_at: null, work_state: 'coding', weather: null, idle_minutes: null, music: null, summary: null },
      ])
      const condenser = vi.fn().mockRejectedValue(new Error('LLM error'))
      const result = await manager.condenseToObservation(condenser)
      expect(result).toBeNull()
    })

    it('LLM 返回空字符串时应返回 null', async () => {
      mocks.listContextEpisodes.mockResolvedValueOnce([
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