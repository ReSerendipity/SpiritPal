/**
 * 情境感知引擎 — 工作状态检测 + 通知推送 + 天气/音乐/网络感知
 * PRD §7.6 F5 桌面功能扩展
 *
 * @fileoverview
 * 主要模块：
 * - WorkState 类型：工作状态（idle/working/resting/away/coding/meeting/browsing/unknown）
 * - WorkStateInfo 接口：工作状态信息（空闲时间/工作时间/休息提醒/喝水提醒/天气/音乐/网络）
 * - NetworkState/NetworkChangeEvent：网络状态类型
 * - ContextAwarenessManager 类：情境感知管理器（单例），支持工作状态检测、提醒、天气/音乐/网络感知
 *
 * 功能：
 * 1. 系统空闲检测（Rust 端 get_idle_time）
 * 2. 工作状态感知（长时间工作 → 提醒休息）
 * 3. 柔性提醒（通过宠物行为而非弹窗）
 * 4. 通知推送（Tauri notification 插件或气泡）
 * 5. 天气感知（委托给 weatherAwareness）
 * 6. 音乐感知（委托给 musicAwareness）
 * 7. 网络状态感知（online/offline 监听）
 *
 * @module contextAwareness
 * @requires @tauri-apps/api/core - Tauri invoke
 * @requires ./weatherAwareness - 天气感知模块
 * @requires ./musicAwareness - 音乐感知模块
 */

import { invoke } from '@tauri-apps/api/core'
import {
  getWeatherAwarenessManager,
  type WeatherInfo,
  type WeatherBehavior,
} from './weatherAwareness'
import {
  getMusicAwarenessManager,
  type MusicStatus,
} from './musicAwareness'

// ============ 工作状态 ============

export type WorkState = 'idle' | 'working' | 'resting' | 'away' | 'coding' | 'meeting' | 'browsing' | 'unknown'

export interface WorkStateInfo {
  state: WorkState
  idleMinutes: number
  workMinutes: number  // 连续工作时间
  lastBreakAt: number
  shouldRemindRest: boolean
  shouldRemindDrink: boolean
  // 情境感知扩展字段（F1.3 / F5.2 / F5.4）
  weather: WeatherInfo | null
  weatherBehavior: WeatherBehavior | null
  musicPlaying: boolean
  music: MusicStatus | null
  online: boolean
}

// ============ 网络状态类型 ============

export type NetworkState = 'online' | 'offline'

export interface NetworkChangeEvent {
  online: boolean
}

// ============ 活跃窗口匹配规则 ============
// PRD §7.6 F1.3 / F5.3 工作状态感知
// 根据前台窗口标题和进程名匹配用户当前工作场景
// [P2-14] 增加进程名匹配，提升跨平台兼容性：
//   macOS: osascript 返回应用名（如 "Code" 而非 "Visual Studio Code"）
//   Linux: xdotool 返回进程名（如 "code" 而非 "Visual Studio Code"）

interface WindowMatchRule {
  /// 窗口标题关键词（匹配 title 字段）
  titleKeywords: string[]
  /// 进程名关键词（匹配 process_name 字段，跨平台更可靠）
  processKeywords: string[]
  state: WorkState
}

const WINDOW_MATCH_RULES: WindowMatchRule[] = [
  {
    titleKeywords: ['Visual Studio Code', 'IntelliJ', 'WebStorm', 'PyCharm', 'Eclipse', 'Atom', 'Sublime'],
    processKeywords: ['Code', 'code', 'idea', 'webstorm', 'pycharm', 'eclipse', 'atom', 'sublime_text', 'cursor'],
    state: 'coding',
  },
  {
    titleKeywords: ['Zoom', 'Teams', '腾讯会议', '钉钉', '飞书', 'Google Meet', 'Slack'],
    processKeywords: ['zoom', 'Teams', 'teams', 'WeMeet', 'DingTalk', 'Lark', 'Feishu', 'slack'],
    state: 'meeting',
  },
  {
    titleKeywords: ['Chrome', 'Firefox', 'Edge', 'Safari'],
    processKeywords: ['chrome', 'firefox', 'msedge', 'safari', 'Safari', 'brave', 'Brave', 'arc', 'Arc'],
    state: 'browsing',
  },
]

// ============ 情境感知管理器 ============

export class ContextAwarenessManager {
  private idleCheckTimer: number | null = null
  private listeners: Set<(info: WorkStateInfo) => void> = new Set()
  private currentState: WorkState = 'idle'
  private workStartAt: number = 0
  private lastBreakAt: number = Date.now()
  private lastDrinkRemind: number = 0
  private lastRestRemind: number = 0
  private lastIdleMinutes: number = 0

