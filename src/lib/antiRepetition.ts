/**
 * 反重复机制 — 防止 AI 回复出现模式化重复
 * 参考 Live2DPet desktop-pet-system.js
 *
 * @fileoverview
 * 主要模块：
 * - StructuralPatterns 接口：结构模式检测结果
 * - SemanticAnalysis 接口：语义分析结果
 * - detectStructuralPatterns()：检测文本结构模式
 * - isStructurallySimilar()：比较两条响应结构相似度
 * - AntiRepetitionManager 类：反重复管理器（单例模式），支持结构检测、语义分析、Prompt 注入
 * - getAntiRepetitionManager()/resetAntiRepetitionManager()：单例管理
 *
 * 核心机制：
 * 1. 结构模式检测：反问句、相同开头词、相似长度、感叹号/省略号重复
 * 2. 语义分析：每 N 次回复调用 LLM 提取话题和习惯模式
 * 3. Prompt 注入：将最近 30 秒的分析结果注入 system prompt
 * 4. 响应池：recentPool 存储最近的响应（20 条，30 秒窗口）
 *
 * @module antiRepetition
 */

// ============ 配置常量 ============

/** 最近响应池大小 */
const RECENT_POOL_SIZE = 20

/** 最近响应时间窗口（毫秒） */
const RECENT_WINDOW_MS = 30_000

/** 每 N 次回复执行一次语义分析 */
const SEMANTIC_ANALYSIS_INTERVAL = 5

/** 长度相似度阈值（超过此值视为重复） */
const LENGTH_SIMILARITY_THRESHOLD = 0.8

/** 最大 Prompt 注入长度 */
const MAX_PROMPT_INJECTION_LENGTH = 500

// ============ 类型定义 ============

/** 单条响应记录 */
interface ResponseRecord {
  text: string
  timestamp: number
}

/** 语义分析结果 */
export interface SemanticAnalysis {
  /** 提取的话题 */
  topics: string[]
  /** 发现的习惯模式（如"总是用问句"） */
  habits: string[]
  /** 分析时间戳 */
  timestamp: number
}

/** 结构模式检测结果 */
export interface StructuralPatterns {
  /** 是否以问号结尾 */
  endsWithQuestion: boolean
  /** 是否以感叹号结尾 */
  endsWithExclamation: boolean
  /** 是否以省略号结尾 */
  endsWithEllipsis: boolean
  /** 开头词 */
  firstWord: string
  /** 文本长度 */
  length: number
}

// ============ 结构模式检测 ============

/**
 * 检测文本的结构模式
 */
export function detectStructuralPatterns(text: string): StructuralPatterns {
  const trimmed = text.trim()
  const words = trimmed.split(/\s+/)
  return {
    endsWithQuestion: trimmed.endsWith('?') || trimmed.endsWith('？'),
    endsWithExclamation: trimmed.endsWith('!') || trimmed.endsWith('！'),
    endsWithEllipsis: trimmed.endsWith('...') || trimmed.endsWith('…'),
    firstWord: words[0] ?? '',
    length: trimmed.length,
  }
}

/**
 * 比较两条响应的结构相似度
 * 返回 true 表示结构上相似（可能重复）
 */
export function isStructurallySimilar(a: string, b: string): boolean {
  const pa = detectStructuralPatterns(a)
  const pb = detectStructuralPatterns(b)

  // 反问句重复
  if (pa.endsWithQuestion && pb.endsWithQuestion) return true

  // 相同开头词（超过 3 个字符）
  if (pa.firstWord && pb.firstWord && pa.firstWord === pb.firstWord && pa.firstWord.length > 3) {
    return true
  }

  // 相似长度（>80%）
  const maxLen = Math.max(pa.length, pb.length)
  if (maxLen > 0) {
    const lengthSimilarity = 1 - Math.abs(pa.length - pb.length) / maxLen
    if (lengthSimilarity > LENGTH_SIMILARITY_THRESHOLD) {
      // 还需要其他特征匹配才算重复
      if (pa.endsWithExclamation === pb.endsWithExclamation) return true
      if (pa.endsWithEllipsis === pb.endsWithEllipsis) return true
    }
  }

  return false
}

// ============ 反重复管理器 ============

export class AntiRepetitionManager {
  /** 最近响应池 */
  private recentPool: ResponseRecord[] = []
  /** 语义分析结果缓存 */
  private semanticCache: SemanticAnalysis[] = []
  /** 回复计数（用于触发语义分析） */
  private replyCount = 0
  /** 语义分析回调（可选，调用 LLM） */
  private onSemanticAnalysis?: (texts: string[]) => Promise<SemanticAnalysis>

