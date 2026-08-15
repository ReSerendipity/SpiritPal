/**
 * 本地嵌入模型管理模块
 *
 * @fileoverview 封装 @xenova/transformers 本地文本嵌入能力，支持缓存、批量推理与进度回调
 *
 * 主要模块：
 * - EmbeddingModelStatus: 模型加载状态枚举
 * - EmbeddingProgressCallback: 进度回调接口
 * - EmbeddingResult: 嵌入结果结构
 * - LocalEmbeddingManager: 嵌入管理器主类
 *
 * 依赖关系：
 * - vectorSearch.ts: 底层向量搜索与嵌入函数封装
 * - @xenova/transformers: 本地 Transformers.js 推理
 *
 * 核心接口：
 * - embed(): 单条文本嵌入
 * - embedBatch(): 批量文本嵌入
 * - preloadModel(): 预加载模型
 * - isReady(): 检查模型是否就绪
 *
 * 核心功能：
 * 1. 模型缓存：避免重复下载，模型文件持久化
 * 2. 批量嵌入：最多32条/批，减少推理开销
 * 3. 进度回调：加载进度通知
 * 4. 自动降级：不可用时回退到 vectorSearch.ts
 *
 * 默认模型：BAAI/bge-small-zh-v1.5（中文优化，512维输出）
 */

import { embed, embedBatch, isVectorSearchAvailable, preloadModel } from './vectorSearch'

// ============ 常量 ============

/** 默认嵌入模型名称（HuggingFace 模型 ID）— 决策#5: 中文优化模型 */
const DEFAULT_MODEL_ID = 'BAAI/bge-small-zh-v1.5'

/** 嵌入向量维度（BAAI/bge-small-zh-v1.5 输出 512 维） */
const EMBEDDING_DIM = 512

/** 批量嵌入的最大批次大小（避免单次推理过大导致 OOM） */
const MAX_BATCH_SIZE = 32

// ============ 嵌入状态 ============

/** 模型加载状态 */
export type EmbeddingModelStatus = 
  | 'idle'           // 未初始化
  | 'loading'        // 加载中
  | 'ready'          // 就绪
  | 'failed'         // 加载失败
  | 'cooldown'       // 冷却中（加载失败后等待重试）

/** 嵌入进度回调 */
export interface EmbeddingProgressCallback {
  /** 模型加载进度（0-1） */
  onLoadingProgress?: (progress: number) => void
  /** 模型状态变更 */
  onStatusChange?: (status: EmbeddingModelStatus) => void
  /** 错误通知 */
  onError?: (error: Error) => void
}

// ============ 嵌入结果 ============

/** 单条嵌入结果 */
export interface EmbeddingResult {
  /** 原始文本 */
  text: string
  /** 嵌入向量 */
  embedding: Float32Array
  /** 是否来自缓存 */
  fromCache: boolean
  /** 计算耗时（毫秒，仅非缓存结果有效） */
  computeTime?: number
}

/** 批量嵌入统计 */
export interface BatchEmbeddingStats {
  /** 总条数 */
  total: number
  /** 缓存命中数 */
  cacheHits: number
  /** 实际计算数 */
  computed: number
  /** 总耗时（毫秒） */
  totalTime: number
  /** 平均单条耗时（毫秒） */
  avgTimePerItem: number
}

// ============ 本地嵌入管理器 ============

/**
 * 本地嵌入模型管理器
 * 封装 @xenova/transformers 的嵌入能力，提供缓存、批量、进度等增强功能
 */
export class LocalEmbeddingManager {
  private modelId: string
  private status: EmbeddingModelStatus = 'idle'
  private callbacks: EmbeddingProgressCallback = {}
  private initPromise: Promise<void> | null = null

  /** 嵌入结果缓存（text → embedding） */
  private resultCache: Map<string, Float32Array> = new Map()
  /** 缓存上限 */
  private cacheMaxSize: number
  /** 统计信息 */
  private stats = {
    totalEmbeddings: 0,
    cacheHits: 0,
    totalComputeTime: 0,
  }

