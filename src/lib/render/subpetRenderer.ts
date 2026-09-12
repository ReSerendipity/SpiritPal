/**
 * 副宠渲染层模块
 *
 * @fileoverview 召唤副宠的精灵图加载、缩放渲染与 idle 动画播放
 *
 * 主要模块：
 * - SubpetRenderEntry: 单个活跃副宠的渲染运行时状态
 * - SubpetRenderer: 副宠渲染器（管理多只副宠的召唤/收回/更新/绘制）
 * - SubpetImageFactory: 图片加载抽象（默认用全局 Image，测试可注入桩）
 *
 * 设计要点：
 * - 与 BatchRenderer 的 CPU 侧 Renderable 模式对齐（getRenderables() 可直接喂给 BatchRenderer.add）
 * - 精灵图按横向排列的帧序列解释：frameCount 帧横排在一张图上，每帧宽 = img.width / frameCount
 * - idle 动画按 fps 循环推进 frameIndex
 * - 缩放使用 SubPetConfig.scale（默认 1）
 *
 * 依赖关系：
 * - @/lib/data/types: SubPetConfig
 * - ./movementEngine: Position 类型
 * - ../nurture/subpetFollower: SubpetFollower / computeFanOffsets
 */

import type { SubPetConfig } from '@/lib/data/types'
import { computeFanOffsets, SubpetFollower } from '@/lib/nurture/subpetFollower'
import type { Position } from '@/lib/render/movementEngine'

// ============ 图片加载抽象 ============

/**
 * 最小图片接口 — 只依赖渲染所需字段
 *
 * 浏览器原生 HTMLImageElement 天然满足此接口；
 * 测试中可注入一个立即 onload 的桩对象。
 */
export interface SubpetImageLike {
  src: string
  complete: boolean
  naturalWidth: number
  naturalHeight: number
  onload: (() => void) | null
  onerror: (() => void) | null
}

/** 图片工厂函数签名 */
export type SubpetImageFactory = (src: string) => SubpetImageLike

/** 默认图片工厂 — 使用全局 Image（jsdom / 浏览器均可用） */
function defaultImageFactory(src: string): SubpetImageLike {
   
  const img = new Image()
  img.src = src
  // HTMLImageElement 的 onload 签名带 Event 参数，与 SubpetImageLike 兼容，此处窄化
  return img as unknown as SubpetImageLike
}

// ============ 渲染条目 ============

/** 单个活跃副宠的运行时渲染状态 */
export interface SubpetRenderEntry {
  /** 关联物品 ID（唯一键） */
  itemId: string
  /** 副宠配置 */
  config: SubPetConfig
  /** 弹性跟随器 */
  follower: SubpetFollower
  /** 已加载的图片（未加载完成时为 null） */
  image: SubpetImageLike | null
  /** 精灵图是否加载完成 */
  loaded: boolean
  /** 是否加载失败 */
  failed: boolean
  /** 当前动画帧索引 */
  frameIndex: number
  /** 动画累计时间（秒） */
  animTime: number
}

// ============ 渲染器 ============

/** 渲染器选项 */
export interface SubpetRendererOptions {
  /** 横向精灵图总帧数（默认 1 = 单帧静态图） */
  frameCount?: number
  /** idle 动画帧率（默认 6 fps） */
  fps?: number
  /** 多副宠扇形排列半径（像素） */
  fanRadius?: number
  /** 图片工厂（测试可注入桩） */
  createImage?: SubpetImageFactory
}

/** 默认选项 */
const DEFAULT_OPTIONS = {
  frameCount: 1,
  fps: 6,
  fanRadius: 56,
} as const

/**
 * 副宠渲染器
 *
 * 负责：
 * - 召唤（加载精灵图）与收回（销毁条目）
 * - 每帧用 SubpetFollower 推进位置（多只扇形排列）
 * - 推进 idle 动画帧
 * - 绘制到 Canvas 2D 上下文，或导出 Renderable[] 交给 BatchRenderer
 *
 * @example
 * ```ts
 * const renderer = new SubpetRenderer()
 * renderer.summon('subpet-mini-ghost', config, { x: 200, y: 200 })
 * renderer.update(1 / 60, { x: 300, y: 240 })
 * renderer.render(ctx)
 * renderer.recall('subpet-mini-ghost')
 * ```
 */
export class SubpetRenderer {
  private entries = new Map<string, SubpetRenderEntry>()
  private options: Required<Omit<SubpetRendererOptions, 'createImage'>> & {
    createImage: SubpetImageFactory
  }

  constructor(options: SubpetRendererOptions = {}) {
    this.options = {
      frameCount: options.frameCount ?? DEFAULT_OPTIONS.frameCount,
      fps: options.fps ?? DEFAULT_OPTIONS.fps,
      fanRadius: options.fanRadius ?? DEFAULT_OPTIONS.fanRadius,
      createImage: options.createImage ?? defaultImageFactory,
    }
  }

