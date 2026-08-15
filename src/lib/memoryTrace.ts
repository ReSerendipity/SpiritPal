/**
 * 可解释记忆追踪模块
 *
 * @fileoverview 记录每次记忆召回的完整路径与评分详情，提供检索可解释性
 *
 * 主要模块：
 * - RecallTrace: 单条结果的召回追踪（分数、排名、来源、原因）
 * - RetrievalTrace: 一次检索的完整追踪记录
 * - MemoryTraceManager: 记忆追踪管理器
 *
 * 依赖关系：
 * - memoryTypes.ts: EnhancedMemory 类型定义
 *
 * 核心接口：
 * - startTrace(): 开始一次检索追踪
 * - recordResult(): 记录单条结果的召回详情
 * - endTrace(): 结束追踪并保存
 * - getRecentTraces(): 获取近期追踪记录
 * - explainResult(): 生成召回原因文本
 *
 * 核心功能：
 * 1. 完整路径追踪：查询→检索→排序→结果的全链路记录
 * 2. 详细评分记录：BM25分数、向量相似度、融合分数、排名
 * 3. 召回原因生成：如"因为与'用户喜欢猫'相似(0.85)"
 * 4. 日志查询导出：支持追踪历史查询与导出
 * 5. 检索策略标注：vector_only/bm25_only/hybrid/lcs_fallback
 *
 * 参考：OpenMemory 可解释性设计
 */

import type { EnhancedMemory } from './memoryTypes'

// ============ 追踪类型定义 ============

/** 单条结果的召回追踪 */
export interface RecallTrace {
  /** 记忆 ID */
  memoryId: string
  /** 记忆内容摘要（前 80 字） */
  contentPreview: string
  /** 召回原因描述 */
  reason: string
  /** 检索来源 */
  source: 'bm25' | 'vector' | 'keyword' | 'lcs' | 'hybrid'
  /** BM25 分数（-1 表示未使用） */
  bm25Score: number
  /** 向量相似度分数（-1 表示未使用） */
  vectorScore: number
  /** 融合分数（最终排序分数） */
  fusionScore: number
  /** BM25 排名（-1 表示未参与） */
  bm25Rank: number
  /** 向量排名（-1 表示未参与） */
  vectorRank: number
}

/** 一次检索的完整追踪记录 */
export interface RetrievalTrace {
  /** 追踪 ID */
  id: string
  /** 检索时间戳 */
  timestamp: number
  /** 查询文本 */
  query: string
  /** 查询来源 */
  querySource: 'chat' | 'trigger' | 'context' | 'manual'
  /** 检索耗时（毫秒） */
  durationMs: number
  /** 候选集大小 */
  candidateCount: number
  /** 结果列表 */
  results: RecallTrace[]
  /** 使用的检索策略 */
  strategy: 'vector_only' | 'bm25_only' | 'hybrid' | 'lcs_fallback' | 'keyword'
  /** 配置参数快照 */
  configSnapshot?: {
    alpha?: number
    topK?: number
    vectorMinScore?: number
    bm25MinScore?: number
  }
}

// ============ 追踪管理器 ============

/** 追踪日志配置 */
export interface TraceConfig {
  /** 是否启用追踪（默认 true） */
  enabled: boolean
  /** 最大保留追踪记录数（默认 200） */
  maxRecords: number
  /** 是否记录配置快照（默认 false，减少存储） */
  recordConfig: boolean
}

const DEFAULT_TRACE_CONFIG: TraceConfig = {
  enabled: true,
  maxRecords: 200,
  recordConfig: false,
}

/**
 * 记忆追踪管理器
 * 记录每次检索的完整信息，支持可解释性展示和调试
 */
export class MemoryTraceManager {
  private config: TraceConfig
  private traces: RetrievalTrace[] = []
  private currentTrace: Partial<RetrievalTrace> | null = null
  private startTime = 0

  constructor(config: Partial<TraceConfig> = {}) {
    this.config = { ...DEFAULT_TRACE_CONFIG, ...config }
  }

  /**
   * 开始一次追踪
   * @param query 查询文本
   * @param source 查询来源
   * @param candidateCount 候选集大小
   */
  beginTrace(
    query: string,
    source: RetrievalTrace['querySource'] = 'chat',
    candidateCount = 0,
  ): void {
    if (!this.config.enabled) return

    this.startTime = performance.now()
    this.currentTrace = {
      id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      query,
      querySource: source,
      candidateCount,
      results: [],
    }
  }

  /**
   * 记录一条结果的召回信息
   * @param memory 被召回的记忆
   * @param reason 召回原因
   * @param source 检索来源
   * @param scores 分数信息
   */
  addResult(
    memory: EnhancedMemory,
    reason: string,
    source: RecallTrace['source'],
    scores: {
      bm25Score?: number
      vectorScore?: number
      fusionScore?: number
      bm25Rank?: number
      vectorRank?: number
    } = {},
  ): void {
    if (!this.config.enabled || !this.currentTrace) return

    const trace: RecallTrace = {
      memoryId: memory.id,
      contentPreview: memory.user.slice(0, 80),
      reason,
      source,
      bm25Score: scores.bm25Score ?? -1,
      vectorScore: scores.vectorScore ?? -1,
      fusionScore: scores.fusionScore ?? 0,
      bm25Rank: scores.bm25Rank ?? -1,
      vectorRank: scores.vectorRank ?? -1,
    }

    this.currentTrace.results!.push(trace)
  }

