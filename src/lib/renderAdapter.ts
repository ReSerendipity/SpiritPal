/**
 * 渲染适配器模块
 *
 * @fileoverview 策略模式统一渲染接口，支持Live2D/Image/Null三种适配器，带自动回退链（参考Live2DPet）
 *
 * 主要模块：
 * - AdapterType: 适配器类型（live2d/image/null）
 * - RenderAdapter: 渲染适配器通用接口
 * - Live2DAdapter: Live2D模型渲染适配器
 * - ImageAdapter: 图片序列渲染适配器
 * - NullAdapter: 空适配器（无渲染，用于降级）
 * - createAdapter(): 适配器工厂函数
 *
 * 依赖关系：
 * - events: Node.js EventEmitter
 * - animationConfig.ts: AnimationId动画ID类型
 *
 * 核心接口：
 * - play(animationId): 播放指定动画
 * - stop(): 停止当前动画
 * - setExpression(expression): 设置表情
 * - setIdle(): 设置空闲状态
 * - getPosition()/setPosition(): 获取/设置位置
 * - setScale()/getScale(): 缩放控制
 * - destroy(): 销毁适配器释放资源
 *
 * 回退链（参考Live2DPet）：
 * Live2D可用 → Live2D适配器
 * Live2D不可用 → Image适配器（精灵图动画）
 * Image也不可用 → Null适配器（空渲染，保证不崩溃）
 */

import { EventEmitter } from 'events'
import type { AnimationId } from './animationConfig'

// ============ 通用渲染接口 ============

/** 渲染适配器类型 */
export type AdapterType = 'live2d' | 'image' | 'null'

/** 渲染适配器通用接口 */
export interface RenderAdapter {
  /** 适配器类型 */
  readonly type: AdapterType

  /** 播放动画 */
  play(animationId: AnimationId): void

  /** 停止动画 */
  stop(): void

  /** 设置表情 */
  setExpression(expression: string): void

  /** 设置空闲状态 */
  setIdle(): void

  /** 获取角色位置 */
  getPosition(): { x: number; y: number }

  /** 设置角色位置 */
  setPosition(x: number, y: number): void

  /** 设置缩放 */
  setScale(scale: number): void

  /** 获取缩放 */
  getScale(): number

  /** 销毁适配器 */
  destroy(): void
}

/** 适配器事件 */
export interface RenderAdapterEvents {
  /** 动画播放 */
  'animation-play': (animationId: AnimationId) => void
  /** 动画停止 */
  'animation-stop': () => void
  /** 表情变化 */
  'expression-change': (expression: string) => void
  /** 位置变化 */
  'position-change': (x: number, y: number) => void
  /** 适配器切换 */
  'adapter-switch': (from: AdapterType, to: AdapterType) => void
  /** 适配器错误 */
  'adapter-error': (error: Error) => void
}

// ============ Live2D 适配器 ============

/** Live2D 适配器配置 */
export interface Live2DAdapterConfig {
  /** 模型路径 */
  modelPath: string
  /** 初始位置 */
  initialPosition?: { x: number; y: number }
  /** 初始缩放 */
  initialScale?: number
}

/**
 * Live2D 渲染适配器
 * 通过 pixi-live2d-display 加载和操控 Live2D 模型
 */
export class Live2DAdapter extends EventEmitter implements RenderAdapter {
  readonly type: AdapterType = 'live2d'
  private model: unknown = null // Live2DModel 实例
  private position = { x: 0, y: 0 }
  private scale = 1.0
  private config: Live2DAdapterConfig
  private currentAnimation: AnimationId | null = null

  constructor(config: Live2DAdapterConfig) {
    super()
    this.config = config
    this.position = config.initialPosition ?? { x: 0, y: 0 }
    this.scale = config.initialScale ?? 1.0
  }

