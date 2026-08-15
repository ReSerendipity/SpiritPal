/**
 * 好感度数值化引擎 — 从 LLM 回复提取情感标签，映射为亲密度变化
 * 参考 super-agent-party 的情感分析与 同类桌宠方案 的亲密度系统
 *
 * @fileoverview
 * 主要模块：
 * - EmotionTag 类型：11 种情感标签定义（love/happy/grateful/.../disappointed）
 * - EmotionPattern 接口：情感正则匹配模式定义
 * - DEFAULT_EMOTION_PATTERNS：10 种中文情感检测正则模式
 * - DEFAULT_EMOTION_AFFECTION_MAP：情感→亲密度变化默认映射
 * - AffectionNumericEngine 类：好感度数值化引擎（单例模式）
 * - getAffectionNumericEngine()：获取单例入口
 *
 * 核心功能：
 * 1. 从 LLM 回复中提取情感标签（regex 模式匹配）
 * 2. 情感标签 → 亲密度变化映射
 * 3. 亲密度变化写入 petStore
 * 4. 可配置的情感→亲密度映射规则
 *
 * @module affectionNumeric
 * @requires ./types - NurturingStats 类型定义
 * @requires ../stores/petStore - 宠物状态存储
 */

import type { NurturingStats } from './types'

// ============ 情感标签 ============

/** 情感标签类型 */
export type EmotionTag =
  | 'love'        // 爱意
  | 'happy'       // 开心
  | 'grateful'    // 感激
  | 'excited'     // 兴奋
  | 'warm'        // 温暖
  | 'neutral'     // 中性
  | 'worried'     // 担心
  | 'sad'         // 伤心
  | 'angry'       // 生气
  | 'cold'        // 冷淡
  | 'disappointed' // 失望

/** 情感标签列表 */
export const ALL_EMOTION_TAGS: EmotionTag[] = [
  'love', 'happy', 'grateful', 'excited', 'warm', 'neutral',
  'worried', 'sad', 'angry', 'cold', 'disappointed',
]

/** 情感标签显示名称 */
export const EMOTION_TAG_LABELS: Record<EmotionTag, string> = {
  love: '爱意',
  happy: '开心',
  grateful: '感激',
  excited: '兴奋',
  warm: '温暖',
  neutral: '中性',
  worried: '担心',
  sad: '伤心',
  angry: '生气',
  cold: '冷淡',
  disappointed: '失望',
}

// ============ 情感→亲密度映射 ============

/** 默认情感→亲密度变化映射 */
export const DEFAULT_EMOTION_AFFECTION_MAP: Record<EmotionTag, number> = {
  love:         10,  // 爱意 +10
  happy:         5,  // 开心 +5
  grateful:      8,  // 感激 +8
  excited:       4,  // 兴奋 +4
  warm:          3,  // 温暖 +3
  neutral:       0,  // 中性 0
  worried:      -2,  // 担心 -2
  sad:          -3,  // 伤心 -3
  angry:        -5,  // 生气 -5
  cold:         -4,  // 冷淡 -4
  disappointed: -6,  // 失望 -6
}

// ============ 正则模式 ============

/** 情感检测正则模式 */
export interface EmotionPattern {
  /** 情感标签 */
  emotion: EmotionTag
  /** 正则表达式（匹配文本） */
  pattern: RegExp
  /** 优先级（多个匹配时取最高优先级） */
  priority: number
}

