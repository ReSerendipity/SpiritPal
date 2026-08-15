/**
 * 食物/消耗品效果契约模块
 *
 * @fileoverview 定义食物、玩具、药品等消耗品的纯效果接口与相关工具函数
 *
 * 主要模块：
 * - IFood: 食物/消耗品纯效果契约接口（7个只读属性）
 * - FoodEffect: 基于 InventoryItem 的 IFood 实现类
 * - FoodDisplayInfo: 食物 UI 显示信息接口
 * - 工具函数: 显示信息生成、稀有度配置、效果组合与比较
 *
 * 依赖关系：
 * - types.ts: InventoryItem, BuffConfig 类型定义
 *
 * 核心接口：
 * - IFood: 所有消耗品必须实现的效果契约
 * - FoodDisplayInfo: UI 层显示专用数据结构
 *
 * 设计原则：
 * 1. 不可变性：效果值为只读属性，保证计算一致性
 * 2. 显示/效果分离：逻辑数据与 UI 显示数据分离
 * 3. 接口契约：统一消耗品的效果计算接口
 * 4. 可序列化：所有属性为原始类型，支持 JSON 序列化
 *
 * 参考实现：VPet 的 IFood 接口设计（GraphCore.cs）
 */

import type { InventoryItem } from './types'

// ============ IFood 接口 ============

/**
 * 食物/消耗品纯效果契约（IFood）
 *
 * 参考 VPet 的 IFood 接口，定义 7 个只读属性。
 * 所有消耗品（food/toy/medicine/accessory）必须实现此接口。
 *
 * 设计原则：
 * - 只读：效果值不可修改，保证计算的一致性
 * - 显示/效果分离：displayName/displayDescription 用于 UI，
 *   name/description 用于逻辑引用
 * - 可序列化：所有属性为原始类型，可安全 JSON 序列化
 */
export interface IFood {
  /** 内部标识名（用于逻辑引用） */
  readonly Name: string
  /** 显示名称（用于 UI 显示，可含 emoji/Unicode） */
  readonly DisplayName: string
  /** 显示描述（用于 UI 显示） */
  readonly Description: string
  /** 饱食度恢复值 */
  readonly HungerRestore: number
  /** 心情恢复值 */
  readonly MoodRestore: number
  /** 健康恢复值 */
  readonly HealthRestore: number
  /** 价格 */
  readonly Price: number
  /** 持续时间（毫秒，0 表示立即生效） */
  readonly Duration: number
}

// ============ IFood 实现 ============

/**
 * 基于 InventoryItem 的 IFood 实现
 *
 * 将 InventoryItem 适配为 IFood 接口
 * Duration 从 BuffConfig 的 expiration 推导
 */
export class FoodEffect implements IFood {
  private readonly item: InventoryItem

  constructor(item: InventoryItem) {
    this.item = Object.freeze({ ...item }) // 防御性拷贝 + 冻结
  }

  get Name(): string {
    return this.item.id
  }

  get DisplayName(): string {
    return this.item.name
  }

  get Description(): string {
    return this.item.description ?? ''
  }

  get HungerRestore(): number {
    return this.item.hungerRestore ?? 0
  }

  get MoodRestore(): number {
    return this.item.moodRestore ?? 0
  }

  get HealthRestore(): number {
    return this.item.healthRestore ?? 0
  }

  get Price(): number {
    return this.item.price
  }

  get Duration(): number {
    // 从 BuffConfig 推导持续时间
    if (this.item.buff?.expiration) {
      return this.item.buff.expiration * 1000 // 秒 → 毫秒
    }
    return 0 // 无 buff 则立即生效
  }

  /** 获取原始 InventoryItem（用于需要完整数据的场景） */
  toItem(): InventoryItem {
    return this.item
  }
}

// ============ 显示/效果分离 ============

/** 食物显示信息（仅用于 UI） */
export interface FoodDisplayInfo {
  /** 显示名称 */
  displayName: string
  /** 显示描述 */
  displayDescription: string
  /** 图标 */
  icon: string
  /** 稀有度名称 */
  rarityName: string
  /** 显示效果文本（如 "饱食度+20, 心情+5"） */
  effectText: string
  /** 价格文本 */
  priceText: string
}

/**
 * 生成食物显示信息（显示/效果分离）
 *
 * @param food IFood 实例
 * @param icon 物品图标
 * @param fvLock 稀有度等级
 * @returns UI 显示信息
 */
