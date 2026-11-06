/**
 * @file silentModeManager.ts
 * @description 静默模式管理器 — 一键禁用宠物发言的全局开关
 *
 * 实现功能：
 * - 全局静音开关（键盘快捷键/菜单/设置面板）
 * - 本地持久化（用户偏好保存）
 * - 临时静音（定时恢复）
 * - 气泡消息抑制
 * - TTS 引擎静音
 * - 状态同步（跨窗口共享）
 *
 * 参考：VPet SilentMode / Dororo Quiet Mode
 */

import { emit } from '@tauri-apps/api/event'
import { register, unregisterAll } from '@tauri-apps/plugin-global-shortcut'
import { ensureAppWindow } from '@/lib/system/appWindows'
import { getContextAwarenessManager } from '@/lib/ai/contextAwareness'

// ============ 类型定义 ============

export type SilentModeReason =
  | 'manual' // 手动触发
  | 'schedule' // 计划任务（如深夜自动静音）
  | 'meeting' // 会议模式（检测到会议软件时自动静音）
  | 'focus' // 专注模式（番茄钟运行时）
  | 'temporary' // 临时静音（设定时间后恢复）

export interface SilentModeState {
  /** 是否处于静默模式 */
  isActive: boolean
  /** 静音原因 */
  reason: SilentModeReason
  /** 静音开始时间戳 */
  startedAt: number
  /** 临时静音的结束时间戳（仅 temporary 模式） */
  resumeAt?: number
  /** 恢复说话时的提示消息（可选） */
  resumeMessage?: string
}

// ============ 默认配置 ============

/** 静音状态持久化键（TD-006） */
const STORAGE_KEY = 'spiritpal:silent-mode'

const DEFAULT_SCHEDULES = [
  // 深夜自动静音（23:00-7:00）
  { startHour: 23, endHour: 7, reason: 'schedule' as const },
]

// ============ 静默模式管理器 ============

export class SilentModeManager {
  private state: SilentModeState = {
    isActive: false,
    reason: 'manual',
    startedAt: 0,
  }
  private tempTimer: number | null = null
  private scheduleCheckTimer: number | null = null
  private listeners: Set<(state: SilentModeState) => void> = new Set()
  /** 本次静音是否由会议检测自动触发（用于出会议时只撤销这一种） */
  private autoMeetingMute = false
  /** 本轮会议里用户手动关了静音 → 不再自动重开（state 变非 meeting 后复位） */
  private meetingMuteSuppressed = false
  /** TD-006：情境感知（会议检测）的退订函数，destroy 时清理 */
  private unsubWorkState: (() => void) | null = null

  constructor() {
    this.init()
  }

  /**
   * 初始化静默模式管理器
   */
  private async init(): Promise<void> {
    // 加载用户偏好
    await this.loadPreferences()

    // 启动定时调度检查
    this.startScheduleChecker()

    // 监听全局快捷键（默认 F9 切换静音）
    this.setupGlobalShortcut()

    // 监听系统事件（会议开始/结束）
    this.setupSystemEventListeners()
  }

