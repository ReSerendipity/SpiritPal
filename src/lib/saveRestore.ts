/**
 * 存档储备恢复模块
 *
 * @fileoverview 储备数值(StoredStrength)延迟恢复机制，按比例逐步转化储备为当前值（参考VPet）
 *
 * 主要模块：
 * - StoredStrength: 储备数值结构
 * - SaveRestoreConfig/DEFAULT_SAVE_RESTORE_CONFIG: 恢复配置
 * - RestoreState: 恢复过程状态
 * - SaveRestoreManager: 储备恢复管理器
 *
 * 依赖关系：
 * - types.ts: NurturingStats养成数值类型
 *
 * 核心接口：
 * - storeStrength(): 关闭时将当前值存入储备
 * - startRestore(): 启动储备→当前值转化
 * - tickRestore(): 定时执行转化
 * - getStoredStrength(): 获取当前储备值
 * - cancelRestore(): 取消恢复过程
 *
 * 核心功能（参考VPet StoreStrength/StoreStrengthFood机制）：
 * 1. 储备存储：关闭应用时饱食度/心情/健康存入"储备"
 * 2. 比例转化：按1/10比例逐步从stored→current（默认3秒一次）
 * 3. 防瞬间满血：重启后数值渐进恢复而非直接回满
 * 4. 可配置：恢复比例、间隔、最小阈值均可配置
 *
 * 背景：VPet中关闭应用时数值存入储备，重新打开时按比例逐步转化
 */

import type { NurturingStats } from './types'

// ============ 储备数据结构 ============

/** 储备数值 — 存档时保存的延迟恢复储备 */
export interface StoredStrength {
  /** 饱食度储备 */
  hunger: number
  /** 心情储备 */
  mood: number
  /** 健康储备 */
  health: number
  /** 储备时间戳（存档时的时间） */
  storedAt: number
}

/** 延迟恢复配置 */
export interface SaveRestoreConfig {
  /** 每次恢复的转化比例（默认 1/10） */
  restoreRatio: number
  /** 恢复间隔（毫秒，默认 3000 = 3秒） */
  restoreInterval: number
  /** 单次恢复最小值（低于此值直接清零） */
  minRestoreThreshold: number
  /** 是否启用延迟恢复（false = 直接恢复） */
  enabled: boolean
}

/** 默认配置 */
export const DEFAULT_SAVE_RESTORE_CONFIG: SaveRestoreConfig = {
  restoreRatio: 0.1,       // 1/10
  restoreInterval: 3000,   // 3秒
  minRestoreThreshold: 1,  // 低于 1 点直接清零
  enabled: true,
}

// ============ 恢复状态 ============

/** 恢复过程状态 */
export interface RestoreState {
  /** 是否正在恢复中 */
  isRestoring: boolean
  /** 剩余储备 */
  remaining: StoredStrength
  /** 已恢复总量 */
  restored: { hunger: number; mood: number; health: number }
  /** 开始恢复时间 */
  startedAt: number | null
  /** 预计完成时间 */
  estimatedCompletionAt: number | null
}

// ============ SaveRestoreManager ============

/**
 * 存档延迟恢复管理器
 *
 * 参考 VPet 的 StoreStrength/StoreStrengthFood 机制：
 * - 关闭应用时，将当前饱食度/心情/健康存入储备字段
 * - 重新打开时，按 1/10 比例逐步从储备转化为当前值
 * - 防止重启后瞬间满血恢复，提供渐进式体验
 *
 * 通过 getSaveRestoreManager() 获取单例。
 */
export class SaveRestoreManager {
  private config: SaveRestoreConfig
  /** 储备数值 */
  private stored: StoredStrength = { hunger: 0, mood: 0, health: 0, storedAt: 0 }
  /** 恢复定时器 */
  private restoreTimer: ReturnType<typeof setInterval> | null = null
  /** 恢复状态 */
  private state: RestoreState = {
    isRestoring: false,
    remaining: { hunger: 0, mood: 0, health: 0, storedAt: 0 },
    restored: { hunger: 0, mood: 0, health: 0 },
    startedAt: null,
    estimatedCompletionAt: null,
  }
  /** 恢复回调 — 每次转化时调用 */
  private onRestore: ((restored: { hunger: number; mood: number; health: number }) => void) | null = null
  /** 恢复完成回调 */
  private onRestoreComplete: (() => void) | null = null

  constructor(config?: Partial<SaveRestoreConfig>) {
    this.config = { ...DEFAULT_SAVE_RESTORE_CONFIG, ...config }
  }

  // ============ 存档（应用关闭时调用）============

  /**
   * 将当前数值存入储备
   * 在应用关闭时调用，将当前饱食度/心情/健康的一部分存入储备
   * （不是存全部，而是存超出衰减后的部分）
   *
   * @param stats 当前养成数值
   * @param offlineHours 离线时长（小时）
   */
  storeStrength(stats: NurturingStats, offlineHours: number = 0): StoredStrength {
    // 计算离线衰减后的剩余值
    const hungerAfterDecay = Math.max(0, stats.hunger - offlineHours * 2)
    const moodAfterDecay = Math.max(0, stats.mood - offlineHours * 1.5)
    const healthDecayFromHunger = stats.hunger < 20 ? offlineHours * 5 : 0
    const healthAfterDecay = Math.max(0, stats.health - healthDecayFromHunger)

    // 存入储备的是衰减后的值的一部分（50%）
    // 这样重开时只恢复一部分，不会瞬间满值
    this.stored = {
      hunger: Math.floor(hungerAfterDecay * 0.5),
      mood: Math.floor(moodAfterDecay * 0.5),
      health: Math.floor(healthAfterDecay * 0.5),
      storedAt: Date.now(),
    }

    return { ...this.stored }
  }