  constructor(onSemanticAnalysis?: (texts: string[]) => Promise<SemanticAnalysis>) {
    this.onSemanticAnalysis = onSemanticAnalysis
  }

  // ============ 核心方法 ============

  /**
   * 检查新响应是否与最近响应重复
   * @param newText 新的响应文本
   * @returns true 表示检测到重复，应避免使用
   */
  isDuplicate(newText: string): boolean {
    const now = Date.now()

    // 清理过期记录
    this.recentPool = this.recentPool.filter(
      r => now - r.timestamp < RECENT_WINDOW_MS,
    )

    // 与最近响应比较
    for (const record of this.recentPool) {
      if (isStructurallySimilar(newText, record.text)) {
        return true
      }
    }

    return false
  }

  /**
   * 记录一条新响应
   * @param text 响应文本
   */
  recordResponse(text: string): void {
    this.recentPool.push({
      text,
      timestamp: Date.now(),
    })

    // 限制池大小
    if (this.recentPool.length > RECENT_POOL_SIZE) {
      this.recentPool.shift()
    }

    // 计数并可能触发语义分析
    this.replyCount++
    if (
      this.replyCount % SEMANTIC_ANALYSIS_INTERVAL === 0 &&
      this.onSemanticAnalysis &&
      this.recentPool.length >= 3
    ) {
      this.runSemanticAnalysis()
    }
  }

  /**
   * 执行语义分析（异步，非阻塞）
   */
  private async runSemanticAnalysis(): Promise<void> {
    if (!this.onSemanticAnalysis) return

    const recentTexts = this.recentPool
      .slice(-SEMANTIC_ANALYSIS_INTERVAL)
      .map(r => r.text)

    try {
      const analysis = await this.onSemanticAnalysis(recentTexts)
      this.semanticCache.push(analysis)

      // 限制缓存大小
      if (this.semanticCache.length > 5) {
        this.semanticCache.shift()
      }
    } catch {
      // 语义分析失败不影响正常使用
    }
  }

  // ============ Prompt 注入 ============

  /**
   * 生成反重复上下文，注入到 system prompt
   * 返回最近 30 秒的分析结果摘要
   */
  getAntiRepetitionContext(): string {
    const now = Date.now()
    const parts: string[] = []

    // 最近响应的开头词（避免重复开头）
    const recentFirstWords = this.recentPool
      .filter(r => now - r.timestamp < RECENT_WINDOW_MS)
      .map(r => detectStructuralPatterns(r.text).firstWord)
      .filter(w => w.length > 0)

    if (recentFirstWords.length > 0) {
      const uniqueWords = [...new Set(recentFirstWords)]
      parts.push(`避免使用这些开头词: ${uniqueWords.join(', ')}`)
    }

    // 语义分析的习惯模式
    const recentAnalyses = this.semanticCache.filter(
      a => now - a.timestamp < RECENT_WINDOW_MS * 2,
    )
    for (const analysis of recentAnalyses) {
      if (analysis.habits.length > 0) {
        parts.push(`避免重复模式: ${analysis.habits.join('; ')}`)
      }
      if (analysis.topics.length > 0) {
        parts.push(`最近话题: ${analysis.topics.join(', ')}（避免重复）`)
      }
    }

    // 限制总长度
    const context = parts.join('\n')
    return context.length > MAX_PROMPT_INJECTION_LENGTH
      ? context.slice(0, MAX_PROMPT_INJECTION_LENGTH) + '...'
      : context
  }

  /**
   * 生成完整的反重复指令（注入到 system prompt）
   */
  getAntiRepetitionInstruction(): string {
    const context = this.getAntiRepetitionContext()
    if (!context) return ''

    return [
      '[Anti-Repetition Rules]',
      '避免以下重复模式:',
      context,
      '换一种方式表达，使用不同的句式和开头。',
    ].join('\n')
  }

  // ============ 查询 ============

  /** 获取最近响应池（只读） */
  getRecentPool(): ReadonlyArray<ResponseRecord> {
    return this.recentPool
  }

  /** 获取语义分析缓存 */
  getSemanticCache(): ReadonlyArray<SemanticAnalysis> {
    return this.semanticCache
  }

  /** 重置所有状态 */
  reset(): void {
    this.recentPool = []
    this.semanticCache = []
    this.replyCount = 0
  }
}

// ============ 单例 ============

let instance: AntiRepetitionManager | null = null

export function getAntiRepetitionManager(
  onSemanticAnalysis?: (texts: string[]) => Promise<SemanticAnalysis>,
): AntiRepetitionManager {
  if (!instance) {
    instance = new AntiRepetitionManager(onSemanticAnalysis)
  }
  return instance
}

export function resetAntiRepetitionManager(): void {
  instance = null
}
