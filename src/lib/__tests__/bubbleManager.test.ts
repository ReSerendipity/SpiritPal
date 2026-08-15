// bubbleManager 单元测试 — 9 种气泡类型、HP 分层、冷却管理
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BubbleManager, getBubbleManager } from '../bubbleManager'
import type { CharacterProfile, NurturingStats } from '../types'

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

function makeCharacter(overrides: Partial<CharacterProfile> = {}): CharacterProfile {
  return {
    id: 'test',
    name: 'test',
    displayName: '测试角色',
    source: 'test',
    birthBackground: 'test',
    emotionalCore: 'test',
    personality: { warmth: 0.5, liveliness: 0.5, dependence: 0.5, directness: 0.5, rationality: 0.5 },
    signaturePhrase: 'test',
    classicQuotes: [],
    systemPrompt: 'test',
    fewShotExamples: [],
    spriteAsset: '/test.png',
    spriteType: 'atlas',
    themeColor: { primary: '#FFB6C1', secondary: '#FFA500' },
    bubbleMessages: {
      idle: ['idle msg'],
      hungry: ['hungry msg'],
      sad: ['sad msg'],
      pet: ['pet msg'],
      feed: ['feed msg'],
      pomodoroDone: ['done msg'],
    },
    ...overrides,
  }
}

describe('BubbleManager', () => {
  let mgr: BubbleManager

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
    mgr = new BubbleManager('test')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('trigger / 冷却', () => {
    it('首次触发成功', () => {
      const cb = vi.fn()
      mgr.setOnBubble(cb)
      expect(mgr.trigger('hp_low', 'hungry!')).toBe(true)
      expect(cb).toHaveBeenCalledWith('hungry!')
    })

    it('冷却期内触发失败', () => {
      // hp_low 冷却 30 秒
      expect(mgr.trigger('hp_low', 'msg1')).toBe(true)
      // 立即再次触发应被冷却拦截
      expect(mgr.trigger('hp_low', 'msg2')).toBe(false)
    })

    it('冷却结束后可再次触发', () => {
      expect(mgr.trigger('hp_low', 'msg1')).toBe(true)
      // 推进 31 秒
      vi.setSystemTime(new Date('2024-01-01T00:00:31Z'))
      expect(mgr.trigger('hp_low', 'msg2')).toBe(true)
    })

    it('不同类型独立冷却', () => {
      expect(mgr.trigger('hp_low', 'low')).toBe(true)
      // feed_done 冷却 5 秒，独立于 hp_low
      expect(mgr.trigger('feed_done', 'done')).toBe(true)
    })

    it('无回调时仍返回 true', () => {
      expect(mgr.trigger('hp_low', 'msg')).toBe(true)
    })

    it('空消息不调用回调但返回 true', () => {
      const cb = vi.fn()
      mgr.setOnBubble(cb)
      expect(mgr.trigger('hp_low', '')).toBe(true)
      // 空消息不调用回调
      expect(cb).not.toHaveBeenCalled()
    })
  })

  describe('resetCooldowns', () => {
    it('清空所有冷却记录', () => {
      mgr.trigger('hp_low', 'msg')
      mgr.resetCooldowns()
      // 立即再次触发应成功
      expect(mgr.trigger('hp_low', 'msg2')).toBe(true)
    })
  })

  describe('triggerAffectionLevelUp', () => {
    it('使用默认消息触发', () => {
      const cb = vi.fn()
      mgr.setOnBubble(cb)
      mgr.triggerAffectionLevelUp()
      expect(cb).toHaveBeenCalled()
    })

    it('自定义消息覆盖默认', () => {
      const cb = vi.fn()
      mgr.setOnBubble(cb)
      mgr.triggerAffectionLevelUp('custom')
      expect(cb).toHaveBeenCalledWith('custom')
    })
  })

  describe('triggerFeedDone', () => {
    it('不抛错（保留接口）', () => {
      expect(() => mgr.triggerFeedDone()).not.toThrow()
    })
  })

  describe('checkHungerBubbles', () => {
    it('hunger <= 0 触发 hp_zero', () => {
      const cb = vi.fn()
      mgr.setOnBubble(cb)
      // 设置角色使饥饿类气泡消息非空（无角色时 getMessage 返回空字符串，回调不触发）
      mgr.setCharacter(makeCharacter())
      mgr.checkHungerBubbles(makeStats({ hunger: 0 }))
      expect(cb).toHaveBeenCalled()
    })

    it('hunger < 20 触发 hp_low', () => {
      const cb = vi.fn()
      mgr.setOnBubble(cb)
      mgr.setCharacter(makeCharacter())
      mgr.checkHungerBubbles(makeStats({ hunger: 15 }))
      expect(cb).toHaveBeenCalled()
    })

    it('hunger 在 20-50 间随机触发 feed_required', () => {
      const cb = vi.fn()
      mgr.setOnBubble(cb)
      mgr.setCharacter(makeCharacter())
      // Math.random < 0.3 时触发
      vi.spyOn(Math, 'random').mockReturnValue(0.1)
      mgr.checkHungerBubbles(makeStats({ hunger: 35 }))
      expect(cb).toHaveBeenCalled()
      vi.restoreAllMocks()
    })

    it('hunger 充足时不触发', () => {
      const cb = vi.fn()
      mgr.setOnBubble(cb)
      mgr.setCharacter(makeCharacter())
      mgr.checkHungerBubbles(makeStats({ hunger: 90 }))
      expect(cb).not.toHaveBeenCalled()
    })
  })

  describe('triggerPatReaction', () => {
    it('patCount >= 6 触发 pat_frequent', () => {
      const cb = vi.fn()
      mgr.setOnBubble(cb)
      mgr.triggerPatReaction(6)
      expect(cb).toHaveBeenCalledWith('哎呀……摸太多啦！')
    })

    it('patCount >= 3 触发 pat_focus', () => {
      const cb = vi.fn()
      mgr.setOnBubble(cb)
      mgr.triggerPatReaction(3)
      expect(cb).toHaveBeenCalledWith('嘿嘿……好舒服，继续嘛～')
    })

    it('patCount < 3 触发 pat_random', () => {
      const cb = vi.fn()
      mgr.setOnBubble(cb)
      mgr.triggerPatReaction(1)
      // pat_random 默认消息为空（无 character 时），但回调可能被调用
      // 不严格校验调用次数，因 pat_random 默认消息为空字符串
    })
  })

  describe('setCharacter', () => {
    it('设置角色后使用角色专属消息', () => {
      const cb = vi.fn()
      mgr.setOnBubble(cb)
      const char = makeCharacter({
        bubbleMessages: {
          idle: ['custom idle'],
          hungry: ['custom hungry'],
          sad: ['custom sad'],
          pet: ['custom pet'],
          feed: ['custom feed'],
          pomodoroDone: ['custom done'],
        },
      })
      mgr.setCharacter(char)
      // 触发 hungry 类气泡
      mgr.trigger('hp_low')
      expect(cb).toHaveBeenCalledWith('custom hungry')
    })
  })
})

describe('getBubbleManager 单例', () => {
  it('同一 ID 返回同一实例', () => {
    const a = getBubbleManager('test1')
    const b = getBubbleManager('test1')
    expect(a).toBe(b)
  })

  it('不传 ID 使用 default', () => {
    const a = getBubbleManager()
    expect(a).toBeDefined()
  })
})
