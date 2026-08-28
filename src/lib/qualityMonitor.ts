/**
 * LLM 输出质量自动评估系统
 *
 * @fileoverview
 * MLOps 评估报告 P0 差距：LLM 输出质量无自动评估。
 * 本模块引入两层质量信号：
 *
 * 1. 隐式反馈信号（Implicit Feedback）：
 *    - 回复后用户是否继续对话（continuation rate）
 *    - 回复后用户是否切换话题（topic switch）
 *    - 回复后用户是否停止使用（drop-off）
 *    - 回复到下一条消息的时间间隔（response gap）
 *    这些信号无需用户显式评价，通过对话行为自动推断质量。
 *
 * 2. 启发式质量评分（Heuristic Quality Scoring）：
 *    - 回复长度合理性（过短/过长扣分）
 *    - 重复度检测（与近期回复的相似度，复用 antiRepetition）
 *    - 格式规范性（JSON 解析成功率、是否包含乱码）
 *    - 安全性初筛（是否包含高危关键词）
 *
 * 3. LLM-as-judge 质量评估（可选，异步）：
 *    - 当配置了 LLM 时，定期抽取样本回复让 LLM 打分
 *    - 评分维度：相关性、有用性、安全性、角色一致性
 *    - 低分回复触发告警
 *
 * 数据存储：本地 localStorage（加密），最多保留 500 条质量记录
 * 不上传任何服务器，隐私安全
 *
 * @module qualityMonitor
 * @requires ./analytics — 埋点记录
 * @requires ./runtimeMonitor — 性能指标
 * @requires ./stringSimilarity — 字符串相似度
 */

import { getAnalytics } from './analytics'
import { runtimeMonitor } from './runtimeMonitor'
import { stringSimilarity, tokenize } from './stringSimilarity'
import { encryptBlob, decryptBlob } from './blobCrypto'

// ============ 常量 ============

/** localStorage 存储键 */
const QUALITY_STORAGE_KEY = 'spiritpal-llm-quality'

/** 最大保留质量记录数 */
const MAX_QUALITY_RECORDS = 500

/** 质量评估触发 LLM-as-judge 的间隔（每 N 条回复触发一次） */
const JUDGE_INTERVAL = 20

/** 回复后用户继续对话的时间窗口（ms），超过视为 drop-off */
const CONTINUATION_WINDOW_MS = 5 * 60 * 1000 // 5 分钟

/** 质量分数阈值 */
const QUALITY_THRESHOLD_LOW = 0.4 // 低于此值触发告警
const QUALITY_THRESHOLD_GOOD = 0.7 // 高于此值视为良好

/** 回复长度合理区间（字符数） */
const MIN_RESPONSE_LENGTH = 5
const MAX_RESPONSE_LENGTH = 4000

/** 高危关键词（用于安全性初筛，非毒性过滤的完整方案） */
const HIGH_RISK_KEYWORDS = [
  '自杀', '自残', 'kill myself', 'suicide',
  '炸弹', '爆炸物', 'bomb', 'explosive',
  '毒品', '制毒', 'drug manufacturing',
]

// ============ 类型定义 ============

/** 质量评估维度 */
export interface QualityDimensions {
  /** 回复长度合理性（0-1） */
  lengthScore: number
  /** 重复度评分（0-1，越高越好=越不重复） */
  noveltyScore: number
  /** 格式规范性（0-1，JSON 解析成功率/无乱码） */
  formatScore: number
  /** 安全性初筛（0-1，越高越好） */
  safetyScore: number
  /** 用户隐式反馈（0-1，越高越好） */
  implicitFeedbackScore: number
}

/** 质量记录 */
export interface QualityRecord {
  /** 记录 ID */
  id: string
  /** 时间戳 */
  timestamp: number
  /** LLM provider */
  provider: string
  /** 模型名 */
  model: string
  /** 用户消息摘要（前 100 字符，用于去重和隐私） */
  userMessagePreview: string
  /** 回复摘要（前 200 字符） */
  responsePreview: string
  /** 回复总长度 */
  responseLength: number
  /** 响应延迟（ms） */
  latencyMs: number
  /** 各维度分数 */
  dimensions: QualityDimensions
  /** 综合质量分数（0-1） */
  overallScore: number
  /** 隐式反馈状态 */
  implicitFeedback: ImplicitFeedbackState
  /** 是否经过了 LLM-as-judge 评估 */
  judgedByLLM: boolean
  /** LLM-as-judge 评分（如果有） */
  judgeScore?: number
  /** LLM-as-judge 评语（如果有） */
  judgeComment?: string
}

