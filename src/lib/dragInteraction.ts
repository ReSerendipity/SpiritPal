/**
 * 拖拽交互优化 — 3px 死区区分点击 vs 拖拽 + 前倾放大效果 + 释放弹跳动画
 * 参考 CodeWalkers/clawd-on-desk
 *
 * @fileoverview
 * 主要模块：
 * - 配置常量：DRAG_DEADZONE_PX(3px), DRAG_SCALE_UP(1.1), BOUNCE_DURATION_MS(400ms), BOUNCE_KEYFRAMES 等
 * - DragState 类型：拖拽状态机状态（idle/pressing/dragging/releasing）
 * - DragPosition 接口：位置坐标
 * - DragInteractionCallbacks 接口：拖拽交互回调
 * - DragInteraction 类：拖拽交互管理器，支持死区判定、前倾放大、弹跳动画、状态机
 *
 * 功能：
 * - 3px 死区 — 小于此距离视为点击，大于等于视为拖拽
 * - 前倾放大效果 — 拖拽时 scale 从 1.0 → 1.1
 * - 释放弹跳动画 — 松手后弹跳回弹效果
 * - 拖拽状态机：idle → pressing → dragging → releasing → idle
 * - 触觉反馈预留（目前仅视觉）
 *
 * @module dragInteraction
 */

import { EventEmitter } from 'events'

// ============ 配置常量 ============

/** 拖拽死区（像素）— 小于此距离视为点击 */
export const DRAG_DEADZONE_PX = 3

/** 拖拽时放大比例 */
export const DRAG_SCALE_UP = 1.1

/** 正常状态比例 */
export const NORMAL_SCALE = 1.0

/** 弹跳动画时长（毫秒） */
export const BOUNCE_DURATION_MS = 400

/** 弹跳关键帧（缩放比例序列） */
export const BOUNCE_KEYFRAMES = [1.1, 0.95, 1.02, 1.0]

/** 前倾角度（弧度）— 微微前倾表示被提起 */
export const LEAN_ANGLE_RAD = -0.08

/** 按压判定延迟（毫秒）— 短于此时间视为点击 */
export const CLICK_THRESHOLD_MS = 200

// ============ 类型定义 ============

/** 拖拽状态机状态 */
export type DragState = 'idle' | 'pressing' | 'dragging' | 'releasing'

/** 位置 */
export interface DragPosition {
  x: number
  y: number
}

/** 拖拽交互回调 */
export interface DragInteractionCallbacks {
  /** 位置更新时 */
  onPositionUpdate?: (position: DragPosition) => void
  /** 状态变化时 */
  onStateChange?: (from: DragState, to: DragState) => void
  /** 缩放变化时 */
  onScaleChange?: (scale: number) => void
  /** 前倾角度变化时 */
  onLeanChange?: (angle: number) => void
  /** 弹跳动画开始时 */
  onBounceStart?: (keyframes: number[]) => void
  /** 弹跳动画结束时 */
  onBounceEnd?: () => void
  /** 触发点击时（死区内释放） */
  onClick?: (position: DragPosition) => void
  /** 触发拖拽开始时 */
  onDragStart?: (position: DragPosition) => void
  /** 触发拖拽结束时 */
  onDragEnd?: (position: DragPosition) => void
}

/** 拖拽交互事件 */
export interface DragInteractionEvents {
  /** 状态变化 */
  'state-change': (from: DragState, to: DragState) => void
  /** 缩放变化 */
  'scale-change': (scale: number) => void
  /** 点击事件 */
  'click': (position: DragPosition) => void
  /** 拖拽开始 */
  'drag-start': (position: DragPosition) => void
  /** 拖拽结束 */
  'drag-end': (position: DragPosition) => void
  /** 弹跳动画开始 */
  'bounce-start': () => void
  /** 弹跳动画结束 */
  'bounce-end': () => void
}

// ============ 弹跳缓动函数 ============

/**
 * 弹跳缓动函数
 * 模拟弹簧阻尼运动
 *
 * @param t 归一化时间 0-1
 * @returns 缩放比例
 */
