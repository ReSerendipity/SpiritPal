/**
 * @file shopManager.ts
 * @description 商店管理器模块 — SpiritPal 商店 UI 后端逻辑
 *
 * 核心功能：
 * 1. 商品目录管理（浏览/搜索/筛选）
 * 2. 锁状态机：FVLOCK（亲密度锁定）/ PETLIMIT（角色限制）/ NONE（已解锁）
 * 3. 买卖逻辑与金币结算
 * 4. 出售折价：ITEM_DEPRECIATION = 0.75（卖价 = 买价 × 0.75）
 * 5. 物品分类：food / toy / medicine / accessory / collection / dialogue / subpet
 * 6. 搜索防抖、petLimit 角色限制、fvReward 亲密度奖励显示
 *
 * 主要模块：
 * - ShopLockState: 锁状态枚举
 * - ShopCatalogEntry: 目录条目接口
 * - ShopManager: 商店管理器类
 *
 * 依赖关系：
 * - ./types: InventoryItem, NurturingStats, BuffConfig 类型
 * - ../stores/petStore: Zustand 宠物状态管理
 * - ./items: getAllShopItems, FOODS_BY_CHARACTER 物品数据
 * - ./behaviorEngine: getAffectionLevel 亲密度等级计算
 *
 * 核心接口：
 * - ShopManager.getCatalog(): 获取商品目录
 * - ShopManager.buyItem(): 购买物品
 * - ShopManager.sellItem(): 出售物品
 * - ShopManager.searchItems(): 搜索商品
 * - getShopManager(): 获取单例实例
 *
 * 锁状态判定优先级：PETLIMIT > FVLOCK > NONE
 *
 * Phase 2.2: petLimit 角色限制、fvReward 亲密度奖励显示、搜索防抖
 */

import type { InventoryItem, NurturingStats } from './types'
import { usePetStore } from '../stores/petStore'
import { getAllShopItems, FOODS_BY_CHARACTER } from './items'
import { getAffectionLevel } from './behaviorEngine'

export enum ShopLockState {
  /** 已解锁，可购买 */
  NONE = 'NONE',
  /** 亲密度等级不足，暂时锁定 */
  FVLOCK = 'FVLOCK',
  /** 角色限制——该物品属于其他角色 */
  PETLIMIT = 'PETLIMIT',
}

/** 锁状态类型 */
export type ShopLockStateType = ShopLockState

// 卖价 = 买价 × ITEM_DEPRECIATION
export const ITEM_DEPRECIATION = 0.75

// ============ 商店物品分类 ============
export type ShopCategory = 'food' | 'toy' | 'medicine' | 'accessory' | 'collection' | 'dialogue' | 'subpet'

// ============ 目录条目（getCatalog / searchItems / filterByCategory 返回）============
export interface ShopCatalogEntry {
  item: InventoryItem
  /** 当前角色对该物品的锁状态 */
  lockState: ShopLockState
  /** 折价后的出售价 */
  sellPrice: number
  /** 背包中已持有数量 */
  owned: number
}

/**
 * 商店管理器
 *
 * 负责商品目录的浏览/搜索/筛选、锁状态判定以及买卖金币结算。
 * 通过单例 getShopManager() 获取实例。
 *
 */
export class ShopManager {
  /** 物品 id → 所属角色 id（仅食物有归属，用于 PETLIMIT 判定） */
  private itemOwnerMap: Map<string, string> = new Map()
  /** 全量物品缓存（id → item），跨所有角色，用于按 id 查找 */
  private allItemsMap: Map<string, InventoryItem> = new Map()

  constructor() {
    // 食物：记录归属角色 + 加入全量映射
    for (const [charId, foods] of Object.entries(FOODS_BY_CHARACTER)) {
      for (const food of foods) {
        this.itemOwnerMap.set(food.id, charId)
        this.allItemsMap.set(food.id, food)
      }
    }
    // 通用物品（玩具/药品/装饰品/收集品）无角色归属，加入全量映射
    // getAllShopItems 返回某角色专属食物 + 全部通用物品，此处只取尚未收录的通用物品
    const firstChar = Object.keys(FOODS_BY_CHARACTER)[0] ?? 'doro'
    for (const item of getAllShopItems(firstChar)) {
      if (!this.allItemsMap.has(item.id)) {
        this.allItemsMap.set(item.id, item)
      }
    }
  }

