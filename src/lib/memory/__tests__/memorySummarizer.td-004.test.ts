// memorySummarizer TD-004 测试 — 真接 LLM、置信度可解释、增量不丢历史
//
// 覆盖：
// ① 无凭据时走启发式（不再有 500ms 假延迟，source='heuristic'，confidence 落在 0.65 以内）；
// ② 注入可用 LLM 时真的调用 chat()、prompt 含记忆正文，source='llm'，confidence 高于启发式；
// ③ LLM 抛错 → 兜底 source='fallback'，confidence ≤ 0.55；LLM 返回空串同样降级（不缓存空摘要）；
// ④ 缓存命中：同批记忆第二次调用不再打 LLM；
// ⑤ 增量：新记忆 id 全部已知 → 零调用直接返回旧摘要；有新 id → 旧摘要进上下文、文本显式拼接不丢历史、
//    memoryCount 与 memoryIds 按并集增长。
import { describe, it, expect, beforeEach } from 'vitest'
import {
  MemorySummarizer,
  collectMemoryIds,
  computeConfidence,
  isLlmAvailable,
  resetMemorySummarizer,
  type SummaryLLM,
  type SummarizableMemory,
} from '@/lib/memory/memorySummarizer'

function mem(id: string, user: string, created = '2026-11-01T10:00:00Z'): SummarizableMemory {
  return { id, created_at: created, user, assistant: '（回复）' }
}

/** 可用 LLM（ondevice 无需 apiKey）；reply 传数组时按调用顺序依次返回 */
function fakeLlm(reply: string | Error | Array<string | Error> = '模型生成的摘要'): SummaryLLM & { calls: string[] } {
  const calls: string[] = []
  const queue: Array<string | Error> = Array.isArray(reply) ? [...reply] : [reply]
  return {
    calls,
    async chat(messages) {
      calls.push(messages[0]?.content ?? '')
      const r: string | Error = queue.length > 1 ? (queue.shift() as string | Error) : queue[0]
      if (r instanceof Error) throw r
      return r
    },
    getConfig: () => ({ provider: 'ondevice', apiKey: '', baseUrl: '', model: 'qwen', temperature: 0.5, maxTokens: 512 }),
  }
}

/** 无凭据的远程 provider */
function unconfiguredLlm(): SummaryLLM & { calls: string[] } {
  const llm = fakeLlm('不应被调用')
  llm.getConfig = () => ({ provider: 'deepseek', apiKey: '', baseUrl: '', model: 'x', temperature: 0.5, maxTokens: 512 })
  return llm
}

describe('isLlmAvailable', () => {
  it('ondevice 无需 apiKey；远程 provider 必须有 key', () => {
    expect(isLlmAvailable({ provider: 'ondevice', apiKey: '', baseUrl: '', model: '', temperature: 0, maxTokens: 0 })).toBe(true)
    expect(isLlmAvailable({ provider: 'deepseek', apiKey: '', baseUrl: '', model: '', temperature: 0, maxTokens: 0 })).toBe(false)
    expect(isLlmAvailable({ provider: 'deepseek', apiKey: '  sk-1  ', baseUrl: '', model: '', temperature: 0, maxTokens: 0 })).toBe(true)
    expect(isLlmAvailable(null)).toBe(false)
  })
})

describe('computeConfidence（不再硬编码 0.85）', () => {
  it('三档上限各不相同，且随覆盖度提升', () => {
    const one = [mem('1', '短句')]
    const six = Array.from({ length: 6 }, (_, i) => mem(`s${i}`, '这是一段长度接近四十字的记忆正文，用来把密度分量拉满，避免因为文本太短而低估'))

    const llmLow = computeConfidence(one, '摘要', 'llm')
    const llmHigh = computeConfidence(six, '摘'.repeat(300), 'llm')
    expect(llmHigh).toBeGreaterThan(llmLow)
    expect(llmHigh).toBeLessThanOrEqual(0.95)

    expect(computeConfidence(six, '摘'.repeat(300), 'heuristic')).toBeLessThanOrEqual(0.65)
    expect(computeConfidence(six, '摘'.repeat(300), 'fallback')).toBeLessThanOrEqual(0.55)
    // 一律远离旧的 0.85 常量
    expect(llmLow).not.toBe(0.85)
  })
})

