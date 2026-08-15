/**
 * 上下文快照管理器（R1 — 现实感知记录）
 *
 * @fileoverview
 * 在 contextAwareness 的状态变迁点写入 context_episodes 行；
 * 每晚睡眠巩固（W5）时 LLM 把当日片段浓缩为一两条观察记忆。
 *
 * 核心功能：
 * 1. 记录状态变迁（work_state 变化、idle 跨越阈值、天气显著变化）
 * 2. 查询当日片段
 * 3. LLM 浓缩为观察记忆（sourceKind='observation'）
 *
 * @module contextEpisodeManager
 * @requires ./db - SQLite 持久化
 */

import { getDb } from './db'

// ============ 类型定义 ============

export interface ContextEpisode {
  id: number
  character_id: string
  started_at: number
  ended_at: number | null
  work_state: string | null
  weather: string | null
  idle_minutes: number | null
  music: string | null
  summary: string | null
}

// ============ 上下文快照管理器 ============

export class ContextEpisodeManager {
  private characterId: string
  /** 上次记录的 work_state，用于检测变迁 */
  private lastWorkState: string | null = null
  /** 当前未关闭的 episode ID */
  private currentEpisodeId: number | null = null
  /** 上次记录时间 */
  private lastRecordAt = 0

  constructor(characterId: string) {
    this.characterId = characterId
  }

  /**
   * 记录状态变迁——在 work_state 变化或空闲跨越阈值时调用
   * @param workState 当前工作状态
   * @param weather 当前天气
   * @param idleMinutes 空闲分钟数
   * @param music 当前音乐
   */
  async recordStateChange(
    workState: string,
    weather?: string,
    idleMinutes?: number,
    music?: string,
  ): Promise<void> {
    const now = Date.now()
    // 检测是否有状态变迁
    const stateChanged = workState !== this.lastWorkState
    const idleThresholdCrossed = idleMinutes !== undefined && (
      (idleMinutes >= 30 && this.lastRecordAt > 0 && now - this.lastRecordAt > 30000) ||
      (idleMinutes < 5 && this.lastWorkState === 'idle')
    )

    if (!stateChanged && !idleThresholdCrossed) return

    // 关闭上一个 episode
    if (this.currentEpisodeId !== null) {
      try {
        const db = await getDb()
        await db.execute(
          'UPDATE context_episodes SET ended_at = $1 WHERE id = $2',
          [now, this.currentEpisodeId],
        )
      } catch {
        // ignore
      }
      this.currentEpisodeId = null
    }

    // 开启新 episode
    try {
      const db = await getDb()
      await db.execute(
        `INSERT INTO context_episodes (character_id, started_at, work_state, weather, idle_minutes, music)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [this.characterId, now, workState, weather ?? null, idleMinutes ?? null, music ?? null],
      )
      const rows = await db.select<{ id: number }[]>('SELECT last_insert_rowid() as id')
      this.currentEpisodeId = rows[0]?.id ?? null
    } catch {
      // DB 不可用时不影响正常流程
    }

    this.lastWorkState = workState
    this.lastRecordAt = now
  }

  /**
   * 获取今日所有片段
   * @returns 今日上下文片段列表
   */
  async getTodayEpisodes(): Promise<ContextEpisode[]> {
    const db = await getDb()
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    return db.select(
      `SELECT * FROM context_episodes WHERE character_id = $1 AND started_at >= $2 ORDER BY started_at ASC`,
      [this.characterId, todayStart],
    )
  }

  /**
   * 获取指定日期的所有片段
   * @param dateStr 日期字符串 YYYY-MM-DD
   */
  async getEpisodesByDate(dateStr: string): Promise<ContextEpisode[]> {
    const db = await getDb()
    const [y, m, d] = dateStr.split('-').map(Number)
    const start = new Date(y, m - 1, d).getTime()
    const end = start + 86400000
    return db.select(
      `SELECT * FROM context_episodes WHERE character_id = $1 AND started_at >= $2 AND started_at < $3 ORDER BY started_at ASC`,
      [this.characterId, start, end],
    )
  }

  /**
   * 构建片段摘要文本（用于 LLM 浓缩）
   * @param episodes 片段列表
   * @returns 摘要文本
   */
  buildEpisodesText(episodes: ContextEpisode[]): string {
    if (episodes.length === 0) return ''
    return episodes.map((ep) => {
      const time = new Date(ep.started_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      const endTime = ep.ended_at ? new Date(ep.ended_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '至今'
      const parts: string[] = [`${time}-${endTime}`]
      if (ep.work_state) parts.push(`状态:${ep.work_state}`)
      if (ep.weather) parts.push(`天气:${ep.weather}`)
      if (ep.idle_minutes !== null) parts.push(`空闲:${ep.idle_minutes}分钟`)
      if (ep.music) parts.push(`音乐:${ep.music}`)
      return parts.join(' ')
    }).join('\n')
  }

  /**
   * LLM 浓缩当日片段为观察记忆
   * @param llmCondenser LLM 浓缩函数
   * @returns 浓缩后的观察记忆文本（1-2 条）
   */
  async condenseToObservation(
    llmCondenser: (episodesText: string) => Promise<string>,
  ): Promise<string | null> {
    const episodes = await this.getTodayEpisodes()
    if (episodes.length === 0) return null

    const episodesText = this.buildEpisodesText(episodes)
    if (!episodesText) return null

    try {
      const observation = await llmCondenser(episodesText)
      return observation.trim() || null
    } catch {
      return null
    }
  }
}

// ============ 单例缓存 ============

const managers = new Map<string, ContextEpisodeManager>()

export function getContextEpisodeManager(characterId: string): ContextEpisodeManager {
  let mgr = managers.get(characterId)
  if (!mgr) {
    mgr = new ContextEpisodeManager(characterId)
    managers.set(characterId, mgr)
  }
  return mgr
}