  // ============ 目录浏览 ============

  /**
   * 获取当前角色的完整商品目录
   * 每个条目包含物品、锁状态、出售价、持有数量
   */
  getCatalog(): ShopCatalogEntry[] {
    const charId = usePetStore.getState().currentCharacterId
    const items = getAllShopItems(charId)
    const inventory = usePetStore.getState().inventory
    return items.map((item) => {
      const owned = inventory.find((i) => i.id === item.id)?.count ?? 0
      return {
        item,
        lockState: this.getLockState(item.id),
        sellPrice: this.calculateSellPrice(item.price),
        owned,
      }
    })
  }

  /**
   * 按关键词搜索商品（匹配名称或描述，不区分大小写）
   * 空关键词返回完整目录
   */
  searchItems(keyword: string): ShopCatalogEntry[] {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return this.getCatalog()
    return this.getCatalog().filter((entry) => {
      const name = entry.item.name.toLowerCase()
      const desc = (entry.item.description ?? '').toLowerCase()
      return name.includes(kw) || desc.includes(kw)
    })
  }

  /**
   * 按分类筛选商品
   */
  filterByCategory(category: ShopCategory): ShopCatalogEntry[] {
    return this.getCatalog().filter((entry) => entry.item.type === category)
  }

  // ============ 锁状态机 ============

  /**
   * 判定物品的锁状态（优先级：PETLIMIT > FVLOCK > NONE）
   * - PETLIMIT：物品属于其他角色（食物有角色归属）
   * - FVLOCK：当前角色亲密度等级 < 物品所需 fvLock
   * - NONE：已解锁
   */
  getLockState(itemId: string): ShopLockState {
    const charId = usePetStore.getState().currentCharacterId

    // PETLIMIT：食物归属其他角色
    const owner = this.itemOwnerMap.get(itemId)
    if (owner && owner !== charId) {
      return ShopLockState.PETLIMIT
    }

    const item = this.allItemsMap.get(itemId)
    if (!item) return ShopLockState.PETLIMIT

    // FVLOCK：亲密度等级不足
    const fvLock = item.fvLock ?? 0
    if (fvLock > 0) {
      const stats: NurturingStats = usePetStore.getState().getCurrentStats()
      const friendshipLevel = getAffectionLevel(stats.affection)
      if (friendshipLevel < fvLock) {
        return ShopLockState.FVLOCK
      }
    }

    return ShopLockState.NONE
  }

  // ============ 买卖逻辑 ============

  /**
   * 是否可购买：锁状态为 NONE 且金币充足
   */
  canBuy(itemId: string): boolean {
    if (this.getLockState(itemId) !== ShopLockState.NONE) return false
    const item = this.allItemsMap.get(itemId)
    if (!item) return false
    return usePetStore.getState().sharedCoins >= item.price
  }

  /**
   * 是否可出售：背包中持有该物品且数量 > 0
   */
  canSell(itemId: string): boolean {
    const inv = usePetStore.getState().inventory
    const owned = inv.find((i) => i.id === itemId)?.count ?? 0
    return owned > 0
  }

  /**
   * 购买物品
   * @returns true 购买成功；false 金币不足或已锁定
   */
  buyItem(itemId: string): boolean {
    if (!this.canBuy(itemId)) return false
    const item = this.allItemsMap.get(itemId)
    if (!item) return false
    return usePetStore.getState().buyItem(item)
  }

  /**
   * 出售物品（折价回收）
   * 卖价 = 买价 × ITEM_DEPRECIATION（向下取整）
   * @returns true 出售成功；false 背包无该物品
   */
  sellItem(itemId: string): boolean {
    const invItem = usePetStore.getState().inventory.find((i) => i.id === itemId)
    if (!invItem || invItem.count < 1) return false

    const sellPrice = this.calculateSellPrice(invItem.price)

    // 从背包扣减一件（数量归零则移除）
    usePetStore.setState((state) => {
      const newInventory = state.inventory
        .map((i) => (i.id === itemId ? { ...i, count: i.count - 1 } : i))
        .filter((i) => i.count > 0)
      return { inventory: newInventory }
    })

    // 回收金币
    usePetStore.getState().addCoins(sellPrice)
    return true
  }

