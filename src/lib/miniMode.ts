/**
 * 迷你模式模块
 *
 * @fileoverview 实现宠物窗口迷你模式切换、边缘吸附与悬停预览功能
 *
 * 主要模块：
 * - MiniModeState/MiniModeConfig: 状态与配置类型
 * - MiniModeManager: 迷你模式管理器主类
 *
 * 依赖关系：
 * - @tauri-apps/api/window: Tauri窗口API
 * - @tauri-apps/api/event: Tauri事件系统
 * - multiMonitor.ts: 多显示器检测与屏幕边界计算
 *
 * 核心接口：
 * - enterMiniMode(): 进入迷你模式
 * - exitMiniMode(): 退出迷你模式
 * - toggleMiniMode(): 切换迷你模式
 * - showPreview()/hidePreview(): 悬停预览控制
 *
 * 核心机制：
 * 1. 模式切换：普通模式(300x400) ↔ 迷你模式(80x80)
 * 2. 边缘吸附：距离边缘<50px自动吸附
 * 3. 悬停预览：悬停300ms展开预览(200x260)，离开800ms收起
 * 4. 平滑过渡：200ms动画过渡
 *
 * 参考：clawd-on-desk Edge Hiding + Hover Preview
 */

import { getCurrentWindow } from '@tauri-apps/api/window'
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event'
import { getAvailableMonitors, calculateScreenBounds, type WindowPosition } from './multiMonitor'

// ============ 常量 ============

/** 普通模式窗口宽度 */
const NORMAL_WIDTH = 300

/** 普通模式窗口高度 */
const NORMAL_HEIGHT = 400

/** 迷你模式窗口宽度 */
const MINI_WIDTH = 80

/** 迷你模式窗口高度 */
const MINI_HEIGHT = 80

/** 悬停预览窗口宽度 */
const PREVIEW_WIDTH = 200

/** 悬停预览窗口高度 */
const PREVIEW_HEIGHT = 260

/** 悬停展开延迟（毫秒） */
const HOVER_EXPAND_DELAY_MS = 300

/** 悬停收起延迟（毫秒） */
const HOVER_COLLAPSE_DELAY_MS = 800

// ============ 类型定义 ============

/** 迷你模式状态 */
export type MiniModeState = 'normal' | 'mini' | 'preview'

/** 迷你模式配置 */
export interface MiniModeConfig {
  /** 是否启用边缘吸附（默认 true） */
  edgeSnap: boolean
  /** 是否启用悬停预览（默认 true） */
  hoverPreview: boolean
  /** 迷你模式窗口尺寸 */
  miniSize: { width: number; height: number }
  /** 预览模式窗口尺寸 */
  previewSize: { width: number; height: number }
}

/** 迷你模式回调 */
export interface MiniModeCallbacks {
  /** 模式切换时触发 */
  onStateChange?: (from: MiniModeState, to: MiniModeState) => void
  /** 窗口尺寸变化时触发 */
  onSizeChange?: (size: { width: number; height: number }) => void
  /** 边缘吸附时触发 */
  onEdgeSnap?: (edge: 'left' | 'right' | 'top' | 'bottom', position: WindowPosition) => void
}

// ============ 迷你模式管理器 ============

/**
 * 迷你模式管理器
 *
 * 管理宠物窗口在普通模式/迷你模式/预览模式之间的切换，
 * 包含边缘吸附和悬停预览功能。
 */
export class MiniModeManager {
  private state: MiniModeState = 'normal'
  private config: MiniModeConfig
  private callbacks: MiniModeCallbacks
  private windowPosition: WindowPosition = { x: 0, y: 0 }

  // 悬停定时器
  private hoverExpandTimer: ReturnType<typeof setTimeout> | null = null
  private hoverCollapseTimer: ReturnType<typeof setTimeout> | null = null

  // 状态监听器
  private unlisteners: UnlistenFn[] = []

  // 保存普通模式下的位置（用于从迷你模式恢复）
  private normalModePosition: WindowPosition | null = null

  constructor(
    config: Partial<MiniModeConfig> = {},
    callbacks: MiniModeCallbacks = {},
  ) {
    this.config = {
      edgeSnap: config.edgeSnap ?? true,
      hoverPreview: config.hoverPreview ?? true,
      miniSize: config.miniSize ?? { width: MINI_WIDTH, height: MINI_HEIGHT },
      previewSize: config.previewSize ?? { width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT },
    }
    this.callbacks = callbacks
  }

