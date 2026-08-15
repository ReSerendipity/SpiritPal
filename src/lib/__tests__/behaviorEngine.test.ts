// behaviorEngine 单元测试 — HP 概率矩阵、亲密度等级、动画选择
import { describe, it, expect, vi } from 'vitest'
import {
  getHpTier,
  getAffectionLevel,
  actWeight,
  calculateProbabilities,
  pickBehaviorByProbability,
  pickPetReaction,
  DEFAULT_ANIMATIONS,
} from '../behaviorEngine'
import type { NurturingStats } from '../types'

function makeStats(overrides: Partial<NurturingStats> = {}): NurturingStats {
  return {
    hunger: 80,
    mood: 70,
    health: 100,
    affection: 1000,
    level: 10,
    exp: 0,
    coins: 0,
    lastTickAt: Date.now(),
    lastInteractionAt: Date.now(),
    lastAffectionDecayAt: Date.now(),
    ...overrides,
  }
}

describe('getHpTier', () => {
  it('健康为 0 时强制濒死 tier 0', () => {
    expect(getHpTier(makeStats({ health: 0, hunger: 90 }))).toBe(0)
  })

  it('hunger >= 80 时为 tier 3（精力充沛）', () => {
    expect(getHpTier(makeStats({ hunger: 80 }))).toBe(3)
    expect(getHpTier(makeStats({ hunger: 100 }))).toBe(3)
  })

  it('hunger 在 50-79 时为 tier 2（正常）', () => {
    expect(getHpTier(makeStats({ hunger: 50 }))).toBe(2)
    expect(getHpTier(makeStats({ hunger: 79 }))).toBe(2)
  })

  it('hunger 在 20-49 时为 tier 1（饥饿）', () => {
    expect(getHpTier(makeStats({ hunger: 20 }))).toBe(1)
    expect(getHpTier(makeStats({ hunger: 49 }))).toBe(1)
  })

  it('hunger < 20 时为 tier 0（濒死）', () => {
    expect(getHpTier(makeStats({ hunger: 0 }))).toBe(0)
    expect(getHpTier(makeStats({ hunger: 19 }))).toBe(0)
  })
})

describe('getAffectionLevel', () => {
  it('亲密度 0 返回等级 0', () => {
    expect(getAffectionLevel(0)).toBe(0)
  })
  it('亲密度 100 → 等级 1', () => {
    expect(getAffectionLevel(100)).toBe(1)
  })
  it('亲密度 500 → 等级 2', () => {
    expect(getAffectionLevel(500)).toBe(2)
  })
  it('亲密度 1500 → 等级 3', () => {
    expect(getAffectionLevel(1500)).toBe(3)
  })
  it('亲密度 3000 → 等级 4', () => {
    expect(getAffectionLevel(3000)).toBe(4)
  })
  it('亲密度 5000+ → 等级 5', () => {
    expect(getAffectionLevel(5000)).toBe(5)
    expect(getAffectionLevel(9999)).toBe(5)
  })
})

describe('actWeight', () => {
  it('亲密度不足时返回 0', () => {
    expect(
      actWeight(10, 3, 3, 5, 1, true),
    ).toBe(0)
  })

  it('不在播放列表返回 0', () => {
    expect(
      actWeight(10, 3, 3, 0, 5, false),
    ).toBe(0)
  })

  it('濒死时只播放濒死动画（currentTier=0, actTier≠0 返回 0）', () => {
    expect(actWeight(10, 3, 0, 0, 5, true)).toBe(0)
    expect(actWeight(10, 1, 0, 0, 5, true)).toBe(0)
  })

  it('非濒死时不播放濒死动画（actTier=0, currentTier≠0 返回 0）', () => {
    expect(actWeight(10, 0, 3, 0, 5, true)).toBe(0)
    expect(actWeight(10, 0, 1, 0, 5, true)).toBe(0)
  })

  it('相同 tier 权重 = baseProb × (1/4)^0 = baseProb', () => {
    expect(actWeight(10, 2, 2, 0, 5, true)).toBe(10)
  })

  it('距离 1 时权重 = baseProb × 0.25', () => {
    expect(actWeight(10, 3, 2, 0, 5, true)).toBeCloseTo(2.5, 5)
  })

  it('距离 2 时权重 = baseProb × 0.0625', () => {
    expect(actWeight(10, 3, 1, 0, 5, true)).toBeCloseTo(0.625, 5)
  })
})

describe('calculateProbabilities', () => {
  it('濒死状态下只产生 tier 0 动画的概率', () => {
    const probs = calculateProbabilities(DEFAULT_ANIMATIONS, makeStats({ health: 0, hunger: 10 }))
    // 所有概率之和应为 1
    const sum = probs.reduce((s, p) => s + p.probability, 0)
    expect(sum).toBeCloseTo(1, 5)
    // 只剩 sick 和 sad(tier 0)
    const states = new Set(probs.filter((p) => p.probability > 0).map((p) => p.state))
    expect(states.has('sick') || states.has('sad')).toBe(true)
  })

  it('高活力高亲密度时概率和为 1', () => {
    const probs = calculateProbabilities(DEFAULT_ANIMATIONS, makeStats({ hunger: 90, affection: 6000 }))
    const sum = probs.reduce((s, p) => s + p.probability, 0)
    expect(sum).toBeCloseTo(1, 5)
  })

  it('亲密度不足时部分动画权重为 0 但概率和仍为 1', () => {
    const probs = calculateProbabilities(DEFAULT_ANIMATIONS, makeStats({ hunger: 70, affection: 50 }))
    const sum = probs.reduce((s, p) => s + p.probability, 0)
    expect(sum).toBeCloseTo(1, 5)
  })
})

describe('pickBehaviorByProbability', () => {
  it('应返回一个有效的 PetState', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const state = pickBehaviorByProbability(DEFAULT_ANIMATIONS, makeStats({ hunger: 90 }))
    expect(['idle', 'walk', 'sit', 'happy', 'sad', 'sick', 'sleep']).toContain(state)
    vi.restoreAllMocks()
  })

  it('濒死时返回 sick 或 sad', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    const state = pickBehaviorByProbability(DEFAULT_ANIMATIONS, makeStats({ health: 0, hunger: 10 }))
    expect(['sick', 'sad']).toContain(state)
    vi.restoreAllMocks()
  })
})

describe('pickPetReaction', () => {
  it('高活力时返回合理的反应', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const state = pickPetReaction(makeStats({ hunger: 90, health: 100 }))
    expect(['idle', 'pet', 'happy', 'sad']).toContain(state)
    vi.restoreAllMocks()
  })

  it('濒死时偏向 sad', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const state = pickPetReaction(makeStats({ health: 0, hunger: 10 }))
    expect(['sad', 'idle', 'pet', 'happy']).toContain(state)
    vi.restoreAllMocks()
  })
})
