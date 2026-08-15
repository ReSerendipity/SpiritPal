/**
 * @file vectorSearch.ts
 * @description 本地向量检索模块（主线程 API）
 *
 * 通过 Web Worker 运行 @xenova/transformers 嵌入模型，避免阻塞 UI 线程
 * 模型：BAAI/bge-small-zh-v1.5（512 维向量，中文优化）
 *
 * 检索流程：
 * embed(query) → getAllEmbeddings() → cosineSimilarity → top-K
 *
 * 优化特性：
 * - Web Worker 隔离：模型推理在 Worker 中运行，不阻塞主线程 UI
 * - LRU 嵌入缓存：相同文本不重复计算，上限 1000 条（约 1.5MB 内存）
 * - 失败冷却重试：模型加载失败后进入 5 分钟冷却期，冷却后自动重试
 * - 批量嵌入支持：多条文本一次性发送到 Worker，减少通信开销
 *
 * [REFACTOR] R2 - 安全增强：
 *   1. C5 修复：embeddingCache 加 LRU 上限（1000 条），防止内存无限增长
 *   2. E3 修复：modelLoadFailed 改为带冷却期的重试机制，避免一次失败永久拒绝
 *
 * 主要模块：
 * - embed()/embedBatch(): 文本嵌入函数
 * - cosineSimilarity(): 余弦相似度计算
 * - searchSimilar(): Top-K 相似检索
 * - isVectorSearchAvailable(): 可用性检查
 * - preloadModel(): 模型预加载
 * - getCacheSize()/clearCache()/resetModelCooldown(): 测试辅助 API
 *
 * 依赖关系：
 * - ./vectorWorker?worker: Vite 导入的 Web Worker
 *
 * 核心接口：
 * - embed(text): 单文本嵌入
 * - embedBatch(texts): 批量嵌入
 * - cosineSimilarity(a, b): 余弦相似度
 * - searchSimilar(query, candidates, topK): 相似检索
 * - isVectorSearchAvailable(): 检查可用性
 */

import VectorWorker from './vectorWorker?worker'
import { selectTopK, perfMonitor } from './commonUtils'

// ============ 常量 ============

/** 嵌入向量维度（BAAI/bge-small-zh-v1.5 输出 512 维） */
const EMBEDDING_DIM = 512

/**
 * 嵌入缓存上限（LRU 策略，超过时淘汰最久未用的条目）
 * [OPTIMIZE] C5 - 限制缓存上限避免内存泄漏；1000 条 × 512 float × 4 bytes ≈ 2MB
 */
const EMBEDDING_CACHE_MAX_SIZE = 1000

/**
 * 模型加载失败后的冷却时间（毫秒），冷却期过后允许重试
 * [OPTIMIZE] E3 - 5 分钟冷却，避免永久拒绝；用户重启应用或等待后可恢复
 */
const MODEL_RETRY_COOLDOWN_MS = 5 * 60 * 1000

// ============ Web Worker 管理 ============

/** Web Worker 实例（懒加载） */
let worker: Worker | null = null
/** 消息 ID 计数器（用于匹配请求和响应） */
let messageId = 0
/** 等待中的请求 Map（id -> { resolve, reject }） */
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()

/**
 * 模型加载失败的时间戳（0 表示未失败或已过冷却期）
 * [OPTIMIZE] E3 - 替代原 boolean modelLoadFailed，改为时间戳以支持冷却后重试
 */
let modelLoadFailedAt = 0

/**
 * 获取或创建 Web Worker 实例
 * @returns Worker 实例
 */
function getWorker(): Worker {
  if (!worker) {
    worker = new VectorWorker()
    worker.onmessage = (e: MessageEvent) => {
      const { id, result, error } = e.data as {
        id: number
        result?: Float32Array | Float32Array[]
        error?: string
      }
      const p = pending.get(id)
      if (p) {
        if (error) p.reject(new Error(error))
        else p.resolve(result)
        pending.delete(id)
      }
    }
    worker.onerror = (e) => {
      console.error('[vectorSearch] Worker error:', e.message)
      // 拒绝所有等待中的请求
      for (const [, p] of pending) p.reject(new Error('Worker error'))
      pending.clear()
      worker = null
      // [OPTIMIZE] E3 - 记录失败时间戳，冷却期后允许重试（而非永久标记）
      modelLoadFailedAt = Date.now()
    }
  }
  return worker
}

/**
 * 向 Worker 发送消息并等待响应
 * @param type 消息类型：'embed' | 'embedBatch'
 * @param text 单条文本（type='embed' 时使用）
 * @param texts 多条文本（type='embedBatch' 时使用）
 * @returns Promise，解析为嵌入向量（单条或批量）
 */
