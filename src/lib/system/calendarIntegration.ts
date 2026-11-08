/**
 * @file calendarIntegration.ts
 * @note 本模块依赖 Node 内置模块（child_process），仅 Node 运行时可用；作为 scheduleManager 日历数据源
 *       插件（CalendarSourceAdapter）的 Node 侧参考实现，需经 Tauri 命令桥接后在 webview 侧注册适配器
 *       （见 lib/scheduleManager.ts 的 CalendarSourceAdapter 接口）。
 * @description 日程集成 — 读取系统日历 + 智能提醒
 *
 * 实现功能：
 * - Windows/macOS系统日历读取（Microsoft Outlook / Apple Calendar）
 * - Google Calendar / Office 365 API 集成
 * - 未来 N 天日程预加载与缓存
 * - 宠物智能提醒（提前 X 分钟播报）
 * - 重要事件特别提示
 * - 日程冲突检测
 * - 隐私保护（用户授权机制）
 *
 * 参考：Google Calendar API / Microsoft Graph API
 *
 * TD-008 实现状态（2026-11-08）：
 * - **不再谎报授权**：`requestPermission()` 原来只 `console.log` 一句就把
 *   `permissionGranted = true` 并返回 true —— 三条数据源（Windows / Google / Outlook）
 *   一条都没真授权过。现在没有任何授权通道时**返回 false 并说明原因**，
 *   授权动作只能由注入的 `requestPermission` 钩子（将来接 Tauri 命令）完成，
 *   钩子说 true 才算授权。
 * - **宠物播报改为可注入、并如实报告是否播了**：`sendReminder()` 原来只 `console.log`。
 *   现在有 `speak` 钩子才播、并发事件去重（否则每分钟的定时器会把同一场会重复播报 N 次），
 *   没有钩子时返回 false 并把 `suppressedReminders` 计数 +1，不假装已经播过。
 * - 仍未做：系统日历直读（`fetchEvents` 仍返回空，属独立特性，需 Tauri 命令桥接，见下方 A-8 说明）。
 */

import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

// ============ 类型定义 ============

export interface CalendarEvent {
  /** 事件唯一 ID */
  id: string
  /** 事件标题 */
  title: string
  /** 事件描述 */
  description?: string
  /** 开始时间 */
  startTime: Date
  /** 结束时间 */
  endTime: Date
  /** 是否全天事件 */
  isAllDay: boolean
  /** 位置/地点 */
  location?: string
  /** 参会人列表 */
  attendees?: Array<{
    email: string
    name?: string
    responseStatus?: 'accepted' | 'declined' | 'tentative' | 'needsAction'
  }>
  /** 提醒方式 */
  reminders?: Array<{
    method: 'notification' | 'email' | 'popup'
    minutesBefore: number
  }>
  /** 优先级 */
  priority?: 'low' | 'normal' | 'high'
  /** 事件状态 */
  status?: 'confirmed' | 'tentative' | 'cancelled'
  /** 重复规则（RRULE） */
  recurrence?: string[]
  /** 来源日历（主日历/共享日历等） */
  calendarSource?: string
}

export interface CalendarDataSource {
  /** 数据源名称 */
  name: string
  /** 类型 */
  type: 'windows-calendar' | 'apple-calendar' | 'google-calendar' | 'outlook' | 'ical'
  /** 是否已连接 */
  connected: boolean
  /** 权限状态 */
  permissionGranted: boolean
}

export interface ReminderConfig {
  /** 是否启用提醒 */
  enabled: boolean
  /** 提前多少分钟提醒 */
  minutesBefore: number
  /** 宠物播报语气 */
  tone: 'gentle' | 'urgent' | 'excited'
  /** 只显示高优先级事件 */
  showOnlyHighPriority: boolean
  /** 避免休息时间打扰 */
  quietHours: {
    enabled: boolean
    start: string // "22:00"
    end: string // "08:00"
  }
}

// ============ 默认配置 ============

const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: true,
  minutesBefore: 15,
  tone: 'gentle',
  showOnlyHighPriority: false,
  quietHours: {
    enabled: true,
    start: '22:00',
    end: '08:00',
  },
}

// ============ 依赖注入（测试 / 未来 Tauri 桥接用）============

