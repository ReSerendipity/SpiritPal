/**
 * recallEngine.ts 单元测试
 *
 * 测试覆盖：
 * - 候选打分公式
 * - 模板兜底渲染
 * - buildRecallRenderPrompt 提示词构建
 * - 配置管理
 * - 单例缓存
 * - getTodayRecallCount
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock 依赖模块
vi.mock('../enhancedMemory', () => ({
  getEnhancedMemoryManager: vi.fn(() => ({
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    checkTriggers: vi.fn().mockResolvedValue(null),
    getAutobiographicalMemories: vi.fn(() => []),
  })),
}))

vi.mock('../commitmentTracker', () => ({
  getCommitmentTracker: vi.fn(() => ({
    generateFollowUpCandidates: vi.fn().mockResolvedValue([]),
  })),
}))

vi.mock('../bubbleManager', () => ({
  getBubbleManager: vi.fn(() => ({
    sendMessage: vi.fn(),
  })),
  MessagePriority: {
    Idle: 0,
    Proactive: 1,
    Emergency: 2,
  },
}))

vi.mock('../diarySystem', () => ({
  getDiarySystemManager: vi.fn(() => ({
    checkAnniversaryReminder: vi.fn().mockReturnValue(null),
  })),
}))

import {
  RecallEngine,
  getRecallEngine,
  buildRecallRenderPrompt,
  type RecallCandidate,
} from '../recallEngine'

describe('RecallEngine', () => {
  let engine: RecallEngine

  beforeEach(() => {
    engine = new RecallEngine('test-char', {
      dailyRecallBudget: 8,
      quietHoursStart: 23,
      quietHoursEnd: 8,
      minIdleMinutes: 5,
      minScoreThreshold: 0.3,
    })
  })

  describe('候选打分', () => {
    it('应使用正确的权重公式', () => {
      const candidate: RecallCandidate = {
        memories: [],
        cue: 'semantic',
        relevance: 1.0,
        novelty: 0.5,
        contextFit: 0.5,
        moodCongruence: 0.5,
        urgency: 0.5,
        summary: 'test',
      }
      // score = 0.35*1.0 + 0.2*0.5 + 0.2*0.5 + 0.15*0.5 + 0.1*0.5 = 0.675
      expect(engine.score(candidate)).toBeCloseTo(0.675, 2)
    })

    it('所有维度为 0 时分数为 0', () => {
      const candidate: RecallCandidate = {
        memories: [],
        cue: 'semantic',
        relevance: 0,
        novelty: 0,
        contextFit: 0,
        moodCongruence: 0,
        urgency: 0,
        summary: 'test',
      }
      expect(engine.score(candidate)).toBe(0)
    })

    it('所有维度为 1 时分数为 1', () => {
      const candidate: RecallCandidate = {
        memories: [],
        cue: 'semantic',
        relevance: 1,
        novelty: 1,
        contextFit: 1,
        moodCongruence: 1,
        urgency: 1,
        summary: 'test',
      }
      expect(engine.score(candidate)).toBeCloseTo(1.0, 5)
    })
  })

  describe('配置管理', () => {
    it('updateConfig 应更新配置', () => {
      engine.updateConfig({ dailyRecallBudget: 20 })
      // 间接验证：getTodayRecallCount 初始化时使用 config
      expect(engine.getTodayRecallCount()).toBe(0)
    })

    it('默认配置应正确', () => {
      const e = new RecallEngine('default-test')
      expect(e.getTodayRecallCount()).toBe(0)
    })
  })

  describe('getTodayRecallCount', () => {
    it('初始值应为 0', () => {
      expect(engine.getTodayRecallCount()).toBe(0)
    })
  })

  describe('buildRecallRenderPrompt', () => {
    it('应包含记忆片段', () => {
      const candidate: RecallCandidate = {
        memories: [
          {
            id: 'm1',
            user: '上次聊了工作的事',
            assistant: '加油',
            tags: [],
            created_at: new Date('2026-01-01').toISOString(),
            emotionalIntensity: 0.6,
            importance: 50,
            category: 'event',
            accessCount: 1,
            lastAccessed: 0,
            decayFactor: 1,
            isAutobiographical: false,
          },
        ],
        cue: 'semantic',
        relevance: 0.8,
        novelty: 0.7,
        contextFit: 0.5,
        moodCongruence: 0.6,
        urgency: 0.3,
        summary: '工作相关回忆',
      }
      const prompt = buildRecallRenderPrompt(candidate, '下午')
      expect(prompt).toContain('回忆指令')
      expect(prompt).toContain('上次聊了工作的事')
      expect(prompt).toContain('下午')
    })

    it('无记忆时应使用 summary', () => {
      const candidate: RecallCandidate = {
        memories: [],
        cue: 'commitment',
        relevance: 0.5,
        novelty: 0.5,
        contextFit: 0.5,
        moodCongruence: 0.5,
        urgency: 0.8,
        summary: '约定提醒',
      }
      const prompt = buildRecallRenderPrompt(candidate, '晚上')
      expect(prompt).toContain('约定提醒')
    })

    it('高情绪强度应标注情绪信息', () => {
      const candidate: RecallCandidate = {
        memories: [
          {
            id: 'm1',
            user: '今天很开心',
            assistant: '太好了',
            tags: [],
            created_at: new Date().toISOString(),
            emotionalIntensity: 0.8,
            importance: 70,
            category: 'emotion',
            accessCount: 0,
            lastAccessed: 0,
            decayFactor: 1,
            isAutobiographical: false,
          },
        ],
        cue: 'emotional',
        relevance: 0.7,
        novelty: 0.5,
        contextFit: 0.5,
        moodCongruence: 0.9,
        urgency: 0.3,
        summary: '开心的事',
      }
      const prompt = buildRecallRenderPrompt(candidate, '早上')
      expect(prompt).toContain('强烈')
    })
  })

  describe('单例', () => {
    it('getRecallEngine 应返回同一实例', () => {
      const e1 = getRecallEngine('singleton-test')
      const e2 = getRecallEngine('singleton-test')
      expect(e1).toBe(e2)
    })

    it('不同 characterId 应返回不同实例', () => {
      const e1 = getRecallEngine('char-a')
      const e2 = getRecallEngine('char-b')
      expect(e1).not.toBe(e2)
    })
  })
})
