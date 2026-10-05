/**
 * @file scheduleManager.ts
 * @description 日程管理器模块 — 对话式日程创建与提醒功能
 *
 * 主要功能：
 * 1. 解析用户自然语言中的时间信息（增强版）
 * 2. 创建结构化日程事件
 * 3. 定时检查并通过系统通知 + 宠物行为提醒
 *
 * 主要模块：
 * - EnhancedScheduleEvent: 日程事件接口
 * - parseScheduleFromText: 从自然语言解析时间
 * - ScheduleManager: 日程管理器类
 *
 * 依赖关系：
 * - @tauri-apps/plugin-notification: 系统通知
 *
 * 核心接口：
 * - ScheduleManager.addEvent(): 添加日程
 * - ScheduleManager.addFromChat(): 从对话文本创建日程
 * - ScheduleManager.getPendingEvents(): 获取待处理日程
 * - getScheduleManager(): 获取单例实例
 *
 * PRD §7.6 F4.5 对话式日程创建
 */

import {
  sendNotification,
  isPermissionGranted,
  requestPermission,
} from '@tauri-apps/plugin-notification'
import { generateId } from '@/lib/data/commonUtils'
import { deleteSchedule, getSchedules, saveSchedule } from '@/lib/data/db'
import { useSettingsStore } from '@/stores/settingsStore'

// ============ 日程事件类型 ============

/**
 * 日程状态类型
 * - pending: 待触发
 * - triggered: 已触发
 * - completed: 已完成
 * - cancelled: 已取消
 */
export type ScheduleStatus = 'pending' | 'triggered' | 'completed' | 'cancelled'

/**
 * 增强版日程事件接口
 * 表示一个完整的日程事件，包含时间、重复规则、提醒等信息
 */
export interface EnhancedScheduleEvent {
  /** 事件唯一标识 */
  id: string
  /** 事件标题 */
  title: string
  /** 事件描述（可选） */
  description?: string
  /** 触发时间戳（毫秒） */
  triggerTime: number
  /** 重复规则（可选） */
  repeatRule?: {
    /** 重复类型：每日/每周/每月/每年 */
    type: 'daily' | 'weekly' | 'monthly' | 'yearly'
    /** 重复间隔 */
    interval: number
    /** 每周重复的星期几（0-6，0为周日） */
    daysOfWeek?: number[]
  }
  /** 提前提醒的分钟数数组 */
  reminderMinutes: number[]
  /** 已触发的提前提醒分钟数（避免重复触发） */
  firedReminders?: number[]
  /** 事件状态 */
  status: ScheduleStatus
  /** 来源：手动创建或对话创建 */
  source: 'manual' | 'chat'
  /** 关联角色 ID（可选） */
  characterId?: string
}

// ============ 时间解析（增强版）============

/**
 * 解析时间结果接口
 * 从自然语言中解析出的时间信息
 */
interface ParsedTime {
  /** 触发时间戳 */
  triggerTime: number
  /** 事件标题 */
  title: string
  /** 事件描述 */
  description?: string
  /** 重复规则 */
  repeatRule?: {
    type: 'daily' | 'weekly' | 'monthly' | 'yearly'
    interval: number
    daysOfWeek?: number[]
  }
}

/**
 * 辅助函数：解析时间段（上午/下午/晚上/早上）+ 小时:分钟
 * @param text 输入文本
 * @returns 解析出的小时、分钟和时间段，解析失败返回 null
 */
function parseTimePeriod(text: string): { hour: number; minute: number; period?: string } | null {
  const m = text.match(/(上午|下午|晚上|早上)?\s*(\d{1,2})\s*[点:：]\s*(\d{0,2})/)
  if (!m) return null
  let hour = parseInt(m[2]!)
  const minute = m[3] ? parseInt(m[3]) : 0
  const period = m[1]
  if (period === '下午' || period === '晚上') {
    if (hour < 12) hour += 12
  }
  if (period === '早上' || period === '上午') {
    if (hour >= 12) hour -= 12
  }
  return { hour, minute, period }
}

/**
 * 从自然语言文本中解析日程信息
 * 支持多种时间表达方式：X分钟后、X小时后、每天、明天、后天、下周等
 *
 * @param input 用户输入的自然语言文本
 * @returns 解析出的时间信息，无法解析时返回 null
 *
 * @example
 * ```ts
 * parseScheduleFromText("5分钟后提醒我喝水")  // => { triggerTime: Date.now() + 300000, title: "喝水" }
 * parseScheduleFromText("明天下午3点开会")   // => { triggerTime: tomorrow 15:00, title: "开会" }
 * ```
 */
