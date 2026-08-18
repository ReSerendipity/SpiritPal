/**
 * sseUtils 契约测试 — SSE / 逐行 JSON 流解析
 *
 * 测什么：
 * - readTextStream 的 SSE 协议解析（data: 行、[DONE]、空行、注释行）
 * - raw_json 协议解析（整行 JSON）
 * - delta 提取（extractDelta）与终止判断（isTerminated）
 * - 跨 chunk 缓冲（不完整行保留到下一轮）
 * - onChunk 回调时序
 * - JSON 解析失败时的容错
 *
 * 不发起真实网络请求，使用 mock ReadableStream 喂入字节。
 */
import { describe, it, expect } from 'vitest'
import { readTextStream, type DeltaExtractor, type TerminationChecker } from '../sseUtils'

/** 将字符串数组编码为可读流，模拟 fetch response.body */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c))
      }
      controller.close()
    },
  })
}

/** 从 OpenAI 风格 choices[0].delta.content 提取文本 */
const extractOpenAIDelta: DeltaExtractor = (json) => {
  const obj = json as { choices?: Array<{ delta?: { content?: string } }> }
  return obj.choices?.[0]?.delta?.content ?? null
}

/** 从 Ollama 风格 message.content 提取文本 */
const extractOllamaDelta: DeltaExtractor = (json) => {
  const obj = json as { message?: { content?: string } }
  return obj.message?.content ?? null
}

const isOllamaDone: TerminationChecker = (json) =>
  (json as { done?: boolean }).done === true

describe('readTextStream — SSE 协议', () => {
  it('解析 data: 行并提取 delta', async () => {
    const body = streamFromChunks([
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" World"}}]}\n\n',
    ])
    const result = await readTextStream(
      body,
      { lineType: 'sse', extractDelta: extractOpenAIDelta },
    )
    expect(result).toBe('Hello World')
  })

  it('跳过非 data: 行（注释、事件名、空行）', async () => {
    const body = streamFromChunks([
      'event: message\n',
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      ': keep-alive\n',
      '\n',
    ])
    const result = await readTextStream(
      body,
      { lineType: 'sse', extractDelta: extractOpenAIDelta },
    )
    expect(result).toBe('Hi')
  })

  it('跳过 data: [DONE] 行但不终止流（仅丢弃该行，继续解析后续）', async () => {
    // 注意：readTextStream 对 [DONE] 只做跳过（continue），不提前返回。
    // 终止只能靠 isTerminated 回调，此为当前真实行为。
    const body = streamFromChunks([
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: [DONE]\n\n',
      'data: {"choices":[{"delta":{"content":" after"}}]}\n\n',
    ])
    const result = await readTextStream(
      body,
      { lineType: 'sse', extractDelta: extractOpenAIDelta },
    )
    expect(result).toBe('Hi after')
  })

  it('data: 后带空格时仍能正确裁剪', async () => {
    const body = streamFromChunks([
      'data:   {"choices":[{"delta":{"content":"padded"}}]}\n\n',
    ])
    const result = await readTextStream(
      body,
      { lineType: 'sse', extractDelta: extractOpenAIDelta },
    )
    expect(result).toBe('padded')
  })

  it('多行事件：一个事件的多个 data: 行各自独立解析', async () => {
    // SSE 规范中多 data: 行应拼接，但本实现每行独立解析，记录真实行为
    const body = streamFromChunks([
      'data: {"choices":[{"delta":{"content":"a"}}]}\n',
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n',
    ])
    const result = await readTextStream(
      body,
      { lineType: 'sse', extractDelta: extractOpenAIDelta },
    )
    expect(result).toBe('ab')
  })

  it('JSON 解析失败的行被跳过', async () => {
    const body = streamFromChunks([
      'data: {invalid json}\n\n',
      'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
    ])
    const result = await readTextStream(
      body,
      { lineType: 'sse', extractDelta: extractOpenAIDelta },
    )
    expect(result).toBe('ok')
  })

  it('isTerminated 命中后提前返回，不再消费后续内容', async () => {
    const body = streamFromChunks([
      'data: {"type":"content_block_delta","delta":{"text":"stop"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
      'data: {"type":"content_block_delta","delta":{"text":"ignored"}}\n\n',
    ])
    const extractClaude: DeltaExtractor = (json) =>
      (json as { delta?: { text?: string } }).delta?.text ?? null
    const isMessageStop: TerminationChecker = (json) =>
      (json as { type?: string }).type === 'message_stop'
    const result = await readTextStream(body, {
      lineType: 'sse',
      extractDelta: extractClaude,
      isTerminated: isMessageStop,
    })
    expect(result).toBe('stop')
  })

  it('跨 chunk 的行边界：不完整行保留到下一轮', async () => {
    const body = streamFromChunks([
      'data: {"choices":[{"delta":{"content":"He',
      'llo"}}]}\n\n',
    ])
    const result = await readTextStream(
      body,
      { lineType: 'sse', extractDelta: extractOpenAIDelta },
    )
    expect(result).toBe('Hello')
  })

  it('onChunk 回调按 delta 顺序逐次触发', async () => {
    const body = streamFromChunks([
      'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"y"}}]}\n\n',
    ])
    const seen: string[] = []
    await readTextStream(
      body,
      { lineType: 'sse', extractDelta: extractOpenAIDelta },
      (c) => seen.push(c),
    )
    expect(seen).toEqual(['x', 'y'])
  })

  it('空流返回空字符串', async () => {
    const body = streamFromChunks([])
    const result = await readTextStream(body, {
      lineType: 'sse',
      extractDelta: extractOpenAIDelta,
    })
    expect(result).toBe('')
  })
})

