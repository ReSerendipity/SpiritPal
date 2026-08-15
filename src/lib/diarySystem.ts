/**
 * 日记系统 — 每日对话自动摘要 → 自传记忆层
 * 参考 super-agent-party 的日记功能
 *
 * @fileoverview
 * 主要模块：
 * - DiaryEntry 接口：日记条目（ID/日期/摘要/对话轮数/话题/情感/关键事件）
 * - DiaryConfig 接口：日记生成配置
 * - DiarySystem 类：日记系统（单例），支持自动生成、回顾编辑、纪念日提醒、存储到自传记忆
 *
 * 核心功能：
 * 1. 每日对话自动摘要 → LLM 生成日记条目
 * 2. 日记存储在自传记忆层（autobiographicalMemory）
 * 3. 日记回顾与编辑
 * 4. 纪念日提醒（基于日记条目中的关键日期）
 *
 * @module diarySystem
 * @requires ./enhancedMemory - 增强记忆管理器
 * @requires ./memoryTypes - EnhancedMemory 类型定义
 */

import { getEnhancedMemoryManager } from './enhancedMemory'

// ============ 类型定义 ============

/** 日记条目 */
export interface DiaryEntry {
  /** 日记 ID */
  id: string
  /** 日记日期（YYYY-MM-DD） */
  date: string
  /** LLM 生成的日记摘要 */
  summary: string
  /** 当日对话轮数 */
  exchangeCount: number
  /** 当日主要话题标签 */
  topics: string[]
  /** 当日情感倾向（-1 到 1，负面到正面） */
  sentimentScore: number
  /** 关键事件（如用户提到的生日、纪念日等） */
  keyEvents: string[]
  /** 创建时间戳 */
  createdAt: number
}

/** 日记生成配置 */
export interface DiaryConfig {
  /** 每日最少对话轮数才生成日记（默认 3） */
  minExchangesPerDay: number
  /** 日记摘要最大长度（默认 300 字） */
  maxSummaryLength: number
  /** 话题标签数量上限（默认 5） */
  maxTopics: number
  /** 是否自动生成日记（默认 true） */
  autoGenerate: boolean
  /** 日记生成时间（小时，默认 23 = 晚上 11 点） */
  generateHour: number
}

/** 默认日记配置 */
export const DEFAULT_DIARY_CONFIG: DiaryConfig = {
  minExchangesPerDay: 3,
  maxSummaryLength: 300,
  maxTopics: 5,
  autoGenerate: true,
  generateHour: 23,
}

// ============ 日记系统管理器 ============

/**
 * 日记系统管理器
 * 管理每日对话的自动摘要和日记条目
 */
export class DiarySystemManager {
  private characterId: string
  private config: DiaryConfig
  /** 日记条目缓存（date → entry） */
  private entries: Map<string, DiaryEntry> = new Map()
  /** 当日对话收集 */
  private todayExchanges: { user: string; assistant: string }[] = []
  /** 初始化 Promise */
  private initPromise: Promise<void>

  constructor(characterId: string, config: Partial<DiaryConfig> = {}) {
    this.characterId = characterId
    this.config = { ...DEFAULT_DIARY_CONFIG, ...config }
    this.initPromise = this.init()
  }

  private async init(): Promise<void> {
    await this.loadEntries()
  }

  /** 等待初始化完成 */
  async ensureLoaded(): Promise<void> {
    await this.initPromise
  }

  // ============ 对话收集 ============

  /**
   * 记录一次对话（用于日记生成）
   * @param user 用户消息
   * @param assistant AI 回复
   */
  recordExchange(user: string, assistant: string): void {
    this.todayExchanges.push({ user, assistant })
  }

  /**
   * 获取当日对话轮数
   */
  getTodayExchangeCount(): number {
    return this.todayExchanges.length
  }

  // ============ 日记生成 ============

