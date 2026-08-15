/**
 * RAG混合检索模块
 *
 * @fileoverview BM25关键词匹配+向量相似度检索+RRF加权融合的混合RAG实现（参考super-agent-party）
 *
 * 主要模块：
 * - RAGConfig/DEFAULT_RAG_CONFIG: 检索配置与默认值
 * - RAGResult: 单条检索结果
 * - RAGRetriever: RAG混合检索器主类
 *
 * 依赖关系：
 * - vectorSearch.ts: embed()/cosineSimilarity()/isVectorSearchAvailable()
 * - stringSimilarity.ts: tokenize()分词
 * - memoryTypes.ts: EnhancedMemory记忆类型
 *
 * 核心接口：
 * - retrieve(): 混合检索记忆
 * - bm25Search(): BM25关键词检索
 * - vectorSearch(): 向量语义检索
 * - rrfFusion(): Reciprocal Rank Fusion结果融合
 *
 * 核心流程（参考super-agent-party RAG实现）：
 * 1. BM25稀疏检索：基于词频的精确匹配，擅长关键词命中
 * 2. 向量稠密检索：语义相似度，擅长意图理解/同义表达
 * 3. RRF加权融合：alpha*bm25_rank + (1-alpha)*vector_rank
 * 4. 去重重排：合并相同结果，按融合分数排序
 *
 * 配置参数：alpha=0.5(BM25权重), k1=1.5, b=0.75(BM25参数), rrfK=60
 */

import { embed, isVectorSearchAvailable, searchSimilar } from './vectorSearch'
import { tokenize } from './stringSimilarity'
import type { EnhancedMemory } from './memoryTypes'
// T-12: 统一配置入口
import { RETRIEVAL_CONFIG } from './memoryConfig'

// ============ 配置常量 ============

/** RAG 混合检索配置 */
export interface RAGConfig {
  /** BM25 权重（0-1），向量权重 = 1 - alpha，默认 0.5 */
  alpha: number
  /** 返回结果数量上限，默认 10 */
  topK: number
  /** BM25 参数 k1 — 词频饱和系数，默认 1.5 */
  bm25K1: number
  /** BM25 参数 b — 文档长度归一化系数，默认 0.75 */
  bm25B: number
  /** RRF 常数 k — 防止排名第一的结果权重过大，默认 60 */
  rrfK: number
  /** 向量相似度阈值，低于此值的结果被过滤，默认 0.45（P2-3：与 enhancedMemory.ts 硬编码值统一） */
  vectorMinScore: number
  /** BM25 分数阈值，低于此值的结果被过滤，默认 0.01 */
  bm25MinScore: number
}

/** 默认 RAG 配置（T-12: 阈值统一来自 memoryConfig） */
export const DEFAULT_RAG_CONFIG: RAGConfig = {
  alpha: 0.5,
  topK: 10,
  bm25K1: 1.5,
  bm25B: 0.75,
  rrfK: RETRIEVAL_CONFIG.rrfK,
  vectorMinScore: RETRIEVAL_CONFIG.vectorMinScore,
  bm25MinScore: RETRIEVAL_CONFIG.bm25MinScore,
}

// ============ RAG 检索结果 ============

/** 单条检索结果 */
export interface RAGResult {
  /** 记忆条目 */
  memory: EnhancedMemory
  /** 融合分数（0-1，越高越相关） */
  score: number
  /** BM25 分数（稀疏检索） */
  bm25Score: number
  /** 向量相似度分数（稠密检索，-1 表示未使用向量检索） */
  vectorScore: number
  /** BM25 排名 */
  bm25Rank: number
  /** 向量检索排名（-1 表示未使用向量检索） */
  vectorRank: number
  /** 检索来源 */
  sources: ('bm25' | 'vector')[]
}

// ============ BM25 纯 TypeScript 实现 ============
// 无外部依赖，基于 Okapi BM25 算法

/** 文档的 BM25 统计信息（预计算，避免重复计算） */
interface BM25DocStats {
  /** 文档 ID */
  id: string
  /** 分词结果 */
  tokens: string[]
  /** 词频映射：term → 出现次数 */
  termFreq: Map<string, number>
  /** 文档长度（token 数量） */
  docLen: number
}

