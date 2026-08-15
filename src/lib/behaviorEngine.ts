/**
 * 行为引擎 — 宠物状态驱动的动画概率选择
 *
 * @fileoverview
 * 本模块实现桌面宠物的行为动画调度：根据宠物实时状态
 * （饱食度/健康/亲密度）将状态映射为活力档位，再按"档位匹配度"
 * 对候选动画做距离衰减加权，最终以加权随机方式选出动画。
 *
 * 设计说明：
 * - 活力档位（vitality tier）：0 濒危 / 1 低迷 / 2 平稳 / 3 活跃
 * - 档位匹配度加权：候选动画的期望档位与宠物当前档位越接近，
 *   权重越高（四分之一距离衰减）；不满足硬性门控条件（亲密度、
 *   播放列表、濒危互斥）的动画权重归零。
 * - 归一化：所有权重除以总和，得到概率分布。
 *
 * 主要导出：
 * - HpTier / getHpTier()：状态 → 档位
 * - AnimationDef / DEFAULT_ANIMATIONS：动画候选定义与默认配置
 * - getAffectionLevel()：亲密度 → 等级
 * - actWeight() / calculateProbabilities()：加权与归一化
 * - pickBehaviorByProbability() / pickPetReaction()：随机选择
 * - selectAnimationWithFallback()：动画缺失时的多级回退
 * - resolveHpTierWeight() / batchResolveHpTierWeights()：档位权重回退解析
 *
 * @module behaviorEngine
 */

import type { PetState, NurturingStats } from './types'

// ============ 活力档位 ============

/** 宠物活力档位：0=濒危 1=低迷 2=平稳 3=活跃 */
export type HpTier = 0 | 1 | 2 | 3

/** 最高档位 */
export const MAX_HP_TIER = 3

/**
 * 档位判定阈值（按饱食度从高到低匹配）。
 * 任一阈值满足即取对应档位；全部不满足归为濒危档。
 */
export const HP_TIER_HUNGER_THRESHOLDS: ReadonlyArray<{ tier: HpTier; minHunger: number }> = [
  { tier: 3, minHunger: 80 },
  { tier: 2, minHunger: 50 },
  { tier: 1, minHunger: 20 },
]

/** 将宠物当前数值映射为活力档位 */
export function getHpTier(stats: NurturingStats): HpTier {
  if (stats.health <= 0) return 0
  const matched = HP_TIER_HUNGER_THRESHOLDS.find(({ minHunger }) => stats.hunger >= minHunger)
  return matched ? matched.tier : 0
}

// ============ 动画候选定义 ============

/** 单个动画候选：状态、基础权重、期望档位与解锁条件 */
export interface AnimationDef {
  /** 动画状态 */
  state: PetState
  /** 基础概率权重 */
  baseProb: number
  /** 期望的活力档位 */
  tier: HpTier
  /** 解锁所需亲密度等级（0=不限制） */
  minAffectionLevel: number
  /** 是否在播放列表中 */
  inPlaylist: boolean
}