/** 默认情感检测模式（中文为主） */
export const DEFAULT_EMOTION_PATTERNS: EmotionPattern[] = [
  // 爱意
  { emotion: 'love', pattern: /爱|喜歡|最喜欢|离不开|舍不得|想你|抱抱|亲亲/i, priority: 10 },
  // 开心
  { emotion: 'happy', pattern: /开心|高兴|快乐|哈哈|嘻嘻|好棒|太好了|好耶/i, priority: 6 },
  // 感激
  { emotion: 'grateful', pattern: /谢谢|感谢|感激|多亏|幸亏|太感谢/i, priority: 7 },
  // 兴奋
  { emotion: 'excited', pattern: /激动|兴奋|太棒了|超级|超开心|好兴奋/i, priority: 5 },
  // 温暖
  { emotion: 'warm', pattern: /温暖|温馨|温柔|体贴|舒服|安心|放心/i, priority: 4 },
  // 担心
  { emotion: 'worried', pattern: /担心|忧虑|焦虑|不安|害怕|恐惧|紧张/i, priority: 3 },
  // 伤心
  { emotion: 'sad', pattern: /伤心|难过|悲伤|哭|呜呜|泪|不舍|失落/i, priority: 4 },
  // 生气
  { emotion: 'angry', pattern: /生气|愤怒|讨厌|烦|烦死|气死|可恶|混蛋/i, priority: 5 },
  // 冷淡
  { emotion: 'cold', pattern: /随便|无所谓|哦|嗯|好吧|冷漠|不理/i, priority: 3 },
  // 失望
  { emotion: 'disappointed', pattern: /失望|遗憾|可惜|可惜了|唉|叹气|无奈/i, priority: 4 },
]

// ============ 提取结果 ============

/** 情感提取结果 */
export interface EmotionExtractResult {
  /** 提取到的情感标签列表（可能多个） */
  emotions: EmotionTag[]
  /** 主要情感（优先级最高的） */
  primaryEmotion: EmotionTag
  /** 总亲密度变化 */
  affectionDelta: number
  /** 匹配详情 */
  matches: { emotion: EmotionTag; matchedText: string }[]
}

// ============ 好感度数值化引擎 ============

/**
 * 好感度数值化引擎
 *
 * 工作流程：
 * 1. analyze: 从 LLM 回复文本中提取情感标签
 * 2. calculateAffectionDelta: 根据情感映射计算亲密度变化
 * 3. applyAffectionChange: 将亲密度变化写入 petStore
 *
 * 通过单例 getAffectionNumericEngine() 获取实例
 */
export class AffectionNumericEngine {
  /** 情感模式列表 */
  private patterns: EmotionPattern[]
  /** 情感→亲密度映射 */
  private affectionMap: Record<EmotionTag, number>
  /** 历史亲密度变化记录（用于统计和调试） */
  private history: { timestamp: number; delta: number; emotion: EmotionTag }[] = []
  /** 最大历史记录数 */
  private maxHistory: number

  constructor(
    patterns: EmotionPattern[] = DEFAULT_EMOTION_PATTERNS,
    affectionMap: Record<EmotionTag, number> = DEFAULT_EMOTION_AFFECTION_MAP,
    maxHistory: number = 100,
  ) {
    this.patterns = patterns
    this.affectionMap = affectionMap
    this.maxHistory = maxHistory
  }

  // ============ 情感提取 ============

  /**
   * 从文本中提取情感标签
   *
   * 使用正则模式匹配，返回所有匹配到的情感
   * 主要情感为优先级最高的匹配
   *
   * @param text LLM 回复文本
   * @returns 提取结果
   */
  analyze(text: string): EmotionExtractResult {
    const matches: { emotion: EmotionTag; matchedText: string; priority: number }[] = []

    for (const pattern of this.patterns) {
      const match = text.match(pattern.pattern)
      if (match) {
        matches.push({
          emotion: pattern.emotion,
          matchedText: match[0],
          priority: pattern.priority,
        })
      }
    }

    // 按优先级排序
    matches.sort((a, b) => b.priority - a.priority)

    // 去重（同一情感只保留最高优先级）
    const seenEmotions = new Set<EmotionTag>()
    const uniqueMatches = matches.filter(m => {
      if (seenEmotions.has(m.emotion)) return false
      seenEmotions.add(m.emotion)
      return true
    })

    const emotions = uniqueMatches.map(m => m.emotion)
    const primaryEmotion = emotions.length > 0 ? emotions[0] : 'neutral'

    // 计算亲密度变化
    const affectionDelta = this.calculateAffectionDelta(emotions)

    return {
      emotions,
      primaryEmotion,
      affectionDelta,
      matches: uniqueMatches.map(m => ({ emotion: m.emotion, matchedText: m.matchedText })),
    }
  }

