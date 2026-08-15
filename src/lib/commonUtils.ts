/**
 * @file commonUtils.ts
 * @description 公共工具函数模块 — 提取项目中重复使用的通用工具函数
 *
 * 主要功能：
 * 1. 安全的唯一 ID 生成（crypto.randomUUID + 时间戳 fallback）
 * 2. 高性能 Top-K 选择算法（最小堆实现，O(n log k)）
 * 3. 防抖/节流函数
 * 4. 安全的类型检查和空值处理
 *
 * 设计原则：
 * - 纯函数，无副作用
 * - 零外部依赖
 * - 全面的 TypeScript 类型支持
 * - 高性能实现
 */

// ============ 唯一 ID 生成 ============

/**
 * 生成安全的唯一 ID
 * 优先使用 crypto.randomUUID（UUID v4），不可用时回退到时间戳+随机数组合
 * 避免简单 Math.random() 导致的理论碰撞风险
 *
 * @param prefix ID 前缀（可选）
 * @returns 唯一 ID 字符串
 *
 * @example
 * ```ts
 * generateId()           // => "a1b2c3d4-..."
 * generateId('mem')      // => "mem_a1b2c3d4-..."
 * ```
 */
export function generateId(prefix?: string): string {
  let id: string
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    id = crypto.randomUUID()
  } else {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).slice(2, 10)
    const perf = performance.now().toString(36).replace('.', '')
    id = `${timestamp}_${random}_${perf}`
  }
  return prefix ? `${prefix}_${id}` : id
}

// ============ 高性能 Top-K 选择（最小堆实现）============

/**
 * 使用最小堆实现 Top-K 选择
 * 时间复杂度 O(n log k)，比全排序 O(n log n) 在 K << n 时显著更快
 * 适用于从大量数据中选取前 K 个最大/最小元素的场景
 *
 * @param items 待选择的数组
 * @param k 返回前 K 个元素
 * @param compare 比较函数（返回负数表示 a < b，0 表示相等，正数表示 a > b）
 * @param order 排序顺序：'desc'（降序，返回最大的 K 个）或 'asc'（升序，返回最小的 K 个），默认 'desc'
 * @returns 按指定顺序排列的前 K 个元素数组
 *
 * @example
 * ```ts
 * // 从大量数字中选最大的 5 个
 * selectTopK([1, 5, 3, 9, 2, 7, 4], 3, (a, b) => a - b) // => [9, 7, 5]
 *
 * // 从对象数组中选分数最高的 3 个
 * selectTopK(
 *   [{score: 80}, {score: 95}, {score: 70}],
 *   2,
 *   (a, b) => a.score - b.score
 * ) // => [{score: 95}, {score: 80}]
 * ```
 */
export function selectTopK<T>(
  items: T[],
  k: number,
  compare: (a: T, b: T) => number,
  order: 'desc' | 'asc' = 'desc',
): T[] {
  if (k <= 0) return []
  if (items.length === 0) return []
  if (items.length <= k) {
    return [...items].sort((a, b) => order === 'desc' ? compare(b, a) : compare(a, b))
  }

  const heap: T[] = []

  const siftUp = (idx: number) => {
    while (idx > 0) {
      const parent = (idx - 1) >> 1
      const shouldSwap = order === 'desc'
        ? compare(heap[idx]!, heap[parent]!) < 0  // 最小堆：找最大 K 个
        : compare(heap[idx]!, heap[parent]!) > 0  // 最大堆：找最小 K 个
      if (shouldSwap) {
        [heap[idx], heap[parent]] = [heap[parent], heap[idx]]
        idx = parent
      } else {
        break
      }
    }
  }

  const siftDown = (idx: number) => {
    const size = heap.length
    while (true) {
      let target = idx
      const left = 2 * idx + 1
      const right = 2 * idx + 2

      if (left < size) {
        const leftCompare = order === 'desc'
          ? compare(heap[left]!, heap[target]!) < 0
          : compare(heap[left]!, heap[target]!) > 0
        if (leftCompare) target = left
      }

      if (right < size) {
        const rightCompare = order === 'desc'
          ? compare(heap[right]!, heap[target]!) < 0
          : compare(heap[right]!, heap[target]!) > 0
        if (rightCompare) target = right
      }

      if (target !== idx) {
        [heap[idx], heap[target]] = [heap[target], heap[idx]]
        idx = target
      } else {
        break
      }
    }
  }

  for (const item of items) {
    if (heap.length < k) {
      heap.push(item)
      siftUp(heap.length - 1)
    } else {
      const shouldReplace = order === 'desc'
        ? compare(item, heap[0]!) > 0  // 新元素比堆顶大，替换
        : compare(item, heap[0]!) < 0  // 新元素比堆顶小，替换
      if (shouldReplace) {
        heap[0] = item
        siftDown(0)
      }
    }
  }

  return heap.sort((a, b) => order === 'desc' ? compare(b, a) : compare(a, b))
}

