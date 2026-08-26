/**
 * 隐藏互动状态触发引擎
 *
 * @fileoverview
 * 实现宠物的隐藏/爬墙/探头等高级互动状态
 *
 * 主要功能：
 * - 屏幕边缘爬墙状态（climbing）
 * - 窗口后躲藏状态（hiding_wall）  
 * - 探头观察状态（peeking）
 * - 状态自动切换和超时恢复
 *
 * 参考：DyberPet hiding system / VPet wall-climbing
 */

import { getCurrentWindow, PhysicalPosition } from '@tauri-apps/api/window'
import type { PetState } from './types'
import { usePetStore } from '../stores/petStore'

// ============ 隐藏状态类型 ============

export type HiddenState = 'normal' | 'climbing' | 'hiding_wall' | 'peeking'

export interface HiddenStateInfo {
  state: HiddenState
  duration: number          // 当前状态持续时间（毫秒）
  startedAt: number         // 状态开始时间戳
  edgeDir?: 'left' | 'right' | 'top' | 'bottom'  // 边缘方向（爬墙时）
}

// ============ 配置常量 ============

/** 爬墙状态最大持续时间（30 秒） */
const CLIMBING_MAX_DURATION = 30 * 1000

/** 躲藏状态最大持续时间（60 秒） */
const HIDING_MAX_DURATION = 60 * 1000

/** 探头状态最大持续时间（10 秒） */
const PEEKING_MAX_DURATION = 10 * 1000

/** 爬墙判定阈值（窗口距屏幕边缘 < 8px） */
const CLIMB_THRESHOLD = 8

/** 探出头距离（从边缘探出 40px） */
const PEEK_OFFSET = 40

/** 状态切换冷却时间（2 秒内不重复切换） */
const STATE_COOLDOWN = 2000

// ============ 隐藏状态管理器 ============

export class HiddenStateManager {
  private currentState: HiddenStateInfo
  private lastStateSwitch: number = 0
  private checkTimer: number | null = null
  private autoReturnTimer: number | null = null

  constructor() {
    this.currentState = {
      state: 'normal',
      duration: 0,
      startedAt: Date.now(),
    }
  }

  /**
   * 启动状态检测定时器
   */
  start(): void {
    if (this.checkTimer !== null) return

    this.checkTimer = window.setInterval(() => {
      void this.checkAndUpdateState()
    }, 1000)
  }

  /**
   * 停止所有定时器
   */
  stop(): void {
    if (this.checkTimer !== null) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
    if (this.autoReturnTimer !== null) {
      clearTimeout(this.autoReturnTimer)
      this.autoReturnTimer = null
    }
  }

  /**
   * 检查并更新状态
   */
  async checkAndUpdateState(): Promise<void> {
    const now = Date.now()
    const info = await this.gatherWindowState()
    
    // 在正常状态下才自动检测切换
    if (this.currentState.state === 'normal') {
      if (info.isAtEdge) {
        await this.switchTo('climbing', info.edgeDir)
      }
    } else if (this.currentState.state === 'climbing') {
      // 爬墙超时自动返回
      if (now - this.currentState.startedAt > CLIMBING_MAX_DURATION) {
        await this.returnToNormal()
      } else if (!info.isAtEdge) {
        // 离开边缘也返回正常
        await this.returnToNormal()
      }
    }
  }

  /**
   * 收集窗口状态信息
   */
  private async gatherWindowState(): Promise<{
    isAtEdge: boolean
    edgeDir?: 'left' | 'right' | 'top' | 'bottom'
  }> {
    try {
      const win = getCurrentWindow()
      const pos = await win.outerPosition()
      const size = await win.outerSize()
      
      // 获取主显示器信息
      const monitor = await (async () => {
        // 注意：currentMonitor 是顶层函数，不是 Window 实例方法
        const { currentMonitor } = await import('@tauri-apps/api/window')
        return await currentMonitor()
      })()

      if (!monitor) return { isAtEdge: false }

      const screenX = monitor.position.x
      const screenY = monitor.position.y
      const screenW = monitor.size.width
      const screenH = monitor.size.height

      const leftDist = pos.x - screenX
      const rightDist = screenX + screenW - (pos.x + size.width)
      const topDist = pos.y - screenY
      const bottomDist = screenY + screenH - (pos.y + size.height)

      // 判断是否贴边
      if (leftDist < CLIMB_THRESHOLD && leftDist >= 0) {
        return { isAtEdge: true, edgeDir: 'left' }
      }
      if (rightDist < CLIMB_THRESHOLD && rightDist >= 0) {
        return { isAtEdge: true, edgeDir: 'right' }
      }
      if (topDist < CLIMB_THRESHOLD && topDist >= 0) {
        return { isAtEdge: true, edgeDir: 'top' }
      }
      if (bottomDist < CLIMB_THRESHOLD && bottomDist >= 0) {
        return { isAtEdge: true, edgeDir: 'bottom' }
      }

      return { isAtEdge: false }
    } catch {
      return { isAtEdge: false }
    }
  }

