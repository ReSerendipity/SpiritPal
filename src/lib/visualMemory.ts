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
 * 5. 隐私保护：仅内存存储，不写磁盘；销毁时清零
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
 * TODO(P2): 完整实现 — 当前为桩代码，包含类型定义和核心接口
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
  private head = 0  // 下一个写入位置
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
 * TODO(P2): 当前为桩实现，核心接口已定义，降采样逻辑待补充
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

    // L1: 中等分辨率降采样
    // TODO(P2): 使用 Canvas 或 OffscreenCanvas 进行降采样
    const l1ImageData = await this.downsample(imageData, L1_TARGET_WIDTH)
    const l1Scale = L1_TARGET_WIDTH / width
    const l1Frame: VisualKeyframe = {
      seq,
      imageData: l1ImageData,
      width: Math.round(width * l1Scale),
      height: Math.round(height * l1Scale),
      windowTitle,
      windowProcess,
      timestamp,
      level: 1,
    }
    this.l1Buffer.push(l1Frame)

    // L2: 低分辨率降采样
    const l2ImageData = await this.downsample(l1ImageData, L2_TARGET_WIDTH)
    const l2Scale = L2_TARGET_WIDTH / (width * l1Scale)
    const l2Frame: VisualKeyframe = {
      seq,
      imageData: l2ImageData,
      width: Math.round(width * l1Scale * l2Scale),
      height: Math.round(height * l1Scale * l2Scale),
      windowTitle,
      windowProcess,
      timestamp,
      level: 2,
    }
    this.l2Buffer.push(l2Frame)
  }

  /**
   * 降采样图像
   * 
   * TODO(P2): 使用 Canvas API 实现
   * 当前返回原始数据（不降采样）
   */
  private async downsample(imageData: string, targetWidth: number): Promise<string> {
    // 使用自定义降采样回调
    if (this.callbacks.onDownsample) {
      return this.callbacks.onDownsample(imageData, targetWidth)
    }

    // TODO(P2): 默认降采样实现
    // 在浏览器环境可使用 Canvas：
    // 1. 创建 Image 对象加载 Base64
    // 2. 绘制到 Canvas（缩放到目标尺寸）
    // 3. 导出为 Base64
    // 当前返回原始数据作为桩
    return imageData
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
      case 0: return this.l0Buffer.toArray()
      case 1: return this.l1Buffer.toArray()
      case 2: return this.l2Buffer.toArray()
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
    }
  }

  /**
   * 销毁管理器，清零所有缓冲区
   */
  destroy(): void {
    this.destroyed = true
    this.l0Buffer.clear()
    this.l1Buffer.clear()
    this.l2Buffer.clear()
    this.seqCounter = 0
    this.totalCaptured = 0
    this.callbacks = {}
  }
}

// ============ 单例 ============

/** 视觉记忆管理器单例 */
let instance: VisualMemoryManager | null = null

/**
 * 获取视觉记忆管理器单例
 * @param callbacks 可选的回调配置（仅首次创建时生效）
 * @returns 视觉记忆管理器实例
 */
export function getVisualMemoryManager(
  callbacks?: VisualMemoryCallbacks,
): VisualMemoryManager {
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