export function getFoodDisplayInfo(
  food: IFood,
  icon: string,
  fvLock?: number,
): FoodDisplayInfo {
  // 构建效果文本
  const effects: string[] = []
  if (food.HungerRestore > 0) effects.push(`饱食度+${food.HungerRestore}`)
  if (food.HungerRestore < 0) effects.push(`饱食度${food.HungerRestore}`)
  if (food.MoodRestore > 0) effects.push(`心情+${food.MoodRestore}`)
  if (food.MoodRestore < 0) effects.push(`心情${food.MoodRestore}`)
  if (food.HealthRestore > 0) effects.push(`健康+${food.HealthRestore}`)
  if (food.HealthRestore < 0) effects.push(`健康${food.HealthRestore}`)
  if (food.Duration > 0) effects.push(`持续${(food.Duration / 1000).toFixed(0)}秒`)

  // 稀有度名称
  const rarityMap: Record<number, string> = {
    0: '普通',
    1: '稀有',
    2: '珍贵',
    3: '史诗',
    4: '传说',
    5: '神话',
  }

  return {
    displayName: food.DisplayName,
    displayDescription: food.Description,
    icon,
    rarityName: rarityMap[fvLock ?? 0] ?? '普通',
    effectText: effects.join(', ') || '无效果',
    priceText: `${food.Price} 🪙`,
  }
}

// ============ 稀有度工具函数 ============

/** 稀有度等级 → 名称 */
export const RARITY_NAMES: Record<number, string> = {
  0: '普通',
  1: '稀有',
  2: '珍贵',
  3: '史诗',
  4: '传说',
  5: '神话',
}

/** 稀有度等级 → Tailwind 颜色类 */
export const RARITY_COLORS: Record<number, { text: string; bg: string; border: string }> = {
  0: { text: 'text-gray-400', bg: 'bg-gray-500/20', border: 'border-gray-500/30' },
  1: { text: 'text-blue-400', bg: 'bg-blue-500/20', border: 'border-blue-500/30' },
  2: { text: 'text-purple-400', bg: 'bg-purple-500/20', border: 'border-purple-500/30' },
  3: { text: 'text-amber-400', bg: 'bg-amber-500/20', border: 'border-amber-500/30' },
  4: { text: 'text-orange-400', bg: 'bg-orange-500/20', border: 'border-orange-500/30' },
  5: { text: 'text-red-400', bg: 'bg-red-500/20', border: 'border-red-500/30' },
}

/**
 * 获取稀有度显示信息
 * @param fvLock 稀有度等级 (0-5)
 * @returns 稀有度名称和颜色配置
 */
export function getRarityDisplay(fvLock?: number) {
  const level = fvLock ?? 0
  return {
    name: RARITY_NAMES[level] ?? '普通',
    colors: RARITY_COLORS[level] ?? RARITY_COLORS[0],
    level,
  }
}

// ============ IFood 工厂 ============

/**
 * 从 InventoryItem 创建 IFood 实例
 */
export function createFoodEffect(item: InventoryItem): IFood {
  return new FoodEffect(item)
}

/**
 * 批量创建 IFood 实例
 */
export function createFoodEffects(items: InventoryItem[]): IFood[] {
  return items.map(item => new FoodEffect(item))
}

// ============ 效果组合 ============

/**
 * 组合多个 IFood 的效果（用于同时使用多个食物）
 *
 * @param foods 食物列表
 * @returns 组合后的总效果
 */
export function combineFoodEffects(foods: IFood[]): {
  hungerRestore: number
  moodRestore: number
  healthRestore: number
  totalPrice: number
  maxDuration: number
} {
  return {
    hungerRestore: foods.reduce((sum, f) => sum + f.HungerRestore, 0),
    moodRestore: foods.reduce((sum, f) => sum + f.MoodRestore, 0),
    healthRestore: foods.reduce((sum, f) => sum + f.HealthRestore, 0),
    totalPrice: foods.reduce((sum, f) => sum + f.Price, 0),
    maxDuration: Math.max(0, ...foods.map(f => f.Duration)),
  }
}

// ============ 效果比较 ============

/**
 * 比较两个 IFood 的效果强度
 *
 * @returns 正数表示 a 更强，负数表示 b 更强，0 表示相当
 */
export function compareFoodEffect(a: IFood, b: IFood): number {
  const scoreA = a.HungerRestore + a.MoodRestore + a.HealthRestore
  const scoreB = b.HungerRestore + b.MoodRestore + b.HealthRestore
  return scoreA - scoreB
}

/**
 * 按性价比排序（效果/价格比）
 */
export function sortByCostEffectiveness(foods: IFood[]): IFood[] {
  return [...foods].sort((a, b) => {
    const ratioA = a.Price > 0 ? (a.HungerRestore + a.MoodRestore + a.HealthRestore) / a.Price : Infinity
    const ratioB = b.Price > 0 ? (b.HungerRestore + b.MoodRestore + b.HealthRestore) / b.Price : Infinity
    return ratioB - ratioA
  })
}
