/**
 * 收藏系统 — 收集品管理、套装完成奖励、装备展示
 *
 * @fileoverview
 * 主要模块：
 * - CollectionSet 接口：收集集定义（ID/名称/物品列表/亲密度奖励/金币奖励/成就ID）
 * - CollectionSetState 接口：收集集状态（已收集物品/完成状态/完成时间/奖励领取）
 * - CollectionEquipState 接口：收藏品装备状态
 * - COLLECTION_SETS：预定义收集集
 * - CollectionSystem 类：收藏系统，支持装备/卸下、收集检查、奖励发放
 *
 * 核心功能：
 * 1. collection 类型物品的 clct_inuse 开关（装备/卸下）
 * 2. fv_reward 升级奖励（完成收集集时触发）
 * 3. 收集集追踪（追踪集合中哪些物品已收集）
 * 4. 装备收藏品的显示加成
 *
 * @module collectionSystem
 * @requires ./types - InventoryItem 类型定义
 * @requires ../stores/petStore - Zustand 宠物状态管理
 */

import type { InventoryItem } from './types'
import { usePetStore } from '../stores/petStore'

// ============ 收集集定义 ============

/** 收集集定义 */
export interface CollectionSet {
  /** 收集集 ID */
  id: string
  /** 收集集名称 */
  name: string
  /** 收集集描述 */
  description: string
  /** 收集集图标 */
  icon: string
  /** 属于该收集集的物品 ID 列表 */
  itemIds: string[]
  /** 完成收集集的亲密度奖励 */
  fvReward: number
  /** 完成收集集的金币奖励 */
  coinReward?: number
  /** 完成收集集时触发的成就 ID（可选） */
  achievementId?: string
}

/** 收集集状态 */
export interface CollectionSetState {
  /** 收集集 ID */
  setId: string
  /** 已收集的物品 ID 集合 */
  collectedItems: Set<string>
  /** 是否已完成 */
  completed: boolean
  /** 完成时间戳（未完成为 null） */
  completedAt: number | null
  /** 是否已领取奖励 */
  rewardClaimed: boolean
}

/** 收藏品装备状态 */
export interface CollectionEquipState {
  /** 物品 ID → 是否装备（clct_inuse） */
  equipped: Map<string, boolean>
}

// ============ 默认收集集定义 ============

/** 内置收集集 */
export const COLLECTION_SETS: CollectionSet[] = [
  {
    id: 'set-shiny-stars',
    name: '闪耀星轨',
    description: '收集所有闪亮的星星贴纸',
    icon: '⭐',
    itemIds: ['col-star'],
    fvReward: 50,
    coinReward: 100,
  },
  {
    id: 'set-precious-gems',
    name: '珍宝匣',
    description: '收集稀有宝石',
    icon: '💎',
    itemIds: ['col-gem'],
    fvReward: 100,
    coinReward: 200,
  },
  {
    id: 'set-achiever-medals',
    name: '成就殿堂',
    description: '收集所有纪念章',
    icon: '🏅',
    itemIds: ['col-medal'],
    fvReward: 75,
    coinReward: 150,
  },
  {
    id: 'set-all-collectibles',
    name: '收藏大师',
    description: '收集所有收集品，成为真正的收藏大师',
    icon: '🏆',
    itemIds: ['col-star', 'col-gem', 'col-medal'],
    fvReward: 200,
    coinReward: 500,
    achievementId: 'achievement-collection-master',
  },
]

// ============ 收藏系统 ============

export class CollectionSystem {
  /** 收集集定义 */
  private sets: Map<string, CollectionSet> = new Map()
  /** 收集集状态（按角色 ID 分组） */
  private setStates: Map<string, Map<string, CollectionSetState>> = new Map()
  /** 装备状态（按角色 ID 分组） */
  private equipStates: Map<string, CollectionEquipState> = new Map()

  constructor() {
    // 注册内置收集集
    for (const set of COLLECTION_SETS) {
      this.sets.set(set.id, set)
    }
  }

  /**
   * 注册收集集
   */
  registerSet(set: CollectionSet): void {
    this.sets.set(set.id, set)
  }

  /**
   * 获取所有收集集
   */
  getSets(): CollectionSet[] {
    return Array.from(this.sets.values())
  }

  /**
   * 获取收集集定义
   */
  getSet(setId: string): CollectionSet | undefined {
    return this.sets.get(setId)
  }

  /**
   * 检查物品是否为收集品
   */
  isCollectible(item: InventoryItem): boolean {
    return item.type === 'collection'
  }

  /**
   * 当物品获得时更新收集状态
   */
  onItemAcquired(characterId: string, itemId: string): CollectionSetState[] {
    const completedSets: CollectionSetState[] = []

    // 查找包含该物品的收集集
    for (const set of this.sets.values()) {
      if (!set.itemIds.includes(itemId)) continue

      const state = this.getOrCreateSetState(characterId, set.id)
      state.collectedItems.add(itemId)

      // 检查是否完成
      if (!state.completed && this.isSetComplete(characterId, set.id)) {
        state.completed = true
        state.completedAt = Date.now()
        completedSets.push(state)
      }
    }

    return completedSets
  }

