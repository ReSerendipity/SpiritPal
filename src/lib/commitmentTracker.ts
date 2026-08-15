/**
 * 约定与计划追踪模块（R2 — 打破第四面墙的杀手级特性）
 *
 * @fileoverview
 * 让宠物拥有"期待"和"挂念"——记得主人在现实中提到的计划，
 * 在约定日主动关心，在次日未提及时轻问感受。
 *
 * 核心功能：
 * 1. 从对话中抽取结构化约定（主人声明的未来计划/承诺/持续状态）
 * 2. 存储到 commitments 表
 * 3. 触发时机：约定日当天首次交互/约定次日未提及时主动轻问/重复约定节奏感知
 * 4. 状态机：open → fulfilled（用户提及结果）/ lapsed（超期 3 天未提及）
 *
 * @module commitmentTracker
 * @requires ./db - SQLite 持久化
 */

import { getDb } from './db'

// ============ 类型定义 ============

export interface Commitment {
  id: number
  character_id: string
  content: string
  actor: 'owner' | 'pet' | 'both'
  due_at: number | null
  status: 'open' | 'fulfilled' | 'lapsed' | 'cancelled'
  source_memory_id: number | null
  created_at: number
  follow_up_count: number
  // P2-4：重复约定频率（null=单次，daily=每日，weekly=每周）
  repeat?: 'null' | 'daily' | 'weekly' | null
}

/** LLM 抽取的约定结果 */
export interface ExtractedCommitment {
  content: string
  actor: 'owner' | 'pet' | 'both'
  due: string | null  // ISO 日期字符串或 null
  repeat: 'null' | 'daily' | 'weekly' | null
}

// ============ 规则提取模式 ============

// 规则层兜底：检测"明天/下周/周X/X月X日"等时间词 + 动作动词
const PLAN_PATTERNS = [
  /(?:我要|我打算|我准备|我计划|我会|我得去|我得|需要去)\s*(.{2,30})/,
  /(?:明天|后天|下周|下个月|周[一二三四五六日天])\s*(.{2,30})/,
  /(?:答应|承诺|说好)\s*(.{2,30})/,
]

const TIME_HINTS = [
  { pattern: /今天/g, offset: 0 },
  { pattern: /明天/g, offset: 1 },
  { pattern: /后天/g, offset: 2 },
  { pattern: /下周/g, offset: 7 },
  { pattern: /下个月/g, offset: 30 },
  { pattern: /周[一二三四五六日天]/g, offset: 7 },
]

// P2-4：重复约定检测模式
const REPEAT_PATTERNS: { pattern: RegExp; repeat: 'daily' | 'weekly' }[] = [
  { pattern: /每天|每日|天天|every\s*day/gi, repeat: 'daily' },
  { pattern: /每周|每周[一二三四五六日天]|every\s*week/gi, repeat: 'weekly' },
]

// ============ 约定追踪管理器 ============

export class CommitmentTracker {
  private characterId: string

  constructor(characterId: string) {
    this.characterId = characterId
  }

  /**
   * 从对话中抽取约定（规则层兜底）
   * @param userText 用户消息
   * @param assistantText AI 回复
   * @returns 抽取到的约定列表
   */
  extractFromText(userText: string, _assistantText: string): ExtractedCommitment[] {
    const results: ExtractedCommitment[] = []
    // P2-4：检测重复约定频率
    let detectedRepeat: 'null' | 'daily' | 'weekly' | null = null
    for (const rp of REPEAT_PATTERNS) {
      if (rp.pattern.test(userText)) {
        detectedRepeat = rp.repeat
        rp.pattern.lastIndex = 0
        break
      }
    }

    for (const pattern of PLAN_PATTERNS) {
      const match = userText.match(pattern)
      if (match && match[1]) {
        const content = match[1].trim().slice(0, 50)
        if (content.length >= 2) {
          // 尝试提取时间
          let due: string | null = null
          for (const hint of TIME_HINTS) {
            if (hint.pattern.test(userText)) {
              const dueDate = new Date()
              dueDate.setDate(dueDate.getDate() + hint.offset)
              due = dueDate.toISOString().split('T')[0]!
              hint.pattern.lastIndex = 0
              break
            }
          }
          results.push({
            content,
            actor: 'owner',
            due,
            repeat: detectedRepeat,
          })
        }
      }
    }
    return results
  }

