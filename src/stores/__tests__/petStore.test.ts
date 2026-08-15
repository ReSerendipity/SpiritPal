// petStore 单元测试 — 四维数值、经验等级、金币、背包、装饰品
import { describe, it, expect, beforeEach } from 'vitest'
import { usePetStore, computeOfflineDecay } from '../petStore'
import type { InventoryItem } from '../../lib/types'

function makeItem(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'test-food',
    name: '测试食物',
    icon: '🍔',
    type: 'food',
    price: 10,
    count: 1,
    hungerRestore: 20,
    moodRestore: 10,
    ...overrides,
  }
}

describe('petStore', () => {
  beforeEach(() => {
    // 重置到初始状态
    usePetStore.setState({
      stats: {},
      sharedCoins: 100,
      currentCharacterId: 'doro',
      inventory: [],
      position: null,
      wornDecorations: {},
      background: { type: 'none' },
    })
    localStorage.clear()
  })

  describe('initCharacter', () => {
    it('为新角色创建默认养成数据', () => {
      usePetStore.getState().initCharacter('doro')
      const stats = usePetStore.getState().stats['doro']
      expect(stats).toBeDefined()
      expect(stats.hunger).toBe(80)
      expect(stats.mood).toBe(80)
      expect(stats.health).toBe(80)
      expect(stats.level).toBe(1)
      expect(stats.exp).toBe(0)
    })

    it('已存在的角色不覆盖数据', () => {
      usePetStore.getState().initCharacter('doro')
      // 修改数据
      usePetStore.getState().addExp(50)
      const expBefore = usePetStore.getState().stats['doro'].exp

      // 再次 init
      usePetStore.getState().initCharacter('doro')
      expect(usePetStore.getState().stats['doro'].exp).toBe(expBefore)
    })
  })

  describe('addExp', () => {
    it('增加经验值', () => {
      usePetStore.getState().initCharacter('doro')
      usePetStore.getState().addExp(50)
      expect(usePetStore.getState().stats['doro'].exp).toBe(50)
    })

    it('经验达到阈值时升级', () => {
      usePetStore.getState().initCharacter('doro')
      // Lv1 → Lv2 需要 100 exp
      usePetStore.getState().addExp(100)
      const stats = usePetStore.getState().stats['doro']
      expect(stats.level).toBe(2)
      expect(stats.exp).toBe(0)
    })

    it('升级时奖励金币', () => {
      usePetStore.getState().initCharacter('doro')
      const coinsBefore = usePetStore.getState().sharedCoins
      usePetStore.getState().addExp(100) // 升到 Lv2
      expect(usePetStore.getState().sharedCoins).toBe(coinsBefore + 200) // 100 * level(2)
    })

    it('达到最大等级后经验归零', () => {
      usePetStore.getState().initCharacter('doro')
      // 手动设置接近最大等级
      usePetStore.setState((state) => ({
        stats: {
          ...state.stats,
          doro: { ...state.stats['doro'], level: 256, exp: 0 },
        },
      }))
      usePetStore.getState().addExp(100)
      expect(usePetStore.getState().stats['doro'].level).toBe(256)
      expect(usePetStore.getState().stats['doro'].exp).toBe(0)
    })
  })

  describe('feed', () => {
    it('有足够金币时喂食成功', () => {
      usePetStore.getState().initCharacter('doro')
      const food = makeItem({ price: 10, hungerRestore: 20, moodRestore: 5 })
      usePetStore.getState().feed(food)
      const stats = usePetStore.getState().stats['doro']
      expect(usePetStore.getState().sharedCoins).toBe(90)
      expect(stats.hunger).toBe(100) // 80 + 20, clamped at 100
    })

    it('金币不足时不执行', () => {
      usePetStore.getState().initCharacter('doro')
      usePetStore.setState({ sharedCoins: 5 })
      const food = makeItem({ price: 10 })
      const coinsBefore = usePetStore.getState().sharedCoins
      usePetStore.getState().feed(food)
      expect(usePetStore.getState().sharedCoins).toBe(coinsBefore)
    })
  })

  describe('play / bathe / pet / click', () => {
    beforeEach(() => {
      usePetStore.getState().initCharacter('doro')
    })

    it('play 增加心情降低饱食度', () => {
      usePetStore.getState().play()
      const stats = usePetStore.getState().stats['doro']
      expect(stats.mood).toBeGreaterThan(80)
      expect(stats.hunger).toBeLessThan(80)
    })

    it('bathe 增加健康', () => {
      // 先降低健康
      usePetStore.setState((s) => ({ stats: { ...s.stats, doro: { ...s.stats['doro'], health: 50 } } }))
      usePetStore.getState().bathe()
      expect(usePetStore.getState().stats['doro'].health).toBe(80) // 50 + 30
    })

    it('pet 增加亲密度', () => {
      const affBefore = usePetStore.getState().stats['doro'].affection
      usePetStore.getState().pet()
      expect(usePetStore.getState().stats['doro'].affection).toBeGreaterThan(affBefore)
    })

    it('click 增加亲密度', () => {
      const affBefore = usePetStore.getState().stats['doro'].affection
      usePetStore.getState().click()
      expect(usePetStore.getState().stats['doro'].affection).toBeGreaterThan(affBefore)
    })
  })

  describe('tick', () => {
    it('每 tick 衰减饱食度和心情', () => {
      usePetStore.getState().initCharacter('doro')
      const hungerBefore = usePetStore.getState().stats['doro'].hunger
      const moodBefore = usePetStore.getState().stats['doro'].mood
      usePetStore.getState().tick()
      const stats = usePetStore.getState().stats['doro']
      expect(stats.hunger).toBeLessThan(hungerBefore)
      expect(stats.mood).toBeLessThan(moodBefore)
    })

    it('饱食度低于 20 时健康下降', () => {
      usePetStore.getState().initCharacter('doro')
      usePetStore.setState((s) => ({
        stats: { ...s.stats, doro: { ...s.stats['doro'], hunger: 10, health: 80 } },
      }))
      usePetStore.getState().tick()
      expect(usePetStore.getState().stats['doro'].health).toBeLessThan(80)
    })
  })

  describe('addCoins / spendCoins', () => {
    it('addCoins 增加金币', () => {
      usePetStore.getState().addCoins(50)
      expect(usePetStore.getState().sharedCoins).toBe(150)
    })

    it('addCoins 不会降到负数', () => {
      usePetStore.getState().addCoins(-200)
      expect(usePetStore.getState().sharedCoins).toBe(0)
    })

    it('spendCoins 有足够时返回 true 并扣除', () => {
      const result = usePetStore.getState().spendCoins(30)
      expect(result).toBe(true)
      expect(usePetStore.getState().sharedCoins).toBe(70)
    })

    it('spendCoins 不足时返回 false 不扣除', () => {
      const result = usePetStore.getState().spendCoins(200)
      expect(result).toBe(false)
      expect(usePetStore.getState().sharedCoins).toBe(100)
    })
  })

  describe('buyItem', () => {
    it('有足够金币时购买成功', () => {
      const item = makeItem({ id: 'buy-test', price: 30 })
      const result = usePetStore.getState().buyItem(item)
      expect(result).toBe(true)
      expect(usePetStore.getState().sharedCoins).toBe(70)
      expect(usePetStore.getState().inventory).toHaveLength(1)
      expect(usePetStore.getState().inventory[0].count).toBe(1)
    })

    it('金币不足时购买失败', () => {
      const item = makeItem({ id: 'expensive', price: 500 })
      const result = usePetStore.getState().buyItem(item)
      expect(result).toBe(false)
      expect(usePetStore.getState().inventory).toHaveLength(0)
    })

    it('已有同种物品时叠加数量', () => {
      const item = makeItem({ id: 'dup-item', price: 10 })
      usePetStore.getState().buyItem(item)
      usePetStore.getState().buyItem(item)
      expect(usePetStore.getState().inventory).toHaveLength(1)
      expect(usePetStore.getState().inventory[0].count).toBe(2)
    })
  })

  describe('useItem', () => {
    it('使用物品后数量减少', () => {
      usePetStore.getState().initCharacter('doro')
      const item = makeItem({ id: 'use-test', price: 10, hungerRestore: 30 })
      usePetStore.getState().buyItem(item)
      usePetStore.getState().useItem('use-test')
      expect(usePetStore.getState().inventory).toHaveLength(0) // count 0 时移除
    })

    it('使用食物恢复饱食度', () => {
      usePetStore.getState().initCharacter('doro')
      usePetStore.setState((s) => ({
        stats: { ...s.stats, doro: { ...s.stats['doro'], hunger: 50 } },
      }))
      const item = makeItem({ id: 'food-1', price: 0, hungerRestore: 30 })
      usePetStore.getState().buyItem(item)
      usePetStore.getState().useItem('food-1')
      expect(usePetStore.getState().stats['doro'].hunger).toBe(80) // 50 + 30
    })
  })

  describe('getBadge', () => {
    it.each([
      [1, 'none'],
      [31, 'none'],
      [32, 'star'],
      [63, 'star'],
      [64, 'moon'],
      [127, 'moon'],
      [128, 'sun'],
      [255, 'sun'],
      [256, 'crown'],
    ])('level %i → badge %s', (level, expected) => {
      expect(usePetStore.getState().getBadge(level)).toBe(expected)
    })
  })

  describe('getColorTier', () => {
    it.each([
      [80, 'green'],
      [50, 'yellow'],
      [20, 'orange'],
      [10, 'red'],
    ])('value %i → tier %s', (value, expected) => {
      expect(usePetStore.getState().getColorTier(value)).toBe(expected)
    })
  })

  describe('getMoodMultiplier', () => {
    it('心情 > 80 时倍率 1.5', () => {
      usePetStore.getState().initCharacter('doro')
      usePetStore.setState((s) => ({
        stats: { ...s.stats, doro: { ...s.stats['doro'], mood: 90 } },
      }))
      expect(usePetStore.getState().getMoodMultiplier()).toBe(1.5)
    })

    it('心情 < 20 时倍率 0.5', () => {
      usePetStore.getState().initCharacter('doro')
      usePetStore.setState((s) => ({
        stats: { ...s.stats, doro: { ...s.stats['doro'], mood: 10 } },
      }))
      expect(usePetStore.getState().getMoodMultiplier()).toBe(0.5)
    })

    it('心情在 20-80 之间时倍率 1.0', () => {
      usePetStore.getState().initCharacter('doro')
      expect(usePetStore.getState().getMoodMultiplier()).toBe(1.0)
    })
  })

  describe('isSick', () => {
    it('健康为 0 时生病', () => {
      usePetStore.getState().initCharacter('doro')
      usePetStore.setState((s) => ({
        stats: { ...s.stats, doro: { ...s.stats['doro'], health: 0 } },
      }))
      expect(usePetStore.getState().isSick()).toBe(true)
    })

    it('健康 > 0 时未生病', () => {
      usePetStore.getState().initCharacter('doro')
      expect(usePetStore.getState().isSick()).toBe(false)
    })
  })

  describe('wearDecoration / removeDecoration', () => {
    beforeEach(() => {
      usePetStore.getState().initCharacter('doro')
    })

    it('穿戴装饰品', () => {
      const item = makeItem({ id: 'hat', type: 'accessory', price: 0 })
      usePetStore.getState().buyItem(item)
      usePetStore.getState().wearDecoration('hat', 'head')
      const worn = usePetStore.getState().getCurrentWornDecorations()
      expect(worn).toHaveLength(1)
      expect(worn[0].itemId).toBe('hat')
      expect(worn[0].anchor).toBe('head')
    })

    it('同一锚点只保留一个装饰品', () => {
      const item1 = makeItem({ id: 'hat1', type: 'accessory', price: 0 })
      const item2 = makeItem({ id: 'hat2', type: 'accessory', price: 0 })
      usePetStore.getState().buyItem(item1)
      usePetStore.getState().buyItem(item2)
      usePetStore.getState().wearDecoration('hat1', 'head')
      usePetStore.getState().wearDecoration('hat2', 'head')
      const worn = usePetStore.getState().getCurrentWornDecorations()
      expect(worn).toHaveLength(1)
      expect(worn[0].itemId).toBe('hat2')
    })

    it('移除装饰品', () => {
      const item = makeItem({ id: 'hat', type: 'accessory', price: 0 })
      usePetStore.getState().buyItem(item)
      usePetStore.getState().wearDecoration('hat', 'head')
      usePetStore.getState().removeDecoration('hat')
      expect(usePetStore.getState().getCurrentWornDecorations()).toHaveLength(0)
    })

    it('非装饰品类型不能穿戴', () => {
      const item = makeItem({ id: 'food-item', type: 'food', price: 0 })
      usePetStore.getState().buyItem(item)
      usePetStore.getState().wearDecoration('food-item', 'head')
      expect(usePetStore.getState().getCurrentWornDecorations()).toHaveLength(0)
    })
  })

  describe('setPosition', () => {
    it('保存宠物位置', () => {
      usePetStore.getState().setPosition({ x: 100, y: 200 })
      expect(usePetStore.getState().position).toEqual({ x: 100, y: 200 })
    })
  })

  describe('setBackground', () => {
    it('设置背景配置', () => {
      const bg = { type: 'solid' as const, color: '#ff0000' }
      usePetStore.getState().setBackground(bg)
      expect(usePetStore.getState().background).toEqual(bg)
    })
  })

  describe('completePomodoro', () => {
    it('完成番茄钟获得经验和金币', () => {
      usePetStore.getState().initCharacter('doro')
      const coinsBefore = usePetStore.getState().sharedCoins
      usePetStore.getState().completePomodoro(25)
      const stats = usePetStore.getState().stats['doro']
      expect(stats.exp).toBe(25) // addExp(25)
      expect(usePetStore.getState().sharedCoins).toBe(coinsBefore + 10)
    })
  })
})

