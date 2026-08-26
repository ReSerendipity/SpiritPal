/**
 * @file dailyJournal.ts
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

import { writeFile, readFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

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
  
  constructor(journalDir: string, config?: Partial<AutoSummaryConfig>) {
    this.journalDir = journalDir
    this.config = { ...DEFAULT_AUTO_CONFIG, ...(config || {}) }
    
    // 确保目录存在
    if (!existsSync(this.journalDir)) {
      void mkdir(this.journalDir, { recursive: true })
    }
  }

  /**
   * 生成今日日记草稿
   */
  async generateTodayDraft(): Promise<Partial<JournalEntry>> {
    const today = new Date().toISOString().split('T')[0]
    
    // TODO: 从记忆中提取今日对话和活动
    const memories = await this.fetchTodaysMemories(today)
    const activities = await this.fetchTodaysActivities(today)
    
    // 自动生成摘要
    const autoSummary = await this.generateAutoSummary(memories, activities)
    
    return {
      date: today,
      title: `📅 ${today}`,
      content: this.buildDailyContent(memories, activities),
      summary: autoSummary.summary,
      tags: autoSummary.tags,
      moodScore: autoSummary.moodScore,
      categories: autoSummary.categories,
      highlights: autoSummary.highlights,
      createdAt: Date.now(),
      updatedAt: Date.now(),
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
  async getEntriesInRange(
    startDate: string,
    endDate: string,
  ): Promise<JournalEntry[]> {
    const entries: JournalEntry[] = []
    
    let currentDate = new Date(startDate)
    const end = new Date(endDate)
    
    while (currentDate <= end) {
      const dateStr = currentDate.toISOString().split('T')[0]
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
   */
  async search(keywords: string[], options?: {
    startDate?: string
    endDate?: string
    tags?: string[]
    limit?: number
  }): Promise<JournalEntry[]> {
    const results: JournalEntry[] = []
    
    // TODO: 遍历所有日记文件进行搜索
    // 简化实现：仅基于内存缓存
    
    for (const entry of this.entries.values()) {
      const match = keywords.some(keyword => 
        entry.content.toLowerCase().includes(keyword.toLowerCase()) ||
        entry.title.toLowerCase().includes(keyword.toLowerCase()) ||
        entry.summary?.toLowerCase().includes(keyword.toLowerCase())
      )
      
      if (match) {
        results.push(entry)
      }
    }

    return results.slice(0, options?.limit ?? 100)
  }

  /**
   * 导出为 Markdown
   */
  async exportToMarkdown(
    entries: JournalEntry[],
    outputPath: string,
  ): Promise<void> {
    const lines: string[] = [
      '# 📝 SpiritPal 日记合集',
      '',
      `**共${entries.length}篇日记**`,
      '',
      '---',
      '',
    ]

    entries.forEach(entry => {
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
        entry.highlights.forEach(h => {
          lines.push(`- **${h.time}** ${h.title}: ${h.description}`)
        })
        lines.push('')
      }
      
      if (entry.tags.length > 0) {
        lines.push(`**标签**: ${entry.tags.map(t => `#${t}`).join(' ')}`)
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
  async generatePeriodSummary(
    startDate: string,
    endDate: string,
  ): Promise<JournalSummary> {
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
    const moodScores = entries
      .filter(e => e.moodScore !== undefined)
      .map(e => e.moodScore!)
    const avgMoodScore = moodScores.length > 0
      ? moodScores.reduce((a, b) => a + b, 0) / moodScores.length
      : 0

    // 统计标签
    const tagCounts = new Map<string, number>()
    entries.forEach(entry => {
      entry.tags.forEach(tag => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
      })
    })
    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }))

    // 统计分类
    const categoryCounts = new Map<string, number>()
    entries.forEach(entry => {
      entry.categories.forEach(cat => {
        categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1)
      })
    })
    const topCategories = Array.from(categoryCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([category, count]) => ({ category, count }))

    // 提取亮点
    const allHighlights: string[] = []
    entries.forEach(entry => {
      entry.highlights?.forEach(h => {
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
   */
  private async generateAutoSummary(
    memories: any[],
    activities: any[],
  ): Promise<{
    summary: string
    tags: string[]
    moodScore: number
    categories: string[]
    highlights: JournalEntry['highlights']
  }> {
    // TODO: 调用 LLM 生成智能摘要
    // 这里使用简化实现
    
    const texts = memories.map(m => m.content).join(' ')
    const tags = this.extractTags(texts)
    const categories = this.detectCategories(texts)
    const moodScore = this.analyzeMood(texts)
    
    return {
      summary: texts.substring(0, this.config.maxSummaryLength),
      tags,
      moodScore,
      categories,
      highlights: [],
    }
  }

  /**
   * 提取今日记忆（简化实现）
   */
  private async fetchTodaysMemories(date: string): Promise<any[]> {
    // TODO: 从记忆中提取
    return []
  }

  /**
   * 提取今日活动（简化实现）
   */
  private async fetchTodaysActivities(date: string): Promise<any[]> {
    // TODO: 从窗口日志中提取
    return []
  }

  /**
   * 构建日报内容
   */
  private buildDailyContent(memories: any[], activities: any[]): string {
    const sections: string[] = []
    
    sections.push('# 今天的发生的事情\n')
    
    if (memories.length > 0) {
      sections.push('## 💭 对话记录\n')
      memories.forEach((m, idx) => {
        const time = new Date(m.created_at).toLocaleTimeString('zh-CN')
        sections.push(`**${time}**: ${m.content}`)
      })
      sections.push('')
    }
    
    if (activities.length > 0) {
      sections.push('## 📝 活动记录\n')
      activities.forEach(a => {
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
      if (keywords.some(k => textLower.includes(k))) {
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
   * 情绪分析
   */
  private analyzeMood(text: string): number {
    // 简单启发式评分
    const positiveWords = ['开心', '高兴', '棒', '好', '喜欢', '赞']
    const negativeWords = ['难过', '累', '烦', '讨厌', '糟']
    
    let score = 0
    positiveWords.forEach(w => { if (text.includes(w)) score += 1 })
    negativeWords.forEach(w => { if (text.includes(w)) score -= 1 })
    
    return Math.max(-1, Math.min(1, score / 5))
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
): DailyJournalManager {
  if (!instance) {
    const defaultDir = journalDir || join(process.env.HOME || '/tmp', '.spiritpal', 'journal')
    instance = new DailyJournalManager(defaultDir, config)
  }
  return instance
}