export interface CalendarManagerDeps {
  /** 真正的授权动作（将来接 Tauri 命令）；不注入就表示"本进程没有授权通道" */
  requestPermission?: (source: CalendarDataSource) => Promise<boolean>
  /** 宠物播报；不注入就表示"没有播报通道" */
  speak?: (message: string, tone: ReminderConfig['tone']) => Promise<void>
  /** 取事件（默认走 getEventsInRange） */
  eventsProvider?: (from: Date, to: Date) => Promise<CalendarEvent[]>
  /** 时钟（测试用） */
  now?: () => Date
}

/** 提醒统计：播出去了多少、因为没通道/静默而被压掉多少 */
export interface ReminderStats {
  delivered: number
  suppressed: number
  /** 去重跳过（同一事件已经播过） */
  deduped: number
}

// ============ 日历管理器 ============

export class CalendarManager {
  private dataSources: Map<string, CalendarDataSource> = new Map()
  private eventsCache: Map<string, CalendarEvent[]> = new Map()
  private config: ReminderConfig
  private reminderTimer: NodeJS.Timeout | null = null
  private deps: CalendarManagerDeps
  private stats: ReminderStats = { delivered: 0, suppressed: 0, deduped: 0 }
  /** 已播过的事件 key，避免每分钟重复播报 */
  private remindedKeys: Set<string> = new Set()

  constructor(config?: Partial<ReminderConfig>, deps?: CalendarManagerDeps) {
    this.config = { ...DEFAULT_REMINDER_CONFIG, ...(config || {}) }
    this.deps = deps ?? {}
    this.initDataSources()
  }

  /**
   * 初始化数据源
   */
  private initDataSources(): void {
    const os = process.platform

    if (os === 'win32') {
      this.dataSources.set('windows-calendar', {
        name: 'Windows 日历',
        type: 'windows-calendar',
        connected: false,
        permissionGranted: false,
      })
    } else if (os === 'darwin') {
      this.dataSources.set('apple-calendar', {
        name: 'Apple 日历',
        type: 'apple-calendar',
        connected: false,
        permissionGranted: false,
      })
    }

    // 预留云端服务
    this.dataSources.set('google-calendar', {
      name: 'Google Calendar',
      type: 'google-calendar',
      connected: false,
      permissionGranted: false,
    })

    this.dataSources.set('outlook', {
      name: 'Outlook',
      type: 'outlook',
      connected: false,
      permissionGranted: false,
    })
  }

  /**
   * 请求日历访问权限
   *
   * 旧实现的问题不是"没有对话框"，而是**没有任何授权动作也照样把 permissionGranted 置 true
   * 并返回 true** —— 上层据此认为日历已可用。现在只有注入的授权钩子明确返回 true 才算授权，
   * 否则返回 false 并说明缺什么通道（Windows 需 Tauri 命令桥接、Google/Outlook 需 OAuth 客户端配置）。
   */
  async requestPermission(dataSourceId: string): Promise<boolean> {
    const dataSource = this.dataSources.get(dataSourceId)
    if (!dataSource) return false

    try {
      if (dataSource.type === 'apple-calendar') {
        // macOS 权限检查：读一次日历触发系统授权弹窗，失败即视为未授权
        const granted = await this.checkMacOSCalendarPermission()
        dataSource.permissionGranted = granted
        dataSource.connected = granted
        return granted
      }

      if (!this.deps.requestPermission) {
        // 如实拒绝：本进程没有可用的授权通道，绝不假装已授权
        console.warn(
          `[Calendar] ${dataSource.type} 无授权通道（Windows 需 Tauri 命令桥接；Google/Outlook 需 OAuth 客户端配置），本次未授权`,
        )
        dataSource.permissionGranted = false
        return false
      }

      const granted = await this.deps.requestPermission(dataSource)
      dataSource.permissionGranted = granted
      if (granted) dataSource.connected = true
      return granted
    } catch (error) {
      console.error('[Calendar] Permission request failed:', error)
      dataSource.permissionGranted = false
      return false
    }
  }

