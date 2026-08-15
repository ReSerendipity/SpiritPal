/**
 * 物品 Schema 扩展模块
 *
 * @fileoverview 扩展 InventoryItem 类型，新增 dialogue/subpet 等物品类型与验证
 *
 * 主要模块：
 * - ExtendedItemType: 扩展物品类型（新增 dialogue, subpet）
 * - ExtendedItemFields: 扩展字段（petLimit, fvReward, dialogueId, subpetConfig）
 * - ExtendedInventoryItem: 完整扩展物品类型
 * - validateExtendedItem: Schema 验证函数
 * - calculateItemEffect: 物品效果计算（含角色偏好倍率）
 * - 工厂函数: createDialogueItem, createSubpetItem, createFoodWithReward
 *
 * 依赖关系：
 * - types.ts: InventoryItem, BuffConfig, NurturingStats 基础类型
 * - characters.ts: 角色偏好数据（动态引入）
 *
 * 核心接口：
 * - validateExtendedItem(): 验证扩展物品数据完整性
 * - calculateItemEffect(): 计算物品实际效果（角色偏好倍率、亲密度奖励）
 *
 * 扩展物品类型：
 * - dialogue: 对话解锁物品，使用后解锁特殊对话
 * - subpet: 伴侣宠物物品，召唤跟随的小宠物
 */

import type { InventoryItem, BuffConfig, NurturingStats } from './types'

// ============ 扩展物品类型 ============

/** 扩展后的物品类型（在原有基础上新增 dialogue 和 subpet） */
export type ExtendedItemType = InventoryItem['type'] | 'dialogue' | 'subpet'

/** 全部物品类型列表 */
export const ALL_ITEM_TYPES: ExtendedItemType[] = [
  'food', 'toy', 'medicine', 'accessory', 'consumable', 'collection',
  'dialogue', 'autofeed', 'coin', 'subpet',
]

/** 物品类型显示名称 */
export const ITEM_TYPE_LABELS: Record<ExtendedItemType, string> = {
  food: '食物',
  toy: '玩具',
  medicine: '药品',
  accessory: '装饰品',
  consumable: '消耗品',
  collection: '收藏品',
  dialogue: '对话解锁',
  autofeed: '自动喂食',
  coin: '金币',
  subpet: '伴侣宠物',
}

/** 物品类型图标 */
export const ITEM_TYPE_ICONS: Record<ExtendedItemType, string> = {
  food: '🍖',
  toy: '🎮',
  medicine: '💊',
  accessory: '👗',
  consumable: '🧴',
  collection: '💎',
  dialogue: '💬',
  autofeed: '🤖',
  coin: '🪙',
  subpet: '🐾',
}

// ============ 扩展字段 ============

/**
 * 扩展 InventoryItem 的额外字段
 *
 * 这些字段通过类型扩展添加到 InventoryItem 上，
 * 不修改 types.ts 中的基础接口（向后兼容）
 */
export interface ExtendedItemFields {
  /** 角色限制 — 仅指定角色可用（角色 ID 列表） */
  petLimit?: string[]
  /** 使用时亲密度奖励（使用该物品时额外获得的亲密度） */
  fvReward?: number
  /** 对话解锁 — dialogue 类型物品解锁的对话 ID */
  dialogueId?: string
  /** 伴侣宠物配置 — subpet 类型物品的配置 */
  subpetConfig?: SubpetConfig
}

/** 伴侣宠物配置 */
export interface SubpetConfig {
  /** 伴侣宠物精灵图路径 */
  spritePath: string
  /** 伴侣宠物名称 */
  name: string
  /** 伴侣宠物大小（相对于主宠物的比例） */
  scale: number
  /** 跟随偏移（相对于主宠物） */
  offset: { x: number; y: number }
  /** 伴侣宠物动画 */
  animations?: string[]
}

// ============ 扩展后的完整物品类型 ============

/** 扩展后的 InventoryItem（包含新字段） */
export type ExtendedInventoryItem = InventoryItem & ExtendedItemFields

// ============ Schema 验证 ============

/** 验证结果 */
export interface ItemValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

/**
 * 验证扩展物品数据完整性
 *
 * 验证规则：
 * - id 非空且符合标识符规范
 * - name 非空
 * - type 为有效类型
 * - price >= 0
 * - count >= 0
 * - fvLock 在 0-5 范围内
 * - dropRate 在 0-1 范围内
 * - dialogue 类型必须有 dialogueId
 * - subpet 类型必须有 subpetConfig
 * - buff 配置有效
 *
 * @param item 扩展物品数据
 * @returns 验证结果
 */
