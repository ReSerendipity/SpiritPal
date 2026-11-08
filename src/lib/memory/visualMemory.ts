/**
 * @file visualMemory.ts
 * @description 关键帧视觉记忆模块 — 三级 Mipmap 环形缓冲区
 *
 * Phase 2.7: L0→L1→L2 三级分辨率降解的视觉关键帧存储
 *
 * 核心设计：
 * 1. L0 (原始分辨率): 最近 N 帧完整截图（用于详细分析）
 * 2. L1 (中等分辨率): 最近 M 帧降采样截图（用于模式匹配）
 * 3. L2 (低分辨率): 最近 K 帧极小缩略图（用于快速比对/去重）
 * 4. 环形缓冲区：固定大小，自动覆盖最旧帧
 * 5. 隐私保护：仅内存存储，不写磁盘；销毁时解除全部引用（依赖 GC，不承诺内存擦除）
 *
 * 参考设计：
 * - 游戏引擎的 Mipmap 纹理 LOD 机制
 * - 视频编码的关键帧 + 参考帧架构
 *
 * 主要模块：
 * - VisualKeyframe: 视觉关键帧接口
 * - VisualMemoryStats: 统计信息接口
 * - VisualMemoryCallbacks: 回调接口
 * - RingBuffer<T>: 固定大小环形缓冲区（内部类）
 * - VisualMemoryManager: 视觉记忆管理器
 * - getVisualMemoryManager()/resetVisualMemoryManager(): 单例管理
 *
 * TODO(P2): 见文末「实现状态」—— 默认降采样已实现（OffscreenCanvas / Canvas 两条路径，不可用时如实回退并计数），
 *            尚未实现：WebGPU/尺寸自适应的清晰度调参、与 characterId 维度的关联。
 */

// ============ 配置常量 ============

/** L0 缓冲区容量（原始分辨率帧数） */
const L0_CAPACITY = 5

/** L1 缓冲区容量（中等分辨率帧数） */
const L1_CAPACITY = 20

/** L2 缓冲区容量（低分辨率帧数） */
const L2_CAPACITY = 60

/** L1 降采样目标宽度 */
const L1_TARGET_WIDTH = 256

/** L2 降采样目标宽度 */
const L2_TARGET_WIDTH = 64

/** L1/L2 输出 JPEG 质量（缩略图只用于比对，不需要无损） */
const THUMBNAIL_JPEG_QUALITY = 0.8

// ============ 尺寸推导 ============

/** 降采样后的目标尺寸 */
export interface TargetSize {
  width: number
  height: number
  /** 是否需要真的重绘（false 表示原图已经不比目标宽，直接复用原图） */
  scaled: boolean
}

/**
 * 按目标宽度推导等比缩放后的尺寸
 *
 * 关键约束：**只缩不放**。原图宽度不大于目标宽度时返回原尺寸并置 scaled=false ——
 * 旧实现直接按 `targetWidth / width` 算，`width < 256` 时 scale > 1，会把小图放大，
 * 既浪费 CPU 又让 L1「低成本比对」的假设失效，且 getStats() 报出的内存反而变大。
 */
export function computeTargetSize(width: number, height: number, targetWidth: number): TargetSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 0, height: 0, scaled: false }
  }
  if (!Number.isFinite(targetWidth) || targetWidth <= 0 || width <= targetWidth) {
    return { width: Math.round(width), height: Math.round(height), scaled: false }
  }
  const scale = targetWidth / width
  return {
    width: Math.max(1, Math.round(targetWidth)),
    height: Math.max(1, Math.round(height * scale)),
    scaled: true,
  }
}

// ============ 类型定义 ============

/** 视觉关键帧 */
export interface VisualKeyframe {
  /** 帧序号（从 0 递增） */
  seq: number
  /** 图像数据（Base64 编码） */
  imageData: string
  /** 图像宽度 */
  width: number
  /** 图像高度 */
  height: number
  /** 对应的活动窗口信息 */
  windowTitle: string
  windowProcess: string
  /** 捕获时间戳 */
  timestamp: number
  /** Mipmap 级别（0=原始, 1=中等, 2=低） */
  level: 0 | 1 | 2
}

/** Mipmap 环形缓冲区统计 */
export interface VisualMemoryStats {
  /** L0 当前帧数 */
  l0Count: number
  /** L1 当前帧数 */
  l1Count: number
  /** L2 当前帧数 */
  l2Count: number
  /** 总内存占用估算（字节） */
  estimatedMemoryBytes: number
  /** 总捕获帧数 */
  totalCaptured: number
  /** 真正重绘过的缩略图数（>0 说明降采样在生效） */
  downscaledFrames?: number
  /** 因环境不支持 Canvas 而回退原图的次数（>0 说明 L1/L2 仍是原图，内存优化没生效） */
  fallbackFrames?: number
}

