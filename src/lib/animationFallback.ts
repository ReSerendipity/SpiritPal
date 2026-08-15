/**
 * 动画状态机回退链解析器 — 4 级回退机制确保动画总能找到可用状态
 * 参考 clawd-on-desk 的动画设计
 *
 * @fileoverview
 * 主要模块：
 * - FallbackLevel 类型：4 级回退（exact/downward/upward/anyNonSick）
 * - FallbackReason/FallbackResult 接口：回退原因和结果
 * - AnimationFallbackResolver 类：回退解析器（单例模式），支持角色特定覆盖、回退日志
 * - STATE_COMPATIBILITY/TIER_COMPAT：状态和 HP Tier 兼容性表
 * - getAnimationFallbackResolver()：获取单例入口
 *
 * 核心功能：
 * 1. 精确匹配 → 向下兼容 → 向上兼容 → 任意非生病
 * 2. 每种动画的回退优先级表
 * 3. 角色特定覆盖
 * 4. 回退原因日志（最多 100 条）
 *
 * @module animationFallback
 * @requires ./types - PetState 类型定义
 * @requires ./behaviorEngine - HpTier HP 等级类型
 */

import type { PetState } from './types'
import type { HpTier } from './behaviorEngine'

// ============ 回退级别 ============

/** 回退级别 */
export type FallbackLevel = 'exact' | 'downward' | 'upward' | 'anyNonSick'

/** 回退原因 */
export interface FallbackReason {
  /** 请求的状态 */
  requestedState: PetState
  /** 请求的 HP Tier */
  requestedTier: HpTier
  /** 实际匹配的状态 */
  matchedState: PetState
  /** 实际匹配的 Tier */
  matchedTier: HpTier
  /** 回退级别 */
  level: FallbackLevel
  /** 回退原因描述 */
  description: string
}

// ============ 回退优先级表 ============

/**
 * 动画状态兼容性表
 * 定义了每个状态在不同 tier 下的回退路径
 */
const STATE_COMPATIBILITY: Record<PetState, PetState[]> = {
  // 开心：happy → idle → sit → walk
  happy:   ['happy', 'idle', 'sit', 'walk'],
  // 闲着：idle → sit → walk → happy
  idle:    ['idle', 'sit', 'walk', 'happy'],
  // 行走：walk → idle → sit → happy
  walk:    ['walk', 'idle', 'sit', 'happy'],
  // 坐着：sit → idle → walk → happy
  sit:     ['sit', 'idle', 'walk', 'happy'],
  // 吃饭：eat → happy → idle → sit
  eat:     ['eat', 'happy', 'idle', 'sit'],
  // 睡觉：sleep → sit → idle（睡觉不需要兼容高活力状态）
  sleep:   ['sleep', 'sit', 'idle'],
  // 抚摸：pet → happy → idle → sit
  pet:     ['pet', 'happy', 'idle', 'sit'],
  // 拖拽：drag → walk → idle → sit
  drag:    ['drag', 'walk', 'idle', 'sit'],
  // 悲伤：sad → idle → sit → walk
  sad:     ['sad', 'idle', 'sit', 'walk'],
  // 生病：sick → sad → idle（生病最低优先级，只能向同类回退）
  sick:    ['sick', 'sad', 'idle'],
}

/**
 * HP Tier 向下兼容映射
 * 高 tier 可以降级到低 tier
 */
const TIER_DOWNWARD_COMPAT: Record<HpTier, HpTier[]> = {
  3: [3, 2, 1, 0],
  2: [2, 1, 0],
  1: [1, 0],
  0: [0],
}

/**
 * HP Tier 向上兼容映射
 * 低 tier 可以升级到高 tier（仅在必要时）
 */
const TIER_UPWARD_COMPAT: Record<HpTier, HpTier[]> = {
  0: [0, 1, 2, 3],
  1: [1, 2, 3],
  2: [2, 3],
  3: [3],
}

/** 生病状态集合 */
const SICK_STATES: PetState[] = ['sick']

// ============ 动画回退解析器 ============

/** 可用动画定义 */
export interface AvailableAnimation {
  state: PetState
  tier: HpTier
}

/** 回退解析结果 */
export interface FallbackResult {
  /** 匹配的动画 */
  matched: AvailableAnimation
  /** 回退级别 */
  level: FallbackLevel
  /** 回退原因（null 表示精确匹配） */
  reason: FallbackReason | null
}

/**
 * 动画状态机回退链解析器
 */
export class AnimationFallbackResolver {
  /** 角色特定的覆盖规则 */
  private characterOverrides = new Map<string, Record<PetState, PetState[]>>()
  /** 回退原因日志 */
  private fallbackLog: FallbackReason[] = []
  /** 日志最大条数 */
  private maxLogSize = 100