  /**
   * 召唤一只副宠
   *
   * @param itemId 物品 ID（唯一键，重复召唤会被忽略）
   * @param config 副宠配置（含 spritePath / name / scale）
   * @param startPos 初始位置（通常与主宠当前位置一致）
   * @returns 是否召唤成功（已存在则返回 false）
   */
  summon(itemId: string, config: SubPetConfig, startPos: Position): boolean {
    if (this.entries.has(itemId)) return false

    const follower = new SubpetFollower(startPos)
    const entry: SubpetRenderEntry = {
      itemId,
      config,
      follower,
      image: null,
      loaded: false,
      failed: false,
      frameIndex: 0,
      animTime: 0,
    }
    this.entries.set(itemId, entry)

    // 异步加载精灵图（不阻塞召唤）
    this.loadSprite(entry)
    return true
  }

  /** 收回一只副宠 */
  recall(itemId: string): boolean {
    return this.entries.delete(itemId)
  }

  /** 是否已召唤 */
  has(itemId: string): boolean {
    return this.entries.has(itemId)
  }

  /** 当前活跃副宠数量 */
  count(): number {
    return this.entries.size
  }

  /** 列出所有活跃副宠条目（只读快照） */
  list(): SubpetRenderEntry[] {
    return Array.from(this.entries.values())
  }

  /**
   * 推进所有副宠
   *
   * - 重新按当前数量计算扇形偏移
   * - 用弹簧-阻尼模型更新位置
   * - 推进 idle 动画帧
   *
   * @param dt 帧间隔（秒）
   * @param mainPetPos 主宠当前位置
   */
  update(dt: number, mainPetPos: Position): void {
    const list = Array.from(this.entries.values())
    const offsets = computeFanOffsets(list.length, this.options.fanRadius)

    list.forEach((entry, i) => {
      const offset = offsets[i] ?? { x: 0, y: 0 }
      entry.follower.setOffset(offset.x, offset.y)
      entry.follower.update(dt, mainPetPos)

      // 推进 idle 动画
      entry.animTime += dt
      const totalFrames = this.options.frameCount
      if (totalFrames > 1) {
        entry.frameIndex = Math.floor(entry.animTime * this.options.fps) % totalFrames
      } else {
        entry.frameIndex = 0
      }
    })
  }

  /**
   * 绘制所有已加载的副宠到 Canvas 2D 上下文
   *
   * @param ctx Canvas 2D 上下文
   */
  render(ctx: CanvasRenderingContext2D): void {
    for (const entry of this.entries.values()) {
      if (!entry.loaded || !entry.image) continue
      this.drawEntry(ctx, entry)
    }
  }

  /**
   * 导出当前帧的 Renderable[]，可直接交给 BatchRenderer.add
   *
   * 与 batchRenderer.ts 的 CPU 侧批量管线对齐：返回像素轴对齐的矩形渲染数据，
   * 不做 GPU 提交。
   */
  getRenderables(): Array<{
    id: string
    textureId: string
    position: [number, number]
    size: [number, number]
    scale: [number, number]
  }> {
    const out: Array<{
      id: string
      textureId: string
      position: [number, number]
      size: [number, number]
      scale: [number, number]
    }> = []
    for (const entry of this.entries.values()) {
      if (!entry.loaded) continue
      const pos = entry.follower.getPosition()
      const scale = entry.config.scale ?? 1
      out.push({
        id: entry.itemId,
        textureId: entry.config.spritePath,
        position: [pos.x, pos.y],
        size: [subpetCellWidth(entry, this.options.frameCount) * scale, subpetCellHeight(entry) * scale],
        scale: [scale, scale],
      })
    }
    return out
  }

  /** 销毁所有副宠 */
  clear(): void {
    this.entries.clear()
  }

  // ============ 内部 ============

  /** 异步加载精灵图 */
  private loadSprite(entry: SubpetRenderEntry): void {
    try {
      const img = this.options.createImage(entry.config.spritePath)
      entry.image = img
      img.onload = () => {
        entry.loaded = true
        entry.failed = false
      }
      img.onerror = () => {
        entry.loaded = false
        entry.failed = true
      }
      // 某些桩对象同步置 complete=true 且已触发 onload，这里兜底
      if (img.complete && img.naturalWidth > 0 && !entry.loaded) {
        entry.loaded = true
      }
    } catch {
      entry.failed = true
    }
  }

  /** 绘制单个副宠（裁剪当前动画帧并按 scale 缩放） */
  private drawEntry(ctx: CanvasRenderingContext2D, entry: SubpetRenderEntry): void {
    const img = entry.image
    if (!img) return
    const frameW = subpetCellWidth(entry, this.options.frameCount)
    const frameH = subpetCellHeight(entry)
    const sx = entry.frameIndex * frameW
    const scale = entry.config.scale ?? 1
    const pos = entry.follower.getPosition()

    ctx.drawImage(
      img as unknown as CanvasImageSource,
      sx, 0, frameW, frameH,
      pos.x, pos.y,
      frameW * scale, frameH * scale,
    )
  }
}

// ============ 扩展方法（挂在原型上避免循环引用与测试可达） ============

/**
 * 计算单帧宽度（图宽 / 总帧数）
 *
 * 抽成独立函数以便单测直接调用；未加载完成时返回 0。
 */
export function subpetCellWidth(entry: SubpetRenderEntry, frameCount: number): number {
  const img = entry.image
  if (!img || !img.complete || img.naturalWidth <= 0) return 0
  return img.naturalWidth / Math.max(1, frameCount)
}

export function subpetCellHeight(entry: SubpetRenderEntry): number {
  const img = entry.image
  if (!img || !img.complete || img.naturalHeight <= 0) return 0
  return img.naturalHeight
}
