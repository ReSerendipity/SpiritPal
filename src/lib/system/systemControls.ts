/**
 * @file systemControls.ts
 * @description 系统快捷控制模块 — 音量/亮度控制
 *
 * 核心功能：
 * - 系统音量调节（0-100）
 * - 系统亮度调节（10-100，最低 10% 防止黑屏）
 * - 静音切换、音量/亮度快捷调节（±10）
 * - 状态持久化到 localStorage
 * - 提供状态变化订阅机制
 *
 * 运行环境适配：
 * - Tauri 环境：通过 invoke 调用 Rust 后端 set_system_volume / set_system_brightness 命令
 * - 浏览器环境：仅更新本地状态和 UI 展示（Rust 命令未实现时静默降级）
 *
 * 主要模块：
 * - SystemControlState: 系统控制状态接口
 * - SystemControlsManager: 系统控制管理器类（单例）
 * - getSystemControls(): 获取单例实例
 *
 * 依赖关系：
 * - @tauri-apps/api/core: Tauri invoke API
 *
 * 核心接口：
 * - SystemControlsManager.setVolume(): 设置音量
 * - SystemControlsManager.setBrightness(): 设置亮度
 * - SystemControlsManager.toggleMute(): 切换静音
 * - SystemControlsManager.onChange(): 订阅状态变化
 *
 * PRD Phase 4: 音量/亮度快捷控制
 */

import { invoke } from '@tauri-apps/api/core'

/** localStorage 存储键 */
const STORAGE_KEY = 'spiritpal-system-controls'

/**
 * 系统控制状态接口
 */
export interface SystemControlState {
  /** 音量（0-100） */
  volume: number
  /** 亮度（0-100） */
  brightness: number
}

/**
 * 系统控制管理器类
 *
 * 管理系统音量和亮度，支持：
 * - 本地状态持久化
 * - Tauri 后端命令调用
 * - 状态变化订阅
 */
class SystemControlsManager {
  /** 当前状态 */
  private state: SystemControlState = { volume: 50, brightness: 80 }
  /** 状态变化监听器集合 */
  private listeners: Set<() => void> = new Set()

  constructor() {
    this.load()
  }

  /**
   * 从 localStorage 加载持久化状态
   */
  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        this.state = { ...this.state, ...parsed }
      }
    } catch { /* 忽略解析错误 */ }
  }

  /**
   * 保存状态到 localStorage 并通知监听器
   */
  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state))
    } catch { /* 忽略存储错误 */ }
    this.notifyListeners()
  }

  /**
   * 通知所有状态变化监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach((fn) => fn())
  }

  /**
   * 订阅状态变化
   * @param listener 状态变化回调函数
   * @returns 取消订阅函数
   */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 获取当前系统控制状态（副本）
   * @returns 当前状态的副本
   */
  getState(): SystemControlState {
    return { ...this.state }
  }

  // ============ 音量控制 ============

  /**
   * 设置系统音量
   * @param volume 音量值（0-100）
   */
  async setVolume(volume: number): Promise<void> {
    const clamped = Math.max(0, Math.min(100, Math.round(volume)))
    this.state.volume = clamped
    this.save()
    // [Tauri Review] 注意：set_system_volume 命令尚未在 Rust 端实现，当前仅更新本地状态
    try {
      await invoke('set_system_volume', { volume: clamped })
    } catch {
      // Tauri 命令不可用时仅更新本地状态
    }
  }

  /**
   * 调整音量（增量）
   * @param delta 音量变化量（正数增加，负数减少）
   */
  async adjustVolume(delta: number): Promise<void> {
    await this.setVolume(this.state.volume + delta)
  }

  /**
   * 切换静音状态
   * - 当前音量 > 0 时静音（设为 0）
   * - 当前音量 = 0 时恢复到 50
   */
  async toggleMute(): Promise<void> {
    if (this.state.volume > 0) {
      this.state.volume = 0
    } else {
      this.state.volume = 50
    }
    this.save()
    try {
      await invoke('set_system_volume', { volume: this.state.volume })
    } catch { /* 忽略 Tauri 命令错误 */ }
  }

  // ============ 亮度控制 ============

  /**
   * 设置系统亮度
   * @param brightness 亮度值（10-100，最低 10% 防止黑屏）
   */
  async setBrightness(brightness: number): Promise<void> {
    const clamped = Math.max(10, Math.min(100, Math.round(brightness)))
    this.state.brightness = clamped
    this.save()
    // [Tauri Review] 注意：set_system_brightness 命令尚未在 Rust 端实现，当前仅更新本地状态
    try {
      await invoke('set_system_brightness', { brightness: clamped })
    } catch {
      // Tauri 命令不可用时仅更新本地状态
    }
  }

  /**
   * 调整亮度（增量）
   * @param delta 亮度变化量（正数增加，负数减少）
   */
  async adjustBrightness(delta: number): Promise<void> {
    await this.setBrightness(this.state.brightness + delta)
  }

  // ============ 快捷操作 ============

  /** 音量增加 10 */
  async volumeUp(): Promise<void> {
    await this.adjustVolume(10)
  }

  /** 音量减少 10 */
  async volumeDown(): Promise<void> {
    await this.adjustVolume(-10)
  }

  /** 亮度增加 10 */
  async brightnessUp(): Promise<void> {
    await this.adjustBrightness(10)
  }

  /** 亮度减少 10 */
  async brightnessDown(): Promise<void> {
    await this.adjustBrightness(-10)
  }
}

// ============ 单例 ============

/** 全局单例实例 */
let sharedMgr: SystemControlsManager | null = null

/**
 * 获取系统控制管理器单例
 * @returns SystemControlsManager 实例
 */
export function getSystemControls(): SystemControlsManager {
  if (!sharedMgr) {
    sharedMgr = new SystemControlsManager()
  }
  return sharedMgr
}
