// vectorSearch 单元测试 — 余弦相似度计算、searchSimilar 排序
// embed/embedBatch 依赖 Web Worker，通过 setup.ts 的 mock 处理；这里重点测试纯逻辑函数
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cosineSimilarity, searchSimilar } from '../vectorSearch'

describe('cosineSimilarity', () => {
  it('相同向量相似度为 1', () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([1, 2, 3])
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5)
  })

  it('正交向量相似度为 0', () => {
    const a = new Float32Array([1, 0])
    const b = new Float32Array([0, 1])
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5)
  })

  it('方向相反相似度为 -1', () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([-1, -2, -3])
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5)
  })

  it('长度不一致返回 0', () => {
    const a = new Float32Array([1, 2, 3])
    const b = new Float32Array([1, 2])
    expect(cosineSimilarity(a, b)).toBe(0)
  })

  it('空向量返回 0', () => {
    const a = new Float32Array([])
    const b = new Float32Array([])
    expect(cosineSimilarity(a, b)).toBe(0)
  })

  it('零向量返回 0（避免除零）', () => {
    const a = new Float32Array([0, 0, 0])
    const b = new Float32Array([1, 2, 3])
    expect(cosineSimilarity(a, b)).toBe(0)
  })

  it('相似度在 0-1 之间（同向向量）', () => {
    const a = new Float32Array([1, 1, 1])
    const b = new Float32Array([1, 1, 0.5])
    const sim = cosineSimilarity(a, b)
    expect(sim).toBeGreaterThan(0)
    expect(sim).toBeLessThanOrEqual(1)
  })
})

describe('searchSimilar', () => {
  it('按相似度降序返回 top-K', () => {
    const query = new Float32Array([1, 0])
    const candidates = [
      { id: 1, embedding: new Float32Array([0.1, 0.9]) }, // 与 query 相似度低
      { id: 2, embedding: new Float32Array([1, 0.1]) },   // 与 query 相似度高
      { id: 3, embedding: new Float32Array([0.5, 0.5]) }, // 中等
    ]
    const result = searchSimilar(query, candidates, 3)
    expect(result).toHaveLength(3)
    // 最相似的应该是 id=2
    expect(result[0].id).toBe(2)
    // 分数应降序
    expect(result[0].score).toBeGreaterThanOrEqual(result[1].score)
    expect(result[1].score).toBeGreaterThanOrEqual(result[2].score)
  })

  it('topK 大于候选数时返回全部', () => {
    const query = new Float32Array([1, 0])
    const candidates = [
      { id: 1, embedding: new Float32Array([1, 0]) },
      { id: 2, embedding: new Float32Array([0, 1]) },
    ]
    const result = searchSimilar(query, candidates, 10)
    expect(result).toHaveLength(2)
  })

  it('topK=0 返回空数组', () => {
    const query = new Float32Array([1, 0])
    const candidates = [{ id: 1, embedding: new Float32Array([1, 0]) }]
    const result = searchSimilar(query, candidates, 0)
    expect(result).toHaveLength(0)
  })

  it('空候选集返回空数组', () => {
    const query = new Float32Array([1, 0])
    const result = searchSimilar(query, [], 5)
    expect(result).toHaveLength(0)
  })

  it('返回结果包含 id 和 score 字段', () => {
    const query = new Float32Array([1, 0])
    const candidates = [{ id: 42, embedding: new Float32Array([1, 0]) }]
    const result = searchSimilar(query, candidates, 1)
    expect(result[0].id).toBe(42)
    expect(typeof result[0].score).toBe('number')
  })

  it('相同向量 score=1', () => {
    const query = new Float32Array([1, 2, 3])
    const candidates = [{ id: 1, embedding: new Float32Array([1, 2, 3]) }]
    const result = searchSimilar(query, candidates, 1)
    expect(result[0].score).toBeCloseTo(1, 5)
  })
})

// ============ embed / embedBatch / isVectorSearchAvailable / preloadModel ============
// 这些函数依赖 Web Worker，需要通过 vi.doMock + 动态 import 控制 Worker 行为

