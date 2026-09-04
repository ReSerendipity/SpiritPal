/**
 * 宠物运动引擎模块
 *
 * @fileoverview 实现宠物自动行走、边界碰撞、拖拽交互与心情联动的运动系统
 *
 * 主要模块：
 * - MovementState: 运动状态（idle/walking/bouncing/dragging）
 * - MovementConfig: 运动参数配置
 * - MovementEngine: 运动引擎主类（参考CodeWalkers useCharacterMovement.ts）
 *
 * 依赖关系：
 * - @tauri-apps/api/window: Tauri窗口位置/大小API
 * - multiMonitor.ts: 多显示器屏幕边界计算
 *
 * 核心接口：
 * - start(): 启动运动循环
 * - stop(): 停止运动
 * - setPosition(): 设置宠物位置（边界钳制）
 * - getPosition(): 获取当前位置
 * - startDrag()/endDrag(): 拖拽交互处理
 *
 * 核心机制（Chapter 8增强）：
 * 1. 梯形速度曲线：加速→匀速→减速，像素位移与动画帧同步
 * 2. 运动状态机：Idle（5-12s随机等待）→ Walking（10s循环）→ Idle
 * 3. 平滑转向：方向变化时300ms过渡
 * 4. 边界碰撞：碰到屏幕边缘时5px回弹
 * 5. 属性联动：开心时速度提升30%，伤心时降至60%
 * 6. 拖拽死区：3px内视为点击，超过视为拖拽
 */

// ============ 配置常量 ============

/** 行走动画总时长（秒） */
const WALK_DURATION_S = 10.0

/** 加速段开始时间（秒） */
const ACCEL_START_S = 3.0

/** 全速段开始时间（秒） */
const FULL_SPEED_START_S = 3.75

/** 减速段开始时间（秒） */
const DECEL_START_S = 8.0

/** 行走停止时间（秒） */
const WALK_STOP_S = 8.5

// 梯形速度曲线预计算常量（避免每帧重复计算）
const TRAPEZOID_D_IN = FULL_SPEED_START_S - ACCEL_START_S
const TRAPEZOID_D_LIN = DECEL_START_S - FULL_SPEED_START_S
const TRAPEZOID_D_OUT = WALK_STOP_S - DECEL_START_S
const TRAPEZOID_V = 1.0 / (TRAPEZOID_D_IN / 2.0 + TRAPEZOID_D_LIN + TRAPEZOID_D_OUT / 2.0)
const TRAPEZOID_EASE_IN_DIST = (TRAPEZOID_V * TRAPEZOID_D_IN) / 2.0
const TRAPEZOID_LINEAR_DIST = TRAPEZOID_V * TRAPEZOID_D_LIN

/** 最小等待时间（毫秒） */
const MIN_IDLE_MS = 5000

/** 最大等待时间（毫秒） */
const MAX_IDLE_MS = 12000

/** 行走距离范围（屏幕宽度的比例） */
const WALK_RATIO_MIN = 0.4
const WALK_RATIO_MAX = 0.65

/** 拖拽死区（像素）— 小于此距离视为点击 */
const DRAG_DEADZONE_PX = 3

/** 方向切换过渡时长（毫秒） */
const TURN_TRANSITION_MS = 300

/** 速度修正范围 — 基于宠物心情 */
const SPEED_MODIFIER_MIN = 0.6  // 心情低时速度降至 60%
const SPEED_MODIFIER_MAX = 1.3  // 心情高时速度升至 130%

/** 边界碰撞回弹距离（像素） */
const BOUNCE_BACK_PX = 5

// ============ 类型定义 ============

/** 运动状态机状态 */
export type MovementState = 'idle' | 'walking' | 'dragging'

/** 位置 */
export interface Position {
  x: number
  y: number
}

/** 运动引擎配置 */
export interface MovementConfig {
  /** 屏幕宽度（像素） */
  screenWidth: number
  /** 屏幕高度（像素） */
  screenHeight: number
  /** 角色宽度（像素） */
  characterWidth: number
  /** 角色高度（像素） */
  characterHeight: number
}