  // ============ 恢复（应用启动时调用）============

  /**
   * 从储备开始延迟恢复
   * 在应用启动时调用，按 1/10 比例逐步恢复
   *
   * @param stored 储备数据（从持久化加载）
   */
  startRestore(stored: StoredStrength): void {
    if (!this.config.enabled) {
      // 不启用延迟恢复，直接一次性恢复
      this.onRestore?.({
        hunger: stored.hunger,
        mood: stored.mood,
        health: stored.health,
      })
      this.onRestoreComplete?.()
      return
    }

    // 初始化恢复状态
    this.stored = { ...stored }
    this.state = {
      isRestoring: true,
      remaining: { ...stored },
      restored: { hunger: 0, mood: 0, health: 0 },
      startedAt: Date.now(),
      estimatedCompletionAt: this.estimateCompletionTime(stored),
    }

    // 启动定时恢复
    this.startRestoreTimer()
  }

  /**
   * 停止恢复过程
   */
  stopRestore(): void {
    if (this.restoreTimer) {
      clearInterval(this.restoreTimer)
      this.restoreTimer = null
    }
    this.state.isRestoring = false
  }

  // ============ 查询 ============

  /**
   * 获取当前恢复状态
   */
  getRestoreState(): RestoreState {
    return { ...this.state }
  }

  /**
   * 是否正在恢复中
   */
  isRestoring(): boolean {
    return this.state.isRestoring
  }

  /**
   * 获取恢复进度百分比
   */
  getRestoreProgress(): number {
    const totalStored = this.stored.hunger + this.stored.mood + this.stored.health
    if (totalStored === 0) return 100

    const totalRemaining = this.state.remaining.hunger + this.state.remaining.mood + this.state.remaining.health
    const restored = totalStored - totalRemaining
    return Math.round((restored / totalStored) * 100)
  }

  // ============ 回调 ============

  /** 设置恢复回调（每次转化时触发） */
  setOnRestore(callback: (restored: { hunger: number; mood: number; health: number }) => void): void {
    this.onRestore = callback
  }

  /** 设置恢复完成回调 */
  setOnRestoreComplete(callback: () => void): void {
    this.onRestoreComplete = callback
  }

  // ============ 序列化 ============

  /** 序列化储备数据（用于持久化） */
  serialize(): StoredStrength | null {
    if (this.stored.hunger === 0 && this.stored.mood === 0 && this.stored.health === 0) {
      return null
    }
    return { ...this.stored }
  }

  /** 反序列化储备数据 */
  deserialize(data: StoredStrength): void {
    this.stored = { ...data }
  }

  // ============ 内部方法 ============

  /** 启动定时恢复 */
  private startRestoreTimer(): void {
    if (this.restoreTimer) clearInterval(this.restoreTimer)

    this.restoreTimer = setInterval(
      () => this.performRestoreTick(),
      this.config.restoreInterval,
    )
  }

  /** 执行一次恢复 tick（1/10 比例转化） */
  private performRestoreTick(): void {
    if (!this.state.isRestoring) return

    const ratio = this.config.restoreRatio
    const minThreshold = this.config.minRestoreThreshold

    const restored = {
      hunger: this.calculateRestore(this.state.remaining.hunger, ratio, minThreshold),
      mood: this.calculateRestore(this.state.remaining.mood, ratio, minThreshold),
      health: this.calculateRestore(this.state.remaining.health, ratio, minThreshold),
    }

    // 更新储备剩余
    this.state.remaining.hunger -= restored.hunger
    this.state.remaining.mood -= restored.mood
    this.state.remaining.health -= restored.health

    // 累加已恢复量
    this.state.restored.hunger += restored.hunger
    this.state.restored.mood += restored.mood
    this.state.restored.health += restored.health

    // 触发回调
    if (restored.hunger > 0 || restored.mood > 0 || restored.health > 0) {
      this.onRestore?.(restored)
    }

    // 检查是否恢复完成
    const totalRemaining = this.state.remaining.hunger + this.state.remaining.mood + this.state.remaining.health
    if (totalRemaining <= 0) {
      this.state.isRestoring = false
      this.stopRestore()
      this.onRestoreComplete?.()
    }
  }

  /** 计算单次恢复量 */
  private calculateRestore(remaining: number, ratio: number, minThreshold: number): number {
    if (remaining <= 0) return 0
    const restore = Math.max(1, Math.round(remaining * ratio))
    // 如果剩余值小于最小阈值，直接清零
    if (remaining <= minThreshold) return remaining
    return Math.min(restore, remaining)
  }

  /** 估算完成时间 */
  private estimateCompletionTime(stored: StoredStrength): number {
    const total = stored.hunger + stored.mood + stored.health
    if (total === 0) return Date.now()

    // 每次恢复约 1/10，需要约 10 次，加上尾数约 15 次
    const estimatedTicks = 15
    return Date.now() + estimatedTicks * this.config.restoreInterval
  }

  /** 销毁管理器 */
  destroy(): void {
    this.stopRestore()
    this.onRestore = null
    this.onRestoreComplete = null
  }
}

// ============ 单例 ============

let instance: SaveRestoreManager | null = null

/** 获取存档延迟恢复管理器单例 */
export function getSaveRestoreManager(): SaveRestoreManager {
  if (!instance) {
    instance = new SaveRestoreManager()
  }
  return instance
}

/** 重置单例（测试用） */
export function resetSaveRestoreManager(): void {
  if (instance) {
    instance.destroy()
    instance = null
  }
}
