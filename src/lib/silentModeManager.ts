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

import { listen, emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'

// ============ 类型定义 ============

export type SilentModeReason = 
  | 'manual'        // 手动触发
  | 'schedule'      // 计划任务（如深夜自动静音）
  | 'meeting'       // 会议模式（检测到会议软件时自动静音）
  | 'focus'         // 专注模式（番茄钟运行时）
  | 'temporary'     // 临时静音（设定时间后恢复）

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

const DEFAULT_SCHEDULES = [
  // 深夜自动静音（23:00-7:00）
  { startHour: 23, endHour: 7, reason: 'schedule' as const },
]

/** 临时静音默认时长（5 分钟） */
const DEFAULT_TEMP_DURATION_MS = 5 * 60 * 1000

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
   */
  private async loadPreferences(): Promise<void> {
    try {
      // TODO: 从 localStorage 或 SQLite 读取
      // 这里使用简化实现
      const stored = localStorage.getItem('spiritpal:silent-mode')
      if (stored) {
        const data = JSON.parse(stored)
        this.state = {
          ...this.state,
          ...data,
        }
        
        // 如果曾经开启过，重新广播状态
        if (this.state.isActive) {
          this.notifyListeners()
        }
      }
    } catch (error) {
      console.error('[SilentMode] Failed to load preferences:', error)
    }
  }

  /**
   * 保存用户偏好设置
   */
  private async savePreferences(): Promise<void> {
    try {
      // TODO: 保存到 localStorage 或 SQLite
      localStorage.setItem('spiritpal:silent-mode', JSON.stringify(this.state))
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
    const wasTemporary = !!this.state.resumeAt
    
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
    this.listeners.forEach(listener => {
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
  private emitToAllWindows(event: {
    type: 'enabled' | 'disabled'
    state: SilentModeState
    prevReason?: string
  }): void {
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
   * 设置全局快捷键
   */
  private setupGlobalShortcut(): void {
    // TODO: 使用 @tauri-apps/plugin-global-shortcut
    // 这里预留接口
    console.log('[SilentMode] Global shortcut setup pending...')
  }

  /**
   * 设置系统事件监听（会议检测等）
   */
  private setupSystemEventListeners(): void {
    // TODO: 监听 contextAwareness 的会议状态
    // 当检测到会议软件运行时自动静音
    console.log('[SilentMode] System event listeners setup pending...')
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
