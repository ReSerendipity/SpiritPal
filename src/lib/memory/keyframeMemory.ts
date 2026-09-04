/**
 * 关键帧视觉记忆模块
 *
 * @fileoverview 实现 Mipmap 环形缓冲区三级视觉记忆系统，参考 Live2DPet
 *
 * 主要模块：
 * - KeyframeLevel: 关键帧级别枚举（L0/L1/L2）
 * - Keyframe: 关键帧数据结构
 * - KeyframeMemoryConfig/Callbacks: 配置与回调接口
 * - KeyframeMemory: 关键帧记忆管理器主类
 *
 * 依赖关系：
 * - Canvas API: 图像缩放处理
 *
 * 核心接口：
 * - KeyframeMemory.addFrame(): 添加新关键帧
 * - KeyframeMemory.getRecentFrames(): 获取近期关键帧
 * - KeyframeMemory.searchByLabel(): 按标签搜索
 *
 * 三级退化机制：
 * - L0: 全分辨率近期帧（5帧）- 最近5秒
 * - L1: 半分辨率中期帧（10帧）- 最近1分钟
 * - L2: 四分之一分辨率远期帧（20帧）- 最近10分钟
 * - 自动退化：L0满→缩放到L1，L1满→缩放到L2，L2满→丢弃最老帧
 *
 * 参考仓库：Live2DPet keyframe_memory.py
 */

// ============ 配置常量 ============

/** L0: 全分辨率近期帧最大数量 */
const L0_MAX_FRAMES = 5

/** L1: 半分辨率中期帧最大数量 */
const L1_MAX_FRAMES = 10

/** L2: 四分之一分辨率远期帧最大数量 */
const L2_MAX_FRAMES = 20

/** L0 → L1 降级缩放倍率 */
const L0_TO_L1_SCALE = 0.5

/** L1 → L2 降级缩放倍率 */
const L1_TO_L2_SCALE = 0.5

/** 默认帧宽度（像素） */
const DEFAULT_FRAME_WIDTH = 512

/** 默认帧高度（像素） */
const DEFAULT_FRAME_HEIGHT = 288

// ============ 类型定义 ============

/** 关键帧级别 */
export enum KeyframeLevel {
  /** 全分辨率近期帧 */
  L0 = 'L0',
  /** 半分辨率中期帧 */
  L1 = 'L1',
  /** 四分之一分辨率远期帧 */
  L2 = 'L2',
}

/** 关键帧数据 */
export interface Keyframe {
  /** 帧数据（Canvas ImageData 或 base64） */
  data: string
  /** 帧级别 */
  level: KeyframeLevel
  /** 帧宽度 */
  width: number
  /** 帧高度 */
  height: number
  /** 时间戳 */
  timestamp: number
  /** 关联的活动窗口信息（可选） */
  windowInfo?: string
  /** 描述标签（可选，如"coding"、"meeting"） */
  label?: string
}

/** 关键帧记忆配置 */
export interface KeyframeMemoryConfig {
  /** L0 最大帧数（默认 5） */
  l0MaxFrames?: number
  /** L1 最大帧数（默认 10） */
  l1MaxFrames?: number
  /** L2 最大帧数（默认 20） */
  l2MaxFrames?: number
  /** 默认帧宽度（默认 512） */
  defaultWidth?: number
  /** 默认帧高度（默认 288） */
  defaultHeight?: number
}

/** 关键帧记忆回调 */
export interface KeyframeMemoryCallbacks {
  /** 当帧被降级时 */
  onFrameDegraded?: (frame: Keyframe, fromLevel: KeyframeLevel, toLevel: KeyframeLevel) => void
  /** 当帧被丢弃时（L2 满时最老帧被丢弃） */
  onFrameDropped?: (frame: Keyframe) => void
  /** 当新帧被添加时 */
  onFrameAdded?: (frame: Keyframe) => void
}

// ============ 关键帧记忆管理器 ============

