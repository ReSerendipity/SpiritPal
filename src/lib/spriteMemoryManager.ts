/**
 * @file spriteMemoryManager.ts
 * @description 精灵图内存管理器模块 — 动态合并 + 帧缓存 + LRU 淘汰 + 空闲清理
 *
 * 核心功能：
 * 1. 多精灵图动态合并（将多个小图合并为一张大图，减少 GPU 纹理切换）
 * 2. 帧级缓存与 LRU 淘汰（避免重复解析精灵图帧）
 * 3. 内存用量追踪（监控 GPU 显存占用估算，按 RGBA 4 字节/像素计算）
 * 4. 空闲清理（内存超阈值时自动淘汰最久未用的资源）
 * 5. 精灵图预加载
 * 6. 指定行动画帧预缓存
 *
 * 主要模块：
 * - FrameCacheEntry: 帧缓存条目接口
 * - SpriteCacheEntry: 精灵图缓存条目接口
 * - SpriteMemoryConfig: 内存管理配置接口
 * - MergedSpriteResult: 动态合并结果接口
 * - SpriteMemoryManager: 内存管理器类
 *
 * 依赖关系：
 * - ./types: ATLAS 常量（默认精灵图尺寸）
 *
 * 核心接口：
 * - SpriteMemoryManager.cacheSprite(): 缓存精灵图
 * - SpriteMemoryManager.getFrame(): 获取帧（自动缓存）
 * - SpriteMemoryManager.mergeSprites(): 动态合并精灵图
 * - SpriteMemoryManager.getStats(): 获取缓存统计
 * - SpriteMemoryManager.forceCleanup(): 手动触发清理
 * - getSpriteMemoryManager(): 获取单例实例
 *
 * 默认配置：
 * - 帧缓存上限：500 个
 * - 精灵图缓存上限：20 个
 * - 内存阈值：200MB
 * - 空闲检查间隔：30 秒
 * - 空闲超时：5 分钟
 *
 * 参考：VPet 的动态合并与帧缓存设计
 */

import { ATLAS } from './types'

// ============ 帧缓存条目 ============

/** 帧缓存条目 — 单帧的 Canvas 缓存 */
export interface FrameCacheEntry {
  /** 帧唯一标识（characterId:row:col） */
  key: string
  /** 帧画布 */
  canvas: HTMLCanvasElement
  /** 帧宽度 */
  width: number
  /** 帧高度 */
  height: number
  /** 最后访问时间戳 */
  lastAccessedAt: number
  /** 内存占用估算（字节） */
  estimatedBytes: number
}

/** 精灵图缓存条目 */
export interface SpriteCacheEntry {
  /** 角色包 ID */
  characterId: string
  /** 精灵图 Image 对象 */
  image: HTMLImageElement
  /** 精灵图 dataURL */
  dataUrl: string
  /** 最后访问时间戳 */
  lastAccessedAt: number
  /** 内存占用估算（字节） */
  estimatedBytes: number
  /** 行数 */
  rows: number
  /** 列数 */
  cols: number
  /** 帧宽 */
  cellW: number
  /** 帧高 */
  cellH: number
}

// ============ 内存配置 ============

/** 内存管理配置 */
export interface SpriteMemoryConfig {
  /** 帧缓存最大数量（LRU 淘汰上限） */
  maxFrameCacheSize: number
  /** 精灵图缓存最大数量 */
  maxSpriteCacheSize: number
  /** 内存阈值（字节），超过时触发清理 */
  memoryThreshold: number
  /** 空闲检查间隔（毫秒） */
  idleCheckInterval: number
  /** 空闲超时（毫秒），超过则可被清理 */
  idleTimeout: number
  /** 是否启用动态合并 */
  enableDynamicMerge: boolean
}

/** 默认内存配置 */
export const DEFAULT_MEMORY_CONFIG: SpriteMemoryConfig = {
  maxFrameCacheSize: 500,
  maxSpriteCacheSize: 20,
  memoryThreshold: 200 * 1024 * 1024, // 200MB
  idleCheckInterval: 30_000, // 30秒检查一次
  idleTimeout: 5 * 60 * 1000, // 5分钟未访问视为空闲
  enableDynamicMerge: true,
}

// ============ 合并精灵图结果 ============