/** 默认动画候选表（可按角色自定义覆盖） */
export const DEFAULT_ANIMATIONS: AnimationDef[] = [
  // 常态
  { state: 'idle', baseProb: 10, tier: 2, minAffectionLevel: 0, inPlaylist: true },
  { state: 'idle', baseProb: 8, tier: 3, minAffectionLevel: 0, inPlaylist: true },
  { state: 'idle', baseProb: 5, tier: 1, minAffectionLevel: 0, inPlaylist: true },
  { state: 'walk', baseProb: 6, tier: 3, minAffectionLevel: 0, inPlaylist: true },
  { state: 'walk', baseProb: 4, tier: 2, minAffectionLevel: 0, inPlaylist: true },
  { state: 'sit', baseProb: 3, tier: 2, minAffectionLevel: 0, inPlaylist: true },
  { state: 'happy', baseProb: 4, tier: 3, minAffectionLevel: 1, inPlaylist: true },
  { state: 'happy', baseProb: 2, tier: 2, minAffectionLevel: 1, inPlaylist: true },
  // 低迷
  { state: 'sad', baseProb: 6, tier: 1, minAffectionLevel: 0, inPlaylist: true },
  { state: 'sad', baseProb: 8, tier: 0, minAffectionLevel: 0, inPlaylist: true },
  // 濒危
  { state: 'sick', baseProb: 10, tier: 0, minAffectionLevel: 0, inPlaylist: true },
  // 睡眠（高亲密度解锁）
  { state: 'sleep', baseProb: 3, tier: 2, minAffectionLevel: 2, inPlaylist: true },
  // 高活力花式动作
  { state: 'happy', baseProb: 5, tier: 3, minAffectionLevel: 2, inPlaylist: true },
  { state: 'walk', baseProb: 3, tier: 3, minAffectionLevel: 1, inPlaylist: true },
  { state: 'sit', baseProb: 2, tier: 3, minAffectionLevel: 1, inPlaylist: true },
  // 高亲密度专属
  { state: 'happy', baseProb: 6, tier: 2, minAffectionLevel: 3, inPlaylist: true },
  { state: 'happy', baseProb: 4, tier: 3, minAffectionLevel: 4, inPlaylist: true },
  { state: 'idle', baseProb: 3, tier: 3, minAffectionLevel: 3, inPlaylist: true },
  // 低迷扩展
  { state: 'sad', baseProb: 4, tier: 1, minAffectionLevel: 1, inPlaylist: true },
  { state: 'walk', baseProb: 2, tier: 1, minAffectionLevel: 0, inPlaylist: true },
]

// ============ 亲密度等级 ============

/** 亲密度等级阈值（数值越高等级越高） */
export const AFFECTION_LEVEL_THRESHOLDS: ReadonlyArray<{ level: number; minAffection: number }> = [
  { level: 5, minAffection: 5000 },
  { level: 4, minAffection: 3000 },
  { level: 3, minAffection: 1500 },
  { level: 2, minAffection: 500 },
  { level: 1, minAffection: 100 },
]

/** 将亲密度数值映射为等级（0 起） */
export function getAffectionLevel(affection: number): number {
  const matched = AFFECTION_LEVEL_THRESHOLDS.find(({ minAffection }) => affection >= minAffection)
  return matched ? matched.level : 0
}

// ============ 档位匹配度加权 ============

/**
 * 档位距离衰减系数。
 * 两档相差 d 时权重乘以 0.25^d：同档权重最高，相邻档衰减为 1/4，
 * 相隔两档衰减为 1/16，以此类推。
 */
function tierDistanceDecay(distance: number): number {
  return Math.pow(0.25, distance)
}

/**
 * 计算单个动画候选的加权权重。
 *
 * 硬性门控（任一不满足则权重为 0）：
 * 1. 亲密度等级须达到候选的解锁要求；
 * 2. 候选须在播放列表中；
 * 3. 濒危互斥：当前档位为 0 时仅播放濒危动画，反之亦然。
 *
 * 加权：基础权重 × 档位距离衰减系数。
 */
export function actWeight(
  baseProb: number,
  actTier: HpTier,
  currentTier: HpTier,
  minAffectionLevel: number,
  affectionLevel: number,
  inPlaylist: boolean,
): number {
  if (affectionLevel < minAffectionLevel) return 0
  if (!inPlaylist) return 0
  if (currentTier === 0 && actTier !== 0) return 0
  if (actTier === 0 && currentTier !== 0) return 0
  return baseProb * tierDistanceDecay(Math.abs(actTier - currentTier))
}

/**
 * 计算整组动画候选的归一化概率分布。
 * 全部权重为 0 时回退为仅播 idle。
 */