describe('readTextStream — raw_json 协议', () => {
  it('逐行解析 JSON 并提取 delta', async () => {
    const body = streamFromChunks([
      '{"message":{"content":"Hello"},"done":false}\n',
      '{"message":{"content":" Ollama"},"done":false}\n',
      '{"message":{"content":""},"done":true}\n',
    ])
    const result = await readTextStream(body, {
      lineType: 'raw_json',
      extractDelta: extractOllamaDelta,
      isTerminated: isOllamaDone,
    })
    expect(result).toBe('Hello Ollama')
  })

  it('done 信号触发 isTerminated，提前终止', async () => {
    const body = streamFromChunks([
      '{"message":{"content":"x"},"done":false}\n',
      '{"message":{"content":""},"done":true}\n',
      '{"message":{"content":"ignored"},"done":false}\n',
    ])
    const result = await readTextStream(body, {
      lineType: 'raw_json',
      extractDelta: extractOllamaDelta,
      isTerminated: isOllamaDone,
    })
    expect(result).toBe('x')
  })

  it('空 content 不触发 onChunk', async () => {
    const body = streamFromChunks([
      '{"message":{"content":""},"done":false}\n',
      '{"message":{"content":"real"},"done":true}\n',
    ])
    const seen: string[] = []
    await readTextStream(
      body,
      { lineType: 'raw_json', extractDelta: extractOllamaDelta, isTerminated: isOllamaDone },
      (c) => seen.push(c),
    )
    expect(seen).toEqual(['real'])
  })

  it('无 isTerminated 时读取到流结束', async () => {
    const body = streamFromChunks([
      '{"message":{"content":"a"},"done":false}\n',
      '{"message":{"content":"b"},"done":true}\n',
    ])
    const result = await readTextStream(body, {
      lineType: 'raw_json',
      extractDelta: extractOllamaDelta,
    })
    expect(result).toBe('ab')
  })
})

describe('readTextStream — 提取器边界', () => {
  it('extractDelta 返回 null 时不追加内容', async () => {
    const body = streamFromChunks([
      'data: {"type":"ping"}\n\n',
      'data: {"choices":[{"delta":{"content":"real"}}]}\n\n',
    ])
    const result = await readTextStream(body, {
      lineType: 'sse',
      extractDelta: extractOpenAIDelta,
    })
    expect(result).toBe('real')
  })

  it('extractDelta 返回空字符串时不触发 onChunk', async () => {
    const alwaysEmpty: DeltaExtractor = () => ''
    const body = streamFromChunks(['data: {"a":1}\n\n'])
    const seen: string[] = []
    await readTextStream(
      body,
      { lineType: 'sse', extractDelta: alwaysEmpty },
      (c) => seen.push(c),
    )
    expect(seen).toEqual([])
  })

  it('单 chunk 内多行一次性解析', async () => {
    const body = streamFromChunks([
      'data: {"choices":[{"delta":{"content":"1"}}]}\ndata: {"choices":[{"delta":{"content":"2"}}]}\ndata: {"choices":[{"delta":{"content":"3"}}]}\n\n',
    ])
    const result = await readTextStream(body, {
      lineType: 'sse',
      extractDelta: extractOpenAIDelta,
    })
    expect(result).toBe('123')
  })
})
