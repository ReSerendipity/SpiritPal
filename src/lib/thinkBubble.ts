/**
 * @file thinkBubble.ts
 * @description 思考气泡模块 — AI 请求处理时显示随机思考短语
 *
 * 核心功能：
 * 1. AI 请求开始后延迟 1 秒显示思考气泡（避免快速响应时闪烁）
 * 2. 随机从短语池中选择短语，定时切换营造"正在思考"的氛围
 * 3. AI 响应到达时自动消失
 * 4. 支持三种思考模式：default（默认）、quick（快速响应）、deep（深度分析）
 * 5. 最大显示时间限制（30 秒），防止异常情况下永久显示
 * 6. 提供状态订阅机制，UI 可实时响应显示/隐藏和短语变化
 *
 * 参考设计：CodeWalkers 的思考气泡设计
 *
 * 主要模块：
 * - ThinkBubbleConfig: 思考气泡配置接口
 * - ThinkBubbleManager: 思考气泡管理器类
 * - getThinkBubbleManager()/resetThinkBubbleManager(): 单例管理
 * - DEFAULT_THINK_PHRASES/QUICK_THINK_PHRASES/DEEP_THINK_PHRASES: 三级短语池
 *
 * 依赖关系：无外部依赖（纯定时器 + 发布订阅模式）
 *
 * 核心接口：
 * - ThinkBubbleManager.startThinking(): 开始思考
 * - ThinkBubbleManager.stopThinking(): 停止思考
 * - ThinkBubbleManager.subscribe(): 订阅状态变化
 */

// ============ 思考短语池 ============

/** 默认思考短语（中文） — 通用场景 */
const DEFAULT_THINK_PHRASES: string[] = [
  '让我想想…',
  '嗯…',
  '我知道了！',
  '等一下…',
  '思考中…',
  '马上就好…',
  '让我看看…',
  '这个嘛…',
  '有道理…',
  '哦！我懂了～',
  '在想了在想了…',
  '稍等一下哦～',
  '让我回忆一下…',
  '嗯嗯，我在听…',
  '这个问题有点难…',
]

/** 快速思考短语 — 用于短响应场景（如简单问答） */
const QUICK_THINK_PHRASES: string[] = [
  '嗯…',
  '让我看看…',
  '马上！',
  '好嘞～',
]

/** 深度思考短语 — 用于复杂分析场景（如代码审查、逻辑推理） */
const DEEP_THINK_PHRASES: string[] = [
  '这个问题需要好好想想…',
  '让我分析一下…',
  '有点复杂，等我一下…',
  '正在梳理思路…',
  '需要推理一下…',
]

// ============ 配置 ============

/**
 * 思考气泡配置接口
 */
export interface ThinkBubbleConfig {
  /** 显示延迟（毫秒，默认 1000）— 快速响应时不显示气泡 */
  showDelayMs: number
  /** 短语切换间隔（毫秒，默认 3000）— 模拟思考过程的短语轮换 */
  phraseSwitchIntervalMs: number
  /** 最大显示时间（毫秒，默认 30000）— 超时自动隐藏防止卡死 */
  maxShowDurationMs: number
  /** 短语池（默认使用中文短语） */
  phrases: string[]
}

/** 默认配置 */
const DEFAULT_CONFIG: ThinkBubbleConfig = {
  showDelayMs: 1000,
  phraseSwitchIntervalMs: 3000,
  maxShowDurationMs: 30000,
  phrases: DEFAULT_THINK_PHRASES,
}

// ============ 思考气泡管理器 ============

/**
 * 思考气泡管理器类
 *
 * 管理 AI 思考过程中的气泡显示，包括：
 * - 延迟显示（避免闪烁）
 * - 短语随机轮换
 * - 超时自动隐藏
 * - 状态变化订阅
 */
export class ThinkBubbleManager {
  /** 配置 */
  private config: ThinkBubbleConfig
  /** 当前是否可见 */
  private isVisible = false
  /** 当前显示的短语 */
  private currentPhrase = ''
  /** 显示延迟定时器 */
  private showDelayTimer: ReturnType<typeof setTimeout> | null = null
  /** 短语切换定时器 */
  private switchTimer: ReturnType<typeof setInterval> | null = null
  /** 最大显示时间定时器 */
  private maxTimer: ReturnType<typeof setTimeout> | null = null
  /** 状态变化监听器集合 */
  private listeners = new Set<(visible: boolean, phrase: string) => void>()
  /** 思考开始时间戳 */
  private thinkStartTime = 0