/** 视觉记忆回调 */
export interface VisualMemoryCallbacks {
  /** 当新关键帧存入时 */
  onKeyframeAdded?: (frame: VisualKeyframe) => void
  /** 当最旧帧被覆盖时 */
  onKeyframeEvicted?: (frame: VisualKeyframe) => void
  /** 自定义降采样函数（默认使用 Canvas） */
  onDownsample?: (imageData: string, targetWidth: number) => Promise<string>
}

// ============ 环形缓冲区 ============

/**
 * 固定大小环形缓冲区
 *
 * 自动覆盖最旧的条目
 */
class RingBuffer<T> {
  private buffer: (T | undefined)[]
  private head = 0 // 下一个写入位置
  private count = 0

  constructor(private capacity: number) {
    this.buffer = new Array(capacity)
  }

  /** 推入新元素，返回被覆盖的旧元素（如果有） */
  push(item: T): T | undefined {
    const evicted = this.buffer[this.head]
    this.buffer[this.head] = item
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) {
      this.count++
    }
    return evicted
  }

  /** 获取所有元素（按插入顺序） */
  toArray(): T[] {
    const result: T[] = []
    if (this.count < this.capacity) {
      // 缓冲区未满，从 0 开始
      for (let i = 0; i < this.count; i++) {
        const item = this.buffer[i]
        if (item !== undefined) result.push(item)
      }
    } else {
      // 缓冲区已满，从 head 开始（最旧的）
      for (let i = 0; i < this.capacity; i++) {
        const idx = (this.head + i) % this.capacity
        const item = this.buffer[idx]
        if (item !== undefined) result.push(item)
      }
    }
    return result
  }

  /** 获取最新的 N 个元素 */
  getLatest(n: number): T[] {
    const all = this.toArray()
    return all.slice(-n)
  }

  /** 获取最新元素 */
  getLatestOne(): T | undefined {
    if (this.count === 0) return undefined
    const idx = (this.head - 1 + this.capacity) % this.capacity
    return this.buffer[idx]
  }

  /** 当前元素数量 */
  size(): number {
    return this.count
  }

  /** 清空缓冲区 */
  clear(): void {
    this.buffer = new Array(this.capacity)
    this.head = 0
    this.count = 0
  }
}

// ============ 视觉记忆管理器 ============

/**
 * 关键帧视觉记忆管理器
 *
 * 三级 Mipmap 环形缓冲区：
 * - L0: 原始分辨率，用于详细分析
 * - L1: 中等分辨率，用于模式匹配
 * - L2: 低分辨率，用于快速比对/去重
 *
 * TODO(P2): 余下与 TD-007 无关的增强（按窗口标题聚类的相似帧去重、跨会话持久化）见 docs/TECH_DEBT.md
 */
export class VisualMemoryManager {
  /** L0 缓冲区（原始分辨率） */
  private l0Buffer: RingBuffer<VisualKeyframe>
  /** L1 缓冲区（中等分辨率） */
  private l1Buffer: RingBuffer<VisualKeyframe>
  /** L2 缓冲区（低分辨率） */
  private l2Buffer: RingBuffer<VisualKeyframe>
  /** 帧序号计数器 */
  private seqCounter = 0
  /** 总捕获帧数 */
  private totalCaptured = 0
  /** 回调 */
  private callbacks: VisualMemoryCallbacks
  /** 是否已销毁 */
  private destroyed = false
  /** 真正重绘过的缩略图计数 */
  private downscaledFrames = 0
  /** 环境不支持重绘、回退原图的计数 */
  private fallbackFrames = 0

  constructor(callbacks: VisualMemoryCallbacks = {}) {
    this.l0Buffer = new RingBuffer<VisualKeyframe>(L0_CAPACITY)
    this.l1Buffer = new RingBuffer<VisualKeyframe>(L1_CAPACITY)
    this.l2Buffer = new RingBuffer<VisualKeyframe>(L2_CAPACITY)
    this.callbacks = callbacks
  }