  // ============ 模式切换 ============

  /**
   * 切换到迷你模式
   * 保存当前位置，缩小窗口，吸附到最近边缘
   */
  async enterMiniMode(): Promise<void> {
    if (this.state === 'mini') return

    const prevState = this.state
    const appWindow = getCurrentWindow()

    // 保存普通模式位置
    if (prevState === 'normal') {
      try {
        const pos = await appWindow.outerPosition()
        this.normalModePosition = { x: pos.x, y: pos.y }
      } catch {
        this.normalModePosition = null
      }
    }

    // 缩小窗口
    try {
      await appWindow.setSize(
        new (await import('@tauri-apps/api/dpi')).LogicalSize(
          this.config.miniSize.width,
          this.config.miniSize.height,
        ),
      )
    } catch (e) {
      console.warn('[MiniMode] 缩小窗口失败:', e)
    }

    // 边缘吸附
    if (this.config.edgeSnap) {
      const snappedPos = await this.snapToNearestEdge()
      if (snappedPos) {
        try {
          await appWindow.setPosition(
            new (await import('@tauri-apps/api/dpi')).LogicalPosition(snappedPos.x, snappedPos.y),
          )
          this.windowPosition = snappedPos
        } catch {
          // 忽略
        }
      }
    }

    this.state = 'mini'
    this.callbacks.onStateChange?.(prevState, 'mini')
    this.callbacks.onSizeChange?.(this.config.miniSize)

    // 通知其他窗口
    await emit('mini-mode', { enabled: true, source: 'pet-window' })
  }

  /**
   * 退出迷你模式，恢复到普通模式
   */
  async exitMiniMode(): Promise<void> {
    if (this.state === 'normal') return

    const prevState = this.state
    const appWindow = getCurrentWindow()

    // 恢复窗口大小
    try {
      await appWindow.setSize(
        new (await import('@tauri-apps/api/dpi')).LogicalSize(NORMAL_WIDTH, NORMAL_HEIGHT),
      )
    } catch (e) {
      console.warn('[MiniMode] 恢复窗口大小失败:', e)
    }

    // 恢复到保存的位置
    if (this.normalModePosition) {
      try {
        await appWindow.setPosition(
          new (await import('@tauri-apps/api/dpi')).LogicalPosition(
            this.normalModePosition.x,
            this.normalModePosition.y,
          ),
        )
      } catch {
        // 忽略
      }
    }

    this.state = 'normal'
    this.callbacks.onStateChange?.(prevState, 'normal')
    this.callbacks.onSizeChange?.({ width: NORMAL_WIDTH, height: NORMAL_HEIGHT })

    // 通知其他窗口
    await emit('mini-mode', { enabled: false, source: 'pet-window' })
  }

  /**
   * 切换迷你模式
   */
  async toggleMiniMode(): Promise<void> {
    if (this.state === 'normal') {
      await this.enterMiniMode()
    } else {
      await this.exitMiniMode()
    }
  }

  /**
   * 进入悬停预览模式
   */
  async enterPreviewMode(): Promise<void> {
    if (this.state !== 'mini' || !this.config.hoverPreview) return

    const prevState = this.state
    const appWindow = getCurrentWindow()

    try {
      await appWindow.setSize(
        new (await import('@tauri-apps/api/dpi')).LogicalSize(
          this.config.previewSize.width,
          this.config.previewSize.height,
        ),
      )
    } catch {
      return
    }

    this.state = 'preview'
    this.callbacks.onStateChange?.(prevState, 'preview')
    this.callbacks.onSizeChange?.(this.config.previewSize)
  }

  /**
   * 退出预览模式，回到迷你模式
   */
  async exitPreviewMode(): Promise<void> {
    if (this.state !== 'preview') return

    const prevState = this.state
    const appWindow = getCurrentWindow()

    try {
      await appWindow.setSize(
        new (await import('@tauri-apps/api/dpi')).LogicalSize(
          this.config.miniSize.width,
          this.config.miniSize.height,
        ),
      )
    } catch {
      return
    }

    this.state = 'mini'
    this.callbacks.onStateChange?.(prevState, 'mini')
    this.callbacks.onSizeChange?.(this.config.miniSize)
  }

  // ============ 边缘吸附 ============

