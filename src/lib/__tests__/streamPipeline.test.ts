/**
 * streamPipeline 契约测试 — 4 层流式管道
 *
 * 测什么：
 * - streamPipeline：句子分割 → TextDelta、Think 内容 → TextDelta、StreamEnd 收尾
 * - displayLayer：onDisplay 回调仅对显示事件触发
 * - TTS 层（enableTTS=true）的行为（含已知缺陷，见 README）
 * - createPipelineWithStats：统计收集逻辑（直接喂原始事件）
 * - collectPipelineEvents：事件 + 统计打包
 *
 * SentenceDivider / ThinkTagParser 被 mock，聚焦管道编排本身，不测试句子/标签算法。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============ Mock 依赖（必须先于 import 源模块）============

const mockDivider = {
  push: vi.fn<(chunk: string) => unknown[]>(),
  flush: vi.fn(),
}

const mockParser = {
  push: vi.fn(),
  flush: vi.fn(),
  reset: vi.fn(),
}

vi.mock('../sentenceDivider', () => ({
  SentenceDivider: vi.fn(function () {
    return mockDivider
  }),
  getSentenceDivider: vi.fn(),
  resetSentenceDivider: vi.fn(),
  divideSentences: vi.fn(),
}))

vi.mock('../thinkTagParser', () => ({
  ThinkTagParser: vi.fn(function () {
    return mockParser
  }),
  ThinkTagState: { Inside: 'inside', Outside: 'outside' },
  THINK_TAG_PROMPT_FRAGMENT: '',
}))

import {
  streamPipeline,
  createPipelineWithStats,
  collectPipelineEvents,
  StreamEventType,
  type StreamEvent,
  type PipelineOptions,
} from '../streamPipeline'

/** 把 chunk 数组做成 async iterable */
async function* arraySource(chunks: string[]): AsyncIterable<string> {
  for (const c of chunks) yield c
}

/** 同步收集管道全部事件 */
async function collect(
  source: AsyncIterable<string>,
  options: PipelineOptions = {},
): Promise<StreamEvent[]> {
  const events: StreamEvent[] = []
  for await (const event of streamPipeline(source, options)) {
    events.push(event)
  }
  return events
}

/** 默认的 mock 返回：无 think、单句子、flush 无残留 */
function setupDefaults(): void {
  mockParser.push.mockReturnValue({
    state: 'outside',
    thinkContent: '',
    replyContent: '',
  })
  mockParser.flush.mockReturnValue({
    thinkContent: '',
    replyContent: '',
    state: 'outside',
  })
  mockDivider.push.mockReturnValue([])
  mockDivider.flush.mockReturnValue(null)
}

const SENTENCE = (text: string, index = 0) => ({
  text,
  isComplete: true,
  isFirstSentenceComma: false,
  index,
})

describe('streamPipeline — 基础句子流', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaults()
  })

  it('句子经 actionLayer 转为 TextDelta，末尾追加 StreamEnd', async () => {
    mockDivider.push.mockReturnValueOnce([SENTENCE('Hello'), SENTENCE('world', 1)])
    mockDivider.push.mockReturnValue([])
    const events = await collect(arraySource(['Hello', 'world']))

    const types = events.map((e) => e.type)
    expect(types).toEqual([StreamEventType.TextDelta, StreamEventType.TextDelta, StreamEventType.StreamEnd])
    expect(events[0].data).toBe('Hello')
    expect(events[1].data).toBe('world')
    expect(events[0].isThink).toBe(false)
  })

  it('首句标记 isFirst，后续句子 isFirst=false', async () => {
    mockDivider.push.mockReturnValue([SENTENCE('a', 0), SENTENCE('b', 1)])
    const events = await collect(arraySource(['ab']))
    expect(events[0].isFirst).toBe(true)
    expect(events[1].isFirst).toBe(false)
    expect(events[1].sentenceIndex).toBe(1)
  })

  it('flush 残留文本作为最后一个句子输出', async () => {
    mockDivider.push.mockReturnValue([SENTENCE('done', 0)])
    mockDivider.flush.mockReturnValue(SENTENCE('tail', 1))
    const events = await collect(arraySource(['done']))
    expect(events[0].data).toBe('done')
    expect(events[1].data).toBe('tail')
  })

  it('空 chunk 被跳过', async () => {
    mockDivider.push.mockReturnValue([SENTENCE('x', 0)])
    const events = await collect(arraySource(['', 'x']))
    // 空 chunk 不进 divider，只处理 'x'
    expect(mockDivider.push).toHaveBeenCalledTimes(1)
    expect(mockDivider.push).toHaveBeenCalledWith('x')
    expect(events[0].data).toBe('x')
  })

  it('无句子输出时仅返回 StreamEnd', async () => {
    const events = await collect(arraySource(['no sentence']))
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe(StreamEventType.StreamEnd)
    expect(events[0].data).toBe('')
  })
})

