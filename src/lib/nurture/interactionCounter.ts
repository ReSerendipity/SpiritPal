/**
 * 渐进式情绪反馈计数器模块
 *
 *
 * 主要模块：
 * - InteractionEmotion: 交互情绪类型定义
 * - InteractionCounter: 自重置计数器类
 *
 * 依赖关系：
 * - 无外部依赖（纯 TypeScript 实现）
 *
 * 核心接口：
 * - bump(): 交互计数 +1，重置计时
 * - tick(dtMs): 每帧调用，检查超时重置
 * - getEmotion(): 获取当前情绪状态（idle/curious/annoyed）
 * - getEmotionAndCheckChange(): 检测情绪变化（用于触发动画）
 *
 * UX 机制（参考 Dororo time_counter.gd + window.gd:228-232）：
 * | 鼠标悬停次数 | 情绪 |
 * |---|---|
 * | ≥ 3 次 | Doubt（怀疑/好奇） |
 * | ≥ 6 次 | DockPopAngry（愤怒/烦躁） |
 * | 30 秒无新悬停 | 计数器重置为 0 |
 */

/** 交互触发的情绪类型 */
export type InteractionEmotion = 'idle' | 'curious' | 'annoyed'

/** 默认重置时间：30秒无交互后重置 */
const DEFAULT_RESET_TIME_MS = 30_000
/** 默认好奇阈值：≥3次触发好奇情绪 */
const DEFAULT_CURIOUS_THRESHOLD = 3
/** 默认烦躁阈值：≥6次触发烦躁情绪 */
const DEFAULT_ANNOYED_THRESHOLD = 6

/**
 * 渐进式交互情绪计数器
 *
 * 核心机制：
 * 1. 用户每次交互调用 bump()，计数 +1 并重置超时计时
 * 2. 每帧调用 tick(dtMs) 累加时间
 * 3. 超过 resetTimeMs 无新交互则自动重置
 * 4. 根据计数值返回对应情绪状态
 */
export class InteractionCounter {
  private count = 0
  private duration = 0  // 累计毫秒
  private resetTimeMs: number
  private curiousThreshold: number
  private annoyedThreshold: number
  private paused = true
  private lastEmotion: InteractionEmotion = 'idle'

  /**
   * 构造函数
   * @param resetTimeMs 无交互重置时间（毫秒），默认30000ms
   * @param curiousThreshold 好奇情绪阈值（交互次数），默认3次
   * @param annoyedThreshold 烦躁情绪阈值（交互次数），默认6次
   */
  constructor(
    resetTimeMs = DEFAULT_RESET_TIME_MS,
    curiousThreshold = DEFAULT_CURIOUS_THRESHOLD,
    annoyedThreshold = DEFAULT_ANNOYED_THRESHOLD,
  ) {
    this.resetTimeMs = Math.max(0, resetTimeMs)
    this.curiousThreshold = curiousThreshold
    this.annoyedThreshold = annoyedThreshold
  }

  /**
   * 用户交互触发：计数器 +1，重置持续时间，自动开始计时
   */
  bump(): void {
    if (this.count === 0) {
      this.paused = false
    }
    this.count += 1
    this.duration = 0
  }

  /**
   * 每帧更新：累加持续时间，超时则自动重置
   * @param dtMs 距上一帧的时间差（毫秒）
   */
  tick(dtMs: number): void {
    if (this.paused) return
    this.duration += dtMs
    if (this.duration > this.resetTimeMs) {
      this.reset()
    }
  }

  /**
   * 获取当前交互计数
   * @returns 当前计数值
   */
  getCount(): number {
    return this.count
  }

  /**
   * 获取当前情绪状态
   * @returns 交互情绪：idle/curious/annoyed
   */
  getEmotion(): InteractionEmotion {
    if (this.count >= this.annoyedThreshold) return 'annoyed'
    if (this.count >= this.curiousThreshold) return 'curious'
    return 'idle'
  }

  /**
   * 检查情绪是否变化并返回新情绪（用于触发动画切换）
   * @returns 新情绪状态（如果未变化则返回null）
   */
  getEmotionAndCheckChange(): InteractionEmotion | null {
    const current = this.getEmotion()
    if (current !== this.lastEmotion) {
      this.lastEmotion = current
      return current
    }
    return null
  }

  /**
   * 重置计数器到初始状态
   */
  reset(): void {
    this.count = 0
    this.duration = 0
    this.paused = true
    this.lastEmotion = 'idle'
  }

  /**
   * 暂停计时（不重置计数，用于窗口失焦等场景）
   */
  pause(): void {
    this.paused = true
  }

  /**
   * 恢复计时（如果有未完成的计数则继续）
   */
  resume(): void {
    if (this.count > 0) {
      this.paused = false
    }
  }

  /**
   * 设置重置时间
   * @param ms 无交互重置时间（毫秒）
   */
  setResetTime(ms: number): void {
    this.resetTimeMs = Math.max(0, ms)
  }

  /**
   * 检查是否处于暂停状态
   * @returns 是否暂停
   */
  isPaused(): boolean {
    return this.paused
  }
}
