/**
 * @file dailyJournal.ts
 * @note 本模块依赖 Node 内置模块（fs/process），仅可在 Node 运行时（CLI / Rust 桥接）使用，
 *       无法在 Tauri webview 直接 import。设置页「日记」Tab 采用 webview 安全实现（components/JournalPanel.tsx）。
 * @description 日记系统 — 每日自动摘要生成
 *
 * 实现功能：
 * - 自动收集当日对话与活动记录
 * - LLM 驱动的摘要生成（时间线/主题提炼）
 * - 用户编辑与补充（手动添加备注）
 * - 分类标签系统（工作/学习/娱乐/生活）
 * - 日历视图与搜索
 * - 导出功能（Markdown/PDF）
 * - 隐私保护（本地加密存储选项）
 *
 * 参考：Obsidian Daily Notes / Notion Journal / Day One App
 */

import { existsSync } from 'fs'
import { writeFile, readFile, mkdir, readdir } from 'fs/promises'
import { join } from 'path'
import { moodScoreFromTexts } from '@/lib/ai/emotionEngine'

// ============ 类型定义 ============

export interface JournalEntry {
  /** 日期（ISO 格式） */
  date: string // YYYY-MM-DD
  /** 标题 */
  title: string
  /** 主要内容 */
  content: string
  /** AI 生成的摘要 */
  summary?: string
  /** 关键词标签 */
  tags: string[]
  /** 情绪评分（-1~1） */
  moodScore?: number
  /** 主要活动分类 */
  categories: string[]
  /** 重要事件列表 */
  highlights: Array<{
    time: string
    title: string
    description: string
    sentiment?: 'positive' | 'neutral' | 'negative'
  }>
  /** 用户笔记 */
  userNotes?: string
  /** 关联的记忆 ID */
  relatedMemoryIds?: string[]
  /** 附件路径 */
  attachments?: string[]
  /** 创建时间戳 */
  createdAt: number
  /** 更新时间戳 */
  updatedAt: number
  /** 是否已同步（如果有云同步） */
  synced: boolean
}

/** 日报正文/摘要所用的今日记忆片段（只取实际读到的三个字段） */
type JournalMemory = { id?: string; content: string; created_at: string }

/** 日报正文所用的今日活动片段 */
type JournalActivity = { app: string; duration: number | string }

/** 摘要生成所需的最小 LLM 能力（便于测试注入，与 memorySummarizer 的写法一致） */
export interface JournalLLM {
  chat(messages: Array<{ role: string; content: string }>): Promise<string>
}

/**
 * 日报的数据来源与副作用注入点。
 *
 * 为什么需要注入：`fetchTodaysMemories` / `fetchTodaysActivities` 原来都是
 * `return []` 的空实现，于是「生成今日草稿」永远产出一篇空日记——而且看不出是空的。
 * 现在这两条改成**可注入的数据源**，并如实把「读到了什么 / 为什么没读到」写进
 * :meth:`getLastDraftReport`，不再让「没有数据」和「没有实现」长得一样。
 */
export interface DailyJournalDeps {
  /** 取某角色某天的记忆；不注入时默认走 EnhancedMemoryManager（需显式 characterId） */
  loadMemories?: (characterId: string, dateKey: string) => Promise<JournalMemory[]>
  /** 取某天的窗口活动记录；仓内暂无可注入数据源，不注入时如实报告「无来源」 */
  loadActivities?: (dateKey: string) => Promise<JournalActivity[]>
  /**
   * LLM 入口。`undefined` = 未注入（摘要走如实标注的启发式）；
   * `null` = 明确不可用；对象 = 真调用。
   */
  llm?: JournalLLM | null
  /** 时钟注入（本地日期边界、`createdAt` 都走它，否则跨日只能靠改系统时间测） */
  now?: () => Date
}

