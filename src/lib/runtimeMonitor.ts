/**
 * @file runtimeMonitor.ts
 * @description 应用运行时性能监控模块 — FPS / 内存 / LLM 延迟 / 渲染性能
 *
 * 基于 commonUtils.ts 中的 PerformanceMonitor 扩展，提供应用级别的实时性能指标收集。
 * 设计为零依赖、低开销（采样而非持续监控），不影响应用正常性能。
 *
 * 监控指标：
 * - FPS：实时帧率（通过 requestAnimationFrame 采样）
 * - 内存：JS 堆使用量（Chrome performance.memory API）
 * - LLM 延迟：记录 LLM API 调用的端到端延迟
 * - 渲染指标：PetWindow 重渲染频率、气泡显示时长等
 * - 慢操作告警：超过阈值的操作自动记录
 *
 * @example
 * ```ts
 * import { runtimeMonitor } from '@/lib/runtimeMonitor'
 *
 * // 启动监控
 * runtimeMonitor.start()
 *
 * // 记录 LLM 调用
 * const marker = runtimeMonitor.startLLMCall('chat')
 * const response = await llmClient.chat(...)
 * runtimeMonitor.endLLMCall(marker)
 *
 * // 获取当前快照
 * const snapshot = runtimeMonitor.getSnapshot()
 * console.log(`FPS: ${snapshot.fps}, Memory: ${snapshot.memoryMB}MB`)
 * ```
 */

import { PerformanceMonitor, perfMonitor } from './commonUtils'

// ============ 类型定义 ============

/** FPS 采样数据 */
export interface FPSSample {
  /** 当前帧率 */
  fps: number
  /** 1 分钟平均帧率 */
  avgFps: number
  /** 最低帧率（近 60 帧内） */
  minFps: number
  /** 帧率低于 30 的帧比例 */
  dropRatio: number
}

/** 内存使用数据 */
export interface MemorySample {
  /** 已使用 JS 堆大小（MB） */
  usedJSHeapMB: number
  /** JS 堆总大小（MB） */
  totalJSHeapMB: number
  /** JS 堆上限（MB） */
  jsHeapSizeLimitMB: number
  /** DOM 节点数 */
  domNodes?: number
}

/** LLM 调用统计 */
export interface LLMMetrics {
  /** 总调用次数 */
  totalCalls: number
  /** 平均延迟（ms） */
  avgLatency: number
  /** P95 延迟（ms） */
  p95Latency: number
  /** 最大延迟（ms） */
  maxLatency: number
  /** 最近 N 次延迟样本 */
  recentLatencies: number[]
  /** 错误率 */
  errorRate: number
}

/** 性能快照 */
export interface RuntimeSnapshot {
  /** 采样时间戳 */
  timestamp: number
  /** FPS 数据 */
  fps: FPSSample
  /** 内存数据 */
  memory: MemorySample
  /** LLM 指标 */
  llm: LLMMetrics
  /** 应用运行时长（ms） */
  uptime: number
}

/** LLM 调用标记句柄 */
export interface LLMCallHandle {
  id: string
  provider: string
  startTime: number
}

// ============ 常量 ============

const FPS_SAMPLE_WINDOW = 60
const MEMORY_SAMPLE_INTERVAL = 5000
const LLM_RECENT_SAMPLES = 50
const FPS_LOW_THRESHOLD = 30

// ============ RuntimeMonitor 类 ============

export class RuntimeMonitor {
  private started = false
  private startTime = 0

  // FPS 采样
  private frameTimes: number[] = []
  private lastFrameTime = 0
  private fpsRafId: number | null = null
  private currentFps = 60
  private fpsMin = 60
  private fpsAvg = 60
  private lowFrameCount = 0
  private totalFrameCount = 0

  // 内存采样
  private memoryTimer: ReturnType<typeof setInterval> | null = null
  private currentMemory: MemorySample = {
    usedJSHeapMB: 0,
    totalJSHeapMB: 0,
    jsHeapSizeLimitMB: 0,
  }

  // LLM 指标
  private llmLatencies: number[] = []
  private llmErrors = 0
  private llmTotalCalls = 0
  private activeLLMCalls = new Map<string, { provider: string; startTime: number }>()