describe('streamPipeline — Think 内容处理', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaults()
  })

  it('think 标签内内容转为 TextDelta（半透明显示）', async () => {
    mockParser.push.mockReturnValue({
      state: 'inside',
      thinkContent: 'inner thought',
      replyContent: '',
    })
    mockDivider.push.mockReturnValue([])
    const events = await collect(arraySource(['<think>inner thought']))

    expect(events[0].type).toBe(StreamEventType.TextDelta)
    expect(events[0].data).toBe('inner thought')
    expect(events[0].isThink).toBe(true)
  })

  it('think 内内容不送句子分割器（continue 短路）', async () => {
    mockParser.push.mockReturnValue({
      state: 'inside',
      thinkContent: 'thinking',
      replyContent: '',
    })
    await collect(arraySource(['<think>thinking']))
    expect(mockDivider.push).not.toHaveBeenCalled()
  })
})

describe('streamPipeline — display 回调', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaults()
  })

  it('onDisplay 对每个 TextDelta 触发，且只触发一次', async () => {
    mockDivider.push.mockReturnValue([SENTENCE('a', 0), SENTENCE('b', 1)])
    const onDisplay = vi.fn()
    await collect(arraySource(['ab']), { onDisplay })
    expect(onDisplay).toHaveBeenCalledTimes(2)
    expect(onDisplay.mock.calls[0][0]).toMatchObject({
      type: StreamEventType.TextDelta,
      data: 'a',
    })
  })

  it('未提供 onDisplay 时静默运行', async () => {
    mockDivider.push.mockReturnValue([SENTENCE('a', 0)])
    const events = await collect(arraySource(['a']))
    expect(events[0].type).toBe(StreamEventType.TextDelta)
  })
})

describe('streamPipeline — TTS 层（已知缺陷）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaults()
  })

  it('【缺陷】enableTTS=true 时 ttsCallback 不会被调用', async () => {
    // 原因：actionLayer 生成的 TTSRequest 事件被 displayLayer 过滤，
    // 无法到达 ttsLayer。此测试锁定当前真实行为，修复后可改为断言回调被调用。
    mockDivider.push.mockReturnValue([SENTENCE('hello', 0)])
    const ttsCallback = vi.fn().mockResolvedValue(new ArrayBuffer(8))
    await collect(arraySource(['hello']), { enableTTS: true, ttsCallback })
    expect(ttsCallback).not.toHaveBeenCalled()
  })

  it('【缺陷】enableTTS=true 时不产出 TTSAudioReady 事件', async () => {
    mockDivider.push.mockReturnValue([SENTENCE('hello', 0)])
    const ttsCallback = vi.fn().mockResolvedValue(new ArrayBuffer(8))
    const events = await collect(arraySource(['hello']), {
      enableTTS: true,
      ttsCallback,
    })
    expect(events.some((e) => e.type === StreamEventType.TTSAudioReady)).toBe(false)
  })
})

