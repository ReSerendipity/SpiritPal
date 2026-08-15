/**
 * 嵌入模型缓存 — LRU + TTL + 持久化，避免重复计算嵌入向量
 * 参考 AI_Integration_Plan 的缓存设计
 *
 * @fileoverview
 * 主要模块：
 * - CacheEntry 接口：缓存条目（哈希/嵌入向量/创建时间/最后访问时间/访问次数）
 * - EmbeddingCache 类：嵌入向量缓存（单例），支持 LRU 驱逐、TTL 过期、SHA-256 哈希键、命中率统计、持久化
 *
 * 核心功能：
 * 1. LRU 驱逐策略（默认上限 2000 条）
 * 2. 7 天 TTL 过期机制
 * 3. Cache key: 输入文本的 SHA-256 哈希
 * 4. 命中率统计
 * 5. 持久化缓存（通过 db.ts 持久化）
 *
 * @module embeddingCache
 * @requires ./db - getSetting/setSetting 持久化
 */

import { getSetting, setSetting } from './db'

// ============ 常量 ============

/** 默认缓存上限 */
const DEFAULT_MAX_SIZE = 2000

/** 默认 TTL（7 天，毫秒） */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 持久化存储 key */
const CACHE_STORAGE_KEY = 'spiritpal-embedding-cache'

// ============ 缓存条目 ============

interface CacheEntry {
  /** 输入文本的哈希（cache key） */
  hash: string
  /** 嵌入向量（序列化为 number 数组） */
  embedding: number[]
  /** 创建时间戳 */
  createdAt: number
  /** 最后访问时间戳 */
  lastAccessedAt: number
  /** 访问次数 */
  accessCount: number
}

// ============ 哈希函数 ============

/**
 * 计算文本的 SHA-256 哈希
 * 使用 Web Crypto API，异步实现
 */
async function computeHash(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = new Uint8Array(hashBuffer)
  // 转为十六进制字符串（取前 32 字符减少存储）
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32)
}

// ============ 嵌入缓存管理器 ============

/**
 * 嵌入模型缓存管理器
 * 支持 LRU 驱逐、TTL 过期、持久化存储
 */