  // 扩展的 perfMonitor（用于命名操作计时）
  readonly perf: PerformanceMonitor

  // 告警回调
  private alertHandlers: Set<(type: string, data: Record<string, unknown>) => void> = new Set()

  constructor() {
    this.perf = perfMonitor
  }

  /**
   * 启动运行时监控（幂等）
   */
  start(): void {
    if (this.started) return
    this.started = true
    this.startTime = performance.now()

    this.startFPSSampling()
    this.startMemorySampling()
  }

  /**
   * 停止运行时监控
   */
  stop(): void {
    if (!this.started) return
    this.started = false

    if (this.fpsRafId !== null) {
      cancelAnimationFrame(this.fpsRafId)
      this.fpsRafId = null
    }
    if (this.memoryTimer !== null) {
      clearInterval(this.memoryTimer)
      this.memoryTimer = null
    }
  }

  // ============ FPS 监控 ============

  private startFPSSampling(): void {
    this.lastFrameTime = performance.now()

    const sampleFrame = () => {
      if (!this.started) return

      const now = performance.now()
      const delta = now - this.lastFrameTime
      this.lastFrameTime = now

      if (delta > 0 && delta < 1000) {
        this.frameTimes.push(delta)
        this.totalFrameCount++

        // 保持滑动窗口
        if (this.frameTimes.length > FPS_SAMPLE_WINDOW) {
          this.frameTimes.shift()
        }

        // 计算 FPS（每秒更新一次）
        if (this.frameTimes.length >= 10) {
          const avgDelta = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
          const fps = 1000 / avgDelta
          this.currentFps = Math.round(fps * 10) / 10

          // 最低帧率
          const maxDelta = Math.max(...this.frameTimes)
          this.fpsMin = Math.round((1000 / maxDelta) * 10) / 10

          // 1分钟平均（累计）
          this.fpsAvg = this.fpsAvg === 0 ? this.currentFps : (this.fpsAvg * 0.95 + this.currentFps * 0.05)

          // 掉帧统计
          if (fps < FPS_LOW_THRESHOLD) {
            this.lowFrameCount++
          }
        }
      }

      this.fpsRafId = requestAnimationFrame(sampleFrame)
    }

    this.fpsRafId = requestAnimationFrame(sampleFrame)
  }

  // ============ 内存监控 ============

  private startMemorySampling(): void {
    this.sampleMemory()
    this.memoryTimer = setInterval(() => this.sampleMemory(), MEMORY_SAMPLE_INTERVAL)
  }

  private sampleMemory(): void {
    // Chrome 专有 API
    const perfMemory = (performance as unknown as {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number }
    }).memory

    if (perfMemory) {
      this.currentMemory = {
        usedJSHeapMB: Math.round(perfMemory.usedJSHeapSize / 1048576 * 10) / 10,
        totalJSHeapMB: Math.round(perfMemory.totalJSHeapSize / 1048576 * 10) / 10,
        jsHeapSizeLimitMB: Math.round(perfMemory.jsHeapSizeLimit / 1048576 * 10) / 10,
      }
    }

    // DOM 节点数
    if (typeof document !== 'undefined') {
      this.currentMemory.domNodes = document.querySelectorAll('*').length
    }

