/**
 * 灰度发布机制 — 基于 Prompt 版本与配置参数的渐进式发布
 *
 * @fileoverview
 * MLOps 评估报告 P1 差距：无灰度发布机制，Prompt/参数变更全量生效无回退能力。
 *
 * 本模块实现轻量级灰度发布：
 * 1. 灰度配置（RolloutConfig）：定义每个配置项的灰度比例 + 目标版本
 * 2. 灰度判定（shouldApplyRollout）：基于用户 ID 哈希做确定性灰度判定
 *    - 同一用户对同一配置项的灰度判定结果始终一致（不随机抖动）
 *    - 灰度比例 0% = 全部不生效，100% = 全部生效
 * 3. 配置覆盖（getRolloutOverrides）：返回当前用户应生效的灰度配置覆盖项
 * 4. 回退能力：灰度配置失败时自动回退到稳定版本
 *
 * 灰度配置来源（优先级从高到低）：
 * 1. 远程配置（未来可通过 Tauri Updater channel 下发，当前预留接口）
 * 2. 本地灰度配置文件（public/rollout-config.json）
 * 3. 默认值（全量生效）
 *
 * @module gradualRollout
 * @requires ./promptRegistry — 获取 Prompt 版本信息
 */

import { getAllPromptVersions } from '@/lib/ai/promptRegistry'

// ============ 类型定义 ============

/** 灰度配置项 */
export interface RolloutItem {
  /** 配置项唯一键名 */
  key: string
  /** 目标版本号 */
  targetVersion: number
  /** 灰度比例（0-100，100=全量生效） */
  rolloutPercentage: number
  /** 描述 */
  description?: string
}

/** 灰度配置 */
export interface RolloutConfig {
  /** 配置版本号 */
  configVersion: number
  /** 灰度项列表 */
  items: RolloutItem[]
}

/** 灰度判定结果 */
export interface RolloutDecision {
  /** 配置项键名 */
  key: string
  /** 是否应该应用灰度配置 */
  shouldApply: boolean
  /** 目标版本 */
  targetVersion: number
  /** 当前已安装版本 */
  currentVersion: number
  /** 判定原因 */
  reason: string
}

// ============ 常量 ============

/** 本地灰度配置存储键 */
const ROLLOUT_STORAGE_KEY = 'spiritpal-rollout-cache'

/** 默认灰度配置（全量生效） */
const DEFAULT_ROLLOUT_CONFIG: RolloutConfig = {
  configVersion: 1,
  items: [],
}

// ============ 灰度判定核心 ============

/**
 * 确定性哈希 — 基于用户 ID + 配置键名生成 0-99 的哈希值
 * 同一用户+同一配置键名始终产生相同结果
 *
 * 使用 DJB2 哈希算法（简单、分布均匀）
 */
function deterministicHash(userId: string, configKey: string): number {
  const input = `${userId}::${configKey}`
  let hash = 5381
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) & 0x7fffffff
  }
  return hash % 100
}

/**
 * 判断某个灰度配置项是否应该对当前用户生效
 *
 * @param userId 用户 ID（匿名，如机器码哈希）
 * @param item 灰度配置项
 * @param currentVersion 当前已安装的 Prompt/配置版本
 * @returns 灰度判定结果
 */
export function shouldApplyRollout(
  userId: string,
  item: RolloutItem,
  currentVersion: number,
): RolloutDecision {
  // 如果当前版本已经 >= 目标版本，说明已经全量发布
  if (currentVersion >= item.targetVersion) {
    return {
      key: item.key,
      shouldApply: true,
      targetVersion: item.targetVersion,
      currentVersion,
      reason: 'current_version_already_at_target',
    }
  }

  // 灰度比例为 0% → 不生效
  if (item.rolloutPercentage <= 0) {
    return {
      key: item.key,
      shouldApply: false,
      targetVersion: item.targetVersion,
      currentVersion,
      reason: 'rollout_percentage_zero',
    }
  }

  // 灰度比例为 100% → 全量生效
  if (item.rolloutPercentage >= 100) {
    return {
      key: item.key,
      shouldApply: true,
      targetVersion: item.targetVersion,
      currentVersion,
      reason: 'rollout_percentage_full',
    }
  }

  // 确定性灰度判定
  const hash = deterministicHash(userId, item.key)
  const shouldApply = hash < item.rolloutPercentage

  return {
    key: item.key,
    shouldApply,
    targetVersion: item.targetVersion,
    currentVersion,
    reason: shouldApply ? 'hash_in_rollout_range' : 'hash_outside_rollout_range',
  }
}

// ============ 灰度配置管理 ============

/** 缓存的灰度配置 */
let cachedConfig: RolloutConfig = DEFAULT_ROLLOUT_CONFIG
let cachedUserId = ''

/**
 * 获取灰度配置
 * 当前从本地缓存加载，未来可扩展为远程拉取
 */
export function getRolloutConfig(): RolloutConfig {
  try {
    const raw = localStorage.getItem(ROLLOUT_STORAGE_KEY)
    if (raw) {
      return JSON.parse(raw) as RolloutConfig
    }
  } catch {
    // 解析失败使用默认配置
  }
  return DEFAULT_ROLLOUT_CONFIG
}

/**
 * 更新灰度配置（远程下发或本地调试用）
 */
export function setRolloutConfig(config: RolloutConfig): void {
  cachedConfig = config
  try {
    localStorage.setItem(ROLLOUT_STORAGE_KEY, JSON.stringify(config))
  } catch {
    // 存储失败静默忽略
  }
}

/**
 * 设置用户 ID（用于灰度判定）
 * 应在应用启动时调用
 */
export function setRolloutUserId(userId: string): void {
  cachedUserId = userId
}

/**
 * 获取当前用户应生效的所有灰度配置覆盖项
 *
 * 基于 promptRegistry 中的当前版本 + 灰度配置判定
 */
export function getRolloutOverrides(): RolloutDecision[] {
  const config = getRolloutConfig()
  const promptVersions = getAllPromptVersions()
  const results: RolloutDecision[] = []

  for (const item of config.items) {
    // 查找当前 Prompt 版本
    const currentVersion = promptVersions[item.key] ?? 0

    const decision = shouldApplyRollout(
      cachedUserId || 'anonymous',
      item,
      currentVersion,
    )
    results.push(decision)
  }

  return results
}

/**
 * 清除灰度配置缓存
 */
export function clearRolloutCache(): void {
  cachedConfig = DEFAULT_ROLLOUT_CONFIG
  cachedUserId = ''
  try {
    localStorage.removeItem(ROLLOUT_STORAGE_KEY)
  } catch {
    // 忽略
  }
}

// ============ 远程配置拉取（预留接口）============

/**
 * 从远程拉取灰度配置
 * 未来可通过 Tauri Updater channel 或专用 API 下发
 *
 * 当前为预留接口，返回 null 表示未配置远程源
 */
export async function fetchRemoteRolloutConfig(): Promise<RolloutConfig | null> {
  // 预留：未来实现远程配置拉取
  // 可选方案：
  // 1. Tauri Updater 的 channel 机制（不同 channel 下发不同配置）
  // 2. 专用配置 API（如 GitHub Raw URL）
  // 3. 应用内置的灰度配置 JSON
  return null
}
