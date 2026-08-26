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
 */

import { invoke } from '@tauri-apps/api/core'
import type { MemoryEntry } from './types'

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
  /** 置信度 */
  confidence: number
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
  
  constructor(config?: Partial<SummaryConfig>) {
    this.config = { ...DEFAULT_SUMMARY_CONFIG, ...(config || {}) }
  }

  /**
   * 为指定记忆生成摘要
   */
  async summarize(
    memories: Array<{ created_at: string; user: string; assistant: string }>,
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

      // 调用 LLM 生成摘要
      const summaryText = await this.callLLM(prompt)

      // 解析结果
      const summary: MemorySummary = {
        text: summaryText,
        length: summaryText.length,
        generatedAt: Date.now(),
        memoryCount: memories.length,
        timeRange: {
          start: Math.min(...memories.map(m => new Date(m.created_at).getTime())),
          end: Math.max(...memories.map(m => new Date(m.created_at).getTime())),
        },
        confidence: 0.85, // TODO: 从 LLM 响应中提取置信度
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
   * 当新记忆加入时，只重新计算受影响的部分
   */
  async incrementallyUpdateSummary(
    existingSummary: MemorySummary,
    newMemories: MemoryEntry[],
  ): Promise<MemorySummary> {
    // 简单的实现：合并后重新生成
    // TODO: 优化为真正的增量算法
    const allMemories: MemoryEntry[] = [
      // 这里需要从现有摘要反推原始记忆（实际应存储原始记忆 ID）
      ...newMemories,
    ]
    
    return this.summarize(allMemories)
  }

  /**
   * 构建摘要提示词
   */
  private buildSummarizationPrompt(
    memories: Array<{ created_at: string; user: string; assistant: string }>,
    context?: string,
  ): string {
    const systemPrompt = `你是一个专业的记忆总结助手。请根据以下对话记录生成简洁、全面的摘要。

要求：
1. 抓住核心主题和关键对话
2. 突出重要事件和情感变化
3. 保持客观中立，不添加个人判断
4. 输出字数控制在${this.config.maxTokens} token 以内
5. 使用${this.config.style === 'narrative' ? '叙述式' : this.config.style === 'detailed' ? '详细列举' : '精简概括'}风格`

    const userContent = memories.slice(-20).map((m, idx) => {
      const date = new Date(m.created_at).toLocaleString('zh-CN')
      return `[${date}] 主人：${m.user}\n[${date}] 宠物：${m.assistant}`
    }).join('\n')

    let fullPrompt = `${systemPrompt}\n\n对话记录：\n${userContent}`
    
    if (context) {
      fullPrompt += `\n\n补充背景：${context}`
    }
    
    return fullPrompt
  }

  /**
   * 调用 LLM 生成摘要
   */
  private async callLLM(prompt: string): Promise<string> {
    // TODO: 集成实际的 LLM 调用
    // 这里使用简化实现
    
    // 模拟 LLM 延迟
    await new Promise(resolve => setTimeout(resolve, 500))
    
    // 简单的启发式摘要（实际应调用 Vision/Text LLM）
    return this.simpleHeuristicSummary(prompt)
  }

  /**
   * 简单启发式摘要（降级方案）
   */
  private simpleHeuristicSummary(prompt: string): string {
    const lines = prompt.split('\n').filter(l => l.includes('：'))
    
    if (lines.length === 0) {
      return '暂无有效记忆内容'
    }
    
    // 提取每句话的关键词
    const keywords = lines
      .slice(0, 10)
      .map(l => l.split('：')[1]?.substring(0, 30).trim())
      .filter(Boolean)
    
    return `在最近的一段对话中，主要讨论了以下内容：\n${keywords.map(k => `- ${k}`).join('\n')}`
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
    
    memories.forEach(m => {
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
    return events
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5)
  }

  /**
   * 情感分析
   */
  private analyzeSentiment(memories: Array<{ created_at: string; user: string; assistant: string }>): 'positive' | 'neutral' | 'negative' {
    let positiveScore = 0
    let negativeScore = 0
    
    const positiveWords = ['开心', '高兴', '棒', '好', '喜欢', '爱', '赞', '耶']
    const negativeWords = ['难过', '生气', '烦', '累', '讨厌', '恨', '糟', '唉']
    
    memories.forEach(m => {
      const text = (m.user + m.assistant).toLowerCase()
      positiveWords.forEach(word => {
        if (text.includes(word)) positiveScore++
      })
      negativeWords.forEach(word => {
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
      '编程': ['代码', 'bug', '程序', '开发', '写代码', 'commit', 'git'],
      '学习': ['学习', '看书', '上课', '考试', '作业', '论文'],
      '游戏': ['游戏', '玩', '通关', '升级', 'boss'],
      '工作': ['工作', '开会', '项目', '任务', '报告'],
      '生活': ['吃饭', '睡觉', '出门', '购物', '逛街'],
    }
    
    memories.forEach(m => {
      const text = (m.user + m.assistant).toLowerCase()
      Object.entries(topics).forEach(([topic, keywords]) => {
        if (keywords.some(k => text.includes(k))) {
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
    memories: Array<{ created_at: string }>,
    granularity: 'day' | 'week' | 'month',
  ): Map<string, Array<{ created_at: string; user: string; assistant: string }>> {
    const groups = new Map<string, Array<{ created_at: string; user: string; assistant: string }>>()
    
    memories.forEach(m => {
      const date = new Date(m.created_at)
      let period: string
      
      switch (granularity) {
        case 'day':
          period = date.toISOString().split('T')[0] // YYYY-MM-DD
          break
        case 'week':
          const weekNum = Math.ceil(date.getDate() / 7)
          period = `${date.getFullYear()}-W${weekNum.toString().padStart(2, '0')}`
          break
        case 'month':
          period = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`
          break
      }
      
      if (!groups.has(period)) {
        groups.set(period, [])
      }
      groups.get(period)!.push(m as any)
    })
    
    return groups
  }

  /**
   * 生成缓存键
   */
  private generateCacheKey(memories: MemoryEntry[]): string {
    // 使用记忆的 ID 和内容哈希作为缓存键
    const ids = memories.map(m => m.created_at + m.user.length).sort().join('|')
    return `summary_${ids}`
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
      confidence: 1.0,
    }
  }

  /**
   * 创建降级摘要
   */
  private createFallbackSummary(memories: Array<{ created_at: string; user: string; assistant: string }>): MemorySummary {
    const recent = memories.slice(-5)
    const texts = recent.map(m => m.user + m.assistant).join(' ')
    
    return {
      text: texts.substring(0, 200) + (texts.length > 200 ? '...' : ''),
      length: texts.length,
      generatedAt: Date.now(),
      memoryCount: memories.length,
      confidence: 0.5,
    }
  }

  /**
   * 清除所有缓存
   */
  clearCache(): void {
    this.summaries.clear()
  }
}

// ============ 单例 ============

let instance: MemorySummarizer | null = null

export function getMemorySummarizer(config?: Partial<SummaryConfig>): MemorySummarizer {
  if (!instance) {
    instance = new MemorySummarizer(config)
  }
  return instance
}

export function resetMemorySummarizer(): void {
  if (instance) {
    instance.clearCache()
    instance = null
  }
}
