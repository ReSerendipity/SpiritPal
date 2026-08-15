/**
 * 双脑架构 — Fast Brain（快速路径）+ Slow Brain（复杂推理）
 * 参考 super-agent-party 的双脑设计
 *
 * @fileoverview
 * 主要模块：
 * - DualBrainConfig 接口：双脑配置（Fast/Slow Brain 模型配置、复杂度阈值、置信度阈值等）
 * - ComplexityAssessment 接口：复杂度评估结果（分数、各维度分数、建议大脑、原因）
 * - BrainResponse 接口：大脑响应结果
 * - DualBrain 类：双脑协调器，支持复杂度评估、自动路由、置信度评分、自动升级
 *
 * 核心功能：
 * 1. Fast Brain: 规则匹配 + 小模型快速响应
 * 2. Slow Brain: 强模型 + Agent 工具迭代
 * 3. 自动决策：基于输入复杂度选择大脑
 * 4. 置信度评分：Fast Brain 响应的置信度
 * 5. 自动升级：低置信度时从 Fast 升级到 Slow
 *
 * @module dualBrain
 * @requires ./llmClient - LLM 客户端
 * @requires ./types - AIConfig, ChatMessage 类型定义
 * @requires ./stringSimilarity - estimateTokens token 估算
 */

import { getLLMClient } from './llmClient'
import type { AIConfig, ChatMessage } from './types'
import { estimateTokens } from './stringSimilarity'

// ============ 双脑配置 ============

/** 双脑架构配置 */
export interface DualBrainConfig {
  /** Fast Brain 配置（小模型，快速响应） */
  fastBrain: AIConfig
  /** Slow Brain 配置（强模型，复杂任务） */
  slowBrain: AIConfig
  /** 复杂度阈值（0-1，超过此值使用 Slow Brain，默认 0.6） */
  complexityThreshold: number
  /** Fast Brain 置信度阈值（低于此值升级到 Slow Brain，默认 0.5） */
  confidenceThreshold: number
  /** Fast Brain 最大 token 数（默认 256，限制响应长度） */
  fastBrainMaxTokens: number
  /** 是否启用双脑（默认 true，false 则始终使用 Slow Brain） */
  enabled: boolean
}

// ============ 复杂度评估 ============

/** 复杂度评估结果 */
export interface ComplexityAssessment {
  /** 复杂度分数（0-1，越高越复杂） */
  score: number
  /** 各维度分数 */
  dimensions: {
    /** 输入长度复杂度 */
    length: number
    /** 推理需求复杂度（含逻辑/数学/编程等） */
    reasoning: number
    /** 工具需求复杂度（含操作/搜索等） */
    toolNeed: number
    /** 情感复杂度（含复杂情感/冲突等） */
    emotion: number
    /** 上下文复杂度（长对话/多话题） */
    context: number
  }
  /** 建议使用的大脑 */
  suggestedBrain: 'fast' | 'slow'
  /** 评估原因 */
  reason: string
}

/** 推理关键词 */
const REASONING_KEYWORDS = [
  '为什么', '怎么', '如何', '分析', '推理', '逻辑', '证明', '计算',
  '比较', '评估', '判断', '决策', '规划', '设计',
  'why', 'how', 'analyze', 'reason', 'logic', 'prove', 'calculate',
  'compare', 'evaluate', 'judge', 'decide', 'plan', 'design',
]

/** 工具需求关键词 */
const TOOL_KEYWORDS = [
  '打开', '搜索', '提醒', '日程', '天气', '执行', '操作',
  'open', 'search', 'remind', 'schedule', 'weather', 'execute', 'run',
]

/** 复杂情感关键词 */
const COMPLEX_EMOTION_KEYWORDS = [
  '矛盾', '纠结', '困惑', '迷茫', '压力', '焦虑', '抑郁', '崩溃',
  'conflict', 'confused', 'lost', 'stress', 'anxiety', 'depressed',
]

/**
 * 评估输入的复杂度
 * @param input 用户输入
 * @param contextLength 上下文长度（消息数）
 * @returns 复杂度评估结果
 */
export function assessComplexity(
  input: string,
  contextLength: number = 0,
): ComplexityAssessment {
  // 1. 长度复杂度：基于 token 数量
  const tokenCount = estimateTokens(input)
  const length = Math.min(1, tokenCount / 200) // 200 token 为高复杂度

  // 2. 推理复杂度：基于推理关键词
  const reasoningKwCount = REASONING_KEYWORDS.filter((kw) => input.includes(kw)).length
  const reasoning = Math.min(1, reasoningKwCount * 0.3)

  // 3. 工具需求复杂度
  const toolKwCount = TOOL_KEYWORDS.filter((kw) => input.includes(kw)).length
  const toolNeed = Math.min(1, toolKwCount * 0.4)

  // 4. 情感复杂度
  const emotionKwCount = COMPLEX_EMOTION_KEYWORDS.filter((kw) => input.includes(kw)).length
  const emotion = Math.min(1, emotionKwCount * 0.5)

  // 5. 上下文复杂度
  const context = Math.min(1, contextLength / 20) // 20 轮为高复杂度

  // 加权融合
  const score =
    length * 0.2 +
    reasoning * 0.35 +
    toolNeed * 0.25 +
    emotion * 0.1 +
    context * 0.1

  const suggestedBrain = score >= 0.6 ? 'slow' : 'fast'

  // 生成原因描述
  const reasons: string[] = []
  if (reasoning > 0.3) reasons.push('需要推理')
  if (toolNeed > 0.3) reasons.push('需要工具')
  if (length > 0.5) reasons.push('输入较长')
  if (emotion > 0.3) reasons.push('情感复杂')
  if (context > 0.5) reasons.push('上下文较长')

  return {
    score,
    dimensions: { length, reasoning, toolNeed, emotion, context },
    suggestedBrain,
    reason: reasons.length > 0 ? reasons.join('、') : '简单对话',
  }
}