export function bounceEasing(t: number): number {
  if (t <= 0) return DRAG_SCALE_UP
  if (t >= 1) return NORMAL_SCALE

  // 从 DRAG_SCALE_UP 弹跳到 NORMAL_SCALE
  // 使用阻尼正弦函数
  const decay = Math.exp(-8 * t) // 阻尼衰减
  const oscillation = Math.cos(t * Math.PI * 3) // 3 次振荡
  return NORMAL_SCALE + (DRAG_SCALE_UP - NORMAL_SCALE) * decay * oscillation
}

/**
 * 根据弹跳关键帧插值
 * @param progress 弹跳进度 0-1
 * @returns 缩放比例
 */
export function bounceKeyframeInterpolation(progress: number): number {
  if (progress <= 0) return BOUNCE_KEYFRAMES[0]
  if (progress >= 1) return BOUNCE_KEYFRAMES[BOUNCE_KEYFRAMES.length - 1]

  const segmentCount = BOUNCE_KEYFRAMES.length - 1
  const segmentProgress = progress * segmentCount
  const segmentIndex = Math.min(Math.floor(segmentProgress), segmentCount - 1)
  const localProgress = segmentProgress - segmentIndex

  const from = BOUNCE_KEYFRAMES[segmentIndex]
  const to = BOUNCE_KEYFRAMES[Math.min(segmentIndex + 1, segmentCount)]

  // 使用 ease-out 插值
  const easedProgress = 1 - Math.pow(1 - localProgress, 2)
  return from + (to - from) * easedProgress
}

// ============ 拖拽交互引擎 ============

export class DragInteractionEngine extends EventEmitter {
  private state: DragState = 'idle'
  private position: DragPosition = { x: 0, y: 0 }
  private scale = NORMAL_SCALE
  private leanAngle = 0

  // 按压状态
  private pressStartTime = 0
  private pressStartPosition: DragPosition = { x: 0, y: 0 }
  private dragOffset: DragPosition = { x: 0, y: 0 }

  // 边界限制
  private bounds: { minX: number; maxX: number; minY: number; maxY: number }

  // 弹跳动画
  private bounceStartTime = 0
  private bounceAnimFrame: number | null = null

  // 配置
  private deadzone: number
  private scaleUp: number
  private bounceDuration: number

  constructor(options?: {
    bounds?: { minX: number; maxX: number; minY: number; maxY: number }
    deadzone?: number
    scaleUp?: number
    bounceDuration?: number
  }) {
    super()
    this.bounds = options?.bounds ?? { minX: 0, maxX: Infinity, minY: 0, maxY: Infinity }
    this.deadzone = options?.deadzone ?? DRAG_DEADZONE_PX
    this.scaleUp = options?.scaleUp ?? DRAG_SCALE_UP
    this.bounceDuration = options?.bounceDuration ?? BOUNCE_DURATION_MS
  }

  // ============ 指针事件处理 ============

  /**
   * 处理指针按下
   * @param x 指针 X 坐标
   * @param y 指针 Y 坐标
   */
  onPointerDown(x: number, y: number): void {
    if (this.state !== 'idle') return

    this.pressStartTime = Date.now()
    this.pressStartPosition = { x, y }
    this.dragOffset = {
      x: x - this.position.x,
      y: y - this.position.y,
    }

    this.setState('pressing')
  }

  /**
   * 处理指针移动
   * @param x 指针 X 坐标
   * @param y 指针 Y 坐标
   */
  onPointerMove(x: number, y: number): void {
    if (this.state === 'idle') return

    const dx = x - this.pressStartPosition.x
    const dy = y - this.pressStartPosition.y
    const distance = Math.sqrt(dx * dx + dy * dy)

    // 从 pressing 转为 dragging
    if (this.state === 'pressing' && distance >= this.deadzone) {
      this.setState('dragging')
      this.setScale(this.scaleUp)
      this.setLean(LEAN_ANGLE_RAD)
      this.emit('drag-start', this.position)
    }

    // 更新拖拽位置
    if (this.state === 'dragging') {
      const newX = Math.max(this.bounds.minX, Math.min(x - this.dragOffset.x, this.bounds.maxX))
      const newY = Math.max(this.bounds.minY, Math.min(y - this.dragOffset.y, this.bounds.maxY))

      this.position = { x: newX, y: newY }
      this.emit('position-update', this.position)
    }
  }

