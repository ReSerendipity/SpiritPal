/**
 * IFood 纯效果契约 — 食物物品的显示与效果分离
 * 参考 VPet 的 IFood 接口设计
 *
 * @fileoverview
 * 主要模块：
 * - IFood 接口：食物纯效果契约接口（7个只读属性：Name/Description/ImagePath/Hunger/Mood/Health/Price）
 * - InventoryItemFood 类：InventoryItem → IFood 适配器
 * - BuiltInFood 类：内置食物实现
 * - FoodFactory：食物工厂，从 InventoryItem 创建 IFood 实例
 *
 * 核心设计：
 * 1. 7 个只读属性：Name, Description, ImagePath, Hunger, Mood, Health, Price
 * 2. 显示和效果分离：UI 层只读取显示属性，养成层只调用效果属性
 * 3. 基于接口的契约：自定义食物只需实现 IFood 接口
 * 4. 内置食物和自定义食物统一处理
 *
 * 属性分层：
 * - 显示层（UI）：Name, Description, ImagePath, Price
 * - 效果层（养成）：Hunger, Mood, Health
 *
 * @module foodContract
 * @requires ./types - InventoryItem, BuffConfig 类型定义
 */

import type { InventoryItem } from './types'

// ============ IFood 接口 ============

/**
 * 食物纯效果契约接口
 * 参考 VPet 的 IFood 接口设计
 *
 * 7 个只读属性将显示与效果分离：
 * - 显示层（UI）：Name, Description, ImagePath, Price
 * - 效果层（养成）：Hunger, Mood, Health
 *
 * 自定义食物只需实现此接口即可接入养成系统
 */
export interface IFood {
  /** 食物名称（显示用） */
  readonly Name: string
  /** 食物描述（显示用） */
  readonly Description: string
  /** 食物图片路径（显示用） */
  readonly ImagePath: string
  /** 饱食度恢复量（效果用，0-100） */
  readonly Hunger: number
  /** 心情恢复量（效果用，0-100） */
  readonly Mood: number
  /** 健康恢复量（效果用，0-100） */
  readonly Health: number
  /** 价格（显示+经济用） */
  readonly Price: number
}

// ============ InventoryItem → IFood 适配器 ============

/**
 * 将 InventoryItem 适配为 IFood 接口
 * InventoryItem 是内部数据格式，IFood 是效果契约格式
 */
export class InventoryItemFood implements IFood {
  private readonly item: InventoryItem

  constructor(item: InventoryItem) {
    this.item = item
  }

  get Name(): string {
    return this.item.name
  }

  get Description(): string {
    return this.item.description ?? ''
  }

  get ImagePath(): string {
    // 图标：InventoryItem 使用 emoji icon，转换为可渲染路径
    // 如果有实际图片路径则使用，否则返回 icon
    return this.item.icon
  }

  get Hunger(): number {
    return this.item.hungerRestore ?? 0
  }

  get Mood(): number {
    return this.item.moodRestore ?? 0
  }

  get Health(): number {
    return this.item.healthRestore ?? 0
  }

  get Price(): number {
    return this.item.price
  }

  /** 获取原始 InventoryItem（用于 Buff、petLimit 等扩展属性） */
  get raw(): InventoryItem {
    return this.item
  }
}

// ============ 自定义食物实现 ============

/**
 * 自定义食物基类
 * 内容创作者可继承此类创建自定义食物
 *
 * 示例：
 * ```ts
 * class MagicOrange extends CustomFood {
 *   constructor() {
 *     super({
 *       name: '魔法橘子',
 *       description: '多罗的终极食物，恢复所有属性',
 *       imagePath: '/custom/magic-orange.png',
 *       hunger: 50,
 *       mood: 30,
 *       health: 20,
 *       price: 100,
 *     })
 *   }
 * }
 * ```
 */
export class CustomFood implements IFood {
  private readonly config: {
    name: string
    description: string
    imagePath: string
    hunger: number
    mood: number
    health: number
    price: number
  }

  constructor(config: {
    name: string
    description?: string
    imagePath?: string
    hunger: number
    mood?: number
    health?: number
    price: number
  }) {
    this.config = {
      name: config.name,
      description: config.description ?? '',
      imagePath: config.imagePath ?? '',
      hunger: clampValue(config.hunger, 0, 100),
      mood: clampValue(config.mood ?? 0, 0, 100),
      health: clampValue(config.health ?? 0, 0, 100),
      price: Math.max(0, config.price),
    }
  }