/**
 * BM25 检索器
 * 纯 TypeScript 实现，无外部依赖
 */
class BM25Index {
  private docs: BM25DocStats[] = []
  private docFreq: Map<string, number> = new Map()  // term → 包含该 term 的文档数
  private avgDocLen = 0
  private totalDocs = 0
  private k1: number
  private b: number

  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1
    this.b = b
  }

  /**
   * P4-1：增量添加单个文档到索引（避免全量重建）
   */
  addDocument(doc: { id: string; text: string }): void {
    const tokens = tokenize(doc.text)
    const termFreq = new Map<string, number>()
    for (const t of tokens) {
      termFreq.set(t, (termFreq.get(t) || 0) + 1)
    }

    const stats: BM25DocStats = {
      id: doc.id,
      tokens,
      termFreq,
      docLen: tokens.length,
    }
    this.docs.push(stats)
    this.totalDocs++

    // 更新文档频率和平均文档长度
    const uniqueTerms = new Set(tokens)
    for (const t of uniqueTerms) {
      this.docFreq.set(t, (this.docFreq.get(t) || 0) + 1)
    }

    // 重新计算平均文档长度
    this.avgDocLen = (this.avgDocLen * (this.totalDocs - 1) + stats.docLen) / this.totalDocs
  }

  /**
   * P4-1：从索引中移除指定文档
   */
  removeDocument(id: string): void {
    const idx = this.docs.findIndex(d => d.id === id)
    if (idx === -1) return
    const removed = this.docs[idx]
    this.docs.splice(idx, 1)
    this.totalDocs--

    // 更新文档频率
    const uniqueTerms = new Set(removed.tokens)
    for (const t of uniqueTerms) {
      const freq = this.docFreq.get(t)
      if (freq !== undefined) {
        if (freq <= 1) {
          this.docFreq.delete(t)
        } else {
          this.docFreq.set(t, freq - 1)
        }
      }
    }

    // 重新计算平均文档长度
    if (this.totalDocs > 0) {
      const totalLen = this.docs.reduce((sum, d) => sum + d.docLen, 0)
      this.avgDocLen = totalLen / this.totalDocs
    } else {
      this.avgDocLen = 0
    }
  }

  /**
   * 构建索引
   * @param documents 文档列表，每个文档包含 id 和 text
   */
  buildIndex(documents: { id: string; text: string }[]): void {
    this.docs = []
    this.docFreq.clear()
    this.totalDocs = documents.length
    let totalLen = 0

    for (const doc of documents) {
      const tokens = tokenize(doc.text)
      const termFreq = new Map<string, number>()
      for (const t of tokens) {
        termFreq.set(t, (termFreq.get(t) || 0) + 1)
      }

      const stats: BM25DocStats = {
        id: doc.id,
        tokens,
        termFreq,
        docLen: tokens.length,
      }
      this.docs.push(stats)
      totalLen += stats.docLen

      // 更新文档频率（每个 term 在每篇文档中只计一次）
      for (const term of termFreq.keys()) {
        this.docFreq.set(term, (this.docFreq.get(term) || 0) + 1)
      }
    }

    this.avgDocLen = this.totalDocs > 0 ? totalLen / this.totalDocs : 1
  }

  /**
   * 检索与查询最相关的文档
   * @param query 查询文本
   * @param topK 返回前 K 个结果
   * @returns 按分数降序排列的 [文档ID, 分数] 数组
   */
  search(query: string, topK: number): { id: string; score: number }[] {
    if (this.totalDocs === 0) return []

    const queryTokens = tokenize(query)
    if (queryTokens.length === 0) return []

    const scores: { id: string; score: number }[] = []

    for (const doc of this.docs) {
      let score = 0

      for (const qTerm of queryTokens) {
        const tf = doc.termFreq.get(qTerm) || 0
        if (tf === 0) continue

        const df = this.docFreq.get(qTerm) || 0
        // IDF = ln((N - df + 0.5) / (df + 0.5) + 1)
        const idf = Math.log(
          (this.totalDocs - df + 0.5) / (df + 0.5) + 1,
        )

        // BM25 词频分量：tf * (k1 + 1) / (tf + k1 * (1 - b + b * dl / avgdl))
        const tfNorm =
          (tf * (this.k1 + 1)) /
          (tf + this.k1 * (1 - this.b + this.b * (doc.docLen / this.avgDocLen)))

        score += idf * tfNorm
      }

      if (score > 0) {
        scores.push({ id: doc.id, score })
      }
    }

    return scores.sort((a, b) => b.score - a.score).slice(0, topK)
  }

  /** 获取索引中的文档数量 */
  get size(): number {
    return this.totalDocs
  }
}