    // 内存告警
    if (this.currentMemory.usedJSHeapMB > 200) {
      this.emitAlert('high_memory', {
        usedMB: this.currentMemory.usedJSHeapMB,
        limitMB: this.currentMemory.jsHeapSizeLimitMB,
      })
    }
  }

  // ============ LLM 延迟监控 ============

  /**
   * 开始记录 LLM 调用
   * @param provider LLM 提供商名称（如 'openai', 'ollama', 'free'）
   * @returns 标记句柄
   */
  startLLMCall(provider: string): LLMCallHandle {
    const id = `llm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const handle: LLMCallHandle = { id, provider, startTime: performance.now() }
    this.activeLLMCalls.set(id, { provider, startTime: handle.startTime })
    return handle
  }

  /**
   * 结束 LLM 调用记录
   * @param handle startLLMCall 返回的句柄
   * @param error 是否发生错误
   */
  endLLMCall(handle: LLMCallHandle, error = false): number {
    const entry = this.activeLLMCalls.get(handle.id)
    if (!entry) return -1

    this.activeLLMCalls.delete(handle.id)
    const latency = performance.now() - entry.startTime
    this.llmTotalCalls++

    if (error) {
      this.llmErrors++
    } else {
      this.llmLatencies.push(latency)
      if (this.llmLatencies.length > LLM_RECENT_SAMPLES) {
        this.llmLatencies.shift()
      }
    }

    // LLM 慢调用告警（>10s）
    if (latency > 10000) {
      this.emitAlert('slow_llm', { provider: handle.provider, latency })
    }

    return latency
  }

  /**
   * 获取 LLM 调用指标
   */
  getLLMMetrics(): LLMMetrics {
    const latencies = this.llmLatencies
    const total = this.llmTotalCalls
    const errors = this.llmErrors

    if (latencies.length === 0) {
      return {
        totalCalls: total,
        avgLatency: 0,
        p95Latency: 0,
        maxLatency: 0,
        recentLatencies: [],
        errorRate: total > 0 ? errors / total : 0,
      }
    }

    const sorted = [...latencies].sort((a, b) => a - b)
    const sum = sorted.reduce((a, b) => a + b, 0)
    const p95Index = Math.floor(sorted.length * 0.95)

    return {
      totalCalls: total,
      avgLatency: Math.round(sum / sorted.length),
      p95Latency: Math.round(sorted[p95Index] ?? sorted[sorted.length - 1]!),
      maxLatency: Math.round(sorted[sorted.length - 1]!),
      recentLatencies: [...latencies],
      errorRate: total > 0 ? errors / total : 0,
    }
  }

  // ============ FPS 指标 ============

  getFPSMetrics(): FPSSample {
    const dropRatio = this.totalFrameCount > 0
      ? Math.round(this.lowFrameCount / this.totalFrameCount * 1000) / 1000
      : 0

    return {
      fps: this.currentFps,
      avgFps: Math.round(this.fpsAvg * 10) / 10,
      minFps: this.fpsMin,
      dropRatio,
    }
  }

  // ============ 告警 ============

  /**
   * 添加性能告警处理器
   * @returns 取消注册的函数
   */
  onAlert(handler: (type: string, data: Record<string, unknown>) => void): () => void {
    this.alertHandlers.add(handler)
    return () => this.alertHandlers.delete(handler)
  }

  private emitAlert(type: string, data: Record<string, unknown>): void {
    this.alertHandlers.forEach((fn) => {
      try { fn(type, data) } catch { /* 忽略处理器异常 */ }
    })
  }

  // ============ 快照 ============

  /**
   * 获取当前性能快照
   */
  getSnapshot(): RuntimeSnapshot {
    return {
      timestamp: Date.now(),
      fps: this.getFPSMetrics(),
      memory: { ...this.currentMemory },
      llm: this.getLLMMetrics(),
      uptime: this.started ? performance.now() - this.startTime : 0,
    }
  }

  /**
   * 重置所有指标
   */
  reset(): void {
    this.frameTimes = []
    this.lowFrameCount = 0
    this.totalFrameCount = 0
    this.currentFps = 60
    this.fpsMin = 60
    this.fpsAvg = 60
    this.llmLatencies = []
    this.llmErrors = 0
    this.llmTotalCalls = 0
    this.activeLLMCalls.clear()
    this.perf.clearAll()
  }
}

/** 全局运行时监控实例 */
export const runtimeMonitor = new RuntimeMonitor()

/**
 * React Hook 集成辅助：包装 LLM 调用以自动监控延迟
 *
 * @example
 * ```ts
 * const monitoredChat = withLLMMonitoring('chat', llmClient.chat.bind(llmClient))
 * const response = await monitoredChat(messages)
 * ```
 */
export function withLLMMonitoring<T extends (...args: any[]) => Promise<any>>(
  provider: string,
  fn: T,
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
  return async (...args: Parameters<T>): Promise<Awaited<ReturnType<T>>> => {
    const handle = runtimeMonitor.startLLMCall(provider)
    try {
      const result = await fn(...args)
      runtimeMonitor.endLLMCall(handle, false)
      return result
    } catch (e) {
      runtimeMonitor.endLLMCall(handle, true)
      throw e
    }
  }
}