describe('computeOfflineDecay', () => {
  // 基础数值
  const base = { hunger: 80, mood: 80, health: 80 }

  it('elapsed 为 0 时返回原值不变', () => {
    const result = computeOfflineDecay(0, base)
    expect(result).toEqual(base)
  })

  it('1 小时：hunger -2, mood -1.5, health 不变（hunger >= 20）', () => {
    const result = computeOfflineDecay(60 * 60 * 1000, base)
    expect(result.hunger).toBe(78)
    expect(result.mood).toBe(78.5)
    expect(result.health).toBe(80)
  })

  it('饥饿态（hunger < 20）健康额外衰减 hours * 5', () => {
    const hungry = { hunger: 10, mood: 80, health: 80 }
    const result = computeOfflineDecay(60 * 60 * 1000, hungry)
    expect(result.health).toBe(75)
  })

  it('边界：0.1 小时（6 分钟）触发衰减', () => {
    const result = computeOfflineDecay(0.1 * 60 * 60 * 1000, base)
    expect(result.hunger).toBeLessThan(80)
  })

  it('边界：0.09 小时（5.4 分钟）不触发衰减', () => {
    const result = computeOfflineDecay(0.09 * 60 * 60 * 1000, base)
    expect(result).toEqual(base)
  })

  it('HP 下限保护：health 衰减不低于 10', () => {
    const hungry = { hunger: 10, mood: 80, health: 12 }
    // 2 小时：healthDecay = 2 * 5 = 10, 12 - 10 = 2, clamped to 10
    const result = computeOfflineDecay(2 * 60 * 60 * 1000, hungry)
    expect(result.health).toBe(10)
  })

  it('7 天+ elapsed 仍按公式衰减（7 天上限由 applyOfflineDecay 负责）', () => {
    const elapsed = 7 * 24 * 60 * 60 * 1000 + 1
    const result = computeOfflineDecay(elapsed, base)
    // 168+ 小时：hunger/mood 衰减到 0（下限），health 因初始 hunger >= 20 不变
    expect(result.hunger).toBe(0)
    expect(result.mood).toBe(0)
    expect(result.health).toBe(80)
  })
})
