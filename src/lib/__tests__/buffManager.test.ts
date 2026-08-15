// buffManager 单元测试 — BuffAdd/BuffAlt 类型、叠加规则、过期移除
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { BuffManager, getBuffManager } from '../buffManager'
import type { BuffConfig } from '../types'

function makeBuff(overrides: Partial<BuffConfig> = {}): BuffConfig {
  return {
    effect: 'hp',
    value: 5,
    interval: 10,
    expiration: 60,
    description: 'test buff',
    ...overrides,
  }
}

describe('BuffManager', () => {
  let mgr: BuffManager

  beforeEach(() => {
    vi.useFakeTimers()
    mgr = new BuffManager()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('applyBuff / getActiveBuffs', () => {
    it('施加 Buff 后加入活跃列表', () => {
      const id = mgr.applyBuff(makeBuff())
      expect(id).toBeTruthy()
      expect(mgr.getActiveBuffs().length).toBe(1)
    })

    it('多次施加同一 Buff 独立叠加', () => {
      mgr.applyBuff(makeBuff())
      mgr.applyBuff(makeBuff())
      mgr.applyBuff(makeBuff())
      expect(mgr.getActiveBuffs().length).toBe(3)
    })

    it('施加 Buff 后启动 tick 计时器', () => {
      const setIntervalSpy = vi.spyOn(window, 'setInterval')
      mgr.applyBuff(makeBuff())
      expect(setIntervalSpy).toHaveBeenCalled()
    })
  })

  describe('removeBuff', () => {
    it('按 id 移除指定 Buff', () => {
      const id1 = mgr.applyBuff(makeBuff())
      const id2 = mgr.applyBuff(makeBuff())
      mgr.removeBuff(id1)
      expect(mgr.getActiveBuffs().length).toBe(1)
      expect(mgr.getActiveBuffs()[0].id).toBe(id2)
    })

    it('移除最后一个 Buff 时停止 tick', () => {
      const clearIntervalSpy = vi.spyOn(window, 'clearInterval')
      const id = mgr.applyBuff(makeBuff())
      mgr.removeBuff(id)
      expect(clearIntervalSpy).toHaveBeenCalled()
    })
  })

  describe('isHpStopped / isFvStopped', () => {
    it('HP_stop Buff 阻止 HP 衰减', () => {
      expect(mgr.isHpStopped()).toBe(false)
      mgr.applyBuff(makeBuff({ effect: 'HP_stop', expiration: 60 }))
      expect(mgr.isHpStopped()).toBe(true)
    })

    it('FV_stop Buff 阻止 FV 衰减', () => {
      expect(mgr.isFvStopped()).toBe(false)
      mgr.applyBuff(makeBuff({ effect: 'FV_stop', expiration: 60 }))
      expect(mgr.isFvStopped()).toBe(true)
    })

    it('永久 Buff（无 expiration）始终生效', () => {
      mgr.applyBuff(makeBuff({ effect: 'HP_stop' }))
      expect(mgr.isHpStopped()).toBe(true)
    })

    it('过期后 HP_stop 失效', () => {
      mgr.applyBuff(makeBuff({ effect: 'HP_stop', expiration: 10 }))
      // 推进 11 秒
      for (let i = 0; i < 11; i++) mgr.tick()
      expect(mgr.isHpStopped()).toBe(false)
    })
  })

  describe('tick / 效果触发', () => {
    it('BuffAdd 类型到达 interval 时调用 effectHandler', () => {
      const handler = vi.fn()
      mgr.setEffectHandler(handler)
      mgr.applyBuff(makeBuff({ effect: 'hp', value: 5, interval: 3, expiration: 60 }))
      // 推进 3 秒
      for (let i = 0; i < 3; i++) mgr.tick()
      expect(handler).toHaveBeenCalledWith('hp', 5)
    })

    it('coin 类型也触发效果', () => {
      const handler = vi.fn()
      mgr.setEffectHandler(handler)
      mgr.applyBuff(makeBuff({ effect: 'coin', value: 10, interval: 5, expiration: 30 }))
      for (let i = 0; i < 5; i++) mgr.tick()
      expect(handler).toHaveBeenCalledWith('coin', 10)
    })

    it('fv 类型也触发效果', () => {
      const handler = vi.fn()
      mgr.setEffectHandler(handler)
      mgr.applyBuff(makeBuff({ effect: 'fv', value: 2, interval: 2, expiration: 20 }))
      for (let i = 0; i < 2; i++) mgr.tick()
      expect(handler).toHaveBeenCalledWith('fv', 2)
    })

    it('HP_stop / FV_stop 不触发 effectHandler', () => {
      const handler = vi.fn()
      mgr.setEffectHandler(handler)
      mgr.applyBuff(makeBuff({ effect: 'HP_stop', expiration: 60 }))
      for (let i = 0; i < 5; i++) mgr.tick()
      expect(handler).not.toHaveBeenCalled()
    })

    it('过期 Buff 被自动移除', () => {
      mgr.applyBuff(makeBuff({ effect: 'hp', value: 5, interval: 100, expiration: 5 }))
      expect(mgr.getActiveBuffs().length).toBe(1)
      for (let i = 0; i < 6; i++) mgr.tick()
      expect(mgr.getActiveBuffs().length).toBe(0)
    })

    it('永久 Buff（expiration=-1）不会被移除', () => {
      // 注意：makeBuff 默认 expiration=60，需显式传 -1 才是永久 Buff
      // applyBuff 中 remaining = config.expiration ?? -1，传 -1 后 remaining=-1（永久存活）
      mgr.applyBuff(makeBuff({ effect: 'hp', value: 5, interval: 100, expiration: -1 }))
      for (let i = 0; i < 100; i++) mgr.tick()
      expect(mgr.getActiveBuffs().length).toBe(1)
    })
  })

  describe('onBuffsChange', () => {
    it('施加/移除 Buff 时通知监听器', () => {
      const fn = vi.fn()
      mgr.onBuffsChange(fn)
      const id = mgr.applyBuff(makeBuff())
      expect(fn).toHaveBeenCalled()
      fn.mockClear()
      mgr.removeBuff(id)
      expect(fn).toHaveBeenCalled()
    })

    it('取消订阅后不再触发', () => {
      const fn = vi.fn()
      const unsub = mgr.onBuffsChange(fn)
      unsub()
      mgr.applyBuff(makeBuff())
      expect(fn).not.toHaveBeenCalled()
    })
  })

  describe('getRemainingTime', () => {
    it('返回剩余秒数', () => {
      const id = mgr.applyBuff(makeBuff({ expiration: 60 }))
      expect(mgr.getRemainingTime(id)).toBe(60)
      mgr.tick()
      expect(mgr.getRemainingTime(id)).toBe(59)
    })

    it('未知 id 返回 0', () => {
      expect(mgr.getRemainingTime('unknown')).toBe(0)
    })
  })

  describe('clear', () => {
    it('清空所有 Buff', () => {
      mgr.applyBuff(makeBuff())
      mgr.applyBuff(makeBuff())
      mgr.clear()
      expect(mgr.getActiveBuffs().length).toBe(0)
    })
  })

  describe('serialize / deserialize', () => {
    it('序列化后反序列化应恢复状态', () => {
      const id1 = mgr.applyBuff(makeBuff({ expiration: 60 }))
      const id2 = mgr.applyBuff(makeBuff({ effect: 'fv', value: 3, expiration: 30 }))

      const data = mgr.serialize()
      expect(data.length).toBe(2)

      const mgr2 = new BuffManager()
      mgr2.deserialize(data)
      expect(mgr2.getActiveBuffs().length).toBe(2)
      expect(mgr2.getRemainingTime(id1)).toBe(60)
      expect(mgr2.getRemainingTime(id2)).toBe(30)
    })
  })
})

describe('getBuffManager 单例', () => {
  it('同一角色 ID 返回同一实例', () => {
    const a = getBuffManager('doro')
    const b = getBuffManager('doro')
    expect(a).toBe(b)
  })

  it('不同角色 ID 返回不同实例', () => {
    const a = getBuffManager('doro')
    const b = getBuffManager('feibi')
    expect(a).not.toBe(b)
  })
})