/** 运动引擎回调 */
export interface MovementCallbacks {
  /** 当位置更新时 */
  onPositionUpdate?: (position: Position) => void
  /** 当状态变化时 */
  onStateChange?: (from: MovementState, to: MovementState) => void
  /** 当方向变化时 */
  onDirectionChange?: (goingRight: boolean) => void
  /** 当动画需要播放时 */
  onWalkAnimationPlay?: () => void
  /** 当动画需要暂停时 */
  onWalkAnimationPause?: () => void
  /** 当动画需要重置时 */
  onWalkAnimationReset?: () => void
}

// ============ 运动引擎 ============

export class MovementEngine {
  private state: MovementState = 'idle'
  private position: Position = { x: 0, y: 0 }
  private direction = 1 // 1=向右, -1=向左
  private config: MovementConfig
  private callbacks: MovementCallbacks

  // 行走状态
  private walkStartPixel = 0
  private walkEndPixel = 0
  private walkStartTime = 0
  private goingRight = true

  // 空闲状态
  private idleEndTime = 0

  // 动画帧
  private animationFrameId: number | null = null
  private isRunning = false

  // 拖拽状态
  private isDragging = false
  private dragOffset: Position = { x: 0, y: 0 }
  private dragStartPos: Position = { x: 0, y: 0 }
  private hasMoved = false

  // Chapter 8 新增：速度修正（基于宠物属性）
  private speedModifier = 1.0

  // Chapter 8 新增：平滑转向
  private turnTransitionStart = 0
  private turnFromDirection = 1
  private turnToDirection = 1
  private isTurning = false

  // Chapter 8 新增：边界碰撞
  private lastBoundaryHit: 'left' | 'right' | null = null

  constructor(config: MovementConfig, callbacks: MovementCallbacks = {}) {
    this.config = config
    this.callbacks = callbacks
    this.position = {
      x: config.screenWidth / 2,
      y: config.screenHeight - config.characterHeight - 50,
    }
  }

  // ============ 梯形速度曲线 ============

  /**
   * 计算梯形速度曲线的归一化位移
   * 返回 0-1 的值，表示行走进度
   *
   * 分段积分（使用预计算常量，避免每帧重复计算）：
   * - 加速段 (accelStart → fullSpeedStart): v * t² / (2 * dIn)
   * - 匀速段 (fullSpeedStart → decelStart): easeInDist + v * t
   * - 减速段 (decelStart → walkStop): easeInDist + linearDist + v * (t - t²/(2*dOut))
   */
  private movementPosition(videoTime: number): number {
    if (videoTime <= ACCEL_START_S) return 0.0

    if (videoTime <= FULL_SPEED_START_S) {
      const t = videoTime - ACCEL_START_S
      return (TRAPEZOID_V * t * t) / (2.0 * TRAPEZOID_D_IN)
    }

    if (videoTime <= DECEL_START_S) {
      const t = videoTime - FULL_SPEED_START_S
      return TRAPEZOID_EASE_IN_DIST + TRAPEZOID_V * t
    }

    if (videoTime <= WALK_STOP_S) {
      const t = videoTime - DECEL_START_S
      return TRAPEZOID_EASE_IN_DIST + TRAPEZOID_LINEAR_DIST + TRAPEZOID_V * (t - (t * t) / (2.0 * TRAPEZOID_D_OUT))
    }

    return 1.0
  }

  /** 安全调用回调（异常保护） */
  private safeCallback<T extends (...args: never[]) => void>(fn: T | undefined, ...args: Parameters<T>): void {
    if (!fn) return
    try { fn(...args) } catch (e) { console.error('[MovementEngine] callback error:', e) }
  }

  // ============ 状态机 ============

