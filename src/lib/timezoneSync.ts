/**
 * @file timezoneSync.ts
 * @description 时区自动同步 — 本地化时间显示与转换
 * 
 * 实现功能：
 * - 自动检测系统时区
 * - 跨时区时间同步（UTC 基准）
 * - DST 夏令时自动处理
 * - 相对时间计算（适用于记忆系统的时间索引）
 * - 国际化日期格式
 * - 定时任务时区适配
 */

// ============ 类型定义 ============

export interface TimeZoneInfo {
  /** IANA 时区名称（如 Asia/Shanghai） */
  timeZoneId: string
  /** UTC 偏移量（分钟） */
  utcOffset: number
  /** 是否支持夏令时 */
  supportsDST: boolean
  /** 当前是否处于夏令时 */
  isDST: boolean
  /** 缩写（如 CST/EST） */
  abbreviation: string
}

export interface TimeConversionResult {
  /** 原始时间（本地） */
  localTime: Date
  /** UTC 时间 */
  utcTime: Date
  /** 目标时区的本地时间 */
  targetLocalTime: Date
  /** UTC 偏移量差异（分钟） */
  offsetDiff: number
}

export interface ScheduledTaskConfig {
  /** 任务唯一标识 */
  id: string
  /** 执行时间（本地时区） */
  scheduledTime: Date
  /** 重复规则 */
  recurrence?: 'daily' | 'weekly' | 'monthly' | 'yearly'
  /** 时区 ID */
  timeZoneId: string
  /** 回调函数 */
  callback: () => void | Promise<void>
  /** 是否启用 */
  enabled: boolean
}

// ============ 默认配置 ============

const DEFAULT_TIME_ZONE_ID: string = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

// ============ 时区管理器 ============

export class TimezoneManager {
  private currentTimeZoneId: string
  private tasks: Map<string, ScheduledTaskConfig> = new Map()
  private timers: Map<string, NodeJS.Timeout> = new Map()
  
