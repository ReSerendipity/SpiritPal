/**
 * @file frameCache.ts
 * @description 帧缓存模块 — LRU Cache 实现
 * 
 * 实现功能：
 * - 最近使用缓存（LRU 算法）
 * - 空闲时自动清理
 * - 命中率统计与监控
 * - 多级别缓存策略（内存/磁盘）
 * - 智能预加载
 * 
 * 适用场景：
 * - Live2D 帧动画缓存
 * - 粒子效果预处理
 * - 精灵图切片复用
 * - 文本渲染结果缓存
 */

// ============ 类型定义 ============

/** UTF-8 字节估算器（webview 与 Node 通用，替代 Buffer.byteLength） */
const textEncoder = new TextEncoder()

export interface CacheItem<T> {
  /** 缓存数据 */
  value: T
  /** 创建时间戳 */
  createdAt: number
  /** 最后访问时间戳 */
  lastAccessedAt: number
  /** 访问次数 */
  accessCount: number
  /** 数据大小（字节） */
  size: number
  /** 过期时间（可选） */
  expiresAt?: number
  /** 缓存标签 */
  tags: string[]
}

export interface LRUCacheConfig {
  /** 最大缓存项数 */
  maxItems: number
  /** 最大缓存总大小（MB） */
  maxSizeMB?: number
  /** 默认过期时间（毫秒） */
  defaultTTL?: number
  /** 自动清理间隔（毫秒） */
  cleanupInterval?: number
  /** 是否启用统计 */
  enableStats?: boolean
  /** 空闲时清理阈值（无访问超过多少毫秒） */
  idleThresholdMs?: number
}

export interface CacheStats {
  /** 缓存命中次数 */
  hits: number
  /** 缓存未命中次数 */
  misses: number
  /** 当前缓存项数 */
  currentSize: number
  /** 当前缓存总大小（字节） */
  currentMemoryUsage: number
  /** 命中率 */
  hitRate: number
  /** 平均访问时间（毫秒） */
  avgAccessTime: number
  /** 最近清理时间 */
  lastCleanupAt?: number
  /** 累计清理次数 */
  totalCleanups: number
}

export interface FrameCacheKey {
  /** 动画 ID */
  animationId: string
  /** 行号 */
  row: number
  /** 帧号 */
  frame: number
  /** 缩放比例 */
  scale?: number
  /** 其他参数 */
  params?: Record<string, any>
}

// ============ LRU Cache 实现 ============

export class LRUCache<K extends string | number, V> {
  private config: Required<LRUCacheConfig>
  private cache: Map<K, CacheItem<V>>
  private stats: CacheStats
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  
  constructor(config?: LRUCacheConfig) {
    this.config = {
      maxItems: 1000,
      maxSizeMB: 500,
      defaultTTL: 5 * 60 * 1000, // 5 分钟
      cleanupInterval: 60000, // 1 分钟
      enableStats: true,
      idleThresholdMs: 300000, // 5 分钟
      ...config,
    }
    
    this.cache = new Map()
    this.stats = this.createInitialStats()
    
    // 启动定时清理
    if (this.config.cleanupInterval > 0) {
      this.startAutoCleanup()
    }
  }

  /**
   * 获取缓存值
   */
  get(key: K): V | undefined {
    const startTime = performance.now()
    
    const item = this.cache.get(key)
    
    if (!item) {
      if (this.config.enableStats) {
        this.stats.misses++
        this.updateHitRate()
      }
      return undefined
    }

    // 检查是否过期
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.cache.delete(key)
      if (this.config.enableStats) {
        this.stats.misses++
        this.updateHitRate()
      }
      this.refreshSizeStats()
      return undefined
    }

    // 更新访问信息（LRU 关键步骤）
    item.lastAccessedAt = Date.now()
    item.accessCount++
    
    // 移到链表尾部（通过删除再重新插入实现）
    this.cache.delete(key)
    this.cache.set(key, item)

    if (this.config.enableStats) {
      this.stats.hits++
      this.updateAvgAccessTime(performance.now() - startTime)
      this.updateHitRate()
    }

