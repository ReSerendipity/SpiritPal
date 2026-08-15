/**
 * 收藏管理器 — 收藏品装备/卸下、收集进度追踪、完成奖励发放
 *
 * @fileoverview
 * 主要模块：
 * - CollectionSet 接口：收藏套装定义（ID/名称/物品列表/亲密度奖励/额外奖励）
 * - CollectionProgress 接口：收藏进度（已收集物品/完成状态/奖励领取/已装备物品）
 * - COLLECTION_SETS：预定义收藏套装
 * - CollectionManager 类：收藏管理器（单例模式），支持装备/卸下、进度查询、奖励发放
 *
 * 核心功能：
 * 1. 收藏品 clct_inuse 开关（已装备/展示中的收藏品）
 * 2. 套装收集完成时的 fv_reward 升级奖励
 * 3. 收藏进度追踪
 * 4. 收藏展示 UI 数据
 *
 * @module collectionManager
 * @requires ./types - InventoryItem, NurturingStats 类型定义
 */

import type { InventoryItem } from './types'

// ============ 收藏套装定义 ============

/** 收藏套装 — 一组相关联的收藏品，集齐可获奖励 */
export interface CollectionSet {
  /** 套装 ID */
  id: string
  /** 套装名称 */
  name: string
  /** 套装描述 */
  description: string
  /** 套装图标 */
  icon: string
  /** 包含的物品 ID 列表 */
  itemIds: string[]
  /** 套装收集完成奖励 */
  fvReward: number
  /** 额外奖励（buff、金币等） */
  bonusRewards?: {
    coins?: number
    buffEffect?: string
    buffValue?: number
    buffDuration?: number
  }
}

/** 收藏进度 */
export interface CollectionProgress {
  /** 套装 ID */
  setId: string
  /** 已收集的物品 ID 集合 */
  collectedItems: Set<string>
  /** 是否已完成（集齐） */
  completed: boolean
  /** 是否已领取完成奖励 */
  rewardClaimed: boolean
  /** clct_inuse：已装备展示的物品 ID 集合 */
  inUseItems: Set<string>
}

/** 收藏展示数据 */
export interface CollectionDisplayData {
  /** 套装信息 */
  set: CollectionSet
  /** 进度信息 */
  progress: CollectionProgress
  /** 完成百分比 */
  completionPercent: number
  /** 下一件未收集物品 */
  nextMissingItem: InventoryItem | null
}

// ============ 预设套装 ============

/** 星之套装 */
export const STAR_COLLECTION_SET: CollectionSet = {
  id: 'set-stars',
  name: '星之套装',
  description: '收集所有星星系列贴纸，获得亲密度奖励',
  icon: '✨',
  itemIds: ['col-star'],
  fvReward: 50,
  bonusRewards: { coins: 100 },
}

/** 宝石套装 */
export const GEM_COLLECTION_SET: CollectionSet = {
  id: 'set-gems',
  name: '宝石套装',
  description: '收集所有稀有宝石，获得大量亲密度奖励',
  icon: '💎',
  itemIds: ['col-gem'],
  fvReward: 100,
  bonusRewards: { coins: 200 },
}

/** 纪念套装 */
export const MEDAL_COLLECTION_SET: CollectionSet = {
  id: 'set-medals',
  name: '纪念套装',
  description: '收集所有纪念章，见证每一段旅程',
  icon: '🏅',
  itemIds: ['col-medal'],
  fvReward: 75,
  bonusRewards: { coins: 150 },
}

/** 全收藏套装 */
export const MASTER_COLLECTION_SET: CollectionSet = {
  id: 'set-master',
  name: '大师收藏家',
  description: '收集全部收藏品，获得最高荣誉奖励',
  icon: '👑',
  itemIds: ['col-star', 'col-gem', 'col-medal'],
  fvReward: 200,
  bonusRewards: { coins: 500, buffEffect: 'fv', buffValue: 2, buffDuration: 600 },
}

/** 默认套装列表 */
export const DEFAULT_COLLECTION_SETS: CollectionSet[] = [
  STAR_COLLECTION_SET,
  GEM_COLLECTION_SET,
  MEDAL_COLLECTION_SET,
  MASTER_COLLECTION_SET,
]

// ============ CollectionManager ============

