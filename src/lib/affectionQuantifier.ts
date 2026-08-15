/**
 * 好感度量化器 — 从 LLM 响应中提取情感标签并量化亲密度变化
 * 参考 super-agent-party 的情感分析设计，支持交互质量加权
 *
 * @fileoverview
 * 主要模块：
 * - EmotionTag 接口：情感标签定义（含极性、亲密度增量、匹配正则）
 * - EMOTION_TAGS：12 种内置情感标签识别规则
 * - evaluateInteractionQuality()：交互质量评估函数
 * - AffectionQuantifier 类：好感度量化器（单例模式）
 * - getAffectionQuantifier()：获取单例入口
 *
 * 核心功能：
 * 1. 从 LLM 响应文本中提取情感标签（regex）
 * 2. 情感 → 亲密度增量映射（正向增加，负向减少）
 * 3. 交互质量加权（深度对话权重 > 浅层交互）
 * 4. 写入 petStore 的 affection 值
 *
 * @module affectionQuantifier
 * @requires ../stores/petStore - 宠物状态存储
 */

import { usePetStore } from '../stores/petStore'

// ============ 情感标签定义 ============

/** 情感极性 */
export type EmotionPolarity = 'positive' | 'negative' | 'neutral'

/** 情感标签 */
export interface EmotionTag {
  /** 标签名（如 happy, caring, worried 等） */
  name: string
  /** 极性 */
  polarity: EmotionPolarity
  /** 基础亲密度变化量（正=增加，负=减少） */
  affectionDelta: number
  /** 匹配正则 */
  pattern: RegExp
  /** 交互质量权重倍率（默认 1.0） */
  qualityMultiplier?: number
}

// ============ 内置情感标签 ============

/** 内置的情感标签识别规则 */
export const EMOTION_TAGS: EmotionTag[] = [
  // 正向情感
  {
    name: 'happy',
    polarity: 'positive',
    affectionDelta: 3,
    pattern: /开心|高兴|快乐|幸福|嘿嘿|嘻嘻|哈哈|太好了|好棒|好开心|最喜欢|爱你|喜欢/g,
  },
  {
    name: 'caring',
    polarity: 'positive',
    affectionDelta: 5,
    pattern: /担心你|关心|在乎|舍不得|不要难过|陪着你|守护|守护你/g,
    qualityMultiplier: 1.5,
  },
  {
    name: 'grateful',
    polarity: 'positive',
    affectionDelta: 4,
    pattern: /谢谢|感谢|多亏|太感谢|感恩|好感动/g,
    qualityMultiplier: 1.3,
  },
  {
    name: 'affectionate',
    polarity: 'positive',
    affectionDelta: 6,
    pattern: /想你|想你啦|亲亲|抱抱|贴贴|蹭蹭|想要你|离不开/g,
    qualityMultiplier: 2.0,
  },
  {
    name: 'encouraging',
    polarity: 'positive',
    affectionDelta: 3,
    pattern: /加油|你可以|相信自己|没问题|一定行|努力|不要放弃/g,
  },
  {
    name: 'comforting',
    polarity: 'positive',
    affectionDelta: 5,
    pattern: /没关系|不要紧|没事的|慢慢来|别担心|有我在/g,
    qualityMultiplier: 1.5,
  },
  // 负向情感
  {
    name: 'sad',
    polarity: 'negative',
    affectionDelta: -2,
    pattern: /难过|伤心|哭泣|呜呜|不想|失落|寂寞|孤独/g,
  },
  {
    name: 'angry',
    polarity: 'negative',
    affectionDelta: -3,
    pattern: /生气|讨厌|烦死|哼|不要理|走开|烦人|气死/g,
  },
  {
    name: 'fearful',
    polarity: 'negative',
    affectionDelta: -2,
    pattern: /害怕|可怕|恐惧|不要|危险/g,
  },
  {
    name: 'rejecting',
    polarity: 'negative',
    affectionDelta: -5,
    pattern: /不要|拒绝|不行|不可以|别碰|别管我|烦不烦/g,
    qualityMultiplier: 1.5,
  },
  // 中性情感（不变化亲密度，但记录交互）
  {
    name: 'curious',
    polarity: 'neutral',
    affectionDelta: 0,
    pattern: /为什么|怎么|什么|哪里|真的吗|好奇/g,
  },
  {
    name: 'neutral_greeting',
    polarity: 'neutral',
    affectionDelta: 1,
    pattern: /你好|早上好|晚上好|晚安|嗨/g,
  },
]

// ============ 情感提取结果 ============

/** 情感提取结果 */
export interface EmotionExtractionResult {
  /** 提取到的情感标签列表 */
  tags: ExtractedEmotion[]
  /** 总亲密度变化量 */
  totalAffectionDelta: number
  /** 正向情感数量 */
  positiveCount: number
  /** 负向情感数量 */
  negativeCount: number
  /** 主要情感（出现次数最多的） */
  dominantEmotion: string | null
  /** 交互质量评分（0-1） */
  qualityScore: number
}

/** 提取到的单个情感 */
export interface ExtractedEmotion {
  /** 情感标签名 */
  name: string
  /** 极性 */
  polarity: EmotionPolarity
  /** 匹配次数 */
  matchCount: number
  /** 单次亲密度变化量 */
  affectionDelta: number
  /** 累计亲密度变化量（affectionDelta × matchCount × qualityWeight） */
  weightedDelta: number
}

// ============ 交互质量评估 ============

