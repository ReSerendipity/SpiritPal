// interactionCounter 单元测试 — 渐进式情绪计数器
import { describe, it, expect, beforeEach } from 'vitest'
import { InteractionCounter } from '../interactionCounter'

describe('InteractionCounter', () => {
  let counter: InteractionCounter

  beforeEach(() => {
    counter = new InteractionCounter()
  })

  describe('bump / getCount', () => {
    it('初始 count = 0', () => {
      expect(counter.getCount()).toBe(0)
    })

    it('bump 后 count +1', () => {
      counter.bump()
      counter.bump()
      expect(counter.getCount()).toBe(2)
    })

    it('bump 后开始计时（不再 paused）', () => {
      expect(counter.isPaused()).toBe(true)
      counter.bump()
      expect(counter.isPaused()).toBe(false)
    })
  })

  describe('getEmotion', () => {
    it('count < 3 → idle', () => {
      counter.bump()
      counter.bump()
      expect(counter.getEmotion()).toBe('idle')
    })

    it('count >= 3 → curious', () => {
      counter.bump()
      counter.bump()
      counter.bump()
      expect(counter.getEmotion()).toBe('curious')
    })

    it('count >= 6 → annoyed', () => {
      for (let i = 0; i < 6; i++) counter.bump()
      expect(counter.getEmotion()).toBe('annoyed')
    })
  })

  describe('getEmotionAndCheckChange', () => {
    it('情绪变化时返回新情绪', () => {
      counter.bump()
      counter.bump()
      counter.bump()
      expect(counter.getEmotionAndCheckChange()).toBe('curious')
    })

    it('情绪未变化时返回 null', () => {
      // lastEmotion 初始为 'idle'，bump 后情绪仍为 'idle'（无变化）→ 返回 null
      counter.bump()
      expect(counter.getEmotionAndCheckChange()).toBeNull()
      // 再次 bump，情绪仍是 idle，仍无变化 → null
      counter.bump()
      expect(counter.getEmotionAndCheckChange()).toBeNull()
    })
  })

  describe('tick / reset', () => {
    it('paused 时 tick 不累加时间', () => {
      counter.tick(1000)
      expect(counter.getCount()).toBe(0)
    })

    it('超过 resetTime 后自动重置', () => {
      const c = new InteractionCounter(30_000, 3, 6)
      c.bump()
      c.bump()
      expect(c.getCount()).toBe(2)
      // 累计 31 秒，超过 30 秒阈值
      c.tick(31_000)
      expect(c.getCount()).toBe(0)
      expect(c.isPaused()).toBe(true)
    })

    it('未超时不会重置', () => {
      const c = new InteractionCounter(30_000, 3, 6)
      c.bump()
      c.tick(10_000)
      expect(c.getCount()).toBe(1)
    })

    it('手动 reset 清空所有状态', () => {
      counter.bump()
      counter.bump()
      counter.reset()
      expect(counter.getCount()).toBe(0)
      expect(counter.isPaused()).toBe(true)
    })
  })

  describe('pause / resume', () => {
    it('pause 暂停计时但不重置 count', () => {
      counter.bump()
      counter.bump()
      counter.pause()
      expect(counter.isPaused()).toBe(true)
      expect(counter.getCount()).toBe(2)
    })

    it('resume 在 count > 0 时恢复计时', () => {
      counter.bump()
      counter.pause()
      counter.resume()
      expect(counter.isPaused()).toBe(false)
    })

    it('resume 在 count = 0 时保持 paused', () => {
      counter.resume()
      expect(counter.isPaused()).toBe(true)
    })
  })

  describe('setResetTime', () => {
    it('设置重置时间', () => {
      counter.setResetTime(5000)
      counter.bump()
      counter.tick(6000)
      expect(counter.getCount()).toBe(0)
    })

    it('设置负数被裁剪为 0', () => {
      counter.setResetTime(-100)
      counter.bump()
      // 任何时间都会立刻超时
      counter.tick(1)
      expect(counter.getCount()).toBe(0)
    })
  })
})