  /**
   * 当物品失去时更新收集状态
   */
  onItemLost(characterId: string, itemId: string): void {
    for (const set of this.sets.values()) {
      if (!set.itemIds.includes(itemId)) continue

      const state = this.getOrCreateSetState(characterId, set.id)
      state.collectedItems.delete(itemId)

      // 如果之前已完成但现在不再完整
      if (state.completed && !this.isSetComplete(characterId, set.id)) {
        state.completed = false
        state.completedAt = null
        state.rewardClaimed = false
      }
    }
  }

  /**
   * 装备收集品（clct_inuse = true）
   */
  equipCollectible(characterId: string, itemId: string): void {
    const equipState = this.getOrCreateEquipState(characterId)
    equipState.equipped.set(itemId, true)
  }

  /**
   * 卸下收集品（clct_inuse = false）
   */
  unequipCollectible(characterId: string, itemId: string): void {
    const equipState = this.getOrCreateEquipState(characterId)
    equipState.equipped.set(itemId, false)
  }

  /**
   * 检查收集品是否已装备
   */
  isEquipped(characterId: string, itemId: string): boolean {
    const equipState = this.equipStates.get(characterId)
    return equipState?.equipped.get(itemId) ?? false
  }

  /**
   * 领取收集集完成奖励
   * @returns 奖励信息，null 表示已领取或未完成
   */
  claimReward(characterId: string, setId: string): { fvReward: number; coinReward: number } | null {
    const set = this.sets.get(setId)
    const states = this.setStates.get(characterId)
    const state = states?.get(setId)

    if (!set || !state || !state.completed || state.rewardClaimed) return null

    state.rewardClaimed = true

    // 应用奖励
    const stats = usePetStore.getState().getCurrentStats()
    usePetStore.setState((s) => ({
      stats: {
        ...s.stats,
        [s.currentCharacterId]: {
          ...stats,
          affection: Math.min(9999, stats.affection + set.fvReward),
          lastInteractionAt: Date.now(),
        },
      },
    }))

    if (set.coinReward) {
      usePetStore.getState().addCoins(set.coinReward)
    }

    return { fvReward: set.fvReward, coinReward: set.coinReward ?? 0 }
  }

  /**
   * 检查收集集是否完成
   */
  isSetComplete(characterId: string, setId: string): boolean {
    const set = this.sets.get(setId)
    const states = this.setStates.get(characterId)
    const state = states?.get(setId)

    if (!set || !state) return false
    return set.itemIds.every((itemId) => state.collectedItems.has(itemId))
  }

  /**
   * 获取收集集进度
   */
  getSetProgress(characterId: string, setId: string): { collected: number; total: number; percentage: number } {
    const set = this.sets.get(setId)
    const states = this.setStates.get(characterId)
    const state = states?.get(setId)

    const total = set?.itemIds.length ?? 0
    const collected = state?.collectedItems.size ?? 0
    const percentage = total > 0 ? Math.round((collected / total) * 100) : 0

    return { collected, total, percentage }
  }

  /**
   * 获取装备收集品的显示加成
   * 每个装备的收集品提供心情 +2 的显示加成
   */
  getDisplayBonus(characterId: string): { moodBonus: number } {
    const equipState = this.equipStates.get(characterId)
    if (!equipState) return { moodBonus: 0 }

    let equippedCount = 0
    for (const [, isEquipped] of equipState.equipped) {
      if (isEquipped) equippedCount++
    }

    return { moodBonus: equippedCount * 2 }
  }

  /**
   * 获取所有收集集状态
   */
  getAllSetStates(characterId: string): CollectionSetState[] {
    const states = this.setStates.get(characterId)
    if (!states) return []
    return Array.from(states.values())
  }

  // ============ 内部辅助 ============

  private getOrCreateSetState(characterId: string, setId: string): CollectionSetState {
    let charStates = this.setStates.get(characterId)
    if (!charStates) {
      charStates = new Map()
      this.setStates.set(characterId, charStates)
    }

    let state = charStates.get(setId)
    if (!state) {
      state = {
        setId,
        collectedItems: new Set(),
        completed: false,
        completedAt: null,
        rewardClaimed: false,
      }
      charStates.set(setId, state)
    }

    return state
  }

  private getOrCreateEquipState(characterId: string): CollectionEquipState {
    let equipState = this.equipStates.get(characterId)
    if (!equipState) {
      equipState = { equipped: new Map() }
      this.equipStates.set(characterId, equipState)
    }
    return equipState
  }
}

// ============ 单例 ============

let collectionSystemInstance: CollectionSystem | null = null

/** 获取收藏系统单例 */
export function getCollectionSystem(): CollectionSystem {
  if (!collectionSystemInstance) {
    collectionSystemInstance = new CollectionSystem()
  }
  return collectionSystemInstance
}