/**
 * 收藏系统管理器
 *
 * 管理收藏品的收集进度、套装完成奖励和装备展示状态。
 * 通过 getCollectionManager() 获取单例。
 *
 * - clct_inuse 开关控制收藏品的装备/展示状态
 * - 套装收集完成时获得 fv_reward 升级奖励
 */
export class CollectionManager {
  /** 套装定义 */
  private sets: Map<string, CollectionSet> = new Map()
  /** 收藏进度（套装ID → 进度） */
  private progress: Map<string, CollectionProgress> = new Map()
  /** 奖励领取回调 */
  private onRewardClaim: ((setId: string, fvReward: number, bonusRewards?: CollectionSet['bonusRewards']) => void) | null = null
  /** 进度变化回调 */
  private onProgressChange: ((setData: CollectionDisplayData[]) => void) | null = null

  constructor(sets?: CollectionSet[]) {
    const initialSets = sets ?? DEFAULT_COLLECTION_SETS
    for (const set of initialSets) {
      this.registerSet(set)
    }
  }

  // ============ 套装注册 ============

  /** 注册一个收藏套装 */
  registerSet(set: CollectionSet): void {
    this.sets.set(set.id, set)
    if (!this.progress.has(set.id)) {
      this.progress.set(set.id, {
        setId: set.id,
        collectedItems: new Set(),
        completed: false,
        rewardClaimed: false,
        inUseItems: new Set(),
      })
    }
  }

  // ============ 收集操作 ============

  /**
   * 记录收集到一个物品
   * @returns 是否触发了套装完成
   */
  collectItem(itemId: string): boolean {
    let completedNewSet = false

    for (const [setId, set] of this.sets) {
      if (!set.itemIds.includes(itemId)) continue

      const prog = this.progress.get(setId)
      if (!prog || prog.collectedItems.has(itemId)) continue

      prog.collectedItems.add(itemId)

      // 检查是否集齐
      const wasCompleted = prog.completed
      prog.completed = set.itemIds.every((id) => prog.collectedItems.has(id))

      if (prog.completed && !wasCompleted) {
        completedNewSet = true
      }
    }

    this.notifyProgressChange()
    return completedNewSet
  }

  /**
   * 移除一个已收集的物品（出售/消耗后）
   */
  removeItem(itemId: string): void {
    for (const [setId, set] of this.sets) {
      if (!set.itemIds.includes(itemId)) continue

      const prog = this.progress.get(setId)
      if (!prog) continue

      prog.collectedItems.delete(itemId)
      prog.inUseItems.delete(itemId)
      prog.completed = set.itemIds.every((id) => prog.collectedItems.has(id))

      // 如果套装变为未完成，奖励需要退回
      if (!prog.completed && prog.rewardClaimed) {
        // 标记奖励未领取（实际实现中可能需要扣回）
        prog.rewardClaimed = false
      }
    }

    this.notifyProgressChange()
  }

  // ============ clct_inuse 开关 ============

  /**
   * 装备展示收藏品（clct_inuse = true）
   */
  equipItem(itemId: string): boolean {
    for (const [setId, set] of this.sets) {
      if (!set.itemIds.includes(itemId)) continue
      const prog = this.progress.get(setId)
      if (!prog || !prog.collectedItems.has(itemId)) continue
      prog.inUseItems.add(itemId)
      return true
    }
    return false
  }

  /**
   * 取消装备展示收藏品（clct_inuse = false）
   */
  unequipItem(itemId: string): void {
    for (const [, prog] of this.progress) {
      prog.inUseItems.delete(itemId)
    }
  }

  /**
   * 检查收藏品是否处于装备展示状态
   */
  isItemInUse(itemId: string): boolean {
    for (const [, prog] of this.progress) {
      if (prog.inUseItems.has(itemId)) return true
    }
    return false
  }

  // ============ 奖励领取 ============

  /**
   * 领取套装完成奖励
   * @returns 领取的奖励数据，或 null（未完成或已领取）
   */
  claimReward(setId: string): { fvReward: number; bonusRewards?: CollectionSet['bonusRewards'] } | null {
    const set = this.sets.get(setId)
    const prog = this.progress.get(setId)
    if (!set || !prog || !prog.completed || prog.rewardClaimed) return null

    prog.rewardClaimed = true
    this.onRewardClaim?.(setId, set.fvReward, set.bonusRewards)
    this.notifyProgressChange()

    return {
      fvReward: set.fvReward,
      bonusRewards: set.bonusRewards,
    }
  }