describe('MemorySummarizer.summarize', () => {
  beforeEach(() => {
    resetMemorySummarizer()
  })

  it('无凭据时走启发式：source=heuristic、置信度 ≤0.65、且不做 500ms 假等待', async () => {
    const llm = unconfiguredLlm()
    const s = new MemorySummarizer(undefined, { llm })
    const started = Date.now()

    const out = await s.summarize([mem('1', '今天在改渲染管线'), mem('2', '顺手修了一个尺寸 bug')])

    const elapsed = Date.now() - started
    expect(elapsed).toBeLessThan(400) // 旧实现固定 sleep 500ms
    expect(llm.calls).toHaveLength(0) // 没凭据就不要发请求
    expect(out.source).toBe('heuristic')
    expect(out.confidence).toBeLessThanOrEqual(0.65)
    expect(out.text).toContain('今天在改渲染管线')
    expect(out.memoryIds).toEqual(['1', '2'])
  })

  it('注入可用 LLM 时真的调用一次 chat，prompt 含记忆正文', async () => {
    const llm = fakeLlm('主人这两段都在处理渲染相关的事')
    const s = new MemorySummarizer(undefined, { llm })

    const out = await s.summarize([mem('1', '今天在改渲染管线'), mem('2', '修了一个尺寸 bug')])

    expect(llm.calls).toHaveLength(1)
    expect(llm.calls[0]).toContain('今天在改渲染管线')
    expect(out.source).toBe('llm')
    expect(out.text).toBe('主人这两段都在处理渲染相关的事')
    expect(out.confidence).toBeGreaterThan(0.6)
    expect(out.confidence).toBeLessThanOrEqual(0.95)
  })

  it('LLM 抛错时兜底，source=fallback 且置信度 ≤0.55', async () => {
    const llm = fakeLlm(new Error('401 unauthorized'))
    const s = new MemorySummarizer(undefined, { llm })

    const out = await s.summarize([mem('1', '随便说说')])

    expect(out.source).toBe('fallback')
    expect(out.confidence).toBeLessThanOrEqual(0.55)
    expect(out.text.length).toBeGreaterThan(0)
  })

  it('LLM 返回空串按失败处理（否则会缓存一条空摘要）', async () => {
    const llm = fakeLlm('   ')
    const s = new MemorySummarizer(undefined, { llm })

    const out = await s.summarize([mem('1', '有内容的记忆')])

    expect(out.source).toBe('fallback')
    expect(out.text).toContain('有内容的记忆')
  })

  it('同批记忆第二次调用命中缓存，不再打 LLM', async () => {
    const llm = fakeLlm('缓存测试')
    const s = new MemorySummarizer(undefined, { llm })
    const batch = [mem('1', 'a'), mem('2', 'b')]

    const first = await s.summarize(batch)
    const second = await s.summarize(batch)

    expect(llm.calls).toHaveLength(1)
    expect(second.generatedAt).toBe(first.generatedAt)
  })

  it('空记忆返回确定性的空摘要', async () => {
    const s = new MemorySummarizer(undefined, { llm: null })
    const out = await s.summarize([])
    expect(out.memoryCount).toBe(0)
    expect(out.confidence).toBe(1)
    expect(out.text).toBe('暂无记忆内容')
  })
})

describe('incrementallyUpdateSummary（真增量，不丢历史）', () => {
  beforeEach(() => {
    resetMemorySummarizer()
  })

  it('新记忆 id 全部已知 → 零 LLM 调用、原样返回旧摘要', async () => {
    const llm = fakeLlm('不该被调用')
    const s = new MemorySummarizer(undefined, { llm })
    const base = await s.summarize([mem('1', '旧内容')])

    const out = await s.incrementallyUpdateSummary(base, [mem('1', '旧内容')] as never)

    expect(llm.calls).toHaveLength(1) // 只有最初那次 summarize
    expect(out).toBe(base)
  })

  it('有新记忆时旧摘要进上下文，正文显式拼接而不是覆盖', async () => {
    const llm = fakeLlm(['历史摘要正文', '新增部分摘要'])
    const s = new MemorySummarizer(undefined, { llm })
    const base = await s.summarize([mem('1', '旧内容：在写渲染')])

    const out = await s.incrementallyUpdateSummary(base, [mem('2', '新内容：补测试')] as never)

    expect(base.text).toBe('历史摘要正文')
    expect(llm.calls).toHaveLength(2)
    expect(llm.calls[1]).toContain('已有摘要')
    expect(llm.calls[1]).toContain('历史摘要正文') // 旧摘要进了上下文
    expect(llm.calls[1]).toContain('新内容：补测试') // 新记忆正文也在
    expect(out.text).toContain('历史摘要正文') // 历史保留
    expect(out.text).toContain('新增部分摘要') // 增量补上
    expect(out.memoryCount).toBe(2)
    expect(out.memoryIds).toEqual(['1', '2'])
    expect(out.generatedAt).toBeGreaterThanOrEqual(base.generatedAt)
  })

  it('无 id 体系时按条目数量保守判断：新数组为空就跳过', async () => {
    const llm = fakeLlm('x')
    const s = new MemorySummarizer(undefined, { llm })
    const noId = [{ created_at: '2026-11-01T10:00:00Z', user: 'a', assistant: 'b' }]
    const base = await s.summarize(noId)

    const out = await s.incrementallyUpdateSummary(base, [] as never)
    expect(out).toBe(base)
    expect(llm.calls).toHaveLength(1)
  })

  it('collectMemoryIds 去重并丢弃空 id', () => {
    expect(collectMemoryIds([mem('1', 'a'), mem('1', 'b'), mem('', 'c')])).toEqual(['1'])
  })
})
