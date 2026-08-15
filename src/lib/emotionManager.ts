/**
 * 情绪累积管理器 — 情绪值累积触发 + LLM 表情选择 + TTS 对齐
 * 参考 Live2DPet emotion-system.js
 *
 * @fileoverview
 * 主要模块：
 * - 配置常量：基础累积速率、悬停加成、触发阈值、累积周期、表达持续时间、冷却时间等
 * - ExpressionOption 接口：可用表情信息（ID/名称/动画ID/权重）
 * - EmotionEvent 接口：情绪触发事件（时间戳/表情/持续时间/TTS对齐）
 * - EmotionCallbacks 接口：情绪系统回调
 * - EmotionManager 类：情绪管理器（单例），支持情绪累积、阈值触发、LLM 表情选择、TTS 对齐、冷却控制
 *
 * 核心机制：
 * 1. 情绪值每秒累积（基础速率 + 悬停加成）
 * 2. 达到阈值后触发情绪选择
 * 3. 通过 LLM 从可用表情列表中选择最合适的表情
 * 4. 支持 TTS 对齐：表情持续时间与音频时长同步
 *
 * @module emotionManager
 * @requires ./animationConfig - AnimationId 类型定义
 */

import type { AnimationId } from './animationConfig'

// ============ 配置常量 ============

/** 悬停时的累积加成倍率 */
const HOVER_BONUS_MULTIPLIER = 1.5

/** 默认情绪触发阈值 */
const DEFAULT_EMOTION_THRESHOLD = 100

/** 默认累积周期（秒）— 多少秒触发一次情绪检查 */
const DEFAULT_FREQUENCY_SECONDS = 100

/** 情绪表达持续时间默认值（毫秒） */
const DEFAULT_EXPRESSION_DURATION_MS = 3000

/** TTS 对齐缓冲时间（毫秒） */
const TTS_ALIGNMENT_BUFFER_MS = 500

/** 情绪表达冷却时间（毫秒）— 避免频繁切换 */
const EXPRESSION_COOLDOWN_MS = 5000

// ============ 类型定义 ============

/** 可用表情信息 */
export interface ExpressionOption {
  /** 表情 ID（对应 Live2D motion group 或精灵图 PetState） */
  id: string
  /** 表情名称 */
  name: string
  /** 动画 ID（对应 animationConfig 中的 AnimationId） */
  animationId?: AnimationId
  /** 表情权重（越高越容易被选中） */
  weight: number
}

/** 情绪触发事件 */
export interface EmotionEvent {
  /** 触发时间戳 */
  timestamp: number
  /** 选中的表情 */
  expression: ExpressionOption
  /** 表情持续时间（毫秒） */
  durationMs: number
  /** 是否由 TTS 对齐触发 */
  ttsAligned: boolean
}

/** 情绪系统回调 */
export interface EmotionCallbacks {
  /** 当情绪被触发时 */
  onEmotionTriggered?: (event: EmotionEvent) => void
  /** 当表情需要应用时 */
  onExpressionApply?: (expression: ExpressionOption, durationMs: number) => void
  /** 当表情需要清除时 */
  onExpressionClear?: () => void
  /** 当需要 LLM 选择表情时 */
  onLLMSelectExpression?: (
    availableExpressions: ExpressionOption[],
    recentContext: string,
  ) => Promise<ExpressionOption | null>
}

// ============ 情绪管理器 ============

export class EmotionManager {
  private emotionValue = 0
  private threshold: number
  private frequencySeconds: number
  private isHovered = false
  private lastTriggeredAt = 0
  private callbacks: EmotionCallbacks
  private tickInterval: ReturnType<typeof setInterval> | null = null

  // TTS 对齐状态
  private ttsAligned = false
  private ttsEndTime = 0

  // 最近的触发事件（用于反重复）
  private recentEvents: EmotionEvent[] = []
  private readonly MAX_RECENT_EVENTS = 10

  constructor(
    callbacks: EmotionCallbacks = {},
    options: { threshold?: number; frequencySeconds?: number } = {},
  ) {
    this.callbacks = callbacks
    this.threshold = options.threshold ?? DEFAULT_EMOTION_THRESHOLD
    this.frequencySeconds = options.frequencySeconds ?? DEFAULT_FREQUENCY_SECONDS
  }

  // ============ 生命周期 ============

  /** 启动情绪累积 tick（每秒调用） */
  start(): void {
    if (this.tickInterval) return
    this.tickInterval = setInterval(() => this.tick(), 1000)
  }