  /**
   * 使用 LLM 抽取约定（可选，更精准）
   * @param userText 用户消息
   * @param assistantText AI 回复
   * @param llmExtractor LLM 抽取函数
   */
  async extractWithLLM(
    userText: string,
    assistantText: string,
    llmExtractor?: (conversation: string) => Promise<ExtractedCommitment[]>,
  ): Promise<ExtractedCommitment[]> {
    if (!llmExtractor) return this.extractFromText(userText, assistantText)
    try {
      const conversation = `User: ${userText}\nAI: ${assistantText}`
      return await llmExtractor(conversation)
    } catch {
      return this.extractFromText(userText, assistantText)
    }
  }

  /**
   * 保存约定到数据库
   * P2-4：新增 repeat 字段存储
   */
  async saveCommitment(commitment: ExtractedCommitment, sourceMemoryId?: number): Promise<number> {
    const db = await getDb()
    const now = Date.now()
    const dueAt = commitment.due ? new Date(commitment.due).getTime() : null
    const repeatVal = commitment.repeat ?? null
    await db.execute(
      `INSERT INTO commitments (character_id, content, actor, due_at, status, source_memory_id, created_at, follow_up_count, repeat)
       VALUES ($1, $2, $3, $4, 'open', $5, $6, 0, $7)`,
      [this.characterId, commitment.content, commitment.actor, dueAt, sourceMemoryId ?? null, now, repeatVal],
    )
    const rows = await db.select<{ id: number }[]>('SELECT last_insert_rowid() as id')
    return rows[0]?.id ?? 0
  }

  /**
   * 获取所有未完成的约定
   */
  async getOpenCommitments(): Promise<Commitment[]> {
    const db = await getDb()
    return db.select(
      `SELECT * FROM commitments WHERE character_id = $1 AND status = 'open' ORDER BY due_at ASC`,
      [this.characterId],
    )
  }

  /**
   * 获取今天到期的约定
   */
  async getDueTodayCommitments(): Promise<Commitment[]> {
    const db = await getDb()
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const todayEnd = todayStart + 86400000
    return db.select(
      `SELECT * FROM commitments WHERE character_id = $1 AND status = 'open' AND due_at >= $2 AND due_at < $3 ORDER BY due_at ASC`,
      [this.characterId, todayStart, todayEnd],
    )
  }

  /**
   * 获取已逾期但未过期的约定（1-3 天内）
   */
  async getOverdueCommitments(): Promise<Commitment[]> {
    const db = await getDb()
    const now = Date.now()
    const threeDaysAgo = now - 3 * 86400000
    return db.select(
      `SELECT * FROM commitments WHERE character_id = $1 AND status = 'open' AND due_at < $2 AND due_at > $3 ORDER BY due_at ASC`,
      [this.characterId, now, threeDaysAgo],
    )
  }

  /**
   * 标记约定为已完成
   */
  async markFulfilled(id: number): Promise<void> {
    const db = await getDb()
    await db.execute(`UPDATE commitments SET status = 'fulfilled' WHERE id = $1`, [id])
  }

  /**
   * 标记约定为已过期
   */
  async markLapsed(id: number): Promise<void> {
    const db = await getDb()
    await db.execute(`UPDATE commitments SET status = 'lapsed' WHERE id = $1`, [id])
  }

  /**
   * 增加跟进次数
   */
  async incrementFollowUp(id: number): Promise<void> {
    const db = await getDb()
    await db.execute(
      `UPDATE commitments SET follow_up_count = follow_up_count + 1 WHERE id = $1`,
      [id],
    )
  }

  /**
   * 自动将超期 3 天未提及的约定标记为 lapsed
   */
  async autoLapseOverdue(): Promise<number> {
    const db = await getDb()
    const threshold = Date.now() - 3 * 86400000
    const result = await db.select<{ id: number }[]>(
      `SELECT id FROM commitments WHERE character_id = $1 AND status = 'open' AND due_at < $2`,
      [this.characterId, threshold],
    )
    for (const row of result) {
      await this.markLapsed(row.id)
    }
    return result.length
  }