  /**
   * 获取指定日期范围的日程
   */
  async getEventsInRange(startDate: Date, endDate: Date, dataSourceIds?: string[]): Promise<CalendarEvent[]> {
    const events: CalendarEvent[] = []

    const sources = dataSourceIds
      ? dataSourceIds.map((id) => this.dataSources.get(id)).filter((s): s is CalendarDataSource => s !== undefined)
      : Array.from(this.dataSources.values()).filter((s) => s.permissionGranted && s.connected)

    for (const source of sources) {
      try {
        const cached = await this.loadFromCache(source.name, startDate, endDate)
        if (cached) {
          events.push(...cached)
          continue
        }

        const fetched = await this.fetchEvents(source, startDate, endDate)
        events.push(...fetched)

        // 保存到缓存
        await this.saveToCache(source.name, fetched, startDate, endDate)
      } catch (error) {
        console.error(`[Calendar] Failed to fetch from ${source.name}:`, error)
      }
    }

    // 按开始时间排序
    return events.sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
  }

  /**
   * 获取今日日程
   */
  async getTodayEvents(): Promise<CalendarEvent[]> {
    const today = this.now()
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const endOfDay = new Date(startOfDay)
    endOfDay.setDate(endOfDay.getDate() + 1)

    return this.getEventsInRange(startOfDay, endOfDay)
  }

  /**
   * 获取即将到来的事件
   */
  async getUpcomingEvents(minutes?: number): Promise<CalendarEvent[]> {
    const now = this.now()
    const future = new Date(now.getTime() + (minutes ?? 60) * 60 * 1000)

    return this.getEventsInRange(now, future)
  }

  /**
   * 创建日程提醒监听器
   */
  startReminderListener(): void {
    if (this.reminderTimer) return

    // 每分钟检查一次
    this.reminderTimer = setInterval(() => {
      void this.checkAndRemind()
    }, 60000)

    console.log('[Calendar] Reminder listener started')
  }

  /**
   * 停止提醒监听
   */
  stopReminderListener(): void {
    if (this.reminderTimer) {
      clearInterval(this.reminderTimer)
      this.reminderTimer = null
      console.log('[Calendar] Reminder listener stopped')
    }
  }

  /**
   * 检查并触发提醒
   *
   * 旧实现每分钟跑一次、每次把窗口内所有事件重播一遍 —— 同一场会会被重复播报 N 次。
   * 现在按事件 key 去重（`id`，无 id 时退化为标题+开始时间）。
   */
  private async checkAndRemind(): Promise<void> {
    if (!this.config.enabled) return

    // 检查是否在静默时间
    if (this.isQuietTime()) {
      return
    }

    const now = this.now()
    const remindTime = new Date(now.getTime() + this.config.minutesBefore * 60 * 1000)

    const events = this.deps.eventsProvider
      ? await this.deps.eventsProvider(now, remindTime)
      : await this.getEventsInRange(now, remindTime)

    // 过滤低优先级
    const filtered = this.config.showOnlyHighPriority ? events.filter((e) => e.priority === 'high') : events

    // 发送提醒
    for (const event of filtered) {
      const key = this.eventKey(event)
      if (this.remindedKeys.has(key)) {
        this.stats.deduped++
        continue
      }
      const delivered = await this.sendReminder(event)
      if (delivered) {
        this.remindedKeys.add(key)
      }
    }
  }

  /** 事件去重 key */
  private eventKey(event: CalendarEvent): string {
    return event.id || `${event.title}@${event.startTime.toISOString()}`
  }