function sendToWorker(
  type: 'embed' | 'embedBatch',
  text?: string,
  texts?: string[],
): Promise<Float32Array | Float32Array[]> {
  return new Promise((resolve, reject) => {
    const id = messageId++
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    getWorker().postMessage({ id, type, text, texts })
  })
}

// ============ 嵌入缓存（LRU 策略）============
/**
 * [OPTIMIZE] C5 - 使用 Map 的插入顺序实现 LRU：
 *   - 命中时 delete + set 重新插入到末尾（标记为最近使用）
 *   - 超限时删除 Map 第一个条目（最久未用）
 */

/** LRU 嵌入缓存（text -> Float32Array） */
const embeddingCache = new Map<string, Float32Array>()

/**
 * 从缓存获取嵌入向量（LRU：命中时移到末尾标记为最近使用）
 * @param text 文本
 * @returns 缓存的嵌入向量，未命中时返回 undefined
 */
function getCachedEmbedding(text: string): Float32Array | undefined {
  const value = embeddingCache.get(text)
  if (value) {
    // LRU 策略：删除后重新插入，使其成为最新条目
    embeddingCache.delete(text)
    embeddingCache.set(text, value)
  }
  return value
}

/**
 * 将嵌入向量存入缓存（LRU：超限时淘汰最久未用的条目）
 * @param text 文本
 * @param embedding 嵌入向量
 */
function setCachedEmbedding(text: string, embedding: Float32Array): void {
  // 先删除可能已存在的旧条目（更新而非重复插入）
  embeddingCache.delete(text)
  // 超限时淘汰最旧条目（Map 迭代顺序 = 插入顺序，第一个即最久未用）
  if (embeddingCache.size >= EMBEDDING_CACHE_MAX_SIZE) {
    const oldestKey = embeddingCache.keys().next().value
    if (oldestKey !== undefined) {
      embeddingCache.delete(oldestKey)
    }
  }
  embeddingCache.set(text, embedding)
}

// ============ 模型冷却期检查 ============

/**
 * 检查模型是否处于冷却期（加载失败后 5 分钟内不可用）
 * 冷却期过后自动重置失败状态，允许重试。
 * [OPTIMIZE] E3 - 替代原 modelLoadFailed 永久拒绝逻辑
 * @returns true 表示处于冷却期，不可用
 */
function isModelInCooldown(): boolean {
  if (modelLoadFailedAt === 0) return false
  if (Date.now() - modelLoadFailedAt >= MODEL_RETRY_COOLDOWN_MS) {
    // 冷却期已过，重置失败状态，允许重试
    modelLoadFailedAt = 0
    return false
  }
  return true
}

// ============ 公共 API ============

/**
 * 将文本嵌入为 512 维向量。
 * 结果会被缓存（相同文本不重复计算，LRU 策略上限 1000 条）。
 * 在 Web Worker 中运行，不阻塞 UI。
 *
 * @param text 输入文本
 * @returns Promise，解析为 512 维 Float32Array 向量
 */
export async function embed(text: string): Promise<Float32Array> {
  if (!text || text.trim().length === 0) {
    return new Float32Array(EMBEDDING_DIM)
  }

  // [OPTIMIZE] C5 - 使用 LRU get 替代直接 Map.get
  const cached = getCachedEmbedding(text)
  if (cached) return cached

  const marker = perfMonitor.start('vectorSearch.embed')
  try {
    const result = await sendToWorker('embed', text)
    const embedding = result as Float32Array
    // [OPTIMIZE] C5 - 使用 LRU set 替代直接 Map.set
    setCachedEmbedding(text, embedding)
    return embedding
  } finally {
    perfMonitor.end(marker)
  }
}

/**
 * 批量嵌入多条文本。
 * 未缓存的文本一次性发送到 Worker 进行批量推理，减少通信开销。
 *
 * @param texts 文本数组
 * @returns Promise，解析为对应顺序的嵌入向量数组
 */
export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  const results: Float32Array[] = new Array(texts.length)
  const uncachedIndices: number[] = []
  const uncachedTexts: string[] = []

  texts.forEach((text, i) => {
    if (!text || text.trim().length === 0) {
      results[i] = new Float32Array(EMBEDDING_DIM)
    } else {
      // [OPTIMIZE] C5 - 使用 LRU get
      const cached = getCachedEmbedding(text)
      if (cached) {
        results[i] = cached
      } else {
        uncachedIndices.push(i)
        uncachedTexts.push(text)
      }
    }
  })

  if (uncachedTexts.length > 0) {
    const marker = perfMonitor.start('vectorSearch.embedBatch', { count: uncachedTexts.length })
    try {
      const embeddings = (await sendToWorker('embedBatch', undefined, uncachedTexts)) as Float32Array[]
      embeddings.forEach((emb, j) => {
        const i = uncachedIndices[j]
        results[i] = emb
        // [OPTIMIZE] C5 - 使用 LRU set
        setCachedEmbedding(uncachedTexts[j], emb)
      })
    } finally {
      perfMonitor.end(marker)
    }
  }

  return results
}