  // ============ 亲密度计算 ============

  /**
   * 根据情感列表计算亲密度变化
   *
   * 规则：
   * - 每个情感按映射表计算变化值
   * - 总变化为所有情感变化之和
   * - 中性情感不产生变化
   *
   * @param emotions 情感标签列表
   * @returns 亲密度变化值
   */
  calculateAffectionDelta(emotions: EmotionTag[]): number {
    if (emotions.length === 0) return 0

    let total = 0
    for (const emotion of emotions) {
      total += this.affectionMap[emotion] ?? 0
    }

    // 衰减因子：多个情感叠加时逐渐衰减
    // 防止单条回复中多个正面情感导致亲密度暴增
    if (emotions.length > 1) {
      const decayFactor = 1 / (1 + 0.2 * (emotions.length - 1))
      total = Math.round(total * decayFactor)
    }

    return total
  }

  // ============ 应用亲密度变化 ============

  /**
   * 将亲密度变化应用到 petStore
   *
   * @param affectionDelta 亲密度变化值
   * @param characterId 角色 ID
   */
  applyAffectionChange(affectionDelta: number, characterId: string): void {
    if (affectionDelta === 0) return

    // 记录历史
    this.history.push({
      timestamp: Date.now(),
      delta: affectionDelta,
      emotion: affectionDelta > 0 ? 'happy' : 'sad',
    })
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }

    // 写入 petStore
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- 惰性 require 避免 petStore 循环依赖
      const { usePetStore } = require('../stores/petStore')
      const store = usePetStore.getState()
      const cur = store.stats[characterId]
      if (!cur) return

      const newAffection = Math.max(0, Math.min(9999, cur.affection + affectionDelta))
      usePetStore.setState((state: { stats: Record<string, NurturingStats> }) => ({
        stats: {
          ...state.stats,
          [characterId]: {
            ...cur,
            affection: newAffection,
            lastInteractionAt: Date.now(),
          },
        },
      }))
    } catch {
      // petStore 不可用时静默失败
    }
  }

  // ============ 便捷方法 ============

  /**
   * 一站式处理：分析文本 → 计算亲密度 → 应用变化
   *
   * @param text LLM 回复文本
   * @param characterId 角色 ID
   * @returns 提取结果
   */
  processReply(text: string, characterId: string): EmotionExtractResult {
    const result = this.analyze(text)
    this.applyAffectionChange(result.affectionDelta, characterId)
    return result
  }

  // ============ 配置 ============

  /** 更新情感→亲密度映射 */
  setAffectionMap(map: Partial<Record<EmotionTag, number>>): void {
    this.affectionMap = { ...this.affectionMap, ...map }
  }

  /** 添加自定义情感模式 */
  addPattern(pattern: EmotionPattern): void {
    this.patterns.push(pattern)
  }

  /** 移除情感模式 */
  removePattern(emotion: EmotionTag): void {
    this.patterns = this.patterns.filter(p => p.emotion !== emotion)
  }

  /** 获取当前映射 */
  getAffectionMap(): Record<EmotionTag, number> {
    return { ...this.affectionMap }
  }

  // ============ 统计 ============

  /** 获取历史记录 */
  getHistory(): { timestamp: number; delta: number; emotion: EmotionTag }[] {
    return [...this.history]
  }

  /** 获取总亲密度变化（从历史记录） */
  getTotalDelta(): number {
    return this.history.reduce((sum, h) => sum + h.delta, 0)
  }

  /** 获取正面情感比例 */
  getPositiveRatio(): number {
    if (this.history.length === 0) return 0.5
    const positive = this.history.filter(h => h.delta > 0).length
    return positive / this.history.length
  }

  /** 清空历史 */
  clearHistory(): void {
    this.history = []
  }
}

// ============ 单例 ============
let affectionEngine: AffectionNumericEngine | null = null

/** 获取好感度数值化引擎单例 */
export function getAffectionNumericEngine(): AffectionNumericEngine {
  if (!affectionEngine) {
    affectionEngine = new AffectionNumericEngine()
  }
  return affectionEngine
}
