// animationConfig 单元测试 — 动画目录、状态机优先级、冷却机制
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  ANIMATION_CATALOG,
  ANIMATION_COUNT,
  getAnimationById,
  animationIdToPetState,
  animationIdToMotionGroup,
  AnimationStateMachine,
  getAnimationStateMachine,
  type AnimationId,
  type AnimationContext,
} from '../animationConfig'

function makeCtx(overrides: Partial<AnimationContext> = {}): AnimationContext {
  return {
    petState: 'idle',
    hp: 80,
    mood: 70,
    health: 100,
    affection: 1000,
    level: 10,
    weather: 'normal',
    workState: 'idle',
    time: 12,
    lastInteraction: 0,
    musicPlaying: false,
    ...overrides,
  }
}

describe('ANIMATION_CATALOG', () => {
  it('动画数量 >= 50', () => {
    expect(ANIMATION_COUNT).toBeGreaterThanOrEqual(50)
    expect(ANIMATION_CATALOG.length).toBeGreaterThanOrEqual(50)
  })

  it('每个动画定义字段完整', () => {
    for (const anim of ANIMATION_CATALOG) {
      expect(typeof anim.id).toBe('string')
      expect(typeof anim.name).toBe('string')
      expect(typeof anim.category).toBe('string')
      expect(Array.isArray(anim.triggers)).toBe(true)
      expect(typeof anim.duration).toBe('number')
      expect(anim.duration).toBeGreaterThan(0)
      expect(typeof anim.priority).toBe('number')
      expect(typeof anim.spriteState).toBe('string')
      expect(typeof anim.motionGroup).toBe('string')
    }
  })

  it('动画 id 唯一', () => {
    const ids = ANIMATION_CATALOG.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('包含 6 个动画类别', () => {
    const categories = new Set(ANIMATION_CATALOG.map((a) => a.category))
    expect(categories.has('basic')).toBe(true)
    expect(categories.has('emotion')).toBe(true)
    expect(categories.has('interaction')).toBe(true)
    expect(categories.has('nurture')).toBe(true)
    expect(categories.has('environment')).toBe(true)
    expect(categories.has('special')).toBe(true)
  })

  it('基础状态动画 >= 10 种', () => {
    const basic = ANIMATION_CATALOG.filter((a) => a.category === 'basic')
    expect(basic.length).toBeGreaterThanOrEqual(10)
  })

  it('情绪表现动画 >= 12 种', () => {
    const emotion = ANIMATION_CATALOG.filter((a) => a.category === 'emotion')
    expect(emotion.length).toBeGreaterThanOrEqual(12)
  })
})

describe('getAnimationById', () => {
  it('按 id 返回动画定义', () => {
    const anim = getAnimationById('idle')
    expect(anim.id).toBe('idle')
    expect(anim.name).toBe('待机')
  })

  it('未知 id 回退到 idle', () => {
    const anim = getAnimationById('nonexistent' as AnimationId)
    expect(anim.id).toBe('idle')
  })
})

describe('animationIdToPetState / animationIdToMotionGroup', () => {
  it('返回 spriteState', () => {
    expect(animationIdToPetState('sleep')).toBe('sleep')
    expect(animationIdToPetState('eat')).toBe('eat')
    expect(animationIdToPetState('happy')).toBe('happy')
  })

  it('返回 motionGroup', () => {
    expect(animationIdToMotionGroup('idle')).toBe('Idle')
    expect(animationIdToMotionGroup('sleep')).toBe('Sleep')
  })
})

describe('AnimationStateMachine 冷却机制', () => {
  let sm: AnimationStateMachine

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
    sm = new AnimationStateMachine()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('未播放过的动画不在冷却中', () => {
    expect(sm.isOnCooldown('idle')).toBe(false)
  })

  it('标记播放后进入冷却', () => {
    sm.markPlayed('happy')
    expect(sm.isOnCooldown('happy')).toBe(true)
  })

  it('30 秒后冷却结束', () => {
    sm.markPlayed('happy')
    expect(sm.isOnCooldown('happy')).toBe(true)
    vi.setSystemTime(new Date('2024-01-01T00:00:31Z'))
    expect(sm.isOnCooldown('happy')).toBe(false)
  })

  it('resetCooldowns 清空所有冷却', () => {
    sm.markPlayed('happy')
    sm.markPlayed('sad')
    sm.resetCooldowns()
    expect(sm.isOnCooldown('happy')).toBe(false)
    expect(sm.isOnCooldown('sad')).toBe(false)
  })
})

describe('AnimationStateMachine.select 优先级', () => {
  let sm: AnimationStateMachine

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'))
    sm = new AnimationStateMachine()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('交互响应优先级最高', () => {
    const now = Date.now()
    const ctx = makeCtx({
      lastInteraction: now - 1000, // 1 秒前刚交互
      interactionType: 'pet_head',
      hp: 80,
      mood: 90,
      health: 100,
      time: 12,
    })
    expect(sm.select(ctx)).toBe('pet_head')
  })

  it('健康为 0 时返回 sick', () => {
    const ctx = makeCtx({ health: 0, time: 12 })
    expect(sm.select(ctx)).toBe('sick')
  })

  it('饥饿时返回 hungry_starving', () => {
    const ctx = makeCtx({ hp: 10, health: 100, time: 12 })
    expect(sm.select(ctx)).toBe('hungry_starving')
  })

  it('天气感知：雨天返回 rain_umbrella', () => {
    const ctx = makeCtx({ weather: 'umbrella', time: 12, hp: 80, mood: 70, health: 100 })
    expect(sm.select(ctx)).toBe('rain_umbrella')
  })

  it('音乐播放时返回 music_sway', () => {
    const ctx = makeCtx({ musicPlaying: true, time: 12, hp: 80, mood: 70, health: 100, weather: 'normal' })
    expect(sm.select(ctx)).toBe('music_sway')
  })

  it('夜间（0-8点）返回 sleep', () => {
    // 注意：情绪动画优先级高于基础状态，需先冷却 mood=70 对应的情绪动画
    // mood=70 → candidates [happy, laugh, giggle]，全部冷却后才会走 pickBasic
    const now = Date.now()
    sm.markPlayed('happy', now)
    sm.markPlayed('laugh', now)
    sm.markPlayed('giggle', now)
    const ctx = makeCtx({ time: 3, hp: 80, mood: 70, health: 100 })
    expect(sm.select(ctx)).toBe('sleep')
  })

  it('冷却中的动画会被跳过降级', () => {
    const now = Date.now()
    // 先标记 sick 在冷却中
    sm.markPlayed('sick', now)
    // health=0 但 sick 冷却中 → 应跳过 sick，进入其他逻辑
    const ctx = makeCtx({ health: 0, hp: 10, time: 12 })
    // sick 冷却，hungry_starving 也可能冷却，但 hp=10 应触发 hungry_starving
    // 标记 hungry_starving 也在冷却
    sm.markPlayed('hungry_starving', now)
    // 两者都冷却，应回退到情绪或基础
    const result = sm.select(ctx)
    expect(result).not.toBe('sick')
    expect(result).not.toBe('hungry_starving')
  })
})

describe('getAnimationStateMachine 单例', () => {
  it('多次调用返回同一实例', () => {
    const a = getAnimationStateMachine()
    const b = getAnimationStateMachine()
    expect(a).toBe(b)
  })
})