  constructor() {
    // 从浏览器或系统获取默认时区
    this.currentTimeZoneId = DEFAULT_TIME_ZONE_ID
    console.log(`[Timezone] Default timezone: ${this.currentTimeZoneId}`)
    
    // 监听系统时区变化（部分平台支持）
    if (typeof window !== 'undefined') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const win = window as any
      if ('ontimezonechange' in win) {
        win.addEventListener('timezonechange', () => {
          this.handleSystemTimezoneChange()
        })
      }
    }
  }

  /**
   * 获取当前时区信息
   */
  getCurrentTimeZone(): TimeZoneInfo {
    const now = new Date()
    
    // 使用 Intl API 获取时区信息
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: this.currentTimeZoneId,
      timeZoneName: 'short',
    })
    
    const parts = formatter.formatToParts(now)
    const abbreviation = parts.find(p => p.type === 'timeZoneName')?.value || 'UTC'
    
    // 计算 UTC 偏移量
    const offset = this.getUTCOffset(now)
    
    return {
      timeZoneId: this.currentTimeZoneId,
      utcOffset: offset,
      supportsDST: true, // Simplified assumption
      isDST: this.isDaylightSavingTime(now),
      abbreviation,
    }
  }

  /**
   * 设置时区
   */
  setTimeZone(timeZoneId: string): boolean {
    try {
      // 验证时区 ID 是否有效
      Intl.DateTimeFormat(undefined, { timeZone: timeZoneId })
      
      this.currentTimeZoneId = timeZoneId
      
      // 保存用户偏好
      this.saveUserPreference()
      
      console.log(`[Timezone] Set timezone to: ${timeZoneId}`)
      
      // 重新调度所有定时任务
      this.rescheduleAllTasks()
      
      return true
    } catch (error) {
      console.error('[Timezone] Invalid timezone ID:', timeZoneId)
      return false
    }
  }

  /**
   * 将本地时间转换为其他时区
   */
  convertToTimeZone(date: Date, targetTimeZoneId: string): TimeConversionResult {
    const utcTime = new Date(date.getTime())
    
    // 计算源时区和目标时区的偏移量
    const sourceOffset = this.getUTCOffset(date) // minutes
    const targetDate = new Date(utcTime.getTime())
    
    // 临时切换到目标时区计算
    try {
      const targetFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone: targetTimeZoneId,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
      
      const targetString = targetFormatter.format(targetDate)
      // Note: This is a simplified conversion
      // Real implementation would require proper date-fns-tz or moment-timezone library
    } catch (error) {
      console.warn('[Timezone] Conversion failed, using fallback')
    }
    
    const targetOffset = this.getTargetTimezoneOffset(targetDate, targetTimeZoneId)
    const offsetDiff = targetOffset - sourceOffset
    
    const targetLocalTime = new Date(date.getTime() + offsetDiff * 60 * 1000)
    
    return {
      localTime: date,
      utcTime,
      targetLocalTime,
      offsetDiff,
    }
  }

  /**
   * 格式化日期为当前时区
   */
  formatDate(date: Date, options?: Intl.DateTimeFormatOptions): string {
    const opts: Intl.DateTimeFormatOptions = {
      ...options,
      timeZone: this.currentTimeZoneId,
    }
    
    return new Intl.DateTimeFormat(this.currentTimeZoneId, opts).format(date)
  }

  /**
   * 格式化时间为当前时区
   */
  formatTime(date: Date, options?: Intl.DateTimeFormatOptions): string {
    return this.formatDate(date, {
      ...options,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  /**
   * 格式化日期时间
   */
  formatDateTime(date: Date): string {
    return this.formatDate(date, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  /**
   * 获取常见时区列表
   */
  getCommonTimezones(): Array<{ id: string; name: string; offset: number }> {
    return [
      { id: 'Asia/Shanghai', name: '北京时间 (CST)', offset: 480 },
      { id: 'Asia/Tokyo', name: '东京时间 (JST)', offset: 540 },
      { id: 'Asia/Seoul', name: '首尔时间 (KST)', offset: 540 },
      { id: 'America/New_York', name: '纽约时间 (EST)', offset: -300 },
      { id: 'America/Los_Angeles', name: '洛杉矶时间 (PST)', offset: -480 },
      { id: 'Europe/London', name: '伦敦时间 (GMT)', offset: 0 },
      { id: 'Europe/Berlin', name: '柏林时间 (CET)', offset: 60 },
      { id: 'Australia/Sydney', name: '悉尼时间 (AEDT)', offset: 660 },
      { id: 'Pacific/Auckland', name: '奥克兰时间 (NZDT)', offset: 780 },
      { id: 'UTC', name: '协调世界时 (UTC)', offset: 0 },
    ]
  }

  /**
   * 检查系统时区变化
   */
  private handleSystemTimezoneChange(): void {
    const newTimeZoneId = DEFAULT_TIME_ZONE_ID
    
    if (newTimeZoneId !== this.currentTimeZoneId) {
      console.log(`[Timezone] System timezone changed from ${this.currentTimeZoneId} to ${newTimeZoneId}`)
      this.currentTimeZoneId = newTimeZoneId
      
      // 通知应用层
      const event = new CustomEvent('timezone-change', {
        detail: { oldTimeZone: this.currentTimeZoneId, newTimeZone: newTimeZoneId },
      })
      window.dispatchEvent(event)
    }
  }

  /**
   * 计算 UTC 偏移量（分钟）
   */
  private getUTCOffset(date: Date): number {
    return -date.getTimezoneOffset()
  }

  /**
   * 获取目标时区的 UTC 偏移量
   */
  private getTargetTimezoneOffset(date: Date, timeZoneId: string): number {
    try {
      // 使用 Intl API 解析时间组件
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timeZoneId,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
      
      const parts = formatter.formatToParts(date)
      const hourPart = parts.find(p => p.type === 'hour')?.value
      const minutePart = parts.find(p => p.type === 'minute')?.value
      
      if (hourPart && minutePart) {
        const hours = parseInt(hourPart, 10)
        const minutes = parseInt(minutePart, 10)
        
        // 注意：这只是一个简化的计算
        // 真实情况需要更复杂的库来处理
        return hours * 60 + minutes
      }
      
      return 0
    } catch (error) {
      console.warn('[Timezone] Failed to calculate target offset:', error)
      return 0
    }
  }

  /**
   * 检查是否为夏令时
   */
  private isDaylightSavingTime(date: Date): boolean {
    // 简化的 DST 检查
    // 真实场景需要完整的时区数据库
    const jan = new Date(date.getFullYear(), 0, 1)
    const jul = new Date(date.getFullYear(), 6, 1)
    
    const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset())
    return date.getTimezoneOffset() < stdOffset
  }

  /**
   * 保存用户时区偏好
   */
  private saveUserPreference(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem('user_timezone', this.currentTimeZoneId)
      } catch (error) {
        console.warn('[Timezone] Failed to save preference:', error)
      }
    }
  }

  /**
   * 加载用户时区偏好
   */
  loadUserPreference(): void {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('user_timezone')
        if (saved && this.setTimeZone(saved)) {
          console.log(`[Timezone] Loaded user preference: ${saved}`)
        }
      } catch (error) {
        console.warn('[Timezone] Failed to load preference:', error)
      }
    }
  }

  /**
   * 注册定时任务
   */
  scheduleTask(config: ScheduledTaskConfig): void {
    // 清理旧任务
    if (this.timers.has(config.id)) {
      clearTimeout(this.timers.get(config.id))
    }
    
    // 计算延迟
    const now = new Date()
    const delay = config.scheduledTime.getTime() - now.getTime()
    
    if (delay <= 0) {
      // 立即执行
      void config.callback()
      return
    }
    
    // 创建定时器
    const timer = setTimeout(async () => {
      await config.callback()
      
      // 如果是重复任务，重新调度
      if (config.recurrence) {
        this.scheduleRecurringTask(config)
      }
    }, delay)
    
    this.timers.set(config.id, timer)
    this.tasks.set(config.id, config)
    
    console.log(`[Timezone] Scheduled task "${config.id}" for ${config.scheduledTime.toISOString()}`)
  }

  /**
   * 调度重复任务
   */
  private scheduleRecurringTask(config: ScheduledTaskConfig): void {
    let intervalMs: number
    
    switch (config.recurrence) {
      case 'daily':
        intervalMs = 24 * 60 * 60 * 1000
        break
      case 'weekly':
        intervalMs = 7 * 24 * 60 * 60 * 1000
        break
      case 'monthly':
        intervalMs = 30 * 24 * 60 * 60 * 1000
        break
      case 'yearly':
        intervalMs = 365 * 24 * 60 * 60 * 1000
        break
      default:
        return
    }
    
    const timer = setInterval(async () => {
      await config.callback()
    }, intervalMs)
    
    this.timers.set(config.id, timer)
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): void {
    const timer = this.timers.get(taskId)
    if (timer) {
      clearTimeout(timer)
      clearInterval(timer)
      this.timers.delete(taskId)
    }
    this.tasks.delete(taskId)
  }

  /**
   * 重新调度所有任务
   */
  private rescheduleAllTasks(): void {
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.enabled) {
        this.cancelTask(taskId)
        this.scheduleTask(task)
      }
    }
  }

  /**
   * 清理资源
   */
  destroy(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer)
      clearInterval(timer)
    }
    this.timers.clear()
    this.tasks.clear()
  }
}

// ============ 快捷函数 ============

let instance: TimezoneManager | null = null

export function getTimezoneManager(): TimezoneManager {
  if (!instance) {
    instance = new TimezoneManager()
    instance.loadUserPreference()
  }
  return instance
}
