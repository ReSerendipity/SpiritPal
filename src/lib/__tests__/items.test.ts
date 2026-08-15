// items 单元测试 — 道具配置与角色偏好倍率
import { describe, it, expect } from 'vitest'
import {
  FOODS_BY_CHARACTER,
  TOYS,
  MEDICINES,
  ACCESSORIES,
  COLLECTIBLES,
  DIALOGUE_ITEMS,
  SUBPET_ITEMS,
  getItemPrice,
  getRarityName,
  getCharacterMultiplier,
  getFoodsForCharacter,
  getAllShopItems,
  ITEM_DATABASE,
  getItemById,
  getCollectionItems,
  getDialogueItems,
  getSubpetItems,
} from '../items'
import { ItemType } from '../types'

describe('FOODS_BY_CHARACTER', () => {
  it('包含 3 个角色', () => {
    expect(FOODS_BY_CHARACTER.doro).toBeDefined()
    expect(FOODS_BY_CHARACTER.feibi).toBeDefined()
    expect(FOODS_BY_CHARACTER.gugugaga).toBeDefined()
  })

  it('每个角色至少有 3 种食物', () => {
    expect(FOODS_BY_CHARACTER.doro.length).toBeGreaterThanOrEqual(3)
    expect(FOODS_BY_CHARACTER.feibi.length).toBeGreaterThanOrEqual(3)
    expect(FOODS_BY_CHARACTER.gugugaga.length).toBeGreaterThanOrEqual(3)
  })
})

describe('TOYS / MEDICINES / ACCESSORIES / COLLECTIBLES', () => {
  it('TOYS 至少 3 种', () => {
    expect(TOYS.length).toBeGreaterThanOrEqual(3)
    expect(TOYS.every((t) => t.type === 'toy')).toBe(true)
  })

  it('MEDICINES 至少 3 种', () => {
    expect(MEDICINES.length).toBeGreaterThanOrEqual(3)
    expect(MEDICINES.every((m) => m.type === 'medicine')).toBe(true)
  })

  it('ACCESSORIES 至少 3 种', () => {
    expect(ACCESSORIES.length).toBeGreaterThanOrEqual(3)
    expect(ACCESSORIES.every((a) => a.type === 'accessory')).toBe(true)
  })

  it('COLLECTIBLES 至少 2 种', () => {
    expect(COLLECTIBLES.length).toBeGreaterThanOrEqual(2)
    expect(COLLECTIBLES.every((c) => c.type === 'collection')).toBe(true)
  })
})

describe('getItemPrice', () => {
  it('fvLock=0 → 50', () => {
    expect(getItemPrice({ id: 'x', fvLock: 0 } as never)).toBe(50)
  })
  it('fvLock=1 → 100', () => {
    expect(getItemPrice({ id: 'x', fvLock: 1 } as never)).toBe(100)
  })
  it('fvLock=5 → 300', () => {
    expect(getItemPrice({ id: 'x', fvLock: 5 } as never)).toBe(300)
  })
  it('fvLock undefined → 0', () => {
    expect(getItemPrice({ id: 'x' } as never)).toBe(0)
  })
})

describe('getRarityName', () => {
  it('返回正确的稀有度名称', () => {
    expect(getRarityName(0)).toBe('普通')
    expect(getRarityName(1)).toBe('稀有')
    expect(getRarityName(2)).toBe('珍贵')
    expect(getRarityName(3)).toBe('史诗')
    expect(getRarityName(4)).toBe('传说')
    expect(getRarityName(5)).toBe('神话')
  })

  it('未知值返回普通', () => {
    expect(getRarityName(99)).toBe('普通')
    expect(getRarityName(undefined)).toBe('普通')
  })
})

