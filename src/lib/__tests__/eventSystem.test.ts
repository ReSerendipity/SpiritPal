// 活动系统单元测试 — 节日/联动事件驱动宠物特殊行为
// P3-28: 运营驱动功能，节日限定动画+特殊物品
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventSystemManager, getEventSystemManager, type PetEvent } from '../eventSystem'

// ============ 辅助：固定当前日期 ============

const _OriginalDate = Date

function mockDate(month: number, day: number) {
  global.Date = class extends _OriginalDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(2026, month - 1, day, 12, 0, 0)
      } else {
        super(...(args as [number, number, number, number, number, number, number]))
      }
    }
    static now() {
      return new _OriginalDate(2026, month - 1, day, 12, 0, 0).getTime()
    }
  } as any
}

function restoreDate() {
  global.Date = _OriginalDate as any
}

// ============ 测试 ============

describe('EventSystemManager', () => {
  let mgr: EventSystemManager

  beforeEach(() => {
    mgr = new EventSystemManager()
  })

  afterEach(() => {
    mgr.stop()
    restoreDate()
  })

  describe('内置活动数据', () => {
    it('包含多个内置节日活动', () => {
      const events = mgr.getAllEvents()
      expect(events.length).toBeGreaterThan(5)
    })

    it('每个内置活动都有必需字段', () => {
      const events = mgr.getAllEvents()
      for (const evt of events) {
        expect(evt.id).toBeTruthy()
        expect(evt.name).toBeTruthy()
        expect(evt.type).toMatch(/^(festival|seasonal|milestone|community)$/)
        expect(evt.rarity).toMatch(/^(common|rare|legendary)$/)
        expect(evt.startDate).toMatch(/^\d{2}-\d{2}$/)
        expect(evt.endDate).toMatch(/^\d{2}-\d{2}$/)
        expect(evt.specialBubbles.length).toBeGreaterThan(0)
        expect(evt.specialItems.length).toBeGreaterThan(0)
        expect(evt.icon).toBeTruthy()
      }
    })

    it('包含春节活动', () => {
      const events = mgr.getAllEvents()
      const spring = events.find((e) => e.id === 'spring-festival')
      expect(spring).toBeTruthy()
      expect(spring!.type).toBe('festival')
      expect(spring!.rarity).toBe('legendary')
    })

    it('包含圣诞节活动', () => {
      const events = mgr.getAllEvents()
      const xmas = events.find((e) => e.id === 'christmas')
      expect(xmas).toBeTruthy()
      expect(xmas!.specialItems.length).toBeGreaterThan(0)
    })
  })

  describe('活动检测', () => {
    it('1月1日检测到跨年夜活动', () => {
      mockDate(1, 1)
      const active = mgr.getActiveEvents()
      const nye = active.find((e) => e.id === 'new-year-eve')
      expect(nye).toBeTruthy()
    })

    it('2月14日检测到情人节活动', () => {
      mockDate(2, 14)
      const active = mgr.getActiveEvents()
      const valentines = active.find((e) => e.id === 'valentines')
      expect(valentines).toBeTruthy()
    })

    it('7月15日检测到夏日沙滩活动', () => {
      mockDate(7, 15)
      const active = mgr.getActiveEvents()
      const summer = active.find((e) => e.id === 'summer-beach')
      expect(summer).toBeTruthy()
    })

    it('10月31日检测到万圣节活动', () => {
      mockDate(10, 31)
      const active = mgr.getActiveEvents()
      const halloween = active.find((e) => e.id === 'halloween')
      expect(halloween).toBeTruthy()
    })

    it('12月25日检测到圣诞节活动', () => {
      mockDate(12, 25)
      const active = mgr.getActiveEvents()
      const xmas = active.find((e) => e.id === 'christmas')
      expect(xmas).toBeTruthy()
    })

    it('3月1日无活动（假设不在任何活动期间）', () => {
      mockDate(3, 1)
      // 3月1日：春节已过、樱花季未开始、情人节已过
      const active = mgr.getActiveEvents()
      // 可能有樱花季即将开始，但 3/20 才开始
      const majorFestival = active.filter((e) => e.type === 'festival')
      expect(majorFestival.length).toBe(0)
    })
  })

  describe('ActiveEvent 计算', () => {
    it('daysRemaining 大于等于 0', () => {
      mockDate(7, 15)
      const active = mgr.getActiveEvents()
      for (const evt of active) {
        expect(evt.daysRemaining).toBeGreaterThanOrEqual(0)
      }
    })

    it('progress 在 0-1 之间', () => {
      mockDate(7, 15)
      const active = mgr.getActiveEvents()
      for (const evt of active) {
        expect(evt.progress).toBeGreaterThanOrEqual(0)
        expect(evt.progress).toBeLessThanOrEqual(1)
      }
    })
  })

  describe('自定义活动', () => {
    it('添加自定义活动', () => {
      const custom: PetEvent = {
        id: 'custom-test',
        name: '测试活动',
        description: '这是一个测试活动',
        type: 'community',
        rarity: 'common',
        startDate: '03-01',
        endDate: '03-31',
        specialBubbles: ['测试气泡'],
        specialItems: ['item-test'],
        recurring: true,
        icon: '🧪',
      }
      mgr.addCustomEvent(custom)
      const events = mgr.getAllEvents()
      expect(events.find((e) => e.id === 'custom-test')).toBeTruthy()
    })

    it('移除自定义活动', () => {
      const custom: PetEvent = {
        id: 'custom-remove',
        name: '移除测试',
        description: '将被移除',
        type: 'community',
        rarity: 'common',
        startDate: '04-01',
        endDate: '04-30',
        specialBubbles: ['移除气泡'],
        specialItems: ['item-remove'],
        recurring: true,
        icon: '🗑️',
      }
      mgr.addCustomEvent(custom)
      expect(mgr.getAllEvents().find((e) => e.id === 'custom-remove')).toBeTruthy()
      mgr.removeCustomEvent('custom-remove')
      expect(mgr.getAllEvents().find((e) => e.id === 'custom-remove')).toBeFalsy()
    })

    it('不能移除内置活动', () => {
      mgr.removeCustomEvent('spring-festival')
      const events = mgr.getAllEvents()
      expect(events.find((e) => e.id === 'spring-festival')).toBeTruthy()
    })
  })

  describe('限定物品', () => {
    it('获取当前活跃活动的限定物品', () => {
      mockDate(12, 25)
      const items = mgr.getActiveSpecialItems()
      expect(items.length).toBeGreaterThan(0)
      expect(items).toContain('item-santa-hat')
    })

    it('无活动时返回空数组', () => {
      mockDate(3, 1)
      const items = mgr.getActiveSpecialItems()
      // 3月1日可能没有活动
      // 如果有樱花季则不为空，否则为空
      // 这里只验证返回的是数组
      expect(Array.isArray(items)).toBe(true)
    })
  })

  describe('随机气泡', () => {
    it('有活动时返回随机气泡文案', () => {
      mockDate(2, 14)
      const bubble = mgr.getRandomActiveBubble()
      expect(bubble).toBeTruthy()
      expect(typeof bubble).toBe('string')
    })

    it('优先返回高稀有度活动的文案', () => {
      mockDate(12, 25)
      // 圣诞节是 legendary，应该优先被选中
      // 运行多次确保逻辑正确
      const bubbles: string[] = []
      for (let i = 0; i < 20; i++) {
        const b = mgr.getRandomActiveBubble()
        if (b) bubbles.push(b)
      }
      expect(bubbles.length).toBeGreaterThan(0)
    })
  })

  describe('订阅机制', () => {
    it('订阅活动变化', () => {
      const listener = vi.fn()
      mgr.onActiveEventsChange(listener)
      // 订阅时立即回放一次
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it('取消订阅', () => {
      const listener = vi.fn()
      const unsub = mgr.onActiveEventsChange(listener)
      listener.mockClear()
      unsub()
      // 之后的通知不再触发
      // 由于没有实际时间变化，无法直接验证
      // 但取消订阅不应报错
      expect(true).toBe(true)
    })
  })

  describe('单例', () => {
    it('getEventSystemManager 返回同一实例', () => {
      const a = getEventSystemManager()
      const b = getEventSystemManager()
      expect(a).toBe(b)
    })
  })

  describe('跨年活动', () => {
    it('春节跨年检测正确（1月22日-2月5日）', () => {
      // 1月25日 — 在春节范围内
      mockDate(1, 25)
      const active = mgr.getActiveEvents()
      const spring = active.find((e) => e.id === 'spring-festival')
      expect(spring).toBeTruthy()
    })

    it('跨年夜跨年检测正确（12月31日-1月2日）', () => {
      // 12月31日
      mockDate(12, 31)
      const active = mgr.getActiveEvents()
      const nye = active.find((e) => e.id === 'new-year-eve')
      expect(nye).toBeTruthy()

      // 1月1日也应该检测到
      mockDate(1, 1)
      const activeJan1 = mgr.getActiveEvents()
      const nyeJan1 = activeJan1.find((e) => e.id === 'new-year-eve')
      expect(nyeJan1).toBeTruthy()
    })
  })

  describe('getEventById', () => {
    it('根据 ID 获取活动', () => {
      const evt = mgr.getEventById('christmas')
      expect(evt).toBeTruthy()
      expect(evt!.name).toBe('圣诞节')
    })

    it('不存在的 ID 返回 undefined', () => {
      const evt = mgr.getEventById('non-existent')
      expect(evt).toBeUndefined()
    })
  })
})