describe('embed (Worker 集成)', () => {
  let mockWorker: {
    postMessage: ReturnType<typeof vi.fn>
    onmessage: ((e: MessageEvent) => void) | null
    onerror: ((e: ErrorEvent) => void) | null
    terminate: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.resetModules()
    mockWorker = {
      postMessage: vi.fn(),
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
    }
    vi.doMock('../vectorWorker?worker', () => ({
      default: vi.fn(function () { return mockWorker }),
    }))
  })

  it('空文本返回零向量（不调用 Worker）', async () => {
    const { embed } = await import('../vectorSearch')
    const result = await embed('')
    expect(result).toBeInstanceOf(Float32Array)
    expect(result.length).toBe(512)
    expect(mockWorker.postMessage).not.toHaveBeenCalled()
  })

  it('空白文本返回零向量', async () => {
    const { embed } = await import('../vectorSearch')
    const result = await embed('   ')
    expect(result.length).toBe(512)
    expect(mockWorker.postMessage).not.toHaveBeenCalled()
  })

  it('正常文本发送到 Worker 并返回嵌入向量', async () => {
    const { embed } = await import('../vectorSearch')
    const promise = embed('hello world')

    await vi.waitFor(() => expect(mockWorker.postMessage).toHaveBeenCalled())
    const msg = mockWorker.postMessage.mock.calls[0][0]
    expect(msg.type).toBe('embed')
    expect(msg.text).toBe('hello world')

    const embedding = new Float32Array(512).fill(0.5)
    mockWorker.onmessage!({ data: { id: msg.id, result: embedding } } as MessageEvent)

    const result = await promise
    expect(result).toBeInstanceOf(Float32Array)
    expect(result.length).toBe(512)
  })

  it('相同文本使用缓存（不重复调用 Worker）', async () => {
    const { embed } = await import('../vectorSearch')
    // 第一次调用
    const p1 = embed('cached text')
    await vi.waitFor(() => expect(mockWorker.postMessage).toHaveBeenCalledTimes(1))
    const msg1 = mockWorker.postMessage.mock.calls[0][0]
    mockWorker.onmessage!({ data: { id: msg1.id, result: new Float32Array(512) } } as MessageEvent)
    await p1

    // 第二次调用相同文本 → 应命中缓存
    const result = await embed('cached text')
    expect(mockWorker.postMessage).toHaveBeenCalledTimes(1) // 仍然只调用一次
    expect(result.length).toBe(512)
  })

  it('Worker 返回 error 时 reject', async () => {
    const { embed } = await import('../vectorSearch')
    const promise = embed('error text')

    await vi.waitFor(() => expect(mockWorker.postMessage).toHaveBeenCalled())
    const msg = mockWorker.postMessage.mock.calls[0][0]
    mockWorker.onmessage!({ data: { id: msg.id, error: 'model load failed' } } as MessageEvent)

    await expect(promise).rejects.toThrow('model load failed')
  })

  it('Worker onerror 时 reject 所有等待中的请求', async () => {
    const { embed } = await import('../vectorSearch')
    const promise = embed('will error')

    await vi.waitFor(() => expect(mockWorker.postMessage).toHaveBeenCalled())
    // 触发 worker error
    mockWorker.onerror!(new ErrorEvent('error', { message: 'Worker crashed' }))

    await expect(promise).rejects.toThrow()
  })
})

describe('embedBatch (Worker 集成)', () => {
  let mockWorker: {
    postMessage: ReturnType<typeof vi.fn>
    onmessage: ((e: MessageEvent) => void) | null
    onerror: ((e: ErrorEvent) => void) | null
    terminate: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.resetModules()
    mockWorker = {
      postMessage: vi.fn(),
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
    }
    vi.doMock('../vectorWorker?worker', () => ({
      default: vi.fn(function () { return mockWorker }),
    }))
  })

  it('空文本数组返回空数组', async () => {
    const { embedBatch } = await import('../vectorSearch')
    const results = await embedBatch([])
    expect(results).toHaveLength(0)
  })

  it('包含空文本的批次返回零向量', async () => {
    const { embedBatch } = await import('../vectorSearch')
    const promise = embedBatch(['', 'real text'])

    await vi.waitFor(() => expect(mockWorker.postMessage).toHaveBeenCalled())
    const msg = mockWorker.postMessage.mock.calls[0][0]
    expect(msg.type).toBe('embedBatch')
    expect(msg.texts).toEqual(['real text']) // 只发送非空文本

    const embeddings = [new Float32Array(512).fill(0.7)]
    mockWorker.onmessage!({ data: { id: msg.id, result: embeddings } } as MessageEvent)

    const results = await promise
    expect(results).toHaveLength(2)
    expect(results[0].length).toBe(512) // 空文本的零向量
    expect(results[1].length).toBe(512) // Worker 返回的向量
  })

  it('批量嵌入多条文本', async () => {
    const { embedBatch } = await import('../vectorSearch')
    const promise = embedBatch(['text1', 'text2', 'text3'])

    await vi.waitFor(() => expect(mockWorker.postMessage).toHaveBeenCalled())
    const msg = mockWorker.postMessage.mock.calls[0][0]
    expect(msg.texts).toHaveLength(3)

    const embeddings = [
      new Float32Array(512).fill(0.1),
      new Float32Array(512).fill(0.2),
      new Float32Array(512).fill(0.3),
    ]
    mockWorker.onmessage!({ data: { id: msg.id, result: embeddings } } as MessageEvent)

    const results = await promise
    expect(results).toHaveLength(3)
    expect(results[0]).toBe(embeddings[0])
    expect(results[1]).toBe(embeddings[1])
    expect(results[2]).toBe(embeddings[2])
  })

  it('已缓存的文本不发送到 Worker', async () => {
    const { embed, embedBatch } = await import('../vectorSearch')
    // 先缓存一条
    const p1 = embed('cached')
    await vi.waitFor(() => expect(mockWorker.postMessage).toHaveBeenCalledTimes(1))
    const msg1 = mockWorker.postMessage.mock.calls[0][0]
    mockWorker.onmessage!({ data: { id: msg1.id, result: new Float32Array(512) } } as MessageEvent)
    await p1

    // 批量嵌入，其中包含已缓存的
    const promise = embedBatch(['cached', 'new text'])
    await vi.waitFor(() => expect(mockWorker.postMessage).toHaveBeenCalledTimes(2))
    const msg2 = mockWorker.postMessage.mock.calls[1][0]
    expect(msg2.texts).toEqual(['new text']) // 'cached' 不再发送

    mockWorker.onmessage!({ data: { id: msg2.id, result: [new Float32Array(512)] } } as MessageEvent)
    const results = await promise
    expect(results).toHaveLength(2)
    expect(results[0].length).toBe(512) // 缓存的
    expect(results[1].length).toBe(512) // 新的
  })

  it('全部为空文本时不调用 Worker', async () => {
    const { embedBatch } = await import('../vectorSearch')
    const results = await embedBatch(['', '  ', ''])
    expect(results).toHaveLength(3)
    expect(mockWorker.postMessage).not.toHaveBeenCalled()
  })
})