/** 一次草稿的数据来源与降级情况（如实暴露，不假装成功） */
export interface JournalDraftReport {
  dateKey: string
  memoryCount: number
  activityCount: number
  /** 记忆来源：injected=注入钩子，manager=仓内记忆层，unavailable=没有角色/没有层 */
  memorySource: 'injected' | 'manager' | 'unavailable'
  /** 活动来源：injected=注入钩子，none=仓内没有窗口日志数据源 */
  activitySource: 'injected' | 'none'
  /** 摘要来源：llm=真调用并拿到非空文本，heuristic=本地启发式 */
  summarySource: 'llm' | 'heuristic'
  /** 降级/失败原因（正常时为空数组） */
  notes: string[]
}

// ============ 本地日期工具 ============

/**
 * 本地时区的 `YYYY-MM-DD`。
 *
 * 原来全模块用 `new Date().toISOString().split('T')[0]`，那是 **UTC 日期**：
 * 东八区早上 7 点写日记，UTC 还停在前一天 23 点，于是「今天」被判成昨天，
 * 草稿会覆盖掉昨天那份文件。这里改成按本地年月日拼。
 */
export function toLocalDateKey(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 某个本地日期的 [当日 0 点, 次日 0 点) 毫秒区间 */
export function localDayRange(dateKey: string): { startTime: number; endTime: number } {
  const parts = dateKey.split('-').map((p) => Number.parseInt(p, 10))
  const [y, m, d] = parts
  if (!y || !m || !d) {
    return { startTime: Number.NaN, endTime: Number.NaN }
  }
  const start = new Date(y, m - 1, d, 0, 0, 0, 0)
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0)
  return { startTime: start.getTime(), endTime: end.getTime() }
}

/** 记忆正文：仓内记忆条目是 user/assistant 两段，没有 content 字段 */
function memoryText(memory: { user?: string; assistant?: string; content?: string }): string {
  if (typeof memory.content === 'string' && memory.content.trim()) return memory.content.trim()
  return [memory.user, memory.assistant]
    .map((s) => (s ?? '').trim())
    .filter((s) => s.length > 0)
    .join(' ')
}

/** -1~1 情绪分：复用 emotionEngine 的 0~100 口径，线性映射（50 → 0），不再另立第三人肉词典 */
export function valenceFromTexts(texts: string[]): number {
  if (texts.length === 0) return 0
  const { score } = moodScoreFromTexts(texts)
  const mapped = (score - 50) / 50
  return Math.max(-1, Math.min(1, Math.round(mapped * 100) / 100))
}

export interface JournalSummary {
  /** 日期范围 */
  dateRange: { start: string; end: string }
  /** 总条目数 */
  totalEntries: number
  /** 平均情绪评分 */
  avgMoodScore: number
  /** 高频标签统计 */
  topTags: Array<{ tag: string; count: number }>
  /** 高频分类统计 */
  topCategories: Array<{ category: string; count: number }>
  /** 本周亮点总结 */
  weeklyHighlights: string[]
}

export interface AutoSummaryConfig {
  /** 摘要风格 */
  style: 'concise' | 'detailed' | 'narrative'
  /** 是否包含情绪分析 */
  includeMoodAnalysis: boolean
  /** 是否提取关键事件 */
  extractHighlights: boolean
  /** 最大摘要长度（字符数） */
  maxSummaryLength: number
}

// ============ 默认配置 ============

const DEFAULT_AUTO_CONFIG: AutoSummaryConfig = {
  style: 'detailed',
  includeMoodAnalysis: true,
  extractHighlights: true,
  maxSummaryLength: 500,
}

// ============ 日记管理器 ============

export class DailyJournalManager {
  private journalDir: string
  private entries: Map<string, JournalEntry> = new Map()
  private config: AutoSummaryConfig
  private deps: DailyJournalDeps
  /** 最近一次草稿的数据来源与降级情况（`getLastDraftReport()` 读它） */
  private lastReport: JournalDraftReport | null = null