  /**
   * 存入一帧视觉关键帧
   *
   * 自动降采样到 L1 和 L2 级别
   *
   * TODO(P2): 实现实际的降采样逻辑
   *
   * @param imageData Base64 编码的图像数据
   * @param width 图像宽度
   * @param height 图像高度
   * @param windowTitle 活动窗口标题
   * @param windowProcess 活动窗口进程名
   */
  async addKeyframe(
    imageData: string,
    width: number,
    height: number,
    windowTitle: string,
    windowProcess: string,
  ): Promise<void> {
    if (this.destroyed) return

    const seq = this.seqCounter++
    this.totalCaptured++
    const timestamp = Date.now()

    // L0: 原始帧
    const l0Frame: VisualKeyframe = {
      seq,
      imageData,
      width,
      height,
      windowTitle,
      windowProcess,
      timestamp,
      level: 0,
    }
    const evictedL0 = this.l0Buffer.push(l0Frame)
    if (evictedL0) {
      this.callbacks.onKeyframeEvicted?.(evictedL0)
    }
    this.callbacks.onKeyframeAdded?.(l0Frame)

    // L1: 中等分辨率降采样（只缩不放；环境不支持重绘时如实回退原图并计数）
    const l1 = await this.buildLevel(imageData, width, height, L1_TARGET_WIDTH)
    const l1Frame: VisualKeyframe = {
      seq,
      imageData: l1.data,
      width: l1.width,
      height: l1.height,
      windowTitle,
      windowProcess,
      timestamp,
      level: 1,
    }
    this.l1Buffer.push(l1Frame)

    // L2: 以 L1 结果为输入再降到 64 宽（L1 本身已不比 64 宽时直接复用 L1）
    const l2 = await this.buildLevel(l1.data, l1.width, l1.height, L2_TARGET_WIDTH)
    const l2Frame: VisualKeyframe = {
      seq,
      imageData: l2.data,
      width: l2.width,
      height: l2.height,
      windowTitle,
      windowProcess,
      timestamp,
      level: 2,
    }
    this.l2Buffer.push(l2Frame)
  }

  /**
   * 生成某一级的图像（按目标宽度，只缩不放）
   *
   * @returns 实际图像数据与尺寸。无法重绘时返回原图并把 fallbackFrames 计数 +1，
   *          尺寸也如实报原图尺寸 —— 不谎报一个没做过的缩放。
   */
  private async buildLevel(
    source: string,
    width: number,
    height: number,
    targetWidth: number,
  ): Promise<{ data: string; width: number; height: number }> {
    const size = computeTargetSize(width, height, targetWidth)
    if (!size.scaled) {
      // 原图不比目标宽：不需要重绘，直接复用（旧实现在这里会放大）
      return { data: source, width: size.width, height: size.height }
    }
    const data = await this.downsample(source, size)
    if (data === null) {
      this.fallbackFrames++
      return { data: source, width: size.width, height: size.height }
    }
    this.downscaledFrames++
    return { data, width: size.width, height: size.height }
  }

  /**
   * 降采样图像
   *
   * 优先用调用方注入的 onDownsample；否则走浏览器 Canvas：
   * - `createImageBitmap` + `OffscreenCanvas`（现代浏览器 / Worker）
   * - `Image` + `HTMLCanvasElement.toDataURL`（老环境）
   *
   * 两条路径都不可用（典型：vitest 的 jsdom 没有 canvas 实现、或 data URL 解码失败）时返回 null，
   * 由调用方回退原图并计数 —— 宁可承认"没降采样"，也不假装降过。
   */
  private async downsample(source: string, size: TargetSize): Promise<string | null> {
    if (this.callbacks.onDownsample) {
      return this.callbacks.onDownsample(source, size.width)
    }

    try {
      if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas === 'function') {
        const bitmap = await this.decodeToBitmap(source)
        if (bitmap) {
          const canvas = new OffscreenCanvas(size.width, size.height)
          const ctx = canvas.getContext('2d')
          if (ctx) {
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, size.width, size.height)
            ctx.drawImage(bitmap, 0, 0, size.width, size.height)
            bitmap.close()
            const blob = await canvas.convertToBlob({
              type: 'image/jpeg',
              quality: THUMBNAIL_JPEG_QUALITY,
            })
            return await blobToDataUrl(blob)
          }
          bitmap.close()
        }
      }