  play(animationId: AnimationId): void {
    this.currentAnimation = animationId
    this.emit('animation-play', animationId)
    // 实际的 Live2D motion 播放由集成层处理
    // 此处仅记录状态和触发事件
    if (this.model && typeof (this.model as any).motion === 'function') {
      try {
        (this.model as any).motion(animationId)
      } catch (err) {
        this.emit('adapter-error', err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  stop(): void {
    this.currentAnimation = null
    this.emit('animation-stop')
  }

  setExpression(expression: string): void {
    this.emit('expression-change', expression)
    if (this.model && typeof (this.model as any).expression === 'function') {
      try {
        (this.model as any).expression(expression)
      } catch (err) {
        this.emit('adapter-error', err instanceof Error ? err : new Error(String(err)))
      }
    }
  }

  setIdle(): void {
    this.play('idle' as AnimationId)
  }

  getPosition(): { x: number; y: number } {
    return { ...this.position }
  }

  setPosition(x: number, y: number): void {
    this.position = { x, y }
    this.emit('position-change', x, y)
  }

  setScale(scale: number): void {
    this.scale = scale
    if (this.model && typeof (this.model as any).scale === 'object') {
      try {
        (this.model as any).scale.set(scale)
      } catch {
        // 忽略
      }
    }
  }

  getScale(): number {
    return this.scale
  }

  /** 设置底层 Live2D 模型实例 */
  setModel(model: unknown): void {
    this.model = model
  }

  /** 获取底层模型实例 */
  getModel(): unknown {
    return this.model
  }

  destroy(): void {
    if (this.model && typeof (this.model as any).destroy === 'function') {
      try {
        (this.model as any).destroy()
      } catch {
        // 忽略
      }
    }
    this.model = null
    this.removeAllListeners()
  }
}

// ============ Image 适配器 ============

/** Image 适配器配置 */
export interface ImageAdapterConfig {
  /** 精灵图路径 */
  spritePath: string
  /** 图集布局 */
  atlasLayout?: { cellW: number; cellH: number; cols: number; rows: number }
  /** 初始位置 */
  initialPosition?: { x: number; y: number }
  /** 初始缩放 */
  initialScale?: number
}

/**
 * 图片/精灵图渲染适配器
 * 使用 9 行精灵图集渲染角色动画
 */
export class ImageAdapter extends EventEmitter implements RenderAdapter {
  readonly type: AdapterType = 'image'
  private position = { x: 0, y: 0 }
  private scale = 1.0
  private config: ImageAdapterConfig
  private currentAnimation: AnimationId | null = null
  private currentRow = 0
  private currentFrame = 0

  constructor(config: ImageAdapterConfig) {
    super()
    this.config = config
    this.position = config.initialPosition ?? { x: 0, y: 0 }
    this.scale = config.initialScale ?? 1.0
  }

  play(animationId: AnimationId): void {
    this.currentAnimation = animationId
    this.emit('animation-play', animationId)
  }

  stop(): void {
    this.currentAnimation = null
    this.currentFrame = 0
    this.emit('animation-stop')
  }

  setExpression(_expression: string): void {
    // 图片适配器不支持表情，忽略
    // 但仍触发事件以便外部监听
    this.emit('expression-change', _expression)
  }

  setIdle(): void {
    this.play('idle' as AnimationId)
    this.currentRow = 0
  }

  getPosition(): { x: number; y: number } {
    return { ...this.position }
  }

  setPosition(x: number, y: number): void {
    this.position = { x, y }
    this.emit('position-change', x, y)
  }

  setScale(scale: number): void {
    this.scale = scale
  }

  getScale(): number {
    return this.scale
  }

  /** 获取当前行号 */
  getCurrentRow(): number { return this.currentRow }

  /** 设置当前行号 */
  setCurrentRow(row: number): void { this.currentRow = row }

  /** 获取当前帧号 */
  getCurrentFrame(): number { return this.currentFrame }

  /** 设置当前帧号 */
  setCurrentFrame(frame: number): void { this.currentFrame = frame }

  /** 获取图集布局 */
  getAtlasLayout(): { cellW: number; cellH: number; cols: number; rows: number } | undefined {
    return this.config.atlasLayout
  }

  destroy(): void {
    this.removeAllListeners()
  }
}

// ============ Null 适配器 ============

/**
 * 空适配器（兜底）
 * 当 Live2D 和 Image 适配器均不可用时使用
 * 不执行任何实际渲染，仅维持接口完整性
 */
export class NullAdapter extends EventEmitter implements RenderAdapter {
  readonly type: AdapterType = 'null'
  private position = { x: 0, y: 0 }
  private scale = 1.0

  play(animationId: AnimationId): void {
    this.emit('animation-play', animationId)
  }

  stop(): void {
    this.emit('animation-stop')
  }

  setExpression(_expression: string): void {
    // 空操作
  }

  setIdle(): void {
    // 空操作
  }

  getPosition(): { x: number; y: number } {
    return { ...this.position }
  }

  setPosition(x: number, y: number): void {
    this.position = { x, y }
  }

  setScale(scale: number): void {
    this.scale = scale
  }

  getScale(): number {
    return this.scale
  }

  destroy(): void {
    this.removeAllListeners()
  }
}

// ============ 适配器工厂 ============

/** 适配器选择上下文 */
export interface AdapterSelectionContext {
  /** 角色精灵类型 */
  spriteType: 'atlas' | 'svg' | 'gif' | 'video' | 'live2d'
  /** 模型路径（Live2D 时必填） */
  modelPath?: string
  /** 精灵图路径 */
  spritePath?: string
  /** 图集布局 */
  atlasLayout?: { cellW: number; cellH: number; cols: number; rows: number }
  /** 初始位置 */
  initialPosition?: { x: number; y: number }
  /** 初始缩放 */
  initialScale?: number
}

/**
 * 根据角色类型创建适配器
 * 回退链：Live2D → Image → Null
 *
 * @param ctx 适配器选择上下文
 * @returns 渲染适配器实例
 */
export function createAdapter(ctx: AdapterSelectionContext): RenderAdapter {
  // Live2D 角色
  if (ctx.spriteType === 'live2d' && ctx.modelPath) {
    return new Live2DAdapter({
      modelPath: ctx.modelPath,
      initialPosition: ctx.initialPosition,
      initialScale: ctx.initialScale,
    })
  }

  // 图集/精灵图角色
  if (
    (ctx.spriteType === 'atlas' || ctx.spriteType === 'svg' || ctx.spriteType === 'gif') &&
    ctx.spritePath
  ) {
    return new ImageAdapter({
      spritePath: ctx.spritePath,
      atlasLayout: ctx.atlasLayout,
      initialPosition: ctx.initialPosition,
      initialScale: ctx.initialScale,
    })
  }

  // Video 类型也用 Image 适配器（提取帧后按精灵图渲染）
  if (ctx.spriteType === 'video' && ctx.spritePath) {
    return new ImageAdapter({
      spritePath: ctx.spritePath,
      initialPosition: ctx.initialPosition,
      initialScale: ctx.initialScale,
    })
  }

  // 兜底：Null 适配器
  return new NullAdapter()
}

/**
 * 带回退的适配器创建
 * 尝试创建首选适配器，失败则沿回退链降级
 *
 * @param ctx 适配器选择上下文
 * @returns 渲染适配器实例 + 回退信息
 */
export function createAdapterWithFallback(ctx: AdapterSelectionContext): {
  adapter: RenderAdapter
  fellBack: boolean
  originalType: AdapterType
  actualType: AdapterType
} {
  const preferredType = ctx.spriteType === 'live2d' ? 'live2d' : 'image'

  try {
    const adapter = createAdapter(ctx)
    return {
      adapter,
      fellBack: adapter.type !== preferredType,
      originalType: preferredType,
      actualType: adapter.type,
    }
  } catch {
    // 首选适配器创建失败，降级
    if (preferredType === 'live2d') {
      try {
        // 尝试 Image 适配器
        const imageAdapter = new ImageAdapter({
          spritePath: ctx.spritePath ?? '',
          atlasLayout: ctx.atlasLayout,
          initialPosition: ctx.initialPosition,
          initialScale: ctx.initialScale,
        })
        return {
          adapter: imageAdapter,
          fellBack: true,
          originalType: 'live2d',
          actualType: 'image',
        }
      } catch {
        // Image 也失败 → Null
        return {
          adapter: new NullAdapter(),
          fellBack: true,
          originalType: 'live2d',
          actualType: 'null',
        }
      }
    }

    // Image 失败 → Null
    return {
      adapter: new NullAdapter(),
      fellBack: true,
      originalType: 'image',
      actualType: 'null',
    }
  }
}