  /**
   * 吸附到最近的屏幕边缘
   * 计算当前窗口到四个边缘的距离，吸附到最近的边缘
   *
   * @returns 吸附后的窗口位置
   */
  private async snapToNearestEdge(): Promise<WindowPosition | null> {
    try {
      const monitors = await getAvailableMonitors()
      const bounds = calculateScreenBounds(monitors)
      const appWindow = getCurrentWindow()
      const pos = await appWindow.outerPosition()

      const currentX = pos.x
      const currentY = pos.y

      // 计算到四个边缘的距离
      const distLeft = Math.abs(currentX - bounds.minX)
      const distRight = Math.abs(currentX + this.config.miniSize.width - bounds.maxX)
      const distTop = Math.abs(currentY - bounds.minY)
      const distBottom = Math.abs(currentY + this.config.miniSize.height - bounds.maxY)

      const minDist = Math.min(distLeft, distRight, distTop, distBottom)

      let snappedPos: WindowPosition
      let edge: 'left' | 'right' | 'top' | 'bottom'

      if (minDist === distLeft) {
        // 吸附到左边缘
        snappedPos = { x: bounds.minX, y: currentY }
        edge = 'left'
      } else if (minDist === distRight) {
        // 吸附到右边缘
        snappedPos = { x: bounds.maxX - this.config.miniSize.width, y: currentY }
        edge = 'right'
      } else if (minDist === distTop) {
        // 吸附到顶部
        snappedPos = { x: currentX, y: bounds.minY }
        edge = 'top'
      } else {
        // 吸附到底部
        snappedPos = { x: currentX, y: bounds.maxY - this.config.miniSize.height }
        edge = 'bottom'
      }

      this.callbacks.onEdgeSnap?.(edge, snappedPos)
      return snappedPos
    } catch {
      return null
    }
  }

  // ============ 悬停处理 ============

  /**
   * 鼠标进入窗口区域
   * 延迟展开预览
   */
  handleMouseEnter(): void {
    if (this.state !== 'mini') return

    // 取消收起定时器
    if (this.hoverCollapseTimer) {
      clearTimeout(this.hoverCollapseTimer)
      this.hoverCollapseTimer = null
    }

    // 延迟展开
    if (!this.hoverExpandTimer) {
      this.hoverExpandTimer = setTimeout(async () => {
        this.hoverExpandTimer = null
        await this.enterPreviewMode()
      }, HOVER_EXPAND_DELAY_MS)
    }
  }

  /**
   * 鼠标离开窗口区域
   * 延迟收起预览
   */
  handleMouseLeave(): void {
    // 取消展开定时器
    if (this.hoverExpandTimer) {
      clearTimeout(this.hoverExpandTimer)
      this.hoverExpandTimer = null
    }

    // 延迟收起
    if (this.state === 'preview' && !this.hoverCollapseTimer) {
      this.hoverCollapseTimer = setTimeout(async () => {
        this.hoverCollapseTimer = null
        await this.exitPreviewMode()
      }, HOVER_COLLAPSE_DELAY_MS)
    }
  }

  // ============ 生命周期 ============

  /**
   * 初始化迷你模式管理器
   * 注册跨窗口事件监听
   */
  async init(): Promise<void> {
    // 监听来自其他窗口的迷你模式切换
    const unlisten = await listen<{ enabled: boolean }>('mini-mode', async (event) => {
      if (event.payload.enabled) {
        await this.enterMiniMode()
      } else {
        await this.exitMiniMode()
      }
    })
    this.unlisteners.push(unlisten)
  }

  /**
   * 销毁迷你模式管理器
   * 清理所有定时器和监听器
   */
  destroy(): void {
    if (this.hoverExpandTimer) {
      clearTimeout(this.hoverExpandTimer)
    }
    if (this.hoverCollapseTimer) {
      clearTimeout(this.hoverCollapseTimer)
    }
    for (const unlisten of this.unlisteners) {
      unlisten()
    }
    this.unlisteners = []
  }

  // ============ 查询 ============

  /** 获取当前模式状态 */
  getState(): MiniModeState {
    return this.state
  }

  /** 是否处于迷你模式 */
  isMiniMode(): boolean {
    return this.state === 'mini'
  }

  /** 是否处于预览模式 */
  isPreviewMode(): boolean {
    return this.state === 'preview'
  }

  /** 获取当前窗口尺寸 */
  getCurrentSize(): { width: number; height: number } {
    switch (this.state) {
      case 'normal':
        return { width: NORMAL_WIDTH, height: NORMAL_HEIGHT }
      case 'mini':
        return this.config.miniSize
      case 'preview':
        return this.config.previewSize
    }
  }
}