      const canvas =
        typeof document !== 'undefined' && typeof document.createElement === 'function'
          ? document.createElement('canvas')
          : null
      if (!canvas) return null
      canvas.width = size.width
      canvas.height = size.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      const img = await loadImageElement(source)
      if (!img) return null
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, size.width, size.height)
      ctx.drawImage(img, 0, 0, size.width, size.height)
      return canvas.toDataURL('image/jpeg', THUMBNAIL_JPEG_QUALITY)
    } catch {
      return null
    }
  }

  /** 把 base64/Blob/URL 解码成 ImageBitmap（失败返回 null，交由上层回退） */
  private async decodeToBitmap(source: string): Promise<ImageBitmap | null> {
    try {
      if (typeof globalThis.fetch === 'function' && source.startsWith('data:')) {
        const res = await globalThis.fetch(source)
        const blob = await res.blob()
        return await createImageBitmap(blob)
      }
      if (typeof document !== 'undefined') {
        const img = await loadImageElement(source)
        if (img) return await createImageBitmap(img)
      }
    } catch {
      return null
    }
    return null
  }

  // ============ 查询 ============

  /**
   * 获取 L0 最新帧
   */
  getLatestL0(): VisualKeyframe | undefined {
    return this.l0Buffer.getLatestOne()
  }

  /**
   * 获取 L1 最新 N 帧
   */
  getLatestL1(n: number = 5): VisualKeyframe[] {
    return this.l1Buffer.getLatest(n)
  }

  /**
   * 获取 L2 最新 N 帧
   */
  getLatestL2(n: number = 10): VisualKeyframe[] {
    return this.l2Buffer.getLatest(n)
  }

  /**
   * 获取指定级别的所有帧
   */
  getAllFrames(level: 0 | 1 | 2): VisualKeyframe[] {
    switch (level) {
      case 0:
        return this.l0Buffer.toArray()
      case 1:
        return this.l1Buffer.toArray()
      case 2:
        return this.l2Buffer.toArray()
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): VisualMemoryStats {
    const estimateFrameSize = (frame: VisualKeyframe): number => {
      // Base64 字符串长度约等于原始数据大小的 4/3
      return Math.round(frame.imageData.length * 0.75)
    }

    const l0Frames = this.l0Buffer.toArray()
    const l1Frames = this.l1Buffer.toArray()
    const l2Frames = this.l2Buffer.toArray()

    const estimatedMemoryBytes =
      l0Frames.reduce((sum, f) => sum + estimateFrameSize(f), 0) +
      l1Frames.reduce((sum, f) => sum + estimateFrameSize(f), 0) +
      l2Frames.reduce((sum, f) => sum + estimateFrameSize(f), 0)

    return {
      l0Count: l0Frames.length,
      l1Count: l1Frames.length,
      l2Count: l2Frames.length,
      estimatedMemoryBytes,
      totalCaptured: this.totalCaptured,
      downscaledFrames: this.downscaledFrames,
      fallbackFrames: this.fallbackFrames,
    }
  }

  /**
   * 销毁管理器，清空所有缓冲区
   *
   * 说明：Base64 是 JS 字符串，无法在语言层面擦除内存，这里只解除引用并依赖 GC；
   * 文件头那句「销毁时清零」应理解为「不再持有」，不是「覆写内存」。真实防取证级擦除
   * 需要改用 ArrayBuffer 持有像素并在停用后 fill(0)，本模块不承诺这一点。
   */
  destroy(): void {
    this.destroyed = true
    this.l0Buffer.clear()
    this.l1Buffer.clear()
    this.l2Buffer.clear()
    this.seqCounter = 0
    this.totalCaptured = 0
    this.downscaledFrames = 0
    this.fallbackFrames = 0
    this.callbacks = {}
  }
}

// ============ Canvas 辅助 ============

/** Blob → data URL（FileReader 路径，浏览器环境可用） */
async function blobToDataUrl(blob: Blob): Promise<string | null> {
  if (typeof FileReader !== 'function') return null
  return await new Promise<string | null>((resolve) => {
    const reader = new FileReader()
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : resolve(null))
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(blob)
  })
}

/** data URL → HTMLImageElement（等解码完成；失败返回 null） */
async function loadImageElement(source: string): Promise<HTMLImageElement | null> {
  if (typeof Image !== 'function') return null
  return await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = source
  })
}

// ============ 单例 ============

/** 视觉记忆管理器单例 */
let instance: VisualMemoryManager | null = null

/**
 * 获取视觉记忆管理器单例
 * @param callbacks 可选的回调配置（仅首次创建时生效）
 * @returns 视觉记忆管理器实例
 */
export function getVisualMemoryManager(callbacks?: VisualMemoryCallbacks): VisualMemoryManager {
  if (!instance) {
    instance = new VisualMemoryManager(callbacks)
  }
  return instance
}

/**
 * 重置视觉记忆管理器单例
 * 销毁现有实例并清空所有缓冲区（主要用于测试）
 */
export function resetVisualMemoryManager(): void {
  if (instance) {
    instance.destroy()
    instance = null
  }
}
