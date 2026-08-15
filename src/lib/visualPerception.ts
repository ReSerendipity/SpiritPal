/**
 * @file visualPerception.ts
 * @description 视觉感知模块
 *
 * 参考 Live2DPet vlm-extractor.js + screen-capture.js 实现
 * 通过定时截屏和活动窗口检测，结合 Vision LLM 分析用户当前活动，触发主动对话
 *
 * 核心机制：
 * 1. 定时截屏（每 30-60 秒，可配置）
 * 2. 活动窗口检测（复用 Rust get_active_window）
 * 3. 将截图 + 窗口信息发送给 Vision LLM 分析
 * 4. 根据分析结果触发主动对话
 *
 * P2 增强（Phase 2.6）：
 * 5. 活动窗口变化检测 — 进程切换时立即触发分析（而非等待定时）
 * 6. Vision LLM 增强分析 — 多轮对话式场景理解
 * 7. 活动历史轨迹 — 记录最近 N 次活动变化，用于推断用户意图
 * 8. 置信度加权 — 窗口标题 + 进程名 + 截图三重验证
 *
 * 隐私设计：截图仅发送给用户配置的 API，不存储到本地磁盘
 *
 * 主要模块：
 * - ActiveWindowInfo: 活动窗口信息接口
 * - VisualAnalysis: 视觉感知分析结果接口
 * - ActivityRecord: 活动历史记录接口
 * - VisualCallbacks: 视觉感知回调接口
 * - VisualPerceptionManager: 视觉感知管理器类
 * - getVisualPerceptionManager()/resetVisualPerceptionManager(): 单例管理
 *
 * 依赖关系：
 * - @tauri-apps/api/core: Tauri invoke API（调用 Rust 后端截屏/窗口检测）
 */

import { invoke } from '@tauri-apps/api/core'

// ============ 配置常量 ============

/** 默认截屏间隔（毫秒） */
const DEFAULT_CAPTURE_INTERVAL_MS = 45_000

/** 最大连续分析失败次数（触发降级） */
const MAX_CONSECUTIVE_FAILURES = 3

/** 截屏降级延迟（毫秒）— 连续失败后延长间隔 */
const DEGRADATION_DELAY_MS = 60_000

/** 活动历史最大记录数 */
const MAX_ACTIVITY_HISTORY = 20

/** 窗口变化检测间隔（毫秒）— 比截屏更频繁 */
const WINDOW_CHECK_INTERVAL_MS = 5_000

/** 置信度阈值 — 高于此值才触发主动对话 */
const CONFIDENCE_THRESHOLD = 0.6

// ============ 类型定义 ============

/**
 * 活动窗口信息接口
 */
export interface ActiveWindowInfo {
  /** 窗口标题 */
  title: string
  /** 进程名称 */
  processName: string
}

/**
 * 视觉感知分析结果接口
 */
export interface VisualAnalysis {
  /** 用户正在做什么（描述） */
  userActivity: string
  /** 推断的工作状态 */
  inferredWorkState: string
  /** 相关主题（用于对话） */
  relevantTopics: string[]
  /** 活动窗口信息 */
  window: ActiveWindowInfo
  /** 分析时间戳 */
  timestamp: number
  /** P2: 分析置信度（0-1，标题+进程+截图三重验证加权） */
  confidence?: number
  /** P2: 场景细节（Vision LLM 的详细场景描述） */
  sceneDetails?: string
}

/**
 * P2: 活动历史记录接口
 */
export interface ActivityRecord {
  /** 活动窗口信息 */
  window: ActiveWindowInfo
  /** 推断的工作状态 */
  workState: string
  /** 时间戳 */
  timestamp: number
  /** 持续时间（毫秒，仅在该记录结束时有值） */
  durationMs?: number
}

/**
 * 视觉感知回调接口
 */
