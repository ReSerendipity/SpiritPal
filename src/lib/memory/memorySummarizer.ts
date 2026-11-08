/**
 * @file memorySummarizer.ts
 * @description 记忆压缩与摘要生成模块
 *
 * 实现功能：
 * - 基于 LLM 的自动记忆摘要生成
 * - 多粒度摘要（句子级/段落级/全文）
 * - 时间线摘要（按日/周/月聚合）
 * - 主题提取和关键词聚类
 * - 增量更新机制（新记忆加入时动态调整摘要）
 *
 * 参考：Live2DPet memory_summarizer.py / OpenPets packages/memory/summarization/
 *
 * TD-004 实现状态（2026-11-08）：
 * - **已接真实 LLM**：`callLLM()` 走 `LLMClient.chat()`，只有「未配置凭据 / 调用失败」才降级到启发式，
 *   并在返回值的 `source` 字段如实标出 `llm` / `heuristic` / `fallback` —— 不再有 500ms 假延迟。
 * - **置信度不再硬编码 0.85**：由 `computeConfidence()` 按「来源 + 覆盖度 + 摘要密度」算出，
 *   三档上限分别为 0.95 / 0.65 / 0.55，调用方一眼能分辨这是真 LLM 结果还是启发式结果。
 * - **增量更新是真的增量**：`incrementallyUpdateSummary()` 以记忆 id 集合判断"是否有新内容"，
 *   没有新 id 时零 LLM 调用直接返回旧摘要；有新内容时把旧摘要文本作为上下文喂给 LLM，
 *   避免旧实现只摘要新记忆、把历史内容整段丢掉。
 * - 未做：按 `maxTokens` 真正截断（依赖各 provider 的 tokenizer，跨 provider 无统一口径）。
 */

import { getLLMClient } from '@/lib/ai/llmClient'
import { getPrompt } from '@/lib/ai/promptRegistry'
import type { AIConfig, MemoryEntry } from '@/lib/data/types'

// ============ 类型定义 ============

export interface SummaryConfig {
  /** 摘要风格 */
  style: 'concise' | 'detailed' | 'narrative'
  /** 最大 Token 数 */
  maxTokens: number
  /** 是否包含情感分析 */
  includeSentiment: boolean
  /** 是否提取关键事件 */
  extractEvents: boolean
}

export interface MemorySummary {
  /** 摘要文本 */
  text: string
  /** 摘要长度（字符数） */
  length: number
  /** 生成的时间戳 */
  generatedAt: number
  /** 使用的记忆条目数量 */
  memoryCount: number
  /** 时间范围 */
  timeRange?: {
    start: number
    end: number
  }
  /** 提取的关键事件 */
  events?: Array<{
    timestamp: number
    description: string
    significance: number // 0-1
  }>
  /** 主要话题标签 */
  topics?: string[]
  /** 整体情感倾向 */
  sentiment?: 'positive' | 'neutral' | 'negative'
  /** 置信度（由来源、覆盖度、密度算出，不再是常量 0.85） */
  confidence: number
  /** 摘要来源：llm=真实模型，heuristic=无凭据时的启发式，fallback=调用失败后的兜底 */
  source?: SummarySource
  /** 参与摘要的记忆 id 集合（增量更新据此判断有没有新内容） */
  memoryIds?: string[]
}

/** 摘要来源 */
export type SummarySource = 'llm' | 'heuristic' | 'fallback'

/** 可摘要的记忆最小形状（带 id 才能做增量） */
export interface SummarizableMemory {
  id?: string
  created_at: string
  user: string
  assistant: string
}

/** 摘要生成所需的最小 LLM 能力（便于测试注入） */
export interface SummaryLLM {
  chat(messages: Array<{ role: string; content: string }>): Promise<string>
  getConfig(): AIConfig
}

/** 可注入的依赖（测试用） */
export interface SummarizerDeps {
  /** 传入 null 表示强制走启发式 */
  llm?: SummaryLLM | null
}

export interface TimelineSummary {
  /** 时间段标识 */
  period: string // e.g., "2026-01", "2026-01-W3", "2026-01-15"
  /** 该时间段摘要 */
  summary: MemorySummary
  /** 记忆条数 */
  count: number
}

// ============ 默认配置 ============

const DEFAULT_SUMMARY_CONFIG: SummaryConfig = {
  style: 'concise',
  maxTokens: 500,
  includeSentiment: true,
  extractEvents: true,
}