export function parseScheduleFromText(input: string): ParsedTime | null {
  const now = new Date()
  const lower = input.toLowerCase()

  // 1. 匹配 "X分钟后" / "X分钟后提醒"
  const minMatch = input.match(/(\d+)\s*分钟[后以]/)
  if (minMatch) {
    const minutes = parseInt(minMatch[1]!)
    const title = input.replace(/提醒|后|以|(\d+)\s*分钟/g, '').trim() || '提醒事项'
    return {
      triggerTime: Date.now() + minutes * 60000,
      title,
    }
  }

  // 2. 匹配 "X小时后"
  const hourMatch = input.match(/(\d+)\s*[个小]?时[后以]/)
  if (hourMatch) {
    const hours = parseInt(hourMatch[1]!)
    const title = input.replace(/提醒|后|以|(\d+)\s*[个小]?时/g, '').trim() || '提醒事项'
    return {
      triggerTime: Date.now() + hours * 3600000,
      title,
    }
  }

  // 3. 匹配 "每天上午X点" / "每天下午X点" / "每天X点"（每日重复日程）
  if (input.includes('每天') || input.includes('每日')) {
    const tp = parseTimePeriod(input)
    const target = new Date(now)
    if (tp) {
      target.setHours(tp.hour, tp.minute, 0, 0)
    } else {
      target.setHours(9, 0, 0, 0)
    }
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1)
    }
    const title = input
      .replace(/每天|每日|提醒我|提醒|(上午|下午|晚上|早上)?\s*(\d{1,2})\s*[点:：]\s*(\d{0,2})/g, '')
      .trim() || '每日提醒'
    return {
      triggerTime: target.getTime(),
      title,
      repeatRule: { type: 'daily', interval: 1 },
    }
  }

  // 4. 匹配 "明天下午X点" / "明天上午X点" / "明天X点" / "明天"
  if (input.includes('明天') || lower.includes('tomorrow')) {
    const tp = parseTimePeriod(input)
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    if (tp) {
      tomorrow.setHours(tp.hour, tp.minute, 0, 0)
    } else {
      tomorrow.setHours(9, 0, 0, 0)
    }
    const title = input
      .replace(/明天|tomorrow|提醒我|提醒|(上午|下午|晚上|早上)?\s*(\d{1,2})\s*[点:：]\s*(\d{0,2})/gi, '')
      .trim() || '明天的事项'
    return { triggerTime: tomorrow.getTime(), title }
  }

  // 5. 匹配 "后天下午X点" / "后天"
  if (input.includes('后天')) {
    const tp = parseTimePeriod(input)
    const dayAfter = new Date(now)
    dayAfter.setDate(dayAfter.getDate() + 2)
    if (tp) {
      dayAfter.setHours(tp.hour, tp.minute, 0, 0)
    } else {
      dayAfter.setHours(9, 0, 0, 0)
    }
    const title = input
      .replace(/后天|提醒我|提醒|(上午|下午|晚上|早上)?\s*(\d{1,2})\s*[点:：]\s*(\d{0,2})/g, '')
      .trim() || '后天的事项'
    return { triggerTime: dayAfter.getTime(), title }
  }

  // 6. 匹配 "下午X点" / "上午X点" / "X点"
  const tp = parseTimePeriod(input)
  if (tp) {
    const target = new Date(now)
    target.setHours(tp.hour, tp.minute, 0, 0)
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1)
    }
    const title = input
      .replace(/(上午|下午|晚上|早上)?\s*(\d{1,2})\s*[点:：]\s*(\d{0,2})|提醒我|提醒/g, '')
      .trim() || '日程提醒'
    return { triggerTime: target.getTime(), title }
  }

  // 7. 匹配 "下周一" ~ "下周日" → 下周X 00:00
  const weekMatch = input.match(/下周([一二三四五六日天])/)
  if (weekMatch) {
    const dayMap: Record<string, number> = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0 }
    const targetDay = dayMap[weekMatch[1]!]!
    const target = new Date(now)
    const currentDay = target.getDay()
    let diff = targetDay - currentDay
    if (diff <= 0) diff += 7
    diff += 7 // 下周
    target.setDate(target.getDate() + diff)
    target.setHours(0, 0, 0, 0)
    const title = input.replace(/下周[一二三四五六日天]|提醒我|提醒/g, '').trim() || '下周日程'
    return { triggerTime: target.getTime(), title }
  }

  return null
}

