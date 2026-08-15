/**
 * commitmentTracker.ts 单元测试
 *
 * 测试覆盖：
 * - 规则层约定提取（PLAN_PATTERNS / TIME_HINTS）
 * - LLM 抽取（成功/失败回退）
 * - 数据库 CRUD（saveCommitment / getOpenCommitments / markFulfilled / markLapsed）
 * - 到期/逾期查询
 * - 自动过期（autoLapseOverdue）
 * - 候选消息生成（generateFollowUpCandidates）
 * - 上下文构建（buildContext）
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

import { CommitmentTracker, getCommitmentTracker } from '../commitmentTracker'

describe('CommitmentTracker', () => {
  let tracker: CommitmentTracker

  beforeEach(() => {
    vi.clearAllMocks()
    mockDbExecute.mockResolvedValue(undefined)
    mockDbSelect.mockResolvedValue([])
    tracker = new CommitmentTracker('test-char')
  })

  describe('规则层约定提取', () => {
    it('应从"我要…"模式中提取约定', () => {
      const results = tracker.extractFromText('我要去超市买东西', '好的')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].content).toContain('去超市')
      expect(results[0].actor).toBe('owner')
    })

    it('应从"我打算…"模式中提取约定', () => {
      const results = tracker.extractFromText('我打算明天写完报告', '加油')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].content).toContain('写完报告')
    })

    it('应从"明天…"时间词中提取约定', () => {
      const results = tracker.extractFromText('明天去看电影', '好的')
      expect(results.length).toBeGreaterThan(0)
    })

    it('应从"答应/承诺"模式中提取约定', () => {
      const results = tracker.extractFromText('我答应了他要帮忙', '真棒')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].content).toContain('帮忙')
    })

    it('应提取时间信息', () => {
      const results = tracker.extractFromText('我打算明天完成报告', '加油')
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].due).not.toBeNull()
      // due 应该是明天的日期
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const expectedDue = tomorrow.toISOString().split('T')[0]
      expect(results[0].due).toBe(expectedDue)
    })

    it('无约定内容的文本应返回空数组', () => {
      const results = tracker.extractFromText('今天天气真好', '是呀')
      expect(results.length).toBe(0)
    })

    it('内容过短（<2字）应被过滤', () => {
      const results = tracker.extractFromText('我要a', '好的')
      expect(results.length).toBe(0)
    })

    it('应截断过长的内容（>50字）', () => {
      const longContent = 'a'.repeat(100)
      const results = tracker.extractFromText(`我要${longContent}`, '好的')
      if (results.length > 0) {
        expect(results[0].content.length).toBeLessThanOrEqual(50)
      }
    })
  })

  describe('LLM 抽取', () => {
    it('无 LLM 函数时应回退到规则层', async () => {
      const results = await tracker.extractWithLLM('我要去跑步', '加油')
      expect(results.length).toBeGreaterThan(0)
    })

    it('LLM 成功时应使用 LLM 结果', async () => {
      const llmExtractor = vi.fn().mockResolvedValue([
        { content: 'LLM 提取的约定', actor: 'owner' as const, due: null, repeat: null },
      ])
      const results = await tracker.extractWithLLM('test text', 'test reply', llmExtractor)
      expect(llmExtractor).toHaveBeenCalledOnce()
      expect(results[0].content).toBe('LLM 提取的约定')
    })

    it('LLM 失败时应回退到规则层', async () => {
      const llmExtractor = vi.fn().mockRejectedValue(new Error('LLM error'))
      const results = await tracker.extractWithLLM('我要去超市', '好的', llmExtractor)
      expect(results.length).toBeGreaterThan(0)
      expect(results[0].content).toContain('去超市')
    })
  })

  describe('数据库 CRUD', () => {
    it('saveCommitment 应执行 INSERT 并返回 ID', async () => {
      mockDbSelect.mockResolvedValueOnce([{ id: 42 }])

      const id = await tracker.saveCommitment({
        content: '去买菜',
        actor: 'owner',
        due: '2026-08-10',
        repeat: null,
      })

      expect(mockDbExecute).toHaveBeenCalledOnce()
      expect(id).toBe(42)
    })

    it('getOpenCommitments 应查询 status=open 的约定', async () => {
      const mockData = [
        { id: 1, character_id: 'test-char', content: '任务1', actor: 'owner', due_at: 1000, status: 'open', source_memory_id: null, created_at: 0, follow_up_count: 0 },
      ]
      mockDbSelect.mockResolvedValueOnce(mockData)

      const result = await tracker.getOpenCommitments()
      expect(result).toEqual(mockData)
      expect(mockDbSelect).toHaveBeenCalledOnce()
    })

    it('markFulfilled 应执行 UPDATE', async () => {
      await tracker.markFulfilled(1)
      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE commitments SET status'),
        expect.arrayContaining([1]),
      )
    })

    it('markLapsed 应执行 UPDATE', async () => {
      await tracker.markLapsed(2)
      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.stringContaining("'lapsed'"),
        expect.arrayContaining([2]),
      )
    })

    it('incrementFollowUp 应增加跟进次数', async () => {
      await tracker.incrementFollowUp(3)
      expect(mockDbExecute).toHaveBeenCalledWith(
        expect.stringContaining('follow_up_count + 1'),
        expect.arrayContaining([3]),
      )
    })
  })

  describe('到期/逾期查询', () => {
    it('getDueTodayCommitments 应查询今天的到期约定', async () => {
      mockDbSelect.mockResolvedValueOnce([])
      await tracker.getDueTodayCommitments()
      expect(mockDbSelect).toHaveBeenCalledOnce()
      const call = mockDbSelect.mock.calls[0]
      expect(call[0]).toContain('due_at >= $2 AND due_at < $3')
    })

    it('getOverdueCommitments 应查询 1-3 天内的逾期约定', async () => {
      mockDbSelect.mockResolvedValueOnce([])
      await tracker.getOverdueCommitments()
      expect(mockDbSelect).toHaveBeenCalledOnce()
      const call = mockDbSelect.mock.calls[0]
      expect(call[0]).toContain('due_at < $2 AND due_at > $3')
    })

    it('autoLapseOverdue 应将超期 3 天的约定标记为 lapsed', async () => {
      mockDbSelect.mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      const count = await tracker.autoLapseOverdue()
      expect(count).toBe(2)
      expect(mockDbExecute).toHaveBeenCalledTimes(2) // 两次 markLapsed
    })
  })

  describe('候选消息生成', () => {
    it('应从今天到期的约定生成候选消息', async () => {
      const dueCommitment = {
        id: 1, character_id: 'test-char', content: '考试', actor: 'owner' as const,
        due_at: Date.now(), status: 'open' as const, source_memory_id: null,
        created_at: 0, follow_up_count: 0,
      }
      // Mock getDueTodayCommitments and getOverdueCommitments
      mockDbSelect
        .mockResolvedValueOnce([dueCommitment]) // getDueTodayCommitments
        .mockResolvedValueOnce([]) // getOverdueCommitments

      const candidates = await tracker.generateFollowUpCandidates()
      expect(candidates.length).toBeGreaterThan(0)
      expect(candidates[0].message).toContain('考试')
      expect(candidates[0].urgency).toBe(0.9)
    })

    it('逾期约定应生成跟进候选（仅在工作时间）', async () => {
      const overdueCommitment = {
        id: 2, character_id: 'test-char', content: '面试', actor: 'owner' as const,
        due_at: Date.now() - 86400000, status: 'open' as const, source_memory_id: null,
        created_at: 0, follow_up_count: 0,
      }
      mockDbSelect
        .mockResolvedValueOnce([]) // getDueTodayCommitments
        .mockResolvedValueOnce([overdueCommitment]) // getOverdueCommitments

      // Mock 当前时间为工作时间（下午 2 点）
      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 7, 8, 14, 0, 0))

      const candidates = await tracker.generateFollowUpCandidates()
      expect(candidates.length).toBeGreaterThan(0)
      expect(candidates[0].message).toContain('面试')

      vi.useRealTimers()
    })

    it('候选应按 urgency 降序排序', async () => {
      const dueToday = {
        id: 1, character_id: 'test-char', content: 'urgent', actor: 'owner' as const,
        due_at: Date.now(), status: 'open' as const, source_memory_id: null,
        created_at: 0, follow_up_count: 0,
      }
      const overdue = {
        id: 2, character_id: 'test-char', content: 'less urgent', actor: 'owner' as const,
        due_at: Date.now() - 86400000, status: 'open' as const, source_memory_id: null,
        created_at: 0, follow_up_count: 0,
      }
      mockDbSelect
        .mockResolvedValueOnce([dueToday])
        .mockResolvedValueOnce([overdue])

      vi.useFakeTimers()
      vi.setSystemTime(new Date(2026, 7, 8, 14, 0, 0))

      const candidates = await tracker.generateFollowUpCandidates()
      for (let i = 1; i < candidates.length; i++) {
        expect(candidates[i - 1].urgency).toBeGreaterThanOrEqual(candidates[i].urgency)
      }

      vi.useRealTimers()
    })
  })

  describe('上下文构建', () => {
    it('无约定时应返回空字符串', async () => {
      mockDbSelect.mockResolvedValueOnce([])
      const ctx = await tracker.buildContext()
      expect(ctx).toBe('')
    })

    it('有约定时应返回格式化的上下文', async () => {
      mockDbSelect.mockResolvedValueOnce([
        { id: 1, character_id: 'test-char', content: '完成任务A', actor: 'owner', due_at: Date.now() + 86400000, status: 'open', source_memory_id: null, created_at: 0, follow_up_count: 0 },
      ])
      const ctx = await tracker.buildContext()
      expect(ctx).toContain('【主人的计划与约定】')
      expect(ctx).toContain('完成任务A')
    })
  })

  describe('单例', () => {
    it('getCommitmentTracker 应返回同一实例', () => {
      const t1 = getCommitmentTracker('singleton-test')
      const t2 = getCommitmentTracker('singleton-test')
      expect(t1).toBe(t2)
    })

    it('不同 characterId 应返回不同实例', () => {
      const t1 = getCommitmentTracker('char-a')
      const t2 = getCommitmentTracker('char-b')
      expect(t1).not.toBe(t2)
    })
  })
})
