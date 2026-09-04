/**
 * 延迟 SLO 定义 + 自动降级
 *
 * @fileoverview
 * MLOps 评估报告 P2 差距：无延迟 SLO 定义，无自动降级机制。
 *
 * 本模块实现：
 * 1. SLO 阈值定义：P95 延迟阈值，超过则触发降级
 * 2. 自动降级：当 P95 超过阈值时，切换到更快的模型/服务商
 * 3. 恢复机制：延迟恢复正常后自动恢复原始配置
 * 4. 降级状态持久化：避免频繁切换（hysteresis 设计）
 *
 * 降级策略：
 * - Level 0 (正常)：使用用户配置的模型
 * - Level 1 (降级)：P95 > SLO 阈值 → 切换到更快的模型
 * - Level 2 (紧急)：P95 > 2× SLO 阈值 → 切换到最快的兜底模型
 *
 * @module latencySLO
 * @requires ./runtimeMonitor — 读取 LLM 延迟指标
 */

import { runtimeMonitor } from './runtimeMonitor'

// ============ 类型定义 ============

/** 降级级别 */
export type DegradationLevel = 0 | 1 | 2

/** SLO 配置 */
export interface SLOConfig {
  /** 正常 P95 延迟阈值（ms），超过触发 Level 1 降级 */
  p95ThresholdMs: number
  /** 紧急 P95 延迟阈值（ms），超过触发 Level 2 降级 */
  p95CriticalMs: number
  /** 恢复延迟阈值（ms），低于此值才恢复（hysteresis，避免频繁切换） */
  p95RecoveryMs: number
  /** 降级到 Level 1 时使用的模型名 */
  degradedModel: string
  /** 降级到 Level 2 时使用的模型名（兜底） */
  fallbackModel: string
  /** 最小评估样本数（样本不足时不触发降级） */
  minSampleSize: number
  /** 降级状态保持最短时间（ms），避免频繁切换 */
  minDegradeDurationMs: number
}

/** SLO 状态 */
export interface SLOState {
  /** 当前降级级别 */
  degradationLevel: DegradationLevel
  /** 当前 P95 延迟 */
  currentP95: number
  /** 使用的模型名 */
  activeModel: string
  /** 是否正在降级 */
  isDegraded: boolean
  /** 降级开始时间（ms timestamp） */
  degradedSince: number
  /** 上次评估时间 */
  lastEvaluatedAt: number
}

// ============ 默认 SLO 配置 ============

export const DEFAULT_SLO_CONFIG: SLOConfig = {
  p95ThresholdMs: 5000,   // 5s → Level 1
  p95CriticalMs: 10000,   // 10s → Level 2
  p95RecoveryMs: 3000,     // 3s 以下才恢复
  degradedModel: 'fast',   // 降级模型标识（由调用方映射到实际模型）
  fallbackModel: 'ollama', // 兜底模型标识
  minSampleSize: 5,        // 至少 5 个样本才评估
  minDegradeDurationMs: 30000, // 降级至少保持 30s
}

// ============ SLO 管理器 ============

/**
 * 延迟 SLO 管理器
 *
 * 工作流程：
 * 1. evaluate() — 读取 runtimeMonitor 的 P95 延迟，判定降级级别
 * 2. 切换级别时检查 minDegradeDurationMs（避免频繁切换）
 * 3. getActiveModel() — 返回当前应使用的模型名
 */
export class LatencySLOManager {
  private config: SLOConfig
  private state: SLOState
  private originalModel: string

  constructor(config: SLOConfig = DEFAULT_SLO_CONFIG, originalModel = '') {
    this.config = config
    this.originalModel = originalModel
    this.state = {
      degradationLevel: 0,
      currentP95: 0,
      activeModel: originalModel,
      isDegraded: false,
      degradedSince: 0,
      lastEvaluatedAt: 0,
    }
  }

  /**
   * 设置原始模型名（用户配置的模型）
   */
  setOriginalModel(model: string): void {
    this.originalModel = model
    if (this.state.degradationLevel === 0) {
      this.state.activeModel = model
    }
  }

  /**
   * 评估当前延迟状态，决定是否降级/恢复
   *
   * @returns 评估后的 SLO 状态
   */
  evaluate(): SLOState {
    const metrics = runtimeMonitor.getLLMMetrics()
    const p95 = metrics.p95Latency
    const now = Date.now()

    this.state.currentP95 = p95
    this.state.lastEvaluatedAt = now

    // 样本不足，不触发降级
    if (metrics.recentLatencies.length < this.config.minSampleSize) {
      return { ...this.state }
    }

    // 检查是否在最小降级保持期内
    if (this.state.isDegraded) {
      const elapsed = now - this.state.degradedSince
      if (elapsed < this.config.minDegradeDurationMs) {
        // 仍在最小保持期内，不切换
        return { ...this.state }
      }
    }

    // 降级判定
    if (p95 >= this.config.p95CriticalMs) {
      // Level 2: 紧急降级
      if (this.state.degradationLevel !== 2) {
        this.state.degradationLevel = 2
        this.state.activeModel = this.config.fallbackModel
        this.state.isDegraded = true
        this.state.degradedSince = now
      }
    } else if (p95 >= this.config.p95ThresholdMs) {
      // Level 1: 标准降级
      if (this.state.degradationLevel !== 1) {
        this.state.degradationLevel = 1
        this.state.activeModel = this.config.degradedModel
        this.state.isDegraded = true
        this.state.degradedSince = now
      }
    } else if (p95 < this.config.p95RecoveryMs) {
      // 恢复
      if (this.state.degradationLevel !== 0) {
        this.state.degradationLevel = 0
        this.state.activeModel = this.originalModel
        this.state.isDegraded = false
        this.state.degradedSince = 0
      }
    }

    return { ...this.state }
  }

  /**
   * 获取当前应使用的模型名
   */
  getActiveModel(): string {
    return this.state.activeModel
  }

  /**
   * 获取当前 SLO 状态
   */
  getState(): SLOState {
    return { ...this.state }
  }

  /**
   * 重置状态（测试用）
   */
  reset(): void {
    this.state = {
      degradationLevel: 0,
      currentP95: 0,
      activeModel: this.originalModel,
      isDegraded: false,
      degradedSince: 0,
      lastEvaluatedAt: 0,
    }
  }
}

// ============ 单例 ============

let sloManager: LatencySLOManager | null = null

export function getLatencySLOManager(config?: SLOConfig): LatencySLOManager {
  if (!sloManager) {
    sloManager = new LatencySLOManager(config)
  }
  return sloManager
}

/**
 * 重置单例（测试用）
 */
export function resetLatencySLOManager(): void {
  sloManager = null
}