// ============ Fast Brain 响应置信度 ============

/**
 * 评估 Fast Brain 响应的置信度
 * 基于响应长度、重复度、相关性等指标
 *
 * @param input 用户输入
 * @param response Fast Brain 的响应
 * @returns 置信度分数（0-1，越高越可信）
 */
export function assessConfidence(input: string, response: string): number {
  if (!response || response.trim().length === 0) return 0

  let confidence = 0.5 // 基础置信度

  // 响应过短（可能是不完整的回答）
  if (response.length < 10) confidence -= 0.3
  else if (response.length > 20) confidence += 0.1

  // 响应过长（可能超出 Fast Brain 能力）
  if (response.length > 500) confidence -= 0.1

  // 包含不确定性标记（"不确定"、"可能"、"也许"等）
  const uncertaintyMarkers = ['不确定', '可能', '也许', '大概', '也许', 'maybe', 'perhaps', 'might', 'not sure']
  const hasUncertainty = uncertaintyMarkers.some((m) => response.includes(m))
  if (hasUncertainty) confidence -= 0.2

  // 包含道歉/无法回答
  const failMarkers = ['抱歉', '无法', '不知道', '对不起', 'sorry', 'cannot', "don't know", 'unable']
  const hasFail = failMarkers.some((m) => response.includes(m))
  if (hasFail) confidence -= 0.4

  // 与输入的相关性（简单检查：响应中是否包含输入的关键词）
  const inputTokens = new Set(input.split(/\s+/).filter((t) => t.length > 1))
  let relevanceCount = 0
  for (const token of inputTokens) {
    if (response.includes(token)) relevanceCount++
  }
  if (inputTokens.size > 0) {
    const relevance = relevanceCount / inputTokens.size
    confidence += relevance * 0.2
  }

  return Math.max(0, Math.min(1, confidence))
}

// ============ 双脑架构管理器 ============

/**
 * 双脑架构管理器
 * 根据输入复杂度自动选择 Fast Brain 或 Slow Brain
 */
export class DualBrainManager {
  private config: DualBrainConfig

  constructor(config: DualBrainConfig) {
    this.config = config
  }

  /**
   * 处理用户输入：自动选择大脑并生成响应
   *
   * @param messages 消息列表
   * @param onChunk 流式 chunk 回调（可选）
   * @param abortSignal 中断信号
   * @returns 响应文本和元信息
   */
  async process(
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<{
    response: string
    brain: 'fast' | 'slow'
    complexity: ComplexityAssessment
    confidence?: number
    escalated?: boolean
  }> {
    // 双脑未启用，始终使用 Slow Brain
    if (!this.config.enabled) {
      const response = await this.slowBrainChat(messages, onChunk, abortSignal)
      const complexity = assessComplexity(
        messages[messages.length - 1]?.content ?? '',
        messages.length,
      )
      return { response, brain: 'slow', complexity }
    }

    // 评估复杂度
    const lastUserMessage = messages[messages.length - 1]?.content ?? ''
    const complexity = assessComplexity(lastUserMessage, messages.length)

    // 高复杂度直接使用 Slow Brain
    if (complexity.score >= this.config.complexityThreshold) {
      const response = await this.slowBrainChat(messages, onChunk, abortSignal)
      return { response, brain: 'slow', complexity }
    }

    // 使用 Fast Brain
    const fastResponse = await this.fastBrainChat(messages, abortSignal)

    // 评估 Fast Brain 响应置信度
    const confidence = assessConfidence(lastUserMessage, fastResponse)

    // 置信度过低，升级到 Slow Brain
    if (confidence < this.config.confidenceThreshold) {
      const slowResponse = await this.slowBrainChat(messages, onChunk, abortSignal)
      return {
        response: slowResponse,
        brain: 'slow',
        complexity,
        confidence,
        escalated: true,
      }
    }

    // Fast Brain 响应可接受
    if (onChunk) {
      onChunk(fastResponse)
    }

    return {
      response: fastResponse,
      brain: 'fast',
      complexity,
      confidence,
    }
  }

  /** Fast Brain 聊天 */
  private async fastBrainChat(
    messages: ChatMessage[],
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const client = getLLMClient({
      ...this.config.fastBrain,
      maxTokens: this.config.fastBrainMaxTokens,
    })
    return client.chatOnce(messages, abortSignal)
  }

  /** Slow Brain 聊天 */
  private async slowBrainChat(
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const client = getLLMClient(this.config.slowBrain)
    return client.chat(messages, onChunk, abortSignal)
  }

  /** 更新配置 */
  updateConfig(config: Partial<DualBrainConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /** 获取配置 */
  getConfig(): DualBrainConfig {
    return { ...this.config }
  }
}

// ============ 单例 ============

let instance: DualBrainManager | null = null

/**
 * 获取双脑架构管理器单例
 * @param config 配置（首次调用时生效）
 */
export function getDualBrainManager(config?: DualBrainConfig): DualBrainManager {
  if (!instance && config) {
    instance = new DualBrainManager(config)
  }
  if (!instance) {
    throw new Error('DualBrainManager 未初始化，请先提供配置')
  }
  return instance
}

/**
 * 初始化双脑架构管理器
 * @param config 配置
 */
export function initDualBrainManager(config: DualBrainConfig): DualBrainManager {
  instance = new DualBrainManager(config)
  return instance
}