export interface VisualCallbacks {
  /** 当分析完成时 */
  onAnalysisComplete?: (analysis: VisualAnalysis) => void
  /** 当检测到有趣活动时（触发主动对话） */
  onInterestingActivity?: (analysis: VisualAnalysis) => void
  /** 当分析失败时 */
  onAnalysisError?: (error: string) => void
  /** 自定义截屏函数（用于测试或不同平台） */
  onCaptureScreen?: () => Promise<string>
  /** 自定义 LLM Vision 分析函数 */
  onLLMAnalyze?: (imageBase64: string, windowInfo: ActiveWindowInfo) => Promise<{
    userActivity: string
    inferredWorkState: string
    relevantTopics: string[]
  }>
  /** P2: 当活动窗口变化时 */
  onWindowChange?: (oldWindow: ActiveWindowInfo, newWindow: ActiveWindowInfo) => void
  /** P2: Vision LLM 增强分析（多轮对话式，返回详细场景描述） */
  onVisionAnalyzeEnhanced?: (
    imageBase64: string,
    windowInfo: ActiveWindowInfo,
    activityHistory: ActivityRecord[],
  ) => Promise<{
    userActivity: string
    inferredWorkState: string
    relevantTopics: string[]
    sceneDetails: string
    confidence: number
  }>
}

// ============ 视觉感知管理器 ============

/**
 * 视觉感知管理器类
 *
 * 负责定时截屏、活动窗口检测、Vision LLM 分析和主动对话触发
 * 支持失败降级、窗口变化即时分析、活动历史记录等功能
 */
export class VisualPerceptionManager {
  private callbacks: VisualCallbacks
  private intervalMs: number
  private captureTimer: ReturnType<typeof setInterval> | null = null
  private isRunning = false
  private consecutiveFailures = 0
  private lastAnalysis: VisualAnalysis | null = null
  // P2: 活动历史轨迹
  private activityHistory: ActivityRecord[] = []
  // P2: 窗口变化检测
  private windowCheckTimer: ReturnType<typeof setInterval> | null = null
  private lastWindow: ActiveWindowInfo = { title: '', processName: '' }

  /**
   * 构造函数
   * @param callbacks 回调配置
   * @param options 配置选项
   */
  constructor(
    callbacks: VisualCallbacks = {},
    options: { captureIntervalMs?: number } = {},
  ) {
    this.callbacks = callbacks
    this.intervalMs = options.captureIntervalMs ?? DEFAULT_CAPTURE_INTERVAL_MS
  }

  // ============ 生命周期 ============

