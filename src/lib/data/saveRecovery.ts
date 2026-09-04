/**
 * 存档渐进恢复模块
 *
 * @fileoverview StoreStrength/StoreStrengthFood概念实现，防止加载存档后"瞬间满血"（参考VPet）
 *
 * 主要模块：
 * - StoreStrength: 存档时真实数值快照
 * - StoreStrengthFood: 食物恢复效果累计值
 * - SaveData: 完整存档数据结构
 * - SaveRecoveryManager: 渐进恢复管理器
 *
 * 依赖关系：
 * - types.ts: NurturingStats养成数值类型
 *
 * 核心接口：
 * - createSaveSnapshot(): 创建存档快照（保存StoreStrength）
 * - startRecovery(): 启动渐进恢复
 * - tickRecovery(): 每帧/每tick执行恢复
 * - getCurrentStats(): 获取当前显示数值
 * - isRecoveryComplete(): 恢复是否完成
 *
 * 核心问题（参考VPet GraphCore.cs + GameSave.cs）：
 * 直接加载存档会导致数值瞬间从衰减状态恢复到存档时的高值，造成"瞬间满血"
 *
 * 解决方案：
 * 1. StoreStrength/StoreStrengthFood：存档中保存"真实"数值
 * 2. 加载后不直接赋值，按1/10比例渐进恢复
 * 3. 每个tick恢复(存档值-当前值)/10
 * 4. 恢复速率可配置
 */

import type { NurturingStats } from './types'

// ============ 存档数据 ============

/** 存档中的数值快照（StoreStrength 概念） */
export interface StoreStrength {
  /** 存档时的饱食度 */
  hunger: number
  /** 存档时的心情 */
  mood: number
  /** 存档时的健康 */
  health: number
  /** 存档时的亲密度 */
  affection: number
}

/** 存档中的食物恢复值快照（StoreStrengthFood 概念） */
export interface StoreStrengthFood {
  /** 存档时的食物恢复效果累计值 */
  hungerRestore: number
  /** 存档时的心情恢复效果累计值 */
  moodRestore: number
  /** 存档时的健康恢复效果累计值 */
  healthRestore: number
}

/** 完整存档数据 */
export interface SaveData {
  /** 存档版本 */
  version: number
  /** 存档时间戳 */
  savedAt: number
  /** StoreStrength：存档时的真实数值 */
  strength: StoreStrength
  /** StoreStrengthFood：存档时的食物恢复累计 */
  strengthFood: StoreStrengthFood
  /** 其他养成数据 */
  stats: NurturingStats
}

// ============ 恢复配置 ============

/** 恢复速率配置 */
export interface RecoveryConfig {
  /** 渐进恢复比例（每个 tick 恢复差距的多少） */
  recoveryRatio: number
  /** 恢复 tick 间隔（毫秒） */
  tickInterval: number
  /** 恢复完成阈值（当差距小于此值时直接赋值） */
  completionThreshold: number
  /** 是否启用渐进恢复（false 则直接赋值） */
  enabled: boolean
  /** 饱食度恢复速率倍率 */
  hungerMultiplier: number
  /** 心情恢复速率倍率 */
  moodMultiplier: number
  /** 健康恢复速率倍率 */
  healthMultiplier: number
  /** 亲密度恢复速率倍率 */
  affectionMultiplier: number
}

/** 默认恢复配置（1/10 比例渐进恢复） */
export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
  recoveryRatio: 0.1,          // 每次恢复差距的 10%
  tickInterval: 1000,          // 每秒 tick
  completionThreshold: 1,      // 差距 < 1 时直接赋值
  enabled: true,
  hungerMultiplier: 1.0,
  moodMultiplier: 1.0,
  healthMultiplier: 1.0,
  affectionMultiplier: 0.5,    // 亲密度恢复更慢
}

// ============ 恢复状态 ============

/** 渐进恢复状态 */
export interface RecoveryState {
  /** 目标值（存档中的真实值） */
  target: StoreStrength
  /** 是否正在恢复中 */
  recovering: boolean
  /** 恢复开始时间 */
  startedAt: number
  /** 预计完成时间 */
  estimatedEndAt: number
  /** 已恢复进度（0-1） */
  progress: number
}

// ============ 存档延迟恢复管理器 ============

/**
 * 存档延迟恢复管理器
 *
 * 工作流程：
 * 1. loadSave: 加载存档，提取 StoreStrength 作为目标值
 * 2. 不直接赋值，而是将目标值和当前值的差距记录下来
 * 3. 每个 tick 按比例恢复：current += (target - current) * recoveryRatio
 * 4. 当差距 < completionThreshold 时直接赋值完成
 *
 * 防止场景：
 * - 存档时 hunger=90，离线 8 小时后衰减到 hunger=10
 * - 不恢复：hunger 从 10 瞬间跳到 90（不合理）
 * - 渐进恢复：hunger 从 10 逐步恢复到 90（每个 tick 恢复差距的 10%）
 *
 * 通过单例 getSaveRecoveryManager() 获取实例
 */