/** 交互上下文 */
export interface InteractionContext {
  /** 消息长度（字符数） */
  messageLength: number
  /** 对话轮次（当前对话的第几轮） */
  turnNumber: number
  /** 是否包含用户提问 */
  hasQuestion: boolean
  /** 是否包含深度话题（情感/人生/关系） */
  isDeepTopic: boolean
  /** 用户是否主动发起 */
  isUserInitiated: boolean
}

/**
 * 评估交互质量（0-1）
 * 深度对话、长消息、主动发起 → 更高质量
 */
export function evaluateInteractionQuality(ctx: InteractionContext): number {
  let score = 0.3 // 基础分

  // 消息长度加分
  if (ctx.messageLength > 50) score += 0.1
  if (ctx.messageLength > 100) score += 0.1
  if (ctx.messageLength > 200) score += 0.1

  // 对话轮次加分
  if (ctx.turnNumber >= 3) score += 0.1
  if (ctx.turnNumber >= 5) score += 0.1

  // 提问加分
  if (ctx.hasQuestion) score += 0.05

  // 深度话题加分
  if (ctx.isDeepTopic) score += 0.15

  // 主动发起加分
  if (ctx.isUserInitiated) score += 0.05

  return Math.min(1.0, score)
}

// ============ 好感度数值化器 ============

export class AffectionQuantifier {
  /** 自定义情感标签（追加到内置标签） */
  private customTags: EmotionTag[] = []

  /** 单次最大亲密度变化量（防止异常值） */
  private readonly MAX_SINGLE_DELTA = 20

  /**
   * 添加自定义情感标签
   */
  addCustomTag(tag: EmotionTag): void {
    this.customTags.push(tag)
  }

  /**
   * 从 LLM 响应文本提取情感标签
   */
  extractEmotions(text: string, interactionQuality: number = 1.0): EmotionExtractionResult {
    const allTags = [...EMOTION_TAGS, ...this.customTags]
    const extracted: ExtractedEmotion[] = []

    let totalAffectionDelta = 0
    let positiveCount = 0
    let negativeCount = 0
    const emotionCounts = new Map<string, number>()

    for (const tag of allTags) {
      // 重置正则的 lastIndex
      const pattern = new RegExp(tag.pattern.source, tag.pattern.flags)
      const matches = text.match(pattern)
      const matchCount = matches ? matches.length : 0

      if (matchCount > 0) {
        const qualityMultiplier = tag.qualityMultiplier ?? 1.0
        const weightedDelta = Math.round(
          tag.affectionDelta * matchCount * qualityMultiplier * interactionQuality,
        )

        extracted.push({
          name: tag.name,
          polarity: tag.polarity,
          matchCount,
          affectionDelta: tag.affectionDelta,
          weightedDelta,
        })

        totalAffectionDelta += weightedDelta

        if (tag.polarity === 'positive') positiveCount += matchCount
        if (tag.polarity === 'negative') negativeCount += matchCount

        // 统计出现次数（用于找主导情感）
        const current = emotionCounts.get(tag.name) ?? 0
        emotionCounts.set(tag.name, current + matchCount)
      }
    }

    // 限制单次最大变化量
    totalAffectionDelta = Math.max(
      -this.MAX_SINGLE_DELTA,
      Math.min(this.MAX_SINGLE_DELTA, totalAffectionDelta),
    )

    // 找主导情感
    let dominantEmotion: string | null = null
    let maxCount = 0
    for (const [name, count] of emotionCounts) {
      if (count > maxCount) {
        maxCount = count
        dominantEmotion = name
      }
    }

    return {
      tags: extracted,
      totalAffectionDelta,
      positiveCount,
      negativeCount,
      dominantEmotion,
      qualityScore: interactionQuality,
    }
  }

  /**
   * 提取情感并写入 petStore
   * @returns 情感提取结果
   */
  extractAndApply(
    characterId: string,
    text: string,
    interactionQuality: number = 1.0,
  ): EmotionExtractionResult {
    const result = this.extractEmotions(text, interactionQuality)

    if (result.totalAffectionDelta !== 0) {
      const stats = usePetStore.getState().getCurrentStats()
      usePetStore.setState((state) => ({
        stats: {
          ...state.stats,
          [characterId]: {
            ...stats,
            affection: Math.max(0, Math.min(9999, stats.affection + result.totalAffectionDelta)),
            lastInteractionAt: Date.now(),
          },
        },
      }))
    }

    return result
  }

  /**
   * 快速判断文本是否包含正向情感
   */
  hasPositiveEmotion(text: string): boolean {
    for (const tag of EMOTION_TAGS) {
      if (tag.polarity !== 'positive') continue
      const pattern = new RegExp(tag.pattern.source, tag.pattern.flags)
      if (pattern.test(text)) return true
    }
    return false
  }

  /**
   * 快速判断文本是否包含负向情感
   */
  hasNegativeEmotion(text: string): boolean {
    for (const tag of EMOTION_TAGS) {
      if (tag.polarity !== 'negative') continue
      const pattern = new RegExp(tag.pattern.source, tag.pattern.flags)
      if (pattern.test(text)) return true
    }
    return false
  }
}

// ============ 单例 ============

let affectionQuantifierInstance: AffectionQuantifier | null = null

/** 获取好感度数值化器单例 */
export function getAffectionQuantifier(): AffectionQuantifier {
  if (!affectionQuantifierInstance) {
    affectionQuantifierInstance = new AffectionQuantifier()
  }
  return affectionQuantifierInstance
}
