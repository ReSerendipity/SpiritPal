/**
 * @file attentionEngine.ts
 * @description 主动说话注意力裁决 — 用可解释的本地评分替代“定时 + 30% 随机”
 *
 * 参考竞品：Miru attention_engine.py（观察→合并信号→更新情绪→speak_intent，按 SAL 分级延迟）
 *           N.E.K.O. proactive_delivery.py（播放门禁与最小间隔）
 *
 * 设计原则：
 * - 纯本地启发式：不依赖 LLM、不发网络请求，任何环境都能给出结论（兜底能力）
 * - 可解释：返回 score 与命中的加分/减分原因，便于设置页展示与灰度调参
 * - 硬闸优先：静默模式、TTS 正在播、冷却期、用户刚活动（<10 分钟）直接否决
 * - 灰度：localStorage `spiritpal:attention-engine`，'0' 时回退旧随机触发
 */

import type { WorkState } from './contextAwareness'

/** 灰度开关存储键 */
const ATTENTION_FLAG_KEY = 'spiritpal:attention-engine'

/** 评分阈值：≥ 该值才允许开口 */
export const ATTENTION_SCORE_THRESHOLD = 0.35

/** 默认主动说话最小间隔（与 PROACTIVE_CONFIG.minIntervalMs 对齐） */
export const ATTENTION_MIN_INTERVAL_MS = 5 * 60 * 1000

/** 用户活动判定：空闲不足该分钟数时一律不打扰 */
export const ATTENTION_MIN_IDLE_MINUTES = 10

/** 注意力信号（全部来自本地状态） */
export interface AttentionSignals {
  /** 当前时间戳 */
  now: number
  /** 当前小时（0-23） */
  hour: number
  /** 距最后一次用户交互的空闲分钟数 */
  idleMinutes: number
  /** 当前工作状态 */
  workState: WorkState
  /** 上次主动说话时间戳（0 表示从未） */
  lastProactiveAt: number
  /** 静默模式（勿扰） */
  silentMode: boolean
  /** 当前是否有 TTS 正在播放 */
  speechPlaying: boolean
  /** 连续未获用户回应的主动发言次数 */
  unansweredStreak: number
}

/** 注意力裁决结果 */
export interface AttentionDecision {
  /** 是否允许开口 */
  shouldSpeak: boolean
  /** 综合评分（0-1） */
  score: number
  /** 是否被硬闸否决 */
  hardBlocked: boolean
  /** 命中的原因（分号分隔，便于日志/设置页展示） */
  reason: string
}

/** 是否启用注意力裁决（默认启用；读取失败按启用处理） */
export function isAttentionEngineEnabled(): boolean {
  try {
    return localStorage.getItem(ATTENTION_FLAG_KEY) !== '0'
  } catch {
    return true
  }
}

/** 设置注意力裁决开关（设置页/测试使用） */
export function setAttentionEngineEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ATTENTION_FLAG_KEY, enabled ? '1' : '0')
  } catch {
    /* 存储不可用时忽略：本次进程内仍按默认启用 */
  }
}

/** 各工作状态对“打扰意愿”的修正值 */
const WORK_STATE_ADJUST: Record<WorkState, number> = {
  meeting: -0.35,
  coding: -0.15,
  working: -0.05,
  browsing: -0.05,
  resting: 0.1,
  away: 0.1,
  idle: 0.05,
  unknown: 0,
}

/** 连续未回应的惩罚 */
function streakPenalty(streak: number): number {
  if (streak >= 3) return -0.5
  if (streak >= 2) return -0.35
  if (streak >= 1) return -0.15
  return 0
}

/** 时段修正：深夜与午休降低打扰 */
function hourAdjust(hour: number): number {
  if (hour >= 23 || hour < 6) return -0.25
  if (hour >= 12 && hour < 14) return -0.1
  return 0
}

/**
 * 计算注意力裁决
 *
 * 评分构成：基础 0.25 + 空闲时长 + 工作状态 + 时段 + 连续未回应惩罚
 * 硬闸：静默 / TTS 播放中 / 冷却期 / 用户活动不足 10 分钟
 */
export function decideAttention(signals: AttentionSignals): AttentionDecision {
  const reasons: string[] = []

  if (signals.silentMode) {
    return { shouldSpeak: false, score: 0, hardBlocked: true, reason: '静默模式' }
  }

  if (signals.speechPlaying) {
    return { shouldSpeak: false, score: 0, hardBlocked: true, reason: 'TTS 正在播放' }
  }

  if (signals.lastProactiveAt > 0 && signals.now - signals.lastProactiveAt < ATTENTION_MIN_INTERVAL_MS) {
    return { shouldSpeak: false, score: 0, hardBlocked: true, reason: '冷却期内' }
  }

  if (signals.idleMinutes < ATTENTION_MIN_IDLE_MINUTES) {
    return { shouldSpeak: false, score: 0, hardBlocked: true, reason: '用户正在活动' }
  }

  let score = 0.25
  reasons.push('基础 0.25')

  if (signals.idleMinutes >= 30) {
    score += 0.25
    reasons.push('空闲≥30min +0.25')
  } else if (signals.idleMinutes >= 15) {
    score += 0.15
    reasons.push('空闲≥15min +0.15')
  } else {
    score += 0.05
    reasons.push('空闲≥10min +0.05')
  }

  const workAdjust = WORK_STATE_ADJUST[signals.workState] ?? 0
  if (workAdjust !== 0) {
    score += workAdjust
    reasons.push(`工作状态:${signals.workState} ${workAdjust > 0 ? '+' : ''}${workAdjust}`)
  }

  const timeAdjust = hourAdjust(signals.hour)
  if (timeAdjust !== 0) {
    score += timeAdjust
    reasons.push(`时段:${signals.hour}时 ${timeAdjust}`)
  }

  const penalty = streakPenalty(signals.unansweredStreak)
  if (penalty !== 0) {
    score += penalty
    reasons.push(`连续未回应:${signals.unansweredStreak} ${penalty}`)
  }

  const clamped = Math.max(0, Math.min(1, score))
  const shouldSpeak = clamped >= ATTENTION_SCORE_THRESHOLD
  if (!shouldSpeak) reasons.push('未达阈值')

  return {
    shouldSpeak,
    score: Math.round(clamped * 100) / 100,
    hardBlocked: false,
    reason: reasons.join('；'),
  }
}