  /**
   * 更新运动状态（每帧调用）
   * @param timestamp 当前时间戳（毫秒）
   * @returns 当前位置
   */
  update(timestamp: number): Position {
    if (this.isDragging) return this.position

    switch (this.state) {
      case 'idle':
        this.updateIdle(timestamp)
        break
      case 'walking':
        this.updateWalking(timestamp)
        break
    }

    return this.position
  }

  private updateIdle(timestamp: number): void {
    // 检查空闲时间是否结束
    if (timestamp >= this.idleEndTime) {
      this.startWalking(timestamp)
    }
  }

  private startWalking(timestamp: number): void {
    this.state = 'walking'
    this.walkStartTime = timestamp

    // 决定行走方向
    const screenRatio = this.position.x / this.config.screenWidth
    let newGoingRight: boolean
    if (screenRatio > 0.85) {
      newGoingRight = false
    } else if (screenRatio < 0.15) {
      newGoingRight = true
    } else {
      newGoingRight = Math.random() > 0.5
    }

    // Chapter 8: 平滑转向 — 方向变化时触发过渡动画
    if (this.goingRight !== newGoingRight) {
      this.startTurnTransition(newGoingRight ? 1 : -1, timestamp)
    }

    this.goingRight = newGoingRight
    this.direction = this.goingRight ? 1 : -1

    // 计算行走距离（屏幕宽度的比例，乘以速度修正）
    const walkRatio = WALK_RATIO_MIN + Math.random() * (WALK_RATIO_MAX - WALK_RATIO_MIN)
    const walkPixels = walkRatio * this.config.screenWidth * this.speedModifier
    const maxX = this.config.screenWidth - this.config.characterWidth
    const minX = 0

    this.walkStartPixel = this.position.x
    this.walkEndPixel = this.goingRight
      ? Math.min(this.position.x + walkPixels, maxX)
      : Math.max(this.position.x - walkPixels, minX)

    this.safeCallback(this.callbacks.onStateChange, 'idle', 'walking')
    this.safeCallback(this.callbacks.onDirectionChange, this.goingRight)
    this.safeCallback(this.callbacks.onWalkAnimationPlay)
  }

  private updateWalking(timestamp: number): void {
    // Chapter 8: 应用速度修正到行走时长
    const effectiveDuration = WALK_DURATION_S / this.speedModifier
    const elapsed = (timestamp - this.walkStartTime) / 1000.0
    const videoTime = Math.min(elapsed, effectiveDuration)
    const walkNorm = elapsed >= effectiveDuration ? 1.0 : this.movementPosition(videoTime)

    const currentPixel =
      this.walkStartPixel + (this.walkEndPixel - this.walkStartPixel) * walkNorm

    this.position.x = currentPixel
    this.safeCallback(this.callbacks.onPositionUpdate, this.position)

    // Chapter 8: 边界碰撞检测
    this.handleBoundaryCollision()

    // 行走结束 → 回到 idle
    if (elapsed >= effectiveDuration) {
      this.position.x = currentPixel
      this.state = 'idle'
      this.idleEndTime = timestamp + MIN_IDLE_MS + Math.random() * (MAX_IDLE_MS - MIN_IDLE_MS)

      this.safeCallback(this.callbacks.onStateChange, 'walking', 'idle')
      this.safeCallback(this.callbacks.onWalkAnimationPause)
      this.safeCallback(this.callbacks.onWalkAnimationReset)
    }
  }

  // ============ 拖拽交互 ============

  /**
   * 开始拖拽
   * @param mouseX 鼠标屏幕 X
   * @param mouseY 鼠标屏幕 Y
   */
  startDrag(mouseX: number, mouseY: number): void {
    this.isDragging = true
    this.hasMoved = false
    this.dragStartPos = { x: mouseX, y: mouseY }
    this.dragOffset = {
      x: mouseX - this.position.x,
      y: mouseY - this.position.y,
    }

    if (this.state === 'walking') {
      this.state = 'idle'
      this.safeCallback(this.callbacks.onStateChange, 'walking', 'dragging')
      this.safeCallback(this.callbacks.onWalkAnimationPause)
    } else {
      this.safeCallback(this.callbacks.onStateChange, this.state, 'dragging')
    }
    this.state = 'dragging'
  }