/** 摘要过期时间（7 天） */
const SUMMARY_TTL_MS = 7 * 24 * 60 * 60 * 1000

// ============ 记忆摘要生成器 ============

export class MemorySummarizer {
  private summaries: Map<string, MemorySummary> = new Map()
  private config: SummaryConfig
  private lastSummarizationTime: number = 0
  /** 注入的 LLM；undefined 表示"按需取全局单例" */
  private injectedLlm: SummaryLLM | null | undefined

  constructor(config?: Partial<SummaryConfig>, deps?: SummarizerDeps) {
    this.config = { ...DEFAULT_SUMMARY_CONFIG, ...(config || {}) }
    this.injectedLlm = deps && 'llm' in deps ? deps.llm : undefined
  }

  /**
   * 为指定记忆生成摘要
   *
   * 顺序：缓存 → 真实 LLM（已配置时）→ 启发式（无凭据）→ 兜底（调用失败）。
   * 返回值里的 `source` 与 `confidence` 都跟着实际走的那条路走，不写死。
   */
  async summarize(
    memories: SummarizableMemory[],
    context?: string,
  ): Promise<MemorySummary> {
    if (memories.length === 0) {
      return this.createEmptySummary()
    }

    const cacheKey = this.generateCacheKey(memories)

    // 检查缓存
    const cached = this.summaries.get(cacheKey)
    if (cached && !this.isExpired(cached)) {
      return cached
    }

    try {
      // 构建提示词
      const prompt = this.buildSummarizationPrompt(memories, context)

      // 调用 LLM（已配置）或启发式（未配置）；两条路都不再假装延迟
      const { text, source } = await this.callLLM(prompt, memories)

      // 解析结果
      const summary: MemorySummary = {
        text,
        length: text.length,
        generatedAt: Date.now(),
        memoryCount: memories.length,
        timeRange: {
          start: Math.min(...memories.map((m) => new Date(m.created_at).getTime())),
          end: Math.max(...memories.map((m) => new Date(m.created_at).getTime())),
        },
        confidence: computeConfidence(memories, text, source),
        source,
        memoryIds: collectMemoryIds(memories),
      }

      // 提取额外信息
      if (this.config.extractEvents) {
        summary.events = this.extractEvents(memories)
      }

      if (this.config.includeSentiment) {
        summary.sentiment = this.analyzeSentiment(memories)
        summary.topics = this.extractTopics(memories)
      }

      // 缓存结果
      this.summaries.set(cacheKey, summary)
      this.lastSummarizationTime = Date.now()

      return summary
    } catch (error) {
      console.error('[MemorySummarizer] Summarization failed:', error)

      // 降级方案：使用简单汇总
      return this.createFallbackSummary(memories)
    }
  }

  /**
   * 生成时间线摘要（按时间段聚合）
   */
  async generateTimelineSummary(
    memories: Array<{ created_at: string; user: string; assistant: string }>,
    granularity: 'day' | 'week' | 'month',
  ): Promise<TimelineSummary[]> {
    // 按时间段分组
    const grouped = this.groupByTimePeriod(memories, granularity)

    const timelines: TimelineSummary[] = []

    for (const [period, periodMemories] of grouped.entries()) {
      const summary = await this.summarize(periodMemories)

      timelines.push({
        period,
        summary,
        count: periodMemories.length,
      })
    }

    // 按时间倒序排序
    timelines.sort((a, b) => b.period.localeCompare(a.period))

    return timelines
  }