export function validateExtendedItem(item: ExtendedInventoryItem): ItemValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // 基础字段
  if (!item.id) errors.push('物品 ID 不能为空')
  else if (!/^[a-zA-Z0-9_-]+$/.test(item.id)) errors.push('物品 ID 格式无效')
  if (!item.name) errors.push('物品名称不能为空')
  if (!ALL_ITEM_TYPES.includes(item.type)) errors.push(`未知物品类型: ${item.type}`)
  if (item.price < 0) errors.push('价格不能为负数')
  if (item.count < 0) errors.push('数量不能为负数')

  // 稀有度
  if (item.fvLock !== undefined && (item.fvLock < 0 || item.fvLock > 5)) {
    errors.push('fvLock 必须在 0-5 范围内')
  }

  // 掉落率
  if (item.dropRate !== undefined && (item.dropRate < 0 || item.dropRate > 1)) {
    errors.push('dropRate 必须在 0-1 范围内')
  }

  // dialogue 类型验证
  if (item.type === 'dialogue') {
    if (!item.dialogueId) errors.push('dialogue 类型物品必须指定 dialogueId')
    // dialogue 物品通常不提供恢复效果
    if (item.hungerRestore || item.moodRestore || item.healthRestore) {
      warnings.push('dialogue 类型物品通常不提供恢复效果')
    }
  }

  // subpet 类型验证
  if (item.type === 'subpet') {
    if (!item.subpetConfig) errors.push('subpet 类型物品必须提供 subpetConfig')
    else {
      if (!item.subpetConfig.spritePath) errors.push('subpet 精灵图路径不能为空')
      if (!item.subpetConfig.name) errors.push('subpet 名称不能为空')
      if (item.subpetConfig.scale <= 0 || item.subpetConfig.scale > 2) {
        warnings.push('subpet 缩放比例建议在 (0, 2] 范围内')
      }
    }
  }

  // 角色限制验证
  if (item.petLimit && item.petLimit.length === 0) {
    warnings.push('petLimit 为空数组表示无角色限制，建议省略')
  }

  // 亲密度奖励验证
  if (item.fvReward !== undefined && item.fvReward < 0) {
    errors.push('fvReward 不能为负数')
  }

  // Buff 验证
  if (item.buff) {
    const buffErrors = validateBuffConfig(item.buff)
    errors.push(...buffErrors)
  }

  // 恢复效果验证
  if (item.type === 'collection' && (item.hungerRestore || item.moodRestore || item.healthRestore)) {
    warnings.push('collection 类型物品通常不提供恢复效果')
  }

  return { valid: errors.length === 0, errors, warnings }
}

/** 验证 BuffConfig */
function validateBuffConfig(buff: BuffConfig): string[] {
  const errors: string[] = []
  const validEffects: BuffConfig['effect'][] = ['hp', 'fv', 'coin', 'HP_stop', 'FV_stop']
  if (!validEffects.includes(buff.effect)) {
    errors.push(`未知的 Buff 效果类型: ${buff.effect}`)
  }
  if (buff.interval <= 0) errors.push('Buff 间隔必须为正数')
  if (buff.expiration !== undefined && buff.expiration <= 0) {
    errors.push('Buff 持续时间必须为正数')
  }
  return errors
}

// ============ 物品效果计算 ============

/**
 * 计算物品使用后的实际效果（含角色偏好倍率、亲密度奖励）
 *
 * @param item 物品
 * @param characterId 当前角色 ID
 * @param stats 当前养成数值
 * @returns 实际效果值
 */
export function calculateItemEffect(
  item: ExtendedInventoryItem,
  characterId: string,
  _stats: NurturingStats,
): {
  hungerRestore: number
  moodRestore: number
  healthRestore: number
  affectionReward: number
} {
  // 获取角色偏好倍率
  let multiplier = 1.0
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- 惰性 require 避免 characters 循环依赖
    const { getCharacter } = require('./characters')
    const char = getCharacter(characterId)
    if (char) {
      if (char.favoriteItems?.includes(item.id)) multiplier = 2.0
      else if (char.dislikeItems?.includes(item.id)) multiplier = 0.5
    }
  } catch {
    // 忽略
  }

  // 角色限制检查
  if (item.petLimit && !item.petLimit.includes(characterId)) {
    // 角色不在限制列表中，效果为 0
    return { hungerRestore: 0, moodRestore: 0, healthRestore: 0, affectionReward: 0 }
  }

  return {
    hungerRestore: Math.round((item.hungerRestore ?? 0) * multiplier),
    moodRestore: Math.round((item.moodRestore ?? 0) * multiplier),
    healthRestore: Math.round((item.healthRestore ?? 0) * multiplier),
    affectionReward: item.fvReward ?? 0,
  }
}

// ============ 物品创建工厂 ============

/** 创建对话解锁物品 */
export function createDialogueItem(
  id: string,
  name: string,
  dialogueId: string,
  options: Partial<Pick<ExtendedInventoryItem, 'price' | 'fvLock' | 'description' | 'icon'>> = {},
): ExtendedInventoryItem {
  return {
    id,
    name,
    icon: options.icon ?? '💬',
    type: 'dialogue',
    price: options.price ?? 50,
    count: 0,
    fvLock: options.fvLock ?? 2,
    dropRate: 0.5,
    description: options.description ?? `解锁对话: ${dialogueId}`,
    dialogueId,
  }
}

/** 创建伴侣宠物物品 */
export function createSubpetItem(
  id: string,
  name: string,
  config: SubpetConfig,
  options: Partial<Pick<ExtendedInventoryItem, 'price' | 'fvLock' | 'description' | 'icon'>> = {},
): ExtendedInventoryItem {
  return {
    id,
    name,
    icon: options.icon ?? '🐾',
    type: 'subpet',
    price: options.price ?? 100,
    count: 0,
    fvLock: options.fvLock ?? 3,
    dropRate: 0.3,
    description: options.description ?? `伴侣宠物: ${config.name}`,
    subpetConfig: config,
  }
}

/** 创建带亲密度奖励的食物 */
export function createFoodWithReward(
  id: string,
  name: string,
  options: {
    icon?: string
    hungerRestore?: number
    moodRestore?: number
    price: number
    fvReward: number
    fvLock?: number
    description?: string
  },
): ExtendedInventoryItem {
  return {
    id,
    name,
    icon: options.icon ?? '🍽️',
    type: 'food',
    hungerRestore: options.hungerRestore ?? 15,
    moodRestore: options.moodRestore ?? 5,
    price: options.price,
    count: 0,
    fvLock: options.fvLock ?? 0,
    dropRate: 1.0,
    description: options.description,
    fvReward: options.fvReward,
  }
}