  /**
   * 更新拖拽位置
   * @param mouseX 鼠标屏幕 X
   * @param mouseY 鼠标屏幕 Y
   */
  updateDrag(mouseX: number, mouseY: number): void {
    if (!this.isDragging) return

    const dx = mouseX - this.dragStartPos.x
    const dy = mouseY - this.dragStartPos.y

    // 3px 死区
    if (Math.abs(dx) > DRAG_DEADZONE_PX || Math.abs(dy) > DRAG_DEADZONE_PX) {
      this.hasMoved = true
    }

    const newX = mouseX - this.dragOffset.x
    const newY = mouseY - this.dragOffset.y

    // 边界限制
    const maxX = this.config.screenWidth - this.config.characterWidth
    const maxY = this.config.screenHeight - this.config.characterHeight

    this.position.x = Math.max(0, Math.min(newX, maxX))
    this.position.y = Math.max(0, Math.min(newY, maxY))

    this.safeCallback(this.callbacks.onPositionUpdate, this.position)
  }

  /**
   * 结束拖拽
   * @param timestamp 可选，当前时间戳（保持与动画帧时间一致）
   */
  endDrag(timestamp?: number): void {
    if (!this.isDragging) return
    this.isDragging = false

    // 开始新的空闲计时（使用传入的timestamp或Date.now()，保持时间一致性）
    const now = timestamp ?? Date.now()
    this.idleEndTime = now + MIN_IDLE_MS + Math.random() * (MAX_IDLE_MS - MIN_IDLE_MS)

    this.safeCallback(this.callbacks.onStateChange, 'dragging', 'idle')
  }

  /** 获取是否实际发生了移动（区分点击和拖拽） */
  getHasMoved(): boolean {
    return this.hasMoved
  }

  // ============ 生命周期 ============

  /** 启动运动引擎 */
  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.idleEndTime =
      Date.now() + MIN_IDLE_MS + Math.random() * (MAX_IDLE_MS - MIN_IDLE_MS)