  /**
   * 增量更新摘要
   *
   * 旧实现是"只把新记忆重新摘要一遍"——历史内容被整段丢掉，却仍标着新的 generatedAt，
   * 属于静默丢数据。现在按记忆 id 集合判断：
   * ① 新记忆 id 全部已知 → 零 LLM 调用、原样返回旧摘要（这才是增量的意义）；
   * ② 有新 id → 把旧摘要文本作为上下文交给 LLM 续写（我们并不掌握旧记忆原文，
   *    但旧摘要就是它当时的凝练，用它续写既省钱又不丢历史）；
   * ③ 记忆没有 id（旧数据或调用方没传）→ 退化为「新条目为 0 才跳过」的保守判断。
   */
  async incrementallyUpdateSummary(
    existingSummary: MemorySummary,
    newMemories: MemoryEntry[],
  ): Promise<MemorySummary> {
    const known = new Set(existingSummary.memoryIds ?? [])
    const incoming = newMemories as SummarizableMemory[]
    const newIds = collectMemoryIds(incoming).filter((id) => !known.has(id))
    const hasIds = known.size > 0

    const noNewContent = hasIds ? newIds.length === 0 : incoming.length === 0
    if (noNewContent) {
      return existingSummary
    }

    const prompt = this.buildSummarizationPrompt(
      incoming,
      this.buildPriorSummaryContext(existingSummary),
    )
    const { text, source } = await this.callLLM(prompt, incoming)

    const mergedIds = Array.from(new Set([...known, ...collectMemoryIds(incoming)]))
    const times = incoming
      .map((m) => Date.parse(m.created_at))
      .filter((t) => !Number.isNaN(t))
    const prevRange = existingSummary.timeRange
    const timeRange =
      times.length > 0 && prevRange
        ? { start: Math.min(...times, prevRange.start), end: Math.max(...times, prevRange.end) }
        : times.length > 0
          ? { start: Math.min(...times), end: Math.max(...times) }
          : prevRange

    return {
      // 历史摘要 + 本轮增量，显式拼接而不是覆盖
      text: `${existingSummary.text}\n\n【本轮新增】\n${text}`,
      length: existingSummary.length + text.length,
      generatedAt: Date.now(),
      memoryCount: existingSummary.memoryCount + (hasIds ? newIds.length : incoming.length),
      timeRange,
      confidence: computeConfidence(incoming, text, source),
      source,
      memoryIds: mergedIds,
      events: existingSummary.events,
      topics: existingSummary.topics,
      sentiment: existingSummary.sentiment,
    }
  }

  /** 把旧摘要转成提示词上下文（增量续写用） */
  private buildPriorSummaryContext(existingSummary: MemorySummary): string {
    return `已有摘要（覆盖此前 ${existingSummary.memoryCount} 条记忆，请在此基础上续写、不要重复旧内容）：\n${existingSummary.text}`
  }

  /**
   * 构建摘要提示词
   */
  private buildSummarizationPrompt(
    memories: SummarizableMemory[],
    context?: string,
  ): string {
    const systemPrompt = getPrompt('memory.summarize')
      .replace('{max_tokens}', String(this.config.maxTokens))
      .replace(
        '{style}',
        this.config.style === 'narrative' ? '叙述式' : this.config.style === 'detailed' ? '详细列举' : '精简概括',
      )

    const userContent = memories
      .slice(-20)
      .map((m, _idx) => {
        const date = new Date(m.created_at).toLocaleString('zh-CN')
        return `[${date}] 主人：${m.user}\n[${date}] 宠物：${m.assistant}`
      })
      .join('\n')

    let fullPrompt = `${systemPrompt}\n\n对话记录：\n${userContent}`

    if (context) {
      fullPrompt += `\n\n补充背景：${context}`
    }

    return fullPrompt
  }

  /**
   * 调用 LLM 生成摘要；未配置凭据时走启发式
   *
   * 判断依据只有一条：**有没有真的能发请求的配置**。`ondevice`（本地模型）视为可用；
   * 其他 provider 必须带 apiKey。没有就不要再发请求、也不要假装延迟 500ms。
   */
  private async callLLM(
    prompt: string,
    memories: SummarizableMemory[],
  ): Promise<{ text: string; source: SummarySource }> {
    const llm = this.resolveLLM()
    if (!llm || !isLlmAvailable(llm.getConfig())) {
      return { text: this.simpleHeuristicSummary(memories), source: 'heuristic' }
    }

    const text = await llm.chat([{ role: 'user', content: prompt }])
    const trimmed = text.trim()
    if (!trimmed) {
      // 模型返回空字符串不算成功：当成调用失败往上走降级，否则会缓存一条空摘要
      throw new Error('LLM returned empty summary')
    }
    return { text: trimmed, source: 'llm' }
  }

  /** 解析要用的 LLM：注入值优先（含 null=强制启发式） */
  private resolveLLM(): SummaryLLM | null {
    if (this.injectedLlm !== undefined) return this.injectedLlm
    return getLLMClient() as unknown as SummaryLLM
  }