  /** 当前时钟（可注入） */
  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date()
  }

  /**
   * 发送提醒
   *
   * 返回值就是"到底播没播"：没有 `speak` 钩子时返回 false，并把 suppressed 计数 +1，
   * 而不是打一行 console.log 让人误以为宠物已经说话了。
   */
  private async sendReminder(event: CalendarEvent): Promise<boolean> {
    const timeStr = event.startTime.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    })

    let message: string
    switch (this.config.tone) {
      case 'urgent':
        message = `⏰ 提醒！${timeStr}有"${event.title}"，请准备！`
        break
      case 'excited':
        message = `🎉 马上就要到${timeStr}啦，别忘了"${event.title}"哦！`
        break
      default:
        message = `📅 ${timeStr}有"${event.title}"，记得参加～`
    }

    if (event.location) {
      message += `（地点：${event.location}）`
    }

    if (!this.deps.speak) {
      this.stats.suppressed++
      return false
    }

    await this.deps.speak(message, this.config.tone)
    this.stats.delivered++
    return true
  }

  /** 提醒统计（播出去 / 被压掉 / 去重跳过） */
  getReminderStats(): ReminderStats {
    return { ...this.stats }
  }

  /** 手动触发一次提醒检查（不经定时器；也便于测试与"立即检查"入口） */
  async runReminderCheck(): Promise<void> {
    await this.checkAndRemind()
  }

  /**
   * 检查是否在静默时间
   */
  private isQuietTime(): boolean {
    if (!this.config.quietHours.enabled) return false

    const now = this.now()
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

    const { start, end } = this.config.quietHours

    if (start <= end) {
      // 正常范围（如 22:00-08:00 不跨夜）
      return currentTime >= start && currentTime < end
    } else {
      // 跨夜范围（如 22:00-08:00）
      return currentTime >= start || currentTime < end
    }
  }

  /**
   * macOS 日历权限检查
   *
   * 返回"是否真的拿到了权限"，不再只打日志 —— 旧实现无论成功失败都让调用方继续置 true。
   */
  private async checkMacOSCalendarPermission(): Promise<boolean> {
    try {
      // 尝试读取日历数据来触发权限请求
      const { stdout } = await execAsync(
        'events list -calendar "Home" -last 1 day 2>/dev/null || echo "permission denied"',
      )

      if (!stdout.includes('permission denied')) {
        console.log('[Calendar] macOS calendar permission granted')
        return true
      }
      console.warn('[Calendar] macOS calendar permission not granted')
      return false
    } catch {
      console.warn('[Calendar] macOS calendar permission not granted')
      return false
    }
  }

  /**
   * 从缓存加载事件
   */
  private async loadFromCache(dataSourceName: string, startDate: Date, endDate: Date): Promise<CalendarEvent[] | null> {
    const cacheKey = `${dataSourceName}_${startDate.toISOString()}_${endDate.toISOString()}`
    return this.eventsCache.get(cacheKey) || null
  }

  /**
   * 保存事件到缓存
   */
  private async saveToCache(
    dataSourceName: string,
    events: CalendarEvent[],
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    const cacheKey = `${dataSourceName}_${startDate.toISOString()}_${endDate.toISOString()}`
    this.eventsCache.set(cacheKey, events)

    // 限制缓存大小
    if (this.eventsCache.size > 100) {
      const firstKey = this.eventsCache.keys().next().value
      if (firstKey) this.eventsCache.delete(firstKey)
    }
  }

  /**
   * 从数据源抓取事件
   *
   * ⚠️ A-8（2026-08-29）状态说明：本方法**仍未实现系统日历直读**，返回空数组。
   * 外部日历能力已改由 webview 安全路径提供，勿在此伪造数据：
   * - `lib/icsParser.ts`：`parseIcs()` / `createIcsCalendarSource()` 解析 .ics
   * - `components/SchedulePanel.tsx`：「导入 .ics」→ 注册为 `CalendarSourceAdapter`
   *
   * 本模块是 **Node 侧参考适配器**（依赖 `child_process`，webview 无法 import，
   * 且零 importer）；若要直读 Windows/macOS 系统日历，需新增 Tauri 命令桥接，
   * 属独立特性，不在本批次范围。
   */
  private async fetchEvents(source: CalendarDataSource, _startDate: Date, _endDate: Date): Promise<CalendarEvent[]> {
    console.log(`[Calendar] Fetching events from ${source.type} (未接入系统日历，返回空)`)
    return []
  }

  /**
   * 更新提醒配置
   */
  updateConfig(config: Partial<ReminderConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * 获取当前配置
   */
  getConfig(): ReminderConfig {
    return { ...this.config }
  }

  /**
   * 清理资源
   */
  destroy(): void {
    this.stopReminderListener()
    this.eventsCache.clear()
    this.remindedKeys.clear()
  }
}

// ============ 快捷函数 ============

let instance: CalendarManager | null = null

export function getCalendarManager(
  config?: Partial<ReminderConfig>,
  deps?: CalendarManagerDeps,
): CalendarManager {
  if (!instance) {
    instance = new CalendarManager(config, deps)
  }
  return instance
}