  /** 停止情绪累积 */
  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval)
      this.tickInterval = null
    }
  }

  /**
   * 更新回调函数
   * @param callbacks 新的回调配置
   */
  updateCallbacks(callbacks: EmotionCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks }
  }

  /**
   * 更新配置选项
   * @param options 新的配置选项
   */
  updateOptions(options: { threshold?: number; frequencySeconds?: number }): void {
    if (options.threshold !== undefined) {
      this.threshold = options.threshold
    }
    if (options.frequencySeconds !== undefined) {
      this.frequencySeconds = options.frequencySeconds
    }
  }

  /** 销毁管理器，停止累积并清空所有状态 */
  destroy(): void {
    this.stop()
    this.emotionValue = 0
    this.threshold = DEFAULT_EMOTION_THRESHOLD
    this.frequencySeconds = DEFAULT_FREQUENCY_SECONDS
    this.isHovered = false
    this.lastTriggeredAt = 0
    this.ttsAligned = false
    this.ttsEndTime = 0
    this.callbacks = {}
    this.recentEvents = []
  }

  /** dispose 别名，与 destroy 功能一致，保持 API 一致性 */
  dispose(): void {
    this.destroy()
  }

  // ============ 情绪累积 ============

  /**
   * 每秒 tick — 累积情绪值
   * 被 PetWindow 的 useEffect 定时器调用
   */
  tick(): void {
    const rate = this.threshold / this.frequencySeconds
    const actualRate = this.isHovered ? rate * HOVER_BONUS_MULTIPLIER : rate
    this.emotionValue = Math.min(this.emotionValue + actualRate, this.threshold * 1.5)

    // 检查是否达到阈值
    if (this.emotionValue >= this.threshold) {
      this.triggerEmotionSelection(false)
      this.emotionValue = 0
    }

    // 检查 TTS 对齐结束
    if (this.ttsAligned && Date.now() >= this.ttsEndTime) {
      this.ttsAligned = false
      this.callbacks.onExpressionClear?.()
    }
  }

  /** 设置悬停状态 */
  setHovered(hovered: boolean): void {
    this.isHovered = hovered
  }

  /** 设置情绪值（外部控制，如 LLM 聊天后提升心情） */
  setValue(value: number): void {
    this.emotionValue = Math.max(0, Math.min(value, this.threshold * 1.5))
  }

  /** 获取当前情绪值 */
  getValue(): number {
    return this.emotionValue
  }

  // ============ 情绪触发 ============

  /**
   * 触发情绪选择（手动触发，如 LLM 回复后）
   * @param ttsAligned 是否需要 TTS 对齐
   * @param audioDurationMs TTS 音频时长（毫秒）
   */
  async triggerEmotionSelection(
    ttsAligned = false,
    audioDurationMs?: number,
  ): Promise<void> {
    const now = Date.now()

    // 冷却检查
    if (now - this.lastTriggeredAt < EXPRESSION_COOLDOWN_MS) return

    this.lastTriggeredAt = now

    // 如果有 LLM 选择回调，通过 LLM 选择表情
    let selected: ExpressionOption | null = null
    if (this.callbacks.onLLMSelectExpression) {
      const recentContext = this.recentEvents
        .slice(-3)
        .map(e => e.expression.name)
        .join(', ')

      // 获取可用表情列表（子类或外部提供）
      const available = this.getAvailableExpressions()
      selected = await this.callbacks.onLLMSelectExpression(available, recentContext)
    }

    if (!selected) {
      // 降级：随机选择
      const available = this.getAvailableExpressions()
      selected = available[Math.floor(Math.random() * available.length)]
    }

    if (!selected) return

    // 计算持续时间
    let durationMs = DEFAULT_EXPRESSION_DURATION_MS
    if (ttsAligned && audioDurationMs) {
      durationMs = audioDurationMs + TTS_ALIGNMENT_BUFFER_MS
      this.ttsAligned = true
      this.ttsEndTime = Date.now() + durationMs
    }

    // 构建事件
    const event: EmotionEvent = {
      timestamp: now,
      expression: selected,
      durationMs,
      ttsAligned,
    }

    // 记录到最近事件
    this.recentEvents.push(event)
    if (this.recentEvents.length > this.MAX_RECENT_EVENTS) {
      this.recentEvents.shift()
    }

    // 触发回调
    this.callbacks.onEmotionTriggered?.(event)
    this.callbacks.onExpressionApply?.(selected, durationMs)
  }

  // ============ TTS 对齐 ============

  /**
   * 启动 TTS 对齐模式
   * 在 TTS 开始播放时调用，表情持续时间与音频同步
   */
  startTTSAlignment(audioDurationMs: number): void {
    this.ttsAligned = true
    this.ttsEndTime = Date.now() + audioDurationMs + TTS_ALIGNMENT_BUFFER_MS
    // 立即触发情绪选择（TTS 对齐）
    this.triggerEmotionSelection(true, audioDurationMs)
  }

  /** 手动结束 TTS 对齐 */
  endTTSAlignment(): void {
    this.ttsAligned = false
    this.callbacks.onExpressionClear?.()
  }

  // ============ 查询 ============

  /** 获取可用表情列表（可由外部覆盖） */
  private getAvailableExpressions(): ExpressionOption[] {
    // 默认表情集（可扩展）
    return [
      { id: 'happy', name: '开心', animationId: 'happy', weight: 3 },
      { id: 'sad', name: '伤心', animationId: 'sad', weight: 1 },
      { id: 'excited', name: '兴奋', animationId: 'excited', weight: 2 },
      { id: 'surprised', name: '惊讶', animationId: 'surprised', weight: 1 },
      { id: 'shy', name: '害羞', animationId: 'shy', weight: 1 },
      { id: 'idle', name: '平静', animationId: 'idle', weight: 5 },
    ]
  }

  /** 获取最近的情绪事件 */
  getRecentEvents(): EmotionEvent[] {
    return [...this.recentEvents]
  }

  /** 重置情绪值 */
  reset(): void {
    this.emotionValue = 0
    this.lastTriggeredAt = 0
    this.ttsAligned = false
    this.recentEvents = []
  }
}

// ============ 单例 ============

let instance: EmotionManager | null = null

export function getEmotionManager(
  callbacks?: EmotionCallbacks,
  options?: { threshold?: number; frequencySeconds?: number },
): EmotionManager {
  if (!instance) {
    instance = new EmotionManager(callbacks, options)
  } else {
    if (callbacks) {
      instance.updateCallbacks(callbacks)
    }
    if (options) {
      instance.updateOptions(options)
    }
  }
  return instance
}

export function resetEmotionManager(): void {
  if (instance) {
    instance.destroy()
    instance = null
  }
}

/** dispose 别名，与 resetEmotionManager 功能一致，保持 API 一致性 */
export const disposeEmotionManager = resetEmotionManager