  /**
   * 启发式摘要（降级方案）
   *
   * 入参从"整段 prompt"改成"记忆数组"：原来靠 `split('：')` 从提示词里再捞文本，
   * 提示词一改版（多行、含背景）就会把背景说明也当记忆摘要进去。
   */
  private simpleHeuristicSummary(memories: SummarizableMemory[]): string {
    const items = memories
      .slice(-10)
      .map((m) => m.user.trim())
      .filter((t) => t.length > 0)
      .map((t) => `- ${t.substring(0, 30)}`)

    if (items.length === 0) {
      return '暂无有效记忆内容'
    }
    return `在最近的一段对话中，主要讨论了以下内容：\n${items.join('\n')}`
  }

  /**
   * 提取关键事件
   */
  private extractEvents(memories: Array<{ created_at: string; user: string; assistant: string }>): Array<{
    timestamp: number
    description: string
    significance: number
  }> {
    const events: Array<{
      timestamp: number
      description: string
      significance: number
    }> = []

    // 查找可能的事件模式
    const eventPatterns = [
      { pattern: /(恭喜 | 达成 | 解锁)/i, type: 'achievement' },
      { pattern: /(错误 | 失败 | 糟糕)/i, type: 'problem' },
      { pattern: /(完成做 | 搞定 | 搞定)/i, type: 'completion' },
      { pattern: /(开始启动)/i, type: 'start' },
    ]

    memories.forEach((m) => {
      const text = (m.user + m.assistant).toLowerCase()
      for (const { pattern, type } of eventPatterns) {
        const match = text.match(pattern)
        if (match) {
          events.push({
            timestamp: new Date(m.created_at).getTime(),
            description: `${type === 'achievement' ? '成就' : type === 'problem' ? '问题' : '事件'}：${text.substring(0, 50)}`,
            significance: 0.7,
          })
        }
      }
    })

    // 按时间排序并去重
    return events.sort((a, b) => b.timestamp - a.timestamp).slice(0, 5)
  }

  /**
   * 情感分析
   */
  private analyzeSentiment(
    memories: Array<{ created_at: string; user: string; assistant: string }>,
  ): 'positive' | 'neutral' | 'negative' {
    let positiveScore = 0
    let negativeScore = 0

    const positiveWords = ['开心', '高兴', '棒', '好', '喜欢', '爱', '赞', '耶']
    const negativeWords = ['难过', '生气', '烦', '累', '讨厌', '恨', '糟', '唉']

    memories.forEach((m) => {
      const text = (m.user + m.assistant).toLowerCase()
      positiveWords.forEach((word) => {
        if (text.includes(word)) positiveScore++
      })
      negativeWords.forEach((word) => {
        if (text.includes(word)) negativeScore++
      })
    })

    if (positiveScore > negativeScore + 2) return 'positive'
    if (negativeScore > positiveScore + 2) return 'negative'
    return 'neutral'
  }

  /**
   * 提取话题
   */
  private extractTopics(memories: Array<{ created_at: string; user: string; assistant: string }>): string[] {
    const topicCounts = new Map<string, number>()

    // 预定义话题关键词
    const topics: Record<string, string[]> = {
      编程: ['代码', 'bug', '程序', '开发', '写代码', 'commit', 'git'],
      学习: ['学习', '看书', '上课', '考试', '作业', '论文'],
      游戏: ['游戏', '玩', '通关', '升级', 'boss'],
      工作: ['工作', '开会', '项目', '任务', '报告'],
      生活: ['吃饭', '睡觉', '出门', '购物', '逛街'],
    }

    memories.forEach((m) => {
      const text = (m.user + m.assistant).toLowerCase()
      Object.entries(topics).forEach(([topic, keywords]) => {
        if (keywords.some((k) => text.includes(k))) {
          topicCounts.set(topic, (topicCounts.get(topic) || 0) + 1)
        }
      })
    })

    // 返回出现次数最多的前 5 个话题
    return Array.from(topicCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic)
  }