  /**
   * 加载用户偏好设置
   *
   * TD-006：持久化落在 localStorage（WebView 的 localStorage 跟随应用数据目录，跨重启保留），
   * 不引 SQLite —— 这里只是几字节的用户偏好，读写频率低，走加密库反而增加解锁/迁移负担。
   *
   * 恢复时要区分「跨会话该保留的」和「只属于上个会话的」：
   * - `meeting`：会议已经结束，恢复成静音会让用户重启后莫名没声音 → 一律不恢复；
   * - `temporary`：已过期的不恢复，未过期的按剩余时间重新挂定时器；
   * - `manual` / `schedule`：按存储值恢复。
   */
  private async loadPreferences(): Promise<void> {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (!stored) return

      const data = JSON.parse(stored) as Partial<SilentModeState>
      if (!data || typeof data !== 'object') return

      const restored: SilentModeState = {
        ...this.state,
        ...data,
      }

      if (restored.isActive && restored.reason === 'meeting') {
        // 上个会话的会议静音不跨会话（会议检测本身也是会话级）
        return
      }

      if (restored.isActive && restored.reason === 'temporary') {
        const resumeAt = restored.resumeAt ?? 0
        if (resumeAt <= Date.now()) {
          // 已经过期：清掉存储里的旧值，避免每次启动都读到一条过期静音
          void this.savePreferences()
          return
        }
        this.state = restored
        // 按剩余时长重新挂自动恢复定时器
        this.tempTimer = window.setTimeout(() => {
          void this.disableSilentMode('auto-resume')
        }, resumeAt - Date.now())
        this.notifyListeners()
        return
      }

      this.state = restored
      if (this.state.isActive) {
        // 如果曾经开启过，重新广播状态（跨窗口同步）
        this.notifyListeners()
      }
    } catch (error) {
      console.error('[SilentMode] Failed to load preferences:', error)
    }
  }

  /**
   * 保存用户偏好设置
   *
   * 写入失败（隐私模式 / 存储配额）只记日志、不阻断静音本身 —— 静音是即时生效的本地状态，
   * 丢持久化最多是重启后回到未静音，不影响当前会话。
   */
  private async savePreferences(): Promise<void> {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch (error) {
      console.error('[SilentMode] Failed to save preferences:', error)
    }
  }

  /**
   * 切换到静默模式
   * @param reason 静音原因
   * @param duration 临时静音时长（毫秒），不填则永久静音
   */
  async enableSilentMode(reason: SilentModeReason = 'manual', duration?: number): Promise<void> {
    if (this.state.isActive) return

    this.state = {
      isActive: true,
      reason,
      startedAt: Date.now(),
    }

    if (duration) {
      this.state.resumeAt = Date.now() + duration

      // 设置定时器自动恢复
      if (this.tempTimer) {
        clearTimeout(this.tempTimer)
      }
      this.tempTimer = window.setTimeout(() => {
        void this.disableSilentMode('auto-resume')
      }, duration)
    }

    await this.savePreferences()
    this.notifyListeners()
    this.emitToAllWindows({ type: 'enabled', state: this.state })

    console.log(`[SilentMode] 静默模式已启用 (${reason})`)
  }

  /**
   * 退出静默模式
   * @param triggerReason 触发恢复的原因
   */
  async disableSilentMode(triggerReason?: string): Promise<void> {
    if (!this.state.isActive) return

    const prevReason = this.state.reason

    // TD-006：用户在会议中手动关掉静音 → 本轮会议不再自动重开
    //（'meeting-ended' 是会议检测自己触发的恢复，不算用户意愿）
    if (this.autoMeetingMute && prevReason === 'meeting' && triggerReason !== 'meeting-ended') {
      this.meetingMuteSuppressed = true
    }
    this.autoMeetingMute = false

    // 清除定时器
    if (this.tempTimer) {
      clearTimeout(this.tempTimer)
      this.tempTimer = null
    }

    this.state = {
      isActive: false,
      reason: 'manual',
      startedAt: 0,
    }

    await this.savePreferences()
    this.notifyListeners()
    this.emitToAllWindows({ type: 'disabled', state: this.state, prevReason })

    console.log(`[SilentMode] 静默模式已关闭 (${triggerReason ?? prevReason})`)
  }

  /**
   * 切换静默模式（开/关）
   */
  async toggleSilentMode(): Promise<void> {
    if (this.state.isActive) {
      await this.disableSilentMode()
    } else {
      await this.enableSilentMode('manual')
    }
  }

  /**
   * 临时静音指定时长
   * @param minutes 分钟数
   */
  async temporarySilence(minutes: number = 5): Promise<void> {
    const duration = minutes * 60 * 1000
    await this.enableSilentMode('temporary', duration)
  }

  /**
   * 检查当前是否为静默模式
   */
  isSilent(): boolean {
    // 检查临时静音是否过期
    if (this.state.isActive && this.state.resumeAt) {
      if (Date.now() > this.state.resumeAt) {
        // 已过期，自动关闭
        void this.disableSilentMode('expired')
        return false
      }
    }

    return this.state.isActive
  }

  /**
   * 获取当前静默状态详情
   */
  getState(): SilentModeState {
    return { ...this.state }
  }

  /**
   * 订阅静默状态变化
   */
  onStateChange(listener: (state: SilentModeState) => void): () => void {
    this.listeners.add(listener)

    // 立即发送当前状态
    listener(this.state)

    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach((listener) => {
      try {
        listener({ ...this.state })
      } catch (error) {
        console.error('[SilentMode] Listener error:', error)
      }
    })
  }

  /**
   * 向所有窗口广播状态变化
   */
  private emitToAllWindows(event: { type: 'enabled' | 'disabled'; state: SilentModeState; prevReason?: string }): void {
    try {
      void emit('spiritpal:silent-mode-change', event)
    } catch (error) {
      console.error('[SilentMode] Failed to emit event:', error)
    }
  }

  /**
   * 启动定时调度检查
   */
  private startScheduleChecker(): void {
    if (this.scheduleCheckTimer) {
      clearInterval(this.scheduleCheckTimer)
    }

    // 每分钟检查一次
    this.scheduleCheckTimer = window.setInterval(() => {
      this.checkAndApplySchedule()
    }, 60 * 1000)

    // 立即执行一次
    this.checkAndApplySchedule()
  }

  /**
   * 检查并应用定时调度
   */
  private checkAndApplySchedule(): void {
    const currentHour = new Date().getHours()

    for (const schedule of DEFAULT_SCHEDULES) {
      if (this.isTimeInRange(currentHour, schedule.startHour, schedule.endHour)) {
        // 当前时间在调度范围内，且未处于其他原因的静音中
        if (!this.state.isActive || this.state.reason === 'schedule') {
          void this.enableSilentMode('schedule')
        }
        return
      }
    }

    // 不在任何调度范围内
    if (this.state.isActive && this.state.reason === 'schedule') {
      void this.disableSilentMode('schedule-ended')
    }
  }

  /**
   * 判断当前小时是否在时间范围内
   */
  private isTimeInRange(current: number, start: number, end: number): boolean {
    if (start <= end) {
      // 正常范围（如 9-17）
      return current >= start && current < end
    } else {
      // 跨夜范围（如 23-7）
      return current >= start || current < end
    }
  }

  /**
   * 设置全局快捷键（P1-4：接线 @tauri-apps/plugin-global-shortcut）
   *
   * 默认：
   * - F9：切换静默模式
   * - Ctrl+Shift+H：显隐宠物主窗口（pet-window）
   *
   * 非 Tauri 环境（纯 Web 开发/测试）下 register 会失败，静默降级不阻断应用启动。
   */
  private setupGlobalShortcut(): void {
    void this.registerShortcut('F9', () => {
      void this.toggleSilentMode()
    })
    void this.registerShortcut('Ctrl+Shift+H', () => {
      void this.togglePetWindowVisibility()
    })
  }

  /** 注册单个快捷键，失败静默（非 Tauri 环境降级） */
  private async registerShortcut(shortcut: string, handler: () => void): Promise<void> {
    try {
      await register(shortcut, handler)
    } catch {
      // 非 Tauri 环境/快捷键冲突/权限不足时降级：不注册，不影响应用其余功能
    }
  }

  /** 显隐宠物主窗口（快捷开关，幂等） */
  private async togglePetWindowVisibility(): Promise<void> {
    try {
      const win = await ensureAppWindow('pet-window')
      if (!win) return
      if (await win.isVisible()) {
        await win.hide()
      } else {
        await win.show()
        await win.setFocus()
      }
    } catch {
      // 窗口不可用时静默
    }
  }

  /**
   * 设置系统事件监听（会议检测）
   *
   * TD-006：会议状态来自 `contextAwareness` 的活跃窗口检测（Zoom / Teams / 腾讯会议 / 钉钉 /
   * 飞书 / Google Meet / Slack 命中 `WorkState = 'meeting'`），这里只做「进会议自动静音、
   * 出会议自动恢复」，且**只撤销自己因会议打开的静音**：
   * - 用户手动静音（reason=manual）时进会议不会再叠一层，出会议也不会把它关掉；
   * - 会议期间用户手动关静音，则本轮会议不再自动重开（`meetingMuteSuppressed`）。
   */
  private setupSystemEventListeners(): void {
    try {
      this.unsubWorkState?.()
      this.unsubWorkState = getContextAwarenessManager().onWorkStateChange((state) => {
        this.handleWorkStateChange(state)
      })
    } catch (error) {
      // 情境感知不可用（非 Tauri 环境 / 能力开关关闭）时降级：不做会议联动，不影响其余功能
      console.warn('[SilentMode] 会议联动不可用，已降级:', error)
    }
  }

  /** 会议状态变化 → 自动静音/恢复 */
  private handleWorkStateChange(state: string): void {
    if (state === 'meeting') {
      if (this.meetingMuteSuppressed) return
      if (this.state.isActive) return // 已在静音（手动/定时/其他原因），不覆盖原因
      this.autoMeetingMute = true
      void this.enableSilentMode('meeting')
      return
    }

    // 离开会议：只撤销「因会议自动打开」的那次静音
    if (this.autoMeetingMute && this.state.isActive && this.state.reason === 'meeting') {
      this.autoMeetingMute = false
      void this.disableSilentMode('meeting-ended')
    }
    this.autoMeetingMute = false
    // 新一轮会议重新允许自动静音（用户手动关闭只针对本轮会议）
    this.meetingMuteSuppressed = false
  }

  /**
   * 获取静默模式剩余时间（临时模式下）
   */
  getRemainingTime(): number | null {
    if (!this.state.isActive || !this.state.resumeAt) {
      return null
    }

    const remaining = this.state.resumeAt - Date.now()
    return Math.max(0, remaining)
  }

  /**
   * 格式化剩余时间为可读字符串
   */
  formatRemainingTime(): string | null {
    const remaining = this.getRemainingTime()
    if (remaining === null) return null

    const minutes = Math.floor(remaining / 60000)
    const seconds = Math.floor((remaining % 60000) / 1000)

    if (minutes > 0) {
      return `${minutes}分${seconds}秒`
    }
    return `${seconds}秒`
  }

  /**
   * 清理资源
   */
  destroy(): void {
    if (this.tempTimer) {
      clearTimeout(this.tempTimer)
    }
    if (this.scheduleCheckTimer) {
      clearInterval(this.scheduleCheckTimer)
    }
    // TD-006：退订情境感知的会议状态监听
    this.unsubWorkState?.()
    this.unsubWorkState = null
    // P1-4：注销全局快捷键（避免重复注册/残留）
    try {
      void unregisterAll().catch(() => {})
    } catch {
      // 非 Tauri 环境忽略
    }
    this.listeners.clear()
  }
}

// ============ 快捷工具函数 ============

let instance: SilentModeManager | null = null

/**
 * 获取静默模式管理器单例
 */
export function getSilentModeManager(): SilentModeManager {
  if (!instance) {
    instance = new SilentModeManager()
  }
  return instance
}

/**
 * 检查是否处于静默模式（快捷函数）
 */
export function isSilentMode(): boolean {
  return getSilentModeManager().isSilent()
}

/**
 * 切换静默模式（快捷函数）
 */
export async function toggleSilentMode(): Promise<void> {
  await getSilentModeManager().toggleSilentMode()
}

/**
 * 临时静音（快捷函数）
 */
export async function temporarySilence(minutes: number = 5): Promise<void> {
  await getSilentModeManager().temporarySilence(minutes)
}