  /**
   * 切换到指定状态
   */
  async switchTo(newState: HiddenState, edgeDir?: 'left' | 'right' | 'top' | 'bottom'): Promise<boolean> {
    const now = Date.now()

    // 冷却期跳过
    if (now - this.lastStateSwitch < STATE_COOLDOWN) {
      return false
    }

    // 同状态跳过
    if (newState === this.currentState.state) {
      return false
    }

    // 状态切换
    this.currentState = {
      state: newState,
      duration: 0,
      startedAt: now,
      edgeDir,
    }
    this.lastStateSwitch = now

    // 设置自动返回定时器
    this.setAutoReturn(newState)

    // 通知 UI 层切换动画
    this.notifyStateChanged()

    return true
  }

  /**
   * 设置自动返回定时器
   */
  private setAutoReturn(state: HiddenState): void {
    if (this.autoReturnTimer !== null) {
      clearTimeout(this.autoReturnTimer)
      this.autoReturnTimer = null
    }

    let maxDuration: number
    switch (state) {
      case 'climbing':
        maxDuration = CLIMBING_MAX_DURATION
        break
      case 'hiding_wall':
        maxDuration = HIDING_MAX_DURATION
        break
      case 'peeking':
        maxDuration = PEEKING_MAX_DURATION
        break
      default:
        return
    }

    this.autoReturnTimer = window.setTimeout(() => {
      void this.returnToNormal()
    }, maxDuration)
  }

  /**
   * 返回正常状态
   */
  async returnToNormal(): Promise<boolean> {
    return this.switchTo('normal')
  }

  /**
   * 手动触发躲藏到窗口后
   */
  async hideBehindWindow(): Promise<boolean> {
    return this.switchTo('hiding_wall')
  }

  /**
   * 手动触发探头观察
   * @param fromEdge 从哪边探头
   */
  async peekFromEdge(fromEdge: 'left' | 'right' | 'top' | 'bottom'): Promise<boolean> {
    const success = await this.switchTo('peeking', fromEdge)
    if (success) {
      // 移动位置让宠物探出头
      await this.moveWindowForPeek(fromEdge)
    }
    return success
  }

  /**
   * 为探头状态调整窗口位置
   */
  private async moveWindowForPeek(dir: 'left' | 'right' | 'top' | 'bottom'): Promise<void> {
    try {
      const win = getCurrentWindow()
      const pos = await win.outerPosition()
      const size = await win.outerSize()

      let newX = pos.x
      let newY = pos.y

      switch (dir) {
        case 'left':
          newX = pos.x + PEEK_OFFSET
          break
        case 'right':
          newX = pos.x - PEEK_OFFSET
          break
        case 'top':
          newY = pos.y + PEEK_OFFSET
          break
        case 'bottom':
          newY = pos.y - PEEK_OFFSET
          break
      }

      await win.setPosition(new PhysicalPosition(newX, newY))
    } catch {
      // 忽略错误
    }
  }

  /**
   * 通知状态变化（供 UI 层切换动画）
   */
  private notifyStateChanged(): void {
    // 通过 CustomEvent 通知 UI
    const event = new CustomEvent('spiritpal:hidden-state-change', {
      detail: this.currentState,
    })
    window.dispatchEvent(event)
  }

  /**
   * 获取当前状态
   */
  getCurrentState(): HiddenStateInfo {
    return { ...this.currentState, duration: Date.now() - this.currentState.startedAt }
  }

  /**
   * 判断是否处于隐藏状态
   */
  isHidden(): boolean {
    return this.currentState.state !== 'normal'
  }

  /**
   * 判断是否正在爬墙
   */
  isClimbing(): boolean {
    return this.currentState.state === 'climbing'
  }

  /**
   * 判断是否正在探头
   */
  isPeeking(): boolean {
    return this.currentState.state === 'peeking'
  }

  /**
   * 强制结束当前隐藏状态
   */
  forceReturnToNormal(): void {
    if (this.autoReturnTimer !== null) {
      clearTimeout(this.autoReturnTimer)
      this.autoReturnTimer = null
    }
    this.currentState = {
      state: 'normal',
      duration: 0,
      startedAt: Date.now(),
    }
    this.notifyStateChanged()
  }
}

// ============ 单例 ============

let instance: HiddenStateManager | null = null

export function getHiddenStateManager(): HiddenStateManager {
  if (!instance) {
    instance = new HiddenStateManager()
  }
  return instance
}

export function resetHiddenStateManager(): void {
  if (instance) {
    instance.stop()
    instance = null
  }
}