  /**
   * 按时间段分组
   */
  private groupByTimePeriod(
    memories: Array<{ created_at: string; user: string; assistant: string }>,
    granularity: 'day' | 'week' | 'month',
  ): Map<string, Array<{ created_at: string; user: string; assistant: string }>> {
    const groups = new Map<string, Array<{ created_at: string; user: string; assistant: string }>>()

    memories.forEach((m) => {
      // 时间戳缺失或非法时跳过：Invalid Date 调 toISOString() 会抛 RangeError
      const timestamp = Date.parse(m.created_at)
      if (Number.isNaN(timestamp)) return

      const date = new Date(timestamp)
      let period: string

      switch (granularity) {
        case 'day':
          period = date.toISOString().split('T')[0] // YYYY-MM-DD
          break
        case 'week': {
          const weekNum = Math.ceil(date.getDate() / 7)
          period = `${date.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`
          break
        }
        case 'month':
          period = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`
          break
      }

      if (!groups.has(period)) {
        groups.set(period, [])
      }
      groups.get(period)!.push(m)
    })

    return groups
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(memories: SummarizableMemory[]): string {
    // 用 id（有的话）或时间戳+文本长度，排序后拼接，避免同批不同序产生不同键
    const ids = memories
      .map((m) => m.id ?? `${m.created_at}#${m.user.length}:${m.assistant.length}`)
      .sort()
      .join('|')
    return `summary_${memories.length}_${ids}`
  }

  /**
   * 检查摘要是否过期
   */
  private isExpired(summary: MemorySummary): boolean {
    return Date.now() - summary.generatedAt > SUMMARY_TTL_MS
  }

  /**
   * 创建空摘要
   */
  private createEmptySummary(): MemorySummary {
    return {
      text: '暂无记忆内容',
      length: 5,
      generatedAt: Date.now(),
      memoryCount: 0,
      // 没有内容要摘要，这条路本身是确定的，所以置信度 1.0
      confidence: 1.0,
      source: 'heuristic',
      memoryIds: [],
    }
  }

  /**
   * 创建降级摘要（LLM 抛错后的兜底）
   */
  private createFallbackSummary(memories: SummarizableMemory[]): MemorySummary {
    const recent = memories.slice(-5)
    const texts = recent.map((m) => m.user + m.assistant).join(' ')
    const text = texts.substring(0, 200) + (texts.length > 200 ? '...' : '')

    return {
      text,
      length: texts.length,
      generatedAt: Date.now(),
      memoryCount: memories.length,
      confidence: computeConfidence(memories, text, 'fallback'),
      source: 'fallback',
      memoryIds: collectMemoryIds(memories),
    }
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.summaries.clear()
  }
}

// ============ 模块级辅助 ============

/** 收集记忆 id（无 id 的不参与，去重） */
export function collectMemoryIds(memories: SummarizableMemory[]): string[] {
  const ids = memories.map((m) => m.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
  return Array.from(new Set(ids))
}

/** LLM 是否可用：ondevice（本地模型）无需凭据，其余 provider 必须有 apiKey */
export function isLlmAvailable(config: AIConfig | undefined | null): boolean {
  if (!config) return false
  if (config.provider === 'ondevice') return true
  return typeof config.apiKey === 'string' && config.apiKey.trim().length > 0
}

/**
 * 置信度计算（替代硬编码 0.85）
 *
 * 三个分量：来源可信度（llm > heuristic > fallback）、覆盖度（记忆条数 / 5）、
 * 摘要密度（相对"每条记忆 40 字"的达成比例）。三档上限分别 0.95 / 0.65 / 0.55，
 * 保证调用方光看数值就知道该不该信这一条摘要。
 */
export function computeConfidence(
  memories: SummarizableMemory[],
  summaryText: string,
  source: SummarySource,
): number {
  const coverage = Math.min(1, memories.length / 5)
  const expectedLength = Math.max(1, memories.length * 40)
  const density = Math.min(1, summaryText.trim().length / expectedLength)

  const base = source === 'llm' ? 0.6 : source === 'heuristic' ? 0.35 : 0.25
  const bonus = source === 'llm' ? 0.35 : source === 'heuristic' ? 0.3 : 0.3
  const cap = source === 'llm' ? 0.95 : source === 'heuristic' ? 0.65 : 0.55

  const raw = base + bonus * (0.6 * coverage + 0.4 * density)
  return Math.min(cap, Math.round(raw * 100) / 100)
}

// ============ 单例 ============

let instance: MemorySummarizer | null = null

export function getMemorySummarizer(
  config?: Partial<SummaryConfig>,
  deps?: SummarizerDeps,
): MemorySummarizer {
  if (!instance) {
    instance = new MemorySummarizer(config, deps)
  }
  return instance
}

export function resetMemorySummarizer(): void {
  if (instance) {
    instance.clearCache()
    instance = null
  }
}