  /**
   * 生成约定相关的候选消息
   * @returns 候选消息列表（用于 RecallEngine 或直接气泡）
   */
  async generateFollowUpCandidates(): Promise<Array<{ message: string; commitment: Commitment; urgency: number }>> {
    const candidates: Array<{ message: string; commitment: Commitment; urgency: number }> = []
    const now = new Date()
    const hour = now.getHours()

    // 1. 今天到期的约定
    const dueToday = await this.getDueTodayCommitments()
    for (const c of dueToday) {
      candidates.push({
        message: `今天${c.content}！紧张吗？我在家等你消息～`,
        commitment: c,
        urgency: 0.9,
      })
    }

    // 2. 逾期但未过期的约定（先问感受，不预设结果）
    const overdue = await this.getOverdueCommitments()
    for (const c of overdue) {
      // 只在工作时间跟进（9:00-22:00），深夜不打扰
      if (hour >= 9 && hour < 22 && c.follow_up_count < 2) {
        candidates.push({
          message: `之前说${c.content}……感觉怎么样了？`,
          commitment: c,
          urgency: 0.7,
        })
      }
    }

    return candidates.sort((a, b) => b.urgency - a.urgency)
  }

  /**
   * P2-4：为已到期的重复约定自动创建下一轮约定
   * 在 autoLapseOverdue 之后调用，对于有 repeat 字段的已 fulfilled/lapsed 约定，
   * 自动创建新的 open 约定，到期日为下一周期。
   *
   * @returns 新创建的重复约定数量
   */
  async createRecurringCommitments(): Promise<number> {
    const db = await getDb()
    // 查询所有已完成或已过期的重复约定
    const recurring = await db.select<Commitment[]>(
      `SELECT * FROM commitments WHERE character_id = $1 AND status IN ('fulfilled', 'lapsed') AND repeat IS NOT NULL AND repeat != 'null'`,
      [this.characterId],
    )

    let created = 0
    const now = Date.now()
    const DAY_MS = 86400000

    for (const c of recurring) {
      // 避免重复创建：检查是否已有同内容的 open 约定
      const existing = await db.select<{ id: number }[]>(
        `SELECT id FROM commitments WHERE character_id = $1 AND content = $2 AND status = 'open' AND created_at > $3`,
        [this.characterId, c.content, now - DAY_MS],
      )
      if (existing.length > 0) continue

      // 计算下一次到期时间
      let nextDue: number | null = null
      if (c.repeat === 'daily') {
        nextDue = now + DAY_MS
      } else if (c.repeat === 'weekly') {
        nextDue = now + 7 * DAY_MS
      }

      await db.execute(
        `INSERT INTO commitments (character_id, content, actor, due_at, status, source_memory_id, created_at, follow_up_count, repeat)
         VALUES ($1, $2, $3, $4, 'open', NULL, $5, 0, $6)`,
        [this.characterId, c.content, c.actor, nextDue, now, c.repeat],
      )
      created++
    }

    return created
  }

  /**
   * 构建注入上下文（告诉 LLM 主人有哪些待完成的计划）
   */
  async buildContext(): Promise<string> {
    const open = await this.getOpenCommitments()
    if (open.length === 0) return ''
    const lines = open.slice(0, 5).map((c) => {
      const due = c.due_at ? `（预计 ${new Date(c.due_at).toLocaleDateString()}）` : ''
      return `- ${c.content}${due}`
    })
    return `【主人的计划与约定】\n${lines.join('\n')}`
  }
}

// ============ 单例缓存 ============

const trackers = new Map<string, CommitmentTracker>()

export function getCommitmentTracker(characterId: string): CommitmentTracker {
  let tracker = trackers.get(characterId)
  if (!tracker) {
    tracker = new CommitmentTracker(characterId)
    trackers.set(characterId, tracker)
  }
  return tracker
}