  /**
   * 处理指针释放
   */
  onPointerUp(): void {
    if (this.state === 'idle') return

    const pressDuration = Date.now() - this.pressStartTime
    const dx = this.position.x - this.pressStartPosition.x + this.dragOffset.x
    const dy = this.position.y - this.pressStartPosition.y + this.dragOffset.y
    const distance = Math.sqrt(dx * dx + dy * dy)

    if (this.state === 'pressing') {
      // 没有超出死区 → 点击
      if (distance < this.deadzone || pressDuration < CLICK_THRESHOLD_MS) {
        this.emit('click', this.position)
      }
      this.setState('idle')
      return
    }

    if (this.state === 'dragging') {
      // 拖拽结束 → 释放 + 弹跳
      this.emit('drag-end', this.position)
      this.setState('releasing')
      this.startBounceAnimation()
    }
  }

  /**
   * 处理指针取消（如鼠标离开窗口）
   */
  onPointerCancel(): void {
    if (this.state === 'dragging') {
      this.emit('drag-end', this.position)
    }
    this.cancelBounceAnimation()
    this.setScale(NORMAL_SCALE)
    this.setLean(0)
    this.setState('idle')
  }

  // ============ 弹跳动画 ============

  /** 启动弹跳动画 */
  private startBounceAnimation(): void {
    this.cancelBounceAnimation()
    this.bounceStartTime = Date.now()
    this.emit('bounce-start')

    const animate = () => {
      const elapsed = Date.now() - this.bounceStartTime
      const progress = Math.min(elapsed / this.bounceDuration, 1)

      const scale = bounceKeyframeInterpolation(progress)
      this.setScale(scale)

      if (progress < 1) {
        this.bounceAnimFrame = requestAnimationFrame(animate)
      } else {
        this.bounceAnimFrame = null
        this.setScale(NORMAL_SCALE)
        this.setLean(0)
        this.setState('idle')
        this.emit('bounce-end')
      }
    }

    this.bounceAnimFrame = requestAnimationFrame(animate)
  }

  /** 取消弹跳动画 */
  private cancelBounceAnimation(): void {
    if (this.bounceAnimFrame !== null) {
      cancelAnimationFrame(this.bounceAnimFrame)
      this.bounceAnimFrame = null
    }
  }

  // ============ 状态更新 ============

  /** 更新状态 */
  private setState(newState: DragState): void {
    if (this.state === newState) return
    const prev = this.state
    this.state = newState
    this.emit('state-change', prev, newState)
  }

  /** 更新缩放 */
  private setScale(scale: number): void {
    if (this.scale === scale) return
    this.scale = scale
    this.emit('scale-change', scale)
  }

  /** 更新前倾角度 */
  private setLean(angle: number): void {
    if (this.leanAngle === angle) return
    this.leanAngle = angle
    this.emit('lean-change', angle)
  }

  // ============ 查询 ============

  /** 获取当前状态 */
  getState(): DragState { return this.state }

  /** 获取当前位置 */
  getPosition(): DragPosition { return { ...this.position } }

  /** 获取当前缩放 */
  getScale(): number { return this.scale }

  /** 获取当前前倾角度 */
  getLeanAngle(): number { return this.leanAngle }

  /** 设置初始位置 */
  setPosition(x: number, y: number): void {
    this.position = { x, y }
  }

  /** 设置边界 */
  setBounds(bounds: { minX: number; maxX: number; minY: number; maxY: number }): void {
    this.bounds = bounds
  }

  /** 判断当前是否处于拖拽中 */
  isDragging(): boolean {
    return this.state === 'dragging'
  }

  /** 判断是否在按压中（可能即将进入拖拽） */
  isPressing(): boolean {
    return this.state === 'pressing'
  }

  /** 销毁引擎 */
  destroy(): void {
    this.cancelBounceAnimation()
    this.removeAllListeners()
  }
}

// ============ 单例 ============

let dragInteractionEngine: DragInteractionEngine | null = null

/** 获取拖拽交互引擎单例 */
export function getDragInteractionEngine(): DragInteractionEngine {
  if (!dragInteractionEngine) {
    dragInteractionEngine = new DragInteractionEngine()
  }
  return dragInteractionEngine
}

/** 重置拖拽交互引擎 */
export function resetDragInteractionEngine(): void {
  if (dragInteractionEngine) {
    dragInteractionEngine.destroy()
    dragInteractionEngine = null
  }
}