  /**
   * 解析动画回退
   * @param requestedState 请求的动画状态
   * @param requestedTier 请求的 HP Tier
   * @param available 可用的动画列表
   * @param characterId 角色ID（用于角色特定覆盖）
   * @returns 回退解析结果
   */
  resolve(
    requestedState: PetState,
    requestedTier: HpTier,
    available: AvailableAnimation[],
    characterId?: string,
  ): FallbackResult {
    // 构建可用动画查找表
    const availableSet = new Set<string>()
    for (const a of available) {
      availableSet.add(`${a.state}:${a.tier}`)
    }

    // 获取兼容性表（优先使用角色覆盖）
    const compatTable = characterId
      ? this.characterOverrides.get(characterId)?.[requestedState] ?? STATE_COMPATIBILITY[requestedState]
      : STATE_COMPATIBILITY[requestedState]

    // Level 1: 精确匹配 (exact)
    if (availableSet.has(`${requestedState}:${requestedTier}`)) {
      return {
        matched: { state: requestedState, tier: requestedTier },
        level: 'exact',
        reason: null,
      }
    }

    // Level 2: 向下兼容 (downward) — 同状态，更低的 tier
    const downwardTiers = TIER_DOWNWARD_COMPAT[requestedTier]
    for (const tier of downwardTiers) {
      if (tier === requestedTier) continue // 已检查
      for (const state of compatTable) {
        if (availableSet.has(`${state}:${tier}`)) {
          const reason: FallbackReason = {
            requestedState,
            requestedTier,
            matchedState: state,
            matchedTier: tier,
            level: 'downward',
            description: `精确匹配不存在，向下兼容: ${state}@tier${tier}`,
          }
          this.logReason(reason)
          return { matched: { state, tier }, level: 'downward', reason }
        }
      }
    }

    // Level 3: 向上兼容 (upward) — 同状态，更高的 tier
    const upwardTiers = TIER_UPWARD_COMPAT[requestedTier]
    for (const tier of upwardTiers) {
      if (tier === requestedTier) continue
      for (const state of compatTable) {
        if (availableSet.has(`${state}:${tier}`)) {
          const reason: FallbackReason = {
            requestedState,
            requestedTier,
            matchedState: state,
            matchedTier: tier,
            level: 'upward',
            description: `向下兼容不可用，向上兼容: ${state}@tier${tier}`,
          }
          this.logReason(reason)
          return { matched: { state, tier }, level: 'upward', reason }
        }
      }
    }

    // Level 4: 任意非生病状态 (anyNonSick)
    for (const state of compatTable) {
      if (SICK_STATES.includes(state)) continue
      for (let tier = 3; tier >= 0; tier--) {
        if (availableSet.has(`${state}:${tier}`)) {
          const reason: FallbackReason = {
            requestedState,
            requestedTier,
            matchedState: state,
            matchedTier: tier as HpTier,
            level: 'anyNonSick',
            description: `前三级均不可用，回退到任意非生病: ${state}@tier${tier}`,
          }
          this.logReason(reason)
          return { matched: { state, tier: tier as HpTier }, level: 'anyNonSick', reason }
        }
      }
    }

    // 最终回退：任意可用动画
    if (available.length > 0) {
      const fallback = available[0]
      const reason: FallbackReason = {
        requestedState,
        requestedTier,
        matchedState: fallback.state,
        matchedTier: fallback.tier,
        level: 'anyNonSick',
        description: `所有回退链均失败，使用第一个可用动画: ${fallback.state}@tier${fallback.tier}`,
      }
      this.logReason(reason)
      return { matched: fallback, level: 'anyNonSick', reason }
    }

    // 不应该到这里
    throw new Error(`无可用动画: requested=${requestedState}@tier${requestedTier}`)
  }

  /**
   * 设置角色特定的兼容性覆盖
   * @param characterId 角色 ID
   * @param overrides 覆盖规则
   */
  setCharacterOverride(characterId: string, overrides: Partial<Record<PetState, PetState[]>>): void {
    const existing = this.characterOverrides.get(characterId) ?? {} as Record<PetState, PetState[]>
    for (const [state, compat] of Object.entries(overrides)) {
      if (compat) {
        existing[state as PetState] = compat
      }
    }
    this.characterOverrides.set(characterId, existing)
  }

  /**
   * 获取回退原因日志
   */
  getFallbackLog(): FallbackReason[] {
    return [...this.fallbackLog]
  }

  /**
   * 清空回退日志
   */
  clearLog(): void {
    this.fallbackLog = []
  }

  private logReason(reason: FallbackReason): void {
    this.fallbackLog.push(reason)
    if (this.fallbackLog.length > this.maxLogSize) {
      this.fallbackLog = this.fallbackLog.slice(-this.maxLogSize)
    }
  }
}

// ============ 单例 ============

let sharedResolver: AnimationFallbackResolver | null = null

export function getAnimationFallbackResolver(): AnimationFallbackResolver {
  if (!sharedResolver) {
    sharedResolver = new AnimationFallbackResolver()
  }
  return sharedResolver
}
