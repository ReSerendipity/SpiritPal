// ragRetrieval 模块测试 — RAG 混合检索（BM25 + 向量 + RRF 融合）
// 第五轮评估补测：该文件此前无专属测试，且 F9 修改了向量检索路径（全量排序 → Top-K 堆）
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../vectorSearch', () => ({
  embed: vi.fn(() => Promise.resolve(new Float32Array([0.1, 0.2, 0.3]))),
  cosineSimilarity: vi.fn(() => 0.8),
  isVectorSearchAvailable: vi.fn(() => Promise.resolve(false)),
  searchSimilar: vi.fn(() => [{ id: 1, score: 0.9 }]),
}))

import { RAGRetriever, computeDynamicAlpha, getRAGRetriever } from '../ragRetrieval'
import { isVectorSearchAvailable, searchSimilar } from '../vectorSearch'
import type { EnhancedMemory } from '../memoryTypes'

/** 构造最小 EnhancedMemory 测试对象 */
function makeMemory(id: string, text: string, dbId?: number): EnhancedMemory {
  return {
    id,
    created_at: new Date().toISOString(),
    user: text,
    assistant: '',
    importance: 50,
    emotionalIntensity: 0,
    category: '日常',
    tags: [],
    accessCount: 0,
    lastAccessed: Date.now(),
    decayFactor: 1.0,
    isAutobiographical: false,
    dbId,
  } as EnhancedMemory
}

describe('computeDynamicAlpha', () => {
  it('短查询（1-3 词）偏 BM25', () => {
    // tokenize 对 CJK 按字切分："升职" = 2 个 token ≤ 3 → 偏 BM25
    expect(computeDynamicAlpha('升职')).toBe(0.7)
  })

  it('长查询或疑问句偏向量', () => {
    expect(computeDynamicAlpha('你觉得我上次说的那件事应该怎么处理比较好呢')).toBe(0.3)
  })

  it('含时间词且无疑问词的查询偏 BM25', () => {
    expect(computeDynamicAlpha('昨天开会')).toBe(0.65)
  })

  it('空查询与中等长度查询返回默认均衡 0.5', () => {
    expect(computeDynamicAlpha('')).toBe(0.5)
    expect(computeDynamicAlpha('我们聊了很多事情')).toBe(0.5)
  })
})

describe('RAGRetriever', () => {
  let retriever: RAGRetriever

  beforeEach(() => {
    vi.clearAllMocks()
    retriever = new RAGRetriever()
  })

  it('buildIndex 后 BM25 能检索到关键词命中的记忆', async () => {
    retriever.buildIndex([
      makeMemory('m1', '我喜欢吃火锅'),
      makeMemory('m2', '明天要开会讨论项目'),
    ])
    const results = await retriever.retrieve('火锅', new Map())
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].memory.id).toBe('m1')
  })

  it('检索结果按融合分数降序排列', async () => {
    retriever.buildIndex([
      makeMemory('a', '今天下雨了'),
      makeMemory('b', '今天下雨了 今天下雨了 今天下雨了'),
    ])
    const results = await retriever.retrieve('今天下雨了', new Map())
    expect(results.length).toBeGreaterThan(1)
    const scores = results.map((r) => r.score)
    expect(scores).toEqual([...scores].sort((x, y) => y - x))
  })

  it('无关查询不返回结果（BM25 分数低于阈值被过滤）', async () => {
    retriever.buildIndex([makeMemory('m1', '我喜欢吃火锅')])
    const results = await retriever.retrieve('量子物理', new Map())
    expect(results.length).toBe(0)
  })

  it('removeMemory 从索引移除记忆', async () => {
    retriever.buildIndex([
      makeMemory('m1', '我喜欢吃火锅'),
      makeMemory('m2', '明天要开会讨论项目'),
    ])
    retriever.removeMemory('m2')
    const results = await retriever.retrieve('开会', new Map())
    expect(results.some((r) => r.memory.id === 'm2')).toBe(false)
  })

  it('空索引返回空结果', async () => {
    const results = await retriever.retrieve('任何查询', new Map())
    expect(results).toEqual([])
  })

  it('向量检索可用时融合向量分数（F9：走 searchSimilar Top-K 堆）', async () => {
    ;(isVectorSearchAvailable as ReturnType<typeof vi.fn>).mockResolvedValue(true)
    ;(searchSimilar as ReturnType<typeof vi.fn>).mockReturnValue([{ id: 1, score: 0.9 }])
    const mem = makeMemory('vec-1', '语义相似的记忆', 1)
    retriever.buildIndex([mem])
    const embeddingCache = new Map([[1, new Float32Array([0.5, 0.5, 0.5])]])
    const results = await retriever.retrieve('语义相近的另一种说法', embeddingCache)
    expect(searchSimilar).toHaveBeenCalled()
    expect(results.some((r) => r.memory.id === 'vec-1' && r.vectorScore === 0.9)).toBe(true)
  })

  it('retrieveBM25 仅用 BM25 路径返回结果', async () => {
    retriever.buildIndex([makeMemory('m1', '我喜欢吃火锅')])
    const results = retriever.retrieveBM25('火锅')
    expect(results.length).toBe(1)
    expect(results[0].memory.id).toBe('m1')
    expect(results[0].vectorScore).toBe(-1)
  })

  it('getRAGRetriever 同一角色返回同一实例，不同角色隔离', () => {
    expect(getRAGRetriever('char-x')).toBe(getRAGRetriever('char-x'))
    expect(getRAGRetriever('char-x')).not.toBe(getRAGRetriever('char-y'))
  })
})