export class SaveRecoveryManager {
  private config: RecoveryConfig
  /** 当前恢复状态（每个角色独立） */
  private recoveryStates: Map<string, RecoveryState> = new Map()
  /** tick 定时器 */
  private tickIntervalId: ReturnType<typeof setInterval> | null = null
  /** 恢复完成回调 */
  private onRecoveryComplete: ((characterId: string) => void) | null = null
  /** 恢复进度回调 */
  private onRecoveryProgress: ((characterId: string, progress: number) => void) | null = null
  /** 获取当前养成数据的回调 */
  private getStats: ((characterId: string) => NurturingStats) | null = null
  /** 更新养成数据的回调 */
  private updateStats: ((characterId: string, updates: Partial<NurturingStats>) => void) | null = null

  constructor(config: RecoveryConfig = DEFAULT_RECOVERY_CONFIG) {
    this.config = config
  }

  /** 设置恢复完成回调 */
  setOnRecoveryComplete(callback: (characterId: string) => void): void {
    this.onRecoveryComplete = callback
  }

  /** 设置恢复进度回调 */
  setOnRecoveryProgress(callback: (characterId: string, progress: number) => void): void {
    this.onRecoveryProgress = callback
  }

  /** 设置养成数据访问回调 */
  setStatsAccessors(
    getStats: (characterId: string) => NurturingStats,
    updateStats: (characterId: string, updates: Partial<NurturingStats>) => void,
  ): void {
    this.getStats = getStats
    this.updateStats = updateStats
  }

  // ============ 加载存档 ============

  /**
   * 加载存档并开始渐进恢复
   *
   * @param characterId 角色 ID
   * @param saveData 存档数据
   * @param currentStats 当前（衰减后的）养成数值
   */
  loadSave(
    characterId: string,
    saveData: SaveData,
    currentStats: NurturingStats,
  ): void {
    if (!this.config.enabled) {
      // 不启用渐进恢复，直接赋值
      this.updateStats?.(characterId, {
        hunger: saveData.strength.hunger,
        mood: saveData.strength.mood,
        health: saveData.strength.health,
        affection: saveData.strength.affection,
      })
      return
    }

    // 计算差距
    const hungerDiff = saveData.strength.hunger - currentStats.hunger
    const moodDiff = saveData.strength.mood - currentStats.mood
    const healthDiff = saveData.strength.health - currentStats.health
    const affectionDiff = saveData.strength.affection - currentStats.affection

    // 如果差距都很小，直接赋值
    if (
      Math.abs(hungerDiff) < this.config.completionThreshold &&
      Math.abs(moodDiff) < this.config.completionThreshold &&
      Math.abs(healthDiff) < this.config.completionThreshold &&
      Math.abs(affectionDiff) < this.config.completionThreshold
    ) {
      this.updateStats?.(characterId, {
        hunger: saveData.strength.hunger,
        mood: saveData.strength.mood,
        health: saveData.strength.health,
        affection: saveData.strength.affection,
      })
      return
    }

    // 创建恢复状态
    const now = Date.now()
    const maxDiff = Math.max(
      Math.abs(hungerDiff),
      Math.abs(moodDiff),
      Math.abs(healthDiff),
      Math.abs(affectionDiff),
    )
    // 估算恢复时间：log(maxDiff/threshold) / log(1/(1-ratio)) * tickInterval
    const ticksToComplete = Math.ceil(
      Math.log(maxDiff / this.config.completionThreshold) /
      Math.log(1 / (1 - this.config.recoveryRatio)),
    )

    const state: RecoveryState = {
      target: saveData.strength,
      recovering: true,
      startedAt: now,
      estimatedEndAt: now + ticksToComplete * this.config.tickInterval,
      progress: 0,
    }

    this.recoveryStates.set(characterId, state)
    this.ensureTicking()
  }

  // ============ 渐进恢复 tick ============