// ============ 向量检索辅助 ============

/**
 * 在候选记忆中执行向量相似度检索
 * @param query 查询文本
 * @param candidates 候选记忆列表（需包含 dbId 和 embedding）
 * @param embeddingCache 嵌入向量缓存（dbId → embedding）
 * @param topK 返回前 K 个结果
 * @param minScore 最低相似度阈值
 * @returns 按相似度降序排列的结果
 */
async function vectorSearch(
  query: string,
  candidates: EnhancedMemory[],
  embeddingCache: Map<number, Float32Array>,
  topK: number,
  minScore: number,
): Promise<{ id: string; score: number }[]> {
  // 构建 dbId → memory 映射
  const dbIdMap = new Map<number, EnhancedMemory>()
  for (const mem of candidates) {
    if (mem.dbId !== undefined) dbIdMap.set(mem.dbId, mem)
  }
  if (dbIdMap.size === 0) return []

  // 获取候选嵌入向量
  const embeddingCandidates: { id: number; embedding: Float32Array }[] = []
  for (const [dbId, embedding] of embeddingCache) {
    if (dbIdMap.has(dbId)) {
      embeddingCandidates.push({ id: dbId, embedding })
    }
  }
  if (embeddingCandidates.length === 0) return []

  // 嵌入查询文本
  const queryEmbedding = await embed(query)

  // F9 修复：使用 Top-K 堆（searchSimilar）替代全量排序，复杂度 O(n log k) → O(n log n) 的路径统一
  // 行为等价：先取相似度最高的 topK，再按 minScore 过滤（与旧实现"过滤后取 topK"结果集一致）
  const topResults = searchSimilar(queryEmbedding, embeddingCandidates, topK)

  const scored = topResults
    .map((r) => ({
      id: dbIdMap.get(r.id)!.id,
      score: r.score,
    }))
    .filter((s) => s.score >= minScore)

  return scored
}

// ============ Reciprocal Rank Fusion (RRF) ============

/**
 * RRF 加权融合两个排序列表
 * 公式：score = alpha / (k + bm25_rank) + (1 - alpha) / (k + vector_rank)
 *
 * @param bm25Results BM25 检索结果（已按分数降序排列）
 * @param vectorResults 向量检索结果（已按分数降序排列）
 * @param config RAG 配置
 * @returns 融合后的结果（按融合分数降序排列）
 */
function reciprocalRankFusion(
  bm25Results: { id: string; score: number }[],
  vectorResults: { id: string; score: number }[],
  config: RAGConfig,
): Map<string, {
  fusionScore: number
  bm25Rank: number
  bm25Score: number
  vectorRank: number
  vectorScore: number
  sources: ('bm25' | 'vector')[]
}> {
  const result = new Map<string, {
    fusionScore: number
    bm25Rank: number
    bm25Score: number
    vectorRank: number
    vectorScore: number
    sources: ('bm25' | 'vector')[]
  }>()

  // BM25 贡献
  for (let i = 0; i < bm25Results.length; i++) {
    const { id, score } = bm25Results[i]
    const rank = i + 1  // 排名从 1 开始
    const rrfScore = config.alpha / (config.rrfK + rank)
    result.set(id, {
      fusionScore: rrfScore,
      bm25Rank: rank,
      bm25Score: score,
      vectorRank: -1,
      vectorScore: -1,
      sources: ['bm25'],
    })
  }

  // 向量贡献
  for (let i = 0; i < vectorResults.length; i++) {
    const { id, score } = vectorResults[i]
    const rank = i + 1
    const rrfScore = (1 - config.alpha) / (config.rrfK + rank)
    const existing = result.get(id)
    if (existing) {
      // 两个检索都命中的结果，累加分数
      existing.fusionScore += rrfScore
      existing.vectorRank = rank
      existing.vectorScore = score
      existing.sources.push('vector')
    } else {
      result.set(id, {
        fusionScore: rrfScore,
        bm25Rank: -1,
        bm25Score: -1,
        vectorRank: rank,
        vectorScore: score,
        sources: ['vector'],
      })
    }
  }

  return result
}