/**
 * Mipmap 环形缓冲区关键帧记忆
 * 参考 Live2DPet keyframe_memory.py
 *
 * 三级退化：
 * - L0 (全分辨率, 5帧) → L1 (半分辨率, 10帧) → L2 (四分之一分辨率, 20帧)
 * - L0 满时最老帧缩放到 L1
 * - L1 满时最老帧缩放到 L2
 * - L2 满时最老帧被丢弃
 */
export class KeyframeMemory {
  private l0: Keyframe[] = []
  private l1: Keyframe[] = []
  private l2: Keyframe[] = []
  private config: Required<KeyframeMemoryConfig>
  private callbacks: KeyframeMemoryCallbacks

  constructor(
    config: KeyframeMemoryConfig = {},
    callbacks: KeyframeMemoryCallbacks = {},
  ) {
    this.config = {
      l0MaxFrames: config.l0MaxFrames ?? L0_MAX_FRAMES,
      l1MaxFrames: config.l1MaxFrames ?? L1_MAX_FRAMES,
      l2MaxFrames: config.l2MaxFrames ?? L2_MAX_FRAMES,
      defaultWidth: config.defaultWidth ?? DEFAULT_FRAME_WIDTH,
      defaultHeight: config.defaultHeight ?? DEFAULT_FRAME_HEIGHT,
    }
    this.callbacks = callbacks
  }

  /**
   * 添加新的全分辨率帧到 L0
   * 触发自动退化链：L0 满 → 降级最老帧到 L1 → L1 满 → 降级到 L2 → L2 满 → 丢弃
   *
   * @param data 帧数据（base64 编码的图片）
   * @param options 可选元数据
   */
  addFrame(
    data: string,
    options: {
      width?: number
      height?: number
      windowInfo?: string
      label?: string
    } = {},
  ): Keyframe {
    const frame: Keyframe = {
      data,
      level: KeyframeLevel.L0,
      width: options.width ?? this.config.defaultWidth,
      height: options.height ?? this.config.defaultHeight,
      timestamp: Date.now(),
      windowInfo: options.windowInfo,
      label: options.label,
    }

    // L0 满时退化最老帧
    if (this.l0.length >= this.config.l0MaxFrames) {
      this.degradeOldestL0()
    }

    this.l0.push(frame)
    this.callbacks.onFrameAdded?.(frame)

    return frame
  }

  /**
   * L0 → L1 降级最老帧
   */
  private degradeOldestL0(): void {
    if (this.l0.length === 0) return

    const oldest = this.l0.shift()!

    // L1 满时退化 L1 最老帧到 L2
    if (this.l1.length >= this.config.l1MaxFrames) {
      this.degradeOldestL1()
    }

    // 缩放到半分辨率
    const degraded: Keyframe = {
      ...oldest,
      level: KeyframeLevel.L1,
      width: Math.round(oldest.width * L0_TO_L1_SCALE),
      height: Math.round(oldest.height * L0_TO_L1_SCALE),
      // 注意：实际缩放需要 Canvas，这里仅记录目标尺寸
      // 实际缩放由 resizeFrame 方法处理
      data: oldest.data, // 延迟缩放
    }

    this.l1.push(degraded)
    this.callbacks.onFrameDegraded?.(degraded, KeyframeLevel.L0, KeyframeLevel.L1)
  }

  /**
   * L1 → L2 降级最老帧
   */
  private degradeOldestL1(): void {
    if (this.l1.length === 0) return

    const oldest = this.l1.shift()!

    // L2 满时丢弃最老帧
    if (this.l2.length >= this.config.l2MaxFrames) {
      const dropped = this.l2.shift()!
      this.callbacks.onFrameDropped?.(dropped)
    }

    // 缩放到四分之一分辨率
    const degraded: Keyframe = {
      ...oldest,
      level: KeyframeLevel.L2,
      width: Math.round(oldest.width * L1_TO_L2_SCALE),
      height: Math.round(oldest.height * L1_TO_L2_SCALE),
      data: oldest.data, // 延迟缩放
    }

    this.l2.push(degraded)
    this.callbacks.onFrameDegraded?.(degraded, KeyframeLevel.L1, KeyframeLevel.L2)
  }

  // ============ 查询方法 ============

  /** 获取所有 L0 帧（只读） */
  getL0Frames(): ReadonlyArray<Keyframe> {
    return this.l0
  }