  /**
   * 生成当日日记
   * 当对话轮数达到阈值时，自动生成日记摘要
   *
   * @param llmSummarizer LLM 摘要函数（可选，不传则使用简单摘要）
   * @returns 生成的日记条目（null 表示未达到生成条件）
   */
  async generateDiary(
    llmSummarizer?: (exchanges: { user: string; assistant: string }[]) => Promise<string>,
  ): Promise<DiaryEntry | null> {
    // 检查是否达到生成条件
    if (this.todayExchanges.length < this.config.minExchangesPerDay) {
      return null
    }

    const today = this.getDateString()
    const exchanges = [...this.todayExchanges]

    // 生成摘要
    let summary: string
    if (llmSummarizer) {
      try {
        summary = await llmSummarizer(exchanges)
      } catch {
        summary = this.generateSimpleSummary(exchanges)
      }
    } else {
      summary = this.generateSimpleSummary(exchanges)
    }

    // 截断摘要
    if (summary.length > this.config.maxSummaryLength) {
      summary = summary.slice(0, this.config.maxSummaryLength) + '...'
    }

    // 提取话题标签
    const topics = this.extractTopics(exchanges)

    // 计算情感倾向
    const sentimentScore = this.calculateSentiment(exchanges)

    // 提取关键事件
    const keyEvents = this.extractKeyEvents(exchanges)

    const entry: DiaryEntry = {
      id: `diary_${today}_${Math.random().toString(36).slice(2, 8)}`,
      date: today,
      summary,
      exchangeCount: exchanges.length,
      topics,
      sentimentScore,
      keyEvents,
      createdAt: Date.now(),
    }

    // 保存日记
    this.entries.set(today, entry)
    await this.saveEntryToMemory(entry)

    // 清空当日对话收集
    this.todayExchanges = []

    return entry
  }

  // ============ 简单摘要生成（LLM 不可用时的回退）============

  private generateSimpleSummary(exchanges: { user: string; assistant: string }[]): string {
    // 取用户消息的关键片段拼接
    const userMessages = exchanges
      .map((e) => e.user.slice(0, 50))
      .filter((m) => m.length > 0)

    if (userMessages.length <= 3) {
      return `今天聊了${exchanges.length}轮，话题包括：${userMessages.join('、')}`
    }

    // 多轮对话，取首尾+总数
    const first = userMessages[0]
    const last = userMessages[userMessages.length - 1]
    return `今天聊了${exchanges.length}轮，从「${first}」到「${last}」`
  }

  // ============ 话题提取 ============