describe('getCharacterMultiplier', () => {
  it('喜欢物品 ×2.0', () => {
    // doro 喜欢 doro-orange
    expect(getCharacterMultiplier('doro', 'doro-orange')).toBe(2.0)
  })

  it('讨厌物品 ×0.5', () => {
    // doro 讨厌 med-herb
    expect(getCharacterMultiplier('doro', 'med-herb')).toBe(0.5)
  })

  it('普通物品 ×1.0', () => {
    expect(getCharacterMultiplier('doro', 'unknown-item')).toBe(1.0)
  })

  it('未知角色返回 1.0', () => {
    expect(getCharacterMultiplier('unknown-char', 'doro-orange')).toBe(1.0)
  })
})

describe('getFoodsForCharacter', () => {
  it('返回角色对应的食物列表', () => {
    const foods = getFoodsForCharacter('doro')
    expect(foods.length).toBeGreaterThan(0)
    expect(foods.every((f) => f.type === 'food')).toBe(true)
  })

  it('未知角色返回空数组', () => {
    expect(getFoodsForCharacter('unknown')).toEqual([])
  })
})

describe('getAllShopItems', () => {
  it('包含所有类型的物品', () => {
    const all = getAllShopItems('doro')
    expect(all.length).toBeGreaterThanOrEqual(
      FOODS_BY_CHARACTER.doro.length + TOYS.length + MEDICINES.length + ACCESSORIES.length + COLLECTIBLES.length,
    )
    const types = new Set(all.map((i) => i.type))
    expect(types.has('food')).toBe(true)
    expect(types.has('toy')).toBe(true)
    expect(types.has('medicine')).toBe(true)
    expect(types.has('accessory')).toBe(true)
    expect(types.has('collection')).toBe(true)
  })
})

describe('ITEM_DATABASE', () => {
  it('包含所有物品（食物 + 玩具 + 药品 + 装饰品 + 收藏品 + 对话 + 副宠）', () => {
    const expectedCount =
      FOODS_BY_CHARACTER.doro.length +
      FOODS_BY_CHARACTER.feibi.length +
      FOODS_BY_CHARACTER.gugugaga.length +
      TOYS.length +
      MEDICINES.length +
      ACCESSORIES.length +
      COLLECTIBLES.length +
      DIALOGUE_ITEMS.length +
      SUBPET_ITEMS.length
    expect(Object.keys(ITEM_DATABASE).length).toBe(expectedCount)
  })

  it('每个物品都有 rarity、unlockable、tags 字段', () => {
    for (const item of Object.values(ITEM_DATABASE)) {
      expect(item.rarity).toBeDefined()
      expect(item.unlockable).toBeDefined()
      expect(item.tags).toBeDefined()
      expect(item.tags!.length).toBeGreaterThan(0)
    }
  })

  it('fvLock=0 的物品 rarity 为 common', () => {
    const item = getItemById('doro-orange')
    expect(item).toBeDefined()
    expect(item!.rarity).toBe('common')
  })

  it('fvLock=5 的物品 rarity 为 mythic', () => {
    const item = getItemById('acc-crown')
    expect(item).toBeDefined()
    expect(item!.rarity).toBe('mythic')
  })
})

describe('getItemById', () => {
  it('返回存在的物品', () => {
    const item = getItemById('toy-ball')
    expect(item).toBeDefined()
    expect(item!.name).toBe('小皮球')
  })

  it('不存在的 id 返回 undefined', () => {
    expect(getItemById('nonexistent')).toBeUndefined()
  })
})

describe('分类查询函数', () => {
  it('getCollectionItems 返回所有收藏品', () => {
    const items = getCollectionItems()
    expect(items.length).toBe(COLLECTIBLES.length)
    expect(items.every((i) => i.type === ItemType.COLLECTION)).toBe(true)
  })

  it('getDialogueItems 返回所有对话物品', () => {
    const items = getDialogueItems()
    expect(items.length).toBe(DIALOGUE_ITEMS.length)
    expect(items.every((i) => i.type === ItemType.DIALOGUE)).toBe(true)
  })

  it('getSubpetItems 返回所有副宠物品', () => {
    const items = getSubpetItems()
    expect(items.length).toBe(SUBPET_ITEMS.length)
    expect(items.every((i) => i.type === ItemType.SUBPET)).toBe(true)
  })
})
