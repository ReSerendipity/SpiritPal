/**
 * 记忆系统统一配置（T-12）
 *
 * 收敛散落在各模块的硬编码常量，提供单一配置入口。
 * 默认值与改动前完全一致（行为不变），后续调参只需改这里。
 *
 * @module memoryConfig
 */

/** 触发频率控制 */
export const TRIGGER_CONFIG = {
  /** 每日主动触发上限 */
  maxDailyTriggers: 5,
  /** 两次触发最小间隔（毫秒） */
  minTriggerIntervalMs: 30 * 60 * 1000,
  /** 连续忽略阈值，超过后降频 */
  ignoreThreshold: 3,
} as const

/** 注入与冷却 */
export const INJECTION_CONFIG = {
  /** 同一条记忆注入冷却时长（毫秒）— 24 小时 */
  cooldownMs: 24 * 60 * 60 * 1000,
} as const

/** 检索阈值（RAG/向量） */
export const RETRIEVAL_CONFIG = {
  /** 向量相似度最低阈值 */
  vectorMinScore: 0.45,
  /** RRF 常数 k */
  rrfK: 60,
  /** BM25 最低分数阈值 */
  bm25MinScore: 0.01,
} as const

/** 主动说话节奏 */
export const PROACTIVE_CONFIG = {
  /** 主动说话最小间隔（毫秒） */
  minIntervalMs: 5 * 60 * 1000,
  /** 随机触发概率 */
  triggerProbability: 0.3,
  /** 检查间隔（毫秒） */
  checkIntervalMs: 60 * 1000,
} as const

/** 记忆维护 */
export const MAINTENANCE_CONFIG = {
  /** 巩固最小间隔（毫秒） */
  consolidationIntervalMs: 60 * 60 * 1000,
} as const