  /** 恢复 tick（每个 interval 调用一次） */
  private recoveryTick(): void {
    for (const [characterId, state] of this.recoveryStates) {
      if (!state.recovering) continue

      const currentStats = this.getStats?.(characterId)
      if (!currentStats) continue

      // 计算渐进恢复增量
      const updates: Partial<NurturingStats> = {}

      // 饱食度恢复
      const hungerDiff = state.target.hunger - currentStats.hunger
      if (Math.abs(hungerDiff) > this.config.completionThreshold) {
        updates.hunger = currentStats.hunger + hungerDiff * this.config.recoveryRatio * this.config.hungerMultiplier
      } else {
        updates.hunger = state.target.hunger
      }

      // 心情恢复
      const moodDiff = state.target.mood - currentStats.mood
      if (Math.abs(moodDiff) > this.config.completionThreshold) {
        updates.mood = currentStats.mood + moodDiff * this.config.recoveryRatio * this.config.moodMultiplier
      } else {
        updates.mood = state.target.mood
      }

      // 健康恢复
      const healthDiff = state.target.health - currentStats.health
      if (Math.abs(healthDiff) > this.config.completionThreshold) {
        updates.health = currentStats.health + healthDiff * this.config.recoveryRatio * this.config.healthMultiplier
      } else {
        updates.health = state.target.health
      }

      // 亲密度恢复
      const affectionDiff = state.target.affection - currentStats.affection
      if (Math.abs(affectionDiff) > this.config.completionThreshold) {
        updates.affection = currentStats.affection + affectionDiff * this.config.recoveryRatio * this.config.affectionMultiplier
      } else {
        updates.affection = state.target.affection
      }

      // 应用更新
      this.updateStats?.(characterId, updates)

      // 更新进度
      const newStats = this.getStats?.(characterId) ?? currentStats
      const currentSum = newStats.hunger + newStats.mood + newStats.health
      const targetSum = state.target.hunger + state.target.mood + state.target.health
      state.progress = targetSum > 0 ? currentSum / targetSum : 1

      this.onRecoveryProgress?.(characterId, state.progress)

      // 检查是否完成
      const allComplete =
        Math.abs(state.target.hunger - newStats.hunger) <= this.config.completionThreshold &&
        Math.abs(state.target.mood - newStats.mood) <= this.config.completionThreshold &&
        Math.abs(state.target.health - newStats.health) <= this.config.completionThreshold &&
        Math.abs(state.target.affection - newStats.affection) <= this.config.completionThreshold

      if (allComplete) {
        // 最终赋值确保精确
        this.updateStats?.(characterId, {
          hunger: state.target.hunger,
          mood: state.target.mood,
          health: state.target.health,
          affection: state.target.affection,
        })
        state.recovering = false
        state.progress = 1
        this.onRecoveryComplete?.(characterId)
      }
    }

    // 如果没有正在恢复的，停止定时器
    const anyRecovering = Array.from(this.recoveryStates.values()).some(s => s.recovering)
    if (!anyRecovering) {
      this.stopTicking()
    }
  }

  /** 确保定时器运行 */
  private ensureTicking(): void {
    if (this.tickIntervalId !== null) return
    this.tickIntervalId = setInterval(
      () => this.recoveryTick(),
      this.config.tickInterval,
    )
  }

  /** 停止定时器 */
  private stopTicking(): void {
    if (this.tickIntervalId !== null) {
      clearInterval(this.tickIntervalId)
      this.tickIntervalId = null
    }
  }

  // ============ 查询 ============

  /** 获取角色的恢复状态 */
  getRecoveryState(characterId: string): RecoveryState | undefined {
    return this.recoveryStates.get(characterId)
  }

  /** 角色是否正在恢复中 */
  isRecovering(characterId: string): boolean {
    return this.recoveryStates.get(characterId)?.recovering ?? false
  }

  /** 取消恢复（直接赋目标值） */
  cancelRecovery(characterId: string): void {
    const state = this.recoveryStates.get(characterId)
    if (!state) return
    this.updateStats?.(characterId, {
      hunger: state.target.hunger,
      mood: state.target.mood,
      health: state.target.health,
      affection: state.target.affection,
    })
    state.recovering = false
    state.progress = 1
  }

  /** 更新配置 */
  updateConfig(config: Partial<RecoveryConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /** 销毁（清理定时器） */
  destroy(): void {
    this.stopTicking()
    this.recoveryStates.clear()
  }
}

// ============ 存档创建 ============

/**
 * 创建存档快照
 * @param stats 当前养成数值
 * @returns 存档数据
 */
export function createSaveData(stats: NurturingStats): SaveData {
  return {
    version: 1,
    savedAt: Date.now(),
    strength: {
      hunger: stats.hunger,
      mood: stats.mood,
      health: stats.health,
      affection: stats.affection,
    },
    strengthFood: {
      hungerRestore: 0,
      moodRestore: 0,
      healthRestore: 0,
    },
    stats,
  }
}

// ============ 单例 ============
let saveRecoveryManager: SaveRecoveryManager | null = null

/** 获取存档延迟恢复管理器单例 */
export function getSaveRecoveryManager(): SaveRecoveryManager {
  if (!saveRecoveryManager) {
    saveRecoveryManager = new SaveRecoveryManager()
  }
  return saveRecoveryManager
}
