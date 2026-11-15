/**
 * attentionEngine 单元测试
 *
 * 覆盖：
 * - 硬闸：静默、TTS 播放、冷却期、用户活跃
 * - 评分：空闲时长、工作状态、时段、连续未回应
 * - 灰度开关默认值与切换
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ATTENTION_MIN_IDLE_MINUTES,
  ATTENTION_SCORE_THRESHOLD,
  decideAttention,
  isAttentionEngineEnabled,
  setAttentionEngineEnabled,
  type AttentionSignals,
} from '@/lib/ai/attentionEngine'

const NOW = new Date(2026, 10, 15, 10, 0, 0).getTime()

function signals(overrides: Partial<AttentionSignals> = {}): AttentionSignals {
  return {
    now: NOW,
    hour: 10,
    idleMinutes: 30,
    workState: 'unknown',
    lastProactiveAt: 0,
    silentMode: false,
    speechPlaying: false,
    unansweredStreak: 0,
    ...overrides,
  }
}

describe('decideAttention 硬闸', () => {
  it('静默模式直接否决', () => {
    const result = decideAttention(signals({ silentMode: true }))
    expect(result.shouldSpeak).toBe(false)
    expect(result.hardBlocked).toBe(true)
    expect(result.reason).toContain('静默')
  })

  it('TTS 正在播放直接否决', () => {
    const result = decideAttention(signals({ speechPlaying: true }))
    expect(result.shouldSpeak).toBe(false)
    expect(result.hardBlocked).toBe(true)
  })

  it('冷却期内直接否决', () => {
    const result = decideAttention(signals({ lastProactiveAt: NOW - 60_000 }))
    expect(result.shouldSpeak).toBe(false)
    expect(result.hardBlocked).toBe(true)
  })

  it('用户活跃（空闲不足 10 分钟）直接否决', () => {
    const result = decideAttention(signals({ idleMinutes: 3 }))
    expect(result.shouldSpeak).toBe(false)
    expect(result.hardBlocked).toBe(true)
    expect(ATTENTION_MIN_IDLE_MINUTES).toBe(10)
  })
})

describe('decideAttention 评分', () => {
  it('空闲 30 分钟且无干扰时允许开口', () => {
    const result = decideAttention(signals())
    expect(result.shouldSpeak).toBe(true)
    expect(result.score).toBeGreaterThanOrEqual(ATTENTION_SCORE_THRESHOLD)
  })

  it('会议中即使空闲 30 分钟也不开口', () => {
    const result = decideAttention(signals({ workState: 'meeting' }))
    expect(result.shouldSpeak).toBe(false)
    expect(result.hardBlocked).toBe(false)
  })

  it('深夜降低打扰，同样空闲不开口', () => {
    const result = decideAttention(signals({ hour: 2 }))
    expect(result.shouldSpeak).toBe(false)
  })

  it('连续 3 次未获回应时闭嘴', () => {
    const result = decideAttention(signals({ unansweredStreak: 3 }))
    expect(result.shouldSpeak).toBe(false)
    expect(result.reason).toContain('连续未回应')
  })

  it('空闲 15 分钟 + 浏览器场景可开口', () => {
    const result = decideAttention(signals({ idleMinutes: 15, workState: 'browsing' }))
    expect(result.shouldSpeak).toBe(true)
  })
})

describe('灰度开关', () => {
  beforeEach(() => {
    localStorage.removeItem('spiritpal:attention-engine')
  })

  afterEach(() => {
    localStorage.removeItem('spiritpal:attention-engine')
  })

  it('默认启用', () => {
    expect(isAttentionEngineEnabled()).toBe(true)
  })

  it('可关闭并回退旧路径', () => {
    setAttentionEngineEnabled(false)
    expect(isAttentionEngineEnabled()).toBe(false)
  })
})