describe('createPipelineWithStats — 统计逻辑（直接喂原始事件）', () => {
  let statsApi: ReturnType<typeof createPipelineWithStats>

  beforeEach(() => {
    vi.clearAllMocks()
    statsApi = createPipelineWithStats()
  })

  function evt(type: StreamEventType, data = '', extra: Partial<StreamEvent> = {}): StreamEvent {
    return {
      type,
      data,
      timestamp: 1000,
      ...extra,
    } as StreamEvent
  }

  it('统计 TextDelta 数量并记录首 chunk 时间', () => {
    statsApi.startTiming()
    statsApi.processEvent(evt(StreamEventType.TextDelta, 'a', { timestamp: 1000 }))
    statsApi.processEvent(evt(StreamEventType.TextDelta, 'b', { timestamp: 1100 }))
    const stats = statsApi.getStats()
    expect(stats.totalChunks).toBe(2)
  })

  it('统计句子数并计算首句延迟', () => {
    statsApi.startTiming()
    statsApi.processEvent(evt(StreamEventType.TextDelta, 'x', { timestamp: 1000 }))
    statsApi.processEvent(evt(StreamEventType.Sentence, 'hi', { timestamp: 1500 }))
    const stats = statsApi.getStats()
    expect(stats.totalSentences).toBe(1)
    expect(stats.firstSentenceLatencyMs).toBe(500)
  })

  it('统计 think 内容长度', () => {
    statsApi.startTiming()
    statsApi.processEvent(evt(StreamEventType.ThinkContent, 'inner'))
    const stats = statsApi.getStats()
    expect(stats.thinkContentLength).toBe('inner'.length)
  })

  it('统计 TTS 请求次数', () => {
    statsApi.startTiming()
    statsApi.processEvent(evt(StreamEventType.TTSRequest, 'text'))
    statsApi.processEvent(evt(StreamEventType.TTSRequest, 'text2'))
    const stats = statsApi.getStats()
    expect(stats.ttsRequestCount).toBe(2)
  })

  it('StreamEnd 记录总耗时', () => {
    statsApi.startTiming()
    statsApi.processEvent(evt(StreamEventType.StreamEnd, '', { timestamp: Date.now() }))
    const stats = statsApi.getStats()
    expect(stats.totalDurationMs).not.toBeNull()
    expect(typeof stats.totalDurationMs).toBe('number')
  })

  it('未调用 startTiming 时总耗时为 null', () => {
    statsApi.processEvent(evt(StreamEventType.StreamEnd, '', { timestamp: 2000 }))
    expect(statsApi.getStats().totalDurationMs).toBeNull()
  })

  it('getStats 返回副本而非引用', () => {
    const s1 = statsApi.getStats()
    s1.totalChunks = 999
    expect(statsApi.getStats().totalChunks).toBe(0)
  })
})

describe('collectPipelineEvents — 集成', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setupDefaults()
  })

  it('收集所有事件并返回统计', async () => {
    mockDivider.push.mockReturnValue([SENTENCE('a', 0), SENTENCE('b', 1)])
    const { events, stats } = await collectPipelineEvents(arraySource(['ab']))
    expect(events).toHaveLength(3) // 2 TextDelta + 1 StreamEnd
    expect(events[events.length - 1].type).toBe(StreamEventType.StreamEnd)
    // TextDelta 被计入 totalChunks
    expect(stats.totalChunks).toBe(2)
    expect(stats.totalDurationMs).not.toBeNull()
  })

  it('【缺陷】totalSentences 恒为 0（Sentence 已在管道内被转为 TextDelta）', async () => {
    mockDivider.push.mockReturnValue([SENTENCE('a', 0)])
    const { stats } = await collectPipelineEvents(arraySource(['a']))
    // 收集器期望 Sentence 事件，但管道输出的是 TextDelta，故句子数统计失效
    expect(stats.totalSentences).toBe(0)
  })
})