  /**
   * 检查是否有可领取的奖励
   */
  hasClaimableRewards(): string[] {
    const result: string[] = []
    for (const [setId, prog] of this.progress) {
      if (prog.completed && !prog.rewardClaimed) {
        result.push(setId)
      }
    }
    return result
  }

  // ============ 查询 ============

  /**
   * 获取所有收藏展示数据
   */
  getAllDisplayData(allItems: InventoryItem[]): CollectionDisplayData[] {
    const result: CollectionDisplayData[] = []

    for (const [setId, set] of this.sets) {
      const prog = this.progress.get(setId)
      if (!prog) continue

      const totalItems = set.itemIds.length
      const collectedCount = prog.collectedItems.size
      const completionPercent = totalItems > 0 ? Math.round((collectedCount / totalItems) * 100) : 0

      // 查找下一件未收集物品
      const missingItemId = set.itemIds.find((id) => !prog.collectedItems.has(id))
      const nextMissingItem = missingItemId
        ? allItems.find((i) => i.id === missingItemId) ?? null
        : null

      result.push({
        set,
        progress: prog,
        completionPercent,
        nextMissingItem,
      })
    }

    return result
  }

  /**
   * 获取指定套装的展示数据
   */
  getDisplayData(setId: string, allItems: InventoryItem[]): CollectionDisplayData | null {
    const set = this.sets.get(setId)
    if (!set) return null
    const all = this.getAllDisplayData(allItems)
    return all.find((d) => d.set.id === setId) ?? null
  }

  /**
   * 获取指定套装的进度
   */
  getProgress(setId: string): CollectionProgress | null {
    return this.progress.get(setId) ?? null
  }

  /**
   * 获取总体收集进度百分比
   */
  getOverallCompletionPercent(): number {
    let totalItems = 0
    let collectedItems = 0

    for (const [setId, set] of this.sets) {
      const prog = this.progress.get(setId)
      if (!prog) continue
      totalItems += set.itemIds.length
      collectedItems += prog.collectedItems.size
    }

    return totalItems > 0 ? Math.round((collectedItems / totalItems) * 100) : 0
  }

  // ============ 回调设置 ============

  /** 设置奖励领取回调 */
  setOnRewardClaim(callback: (setId: string, fvReward: number, bonusRewards?: CollectionSet['bonusRewards']) => void): void {
    this.onRewardClaim = callback
  }

  /** 设置进度变化回调 */
  setOnProgressChange(callback: (setData: CollectionDisplayData[]) => void): void {
    this.onProgressChange = callback
  }

  // ============ 序列化 ============

  /** 序列化进度数据（用于持久化） */
  serialize(): Array<{
    setId: string
    collectedItems: string[]
    completed: boolean
    rewardClaimed: boolean
    inUseItems: string[]
  }> {
    const result: Array<{
      setId: string
      collectedItems: string[]
      completed: boolean
      rewardClaimed: boolean
      inUseItems: string[]
    }> = []

    for (const [setId, prog] of this.progress) {
      result.push({
        setId,
        collectedItems: [...prog.collectedItems],
        completed: prog.completed,
        rewardClaimed: prog.rewardClaimed,
        inUseItems: [...prog.inUseItems],
      })
    }

    return result
  }

  /** 反序列化进度数据 */
  deserialize(data: Array<{
    setId: string
    collectedItems: string[]
    completed: boolean
    rewardClaimed: boolean
    inUseItems: string[]
  }>): void {
    for (const item of data) {
      const prog = this.progress.get(item.setId)
      if (!prog) continue
      prog.collectedItems = new Set(item.collectedItems)
      prog.completed = item.completed
      prog.rewardClaimed = item.rewardClaimed
      prog.inUseItems = new Set(item.inUseItems)
    }
    this.notifyProgressChange()
  }

  // ============ 内部方法 ============

  private notifyProgressChange(): void {
    if (!this.onProgressChange) return
    // 需要从外部获取 allItems，此处暂用空数组
    this.onProgressChange(this.getAllDisplayData([]))
  }
}

// ============ 单例 ============

let instance: CollectionManager | null = null

/** 获取收藏系统管理器单例 */
export function getCollectionManager(): CollectionManager {
  if (!instance) {
    instance = new CollectionManager()
  }
  return instance
}

/** 重置单例（测试用） */
export function resetCollectionManager(): void {
  instance = null
}