  constructor(
    modelId: string = DEFAULT_MODEL_ID,
    cacheMaxSize: number = 2000,
    callbacks?: EmbeddingProgressCallback,
  ) {
    this.modelId = modelId
    this.cacheMaxSize = cacheMaxSize
    if (callbacks) this.callbacks = callbacks
  }

  /**
   * 初始化嵌入模型（懒加载）
   * 首次调用时加载模型，后续调用直接返回
   */
  async initialize(): Promise<void> {
    if (this.status === 'ready') return
    if (this.initPromise) {
      await this.initPromise
      return
    }

    this.initPromise = this.doInitialize()
    await this.initPromise
  }

  private async doInitialize(): Promise<void> {
    this.setStatus('loading')
    this.callbacks.onLoadingProgress?.(0)

    try {
      // 检查向量搜索可用性
      this.callbacks.onLoadingProgress?.(0.3)
      const available = await isVectorSearchAvailable()

      if (!available) {
        // 预加载模型
        this.callbacks.onLoadingProgress?.(0.5)
        await preloadModel()
      }

      // 验证模型可用
      const testEmbedding = await embed('__init_test__')
      if (testEmbedding.length !== EMBEDDING_DIM) {
        throw new Error(`嵌入维度不匹配：期望 ${EMBEDDING_DIM}，实际 ${testEmbedding.length}`)
      }

      this.callbacks.onLoadingProgress?.(1.0)
      this.setStatus('ready')
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e))
      this.setStatus('failed')
      this.callbacks.onError?.(error)
      // 不抛出异常，允许降级使用
    }
  }

  /**
   * 嵌入单条文本
   * @param text 输入文本
   * @param useCache 是否使用缓存（默认 true）
   * @returns 嵌入结果
   */
  async embedText(text: string, useCache = true): Promise<EmbeddingResult> {
    // 空文本返回零向量
    if (!text || text.trim().length === 0) {
      return {
        text,
        embedding: new Float32Array(EMBEDDING_DIM),
        fromCache: true,
      }
    }

    // 缓存命中
    if (useCache) {
      const cached = this.getFromCache(text)
      if (cached) {
        this.stats.cacheHits++
        return { text, embedding: cached, fromCache: true }
      }
    }

    // 确保模型已初始化
    if (this.status !== 'ready') {
      await this.initialize()
    }

    // 计算嵌入
    const startTime = performance.now()
    const embedding = await embed(text)
    const computeTime = performance.now() - startTime

    // 缓存结果
    if (useCache) {
      this.putToCache(text, embedding)
    }

    // 更新统计
    this.stats.totalEmbeddings++
    this.stats.totalComputeTime += computeTime

    return { text, embedding, fromCache: false, computeTime }
  }

  /**
   * 批量嵌入多条文本
   * 自动分批处理，避免单次推理过大
   * 
   * @param texts 输入文本列表
   * @param useCache 是否使用缓存（默认 true）
   * @returns 嵌入结果列表
   */
  async embedTexts(texts: string[], useCache = true): Promise<{
    results: EmbeddingResult[]
    stats: BatchEmbeddingStats
  }> {
    const startTime = performance.now()
    const results: EmbeddingResult[] = new Array(texts.length)
    let cacheHits = 0
    let computed = 0

    // 分离缓存命中和未命中的
    const uncachedIndices: number[] = []
    const uncachedTexts: string[] = []

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i] ?? ''
      if (!text || text.trim().length === 0) {
        results[i] = {
          text,
          embedding: new Float32Array(EMBEDDING_DIM),
          fromCache: true,
        }
        cacheHits++
        continue
      }

      if (useCache) {
        const cached = this.getFromCache(text)
        if (cached) {
          results[i] = { text, embedding: cached, fromCache: true }
          cacheHits++
          continue
        }
      }

      uncachedIndices.push(i)
      uncachedTexts.push(text)
    }

    // 分批计算未命中的嵌入
    if (uncachedTexts.length > 0) {
      // 确保模型已初始化
      if (this.status !== 'ready') {
        await this.initialize()
      }

      // 分批处理
      for (let batchStart = 0; batchStart < uncachedTexts.length; batchStart += MAX_BATCH_SIZE) {
        const batchEnd = Math.min(batchStart + MAX_BATCH_SIZE, uncachedTexts.length)
        const batchTexts = uncachedTexts.slice(batchStart, batchEnd)
        const batchIndices = uncachedIndices.slice(batchStart, batchEnd)

        const embeddings = await embedBatch(batchTexts)

        for (let j = 0; j < batchTexts.length; j++) {
          const i = batchIndices[j]!
          const text = batchTexts[j]!
          const embedding = embeddings[j]!

          results[i] = { text, embedding, fromCache: false }
          computed++

          // 缓存结果
          if (useCache) {
            this.putToCache(text, embedding)
          }
        }
      }

      this.stats.totalEmbeddings += computed
    }

    const totalTime = performance.now() - startTime

    return {
      results,
      stats: {
        total: texts.length,
        cacheHits,
        computed,
        totalTime,
        avgTimePerItem: texts.length > 0 ? totalTime / texts.length : 0,
      },
    }
  }

  /**
   * 获取两段文本的语义相似度
   * @param textA 文本 A
   * @param textB 文本 B
   * @returns 余弦相似度（-1 到 1）
   */
  async similarity(textA: string, textB: string): Promise<number> {
    const [a, b] = await Promise.all([
      this.embedText(textA),
      this.embedText(textB),
    ])
    return this.cosineSimilarity(a.embedding, b.embedding)
  }

  /** 计算余弦相似度 */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length || a.length === 0) return 0
    let dot = 0
    let normA = 0
    let normB = 0
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    if (denom === 0) return 0
    return dot / denom
  }

  // ============ 缓存管理 ============

  /** 从缓存获取（LRU：命中时移到末尾） */
  private getFromCache(text: string): Float32Array | undefined {
    const value = this.resultCache.get(text)
    if (value) {
      // LRU 策略：删除后重新插入
      this.resultCache.delete(text)
      this.resultCache.set(text, value)
    }
    return value
  }

  /** 存入缓存（LRU：超限时淘汰最久未用） */
  private putToCache(text: string, embedding: Float32Array): void {
    this.resultCache.delete(text)
    if (this.resultCache.size >= this.cacheMaxSize) {
      const oldestKey = this.resultCache.keys().next().value
      if (oldestKey !== undefined) {
        this.resultCache.delete(oldestKey)
      }
    }
    this.resultCache.set(text, embedding)
  }

  /** 清空嵌入缓存 */
  clearCache(): void {
    this.resultCache.clear()
  }

  /** 获取缓存大小 */
  getCacheSize(): number {
    return this.resultCache.size
  }

  /** 获取缓存命中率 */
  getCacheHitRate(): number {
    const total = this.stats.totalEmbeddings + this.stats.cacheHits
    return total > 0 ? this.stats.cacheHits / total : 0
  }

  // ============ 状态管理 ============

  private setStatus(status: EmbeddingModelStatus): void {
    this.status = status
    this.callbacks.onStatusChange?.(status)
  }

  /** 获取当前状态 */
  getStatus(): EmbeddingModelStatus {
    return this.status
  }

  /** 获取模型 ID */
  getModelId(): string {
    return this.modelId
  }

  /** 获取嵌入维度 */
  getEmbeddingDim(): number {
    return EMBEDDING_DIM
  }

  /** 获取统计信息 */
  getStats(): typeof this.stats {
    return { ...this.stats }
  }

  /** 更新回调 */
  setCallbacks(callbacks: EmbeddingProgressCallback): void {
    this.callbacks = callbacks
  }
}

// ============ 单例 ============

let instance: LocalEmbeddingManager | null = null

/**
 * 获取本地嵌入管理器单例
 * @param modelId 模型 ID（首次调用时生效）
 * @param cacheMaxSize 缓存上限（首次调用时生效）
 */
export function getLocalEmbeddingManager(
  modelId?: string,
  cacheMaxSize?: number,
): LocalEmbeddingManager {
  if (!instance) {
    instance = new LocalEmbeddingManager(modelId, cacheMaxSize)
  }
  return instance
}

/**
 * 重置本地嵌入管理器（测试用）
 */
export function resetLocalEmbeddingManager(): void {
  instance = null
}