// ============ 防抖函数 ============

/** 防抖函数返回值类型 */
export interface DebouncedFunction<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void
  /** 取消延迟执行 */
  cancel: () => void
  /** 立即执行 */
  flush: () => void
}

/**
 * 创建防抖函数
 * 在指定时间内多次调用只会执行最后一次
 *
 * @param fn 要防抖的函数
 * @param wait 等待时间（毫秒）
 * @returns 防抖后的函数，带有 cancel 和 flush 方法
 */
export function debounce<T extends (...args: any[]) => any>(
  fn: T,
  wait: number,
): DebouncedFunction<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null
  let lastThis: any = null

  const debounced = function(this: any, ...args: Parameters<T>) {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- 防抖/节流需暂存 this 上下文供延迟调用
    lastThis = this
    lastArgs = args
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      timeoutId = null
      if (lastArgs) {
        fn.apply(lastThis, lastArgs)
        lastArgs = null
      }
    }, wait)
  } as DebouncedFunction<T>

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    lastArgs = null
  }

  debounced.flush = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
      if (lastArgs) {
        fn.apply(lastThis, lastArgs)
        lastArgs = null
      }
    }
  }

  return debounced
}

// ============ 节流函数 ============

/** 节流函数返回值类型 */
export interface ThrottledFunction<T extends (...args: any[]) => any> {
  (...args: Parameters<T>): void
  /** 取消等待 */
  cancel: () => void
}

/**
 * 创建节流函数
 * 在指定时间间隔内最多执行一次
 *
 * @param fn 要节流的函数
 * @param wait 间隔时间（毫秒）
 * @param options 配置选项
 * @param options.leading 是否在首次调用时立即执行（默认 true）
 * @param options.trailing 是否在等待结束后执行最后一次调用（默认 true）
 * @returns 节流后的函数，带有 cancel 方法
 */
export function throttle<T extends (...args: any[]) => any>(
  fn: T,
  wait: number,
  options: { leading?: boolean; trailing?: boolean } = {},
): ThrottledFunction<T> {
  const { leading = true, trailing = true } = options
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null
  let lastThis: any = null
  let lastCallTime = 0

  const throttled = function(this: any, ...args: Parameters<T>) {
    const now = Date.now()
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- 防抖/节流需暂存 this 上下文供延迟调用
    lastThis = this
    lastArgs = args

    const remaining = wait - (now - lastCallTime)

    if (remaining <= 0 || remaining > wait) {
      if (timeoutId !== null) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      lastCallTime = now
      if (leading) {
        fn.apply(lastThis, lastArgs)
      }
    } else if (timeoutId === null && trailing) {
      timeoutId = setTimeout(() => {
        lastCallTime = leading ? Date.now() : 0
        timeoutId = null
        fn.apply(lastThis, lastArgs!)
        lastArgs = null
      }, remaining)
    }
  } as ThrottledFunction<T>

  throttled.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    lastCallTime = 0
    lastArgs = null
  }

  return throttled
}

// ============ 安全的空值检查 ============