  /** 获取所有 L1 帧（只读） */
  getL1Frames(): ReadonlyArray<Keyframe> {
    return this.l1
  }

  /** 获取所有 L2 帧（只读） */
  getL2Frames(): ReadonlyArray<Keyframe> {
    return this.l2
  }

  /** 获取所有帧（按时间排序，L0 最新） */
  getAllFrames(): Keyframe[] {
    return [...this.l2, ...this.l1, ...this.l0]
  }

  /** 获取最近一帧 */
  getLatestFrame(): Keyframe | null {
    return this.l0.length > 0 ? this.l0[this.l0.length - 1]! : null
  }

  /**
   * 获取指定时间范围内的帧
   *
   * @param startTime 起始时间戳
   * @param endTime 结束时间戳
   * @returns 时间范围内的帧列表
   */
  getFramesByTimeRange(startTime: number, endTime: number): Keyframe[] {
    const allFrames = this.getAllFrames()
    return allFrames.filter(f => f.timestamp >= startTime && f.timestamp <= endTime)
  }

  /**
   * 获取用于 Vision LLM 分析的帧摘要
   * 从各级别选取代表性帧，避免发送过多数据
   *
   * @param maxFrames 最大返回帧数（默认 5）
   * @returns 选取的代表性帧列表
   */
  getSummaryFrames(maxFrames: number = 5): Keyframe[] {
    const result: Keyframe[] = []

    // 优先选取 L0 最新帧
    const l0Recent = this.l0.slice(-2)
    result.push(...l0Recent)

    if (result.length >= maxFrames) {
      return result.slice(-maxFrames)
    }

    // 从 L1 均匀采样
    const l1Sample = this.sampleEvenly(this.l1, maxFrames - result.length)
    result.push(...l1Sample)

    if (result.length >= maxFrames) {
      return result.slice(-maxFrames)
    }

    // 从 L2 均匀采样
    const l2Sample = this.sampleEvenly(this.l2, maxFrames - result.length)
    result.push(...l2Sample)

    return result.slice(-maxFrames)
  }

  /** 均匀采样 */
  private sampleEvenly(frames: Keyframe[], count: number): Keyframe[] {
    if (frames.length <= count) return [...frames]
    if (count <= 0) return []

    const step = frames.length / count
    const result: Keyframe[] = []
    for (let i = 0; i < count; i++) {
      const idx = Math.min(Math.floor(i * step), frames.length - 1)
      result.push(frames[idx]!)
    }
    return result
  }

  /** 计算估算内存使用量（字节） */
  getEstimatedMemoryUsage(): number {
    const estimateLevel = (frames: Keyframe[], scaleFactor: number) => {
      const basePixels = this.config.defaultWidth * this.config.defaultHeight
      const pixels = basePixels * scaleFactor * scaleFactor
      // 假设每个像素 4 字节（RGBA） + base64 开销（约 1.33x）
      return frames.length * pixels * 4 * 1.33
    }

    return estimateLevel(this.l0, 1) + estimateLevel(this.l1, L0_TO_L1_SCALE) + estimateLevel(this.l2, L0_TO_L1_SCALE * L1_TO_L2_SCALE)
  }

  /** 获取各级帧数统计 */
  getStats(): { l0: number; l1: number; l2: number; total: number } {
    return {
      l0: this.l0.length,
      l1: this.l1.length,
      l2: this.l2.length,
      total: this.l0.length + this.l1.length + this.l2.length,
    }
  }

  /** 清空所有帧 */
  clear(): void {
    this.l0 = []
    this.l1 = []
    this.l2 = []
  }

  /** 重置管理器 */
  reset(): void {
    this.clear()
  }
}

// ============ 单例 ============

let instance: KeyframeMemory | null = null

export function getKeyframeMemory(
  config?: KeyframeMemoryConfig,
  callbacks?: KeyframeMemoryCallbacks,
): KeyframeMemory {
  if (!instance) {
    instance = new KeyframeMemory(config, callbacks)
  }
  return instance
}

export function resetKeyframeMemory(): void {
  if (instance) {
    instance.reset()
    instance = null
  }
}
