/**
 * @file miniModeManager.ts
 * @description Mini Mode - 迷你悬浮窗模式管理器（Tauri 适配版）
 * 
 * 实现功能：
 * - 窗口精简布局（隐藏展开面板、状态栏等）
 * - 小窗口尺寸（80x80 ~ 120x120）
 * - 置顶悬浮显示（Always on Top）
 * - 拖拽到屏幕边缘自动吸附
 * - 双击/右键切换回正常模式
 * - 透明背景 + 阴影效果
 * - 快速操作按钮（收起/设置/退出）
 * 
 * 参考：Dororo Mini Mode / VPet Floating Window
 */

import { invoke } from '@tauri-apps/api/core'

// ============ 类型定义 ============

export interface MiniModeConfig {
  /** 窗口宽度 */
  width: number
  /** 窗口高度 */
  height: number
  /** 最小尺寸 */
  minWidth: number
  minHeight: number
  /** 最大尺寸 */
  maxWidth: number
  maxHeight: number
  /** 是否置顶 */
  alwaysOnTop: boolean
  /** 透明度（0-1） */
  opacity: number
  /** 是否透明背景 */
  transparent: boolean
  /** 无边框 */
  frameless: boolean
  /** 是否可调整大小 */
  resizable: boolean
  /** 阴影效果 */
  shadow: boolean
}

export interface MiniModeState {
  /** 是否处于 Mini Mode */
  isActive: boolean
  /** 当前位置 */
  position: { x: number; y: number }
  /** 当前尺寸 */
  size: { width: number; height: number }
  /** 吸附边（left/right/top/bottom） */
  dockSide?: 'left' | 'right' | 'top' | 'bottom' | null
}

// ============ 默认配置 ============

const DEFAULT_CONFIG: MiniModeConfig = {
  width: 100,
  height: 100,
  minWidth: 80,
  minHeight: 80,
  maxWidth: 150,
  maxHeight: 150,
  alwaysOnTop: true,
  opacity: 0.95,
  transparent: true,
  frameless: true,
  resizable: true,
  shadow: true,
}

// ============ Mini Mode 管理器 ============

export class MiniModeManager {
  private config: MiniModeConfig
  private state: MiniModeState
  
  constructor(config?: Partial<MiniModeConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...(config || {}) }
    this.state = {
      isActive: false,
      position: { x: 0, y: 0 },
      size: { width: this.config.width, height: this.config.height },
      dockSide: null,
    }
  }

  /**
   * 启用 Mini Mode
   */
  async enable(): Promise<void> {
    if (this.state.isActive) return

    try {
      // 切换到 Mini 窗口视图
      await invoke('switch_mini_mode', { enabled: true })
      
      // 设置窗口属性
      await this.applyWindowSettings()
      
      this.state.isActive = true
      console.log('[MiniMode] Enabled')
    } catch (error) {
      console.error('[MiniMode] Failed to enable:', error)
      throw error
    }
  }

  /**
   * 禁用 Mini Mode
   */
  async disable(): Promise<void> {
    if (!this.state.isActive) return

    try {
      // 恢复到正常窗口
      await invoke('switch_mini_mode', { enabled: false })
      
      this.state.isActive = false
      console.log('[MiniMode] Disabled')
    } catch (error) {
      console.error('[MiniMode] Failed to disable:', error)
    }
  }

  /**
   * 切换 Mini Mode
   */
  async toggle(): Promise<void> {
    if (this.state.isActive) {
      await this.disable()
    } else {
      await this.enable()
    }
  }

  /**
   * 应用窗口设置
   */
  private async applyWindowSettings(): Promise<void> {
    const { width, height, alwaysOnTop, opacity, transparent, frameless, shadow } = this.config
    
    // 通过 Tauri API 设置窗口属性
    try {
      await invoke('set_window_always_on_top', { alwaysOnTop })
      await invoke('set_window_opacity', { opacity })
      await invoke('set_window_decorations', { enabled: !frameless })
      // TODO: 添加 shadow 支持（平台依赖）
    } catch (error) {
      console.warn('[MiniMode] Failed to set window settings:', error)
    }
  }

  /**
   * 检查边缘吸附
   */
  checkEdgeDocking(screenX: number, screenY: number): void {
    const screenWidth = window.innerWidth
    const screenHeight = window.innerHeight
    const { width: winWidth, height: winHeight } = this.state.size

    const dockThreshold = 10 // 吸附阈值（像素）

    let dockSide: 'left' | 'right' | 'top' | 'bottom' | null = null

    // 检查左边缘
    if (screenX <= dockThreshold) {
      dockSide = 'left'
    }
    // 检查右边缘
    else if (screenX >= screenWidth - winWidth - dockThreshold) {
      dockSide = 'right'
    }
    // 检查上边缘
    else if (screenY <= dockThreshold) {
      dockSide = 'top'
    }
    // 检查下边缘
    else if (screenY >= screenHeight - winHeight - dockThreshold) {
      dockSide = 'bottom'
    }

    if (dockSide !== this.state.dockSide) {
      this.state.dockSide = dockSide
      
      // 通知 UI 吸附状态变化
      this.notifyDockChange(dockSide)
    }
  }

  /**
   * 通知 UI 吸附状态变化
   */
  private notifyDockChange(dockSide: string | null): void {
    const event = new CustomEvent('minimode:dock-change', {
      detail: dockSide,
    })
    window.dispatchEvent(event)
  }

  /**
   * 调整窗口尺寸
   */
  resize(width: number, height: number): void {
    // 限制在合理范围内
    width = Math.max(this.config.minWidth, Math.min(this.config.maxWidth, width))
    height = Math.max(this.config.minHeight, Math.min(this.config.maxHeight, height))
    
    this.state.size = { width, height }
    
    // 通过 Tauri API 设置窗口大小
    try {
      invoke('resize_window', { width, height }).catch(console.warn)
    } catch (error) {
      console.warn('[MiniMode] Failed to resize:', error)
    }
  }

  /**
   * 改变透明度
   */
  setOpacity(opacity: number): void {
    opacity = Math.max(0.3, Math.min(1.0, opacity))
    
    this.config.opacity = opacity
    
    // 通过 Tauri API 设置窗口透明度
    try {
      invoke('set_window_opacity', { opacity }).catch(console.warn)
    } catch (error) {
      console.warn('[MiniMode] Failed to set opacity:', error)
    }
  }

  /**
   * 获取当前状态
   */
  getState(): MiniModeState {
    return { ...this.state }
  }

  /**
   * 是否处于 Mini Mode
   */
  isMiniMode(): boolean {
    return this.state.isActive
  }

  /**
   * 清理资源
   */
  destroy(): void {
    void this.disable()
  }
}

// ============ 快捷函数 ============

let instance: MiniModeManager | null = null

export function getMiniModeManager(): MiniModeManager {
  if (!instance) {
    instance = new MiniModeManager()
  }
  return instance
}

export async function toggleMiniMode(): Promise<void> {
  await getMiniModeManager().toggle()
}