  private extractTopics(exchanges: { user: string; assistant: string }[]): string[] {
    const allText = exchanges.map((e) => `${e.user} ${e.assistant}`).join(' ')
    const freq: Record<string, number> = {}

    // 简单中文分词（2-4字词组）
    const cjkPattern = /[\u4e00-\u9fff]{2,4}/g
    let match: RegExpExecArray | null
    while ((match = cjkPattern.exec(allText)) !== null) {
      const word = match[0]
      // 过滤停用词
      if (this.isStopWord(word)) continue
      freq[word] = (freq[word] || 0) + 1
    }

    // 拉丁词
    const latinPattern = /[a-zA-Z]{3,}/g
    while ((match = latinPattern.exec(allText)) !== null) {
      const word = match[0].toLowerCase()
      freq[word] = (freq[word] || 0) + 1
    }

    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, this.config.maxTopics)
      .map(([word]) => word)
  }

  /** 简单停用词检查 */
  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      '今天', '昨天', '现在', '这个', '那个', '什么', '怎么',
      '可以', '就是', '然后', '所以', '因为', '但是', '不过',
    ])
    return stopWords.has(word)
  }

  // ============ 情感倾向计算 ============

  private calculateSentiment(exchanges: { user: string; assistant: string }[]): number {
    const positiveWords = ['开心', '喜欢', '幸福', '感动', '温暖', '兴奋', '快乐', '好', '棒', '厉害', 'happy', 'love', 'great', 'good']
    const negativeWords = ['难过', '讨厌', '伤心', '生气', '焦虑', '失望', '烦', '累', '无聊', 'sad', 'hate', 'bad', 'angry']

    let score = 0
    for (const { user, assistant } of exchanges) {
      const text = `${user} ${assistant}`.toLowerCase()
      for (const w of positiveWords) {
        if (text.includes(w)) score += 1
      }
      for (const w of negativeWords) {
        if (text.includes(w)) score -= 1
      }
    }

    // 归一化到 -1 到 1
    return Math.max(-1, Math.min(1, score / Math.max(exchanges.length, 1)))
  }

  // ============ 关键事件提取 ============

  private extractKeyEvents(exchanges: { user: string; assistant: string }[]): string[] {
    const events: string[] = []
    const eventPatterns = [
      /生日/g, /纪念日/g, /结婚/g, /毕业/g, /入职/g, /搬家/g,
      /birthday/gi, /anniversary/gi, /graduation/gi,
    ]

    for (const { user } of exchanges) {
      for (const pattern of eventPatterns) {
        pattern.lastIndex = 0
        if (pattern.test(user)) {
          events.push(user.slice(0, 60))
        }
      }
    }

    return [...new Set(events)].slice(0, 5)
  }

  // ============ 日记持久化 ============

  /** 将日记条目保存到自传记忆层 */
  private async saveEntryToMemory(entry: DiaryEntry): Promise<void> {
    const mgr = getEnhancedMemoryManager(this.characterId)
    await mgr.ensureLoaded()

    // P1-1 修复：将 exchangeCount/sentimentScore/keyEvents 编码到 tags 中，
    // 以便 loadEntries 时能恢复这些字段（之前全部丢失）。
    const tags = [
      ...entry.topics,
      `exchanges:${entry.exchangeCount}`,
      `sentiment:${entry.sentimentScore.toFixed(2)}`,
    ]
    if (entry.keyEvents.length > 0) {
      tags.push(`event:${entry.keyEvents.join('|')}`)
    }

    const content = `[日记 ${entry.date}] ${entry.summary}`
    // 使用 addExchange 但通过直接构造记忆对象来设置 tags
    // addExchange 内部会覆盖 tags，所以我们需要在保存后手动更新
    // D4 修复：原实现用 new Date().toISOString() 与记忆 created_at 全等匹配，
    // 两次取毫秒时间戳几乎必然不相等，导致 tags 恒写不进去；改用返回的对象引用
    const diaryMem = mgr.addExchange(content, '')
    diaryMem.tags = tags

    // 如果有关键事件，额外创建一条高重要度记忆
    if (entry.keyEvents.length > 0) {
      const eventContent = `[关键事件 ${entry.date}] ${entry.keyEvents.join('；')}`
      mgr.addExchange(eventContent, '')
    }
  }

  /** 从自传记忆中加载日记条目 */
  private async loadEntries(): Promise<void> {
    const mgr = getEnhancedMemoryManager(this.characterId)
    await mgr.ensureLoaded()

    // 从自传记忆中识别日记条目
    const memories = mgr.getAutobiographicalMemories()
    for (const mem of memories) {
      if (mem.user.startsWith('[日记 ')) {
        const dateMatch = mem.user.match(/\[日记 (\d{4}-\d{2}-\d{2})\]/)
        if (dateMatch) {
          const date = dateMatch[1]
          if (!this.entries.has(date)) {
            // P1-1 修复：loadEntries 持久化有损——exchangeCount/sentimentScore/keyEvents 全丢。
            // 从 JSON 序列化后的 tags 字段中恢复尽可能多的信息。
            // 日记条目的 tags 格式为 ["exchanges:N", "sentiment:S", "event:E1|E2", ...]
            let exchangeCount = 0
            let sentimentScore = 0
            const keyEvents: string[] = []
            for (const tag of mem.tags) {
              if (tag.startsWith('exchanges:')) {
                exchangeCount = parseInt(tag.split(':')[1] || '0', 10) || 0
              } else if (tag.startsWith('sentiment:')) {
                sentimentScore = parseFloat(tag.split(':')[1] || '0') || 0
              } else if (tag.startsWith('event:')) {
                const evts = tag.substring(6)
                if (evts) keyEvents.push(...evts.split('|'))
              }
            }
            this.entries.set(date, {
              id: mem.id,
              date,
              summary: mem.user.replace(/\[日记 \d{4}-\d{2}-\d{2}\] /, ''),
              exchangeCount,
              topics: mem.tags.filter(t => !t.startsWith('exchanges:') && !t.startsWith('sentiment:') && !t.startsWith('event:')),
              sentimentScore,
              keyEvents,
              createdAt: new Date(mem.created_at).getTime(),
            })
          }
        }
      }
    }
  }

  // ============ 日记查询 ============

  /**
   * 获取指定日期的日记
   * @param date 日期字符串（YYYY-MM-DD）
   */
  getDiary(date: string): DiaryEntry | undefined {
    return this.entries.get(date)
  }

  /**
   * 获取今日日记
   */
  getTodayDiary(): DiaryEntry | undefined {
    return this.entries.get(this.getDateString())
  }

  /**
   * 获取最近 N 天的日记
   * @param days 天数
   */
  getRecentDiaries(days = 7): DiaryEntry[] {
    const result: DiaryEntry[] = []
    const now = new Date()

    for (let i = 0; i < days; i++) {
      const date = new Date(now.getTime() - i * 86400000)
      // P1-1 修复：使用本地时区日期字符串
      const y = date.getFullYear()
      const m = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const dateStr = `${y}-${m}-${day}`
      const entry = this.entries.get(dateStr)
      if (entry) result.push(entry)
    }

    return result
  }

  /**
   * 获取所有日记条目（按日期降序）
   */
  getAllDiaries(): DiaryEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => b.date.localeCompare(a.date))
  }

  /**
   * 搜索日记
   * @param query 搜索关键词
   */
  searchDiaries(query: string): DiaryEntry[] {
    const lower = query.toLowerCase()
    return this.getAllDiaries().filter((entry) =>
      entry.summary.toLowerCase().includes(lower) ||
      entry.topics.some((t) => t.includes(lower)) ||
      entry.keyEvents.some((e) => e.toLowerCase().includes(lower)),
    )
  }

  // ============ 纪念日提醒 ============

  /**
   * 检查是否有纪念日提醒
   * 基于日记中的关键事件日期，在每年同日触发提醒
   * @returns 提醒消息（null 表示无提醒）
   */
  checkAnniversaryReminder(): { message: string; originalDate: string; yearsAgo: number } | null {
    const today = this.getDateString()
    const todayMonthDay = today.slice(5) // MM-DD

    for (const entry of this.entries.values()) {
      if (entry.keyEvents.length === 0) continue

      const entryMonthDay = entry.date.slice(5)
      if (entryMonthDay === todayMonthDay && entry.date !== today) {
        const yearsAgo = parseInt(today.slice(0, 4)) - parseInt(entry.date.slice(0, 4))
        if (yearsAgo > 0) {
          return {
            message: `还记得${entry.date}吗？已经${yearsAgo}年了！`,
            originalDate: entry.date,
            yearsAgo,
          }
        }
      }
    }

    return null
  }

  // ============ 辅助方法 ============

  // P1-1 修复：使用本地时区日期，而非 toISOString()（东八区凌晨会回退到前一天，导致日记日期漂移）
  private getDateString(): string {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  /** 更新配置 */
  updateConfig(config: Partial<DiaryConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /** 获取配置 */
  getConfig(): DiaryConfig {
    return { ...this.config }
  }

  /** 获取日记总数 */
  get size(): number {
    return this.entries.size
  }
}

// ============ 单例缓存 ============

const managers = new Map<string, DiarySystemManager>()

/**
 * 获取日记系统管理器单例
 * @param characterId 角色 ID
 * @param config 可选配置
 */
export function getDiarySystemManager(
  characterId: string,
  config?: Partial<DiaryConfig>,
): DiarySystemManager {
  let mgr = managers.get(characterId)
  if (!mgr) {
    mgr = new DiarySystemManager(characterId, config)
    managers.set(characterId, mgr)
  }
  return mgr
}