export class EmbeddingCacheManager {
  /** 缓存存储（hash → entry） */
  private cache: Map<string, CacheEntry> = new Map()
  /** 缓存上限 */
  private maxSize: number
  /** TTL（毫秒） */
  private ttlMs: number
  /** 是否已从持久化存储加载 */
  private loaded = false
  /** 是否已修改（需要持久化） */
  private dirty = false
  /** 统计信息 */
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    expirations: 0,
  }

  constructor(maxSize = DEFAULT_MAX_SIZE, ttlMs = DEFAULT_TTL_MS) {
    this.maxSize = maxSize
    this.ttlMs = ttlMs
  }

  // ============ 缓存操作 ============

  /**
   * 获取嵌入向量
   * @param text 输入文本
   * @returns 缓存的嵌入向量（null 表示未命中或已过期）
   */
  async get(text: string): Promise<Float32Array | null> {
    await this.ensureLoaded()

    const hash = await computeHash(text)
    const entry = this.cache.get(hash)

    if (!entry) {
      this.stats.misses++
      return null
    }

    // 检查 TTL
    const now = Date.now()
    if (now - entry.createdAt > this.ttlMs) {
      this.cache.delete(hash)
      this.stats.expirations++
      this.stats.misses++
      this.dirty = true
      return null
    }

    // LRU：移到末尾
    this.cache.delete(hash)
    this.cache.set(hash, {
      ...entry,
      lastAccessedAt: now,
      accessCount: entry.accessCount + 1,
    })

    this.stats.hits++
    return new Float32Array(entry.embedding)
  }

  /**
   * 存入嵌入向量
   * @param text 输入文本
   * @param embedding 嵌入向量
   */
  async set(text: string, embedding: Float32Array): Promise<void> {
    await this.ensureLoaded()

    const hash = await computeHash(text)
    const now = Date.now()

    // 如果已存在，更新
    this.cache.delete(hash)

    // LRU 驱逐：超限时删除最久未用的条目
    while (this.cache.size >= this.maxSize) {
      const oldestKey = this.cache.keys().next().value
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey)
        this.stats.evictions++
      }
    }

    this.cache.set(hash, {
      hash,
      embedding: Array.from(embedding),
      createdAt: now,
      lastAccessedAt: now,
      accessCount: 0,
    })

    this.dirty = true
  }

  /**
   * 批量获取嵌入向量
   * @param texts 输入文本列表
   * @returns 结果数组（null 表示未命中）
   */
  async getBatch(texts: string[]): Promise<(Float32Array | null)[]> {
    return Promise.all(texts.map((text) => this.get(text)))
  }

  /**
   * 批量存入嵌入向量
   * @param entries 条目列表
   */
  async setBatch(entries: { text: string; embedding: Float32Array }[]): Promise<void> {
    await this.ensureLoaded()
    for (const { text, embedding } of entries) {
      await this.set(text, embedding)
    }
  }

  // ============ 持久化 ============

  /** 确保缓存已从持久化存储加载 */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return

    try {
      const raw = await getSetting(CACHE_STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw) as CacheEntry[]
        const now = Date.now()

        for (const entry of data) {
          // 过滤已过期的条目
          if (now - entry.createdAt > this.ttlMs) {
            this.stats.expirations++
            continue
          }
          this.cache.set(entry.hash, entry)
        }
      }
    } catch (e) {
      console.warn('[EmbeddingCache] Failed to load cache:', e)
    }

    this.loaded = true
  }

  /**
   * 将缓存保存到持久化存储
   * 仅在有修改时保存
   */
  async persist(): Promise<void> {
    if (!this.dirty) return

    try {
      // 清理过期条目
      const now = Date.now()
      for (const [hash, entry] of this.cache) {
        if (now - entry.createdAt > this.ttlMs) {
          this.cache.delete(hash)
          this.stats.expirations++
        }
      }

      const data = Array.from(this.cache.values())
      await setSetting(CACHE_STORAGE_KEY, JSON.stringify(data))
      this.dirty = false
    } catch (e) {
      console.warn('[EmbeddingCache] Failed to persist cache:', e)
    }
  }

  // ============ 统计与查询 ============

  /** 获取命中率 */
  getHitRate(): number {
    const total = this.stats.hits + this.stats.misses
    return total > 0 ? this.stats.hits / total : 0
  }

  /** 获取缓存大小 */
  getSize(): number {
    return this.cache.size
  }

  /** 获取统计信息 */
  getStats(): typeof this.stats & {
    size: number
    hitRate: number
    maxSize: number
    ttlDays: number
  } {
    return {
      ...this.stats,
      size: this.cache.size,
      hitRate: this.getHitRate(),
      maxSize: this.maxSize,
      ttlDays: this.ttlMs / (24 * 60 * 60 * 1000),
    }
  }

  /** 清空缓存 */
  async clear(): Promise<void> {
    this.cache.clear()
    this.dirty = true
    await this.persist()
  }

  /**
   * 清理过期条目
   * @returns 清理的条目数
   */
  cleanup(): number {
    const now = Date.now()
    let count = 0

    for (const [hash, entry] of this.cache) {
      if (now - entry.createdAt > this.ttlMs) {
        this.cache.delete(hash)
        this.stats.expirations++
        count++
      }
    }

    if (count > 0) {
      this.dirty = true
    }

    return count
  }

  /** 更新配置 */
  updateConfig(config: { maxSize?: number; ttlMs?: number }): void {
    if (config.maxSize !== undefined) this.maxSize = config.maxSize
    if (config.ttlMs !== undefined) this.ttlMs = config.ttlMs
  }
}

// ============ 单例 ============

let instance: EmbeddingCacheManager | null = null

/**
 * 获取嵌入缓存管理器单例
 * @param maxSize 缓存上限（首次调用时生效）
 * @param ttlMs TTL 毫秒数（首次调用时生效）
 */
export function getEmbeddingCacheManager(
  maxSize?: number,
  ttlMs?: number,
): EmbeddingCacheManager {
  if (!instance) {
    instance = new EmbeddingCacheManager(maxSize, ttlMs)
  }
  return instance
}

/**
 * 重置嵌入缓存管理器（测试用）
 */
export function resetEmbeddingCacheManager(): void {
  instance = null
}