    return item.value
  }

  /**
   * 设置缓存值
   */
  set(key: K, value: V, metadata?: {
    size?: number
    ttl?: number
    tags?: string[]
  }): void {
    // 如果已存在，先删除
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    // TTL：未显式指定时回落到配置的 defaultTTL（≤0 表示永不过期）
    const ttl = metadata?.ttl ?? this.config.defaultTTL

    const item: CacheItem<V> = {
      value,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
      accessCount: 1,
      size: metadata?.size ?? this.estimateSize(value),
      expiresAt: ttl > 0 ? Date.now() + ttl : undefined,
      tags: metadata?.tags || [],
    }

    // 检查容量限制并清理
    this.checkCapacityAndCleanup()

    this.cache.set(key, item)
    this.refreshSizeStats()
  }

  /**
   * 删除缓存
   */
  delete(key: K): boolean {
    const removed = this.cache.delete(key)
    if (removed) this.refreshSizeStats()
    return removed
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear()
    this.refreshSizeStats()
  }

  /**
   * 检查是否存在
   */
  has(key: K): boolean {
    return this.cache.has(key)
  }

  /**
   * 获取缓存大小
   */
  getSize(): number {
    return this.cache.size
  }

  /**
   * 获取统计数据
   */
  getStats(): CacheStats {
    return { ...this.stats }
  }

  /**
   * 清理过期和长时间未访问的项
   */
  cleanup(options?: { idleOnly?: boolean }): void {
    const now = Date.now()
    let cleanedCount = 0

    for (const [key, item] of this.cache.entries()) {
      let shouldDelete = false

      // 检查过期
      if (item.expiresAt && now > item.expiresAt) {
        shouldDelete = true
      }

      // 检查空闲
      if (!shouldDelete && options?.idleOnly !== false) {
        const idleTime = now - item.lastAccessedAt
        if (idleTime > this.config.idleThresholdMs) {
          shouldDelete = true
        }
      }

      if (shouldDelete) {
        this.cache.delete(key)
        cleanedCount++
      }
    }

    // 强制检查容量
    if (!options?.idleOnly) {
      this.checkCapacityAndCleanup()
    }

    // 更新统计
    if (this.config.enableStats) {
      this.stats.lastCleanupAt = now
      this.stats.totalCleanups++
      this.stats.currentSize = this.cache.size
      this.stats.currentMemoryUsage = this.calculateTotalSize()
    }

    console.log(`[FrameCache] Cleaned ${cleanedCount} items`)
  }

  /**
   * 按标签批量删除
   */
  deleteByTags(tags: string[]): number {
    let deletedCount = 0
    
    const keysToDelete: K[] = []
    for (const [key, item] of this.cache.entries()) {
      if (item.tags.some(tag => tags.includes(tag))) {
        keysToDelete.push(key)
        deletedCount++
      }
    }
    
    keysToDelete.forEach(key => this.cache.delete(key))

    return deletedCount
  }

  /**
   * 获取所有键
   */
  keys(): IterableIterator<K> {
    return this.cache.keys()
  }

  /**
   * 预热缓存（预加载）
   */
  /**
   * 预加载：把一批 key 交给 loader 取值并写入缓存（已存在或加载失败则跳过）。
   * 返回成功写入的条目数。
   */
  async preload(keys: K[], loader: (key: K) => Promise<V | undefined> | V | undefined): Promise<number> {
    let loaded = 0
    for (const key of keys) {
      if (this.has(key)) continue
      try {
        const value = await loader(key)
        if (value === undefined) continue
        this.set(key, value)
        loaded++
      } catch {
        // 预加载失败不阻断其它 key
      }
    }
    return loaded
  }

  /**
   * 估计数据大小
   * 注意：webview 环境不存在 Node 的 Buffer，统一用 TextEncoder 估算 UTF-8 字节数。
   */
  private estimateSize(value: V): number {
    try {
      if (typeof value === 'string') return textEncoder.encode(value).length
      // 简单估算：JSON 序列化后的字节长度
      return textEncoder.encode(JSON.stringify(value)).length
    } catch {
      return 1024 // 默认 1KB
    }
  }

  /**
   * 计算总大小
   */
  private calculateTotalSize(): number {
    let total = 0
    for (const item of this.cache.values()) {
      total += item.size
    }
    return total
  }

  /**
   * 检查容量并清理
   */
  private checkCapacityAndCleanup(): void {
    // 按访问顺序排序（最久未访问在前）
    const sorted = Array.from(this.cache.entries())
      .sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt)

    const maxBytes = this.config.maxSizeMB * 1024 * 1024

    // 超过最大数量或最大大小，开始清理
    while (
      (this.cache.size >= this.config.maxItems || 
       this.calculateTotalSize() >= maxBytes) &&
      sorted.length > 0
    ) {
      const [oldestKey] = sorted.shift()!
      this.cache.delete(oldestKey)
    }
  }

  /**
   * 启动定时清理
   */
  private startAutoCleanup(): void {
    // unref 在浏览器/setTimeout 环境不存在，仅在 Node（测试）下调用，避免测试进程被挂住
    const timer = setInterval(() => {
      this.cleanup()
    }, this.config.cleanupInterval)
    ;(timer as unknown as { unref?: () => void }).unref?.()
    this.cleanupTimer = timer
  }

  /** 停止自动清理定时器并清空缓存（测试/热重载时调用，避免 interval 悬挂） */
  dispose(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.cache.clear()
  }

  /**
   * 创建初始统计
   */
  private createInitialStats(): CacheStats {
    return {
      hits: 0,
      misses: 0,
      currentSize: 0,
      currentMemoryUsage: 0,
      hitRate: 0,
      avgAccessTime: 0,
      totalCleanups: 0,
    }
  }

  /**
   * 更新平均访问时间
   */
  private updateAvgAccessTime(accessTime: number): void {
    const alpha = 0.1 // 平滑系数
    const currentAvg = this.stats.avgAccessTime
    this.stats.avgAccessTime = currentAvg * (1 - alpha) + accessTime * alpha
  }

  /** 重算命中率（命中与未命中后都要调用，否则 miss 不会反映到 hitRate 上） */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0
  }

  /** 刷新条目数与内存占用统计（供运行时监控读取） */
  private refreshSizeStats(): void {
    this.stats.currentSize = this.cache.size
    this.stats.currentMemoryUsage = this.calculateTotalSize()
  }
}