  // ============ 工具方法 ============

  /**
   * 计算出售价（折价后向下取整）
   * 卖价 = 买价 × ITEM_DEPRECIATION
   */
  calculateSellPrice(buyPrice: number): number {
    return Math.floor(buyPrice * ITEM_DEPRECIATION)
  }

  // ============ Phase 2.2 增强方法 ============

  /**
   * 获取各分类的物品数量
   * @returns 分类 → 数量映射
   */
  getCategoryCounts(): Record<ShopCategory, number> {
    const catalog = this.getCatalog()
    const counts: Record<string, number> = {}
    for (const entry of catalog) {
      const cat = entry.item.type as ShopCategory
      counts[cat] = (counts[cat] ?? 0) + 1
    }
    return counts as Record<ShopCategory, number>
  }

  /**
   * 搜索防抖 — 返回防抖化的搜索函数
   *
   * @param delay 防抖延迟（毫秒），默认 300ms
   * @returns 防抖化的搜索函数
   */
  createDebouncedSearch(delay: number = 300): (keyword: string) => void {
    let timer: ReturnType<typeof setTimeout> | null = null
    let latestKeyword = ''
    let onResult: ((results: ShopCatalogEntry[]) => void) | null = null

    const debounced = (keyword: string) => {
      latestKeyword = keyword
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        const results = debounced.search(latestKeyword)
        onResult?.(results)
      }, delay)
    }

    debounced.search = (keyword: string) => this.searchItems(keyword)
    debounced.setOnResult = (callback: (results: ShopCatalogEntry[]) => void) => {
      onResult = callback
    }
    debounced.cancel = () => {
      if (timer) clearTimeout(timer)
    }

    return debounced as ((keyword: string) => void) & {
      search: (keyword: string) => ShopCatalogEntry[]
      setOnResult: (callback: (results: ShopCatalogEntry[]) => void) => void
      cancel: () => void
    }
  }

  /**
   * 获取物品的锁状态显示信息
   * 用于 UI 展示锁定原因
   */
  getLockDisplayInfo(itemId: string): {
    state: ShopLockState
    requiredLevel?: number
    restrictedCharacter?: string
  } {
    const lockState = this.getLockState(itemId)
    const item = this.allItemsMap.get(itemId)

    if (lockState === ShopLockState.FVLOCK && item) {
      return {
        state: lockState,
        requiredLevel: item.fvLock,
      }
    }

    if (lockState === ShopLockState.PETLIMIT) {
      const owner = this.itemOwnerMap.get(itemId)
      // 检查 petLimit 字段
      if (item?.petLimit && item.petLimit.length > 0) {
        return {
          state: lockState,
          restrictedCharacter: item.petLimit[0],
        }
      }
      if (owner) {
        return {
          state: lockState,
          restrictedCharacter: owner,
        }
      }
    }

    return { state: lockState }
  }

  /**
   * 获取物品使用时的亲密度奖励
   */
  getItemFvReward(itemId: string): number {
    const item = this.allItemsMap.get(itemId)
    return item?.fvReward ?? 0
  }

  /**
   * 判断物品是否对当前角色有角色限制（petLimit）
   */
  isPetLimited(itemId: string): boolean {
    const charId = usePetStore.getState().currentCharacterId
    const item = this.allItemsMap.get(itemId)
    if (!item?.petLimit) return false
    return !item.petLimit.includes(charId)
  }

  /**
   * 销毁实例：清理物品缓存，防止内存泄漏
   * 在切换角色或应用退出时调用
   */
  dispose(): void {
    this.itemOwnerMap.clear()
    this.allItemsMap.clear()
    if (shopManagerInstance === this) {
      shopManagerInstance = null
    }
  }
}

// ============ 单例 ============
let shopManagerInstance: ShopManager | null = null

/** 获取商店管理器单例 */
export function getShopManager(): ShopManager {
  if (!shopManagerInstance) {
    shopManagerInstance = new ShopManager()
  }
  return shopManagerInstance
}