// ============ 工具函数 ============

/** 二分查找：在已排序数组中找到插入位置 */
function binarySearchInsertPos(arr: EnhancedScheduleEvent[], time: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid]!.triggerTime < time) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

// ============ 日程管理器 ============

/** localStorage 存储键名 */
const STORAGE_KEY = 'spiritpal-schedules'
/** P3-1：一次性迁移标记（localStorage 种子 → sp_schedules_* 表） */
const DB_MIGRATED_KEY = 'spiritpal-schedules-db-migrated'
/** 保存防抖间隔 */
const SAVE_DEBOUNCE_MS = 300
/** 默认检查间隔（毫秒） */
const DEFAULT_CHECK_INTERVAL = 30000 // 30秒（比原来的60秒更灵敏）
/** 最小检查间隔（毫秒） */
const MIN_CHECK_INTERVAL = 5000

/**
 * 日程管理器类
 * 管理日程事件的增删改查、定时检查、提醒通知等功能
 *
 * 优化点：
 * 1. events 数组始终按 triggerTime 升序维护，二分查找插入，无需每次排序
 * 2. 实现提前提醒功能（reminderMinutes），记录已触发提醒避免重复
 * 3. 保存防抖减少 localStorage 写入
 * 4. 动态调整检查间隔（临近事件时更频繁检查）
 * 5. 更可靠的 ID 生成
 */
// ============ 日历数据源插件（A-8 / D-2 决策落地）============
// 说明：calendarIntegration 是 Node 侧参考适配器（依赖 child_process，无法在 webview 直接 import）。
// 本接口定义 webview 安全的插件契约；运行时需经 Tauri 命令桥接后，由外部注册适配器，
// scheduleManager 即可将外部日历事件汇入日程视图（统一在 SchedulePanel 展示）。

export interface CalendarSourceEvent {
  id: string
  title: string
  startTime: number
  endTime?: number
  description?: string
}

export interface CalendarSourceAdapter {
  /** 适配器唯一标识 */
  id: string
  /** 展示名（用于 UI 标注来源） */
  label: string
  /** 拉取指定时间范围内的事件 */
  fetchEvents(range: { start: number; end: number }): Promise<CalendarSourceEvent[]>
}

export interface ImportedCalendarEvent extends CalendarSourceEvent {
  /** 来源适配器 id */
  sourceId: string
  /** 来源展示名 */
  sourceLabel: string
}

export class ScheduleManager {
  /** 日程事件列表（始终按 triggerTime 升序排列） */
  private events: EnhancedScheduleEvent[] = []
  /** 定时检查器 ID */
  private checkTimer: number | null = null
  /** 状态变更监听器集合 */
  private listeners: Set<() => void> = new Set()
  /** 提醒触发监听器集合 */
  private reminderListeners: Set<(event: EnhancedScheduleEvent, isPreReminder?: boolean, minutesLeft?: number) => void> = new Set()
  /** 保存防抖定时器 */
  private saveTimer: number | null = null
  /** 是否有未保存的更改 */
  private dirty = false
  /** 日历数据源适配器列表（A-8 D-2） */
  private calendarAdapters: CalendarSourceAdapter[] = []

  /**
   * 构造函数
   * 初始化时从 localStorage 加载已保存的日程
   */
  constructor() {
    this.load()
  }