/**
 * 安全获取嵌套对象属性，避免 "Cannot read property of undefined" 错误
 *
 * @param obj 目标对象
 * @param path 属性路径（点分隔或数组）
 * @param defaultValue 默认值（当路径不存在时返回）
 * @returns 属性值或默认值
 *
 * @example
 * ```ts
 * const obj = { a: { b: { c: 1 } } };
 * safeGet(obj, 'a.b.c') // => 1
 * safeGet(obj, 'a.b.d', 0) // => 0
 * ```
 */
export function safeGet<T = any>(
  obj: any,
  path: string | (string | number)[],
  defaultValue?: T,
): T | undefined {
  if (obj == null) return defaultValue

  const keys = Array.isArray(path) ? path : path.split('.')
  let result = obj

  for (const key of keys) {
    if (result == null) return defaultValue
    result = result[key as keyof typeof result]
  }

  return result !== undefined && result !== null ? result : defaultValue
}

// ============ 数组工具 ============

/**
 * 数组去重（基于哈希表，O(n) 时间复杂度）
 *
 * @param arr 输入数组
 * @param keyFn 可选的键生成函数，用于对象数组去重
 * @returns 去重后的新数组
 */
export function unique<T>(arr: T[], keyFn?: (item: T) => string | number): T[] {
  if (!keyFn) {
    return [...new Set(arr)]
  }
  const seen = new Set<string | number>()
  return arr.filter((item) => {
    const key = keyFn(item)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 按指定键对数组分组
 *
 * @param arr 输入数组
 * @param keyFn 键生成函数
 * @returns 分组后的对象（键 -> 元素数组）
 */
export function groupBy<T>(arr: T[], keyFn: (item: T) => string): Record<string, T[]> {
  return arr.reduce((groups, item) => {
    const key = keyFn(item)
    if (!groups[key]) groups[key] = []
    groups[key].push(item)
    return groups
  }, {} as Record<string, T[]>)
}

// ============ 延迟与重试 ============

/**
 * 延迟指定时间（Promise 版 setTimeout）
 *
 * @param ms 延迟毫秒数
 * @returns Promise
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 带重试的异步函数执行
 *
 * @param fn 要执行的异步函数
 * @param options 重试配置
 * @param options.retries 最大重试次数（默认 3）
 * @param options.delayMs 初始重试延迟（毫秒，默认 1000）
 * @param options.backoff 退避因子（默认 2，指数退避）
 * @param options.initialDelayMs 同 delayMs（别名）
 * @param options.maxDelayMs 最大延迟（毫秒，默认无限制）
 * @param options.onRetry 重试回调
 * @returns 函数执行结果
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number
    delayMs?: number
    initialDelayMs?: number
    maxDelayMs?: number
    backoff?: number
    onRetry?: (attempt: number, error: Error) => void
  } = {},
): Promise<T> {
  const {
    retries = 3,
    delayMs: delayMsOpt,
    initialDelayMs,
    maxDelayMs,
    backoff = 2,
    onRetry,
  } = options
  const initialDelay = initialDelayMs ?? delayMsOpt ?? 1000
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      if (attempt < retries) {
        let waitTime = initialDelay * Math.pow(backoff, attempt)
        if (maxDelayMs !== undefined) {
          waitTime = Math.min(waitTime, maxDelayMs)
        }
        onRetry?.(attempt + 1, lastError)
        await delay(waitTime)
      }
    }
  }

  throw lastError
}

// ============ 类型守卫 ============

/**
 * 检查值是否为非 null/undefined 的对象
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 检查值是否为字符串
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * 检查值是否为数字（且不是 NaN）
 */
export function isNumber(value: unknown): value is number {
  return typeof value === 'number' && !isNaN(value)
}

/**
 * 检查值是否为非空数组
 */
export function isNonEmptyArray<T>(value: unknown): value is T[] {
  return Array.isArray(value) && value.length > 0
}

/**
 * 类型守卫：过滤 null 和 undefined
 * 用于 Array.filter() 进行类型缩窄
 */
export function isNonNullable<T>(value: T): value is NonNullable<T> {
  return value !== null && value !== undefined
}

// ============ 性能监控 ============

/** 性能标记结果 */
export interface PerfMark {
  /** 标记名称 */
  name: string
  /** 开始时间戳（ms） */
  startTime: number
  /** 结束时间戳（ms） */
  endTime: number
  /** 持续时间（ms） */
  duration: number
  /** 可选的元数据 */
  metadata?: Record<string, unknown>
}

/** 性能统计信息 */
export interface PerfStats {
  /** 平均耗时（ms） */
  avg: number
  /** 最大耗时（ms） */
  max: number
  /** 最小耗时（ms） */
  min: number
  /** 执行次数 */
  count: number
}

/** 性能监听器类型 */
type PerfListener = (mark: PerfMark) => void

/** 性能监控标记句柄 */
interface PerfMarkerHandle {
  name: string
  startTime: number
  metadata?: Record<string, unknown>
}

/** 性能监控类 */
export class PerformanceMonitor {
  private activeMarks = new Map<string, PerfMarkerHandle>()
  private listeners: Set<PerfListener> = new Set()
  private history: PerfMark[] = []
  private readonly maxHistory: number
  private readonly slowThresholdMs: number

  constructor(options: { maxHistory?: number; slowThresholdMs?: number } = {}) {
    this.maxHistory = options.maxHistory ?? 1000
    this.slowThresholdMs = options.slowThresholdMs ?? 100
  }

  /**
   * 开始计时
   * @param name 标记名称
   * @param metadata 可选的元数据
   * @returns 标记句柄（用于 end 方法）
   */
  start(name: string, metadata?: Record<string, unknown>): PerfMarkerHandle {
    const handle: PerfMarkerHandle = {
      name,
      startTime: performance.now(),
      metadata,
    }
    this.activeMarks.set(name, handle)
    return handle
  }

  /**
   * 结束计时并记录
   * @param markerOrName 标记句柄或标记名称
   * @returns 持续时间（ms），如果未找到开始标记则返回 -1
   */
  end(markerOrName: PerfMarkerHandle | string): number {
    let handle: PerfMarkerHandle | undefined
    if (typeof markerOrName === 'string') {
      handle = this.activeMarks.get(markerOrName)
    } else {
      handle = markerOrName
    }

    if (!handle) return -1

    const endTime = performance.now()
    const duration = endTime - handle.startTime
    const mark: PerfMark = {
      name: handle.name,
      startTime: handle.startTime,
      endTime,
      duration,
      metadata: handle.metadata,
    }

    this.activeMarks.delete(handle.name)
    this.history.push(mark)
    if (this.history.length > this.maxHistory) {
      this.history.shift()
    }

    // 慢操作警告
    if (duration > this.slowThresholdMs && typeof console !== 'undefined') {
      console.warn(`[Perf] Slow operation detected: ${handle.name} took ${duration.toFixed(2)}ms`)
    }

    // 通知监听器
    this.listeners.forEach((fn) => {
      try { fn(mark) } catch { /* 监听器异常不影响主流程 */ }
    })

    return duration
  }

  /**
   * 测量一个同步/异步函数的执行时间
   * @param name 标记名称
   * @param fn 要测量的函数
   * @param metadata 可选的元数据
   * @returns 函数返回值
   */
  measure<T>(name: string, fn: () => T | Promise<T>, metadata?: Record<string, unknown>): T | Promise<T> {
    const marker = this.start(name, metadata)
    try {
      const result = fn()
      if (result instanceof Promise) {
        return result.finally(() => this.end(marker))
      }
      this.end(marker)
      return result
    } catch (e) {
      this.end(marker)
      throw e
    }
  }

  /**
   * 添加性能监听器
   * @param listener 监听器函数
   * @returns 取消监听的函数
   */
  addListener(listener: PerfListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /**
   * 获取指定操作的统计信息
   * @param name 操作名称
   * @returns 统计信息，无记录时返回 undefined
   */
  getStats(name: string): PerfStats | undefined {
    const marks = this.history.filter((m) => m.name === name)
    if (marks.length === 0) return undefined

    const durations = marks.map((m) => m.duration)
    const sum = durations.reduce((a, b) => a + b, 0)
    return {
      avg: sum / durations.length,
      max: Math.max(...durations),
      min: Math.min(...durations),
      count: durations.length,
    }
  }

  /**
   * 获取所有操作的统计信息
   * @returns 名称到统计信息的映射
   */
  getAllStats(): Record<string, PerfStats> {
    const result: Record<string, PerfStats> = {}
    const nameSet = new Set(this.history.map(m => m.name))
    for (const name of nameSet) {
      const stats = this.getStats(name)
      if (stats) result[name] = stats
    }
    return result
  }

  /**
   * 获取所有历史记录（用于调试）
   */
  getHistory(): ReadonlyArray<PerfMark> {
    return [...this.history]
  }

  /**
   * 清空指定名称的统计记录
   */
  clear(name?: string): void {
    if (name) {
      this.history = this.history.filter(m => m.name !== name)
      this.activeMarks.delete(name)
    } else {
      this.clearAll()
    }
  }

  /**
   * 清空所有历史记录和活动标记
   */
  clearAll(): void {
    this.history = []
    this.activeMarks.clear()
  }
}

/** 全局性能监控实例 */
export const perfMonitor = new PerformanceMonitor()

/**
 * 装饰器/高阶函数：测量函数执行时间
 *
 * @param name 操作名称
 * @param fn 要测量的函数
 * @returns 包装后的函数
 */
export function withPerf<T extends (...args: any[]) => any>(
  name: string,
  fn: T,
): (...args: Parameters<T>) => ReturnType<T> extends Promise<infer R> ? Promise<R> : ReturnType<T> {
  return function(this: any, ...args: Parameters<T>): any {
    return perfMonitor.measure(name, () => fn.apply(this, args)) as any
  }
}

// ============ 统一错误处理 ============

/**
 * 安全执行异步函数，捕获异常并返回默认值
 *
 * @param fn 要执行的异步函数
 * @param options 配置选项
 * @param options.defaultValue 出错时返回的默认值
 * @param options.onError 错误回调
 * @param options.errorMessage 错误日志前缀
 * @returns 函数结果或默认值
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  options: {
    defaultValue?: T
    onError?: (error: Error) => void
    errorMessage?: string
  } = {},
): Promise<T | undefined> {
  const { defaultValue, onError, errorMessage } = options
  try {
    return await fn()
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e))
    if (errorMessage && typeof console !== 'undefined') {
      console.error(`[${errorMessage}]`, error)
    } else if (typeof console !== 'undefined') {
      console.error(error)
    }
    onError?.(error)
    return defaultValue
  }
}

/**
 * 安全执行同步函数，捕获异常并返回默认值
 *
 * @param fn 要执行的函数
 * @param options 配置选项
 * @param options.defaultValue 出错时返回的默认值
 * @param options.onError 错误回调
 * @param options.errorMessage 错误日志前缀
 * @returns 函数结果或默认值
 */
export function safeSync<T>(
  fn: () => T,
  options: {
    defaultValue?: T
    onError?: (error: Error) => void
    errorMessage?: string
  } = {},
): T | undefined {
  const { defaultValue, onError, errorMessage } = options
  try {
    return fn()
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e))
    if (errorMessage && typeof console !== 'undefined') {
      console.error(`[${errorMessage}]`, error)
    } else if (typeof console !== 'undefined') {
      console.error(error)
    }
    onError?.(error)
    return defaultValue
  }
}

/**
 * 创建一个只会执行一次的函数（幂等包装）
 *
 * @param fn 要包装的函数
 * @returns 包装后的函数，第二次及以后调用直接返回第一次的结果
 */
export function once<T extends (...args: any[]) => any>(fn: T): T {
  let called = false
  let result: ReturnType<T>
  return function(this: any, ...args: Parameters<T>): ReturnType<T> {
    if (!called) {
      called = true
      result = fn.apply(this, args)
    }
    return result
  } as T
}

/**
 * 确保函数只在满足条件时执行，否则返回默认值
 * condition 参数可以是布尔值或返回布尔值的函数
 */
export function guard<T>(
  condition: boolean | (() => boolean),
  fn: () => T,
  defaultValue?: T,
): () => T | undefined {
  return () => {
    const cond = typeof condition === 'function' ? condition() : condition
    return cond ? fn() : defaultValue
  }
}

// ============ 数值工具 ============

/**
 * 将数值限制在 [min, max] 范围内
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// ============ 网络工具 ============

/**
 * 带超时的 fetch 请求
 *
 * @param url 请求 URL
 * @param options fetch 选项，额外支持 timeout 毫秒数
 * @returns Response 对象
 * @throws 超时时抛出 AbortError
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number } = {},
): Promise<Response> {
  const { timeout = 8000, ...fetchOptions } = options

  if (timeout <= 0 || timeout === Infinity) {
    return fetch(url, fetchOptions)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(new DOMException(`Request timeout after ${timeout}ms`, 'TimeoutError')), timeout)

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: fetchOptions.signal
        ? AbortSignal.any([fetchOptions.signal, controller.signal])
        : controller.signal,
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

// ============ LRU 缓存 ============

/** LRU 缓存选项 */
export interface LRUCacheOptions<K, V> {
  /** 最大容量 */
  maxSize: number
  /** 可选的条目淘汰回调 */
  onEvict?: (key: K, value: V) => void
  /** 可选的 TTL（毫秒），0 表示永不过期 */
  ttl?: number
}

/**
 * 高性能 LRU（最近最少使用）缓存实现
 * 使用 Map 保持插入顺序，O(1) 的 get/set/delete 操作
 */
export class LRUCache<K, V> {
  private cache = new Map<K, { value: V; expiresAt?: number }>()
  private readonly maxSize: number
  private readonly onEvict?: (key: K, value: V) => void
  private readonly ttl?: number

  constructor(options: LRUCacheOptions<K, V>) {
    this.maxSize = options.maxSize
    this.onEvict = options.onEvict
    this.ttl = options.ttl
  }

  /** 获取缓存值，不存在或已过期返回 undefined */
  get(key: K): V | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined

    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.delete(key)
      return undefined
    }

    // 移到末尾（标记为最近使用）
    this.cache.delete(key)
    this.cache.set(key, entry)
    return entry.value
  }

  /** 设置缓存值 */
  set(key: K, value: V): void {
    // 如果 key 已存在，先删除旧值（触发 evict 回调）
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    const expiresAt = this.ttl !== undefined ? Date.now() + this.ttl : undefined
    this.cache.set(key, { value, expiresAt })

    // 超出容量时淘汰最旧的条目
    while (this.cache.size > this.maxSize) {
      const oldestKey = this.cache.keys().next().value as K | undefined
      if (oldestKey !== undefined) {
        const oldest = this.cache.get(oldestKey)
        this.cache.delete(oldestKey)
        if (oldest) {
          this.onEvict?.(oldestKey, oldest.value)
        }
      }
    }
  }

  /** 检查 key 是否存在且未过期 */
  has(key: K): boolean {
    const entry = this.cache.get(key)
    if (!entry) return false
    if (entry.expiresAt !== undefined && Date.now() > entry.expiresAt) {
      this.delete(key)
      return false
    }
    return true
  }

  /** 删除指定 key */
  delete(key: K): boolean {
    const entry = this.cache.get(key)
    const deleted = this.cache.delete(key)
    if (deleted && entry) {
      this.onEvict?.(key, entry.value)
    }
    return deleted
  }

  /** 获取当前缓存大小 */
  get size(): number {
    return this.cache.size
  }

  /** 清空所有缓存 */
  clear(): void {
    if (this.onEvict) {
      for (const [key, entry] of this.cache) {
        this.onEvict(key, entry.value)
      }
    }
    this.cache.clear()
  }

  /** 获取所有 key（从旧到新） */
  keys(): IterableIterator<K> {
    return this.cache.keys()
  }

  /** 清理过期条目 */
  prune(): number {
    let pruned = 0
    const now = Date.now()
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt !== undefined && now > entry.expiresAt) {
        this.cache.delete(key)
        this.onEvict?.(key, entry.value)
        pruned++
      }
    }
    return pruned
  }
}