    const loop = (timestamp: number) => {
      if (!this.isRunning) return
      this.update(timestamp)
      this.animationFrameId = requestAnimationFrame(loop)
    }
    this.animationFrameId = requestAnimationFrame(loop)
  }

  /** 停止运动引擎 */
  stop(): void {
    this.isRunning = false
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
  }

  /** 重置到初始状态 */
  reset(): void {
    this.stop()
    this.state = 'idle'
    this.position.x = this.config.screenWidth / 2
    this.position.y = this.config.screenHeight - this.config.characterHeight - 50
    this.isDragging = false
    this.hasMoved = false
    this.lastBoundaryHit = null
    this.isTurning = false
    this.safeCallback(this.callbacks.onPositionUpdate, this.position)
  }

  /**
   * 更新配置（屏幕分辨率变化时调用）
   */
  updateConfig(config: Partial<MovementConfig>): void {
    this.config = { ...this.config, ...config }
    // 位置钳制到新边界内
    const maxX = this.config.screenWidth - this.config.characterWidth
    const maxY = this.config.screenHeight - this.config.characterHeight
    this.position.x = Math.max(0, Math.min(this.position.x, maxX))
    this.position.y = Math.max(0, Math.min(this.position.y, maxY))
  }

  /** 销毁引擎：停止动画帧并清理回调 */
  dispose(): void {
    this.stop()
    this.callbacks = {}
  }

  // ============ Chapter 8 新增：速度修正 ============

  /**
   * 根据宠物属性设置速度修正
   * 心情高 → 更快，心情低 → 更慢
   * @param mood 心情值 0-100
   * @param hunger 饱食度 0-100
   */
  setSpeedModifierFromStats(mood: number, hunger: number): void {
    // 心情权重 60%，饱食度权重 40%
    const moodFactor = mood / 100 // 0-1
    const hungerFactor = hunger / 100 // 0-1
    const combined = moodFactor * 0.6 + hungerFactor * 0.4
    // 映射到 [SPEED_MODIFIER_MIN, SPEED_MODIFIER_MAX]
    this.speedModifier = SPEED_MODIFIER_MIN + combined * (SPEED_MODIFIER_MAX - SPEED_MODIFIER_MIN)
  }

  /** 直接设置速度修正 */
  setSpeedModifier(modifier: number): void {
    this.speedModifier = Math.max(SPEED_MODIFIER_MIN, Math.min(modifier, SPEED_MODIFIER_MAX))
  }

  /** 获取当前速度修正 */
  getSpeedModifier(): number {
    return this.speedModifier
  }

  // ============ Chapter 8 新增：平滑转向 ============

  /**
   * 开始转向过渡
   * 在方向切换时产生平滑的视觉过渡效果
   */
  private startTurnTransition(newDirection: number, timestamp: number): void {
    if (this.direction === newDirection) return
    this.turnFromDirection = this.direction
    this.turnToDirection = newDirection
    this.turnTransitionStart = timestamp
    this.isTurning = true
    this.direction = newDirection
  }

  /**
   * 更新转向过渡
   * @returns 当前视觉方向（0-1 的过渡值，0=左, 1=右）
   */
  private updateTurnTransition(timestamp: number): number {
    if (!this.isTurning) return this.direction === 1 ? 1 : 0

    const elapsed = timestamp - this.turnTransitionStart
    const progress = Math.min(elapsed / TURN_TRANSITION_MS, 1)

    if (progress >= 1) {
      this.isTurning = false
      return this.turnToDirection === 1 ? 1 : 0
    }

    // 使用 ease-in-out 缓动
    const eased = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2

    const from = this.turnFromDirection === 1 ? 1 : 0
    const to = this.turnToDirection === 1 ? 1 : 0
    return from + (to - from) * eased
  }

  // ============ Chapter 8 新增：边界碰撞 ============

  /**
   * 处理屏幕边界碰撞
   * 碰撞时产生微小回弹 + 重新计算行走路径（避免位置跳变）
   */
  private handleBoundaryCollision(): void {
    const maxX = this.config.screenWidth - this.config.characterWidth
    const minX = 0

    if (this.position.x <= minX) {
      this.position.x = BOUNCE_BACK_PX
      this.lastBoundaryHit = 'left'
      if (this.state === 'walking') {
        // 碰到左边界，转向右并重置行走路径（关键：更新walkStartPixel避免插值跳变）
        this.goingRight = true
        this.direction = 1
        this.walkStartPixel = this.position.x
        this.walkEndPixel = Math.min(this.position.x + this.config.screenWidth * 0.3, maxX)
        this.walkStartTime = performance.now() // 重置行走计时，重新走加速曲线
        this.safeCallback(this.callbacks.onDirectionChange, true)
      }
    } else if (this.position.x >= maxX) {
      this.position.x = maxX - BOUNCE_BACK_PX
      this.lastBoundaryHit = 'right'
      if (this.state === 'walking') {
        // 碰到右边界，转向左并重置行走路径
        this.goingRight = false
        this.direction = -1
        this.walkStartPixel = this.position.x
        this.walkEndPixel = Math.max(this.position.x - this.config.screenWidth * 0.3, minX)
        this.walkStartTime = performance.now()
        this.safeCallback(this.callbacks.onDirectionChange, false)
      }
    } else {
      this.lastBoundaryHit = null
    }
  }

  /** 获取上次边界碰撞方向 */
  getLastBoundaryHit(): 'left' | 'right' | null {
    return this.lastBoundaryHit
  }

  /** 是否正在转向中 */
  getIsTurning(): boolean {
    return this.isTurning
  }

  // ============ 查询 ============

  getState(): MovementState { return this.state }
  getPosition(): Position { return { ...this.position } }
  getDirection(): number { return this.direction }
  isGoingRight(): boolean { return this.goingRight }
}