// ============ RAG 混合检索器 ============

/**
 * P3-1：动态 alpha 计算——根据查询类型调整 BM25/向量权重
 *
 * 规则：
 * - 查询包含具体名词/实体（短查询、关键词多）→ 偏 BM25（alpha↑）
 * - 查询是语义描述（长查询、自然语句）→ 偏向量（alpha↓）
 * - 默认 alpha=0.5
 *
 * @param query 查询文本
 * @returns 动态 alpha 值（0.2-0.8）
 */
export function computeDynamicAlpha(query: string): number {
  const tokens = tokenize(query)
  if (tokens.length === 0) return 0.5

  // 短查询（1-3 词）且包含具体时间/人名/地名 → 偏 BM25
  if (tokens.length <= 3) {
    return 0.7
  }

  // 长查询（>8 词）或包含疑问词 → 偏向量（语义理解更重要）
  if (tokens.length > 8 || /怎么样|为什么|怎么|什么|是不是|能不能|为什么|如何/.test(query)) {
    return 0.3
  }

  // 中等长度查询，检查是否包含时间词（精确匹配偏 BM25）
  if (/今天|昨天|明天|上周|下周|这个月|去年|今年|明天|周[一二三四五六日天]/.test(query)) {
    return 0.65
  }

  // 默认均衡
  return 0.5
}

/**
 * RAG 混合检索管理器
 * 结合 BM25 稀疏检索与向量稠密检索，通过 RRF 加权融合
 */
export class RAGRetriever {
  private config: RAGConfig
  private bm25Index: BM25Index
  private memoryMap: Map<string, EnhancedMemory> = new Map()
  private vectorAvailable: boolean | null = null

  constructor(config: Partial<RAGConfig> = {}) {
    this.config = { ...DEFAULT_RAG_CONFIG, ...config }
    this.bm25Index = new BM25Index(this.config.bm25K1, this.config.bm25B)
  }

  /**
   * P4-1：增量添加单条记忆到索引（避免全量重建）
   */
  addMemory(memory: EnhancedMemory, embedding?: Float32Array): void {
    this.memoryMap.set(memory.id, memory)
    this.bm25Index.addDocument({
      id: memory.id,
      text: `${memory.user} ${memory.assistant} ${memory.tags.join(' ')}`,
    })
    if (embedding && memory.dbId !== undefined) {
      // 增量添加不更新 embeddingCache（由 enhancedMemory 管理）
    }
  }

  /**
   * P4-1：从索引中移除单条记忆
   */
  removeMemory(memoryId: string): void {
    this.memoryMap.delete(memoryId)
    this.bm25Index.removeDocument(memoryId)
  }

  /**
   * 构建检索索引
   * @param memories 记忆列表
   * @param embeddingCache 嵌入向量缓存（用于向量检索）
   */
  async buildIndex(
    memories: EnhancedMemory[],
    embeddingCache?: Map<number, Float32Array>,
  ): Promise<void> {
    // 构建 ID → memory 映射
    this.memoryMap.clear()
    for (const mem of memories) {
      this.memoryMap.set(mem.id, mem)
    }

    // 构建 BM25 索引
    const documents = memories.map((mem) => ({
      id: mem.id,
      text: `${mem.user} ${mem.assistant} ${mem.tags.join(' ')}`,
    }))
    this.bm25Index.buildIndex(documents)

    // 检测向量搜索可用性
    if (this.vectorAvailable === null && embeddingCache) {
      try {
        this.vectorAvailable = await isVectorSearchAvailable()
      } catch {
        this.vectorAvailable = false
      }
    }
  }