  // 网络状态
  private online: boolean = typeof navigator !== 'undefined' ? navigator.onLine : true
  private networkListeners: Set<(event: NetworkChangeEvent) => void> = new Set()
  private onlineHandler: (() => void) | null = null
  private offlineHandler: (() => void) | null = null

  // 天气/音乐感知（委托给独立管理器）
  private weatherMgr = getWeatherAwarenessManager()
  private musicMgr = getMusicAwarenessManager()
  private cachedWeather: WeatherInfo | null = null
  private cachedWeatherBehavior: WeatherBehavior | null = null
  private cachedMusic: MusicStatus | null = null
  // 保存天气/音乐取消订阅函数，在 stop() 中清理
  private unsubWeather: (() => void) | null = null
  private unsubMusic: (() => void) | null = null

  // 活跃窗口检测（F1.3 / F5.3）
  private windowCheckTimer: number | null = null
  private windowStateListeners: Set<(state: WorkState) => void> = new Set()
  private currentWindowState: WorkState = 'unknown'
  // [P2-14] 平台支持检测：首次调用后缓存结果，不支持时跳过轮询
  private windowDetectionSupported: boolean | null = null

  // 配置
  private readonly WORK_REMIND_INTERVAL = 45 * 60 * 1000  // 45分钟提醒休息
  private readonly DRINK_REMIND_INTERVAL = 60 * 60 * 1000  // 60分钟提醒喝水
  private readonly IDLE_THRESHOLD = 5  // 5分钟判定为离开
  private readonly WORK_THRESHOLD = 2  // 2分钟连续活跃判定为工作

  start(): void {
    if (this.idleCheckTimer !== null) return
    this.workStartAt = Date.now()
    this.lastBreakAt = Date.now()

    this.idleCheckTimer = window.setInterval(() => {
      void this.checkWorkState()
    }, 30000) // 每30秒检查一次

    // 启动音乐感知（F5.2）
    this.musicMgr.start()
    this.unsubMusic = this.musicMgr.onMusicChange((status) => {
      this.cachedMusic = status
      this.broadcastContextChange()
    })

    // 启动网络状态监听（F5.4）
    this.setupNetworkListeners()

    // 启动活跃窗口检测（F1.3 / F5.3，每10秒检测一次）
    this.windowCheckTimer = window.setInterval(() => {
      void this.pollWorkState()
    }, 10000)
    void this.pollWorkState()
  }

  stop(): void {
    if (this.idleCheckTimer !== null) {
      clearInterval(this.idleCheckTimer)
      this.idleCheckTimer = null
    }
    if (this.windowCheckTimer !== null) {
      clearInterval(this.windowCheckTimer)
      this.windowCheckTimer = null
    }
    // 清理天气/音乐监听器，防止回调泄漏
    this.unsubWeather?.()
    this.unsubWeather = null
    this.unsubMusic?.()
    this.unsubMusic = null
    this.weatherMgr.stop()
    this.musicMgr.stop()
    this.teardownNetworkListeners()
  }

  // ============ 网络状态监听 ============

  private setupNetworkListeners(): void {
    if (typeof window === 'undefined') return
    this.onlineHandler = () => {
      this.online = true
      this.networkListeners.forEach((fn) => fn({ online: true }))
      this.broadcastContextChange()
    }
    this.offlineHandler = () => {
      this.online = false
      this.networkListeners.forEach((fn) => fn({ online: false }))
      this.broadcastContextChange()
    }
    window.addEventListener('online', this.onlineHandler)
    window.addEventListener('offline', this.offlineHandler)
  }

  private teardownNetworkListeners(): void {
    if (typeof window === 'undefined') return
    if (this.onlineHandler) window.removeEventListener('online', this.onlineHandler)
    if (this.offlineHandler) window.removeEventListener('offline', this.offlineHandler)
    this.onlineHandler = null
    this.offlineHandler = null
  }

  onNetworkChange(listener: (event: NetworkChangeEvent) => void): () => void {
    this.networkListeners.add(listener)
    return () => this.networkListeners.delete(listener)
  }

  isOnline(): boolean {
    return this.online
  }

  // ============ 主动广播完整情境状态 ============

  private broadcastContextChange(): void {
    const info: WorkStateInfo = {
      state: this.currentState,
      idleMinutes: this.lastIdleMinutes,
      workMinutes: (Date.now() - this.workStartAt) / 60000,
      lastBreakAt: this.lastBreakAt,
      shouldRemindRest: false,
      shouldRemindDrink: false,
      weather: this.cachedWeather,
      weatherBehavior: this.cachedWeatherBehavior,
      musicPlaying: this.cachedMusic?.state === 'playing',
      music: this.cachedMusic,
      online: this.online,
    }
    this.listeners.forEach((fn) => fn(info))
  }