  /**
   * 从 localStorage 加载日程数据
   * 加载时自动清理超过 24 小时的已完成/取消事件
   */
  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        this.events = Array.isArray(parsed) ? parsed : []
        // 清理过期事件（超过24小时的已完成/取消事件）
        const cutoff = Date.now() - 86400000
        this.events = this.events.filter(
          (e) => e.status === 'pending' || e.triggerTime > cutoff,
        )
        // 加载后排序确保有序
        this.events.sort((a, b) => a.triggerTime - b.triggerTime)
      }
    } catch {
      this.events = []
    }
    // P3-1：接线 sp_schedules_* 表（此前命令与封装存在但无任何生产调用方，表为孤儿）
    void this.initDbSync()
  }

  /**
   * DB 同步（P3-1 接线）：
   * 1. 首次运行：以 localStorage 种子逐条 upsert 到 schedules 表（一次性迁移）；
   * 2. 已迁移且 localStorage 为空（清存储/换机/重装）：以 DB 为源恢复日程
   *    ——日程从此纳入 P1-4 的备份/加密体系，不再只活在 localStorage。
   * 删除已由 sp_schedules_delete 镜像（P3-1 收尾），不再有残留行复活问题。
   */
  private async initDbSync(): Promise<void> {
    try {
      const rows = await getSchedules()
      const migrated = localStorage.getItem(DB_MIGRATED_KEY) === '1'
      if (!migrated) {
        for (const e of this.events) this.mirrorToDb(e)
        localStorage.setItem(DB_MIGRATED_KEY, '1')
        return
      }
      if (this.events.length === 0 && rows.length > 0) {
        const restored = rows
          .map((row) => this.eventFromDbRow(row))
          .filter((e): e is EnhancedScheduleEvent => e !== null)
          .filter((e) => e.status === 'pending' || e.triggerTime > Date.now() - 86400000)
          .sort((a, b) => a.triggerTime - b.triggerTime)
        if (restored.length > 0) {
          this.events = restored
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.events))
          } catch {
            /* 忽略存储错误 */
          }
          this.notifyListeners()
          this.ensureChecking()
        }
      }
    } catch {
      // 非 Tauri / DB 不可用：维持 localStorage-only（原行为）
    }
  }

  /** 内存事件 → DB upsert（失败静默，不影响本地存储） */
  private mirrorToDb(e: EnhancedScheduleEvent): void {
    void saveSchedule({
      id: e.id,
      title: e.title,
      time: e.triggerTime,
      repeat: e.repeatRule ? JSON.stringify(e.repeatRule) : undefined,
      completed: e.status !== 'pending',
    }).catch(() => {
      /* DB 不可用时静默 */
    })
  }

  /** DB 行 → 内存事件（字段缺失/非法返回 null） */
  private eventFromDbRow(row: Record<string, unknown>): EnhancedScheduleEvent | null {
    const id = typeof row.id === 'string' ? row.id : null
    const title = typeof row.title === 'string' ? row.title : null
    const time = typeof row.time === 'number' ? row.time : null
    if (!id || !title || time === null) return null
    let repeatRule: EnhancedScheduleEvent['repeatRule'] | undefined
    if (typeof row.repeat === 'string' && row.repeat) {
      try {
        const parsed = JSON.parse(row.repeat) as EnhancedScheduleEvent['repeatRule']
        if (parsed && typeof parsed === 'object') repeatRule = parsed
      } catch {
        /* 非法 repeat 忽略 */
      }
    }
    const completed = row.completed === true
    return {
      id,
      title,
      triggerTime: time,
      repeatRule,
      reminderMinutes: [],
      firedReminders: [],
      status: completed ? 'completed' : 'pending',
      source: 'manual',
    }
  }

  /**
   * 防抖保存日程数据到 localStorage
   * 保存后通知所有监听器
   */
  private scheduleSave(): void {
    this.dirty = true
    if (this.saveTimer !== null) return
    this.saveTimer = window.setTimeout(() => {
      this.saveTimer = null
      this.doSave()
    }, SAVE_DEBOUNCE_MS)
  }

  /**
   * 立即保存（绕过防抖）
   */
  private forceSave(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.doSave()
  }

  /**
   * 执行实际保存操作
   */
  private doSave(): void {
    if (!this.dirty) return
    this.dirty = false
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.events))
    } catch {
      // 忽略存储错误
    }
    // P3-1：镜像到 schedules 表（每条 upsert，失败静默）
    for (const e of this.events) this.mirrorToDb(e)
    this.notifyListeners()
  }

  /**
   * 通知所有状态变更监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach((fn) => {
      try { fn() } catch { /* 监听器异常不影响主流程 */ }
    })
  }

  /**
   * 注册状态变更监听器
   * @param listener 状态变更时调用的回调函数
   * @returns 取消监听的函数
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // ============ 日历数据源插件（A-8 D-2）============

  /** 注册外部日历数据源（见 CalendarSourceAdapter 说明） */
  registerCalendarSource(adapter: CalendarSourceAdapter): void {
    if (this.calendarAdapters.some((a) => a.id === adapter.id)) return
    this.calendarAdapters.push(adapter)
    this.notifyListeners()
  }

  /** 注销外部日历数据源 */
  unregisterCalendarSource(id: string): void {
    const before = this.calendarAdapters.length
    this.calendarAdapters = this.calendarAdapters.filter((a) => a.id !== id)
    if (this.calendarAdapters.length !== before) this.notifyListeners()
  }

  /** 拉取所有已注册日历源的事件（按 startTime 升序），单个源异常不影响其它源 */
  async getImportedCalendarEvents(range?: { start: number; end: number }): Promise<ImportedCalendarEvent[]> {
    const now = Date.now()
    const r = range ?? { start: now - 7 * 86400000, end: now + 30 * 86400000 }
    const out: ImportedCalendarEvent[] = []
    for (const a of this.calendarAdapters) {
      try {
        const evs = await a.fetchEvents(r)
        for (const e of evs) {
          out.push({
            sourceId: a.id,
            sourceLabel: a.label,
            id: `${a.id}:${e.id}`,
            title: e.title,
            startTime: e.startTime,
            endTime: e.endTime,
            description: e.description,
          })
        }
      } catch {
        // 单个日历源异常不影响整体
      }
    }
    return out.sort((x, y) => x.startTime - y.startTime)
  }

  /**
   * 注册提醒触发监听器
   * @param listener 提醒触发时调用的回调函数，接收触发的日程事件、是否为提前提醒、剩余分钟数
   * @returns 取消监听的函数
   */
  onReminder(listener: (event: EnhancedScheduleEvent, isPreReminder?: boolean, minutesLeft?: number) => void): () => void {
    this.reminderListeners.add(listener)
    return () => this.reminderListeners.delete(listener)
  }

  // ============ 添加日程 ============

  /**
   * 添加新日程事件（使用二分插入维护有序性）
   * @param event 日程事件数据（不含 id 和 status，自动生成）
   * @returns 新创建的事件 ID
   */
  addEvent(event: Omit<EnhancedScheduleEvent, 'id' | 'status'>): string {
    const id = generateId('sched')
    const fullEvent: EnhancedScheduleEvent = {
      ...event,
      id,
      status: 'pending',
      firedReminders: [],
    }
    // 二分查找插入位置，保持 events 按 triggerTime 升序
    const pos = binarySearchInsertPos(this.events, fullEvent.triggerTime)
    this.events.splice(pos, 0, fullEvent)
    this.scheduleSave()
    this.ensureChecking()
    return id
  }

  /**
   * 从对话文本创建日程
   * 解析自然语言中的时间信息并创建日程事件
   * @param text 用户输入的自然语言文本
   * @param characterId 关联的角色 ID（可选）
   * @returns 创建的日程事件，解析失败返回 null
   */
  addFromChat(text: string, characterId?: string): EnhancedScheduleEvent | null {
    const parsed = parseScheduleFromText(text)
    if (!parsed) return null

    const id = this.addEvent({
      title: parsed.title,
      description: parsed.description,
      triggerTime: parsed.triggerTime,
      repeatRule: parsed.repeatRule,
      source: 'chat',
      characterId,
      reminderMinutes: [5],
    })

    return this.events.find((e) => e.id === id) ?? null
  }

  // ============ 管理 ============

  /**
   * 删除指定日程事件
   * @param id 要删除的事件 ID
   */
  removeEvent(id: string): void {
    const idx = this.events.findIndex((e) => e.id === id)
    if (idx !== -1) {
      this.events.splice(idx, 1)
      this.scheduleSave()
      // P3-1 收尾：DB 镜像删除（sp_schedules_delete），杜绝残留行在空恢复场景复活
      void deleteSchedule(id).catch(() => {
        /* DB 不可用时静默（本地已删，DB 残留仅影响空恢复边界场景） */
      })
    }
  }

  /**
   * 标记日程事件为已完成
   * @param id 要完成的事件 ID
   */
  completeEvent(id: string): void {
    const event = this.events.find((e) => e.id === id)
    if (event && event.status === 'pending') {
      event.status = 'completed'
      this.scheduleSave()
    }
  }

  /**
   * 取消日程事件
   * @param id 要取消的事件 ID
   */
  cancelEvent(id: string): void {
    const event = this.events.find((e) => e.id === id)
    if (event && event.status === 'pending') {
      event.status = 'cancelled'
      this.scheduleSave()
    }
  }

  /**
   * 获取所有日程事件（已按触发时间排序）
   * @returns 排序后的日程事件数组副本
   */
  getEvents(): EnhancedScheduleEvent[] {
    return [...this.events]
  }

  /**
   * 获取待处理的日程事件（状态为 pending 且触发时间在未来）
   * 遍历所有事件，跳过非 pending 和已过期的 pending 事件，只返回未来的 pending 事件
   * @returns 按触发时间排序的待处理事件数组
   */
  getPendingEvents(): EnhancedScheduleEvent[] {
    const now = Date.now()
    const result: EnhancedScheduleEvent[] = []
    for (const e of this.events) {
      if (e.status !== 'pending') continue
      if (e.triggerTime <= now) continue
      result.push(e)
    }
    return result
  }

  /**
   * 获取今天的日程事件
   * @returns 今天待处理的事件数组
   */
  getTodayEvents(): EnhancedScheduleEvent[] {
    const today = new Date().toDateString()
    const result: EnhancedScheduleEvent[] = []
    for (const e of this.events) {
      if (e.status !== 'pending') continue
      if (new Date(e.triggerTime).toDateString() !== today) continue
      result.push(e)
    }
    return result
  }

  // ============ 定时检查 ============

  /**
   * 计算下次检查的最佳间隔
   * 根据最近待处理事件的时间动态调整
   */
  private calculateNextCheckInterval(): number {
    const now = Date.now()
    let nearestDelta = Infinity

    for (const e of this.events) {
      if (e.status !== 'pending') continue
      if (e.triggerTime <= now) continue // 跳过已过期的 pending 事件（尚未被处理）
      const delta = e.triggerTime - now
      // 也检查提前提醒时间
      for (const min of e.reminderMinutes) {
        const remindAt = e.triggerTime - min * 60000
        if (remindAt > now) {
          const d = remindAt - now
          if (d < nearestDelta) nearestDelta = d
        }
      }
      if (delta < nearestDelta) nearestDelta = delta
    }

    if (nearestDelta === Infinity) return DEFAULT_CHECK_INTERVAL
    // 下次检查在最近事件前一点，最小间隔5秒，最大默认间隔
    return Math.max(MIN_CHECK_INTERVAL, Math.min(DEFAULT_CHECK_INTERVAL, Math.floor(nearestDelta / 2)))
  }

  /**
   * 确保定时检查器正在运行
   * 如果没有待处理事件则停止检查器
   */
  private ensureChecking(): void {
    // 如果已经有定时器在跑，不做处理（checkReminders会自动调整间隔）
    if (this.checkTimer !== null) return

    const hasPending = this.events.some((e) => e.status === 'pending')
    if (!hasPending) return

    // 存在已到期的待处理事件时，立即触发一次检查
    // （覆盖应用重启后错过触发时间的日程，确保它们被补处理）
    const hasDue = this.events.some((e) => e.status === 'pending' && e.triggerTime <= Date.now())
    if (hasDue) {
      this.checkTimer = window.setTimeout(() => {
        this.checkTimer = null
        this.checkReminders()
      }, 0)
      return
    }

    this.scheduleNextCheck()
  }

  /**
   * 安排下一次检查
   */
  private scheduleNextCheck(): void {
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer)
    }
    const interval = this.calculateNextCheckInterval()
    this.checkTimer = window.setTimeout(() => {
      this.checkTimer = null
      this.checkReminders()
    }, interval)
  }

  // ============ 系统通知 ============

  /**
   * 发送系统通知
   * 自动请求通知权限（如果尚未授权）
   * @param title 通知标题
   * @param body 通知内容
   */
  private async sendSystemNotification(title: string, body: string): Promise<void> {
    // 尊重用户设置里的「通知」开关。
    // 修复前该开关（settingsStore.notifications）两端都能改，但全仓无消费者 ——
    // 关掉通知后日程提醒照发，开关形同虚设。
    try {
      if (!useSettingsStore.getState().notifications) return
    } catch {
      // store 尚未就绪（极端启动时序）：按开启处理，不阻断通知
    }
    try {
      let granted = await isPermissionGranted()
      if (!granted) {
        const perm = await requestPermission()
        granted = perm === 'granted'
      }
      if (granted) {
        await sendNotification({ title, body })
      }
    } catch {
      // 通知发送失败时静默忽略（非 Tauri 环境或权限被拒）
    }
  }

  /**
   * 为重复日程创建下一次触发
   * 根据重复规则计算下一次触发时间并创建新事件
   * @param event 已触发的重复日程事件
   */
  private scheduleNextRepeat(event: EnhancedScheduleEvent): void {
    if (!event.repeatRule) return
    const next = new Date(event.triggerTime)
    switch (event.repeatRule.type) {
      case 'daily':
        next.setDate(next.getDate() + event.repeatRule.interval)
        break
      case 'weekly':
        next.setDate(next.getDate() + 7 * event.repeatRule.interval)
        break
      case 'monthly':
        next.setMonth(next.getMonth() + event.repeatRule.interval)
        break
      case 'yearly':
        next.setFullYear(next.getFullYear() + event.repeatRule.interval)
        break
    }
    const newEvent: EnhancedScheduleEvent = {
      ...event,
      id: generateId('sched'),
      triggerTime: next.getTime(),
      status: 'pending',
      firedReminders: [],
    }
    // 二分插入维护有序性
    const pos = binarySearchInsertPos(this.events, newEvent.triggerTime)
    this.events.splice(pos, 0, newEvent)
  }

  /**
   * 检查提醒
   * 遍历待处理事件，触发到期的提前提醒和正式提醒
   */
  private checkReminders(): void {
    const now = Date.now()
    const triggered: EnhancedScheduleEvent[] = []
    let hasChanges = false

    for (const event of this.events) {
      if (event.status !== 'pending') continue

      // 检查提前提醒
      if (event.reminderMinutes.length > 0) {
        const fired = event.firedReminders ?? (event.firedReminders = [])
        for (const minutes of event.reminderMinutes) {
          if (fired.includes(minutes)) continue
          const remindAt = event.triggerTime - minutes * 60000
          if (now >= remindAt) {
            fired.push(minutes)
            hasChanges = true
            // 提前提醒通知
            const minsText = minutes >= 60 ? `${Math.floor(minutes / 60)}小时${minutes % 60 > 0 ? minutes % 60 + '分钟' : ''}` : `${minutes}分钟`
            void this.sendSystemNotification(
              'SpiritPal 日程提醒',
              `${minsText}后：${event.title}${event.description ? ' — ' + event.description : ''}`,
            )
            this.reminderListeners.forEach((fn) => {
              try { fn(event, true, minutes) } catch { /* 监听器异常不影响主流程 */ }
            })
          }
        }
      }

      // 检查正式触发
      if (event.triggerTime <= now) {
        event.status = 'triggered'
        triggered.push(event)
        hasChanges = true
      }
    }

    // 处理已触发事件：发送系统通知 + 通知前端 + 安排重复
    for (const event of triggered) {
      // 系统通知
      void this.sendSystemNotification(
        'SpiritPal 日程提醒',
        `${event.title}${event.description ? ' — ' + event.description : ''}`,
      )
      // 通知前端监听器（触发宠物动画）
      this.reminderListeners.forEach((fn) => {
        try { fn(event, false, 0) } catch { /* 监听器异常不影响主流程 */ }
      })
      // 重复日程：创建下一次触发
      if (event.repeatRule) {
        this.scheduleNextRepeat(event)
      }
    }

    if (hasChanges || triggered.length > 0) {
      this.scheduleSave()
    }

    // 检查是否还有待处理事件
    const hasPending = this.events.some((e) => e.status === 'pending' && e.triggerTime > now)
    if (hasPending) {
      this.scheduleNextCheck()
    }
  }

  /**
   * 启动日程管理器
   * 开始定时检查提醒
   */
  start(): void {
    this.ensureChecking()
  }

  /**
   * 停止日程管理器
   * 清除定时检查器
   */
  stop(): void {
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer)
      this.checkTimer = null
    }
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    // 停止前强制保存
    if (this.dirty) {
      this.doSave()
    }
  }

  /**
   * 销毁实例：清理所有定时器和监听器，并重置单例
   */
  destroy(): void {
    this.stop()
    this.listeners.clear()
    this.reminderListeners.clear()
    if (sharedMgr === this) {
      sharedMgr = null
    }
  }

  /**
   * dispose 是 destroy 的别名，保持 API 一致性
   */
  dispose(): void {
    this.destroy()
  }
}

// ============ 单例 ============

/** 全局单例实例 */
let sharedMgr: ScheduleManager | null = null

/**
 * 获取日程管理器单例实例
 * @returns ScheduleManager 实例
 */
export function getScheduleManager(): ScheduleManager {
  if (!sharedMgr) {
    sharedMgr = new ScheduleManager()
  }
  return sharedMgr
}