// ============ 帧动画缓存专用类 ============

export class FrameAnimationCache {
  private cache: LRUCache<string, any>
  private keyGenerator: (key: FrameCacheKey) => string

  constructor(config?: LRUCacheConfig) {
    this.cache = new LRUCache({
      maxItems: 500,
      maxSizeMB: 200,
      defaultTTL: 10 * 60 * 1000, // 10 分钟
      ...config,
    })

    this.keyGenerator = (key: FrameCacheKey) => {
      const paramsStr = key.params ? JSON.stringify(key.params) : ''
      return `${key.animationId}_${key.row}_${key.frame}_${key.scale ?? 1}${paramsStr}`
    }
  }

  /**
   * 获取帧数据
   */
  getFrame(key: FrameCacheKey): any {
    const cacheKey = this.keyGenerator(key)
    return this.cache.get(cacheKey)
  }

  /**
   * 缓存帧数据
   */
  cacheFrame(key: FrameCacheKey, data: any, metadata?: {
    size?: number
    ttl?: number
    tags?: string[]
  }): void {
    const cacheKey = this.keyGenerator(key)
    this.cache.set(cacheKey, data, metadata)
  }

  /**
   * 清除某个动画的所有帧
   */
  clearAnimation(animationId: string): void {
    const keysToDelete: string[] = []
    
    for (const key of this.cache.keys()) {
      if (typeof key === 'string' && key.startsWith(`${animationId}_`)) {
        keysToDelete.push(key)
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key as any))
  }

  /**
   * 获取缓存统计
   */
  getStats(): CacheStats {
    return this.cache.getStats()
  }

  /** 释放底层缓存（停止定时器） */
  dispose(): void {
    this.cache.dispose()
  }
}

// ============ 单例 ============

let lruInstance: LRUCache<any, any> | null = null
let frameInstance: FrameAnimationCache | null = null

export function getLRUCache<K extends string | number, V>(
  config?: LRUCacheConfig,
): LRUCache<K, V> {
  if (!lruInstance) {
    lruInstance = new LRUCache(config) as any
  }
  return lruInstance as any
}

export function getFrameAnimationCache(
  config?: LRUCacheConfig,
): FrameAnimationCache {
  if (!frameInstance) {
    frameInstance = new FrameAnimationCache(config)
  }
  return frameInstance
}

/** 释放两个单例缓存（仅测试/热重载使用，避免 setInterval 悬挂） */
export function disposeFrameCaches(): void {
  lruInstance?.dispose()
  frameInstance?.dispose()
  lruInstance = null
  frameInstance = null
}