  private async checkWorkState(): Promise<void> {
    let idleMinutes: number
    try {
      const idleMs = await invoke<number>('get_idle_time')
      idleMinutes = idleMs / 60000
    } catch {
      // 非 Tauri 环境无法获取
      return
    }

    this.lastIdleMinutes = idleMinutes

    // 判断状态
    let newState: WorkState
    if (idleMinutes >= this.IDLE_THRESHOLD) {
      newState = 'away'
      // 离开时重置工作计时
      this.workStartAt = Date.now()
    } else if (idleMinutes < 1) {
      // 活跃中
      if (this.currentState === 'away' || this.currentState === 'resting') {
        // 从离开/休息恢复 → 重新开始计时
        this.workStartAt = Date.now()
      }
      const workDuration = (Date.now() - this.workStartAt) / 60000
      newState = workDuration >= this.WORK_THRESHOLD ? 'working' : 'idle'
    } else {
      newState = 'idle'
    }

    this.currentState = newState

    const workMinutes = (Date.now() - this.workStartAt) / 60000
    const now = Date.now()

    // 检查是否需要提醒
    const shouldRemindRest =
      newState === 'working' &&
      workMinutes >= this.WORK_REMIND_INTERVAL / 60000 &&
      now - this.lastRestRemind > this.WORK_REMIND_INTERVAL

    const shouldRemindDrink =
      newState !== 'away' &&
      now - this.lastBreakAt > this.DRINK_REMIND_INTERVAL &&
      now - this.lastDrinkRemind > this.DRINK_REMIND_INTERVAL

    if (shouldRemindRest) {
      this.lastRestRemind = now
      this.lastBreakAt = now
    }
    if (shouldRemindDrink) {
      this.lastDrinkRemind = now
    }

    const info: WorkStateInfo = {
      state: newState,
      idleMinutes,
      workMinutes,
      lastBreakAt: this.lastBreakAt,
      shouldRemindRest,
      shouldRemindDrink,
      weather: this.cachedWeather,
      weatherBehavior: this.cachedWeatherBehavior,
      musicPlaying: this.cachedMusic?.state === 'playing',
      music: this.cachedMusic,
      online: this.online,
    }

    this.listeners.forEach((fn) => fn(info))
  }

  // 用户休息了（手动触发或番茄钟结束）
  markBreak(): void {
    this.lastBreakAt = Date.now()
    this.workStartAt = Date.now()
    this.lastRestRemind = Date.now()
  }

  onStateChange(listener: (info: WorkStateInfo) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getCurrentState(): WorkState {
    return this.currentState
  }

  getLastIdleMinutes(): number {
    return this.lastIdleMinutes
  }

  // ============ 活跃窗口检测（F1.3 / F5.3）============

  /// 检测当前工作状态（基于前台窗口标题 + 进程名）
  /// [P2-14] 同时匹配 title 和 process_name，提升跨平台兼容性
  async detectWorkState(): Promise<WorkState> {
    try {
      const info = await invoke<{ title: string; process_name: string }>('get_active_window')
      const title = info?.title ?? ''
      const processName = info?.process_name ?? ''

      // [P2-14] 首次调用：检测平台是否支持窗口检测
      // macOS: osascript 始终可用；Linux: xdotool 可能未安装
      // 两者都返回空字符串时标记为不支持
      if (this.windowDetectionSupported === null) {
        this.windowDetectionSupported = title !== '' || processName !== ''
        if (!this.windowDetectionSupported) {
          console.info(
            '[contextAwareness] 活动窗口检测不可用（当前平台可能不支持或工具未安装），已跳过窗口轮询'
          )
        }
      }

      // 两者都为空时返回 'idle'（无法确定状态，不做推断）
      if (!title && !processName) return 'idle'

      for (const rule of WINDOW_MATCH_RULES) {
        const titleMatch = rule.titleKeywords.some((kw) => title.includes(kw))
        const processMatch = rule.processKeywords.some((kw) =>
          processName.toLowerCase().includes(kw.toLowerCase()),
        )
        if (titleMatch || processMatch) {
          return rule.state
        }
      }
      return 'idle'
    } catch {
      return 'unknown'
    }
  }

  /// 定时轮询活跃窗口状态，状态变化时通知监听器
  /// [P2-14] 平台不支持时跳过轮询，避免无效 API 调用
  private async pollWorkState(): Promise<void> {
    // 平台不支持窗口检测时，停止轮询以节省资源
    if (this.windowDetectionSupported === false) {
      if (this.windowCheckTimer !== null) {
        clearInterval(this.windowCheckTimer)
        this.windowCheckTimer = null
      }
      return
    }

    const newState = await this.detectWorkState()
    if (newState !== this.currentWindowState) {
      this.currentWindowState = newState
      this.windowStateListeners.forEach((fn) => fn(newState))
    }
  }

  /// 订阅工作状态变化（活跃窗口检测）
  onWorkStateChange(callback: (state: WorkState) => void): () => void {
    this.windowStateListeners.add(callback)
    return () => this.windowStateListeners.delete(callback)
  }

  /// 获取当前窗口工作状态
  getCurrentWindowState(): WorkState {
    return this.currentWindowState
  }

  /// R1：获取缓存的天气信息（用于上下文快照记录）
  getCachedWeather(): { condition: string } | null {
    return this.cachedWeather ? { condition: this.cachedWeather.description ?? 'unknown' } : null
  }

  /// [P2-14] 检查平台是否支持窗口检测
  /// 返回 null 表示尚未检测（首次 pollWorkState 前未知）
  isWindowDetectionSupported(): boolean | null {
    return this.windowDetectionSupported
  }
}

// ============ 通知推送管理器 ============

export type NotificationType =
  | 'rest_reminder'    // 休息提醒
  | 'drink_reminder'   // 喝水提醒
  | 'hp_low'          // 饱食度低
  | 'hp_zero'         // 饱食度为零
  | 'pomodoro_done'   // 番茄钟完成
  | 'achievement'     // 成就解锁
  | 'level_up'        // 升级
  | 'daily_goal'      // 每日目标达成

export interface PetNotification {
  type: NotificationType
  title: string
  body: string
  icon?: string
  petMessage?: string  // 宠物说的话（柔性提醒）
}

export class NotificationManager {
  private enabled: boolean = true
  private sentToday: Set<string> = new Set()
  private listeners: Set<(notif: PetNotification) => void> = new Set()

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  isEnabled(): boolean {
    return this.enabled
  }