/** 动态合并结果 */
export interface MergedSpriteResult {
  /** 合并后的画布 */
  canvas: HTMLCanvasElement
  /** 合并后的精灵图宽度 */
  width: number
  /** 合并后的精灵图高度 */
  height: number
  /** 每个角色的偏移映射（characterId → { x, y }） */
  offsets: Map<string, { x: number; y: number }>
  /** 合并中包含的角色 ID 列表 */
  characterIds: string[]
}

// ============ SpriteMemoryManager ============

/**
 * 精灵图内存管理器
 *
 * 管理 SpiritPal 的精灵图资源内存，包括：
 * - 精灵图缓存（Image 对象 + dataURL）
 * - 帧级缓存（Canvas 对象，用于快速渲染）
 * - 动态合并（减少 GPU 纹理切换）
 * - LRU 淘汰 + 空闲清理
 *
 * 通过 getSpriteMemoryManager() 获取单例。
 */
export class SpriteMemoryManager {
  private config: SpriteMemoryConfig
  /** 精灵图缓存：characterId → entry */
  private spriteCache: Map<string, SpriteCacheEntry> = new Map()
  /** 帧缓存：frameKey → entry */
  private frameCache: Map<string, FrameCacheEntry> = new Map()
  /** LRU 访问顺序（最近访问在末尾） */
  private lruOrder: string[] = []
  /** 当前估算内存占用 */
  private estimatedMemoryUsage = 0
  /** 空闲检查定时器 */
  private idleCheckTimer: ReturnType<typeof setInterval> | null = null
  /** 合并结果缓存 */
  private mergedResult: MergedSpriteResult | null = null
  /** 内存变化回调 */
  private onMemoryChange: ((usage: number) => void) | null = null

  constructor(config?: Partial<SpriteMemoryConfig>) {
    this.config = { ...DEFAULT_MEMORY_CONFIG, ...config }
  }

  // ============ 精灵图缓存 ============

  /**
   * 缓存精灵图
   * @returns 缓存条目
   */
  cacheSprite(
    characterId: string,
    image: HTMLImageElement,
    dataUrl: string,
    options?: { rows?: number; cols?: number; cellW?: number; cellH?: number },
  ): SpriteCacheEntry {
    // 移除旧缓存
    this.evictSprite(characterId)

    const rows = options?.rows ?? ATLAS.rows
    const cols = options?.cols ?? ATLAS.cols
    const cellW = options?.cellW ?? ATLAS.cellW
    const cellH = options?.cellH ?? ATLAS.cellH

    // 估算内存：RGBA = 4 bytes/pixel
    const estimatedBytes = image.naturalWidth * image.naturalHeight * 4

    const entry: SpriteCacheEntry = {
      characterId,
      image,
      dataUrl,
      lastAccessedAt: Date.now(),
      estimatedBytes,
      rows,
      cols,
      cellW,
      cellH,
    }

    this.spriteCache.set(characterId, entry)
    this.estimatedMemoryUsage += estimatedBytes

    // 触发合并失效
    this.invalidateMerge()

    // 检查内存是否超限
    this.checkMemoryThreshold()

    this.notifyMemoryChange()
    return entry
  }

  /**
   * 获取缓存的精灵图
   */
  getSprite(characterId: string): SpriteCacheEntry | null {
    const entry = this.spriteCache.get(characterId)
    if (entry) {
      entry.lastAccessedAt = Date.now()
    }
    return entry ?? null
  }