/** 隐式反馈状态 */
export type ImplicitFeedbackState =
  | 'pending'     // 等待用户反应
  | 'continued'   // 用户继续对话（正面信号）
  | 'dropped'     // 用户未继续对话（负面信号）
  | 'topic_switch' // 用户切换话题（中性/负面信号）

/** 质量趋势统计 */
export interface QualityTrend {
  /** 总评估次数 */
  totalEvaluations: number
  /** 平均质量分数 */
  avgScore: number
  /** 低质量回复比例 */
  lowQualityRatio: number
  /** 良好回复比例 */
  goodQualityRatio: number
  /** 用户继续对话率 */
  continuationRate: number
  /** 用户流失率 */
  dropOffRate: number
  /** 最近 N 条质量分数 */
  recentScores: number[]
  /** 质量退化趋势（最近 20 条 vs 之前 20 条的均值差） */
  degradationTrend: number
}

// ============ 质量监控器 ============

/**
 * LLM 输出质量监控器（单例）
 *
 * 工作流程：
 * 1. recordResponse() — 每次收到 LLM 回复时调用，记录启发式评分
 * 2. recordUserAction() — 用户后续行为时调用，更新隐式反馈
 * 3. 超时后未收到用户行为 → 标记为 'dropped'
 * 4. 每 JUDGE_INTERVAL 条触发一次 LLM-as-judge（如果配置了 LLM）
 */
export class QualityMonitor {
  private records: QualityRecord[] = []
  private initialized = false
  private pendingRecord: QualityRecord | null = null
  private pendingTimeout: ReturnType<typeof setTimeout> | null = null
  private judgeCounter = 0

  /** 最近回复文本池（用于重复度检测） */
  private recentResponses: string[] = []
  private readonly recentPoolSize = 20

  constructor() {
    // 异步加载历史记录（fire-and-forget）
    void this.loadRecords()
  }

  // ============ 公开 API ============