export function calculateProbabilities(
  animations: AnimationDef[],
  stats: NurturingStats,
): { state: PetState; probability: number }[] {
  const currentTier = getHpTier(stats)
  const affectionLevel = getAffectionLevel(stats.affection)

  const weighted = animations.map((anim) => ({
    state: anim.state,
    weight: actWeight(
      anim.baseProb,
      anim.tier,
      currentTier,
      anim.minAffectionLevel,
      affectionLevel,
      anim.inPlaylist,
    ),
  }))

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight === 0) {
    return [{ state: 'idle' as PetState, probability: 1 }]
  }

  return weighted.map(({ state, weight }) => ({
    state,
    probability: weight / totalWeight,
  }))
}

// ============ 动画多级回退 ============

/** 动画回退查找结果 */
export interface FallbackResult {
  /** 最终选中的动画状态 */
  state: PetState
  /** 是否发生了回退（true 表示原始动画不可用，使用了替代） */
  fellBack: boolean
  /** 回退原因描述 */
  reason?: string
}

/**
 * 多级回退动画选择。
 *
 * 回退优先级：
 * 1. 精确匹配：请求的动画存在且档位匹配
 * 2. 向下兼容：同动画、较低档位
 * 3. 向上兼容：同动画、较高档位
 * 4. 任意同状态动画（忽略档位）
 * 5. 任意非生病动画中档位最接近者
 * 6. 终极兜底：idle
 */
export function selectAnimationWithFallback(
  requestedState: PetState,
  animations: AnimationDef[],
  stats: NurturingStats,
): FallbackResult {
  const currentTier = getHpTier(stats)
  const affectionLevel = getAffectionLevel(stats.affection)

  const available = animations.filter(
    (a) => a.inPlaylist && affectionLevel >= a.minAffectionLevel,
  )

  const sameState = (a: AnimationDef) => a.state === requestedState

  // 1. 精确匹配
  const exact = available.find((a) => sameState(a) && a.tier === currentTier)
  if (exact) return { state: exact.state, fellBack: false }

  // 2. 向下兼容
  for (let tier = currentTier - 1; tier >= 0; tier--) {
    const hit = available.find((a) => sameState(a) && a.tier === tier)
    if (hit) {
      return { state: hit.state, fellBack: true, reason: `档位向下兼容回退 (${currentTier} → ${tier})` }
    }
  }

  // 3. 向上兼容
  for (let tier = currentTier + 1; tier <= MAX_HP_TIER; tier++) {
    const hit = available.find((a) => sameState(a) && a.tier === (tier as HpTier))
    if (hit) {
      return { state: hit.state, fellBack: true, reason: `档位向上兼容回退 (${currentTier} → ${tier})` }
    }
  }

  // 4. 任意同状态
  const anyOfState = available.find(sameState)
  if (anyOfState) {
    return { state: anyOfState.state, fellBack: true, reason: `同状态可用，忽略档位` }
  }

  // 5. 非生病动画中档位最接近
  const nonSick = available.filter((a) => a.state !== 'sick')
  if (nonSick.length > 0) {
    const nearest = [...nonSick].sort(
      (a, b) => Math.abs(a.tier - currentTier) - Math.abs(b.tier - currentTier),
    )[0]
    return { state: nearest.state, fellBack: true, reason: `请求动画不可用，回退至档位最接近的非生病动画` }
  }

  // 6. 兜底
  return { state: 'idle', fellBack: true, reason: `所有动画均不可用，回退到 idle` }
}

// ============ 概率随机选择 ============

/** 按归一化概率随机选择一个动画状态 */
export function pickBehaviorByProbability(
  animations: AnimationDef[],
  stats: NurturingStats,
): PetState {
  const probabilities = calculateProbabilities(animations, stats)
  const rand = Math.random()
  let cumulative = 0
  for (const { state, probability } of probabilities) {
    cumulative += probability
    if (rand <= cumulative) return state
  }
  return probabilities[probabilities.length - 1]?.state ?? 'idle'
}