  get Name(): string { return this.config.name }
  get Description(): string { return this.config.description }
  get ImagePath(): string { return this.config.imagePath }
  get Hunger(): number { return this.config.hunger }
  get Mood(): number { return this.config.mood }
  get Health(): number { return this.config.health }
  get Price(): number { return this.config.price }

  /**
   * 转换为 InventoryItem（用于商店/背包集成）
   */
  toInventoryItem(id: string): InventoryItem {
    return {
      id,
      name: this.Name,
      icon: this.ImagePath,
      type: 'food',
      hungerRestore: this.Hunger,
      moodRestore: this.Mood,
      healthRestore: this.Health,
      price: this.Price,
      count: 0,
    }
  }
}

// ============ 食物效果计算 ============

/** 食物使用效果结果 */
export interface FoodEffectResult {
  /** 饱食度变化量 */
  hungerDelta: number
  /** 心情变化量 */
  moodDelta: number
  /** 健康变化量 */
  healthDelta: number
  /** 亲密度奖励 */
  affectionReward: number
  /** 总效果评分（用于排序/推荐） */
  score: number
}

/**
 * 计算食物效果（考虑角色偏好倍率）
 */
export function calculateFoodEffect(
  food: IFood,
  multiplier: number = 1.0,
  affectionReward: number = 0,
): FoodEffectResult {
  const hungerDelta = Math.round(food.Hunger * multiplier)
  const moodDelta = Math.round(food.Mood * multiplier)
  const healthDelta = Math.round(food.Health * multiplier)

  // 效果评分：加权求和（饱食度 ×1 + 心情 ×1.5 + 健康 ×2）
  const score = hungerDelta + moodDelta * 1.5 + healthDelta * 2

  return {
    hungerDelta,
    moodDelta,
    healthDelta,
    affectionReward,
    score,
  }
}

/**
 * 比较两个食物的效果评分
 * 用于排序：效果更好的食物排在前面
 */
export function compareFoodEffect(a: IFood, b: IFood): number {
  const scoreA = a.Hunger + a.Mood * 1.5 + a.Health * 2
  const scoreB = b.Hunger + b.Mood * 1.5 + b.Health * 2
  return scoreB - scoreA
}

/**
 * 推荐食物（基于当前养成数值和预算）
 */
export function recommendFood(
  foods: IFood[],
  currentHunger: number,
  currentMood: number,
  currentHealth: number,
  budget: number,
): IFood | null {
  // 过滤预算内的食物
  const affordable = foods.filter((f) => f.Price <= budget)
  if (affordable.length === 0) return null

  // 计算每个食物的紧急度加权评分
  // 饥饿时饱食度权重更高，心情低时心情权重更高，健康低时健康权重更高
  const hungerWeight = currentHunger < 30 ? 3 : 1
  const moodWeight = currentMood < 30 ? 2 : 1
  const healthWeight = currentHealth < 30 ? 4 : 1

  const scored = affordable.map((food) => ({
    food,
    score: food.Hunger * hungerWeight + food.Mood * moodWeight + food.Health * healthWeight,
  }))

  scored.sort((a, b) => b.score - a.score)
  return scored[0]?.food ?? null
}

// ============ 辅助函数 ============

function clampValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// ============ 食物契约注册表 ============

/**
 * 食物契约注册表
 * 管理所有 IFood 实现（内置 + 自定义）
 */
export class FoodRegistry {
  /** 已注册的食物（id → IFood） */
  private foods: Map<string, IFood> = new Map()

  /**
   * 注册食物
   */
  register(id: string, food: IFood): void {
    this.foods.set(id, food)
  }

  /**
   * 批量注册（从 InventoryItem 列表）
   */
  registerFromItems(items: InventoryItem[]): void {
    for (const item of items) {
      this.foods.set(item.id, new InventoryItemFood(item))
    }
  }

  /**
   * 获取食物
   */
  get(id: string): IFood | undefined {
    return this.foods.get(id)
  }

  /**
   * 获取所有已注册食物
   */
  getAll(): IFood[] {
    return Array.from(this.foods.values())
  }

  /**
   * 获取所有 ID
   */
  getAllIds(): string[] {
    return Array.from(this.foods.keys())
  }
}

// ============ 单例 ============

let foodRegistryInstance: FoodRegistry | null = null

/** 获取食物注册表单例 */
export function getFoodRegistry(): FoodRegistry {
  if (!foodRegistryInstance) {
    foodRegistryInstance = new FoodRegistry()
  }
  return foodRegistryInstance
}
