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
import { generateId } from './commonUtils'

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