/**
 * 选择宠物的抚摸反应动画。
 * 反应候选按档位距离衰减加权：当前档位越接近该反应的期望档位，
 * 被选中的概率越高。档位 0 偏向低落反应，档位 3 偏向开心反应。
 */
export function pickPetReaction(stats: NurturingStats): PetState {
  const hpTier = getHpTier(stats)
  const reactions: PetState[] = ['sad', 'idle', 'pet', 'happy']
  const weights = reactions.map((_, index) => tierDistanceDecay(Math.abs(index - hpTier)))
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total === 0) return 'pet'

  const rand = Math.random() * total
  let cumulative = 0
  for (let i = 0; i < reactions.length; i++) {
    cumulative += weights[i]
    if (rand <= cumulative) return reactions[i]
  }
  return 'pet'
}

// ============ 档位权重回退链 ============

/** 档位权重回退结果 */
export interface HpTierWeightFallbackResult {
  /** 匹配的权重值 */
  weight: number
  /** 匹配的档位 */
  matchedTier: HpTier
  /** 回退级别 */
  fallbackLevel: 'exact' | 'downward' | 'upward' | 'default'
  /** 回退原因 */
  reason?: string
}

/** 自定义回退优先级表：请求档位 → 按优先顺序尝试的档位列表 */
export interface HpTierFallbackTable {
  [requestedTier: number]: HpTier[]
}

/** 默认回退优先级表（优先相邻档位） */
const DEFAULT_HP_TIER_FALLBACK: HpTierFallbackTable = {
  3: [3, 2, 1, 0],
  2: [2, 3, 1, 0],
  1: [1, 2, 0, 3],
  0: [0, 1, 2, 3],
}

/**
 * 解析某状态在指定档位下的可用权重。
 * 优先精确档位，随后按回退优先级表逐级尝试，均不可用时返回默认权重 0。
 */
export function resolveHpTierWeight(
  weights: Record<number, number>,
  requestedTier: HpTier,
  fallbackTable?: HpTierFallbackTable,
): HpTierWeightFallbackResult {
  const table = fallbackTable ?? DEFAULT_HP_TIER_FALLBACK
  const priorityList = table[requestedTier] ?? [requestedTier]

  if (weights[requestedTier] !== undefined && weights[requestedTier] > 0) {
    return { weight: weights[requestedTier], matchedTier: requestedTier, fallbackLevel: 'exact' }
  }

  for (const tier of priorityList) {
    if (tier === requestedTier) continue
    if (weights[tier] !== undefined && weights[tier] > 0) {
      const level: 'downward' | 'upward' = tier < requestedTier ? 'downward' : 'upward'
      return {
        weight: weights[tier],
        matchedTier: tier as HpTier,
        fallbackLevel: level,
        reason: `精确档位 ${requestedTier} 不可用，${level === 'downward' ? '向下' : '向上'}回退到 ${tier}`,
      }
    }
  }

  return {
    weight: 0,
    matchedTier: requestedTier,
    fallbackLevel: 'default',
    reason: `所有回退档位均不可用，使用默认权重`,
  }
}

/**
 * 批量解析一组动画的档位权重回退。
 * 预先按状态分组构建档位权重映射，避免重复过滤。
 */
export function batchResolveHpTierWeights(
  animations: AnimationDef[],
  currentTier: HpTier,
  fallbackTable?: HpTierFallbackTable,
): Array<{ animation: AnimationDef; fallback: HpTierWeightFallbackResult }> {
  const weightsByState = new Map<PetState, Record<number, number>>()
  for (const a of animations) {
    const tierWeights = weightsByState.get(a.state)
    if (tierWeights) {
      tierWeights[a.tier] = a.baseProb
    } else {
      weightsByState.set(a.state, { [a.tier]: a.baseProb })
    }
  }

  return animations.map((anim) => {
    const tierWeights = weightsByState.get(anim.state) ?? {}
    const fallback = resolveHpTierWeight(tierWeights, currentTier, fallbackTable)
    return { animation: anim, fallback }
  })
}