/**
 * 计算两个向量的余弦相似度
 * @param a 向量 a
 * @param b 向量 b
 * @returns 相似度值（-1 到 1，1 表示方向完全相同，0 表示正交）
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
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

/**
 * 从候选集中检索与查询向量最相似的 top-K 记忆
 * 使用最小堆优化：时间复杂度 O(n log k)，比全排序 O(n log n) 在 K << n 时显著更快
 * @param queryEmbedding 查询向量
 * @param candidates 候选集（包含 id 和 embedding）
 * @param topK 返回前 K 个结果
 * @returns 按相似度降序排列的结果数组（id + score）
 */
export function searchSimilar(
  queryEmbedding: Float32Array,
  candidates: { id: number; embedding: Float32Array }[],
  topK: number,
): { id: number; score: number }[] {
  const marker = perfMonitor.start('vectorSearch.searchSimilar', { candidates: candidates.length, topK })
  try {
    // OPTIMIZE: 使用公共模块的最小堆选择 Top-K，时间复杂度 O(n log k)
    // 当候选集较大时（如 1000+ 条记忆），性能提升明显
    return selectTopK(
      candidates.map((c) => ({
        id: c.id,
        score: cosineSimilarity(queryEmbedding, c.embedding),
      })),
      topK,
      (a: { id: number; score: number }, b: { id: number; score: number }) => a.score - b.score,
      'desc',
    )
  } finally {
    perfMonitor.end(marker)
  }
}

/**
 * 检查向量搜索是否可用（模型是否已成功加载）。
 * enhancedMemory.ts 用此函数决定是否使用向量检索，还是回退到 LCS。
 *
 * [OPTIMIZE] E3 - 加载失败后进入 5 分钟冷却期，冷却期过后自动重试
 * @returns Promise，解析为 true 表示向量搜索可用
 */
export async function isVectorSearchAvailable(): Promise<boolean> {
  // [OPTIMIZE] E3 - 冷却期内返回 false，冷却期过后允许重试
  if (isModelInCooldown()) return false
  try {
    const test = await embed('__vector_search_availability_check__')
    return test.length === EMBEDDING_DIM
  } catch {
    // [OPTIMIZE] E3 - 记录失败时间戳，进入冷却期（而非永久标记）
    modelLoadFailedAt = Date.now()
    return false
  }
}

/**
 * 预加载嵌入模型（可选调用，在空闲时预热模型）
 * 预加载失败静默忽略，后续实际使用时会再次尝试
 */
export async function preloadModel(): Promise<void> {
  try {
    await embed('__preload__')
  } catch {
    // 预加载失败静默忽略，后续实际使用时会再次尝试
    // [OPTIMIZE] E3 - isVectorSearchAvailable 会记录失败时间戳并进入冷却期
  }
}

// ============ 测试辅助 API（仅供单元测试使用）============

/**
 * 获取当前嵌入缓存大小（仅供测试/调试）
 * @returns 缓存条目数
 */
export function getCacheSize(): number {
  return embeddingCache.size
}

/**
 * 清空嵌入缓存（仅供测试/调试）
 */
export function clearCache(): void {
  embeddingCache.clear()
}

/**
 * 重置模型冷却状态（仅供测试/调试）
 * 强制清除失败时间戳，使下次调用立即重试
 */
export function resetModelCooldown(): void {
  modelLoadFailedAt = 0
}

// ============ 资源清理（内存管理优化）============

/**
 * 终止 Web Worker 并清理所有资源
 * 在应用退出或长时间不使用向量搜索时调用，防止内存泄漏
 *
 * - 终止 Worker 线程
 * - 拒绝所有等待中的请求
 * - 清空嵌入缓存
 * - 重置所有状态
 */
export function terminateVectorSearch(): void {
  if (worker) {
    // 拒绝所有等待中的请求
    for (const [, p] of pending) {
      p.reject(new Error('Vector search terminated'))
    }
    pending.clear()
    // 终止 Worker
    worker.terminate()
    worker = null
  }
  // 清空嵌入缓存
  embeddingCache.clear()
  // 重置状态
  messageId = 0
  modelLoadFailedAt = 0
}