  /**
   * 执行混合检索
   * @param query 查询文本
   * @param embeddingCache 嵌入向量缓存
   * @returns 融合排序后的检索结果
   */
  async retrieve(
    query: string,
    embeddingCache?: Map<number, Float32Array>,
  ): Promise<RAGResult[]> {
    if (!query.trim() || this.memoryMap.size === 0) return []

    // 1. BM25 稀疏检索
    const bm25Results = this.bm25Index.search(query, this.config.topK * 2)
      .filter((r) => r.score >= this.config.bm25MinScore)

    // 2. 向量稠密检索
    let vectorResults: { id: string; score: number }[] = []
    if (embeddingCache && this.vectorAvailable !== false) {
      try {
        if (this.vectorAvailable === null) {
          this.vectorAvailable = await isVectorSearchAvailable()
        }
        if (this.vectorAvailable) {
          const candidates = Array.from(this.memoryMap.values())
          vectorResults = await vectorSearch(
            query,
            candidates,
            embeddingCache,
            this.config.topK * 2,
            this.config.vectorMinScore,
          )
        }
      } catch {
        // 向量检索失败，仅使用 BM25
      }
    }

    // 3. RRF 加权融合
    // P3-1：动态 alpha——根据查询类型调整 BM25/向量权重
    const dynamicAlpha = computeDynamicAlpha(query)
    const rrfConfig = { ...this.config, alpha: dynamicAlpha }
    const fused = reciprocalRankFusion(bm25Results, vectorResults, rrfConfig)

    // 4. 构建最终结果
    const results: RAGResult[] = []
    for (const [id, info] of fused) {
      const memory = this.memoryMap.get(id)
      if (!memory) continue

      results.push({
        memory,
        score: info.fusionScore,
        bm25Score: info.bm25Score,
        vectorScore: info.vectorScore,
        bm25Rank: info.bm25Rank,
        vectorRank: info.vectorRank,
        sources: info.sources,
      })
    }

    // 5. 按融合分数降序排列，取 topK
    results.sort((a, b) => b.score - a.score)

    // 6. 去重（同一记忆可能通过不同路径出现）
    const seen = new Set<string>()
    const deduped: RAGResult[] = []
    for (const r of results) {
      if (!seen.has(r.memory.id)) {
        seen.add(r.memory.id)
        deduped.push(r)
        // 更新记忆的访问计数和时间
        r.memory.accessCount++
        r.memory.lastAccessed = Date.now()
      }
      if (deduped.length >= this.config.topK) break
    }

    return deduped
  }

  /**
   * 仅 BM25 检索（不使用向量）
   * 适用于向量模型不可用或需要快速检索的场景
   */
  retrieveBM25(query: string): RAGResult[] {
    if (!query.trim() || this.memoryMap.size === 0) return []

    const bm25Results = this.bm25Index.search(query, this.config.topK)
      .filter((r) => r.score >= this.config.bm25MinScore)

    return bm25Results.map((r, i) => {
      const memory = this.memoryMap.get(r.id)!
      memory.accessCount++
      memory.lastAccessed = Date.now()
      return {
        memory,
        score: r.score,
        bm25Score: r.score,
        vectorScore: -1,
        bm25Rank: i + 1,
        vectorRank: -1,
        sources: ['bm25' as const],
      }
    })
  }

  /** 更新配置 */
  updateConfig(config: Partial<RAGConfig>): void {
    this.config = { ...this.config, ...config }
    // BM25 参数变更需重建索引
    if (config.bm25K1 !== undefined || config.bm25B !== undefined) {
      this.bm25Index = new BM25Index(this.config.bm25K1, this.config.bm25B)
    }
  }

  /** 获取当前配置 */
  getConfig(): RAGConfig {
    return { ...this.config }
  }

  /** 获取索引中的记忆数量 */
  get size(): number {
    return this.memoryMap.size
  }
}

// ============ 单例缓存 ============

const retrievers = new Map<string, RAGRetriever>()

/**
 * 获取 RAG 检索器单例
 * @param characterId 角色 ID
 * @param config 可选配置
 */
export function getRAGRetriever(characterId: string, config?: Partial<RAGConfig>): RAGRetriever {
  let retriever = retrievers.get(characterId)
  if (!retriever) {
    retriever = new RAGRetriever(config)
    retrievers.set(characterId, retriever)
  }
  return retriever
}