  /**
   * 设置检索策略
   */
  setStrategy(strategy: RetrievalTrace['strategy']): void {
    if (!this.config.enabled || !this.currentTrace) return
    this.currentTrace.strategy = strategy
  }

  /**
   * 设置配置快照
   */
  setConfigSnapshot(snapshot: NonNullable<RetrievalTrace['configSnapshot']>): void {
    if (!this.config.enabled || !this.currentTrace || !this.config.recordConfig) return
    this.currentTrace.configSnapshot = snapshot
  }

  /**
   * 结束当前追踪并保存
   * @returns 完成的追踪记录（null 如果追踪未启用）
   */
  endTrace(): RetrievalTrace | null {
    if (!this.config.enabled || !this.currentTrace) return null

    const trace: RetrievalTrace = {
      id: this.currentTrace.id!,
      timestamp: this.currentTrace.timestamp!,
      query: this.currentTrace.query!,
      querySource: this.currentTrace.querySource!,
      durationMs: Math.round(performance.now() - this.startTime),
      candidateCount: this.currentTrace.candidateCount ?? 0,
      results: this.currentTrace.results ?? [],
      strategy: this.currentTrace.strategy ?? 'hybrid',
      configSnapshot: this.currentTrace.configSnapshot,
    }

    this.traces.push(trace)

    // 限制追踪日志大小
    if (this.traces.length > this.config.maxRecords) {
      this.traces = this.traces.slice(-Math.floor(this.config.maxRecords * 0.8))
    }

    this.currentTrace = null
    return trace
  }

  // ============ 查询接口 ============

  /**
   * 获取最近的追踪记录
   * @param limit 返回条数
   */
  getRecentTraces(limit = 20): RetrievalTrace[] {
    return this.traces.slice(-limit).reverse()
  }

  /**
   * 获取指定记忆的所有召回记录
   * @param memoryId 记忆 ID
   */
  getTracesForMemory(memoryId: string): RetrievalTrace[] {
    return this.traces.filter((t) =>
      t.results.some((r) => r.memoryId === memoryId),
    )
  }

  /**
   * 获取指定查询来源的追踪记录
   * @param source 查询来源
   */
  getTracesBySource(source: RetrievalTrace['querySource']): RetrievalTrace[] {
    return this.traces.filter((t) => t.querySource === source)
  }

  /**
   * 获取检索质量统计
   */
  getStats(): {
    /** 总检索次数 */
    totalRetrievals: number
    /** 平均检索耗时 */
    avgDurationMs: number
    /** 平均结果数 */
    avgResultCount: number
    /** 按策略统计 */
    byStrategy: Record<string, number>
    /** 按来源统计 */
    bySource: Record<string, number>
    /** 空结果比例 */
    emptyResultRate: number
  } {
    if (this.traces.length === 0) {
      return {
        totalRetrievals: 0,
        avgDurationMs: 0,
        avgResultCount: 0,
        byStrategy: {},
        bySource: {},
        emptyResultRate: 0,
      }
    }

    const totalDuration = this.traces.reduce((sum, t) => sum + t.durationMs, 0)
    const totalResults = this.traces.reduce((sum, t) => sum + t.results.length, 0)
    const emptyCount = this.traces.filter((t) => t.results.length === 0).length

    const byStrategy: Record<string, number> = {}
    const bySource: Record<string, number> = {}
    for (const t of this.traces) {
      byStrategy[t.strategy] = (byStrategy[t.strategy] || 0) + 1
      bySource[t.querySource] = (bySource[t.querySource] || 0) + 1
    }

    return {
      totalRetrievals: this.traces.length,
      avgDurationMs: Math.round(totalDuration / this.traces.length),
      avgResultCount: Math.round(totalResults / this.traces.length * 10) / 10,
      byStrategy,
      bySource,
      emptyResultRate: Math.round((emptyCount / this.traces.length) * 100) / 100,
    }
  }

  /**
   * 生成召回原因描述（用于 UI 展示）
   * @param trace 单条召回追踪
   * @returns 人类可读的召回原因
   */
  formatRecallReason(trace: RecallTrace): string {
    const parts: string[] = []

    if (trace.vectorScore > 0) {
      parts.push(`语义相似(${trace.vectorScore.toFixed(2)})`)
    }
    if (trace.bm25Score > 0) {
      parts.push(`关键词匹配(${trace.bm25Score.toFixed(2)})`)
    }
    if (trace.fusionScore > 0) {
      parts.push(`综合分数(${trace.fusionScore.toFixed(4)})`)
    }

    if (parts.length === 0) {
      return trace.reason
    }

    return `因为: ${parts.join(' + ')} — ${trace.contentPreview.slice(0, 40)}`
  }

  /** 导出追踪日志（JSON 格式） */
  export(): string {
    return JSON.stringify(this.traces, null, 2)
  }

  /** 清空追踪日志 */
  clear(): void {
    this.traces = []
    this.currentTrace = null
  }

  /** 获取追踪记录总数 */
  get size(): number {
    return this.traces.length
  }

  /** 更新配置 */
  updateConfig(config: Partial<TraceConfig>): void {
    this.config = { ...this.config, ...config }
  }
}

// ============ 单例 ============

let instance: MemoryTraceManager | null = null

/**
 * 获取记忆追踪管理器单例
 */
export function getMemoryTraceManager(config?: Partial<TraceConfig>): MemoryTraceManager {
  if (!instance) {
    instance = new MemoryTraceManager(config)
  }
  return instance
}

/**
 * 重置追踪管理器（测试用）
 */
export function resetMemoryTraceManager(): void {
  instance = null
}