  // 发送通知（柔性提醒优先通过宠物行为）
  send(notif: PetNotification): void {
    if (!this.enabled) return

    // 去重：同类通知一天只发一次（除了番茄钟和成就）
    const dedupeKey = `${notif.type}-${new Date().toDateString()}`
    if (
      notif.type !== 'pomodoro_done' &&
      notif.type !== 'achievement' &&
      notif.type !== 'level_up' &&
      notif.type !== 'daily_goal' &&
      this.sentToday.has(dedupeKey)
    ) {
      return
    }
    this.sentToday.add(dedupeKey)

    // 通知监听器（由 PetWindow 处理为气泡/动作）
    this.listeners.forEach((fn) => fn(notif))
  }

  onNotification(listener: (notif: PetNotification) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // 每日重置
  resetDaily(): void {
    this.sentToday.clear()
  }
}

// ============ 柔性提醒文案 ============

export const SOFT_REMINDERS: Record<NotificationType, { petMessages: string[]; title: string }> = {
  rest_reminder: {
    title: '休息提醒',
    petMessages: [
      '主人已经工作很久了，休息一下吧～',
      '站起来活动活动呀！久坐对身体不好哦～',
      '该让眼睛休息一下啦！看看远处吧～',
      '主人辛苦了！要不要跟我玩一会儿？',
    ],
  },
  drink_reminder: {
    title: '喝水提醒',
    petMessages: [
      '记得喝水哦！保持水分很重要～',
      '主人今天喝水了吗？去喝一杯吧～',
      '喝水时间到啦！咕嘟咕嘟～',
    ],
  },
  hp_low: {
    title: '宠物饿了',
    petMessages: [
      '肚子饿饿……有东西吃吗？',
      '好饿呀……主人快喂我～',
    ],
  },
  hp_zero: {
    title: '宠物快饿坏了',
    petMessages: [
      '饿得没力气了……主人……',
      '快……快喂我……要晕了……',
    ],
  },
  pomodoro_done: {
    title: '番茄钟完成',
    petMessages: [
      '专注时间到啦！主人好棒！',
      '完成啦！休息一下吧～',
    ],
  },
  achievement: {
    title: '成就解锁',
    petMessages: ['耶！解锁新成就啦！'],
  },
  level_up: {
    title: '等级提升',
    petMessages: ['升级啦！我好开心～'],
  },
  daily_goal: {
    title: '每日目标达成',
    petMessages: ['今天的专注目标完成啦！太棒了！'],
  },
}

// ============ 单例 ============

let contextMgr: ContextAwarenessManager | null = null
let notifMgr: NotificationManager | null = null

export function getContextAwarenessManager(): ContextAwarenessManager {
  if (!contextMgr) {
    contextMgr = new ContextAwarenessManager()
  }
  return contextMgr
}

export function getNotificationManager(): NotificationManager {
  if (!notifMgr) {
    notifMgr = new NotificationManager()
  }
  return notifMgr
}