  constructor(journalDir: string, config?: Partial<AutoSummaryConfig>, deps?: DailyJournalDeps) {
    this.journalDir = journalDir
    this.config = { ...DEFAULT_AUTO_CONFIG, ...(config || {}) }
    this.deps = { ...(deps || {}) }

    // 确保目录存在
    if (!existsSync(this.journalDir)) {
      void mkdir(this.journalDir, { recursive: true })
    }
  }

  /** 时钟（可注入，默认系统时间） */
  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date()
  }

  /** 最近一次草稿的来源报告；还没生成过草稿时返回 null */
  getLastDraftReport(): JournalDraftReport | null {
    return this.lastReport
  }

  /**
   * 生成今日日记草稿
   *
   * `characterId` 用于取「该角色的记忆」——记忆是按角色分库的，不给角色就取不到，
   * 此时如实返回空草稿并在报告里写明 `memorySource: 'unavailable'`，不去猜默认角色
   * （猜错会把别人的记忆写进这个角色的日记）。
   */
  async generateTodayDraft(characterId?: string): Promise<Partial<JournalEntry>> {
    const today = toLocalDateKey(this.now())
    const notes: string[] = []

    const memoryResult = await this.fetchTodaysMemories(today, characterId, notes)
    const memories = memoryResult.memories
    const activityResult = await this.fetchTodaysActivities(today, notes)
    const activities = activityResult.activities

    // 自动生成摘要
    const autoSummary = await this.generateAutoSummary(memories, activities, notes)

    this.lastReport = {
      dateKey: today,
      memoryCount: memories.length,
      activityCount: activities.length,
      memorySource: memoryResult.source,
      activitySource: activityResult.source,
      summarySource: autoSummary.source,
      notes,
    }

    const relatedMemoryIds = memories.map((m) => m.id).filter((id): id is string => Boolean(id))

    return {
      date: today,
      title: `📅 ${today}`,
      content: this.buildDailyContent(memories, activities),
      summary: autoSummary.summary,
      tags: autoSummary.tags,
      moodScore: autoSummary.moodScore,
      categories: autoSummary.categories,
      highlights: autoSummary.highlights,
      ...(relatedMemoryIds.length > 0 ? { relatedMemoryIds } : {}),
      createdAt: this.now().getTime(),
      updatedAt: this.now().getTime(),
      synced: false,
    }
  }

  /**
   * 保存日记条目
   */
  async saveEntry(entry: JournalEntry): Promise<void> {
    const filePath = this.getEntryFilePath(entry.date)

    await writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8')

    this.entries.set(entry.date, entry)
  }

  /**
   * 获取指定日期的日记
   */
  async getEntry(date: string): Promise<JournalEntry | undefined> {
    // 检查内存缓存
    const cached = this.entries.get(date)
    if (cached) return cached

    // 从文件加载
    const filePath = this.getEntryFilePath(date)

    if (!existsSync(filePath)) {
      return undefined
    }

    try {
      const content = await readFile(filePath, 'utf-8')
      const entry = JSON.parse(content) as JournalEntry

      this.entries.set(date, entry)
      return entry
    } catch (error) {
      console.error('[Journal] Failed to load entry:', error)
      return undefined
    }
  }

  /**
   * 获取日期范围的日记列表
   */
  async getEntriesInRange(startDate: string, endDate: string): Promise<JournalEntry[]> {
    const entries: JournalEntry[] = []

    const currentDate = new Date(startDate)
    const end = new Date(endDate)

    while (currentDate <= end) {
      const dateStr = toLocalDateKey(currentDate)
      const entry = await this.getEntry(dateStr)

      if (entry) {
        entries.push(entry)
      }

      currentDate.setDate(currentDate.getDate() + 1)
    }

    return entries.sort((a, b) => a.date.localeCompare(b.date))
  }

  /**
   * 搜索日记
   *
   * 原实现只翻 `this.entries`（内存缓存）——新进程里缓存是空的，于是「搜索历史日记」
   * 什么都搜不到，而且 `startDate` / `endDate` / `tags` 三个参数**一个都没用上**。
   * 现在真的扫 `journalDir/*.json`，并把四个条件都吃进去。
   */
  async search(
    keywords: string[],
    options?: {
      startDate?: string
      endDate?: string
      tags?: string[]
      limit?: number
    },
  ): Promise<JournalEntry[]> {
    const limit = options?.limit ?? 100
    const normalizedKeywords = (keywords ?? []).map((k) => k.trim().toLowerCase()).filter((k) => k.length > 0)
    const wantedTags = (options?.tags ?? []).map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0)

    const inRange = (date: string): boolean => {
      if (options?.startDate && date < options.startDate) return false
      if (options?.endDate && date > options.endDate) return false
      return true
    }

    const matches = (entry: JournalEntry): boolean => {
      if (!inRange(entry.date)) return false
      if (wantedTags.length > 0) {
        const entryTags = (entry.tags ?? []).map((t) => t.toLowerCase())
        if (!wantedTags.some((t) => entryTags.includes(t))) return false
      }
      if (normalizedKeywords.length === 0) return true
      const haystack = [entry.title, entry.content, entry.summary ?? '', entry.userNotes ?? '']
        .join('\n')
        .toLowerCase()
      return normalizedKeywords.some((k) => haystack.includes(k))
    }

    const results: JournalEntry[] = []
    const seen = new Set<string>()
    const push = (entry: JournalEntry): void => {
      if (seen.has(entry.date) || !matches(entry)) return
      seen.add(entry.date)
      results.push(entry)
    }

    // 1) 内存缓存里已加载过的
    for (const entry of this.entries.values()) push(entry)

    // 2) 磁盘上的日记文件（缓存没有的才读，读不到只记日志不中断整次搜索）
    let files: string[] = []
    try {
      files = await readdir(this.journalDir)
    } catch (error) {
      console.error('[Journal] Failed to list journal dir:', error)
    }
    for (const file of files) {
      const m = /^(\d{4}-\d{2}-\d{2})\.json$/.exec(file)
      if (!m) continue
      const date = m[1]
      if (seen.has(date) || !inRange(date)) continue
      const entry = await this.getEntry(date)
      if (entry) push(entry)
    }

    return results.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
  }

  /**
   * 导出为 Markdown
   */
  async exportToMarkdown(entries: JournalEntry[], outputPath: string): Promise<void> {
    const lines: string[] = ['# 📝 SpiritPal 日记合集', '', `**共${entries.length}篇日记**`, '', '---', '']

    entries.forEach((entry) => {
      lines.push(`## ${entry.title}`)
      lines.push(`**日期**: ${entry.date}`)
      lines.push('')

      if (entry.summary) {
        lines.push('### 📋 摘要')
        lines.push(entry.summary)
        lines.push('')
      }

      lines.push('### 📖 内容')
      lines.push(entry.content)
      lines.push('')

      if (entry.highlights && entry.highlights.length > 0) {
        lines.push('### ✨ 今日亮点')
        entry.highlights.forEach((h) => {
          lines.push(`- **${h.time}** ${h.title}: ${h.description}`)
        })
        lines.push('')
      }

      if (entry.tags.length > 0) {
        lines.push(`**标签**: ${entry.tags.map((t) => `#${t}`).join(' ')}`)
        lines.push('')
      }

      lines.push('---')
      lines.push('')
    })

    await writeFile(outputPath, lines.join('\n'), 'utf-8')
  }

  /**
   * 生成周/月总结
   */
  async generatePeriodSummary(startDate: string, endDate: string): Promise<JournalSummary> {
    const entries = await this.getEntriesInRange(startDate, endDate)

    if (entries.length === 0) {
      return {
        dateRange: { start: startDate, end: endDate },
        totalEntries: 0,
        avgMoodScore: 0,
        topTags: [],
        topCategories: [],
        weeklyHighlights: [],
      }
    }

    // 统计情绪
    const moodScores = entries.filter((e) => e.moodScore !== undefined).map((e) => e.moodScore!)
    const avgMoodScore = moodScores.length > 0 ? moodScores.reduce((a, b) => a + b, 0) / moodScores.length : 0

    // 统计标签
    const tagCounts = new Map<string, number>()
    entries.forEach((entry) => {
      entry.tags.forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
      })
    })
    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }))

    // 统计分类
    const categoryCounts = new Map<string, number>()
    entries.forEach((entry) => {
      entry.categories.forEach((cat) => {
        categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1)
      })
    })
    const topCategories = Array.from(categoryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }))

    // 提取亮点
    const allHighlights: string[] = []
    entries.forEach((entry) => {
      entry.highlights?.forEach((h) => {
        allHighlights.push(`${entry.date}: ${h.title}`)
      })
    })

    return {
      dateRange: { start: startDate, end: endDate },
      totalEntries: entries.length,
      avgMoodScore,
      topTags,
      topCategories,
      weeklyHighlights: allHighlights.slice(0, 10),
    }
  }

  /**
   * 生成自动摘要
   *
   * 原实现把今日记忆正文拼起来 `substring(0, maxSummaryLength)` 当摘要——那是截断，不是摘要；
   * 而且 `activities` 整个被丢掉（参数名带下划线 `_activities`）。现在两条路：
   * 注入 LLM 时真调用并以拿到的非空文本为准（`source: 'llm'`）；没有 LLM（或调用失败）时
   * 走结构化启发式（条数 / 话题 / 活动 / 情绪），并如实标 `source: 'heuristic'` —— 不谎报。
   */
  private async generateAutoSummary(
    memories: JournalMemory[],
    activities: JournalActivity[],
    notes: string[],
  ): Promise<{
    summary: string
    tags: string[]
    moodScore: number
    categories: string[]
    highlights: JournalEntry['highlights']
    source: 'llm' | 'heuristic'
  }> {
    const texts = memories.map((m) => m.content)
    const activityLabels = activities.map((a) => `使用 ${a.app} ${a.duration}`)
    const heuristic = this.buildHeuristicSummary(texts, activities)

    const llm = this.deps.llm
    if (!llm) {
      notes.push(
        this.deps.llm === null
          ? '未注入 LLM（调用方明确标记不可用），摘要为本地启发式'
          : '本模块没有 AI 配置来源，未注入 LLM，摘要为本地启发式',
      )
      return { ...heuristic, source: 'heuristic' }
    }

    try {
      const messages = this.buildSummaryPrompt(texts, activityLabels)
      const raw = (await llm.chat(messages)) ?? ''
      const text = raw.trim()
      if (!text) {
        notes.push('LLM 返回空文本按调用失败处理，摘要降级为本地启发式')
        return { ...heuristic, source: 'heuristic' }
      }
      return {
        summary: this.clampSummary(text),
        tags: heuristic.tags,
        moodScore: heuristic.moodScore,
        categories: heuristic.categories,
        highlights: heuristic.highlights,
        source: 'llm',
      }
    } catch (error) {
      notes.push(`LLM 调用抛错，摘要降级为本地启发式：${(error as Error).message}`)
      return { ...heuristic, source: 'heuristic' }
    }
  }

  /** 摘要提示词（把今日记忆与活动按顺序喂进去，并要求按风格与长度约束输出） */
  private buildSummaryPrompt(texts: string[], activityLabels: string[]): Array<{ role: string; content: string }> {
    const styleHint: Record<AutoSummaryConfig['style'], string> = {
      concise: '用 2–3 句概括，只写结论，不罗列细节',
      detailed: '分「今天做了什么 / 聊了什么 / 心情如何」三段，每段 1–2 句',
      narrative: '用一段连贯的叙事写，像日记口吻，不要分点',
    }
    const body = [
      texts.length > 0 ? `【今日对话】\n${texts.map((t, i) => `${i + 1}. ${t}`).join('\n')}` : '【今日对话】无',
      activityLabels.length > 0 ? `【今日活动】\n${activityLabels.join('\n')}` : '【今日活动】无',
    ].join('\n\n')

    return [
      {
        role: 'system',
        content:
          '你在为桌面宠物应用写用户的一天日记摘要。只用给定素材，不编造细节，不写指导建议。' +
          `风格要求：${styleHint[this.config.style]}。总长度不超过 ${this.config.maxSummaryLength} 字。`,
      },
      { role: 'user', content: body },
    ]
  }

  /** 摘要截到配置上限，尽量在句末而不是字中间断开 */
  private clampSummary(text: string): string {
    const limit = this.config.maxSummaryLength
    if (text.length <= limit) return text
    const head = text.slice(0, limit)
    const lastStop = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('\n'))
    return lastStop > limit * 0.5 ? head.slice(0, lastStop + 1) : `${head}…`
  }

  /** 结构化启发式摘要（与 LLM 无关，纯本地；内容来自真实素材而不是原文截断） */
  private buildHeuristicSummary(
    texts: string[],
    activities: JournalActivity[],
  ): {
    summary: string
    tags: string[]
    moodScore: number
    categories: string[]
    highlights: JournalEntry['highlights']
  } {
    const joined = texts.join(' ')
    const tags = this.extractTags(`${joined} ${activities.map((a) => a.app).join(' ')}`.trim())
    const categories = this.detectCategories(joined)
    const moodScore = valenceFromTexts(texts)
    const moodLabel = moodScore > 0.2 ? '偏积极' : moodScore < -0.2 ? '偏消极' : '平稳'

    const parts: string[] = []
    parts.push(`今天共记下 ${texts.length} 条对话`)
    if (activities.length > 0) {
      parts.push(`活动 ${activities.length} 项（${activities
        .slice(0, 3)
        .map((a) => a.app)
        .join('、')}）`)
    }
    if (tags.length > 0) parts.push(`涉及 ${tags.join(' / ')}`)
    parts.push(`心情${moodLabel}（${moodScore}）`)

    return {
      summary: this.clampSummary(parts.join('，') + '。'),
      tags,
      moodScore,
      categories,
      highlights: this.buildHighlights(texts, activities),
    }
  }

  /** 亮点：从最长的两条对话里各取一句 + 用时最长的活动（没有素材就返回空，不编） */
  private buildHighlights(texts: string[], activities: JournalActivity[]): JournalEntry['highlights'] {
    const highlights: JournalEntry['highlights'] = []
    const top = texts
      .filter((t) => t.trim().length > 0)
      .sort((a, b) => b.length - a.length)
      .slice(0, 2)
    top.forEach((text, idx) => {
      highlights.push({
        time: '--:--',
        title: idx === 0 ? '今天最长的对话' : '另一段对话',
        description: text.length > 80 ? `${text.slice(0, 80)}…` : text,
      })
    })
    const longestActivity = activities
      .map((a) => ({ ...a, minutes: Number.parseFloat(String(a.duration)) || 0 }))
      .sort((a, b) => b.minutes - a.minutes)[0]
    if (longestActivity && longestActivity.minutes > 0) {
      highlights.push({
        time: '--:--',
        title: '用时最长的应用',
        description: `${longestActivity.app}（${longestActivity.duration}）`,
      })
    }
    return highlights
  }

  /**
   * 提取今日记忆
   *
   * 默认走仓内记忆层（按角色分库）：`EnhancedMemoryManager.getMemoriesByTimeRange()`
   * 取当日区间。动态 `import()` 是为了不把 SQLite / RAG 拖进引用本模块的轻量模块图。
   */
  private async fetchTodaysMemories(
    dateKey: string,
    characterId: string | undefined,
    notes: string[],
  ): Promise<{ memories: JournalMemory[]; source: JournalDraftReport['memorySource'] }> {
    if (this.deps.loadMemories) {
      const memories = await this.deps.loadMemories(characterId ?? '', dateKey)
      return { memories, source: 'injected' }
    }
    if (!characterId) {
      notes.push('未传 characterId：记忆按角色分库，不猜默认角色，今日记忆按空处理')
      return { memories: [], source: 'unavailable' }
    }

    try {
      const { getEnhancedMemoryManager } = await import('@/lib/memory/enhancedMemory')
      const manager = getEnhancedMemoryManager(characterId)
      const range = localDayRange(dateKey)
      const raw = manager.getMemoriesByTimeRange({ startTime: range.startTime, endTime: range.endTime })
      const memories: JournalMemory[] = raw
        .map((m) => ({
          id: m.id,
          content: memoryText(m),
          created_at: m.created_at,
        }))
        .filter((m) => m.content.length > 0)
      return { memories, source: 'manager' }
    } catch (error) {
      notes.push(`记忆层不可用，今日记忆按空处理：${(error as Error).message}`)
      return { memories: [], source: 'unavailable' }
    }
  }

  /**
   * 提取今日活动
   *
   * 仓内目前**没有**窗口日志的写入方（没有任何模块把「前台应用 + 时长」落盘），
   * 所以这里不编数据：有注入钩子就用钩子，没有就返回空并在报告里写明 `activitySource: 'none'`。
   */
  private async fetchTodaysActivities(
    dateKey: string,
    notes: string[],
  ): Promise<{ activities: JournalActivity[]; source: JournalDraftReport['activitySource'] }> {
    if (this.deps.loadActivities) {
      const activities = await this.deps.loadActivities(dateKey)
      return { activities, source: 'injected' }
    }
    notes.push('仓内没有窗口活动日志数据源（未注入 loadActivities），今日活动按空处理')
    return { activities: [], source: 'none' }
  }

  /**
   * 构建日报内容
   */
  private buildDailyContent(memories: JournalMemory[], activities: JournalActivity[]): string {
    const sections: string[] = []

    sections.push('# 今天的发生的事情\n')

    if (memories.length > 0) {
      sections.push('## 💭 对话记录\n')
      memories.forEach((m, _idx) => {
        const time = new Date(m.created_at).toLocaleTimeString('zh-CN')
        sections.push(`**${time}**: ${m.content}`)
      })
      sections.push('')
    }

    if (activities.length > 0) {
      sections.push('## 📝 活动记录\n')
      activities.forEach((a) => {
        sections.push(`- ${a.app}: ${a.duration}`)
      })
      sections.push('')
    }

    return sections.join('\n')
  }

  /**
   * 提取标签
   */
  private extractTags(text: string): string[] {
    const predefinedTags: Record<string, string[]> = {
      work: ['工作', '会议', '项目', '任务', '报告', '客户'],
      study: ['学习', '看书', '上课', '考试', '作业'],
      gaming: ['游戏', '玩', '通关', '升级'],
      social: ['聊天', '朋友', '聚会', '社交'],
      health: ['运动', '跑步', '健身', '健康'],
    }

    const foundTags: string[] = []
    const textLower = text.toLowerCase()

    Object.entries(predefinedTags).forEach(([tag, keywords]) => {
      if (keywords.some((k) => textLower.includes(k))) {
        foundTags.push(tag)
      }
    })

    return foundTags.length > 0 ? foundTags : ['daily']
  }

  /**
   * 检测分类
   */
  private detectCategories(text: string): string[] {
    return this.extractTags(text) // 复用标签逻辑
  }

  /**
   * 获取文件路径
   */
  private getEntryFilePath(date: string): string {
    return join(this.journalDir, `${date}.json`)
  }

  /**
   * 清理缓存
   */
  clearCache(): void {
    this.entries.clear()
  }
}

// ============ 快捷函数 ============

let instance: DailyJournalManager | null = null

export function getDailyJournalManager(
  journalDir?: string,
  config?: Partial<AutoSummaryConfig>,
  deps?: DailyJournalDeps,
): DailyJournalManager {
  if (!instance) {
    const defaultDir = journalDir || join(process.env.HOME || '/tmp', '.spiritpal', 'journal')
    instance = new DailyJournalManager(defaultDir, config, deps)
  }
  return instance
}