  constructor(config?: Partial<ThinkBubbleConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * AI 请求开始时调用
   *
   * 流程：
   * 1. 记录开始时间
   * 2. 根据模式选择短语池
   * 3. 选择初始短语
   * 4. 延迟 showDelayMs 后显示气泡
   * 5. 开始定时切换短语
   * 6. 设置最大显示时间超时
   *
   * @param mode 思考模式：'default' | 'quick' | 'deep'
   */
  startThinking(mode: 'default' | 'quick' | 'deep' = 'default'): void {
    // 如果已经在思考，不重复启动
    if (this.isVisible) return

    this.thinkStartTime = Date.now()

    // 根据模式选择短语池
    const phrases = mode === 'quick'
      ? QUICK_THINK_PHRASES
      : mode === 'deep'
        ? DEEP_THINK_PHRASES
        : this.config.phrases

    // 选择初始短语
    this.currentPhrase = this.pickRandom(phrases)

    // 延迟显示（避免快速响应时气泡闪烁）
    this.showDelayTimer = setTimeout(() => {
      this.isVisible = true
      this.notifyListeners()

      // 定时切换短语，营造思考氛围
      this.switchTimer = setInterval(() => {
        this.currentPhrase = this.pickRandom(phrases)
        this.notifyListeners()
      }, this.config.phraseSwitchIntervalMs)

      // 最大显示时间限制，防止异常情况下永久显示
      this.maxTimer = setTimeout(() => {
        this.stopThinking()
      }, this.config.maxShowDurationMs)
    }, this.config.showDelayMs)
  }

  /**
   * AI 响应到达时调用
   * 立即隐藏思考气泡，清除所有定时器
   */
  stopThinking(): void {
    // 清除所有定时器
    if (this.showDelayTimer) {
      clearTimeout(this.showDelayTimer)
      this.showDelayTimer = null
    }
    if (this.switchTimer) {
      clearInterval(this.switchTimer)
      this.switchTimer = null
    }
    if (this.maxTimer) {
      clearTimeout(this.maxTimer)
      this.maxTimer = null
    }

    const wasVisible = this.isVisible
    this.isVisible = false
    this.currentPhrase = ''

    // 只有之前可见时才通知，避免不必要的 UI 更新
    if (wasVisible) {
      this.notifyListeners()
    }
  }

  /**
   * 获取当前思考状态
   * @returns true 表示思考气泡正在显示
   */
  isThinking(): boolean {
    return this.isVisible
  }

  /**
   * 获取当前显示的短语
   * @returns 当前短语文本
   */
  getCurrentPhrase(): string {
    return this.currentPhrase
  }

  /**
   * 获取思考持续时间
   * @returns 思考持续毫秒数，未在思考时返回 0
   */
  getThinkDuration(): number {
    if (this.thinkStartTime === 0) return 0
    return Date.now() - this.thinkStartTime
  }

  /**
   * 订阅思考气泡状态变化
   * @param listener 状态变化回调：(visible, phrase) => void
   * @returns 取消订阅函数
   */
  subscribe(listener: (visible: boolean, phrase: string) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 销毁管理器，清除所有定时器和监听器
   */
  destroy(): void {
    this.stopThinking()
    this.listeners.clear()
  }

  // ============ 内部方法 ============

  /**
   * 从数组中随机选取一个元素
   * @param array 源数组
   * @returns 随机选中的元素
   */
  private pickRandom(array: string[]): string {
    return array[Math.floor(Math.random() * array.length)]
  }

  /**
   * 通知所有状态变化监听器
   */
  private notifyListeners(): void {
    this.listeners.forEach((fn) => fn(this.isVisible, this.currentPhrase))
  }
}

// ============ 单例 ============

/** 全局单例实例 */
let sharedManager: ThinkBubbleManager | null = null

/**
 * 获取思考气泡管理器单例
 * @param config 可选配置（首次创建时生效）
 * @returns ThinkBubbleManager 实例
 */
export function getThinkBubbleManager(config?: Partial<ThinkBubbleConfig>): ThinkBubbleManager {
  if (!sharedManager) {
    sharedManager = new ThinkBubbleManager(config)
  }
  return sharedManager
}

/**
 * 重置思考气泡管理器（用于测试或重新初始化）
 */
export function resetThinkBubbleManager(): void {
  if (sharedManager) {
    sharedManager.destroy()
    sharedManager = null
  }
}