describe('isVectorSearchAvailable', () => {
  let mockWorker: {
    postMessage: ReturnType<typeof vi.fn>
    onmessage: ((e: MessageEvent) => void) | null
    onerror: ((e: ErrorEvent) => void) | null
    terminate: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.resetModules()
    mockWorker = {
      postMessage: vi.fn(),
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
    }
    vi.doMock('../vectorWorker?worker', () => ({
      default: vi.fn(function () { return mockWorker }),
    }))
  })

  it('Worker 正常响应时返回 true', async () => {
    const { isVectorSearchAvailable } = await import('../vectorSearch')
    const promise = isVectorSearchAvailable()

    await vi.waitFor(() => expect(mockWorker.postMessage).toHaveBeenCalled())
    const msg = mockWorker.postMessage.mock.calls[0][0]
    mockWorker.onmessage!({ data: { id: msg.id, result: new Float32Array(512) } } as MessageEvent)

    expect(await promise).toBe(true)
  })

  it('Worker 返回错误时返回 false', async () => {
    const { isVectorSearchAvailable } = await import('../vectorSearch')
    const promise = isVectorSearchAvailable()

    await vi.waitFor(() => expect(mockWorker.postMessage).toHaveBeenCalled())
    const msg = mockWorker.postMessage.mock.calls[0][0]
    mockWorker.onmessage!({ data: { id: msg.id, error: 'model not loaded' } } as MessageEvent)

    expect(await promise).toBe(false)
  })

  it('Worker onerror 后返回 false 且标记 modelLoadFailed', async () => {
    const { isVectorSearchAvailable } = await import('../vectorSearch')
    const promise = isVectorSearchAvailable()

    await vi.waitFor(() => expect(mockWorker.postMessage).toHaveBeenCalled())
    mockWorker.onerror!(new ErrorEvent('error', { message: 'crash' }))

    expect(await promise).toBe(false)

    // modelLoadFailed 为 true 后，后续 embed 不会调用 Worker（直接抛错）
    // 再次调用 isVectorSearchAvailable 应直接返回 false
    const available = await isVectorSearchAvailable()
    expect(available).toBe(false)
  })
})

describe('preloadModel', () => {
  let mockWorker: {
    postMessage: ReturnType<typeof vi.fn>
    onmessage: ((e: MessageEvent) => void) | null
    onerror: ((e: ErrorEvent) => void) | null
    terminate: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.resetModules()
    mockWorker = {
      postMessage: vi.fn(),
      onmessage: null,
      onerror: null,
      terminate: vi.fn(),
    }
    vi.doMock('../vectorWorker?worker', () => ({
      default: vi.fn(function () { return mockWorker }),
    }))
  })

  it('预加载成功（不抛错）', async () => {
    const { preloadModel } = await import('../vectorSearch')
    const promise = preloadModel()

    await vi.waitFor(() => expect(mockWorker.postMessage).toHaveBeenCalled())
    const msg = mockWorker.postMessage.mock.calls[0][0]
    expect(msg.text).toBe('__preload__')
    mockWorker.onmessage!({ data: { id: msg.id, result: new Float32Array(512) } } as MessageEvent)

    await expect(promise).resolves.toBeUndefined()
  })

  it('预加载失败时静默忽略（不抛错）', async () => {
    const { preloadModel } = await import('../vectorSearch')
    const promise = preloadModel()

    await vi.waitFor(() => expect(mockWorker.postMessage).toHaveBeenCalled())
    const msg = mockWorker.postMessage.mock.calls[0][0]
    mockWorker.onmessage!({ data: { id: msg.id, error: 'model not found' } } as MessageEvent)

    await expect(promise).resolves.toBeUndefined()
  })
})
