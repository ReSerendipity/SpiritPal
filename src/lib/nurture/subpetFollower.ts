/**
 * 副宠跟随算法模块
 *
 * @fileoverview 基于弹簧-阻尼（spring-damper）模型的副宠弹性跟随
 *
 * 主要模块：
 * - SubpetFollowerConfig: 跟随参数（stiffness / damping / maxSpeed）
 * - SubpetFollower: 弹性跟随器（半隐式欧拉积分 + 速度钳制）
 * - computeFanOffsets(): 多只副宠的扇形排列偏移
 *
 * 物理模型：
 * 副宠与主宠之间用一根弹簧连接，弹簧原长 = 配置偏移 offset。
 * 期望位置 = 主宠位置 + offset，弹簧力把副宠拉向期望位置，
 * 阻尼项消耗动能以避免振荡。
 *
 *   a = stiffness * (desired - pos) - damping * vel
 *   vel += a * dt
 *   pos += vel * dt
 *
 * 核心接口：
 * - update(dt, targetPos): 推进一帧，返回副宠当前位置
 * - setOffset(): 设置相对主宠的期望偏移
 * - computeFanOffsets(): 多副宠扇形分布
 */

import type { Position } from '@/lib/render/movementEngine'

// ============ 默认参数 ============

/** 默认弹簧刚度（越大跟随越紧、越容易过冲振荡） */
export const DEFAULT_STIFFNESS = 140
/** 默认阻尼系数（临界阻尼 ≈ 2·√stiffness，取略过阻尼保证收敛不振荡） */
export const DEFAULT_DAMPING = 24
/** 默认最大速度（像素/秒）— 防止主宠瞬移时副宠飞出屏幕 */
export const DEFAULT_MAX_SPEED = 420

// ============ 类型 ============

/** 跟随器参数 */
export interface SubpetFollowerConfig {
  /** 弹簧刚度（像素/秒² 每像素偏移） */
  stiffness: number
  /** 阻尼系数（速度每像素/秒的衰减） */
  damping: number
  /** 最大速度钳制（像素/秒） */
  maxSpeed: number
}

/** 默认配置（略过阻尼，保证稳定收敛） */
export const DEFAULT_FOLLOWER_CONFIG: SubpetFollowerConfig = {
  stiffness: DEFAULT_STIFFNESS,
  damping: DEFAULT_DAMPING,
  maxSpeed: DEFAULT_MAX_SPEED,
}

// ============ 跟随器 ============

/**
 * 弹性跟随器
 *
 * 每帧传入主宠位置，跟随器自行用弹簧-阻尼模型计算副宠位置。
 * 与渲染层解耦，纯数值计算，便于单元测试。
 *
 * @example
 * ```ts
 * const follower = new SubpetFollower({ x: 0, y: 0 })
 * follower.setOffset(40, 0)
 * for (let i = 0; i < 60 * 5; i++) {
 *   const p = follower.update(1 / 60, { x: 500, y: 400 })
 * }
 * // p 收敛到 (540, 400) 附近
 * ```
 */
export class SubpetFollower {
  private position: Position
  private velocity: Position = { x: 0, y: 0 }
  private offset: Position = { x: 0, y: 0 }
  private config: SubpetFollowerConfig

  /**
   * @param start 副宠初始位置
   * @param config 覆盖默认跟随参数
   * @param offset 相对主宠的期望偏移
   */
  constructor(
    start: Position,
    config?: Partial<SubpetFollowerConfig>,
    offset?: Position,
  ) {
    this.position = { ...start }
    this.config = { ...DEFAULT_FOLLOWER_CONFIG, ...(config ?? {}) }
    if (offset) this.offset = { ...offset }
  }

  /**
   * 推进一帧
   *
   * 半隐式欧拉积分：先更新速度，再用新速度更新位置。
   * 对 dt 做钳制（最大 1/30s），避免后台标签页恢复时大 dt 爆炸。
   *
   * @param dt 帧间隔（秒）
   * @param targetPos 主宠当前位置
   * @returns 副宠当前位置（拷贝，外部修改不影响内部状态）
   */
  update(dt: number, targetPos: Position): Position {
    const clampedDt = Math.max(0, Math.min(dt, 1 / 30))
    if (clampedDt === 0) return { ...this.position }

    const desiredX = targetPos.x + this.offset.x
    const desiredY = targetPos.y + this.offset.y

    // 弹簧力 + 阻尼力
    const ax = this.config.stiffness * (desiredX - this.position.x) - this.config.damping * this.velocity.x
    const ay = this.config.stiffness * (desiredY - this.position.y) - this.config.damping * this.velocity.y

    this.velocity.x += ax * clampedDt
    this.velocity.y += ay * clampedDt

    // 速度钳制（防止主宠瞬移时副宠冲出屏幕）
    const speed = Math.hypot(this.velocity.x, this.velocity.y)
    if (speed > this.config.maxSpeed) {
      const scale = this.config.maxSpeed / speed
      this.velocity.x *= scale
      this.velocity.y *= scale
    }

    this.position.x += this.velocity.x * clampedDt
    this.position.y += this.velocity.y * clampedDt

    return { ...this.position }
  }

  /** 设置相对主宠的期望偏移 */
  setOffset(x: number, y: number): void {
    this.offset = { x, y }
  }

  /** 直接设置副宠位置（召唤时把副宠放到主宠身边） */
  setPosition(pos: Position): void {
    this.position = { ...pos }
    this.velocity = { x: 0, y: 0 }
  }

  /** 获取当前位置（拷贝） */
  getPosition(): Position {
    return { ...this.position }
  }

  /** 获取当前速度（拷贝）— 主要用于测试收敛性 */
  getVelocity(): Position {
    return { ...this.velocity }
  }

  /** 更新跟随参数（允许运行中调整刚度/阻尼） */
  setConfig(config: Partial<SubpetFollowerConfig>): void {
    this.config = { ...this.config, ...config }
  }
}

// ============ 多副宠排列 ============

/**
 * 计算多只副宠的扇形排列偏移
 *
 * 在主宠身后（下方偏后）展开一段 120° 的扇形弧线，
 * 避免多只副宠叠在同一像素上。
 *
 * @param index 当前副宠序号（从 0 开始）
 * @param total 副宠总数
 * @param radius 扇形半径（像素，默认 56）
 * @returns 相对主宠的偏移 { x, y }
 */
export function computeFanOffset(index: number, total: number, radius = 56): Position {
  if (total <= 0) return { x: 0, y: 0 }
  if (total === 1) return { x: 0, y: 0 }

  // 扇形角度范围：-60° ~ +60°（弧度），以正下方为中心
  const startAngle = -Math.PI / 3
  const endAngle = Math.PI / 3
  const step = (endAngle - startAngle) / (total - 1)
  const angle = startAngle + step * index

  return {
    x: Math.sin(angle) * radius,
    y: Math.cos(angle) * radius,
  }
}

/**
 * 批量生成 count 只副宠的扇形偏移
 *
 * @param count 副宠数量
 * @param radius 扇形半径
 * @returns 偏移数组（长度 = count）
 */
export function computeFanOffsets(count: number, radius = 56): Position[] {
  return Array.from({ length: count }, (_, i) => computeFanOffset(i, count, radius))
}