  /**
   * 记录一条 LLM 回复，执行启发式质量评估
   *
   * @param provider LLM 服务商
   * @param model 模型名
   * @param userMessage 用户消息原文
   * @param response LLM 回复原文
   * @param latencyMs 响应延迟
   * @returns 质量记录 ID
   */
  recordResponse(
    provider: string,
    model: string,
    userMessage: string,
    response: string,
    latencyMs: number,
  ): string {
    const id = `q_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    // 启发式评分
    const dimensions = this.scoreHeuristics(userMessage, response)

    // 综合分数（加权平均）
    const overallScore = this.computeOverallScore(dimensions)

    const record: QualityRecord = {
      id,
      timestamp: Date.now(),
      provider,
      model,
      userMessagePreview: userMessage.slice(0, 100),
      responsePreview: response.slice(0, 200),
      responseLength: response.length,
      latencyMs,
      dimensions,
      overallScore,
      implicitFeedback: 'pending',
      judgedByLLM: false,
    }

    // 添加到记录
    this.records.push(record)
    if (this.records.length > MAX_QUALITY_RECORDS) {
      this.records = this.records.slice(-MAX_QUALITY_RECORDS)
    }

    // 更新最近回复池
    this.recentResponses.push(response)
    if (this.recentResponses.length > this.recentPoolSize) {
      this.recentResponses.shift()
    }

    // 取消上一个 pending 的隐式反馈（用户已发新消息 = 继续对话）
    if (this.pendingRecord) {
      this.updateImplicitFeedback(this.pendingRecord.id, 'continued')
    }

    // 设置当前为 pending，超时后标记为 dropped
    this.pendingRecord = record
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout)
    }
    this.pendingTimeout = setTimeout(() => {
      if (this.pendingRecord && this.pendingRecord.id === id) {
        this.updateImplicitFeedback(id, 'dropped')
        this.pendingRecord = null
      }
    }, CONTINUATION_WINDOW_MS)

    // 低质量告警
    if (overallScore < QUALITY_THRESHOLD_LOW) {
      runtimeMonitor.emitAlertProxy('low_quality_response', {
        score: overallScore,
        provider,
        model,
        preview: record.responsePreview,
      })
    }

    // 记录埋点
    getAnalytics().track('chat_receive', {
      response_length: response.length,
      model,
      latency_ms: latencyMs,
      quality_score: Math.round(overallScore * 100) / 100,
    })

    // 触发 LLM-as-judge（每 N 条）
    this.judgeCounter++
    if (this.judgeCounter >= JUDGE_INTERVAL) {
      this.judgeCounter = 0
      // 异步触发，不阻塞
      void this.triggerLLMJudge(record, userMessage, response)
    }

    // 异步持久化
    void this.saveRecords()

    return id
  }

  /**
   * 记录用户后续行为，更新隐式反馈
   *
   * @param qualityId recordResponse 返回的 ID
   * @param action 用户行为类型
   * @param newMessage 用户的新消息（用于判断是否切换话题）
   */
  recordUserAction(
    qualityId: string,
    action: 'message' | 'close' | 'switch_topic',
    newMessage?: string,
  ): void {
    if (action === 'message' && newMessage !== undefined && this.pendingRecord) {
      // 判断是否切换话题
      const prevMsg = this.pendingRecord.userMessagePreview
      const isTopicSwitch = this.detectTopicSwitch(prevMsg, newMessage)
      this.updateImplicitFeedback(qualityId, isTopicSwitch ? 'topic_switch' : 'continued')
    } else if (action === 'message') {
      this.updateImplicitFeedback(qualityId, 'continued')
    } else if (action === 'close') {
      this.updateImplicitFeedback(qualityId, 'dropped')
    }
  }

  /**
   * 获取质量趋势统计
   */
  getTrend(): QualityTrend {
    const records = this.records
    if (records.length === 0) {
      return {
        totalEvaluations: 0,
        avgScore: 0,
        lowQualityRatio: 0,
        goodQualityRatio: 0,
        continuationRate: 0,
        dropOffRate: 0,
        recentScores: [],
        degradationTrend: 0,
      }
    }

    const scores = records.map((r) => r.overallScore)
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
    const lowCount = scores.filter((s) => s < QUALITY_THRESHOLD_LOW).length
    const goodCount = scores.filter((s) => s >= QUALITY_THRESHOLD_GOOD).length

    const feedbackRecords = records.filter((r) => r.implicitFeedback !== 'pending')
    const continuedCount = feedbackRecords.filter((r) => r.implicitFeedback === 'continued').length
    const droppedCount = feedbackRecords.filter((r) => r.implicitFeedback === 'dropped').length

    // 退化趋势：最近 20 条 vs 之前 20 条
    const recent20 = scores.slice(-20)
    const prev20 = scores.slice(-40, -20)
    const recentAvg = recent20.length > 0 ? recent20.reduce((a, b) => a + b, 0) / recent20.length : 0
    const prevAvg = prev20.length > 0 ? prev20.reduce((a, b) => a + b, 0) / prev20.length : 0
    const degradationTrend = recentAvg - prevAvg // 负数 = 退化

    return {
      totalEvaluations: records.length,
      avgScore: Math.round(avgScore * 1000) / 1000,
      lowQualityRatio: Math.round((lowCount / records.length) * 1000) / 1000,
      goodQualityRatio: Math.round((goodCount / records.length) * 1000) / 1000,
      continuationRate: feedbackRecords.length > 0
        ? Math.round((continuedCount / feedbackRecords.length) * 1000) / 1000 : 0,
      dropOffRate: feedbackRecords.length > 0
        ? Math.round((droppedCount / feedbackRecords.length) * 1000) / 1000 : 0,
      recentScores: scores.slice(-20),
      degradationTrend: Math.round(degradationTrend * 1000) / 1000,
    }
  }

  /**
   * 获取所有质量记录（用于导出/分析）
   */
  getRecords(): QualityRecord[] {
    return [...this.records]
  }

  /**
   * 清除所有质量记录
   */
  clearRecords(): void {
    this.records = []
    this.recentResponses = []
    this.pendingRecord = null
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout)
      this.pendingTimeout = null
    }
    try {
      localStorage.removeItem(QUALITY_STORAGE_KEY)
    } catch {
      // 忽略
    }
  }

  // ============ 启发式评分 ============

  /**
   * 启发式质量评分
   */
  private scoreHeuristics(userMessage: string, response: string): QualityDimensions {
    return {
      lengthScore: this.scoreLength(response),
      noveltyScore: this.scoreNovelty(response),
      formatScore: this.scoreFormat(response),
      safetyScore: this.scoreSafety(response),
      implicitFeedbackScore: 0.5, // 初始中性，后续更新
    }
  }

  /** 回复长度合理性评分 */
  private scoreLength(response: string): number {
    const len = response.length
    if (len < MIN_RESPONSE_LENGTH) return 0.1
    if (len > MAX_RESPONSE_LENGTH) return 0.3
    // 理想区间 20-2000 字符 → 满分
    if (len >= 20 && len <= 2000) return 1.0
    // 过渡区间
    if (len < 20) return 0.3 + (len - MIN_RESPONSE_LENGTH) / (20 - MIN_RESPONSE_LENGTH) * 0.7
    return Math.max(0.5, 1.0 - (len - 2000) / (MAX_RESPONSE_LENGTH - 2000) * 0.7)
  }

  /** 重复度/新颖度评分 */
  private scoreNovelty(response: string): number {
    if (this.recentResponses.length === 0) return 1.0

    // 计算与最近回复的最大相似度
    let maxSim = 0
    for (const prev of this.recentResponses) {
      const sim = stringSimilarity(response, prev)
      if (sim > maxSim) maxSim = sim
    }

    // 相似度越高，新颖度越低
    return Math.max(0, 1.0 - maxSim)
  }

  /** 格式规范性评分 */
  private scoreFormat(response: string): number {
    let score = 1.0

    // 检查是否有乱码（连续非 ASCII 控制字符）
    // eslint-disable-next-line no-control-regex -- 控制字符检测是故意的（安全过滤）
    const controlCharCount = (response.match(/[\x00-\x08\x0E-\x1F]/g) || []).length
    if (controlCharCount > 0) {
      score -= 0.3 * Math.min(1, controlCharCount / 10)
    }

    // 检查是否有重复字符（如 "啊啊啊啊啊啊啊啊"）
    const repeatedCharMatch = response.match(/(.)\1{20,}/g)
    if (repeatedCharMatch) {
      score -= 0.2
    }

    // 检查是否为有效文本（非空且含可读字符）
    const readableChars = response.replace(/[\s\p{P}]/gu, '').length
    if (readableChars === 0) {
      score = 0.0
    }

    return Math.max(0, Math.min(1, score))
  }

  /** 安全性初筛评分 */
  private scoreSafety(response: string): number {
    const lowerResponse = response.toLowerCase()
    for (const keyword of HIGH_RISK_KEYWORDS) {
      if (lowerResponse.includes(keyword.toLowerCase())) {
        // 检测到高危关键词，大幅扣分
        return 0.2
      }
    }
    return 1.0
  }

  /** 综合质量分数计算 */
  private computeOverallScore(dimensions: QualityDimensions): number {
    // 加权平均
    const weights = {
      length: 0.15,
      novelty: 0.25,
      format: 0.15,
      safety: 0.25,
      implicitFeedback: 0.20,
    }

    const score =
      dimensions.lengthScore * weights.length +
      dimensions.noveltyScore * weights.novelty +
      dimensions.formatScore * weights.format +
      dimensions.safetyScore * weights.safety +
      dimensions.implicitFeedbackScore * weights.implicitFeedback

    return Math.max(0, Math.min(1, score))
  }

  // ============ 隐式反馈 ============

  /** 更新隐式反馈状态 */
  private updateImplicitFeedback(recordId: string, state: ImplicitFeedbackState): void {
    const record = this.records.find((r) => r.id === recordId)
    if (!record) return

    record.implicitFeedback = state

    // 更新隐式反馈分数
    const feedbackScoreMap: Record<ImplicitFeedbackState, number> = {
      pending: 0.5,
      continued: 1.0,
      dropped: 0.1,
      topic_switch: 0.4,
    }
    record.dimensions.implicitFeedbackScore = feedbackScoreMap[state]

    // 重新计算综合分数
    record.overallScore = this.computeOverallScore(record.dimensions)

    // 清理 pending
    if (this.pendingRecord?.id === recordId) {
      this.pendingRecord = null
    }
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout)
      this.pendingTimeout = null
    }

    void this.saveRecords()
  }

  /** 检测话题是否切换 */
  private detectTopicSwitch(prevMessage: string, newMessage: string): boolean {
    // 使用 token 重叠率判断
    const prevTokens = new Set(tokenize(prevMessage))
    const newTokens = new Set(tokenize(newMessage))

    if (prevTokens.size === 0 || newTokens.size === 0) return true

    const intersection = new Set([...prevTokens].filter((t) => newTokens.has(t)))
    const union = new Set([...prevTokens, ...newTokens])
    const jaccardSim = intersection.size / union.size

    // Jaccard 相似度 < 0.15 视为话题切换
    return jaccardSim < 0.15
  }

  // ============ LLM-as-judge ============

  /**
   * 触发 LLM-as-judge 质量评估
   * 异步执行，不阻塞主流程
   */
  private async triggerLLMJudge(
    record: QualityRecord,
    userMessage: string,
    response: string,
  ): Promise<void> {
    try {
      // 动态导入避免循环依赖
      const { loadAIConfig } = await import('./aiConfig')
      const { getLLMClient } = await import('./llmClient')

      const config = await loadAIConfig()
      if (!config.apiKey && config.provider !== 'ollama') return

      const client = getLLMClient(config)

      const judgePrompt = `你是一个 AI 回复质量评估器。请根据以下用户消息和 AI 回复，给出质量评分。

评分维度（每项 0-10 分）：
1. 相关性：回复是否切题
2. 有用性：回复是否有帮助
3. 安全性：回复是否安全无害
4. 角色一致性：回复是否符合桌面宠物的角色设定

用户消息：${userMessage.slice(0, 500)}
AI 回复：${response.slice(0, 500)}

请返回 JSON 格式：{"relevance": N, "usefulness": N, "safety": N, "consistency": N, "comment": "简要评语"}
只返回 JSON，不要包含其他文本。`

      const messages = [
        { id: `judge-sys-${Date.now()}`, role: 'system' as const, content: judgePrompt, timestamp: Date.now() },
        { id: `judge-usr-${Date.now()}`, role: 'user' as const, content: '请评估', timestamp: Date.now() },
      ]

      const rawResponse = await client.chatOnce(messages)

      // 解析 JSON
      const jsonMatch = rawResponse.match(/\{[\s\S]*\}/)
      if (!jsonMatch) return

      const parsed = JSON.parse(jsonMatch[0]) as {
        relevance?: number
        usefulness?: number
        safety?: number
        consistency?: number
        comment?: string
      }

      const scores = [
        parsed.relevance ?? 5,
        parsed.usefulness ?? 5,
        parsed.safety ?? 5,
        parsed.consistency ?? 5,
      ]
      const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length / 10 // 归一化到 0-1

      // 更新记录
      record.judgedByLLM = true
      record.judgeScore = Math.round(avgScore * 100) / 100
      record.judgeComment = parsed.comment?.slice(0, 200)

      // 如果 judge 评分很低，触发告警
      if (avgScore < QUALITY_THRESHOLD_LOW) {
        runtimeMonitor.emitAlertProxy('llm_judge_low_score', {
          score: avgScore,
          comment: record.judgeComment,
          provider: record.provider,
        })
      }

      void this.saveRecords()
    } catch {
      // LLM-as-judge 失败不影响主流程
    }
  }

  // ============ 持久化 ============

  private async loadRecords(): Promise<void> {
    try {
      const raw = localStorage.getItem(QUALITY_STORAGE_KEY)
      if (!raw) return

      // 尝试解密（兼容加密存储）
      let json: string
      if (raw.startsWith('ENC1:') || raw.startsWith('ENC2:')) {
        try {
          json = await decryptBlob(raw)
        } catch {
          json = raw // 可能是明文
        }
      } else {
        json = raw
      }

      this.records = JSON.parse(json)
      this.initialized = true
    } catch {
      this.records = []
    }
  }

  private async saveRecords(): Promise<void> {
    try {
      const json = JSON.stringify(this.records)
      // 尝试加密
      try {
        const ciphertext = await encryptBlob(json)
        if (ciphertext) {
          localStorage.setItem(QUALITY_STORAGE_KEY, ciphertext)
          return
        }
      } catch {
        // 加密失败降级明文
      }
      localStorage.setItem(QUALITY_STORAGE_KEY, json)
    } catch {
      // 存储失败静默忽略
    }
  }
}

// ============ 单例 ============

let instance: QualityMonitor | null = null

export function getQualityMonitor(): QualityMonitor {
  if (!instance) {
    instance = new QualityMonitor()
  }
  return instance
}

/**
 * 重置单例（测试用）
 */
export function resetQualityMonitor(): void {
  instance = null
}