  /**
   * 启动视觉感知
   * 启动截屏定时器和窗口变化检测
   */
  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    this.scheduleCapture()
    // P2: 启动窗口变化检测
    this.startWindowCheck()
  }

  /**
   * 停止视觉感知
   * 清除所有定时器
   */
  stop(): void {
    this.isRunning = false
    if (this.captureTimer) {
      clearTimeout(this.captureTimer)
      this.captureTimer = null
    }
    // P2: 停止窗口变化检测
    if (this.windowCheckTimer) {
      clearInterval(this.windowCheckTimer)
      this.windowCheckTimer = null
    }
  }

  /**
   * 销毁管理器
   * 停止运行并清空历史记录
   */
  destroy(): void {
    this.stop()
    this.activityHistory = []
    this.callbacks = {}
  }

  // ============ 截屏调度 ============

  /**
   * 调度下一次截屏
   * 根据连续失败次数动态调整间隔（失败降级）
   */
  private scheduleCapture(): void {
    if (!this.isRunning) return

    // 根据失败次数调整间隔
    const delay = this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES
      ? this.intervalMs + DEGRADATION_DELAY_MS
      : this.intervalMs

    this.captureTimer = setTimeout(() => {
      this.performCapture().finally(() => {
        this.scheduleCapture()
      })
    }, delay)
  }

  /**
   * 执行一次截屏和分析
   *
   * 流程：
   * 1. 获取活动窗口信息
   * 2. 截屏
   * 3. 分析（优先使用 P2 增强分析，降级到基础分析，再降级到仅窗口推断）
   * 4. 记录结果并更新历史
   * 5. 触发回调
   * 6. 置信度检查后触发有趣活动通知
   *
   * @returns 分析结果，失败返回 null
   */
  async performCapture(): Promise<VisualAnalysis | null> {
    try {
      // 1. 获取活动窗口信息
      const windowInfo = await this.getActiveWindow()

      // 2. 截屏
      const imageBase64 = await this.captureScreen()
      if (!imageBase64) {
        this.consecutiveFailures++
        return null
      }

      // 3. 分析（优先使用 P2 增强分析，降级到基础分析）
      let analysis: VisualAnalysis
      if (this.callbacks.onVisionAnalyzeEnhanced) {
        // P2: Vision LLM 增强分析（含活动历史）
        const result = await this.callbacks.onVisionAnalyzeEnhanced(
          imageBase64,
          windowInfo,
          this.activityHistory,
        )
        analysis = {
          ...result,
          window: windowInfo,
          timestamp: Date.now(),
        }
      } else if (this.callbacks.onLLMAnalyze) {
        const result = await this.callbacks.onLLMAnalyze(imageBase64, windowInfo)
        analysis = {
          ...result,
          window: windowInfo,
          timestamp: Date.now(),
          // P2: 基础分析置信度较低
          confidence: 0.5,
        }
      } else {
        // 无 LLM 分析时，仅记录窗口信息
        analysis = {
          userActivity: `当前窗口: ${windowInfo.title} (${windowInfo.processName})`,
          inferredWorkState: this.inferWorkStateFromProcess(windowInfo.processName),
          relevantTopics: [],
          window: windowInfo,
          timestamp: Date.now(),
          // P2: 仅窗口推断，置信度最低
          confidence: 0.3,
        }
      }

      // 4. 记录结果
      this.lastAnalysis = analysis
      this.consecutiveFailures = 0

      // P2: 更新活动历史
      this.recordActivity(windowInfo, analysis.inferredWorkState)

      // 5. 触发回调
      this.callbacks.onAnalysisComplete?.(analysis)

      // 6. 检查是否为有趣活动（P2: 加置信度阈值）
      const confidence = analysis.confidence ?? 0.5
      if (this.isInterestingActivity(analysis) && confidence >= CONFIDENCE_THRESHOLD) {
        this.callbacks.onInterestingActivity?.(analysis)
      }

      return analysis
    } catch (err) {
      this.consecutiveFailures++
      const errorMsg = err instanceof Error ? err.message : String(err)
      this.callbacks.onAnalysisError?.(errorMsg)
      return null
    }
  }

  // ============ 截屏实现 ============

  /**
   * 截屏实现
   * 优先使用自定义截屏函数，否则调用 Rust 后端 take_screenshot 命令
   * @returns Base64 编码的截图，失败返回 null
   */
  private async captureScreen(): Promise<string | null> {
    // 使用自定义截屏函数（测试用）
    if (this.callbacks.onCaptureScreen) {
      return this.callbacks.onCaptureScreen()
    }

    // 默认实现：通过 Rust 后端截屏（如果已实现）
    try {
      // 尝试调用 Tauri 截屏命令（需要 Rust 后端支持）
      const base64 = await invoke<string>('take_screenshot', {
        maxWidth: 512,
        quality: 30,
      })
      return base64
    } catch {
      // 截屏命令未实现时降级：仅记录窗口信息
      return null
    }
  }

  // ============ 活动窗口检测 ============

  /**
   * 获取当前活动窗口信息
   * 调用 Rust 后端 get_active_window 命令
   * @returns 活动窗口信息
   */
  private async getActiveWindow(): Promise<ActiveWindowInfo> {
    try {
      const info = await invoke<{ title: string; process_name: string }>('get_active_window')
      return {
        title: info.title,
        processName: info.process_name,
      }
    } catch {
      return { title: '', processName: '' }
    }
  }

  // ============ 工作状态推断 ============

  /**
   * 从进程名推断工作状态
   * 使用正则匹配常见进程名，映射到 coding/browsing/terminal/meeting/media/writing/unknown
   * @param processName 进程名称
   * @returns 推断的工作状态
   */
  private inferWorkStateFromProcess(processName: string): string {
    const lower = processName.toLowerCase()

    // 编程
    if (/\b(code|vscode|cursor|intellij|webstorm|pycharm|sublime|vim|nvim)\b/.test(lower)) {
      return 'coding'
    }
    // 浏览器
    if (/\b(chrome|firefox|edge|safari|brave|opera)\b/.test(lower)) {
      return 'browsing'
    }
    // 终端
    if (/\b(terminal|cmd|powershell|iterative|hyper)\b/.test(lower)) {
      return 'terminal'
    }
    // 视频会议
    if (/\b(zoom|teams|meet|slack|discord|腾讯会议|飞书)\b/.test(lower)) {
      return 'meeting'
    }
    // 媒体播放
    if (/\b(spotify|vlc|potplayer|foobar|netease-cloud-music)\b/.test(lower)) {
      return 'media'
    }
    // 办公
    if (/\b(word|excel|powerpoint|notion|obsidian|typora)\b/.test(lower)) {
      return 'writing'
    }

    return 'unknown'
  }

  // ============ 有趣活动检测 ============

  /**
   * 检测活动是否有趣（值得主动对话）
   * 规则：
   * - 同一窗口停留超过 30 分钟
   * - 切换到编程工作
   * - 切换到会议
   * @param analysis 当前分析结果
   * @returns 是否为有趣活动
   */
  private isInterestingActivity(analysis: VisualAnalysis): boolean {
    // 长时间在同一窗口
    if (this.lastAnalysis && this.lastAnalysis.window.processName === analysis.window.processName) {
      const elapsed = analysis.timestamp - this.lastAnalysis.timestamp
      // 超过 30 分钟在同一窗口
      if (elapsed > 30 * 60_000) return true
    }

    // 切换到编程工作
    if (analysis.inferredWorkState === 'coding' &&
        this.lastAnalysis?.inferredWorkState !== 'coding') {
      return true
    }

    // 切换到会议
    if (analysis.inferredWorkState === 'meeting' &&
        this.lastAnalysis?.inferredWorkState !== 'meeting') {
      return true
    }

    return false
  }

  // ============ P2: 活动窗口变化检测 ============

  /**
   * 启动窗口变化检测定时器
   * 每 WINDOW_CHECK_INTERVAL_MS 检测一次窗口变化
   */
  private startWindowCheck(): void {
    if (this.windowCheckTimer) return
    this.windowCheckTimer = setInterval(() => {
      this.checkWindowChange()
    }, WINDOW_CHECK_INTERVAL_MS)
  }

  /**
   * 检测活动窗口变化
   * 进程切换时立即触发分析，标题变化时仅通知回调
   */
  private async checkWindowChange(): Promise<void> {
    if (!this.isRunning) return

    try {
      const currentWindow = await this.getActiveWindow()
      if (!currentWindow.processName) return

      // 检测窗口变化（进程名或标题变化）
      const processChanged = currentWindow.processName !== this.lastWindow.processName
      const titleChanged = currentWindow.title !== this.lastWindow.title
        && currentWindow.processName === this.lastWindow.processName

      if (processChanged || titleChanged) {
        const oldWindow = { ...this.lastWindow }
        this.lastWindow = currentWindow

        // 触发窗口变化回调
        this.callbacks.onWindowChange?.(oldWindow, currentWindow)

        // 进程切换时立即触发分析（不等待定时截屏）
        if (processChanged) {
          this.performCapture()
        }
      }
    } catch {
      // 窗口检测失败不影响主流程
    }
  }

  // ============ P2: 活动历史记录 ============

  /**
   * 记录活动到历史轨迹
   * 更新上一条记录的持续时间，添加新记录，限制历史长度
   * @param windowInfo 窗口信息
   * @param workState 工作状态
   */
  private recordActivity(windowInfo: ActiveWindowInfo, workState: string): void {
    const now = Date.now()

    // 更新上一条记录的持续时间
    if (this.activityHistory.length > 0) {
      const lastRecord = this.activityHistory[this.activityHistory.length - 1]!
      lastRecord.durationMs = now - lastRecord.timestamp
    }

    this.activityHistory.push({
      window: { ...windowInfo },
      workState,
      timestamp: now,
    })

    // 限制历史长度
    if (this.activityHistory.length > MAX_ACTIVITY_HISTORY) {
      this.activityHistory.shift()
    }
  }

  // ============ 查询 ============

  /**
   * 获取最近一次分析结果
   * @returns 最近的分析结果，无则返回 null
   */
  getLastAnalysis(): VisualAnalysis | null {
    return this.lastAnalysis
  }

  /**
   * 手动触发一次分析
   * @returns 分析结果
   */
  async triggerAnalysis(): Promise<VisualAnalysis | null> {
    return this.performCapture()
  }

  /**
   * 获取活动历史（只读）
   * @returns 活动历史记录数组
   */
  getActivityHistory(): ReadonlyArray<ActivityRecord> {
    return this.activityHistory
  }

  /**
   * 获取最近 N 分钟的活动统计
   * @param minutes 统计时间范围（分钟），默认 30
   * @returns 活动统计：状态分布、切换次数、最常使用进程
   */
  getActivityStats(minutes: number = 30): {
    /** 各工作状态占比 */
    stateDistribution: Record<string, number>
    /** 窗口切换次数 */
    switchCount: number
    /** 最常使用的进程 */
    topProcess: string
  } {
    const cutoff = Date.now() - minutes * 60_000
    const recent = this.activityHistory.filter(r => r.timestamp >= cutoff)

    // 状态分布
    const stateCount: Record<string, number> = {}
    let switchCount = 0
    const processCount: Record<string, number> = {}
    let lastProcess = ''

    for (const record of recent) {
      stateCount[record.workState] = (stateCount[record.workState] ?? 0) + 1
      processCount[record.window.processName] = (processCount[record.window.processName] ?? 0) + 1
      if (lastProcess && record.window.processName !== lastProcess) {
        switchCount++
      }
      lastProcess = record.window.processName
    }

    // 计算占比
    const total = recent.length || 1
    const stateDistribution: Record<string, number> = {}
    for (const [state, count] of Object.entries(stateCount)) {
      stateDistribution[state] = count / total
    }

    // 最常用进程
    let topProcess = ''
    let topCount = 0
    for (const [process, count] of Object.entries(processCount)) {
      if (count > topCount) {
        topCount = count
        topProcess = process
      }
    }

    return { stateDistribution, switchCount, topProcess }
  }
}

// ============ 单例 ============

/** 视觉感知管理器单例 */
let instance: VisualPerceptionManager | null = null

/**
 * 获取视觉感知管理器单例
 * @param callbacks 可选的回调配置（仅首次创建时生效）
 * @param options 可选的配置选项（仅首次创建时生效）
 * @returns 视觉感知管理器实例
 */
export function getVisualPerceptionManager(
  callbacks?: VisualCallbacks,
  options?: { captureIntervalMs?: number },
): VisualPerceptionManager {
  if (!instance) {
    instance = new VisualPerceptionManager(callbacks, options)
  }
  return instance
}

/**
 * 重置视觉感知管理器单例
 * 销毁现有实例（主要用于测试）
 */
export function resetVisualPerceptionManager(): void {
  if (instance) {
    instance.destroy()
    instance = null
  }
}