  /**
   * 预加载精灵图
   */
  async preloadSprite(characterId: string, url: string): Promise<SpriteCacheEntry | null> {
    const existing = this.getSprite(characterId)
    if (existing) return existing

    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        // 将 image 转为 dataURL 缓存
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0)
        }
        const dataUrl = canvas.toDataURL('image/png')
        const entry = this.cacheSprite(characterId, img, dataUrl)
        resolve(entry)
      }
      img.onerror = () => resolve(null)
      img.src = url
    })
  }

  // ============ 帧级缓存 ============

  /**
   * 获取指定帧（优先从帧缓存获取，否则从精灵图裁剪）
   */
  getFrame(
    characterId: string,
    row: number,
    col: number,
  ): HTMLCanvasElement | null {
    const key = `${characterId}:${row}:${col}`

    // 尝试帧缓存
    const cached = this.frameCache.get(key)
    if (cached) {
      cached.lastAccessedAt = Date.now()
      this.updateLRU(key)
      return cached.canvas
    }

    // 从精灵图裁剪
    const sprite = this.spriteCache.get(characterId)
    if (!sprite) return null

    if (row >= sprite.rows || col >= sprite.cols) return null

    const canvas = document.createElement('canvas')
    canvas.width = sprite.cellW
    canvas.height = sprite.cellH
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    ctx.drawImage(
      sprite.image,
      col * sprite.cellW, row * sprite.cellH,
      sprite.cellW, sprite.cellH,
      0, 0,
      sprite.cellW, sprite.cellH,
    )

    // 缓存帧
    this.cacheFrame(key, canvas, sprite.cellW, sprite.cellH)
    return canvas
  }

  /**
   * 获取指定行的所有帧
   */
  getRowFrames(characterId: string, row: number, frameCount: number): HTMLCanvasElement[] {
    const frames: HTMLCanvasElement[] = []
    for (let col = 0; col < frameCount; col++) {
      const frame = this.getFrame(characterId, row, col)
      if (frame) frames.push(frame)
    }
    return frames
  }

  /**
   * 预缓存指定行动画的所有帧
   */
  precacheRow(characterId: string, row: number, frameCount: number): void {
    for (let col = 0; col < frameCount; col++) {
      this.getFrame(characterId, row, col)
    }
  }

  // ============ 动态合并 ============

  /**
   * 动态合并多个精灵图
   * 将活跃角色的精灵图合并为一张大图，减少 GPU 纹理切换
   *
   * @param characterIds 要合并的角色 ID 列表
   * @returns 合并结果
   */
  mergeSprites(characterIds: string[]): MergedSpriteResult | null {
    if (!this.config.enableDynamicMerge) return null
    if (characterIds.length === 0) return null

    // 检查是否已有有效合并结果
    if (this.mergedResult) {
      const existingIds = new Set(this.mergedResult.characterIds)
      const requestedIds = new Set(characterIds)
      if (existingIds.size === requestedIds.size &&
          [...requestedIds].every((id) => existingIds.has(id))) {
        return this.mergedResult
      }
    }

    // 收集所有精灵图
    const entries: SpriteCacheEntry[] = []
    for (const id of characterIds) {
      const entry = this.spriteCache.get(id)
      if (entry) entries.push(entry)
    }

    if (entries.length === 0) return null

    // 计算合并后的画布尺寸（水平排列）
    const maxWidth = Math.max(...entries.map((e) => e.image.naturalWidth))
    const totalHeight = entries.reduce((sum, e) => sum + e.image.naturalHeight, 0)

    const canvas = document.createElement('canvas')
    canvas.width = maxWidth
    canvas.height = totalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const offsets = new Map<string, { x: number; y: number }>()
    let currentY = 0

    for (const entry of entries) {
      ctx.drawImage(entry.image, 0, currentY)
      offsets.set(entry.characterId, { x: 0, y: currentY })
      currentY += entry.image.naturalHeight
    }

    this.mergedResult = {
      canvas,
      width: maxWidth,
      height: totalHeight,
      offsets,
      characterIds: [...characterIds],
    }

    return this.mergedResult
  }

  // ============ 内存管理 ============

  /**
   * 获取当前估算内存占用（字节）
   */
  getMemoryUsage(): number {
    return this.estimatedMemoryUsage
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): {
    spriteCacheCount: number
    frameCacheCount: number
    estimatedMemoryMB: number
    lruSize: number
  } {
    return {
      spriteCacheCount: this.spriteCache.size,
      frameCacheCount: this.frameCache.size,
      estimatedMemoryMB: Math.round(this.estimatedMemoryUsage / (1024 * 1024) * 100) / 100,
      lruSize: this.lruOrder.length,
    }
  }

  /**
   * 设置内存变化回调
   */
  setOnMemoryChange(callback: ((usage: number) => void) | null): void {
    this.onMemoryChange = callback
  }

  /**
   * 启动空闲检查定时器
   */
  startIdleCheck(): void {
    if (this.idleCheckTimer) return
    this.idleCheckTimer = setInterval(
      () => this.cleanupIdle(),
      this.config.idleCheckInterval,
    )
  }

  /**
   * 停止空闲检查定时器
   */
  stopIdleCheck(): void {
    if (this.idleCheckTimer) {
      clearInterval(this.idleCheckTimer)
      this.idleCheckTimer = null
    }
  }

  /**
   * 手动触发内存清理
   */
  forceCleanup(): void {
    this.cleanupIdle()
    this.evictLRU(this.config.maxFrameCacheSize / 2)
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.spriteCache.clear()
    this.frameCache.clear()
    this.lruOrder = []
    this.estimatedMemoryUsage = 0
    this.mergedResult = null
    this.stopIdleCheck()
    this.notifyMemoryChange()
  }

  // ============ 内部方法 ============

  /** 缓存帧 */
  private cacheFrame(key: string, canvas: HTMLCanvasElement, width: number, height: number): void {
    const estimatedBytes = width * height * 4

    // 检查帧缓存上限
    if (this.frameCache.size >= this.config.maxFrameCacheSize) {
      this.evictLRU(1)
    }

    const entry: FrameCacheEntry = {
      key,
      canvas,
      width,
      height,
      lastAccessedAt: Date.now(),
      estimatedBytes,
    }

    this.frameCache.set(key, entry)
    this.estimatedMemoryUsage += estimatedBytes
    this.updateLRU(key)
  }

  /** 更新 LRU 顺序 */
  private updateLRU(key: string): void {
    // 移除旧位置
    const idx = this.lruOrder.indexOf(key)
    if (idx >= 0) this.lruOrder.splice(idx, 1)
    // 添加到末尾
    this.lruOrder.push(key)
  }

  /** 淘汰 LRU 条目 */
  private evictLRU(count: number): void {
    for (let i = 0; i < count && this.lruOrder.length > 0; i++) {
      const oldest = this.lruOrder.shift()!
      const entry = this.frameCache.get(oldest)
      if (entry) {
        this.estimatedMemoryUsage -= entry.estimatedBytes
        this.frameCache.delete(oldest)
      }
    }
  }

  /** 淘汰指定角色的精灵图缓存 */
  private evictSprite(characterId: string): void {
    const existing = this.spriteCache.get(characterId)
    if (existing) {
      this.estimatedMemoryUsage -= existing.estimatedBytes
      this.spriteCache.delete(characterId)
    }
    // 同时清除该角色的所有帧缓存
    for (const [key, entry] of this.frameCache) {
      if (key.startsWith(`${characterId}:`)) {
        this.estimatedMemoryUsage -= entry.estimatedBytes
        this.frameCache.delete(key)
        const idx = this.lruOrder.indexOf(key)
        if (idx >= 0) this.lruOrder.splice(idx, 1)
      }
    }
  }

  /** 使合并缓存失效 */
  private invalidateMerge(): void {
    this.mergedResult = null
  }

  /** 检查内存阈值，超限时自动清理 */
  private checkMemoryThreshold(): void {
    if (this.estimatedMemoryUsage > this.config.memoryThreshold) {
      // 清理到阈值的 80%
      const targetUsage = this.config.memoryThreshold * 0.8
      while (this.estimatedMemoryUsage > targetUsage && this.lruOrder.length > 0) {
        this.evictLRU(1)
      }
    }
  }

  /** 清理空闲资源 */
  private cleanupIdle(): void {
    const now = Date.now()
    const idleThreshold = now - this.config.idleTimeout

    // 清理空闲帧缓存
    for (const [key, entry] of this.frameCache) {
      if (entry.lastAccessedAt < idleThreshold) {
        this.estimatedMemoryUsage -= entry.estimatedBytes
        this.frameCache.delete(key)
        const idx = this.lruOrder.indexOf(key)
        if (idx >= 0) this.lruOrder.splice(idx, 1)
      }
    }

    // 清理空闲精灵图缓存（不清理当前活跃角色的）
    for (const [characterId, entry] of this.spriteCache) {
      if (entry.lastAccessedAt < idleThreshold) {
        this.evictSprite(characterId)
      }
    }

    this.invalidateMerge()
    this.notifyMemoryChange()
  }

  /** 通知内存变化 */
  private notifyMemoryChange(): void {
    this.onMemoryChange?.(this.estimatedMemoryUsage)
  }
}

// ============ 单例 ============

let instance: SpriteMemoryManager | null = null

/** 获取精灵图内存管理器单例 */
export function getSpriteMemoryManager(): SpriteMemoryManager {
  if (!instance) {
    instance = new SpriteMemoryManager()
  }
  return instance
}

/** 重置单例（测试用） */
export function resetSpriteMemoryManager(): void {
  if (instance) {
    instance.clear()
    instance = null
  }
}
