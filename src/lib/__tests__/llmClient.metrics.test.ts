import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LLMClient, fetchWithTimeout, generateCharacterFromDescription } from '@/lib/ai/llmClient'
import { safeFetch } from '@/lib/system/ssrfProtection'

vi.mock('@/lib/system/ssrfProtection', () => ({ safeFetch: vi.fn() }))
vi.mock('@/lib/ai/llmProviders', () => ({ recordUsage: vi.fn(), OLLAMA_TAGS_URL: 'http://localhost:11434/api/tags' }))
const messages = [{ id: 'test-user', role: 'user' as const, content: 'synthetic test', timestamp: 0 }]
const makeClient = (provider = 'custom') =>
  new LLMClient({
    provider,
    baseUrl: 'https://chat.invalid/v1',
    apiKey: '',
    model: 'fixture',
    temperature: 0.5,
    maxTokens: 100,
  })
const response = (events: unknown[], raw = false) =>
  new Response(
    new ReadableStream({
      start(controller) {
        for (const event of events)
          controller.enqueue(new TextEncoder().encode(`${raw ? '' : 'data: '}${JSON.stringify(event)}\n\n`))
        controller.close()
      },
    }),
  )
beforeEach(() => {
  vi.mocked(safeFetch).mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('reply-only semantic consumers', () => {
  it.each([
    ['structured reasoning', { reasoning_content: 'consider', content: 'happy' }, 'happy'],
    ['explicit tags', { content: '<think>consider</think>happy' }, 'happy'],
    ['bare closing tag', { content: 'consider</think>happy' }, 'happy'],
    ['unfinished reasoning', { reasoning_content: 'consider' }, ''],
    ['trailing partial tag text', { content: '<think>consider</think>answer<' }, 'answer<'],
  ])('chatOnce returns the final reply for %s', async (_name, delta, expected) => {
    vi.mocked(safeFetch).mockResolvedValue(response([{ choices: [{ delta }] }]))
    expect(await makeClient().chatOnce(messages)).toBe(expected)
  })

  it('selectEmotion selects happy without matching structured reasoning', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      response([
        { choices: [{ delta: { reasoning_content: 'consider' } }] },
        { choices: [{ delta: { content: 'happy' } }] },
      ]),
    )
    expect(await makeClient().selectEmotion('good news', ['sad', 'happy'])).toBe('happy')
  })

  it('extractMemories parses the reply JSON rather than a rejected reasoning draft', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      response([
        { choices: [{ delta: { reasoning_content: '["incorrect draft"]' } }] },
        { choices: [{ delta: { content: '["correct memory"]' } }] },
      ]),
    )
    expect(await makeClient().extractMemories('remember this')).toEqual(['correct memory'])
  })

  it('character generation parses the reply JSON rather than reasoning JSON', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      response([
        { choices: [{ delta: { reasoning_content: '{"name":"wrong draft"}' } }] },
        { choices: [{ delta: { content: '{"name":"correct character"}' } }] },
      ]),
    )
    const character = await generateCharacterFromDescription('a companion', makeClient().getConfig())
    expect(character.name).toBe('correct character')
  })
})

describe('provider metrics and reasoning', () => {
  it('keeps caller cancellation connected after HTTP headers arrive', async () => {
    const controller = new AbortController()
    let transportSignal: AbortSignal | null | undefined
    vi.mocked(safeFetch).mockImplementation(async (_url, init) => {
      transportSignal = init?.signal
      return response([])
    })
    await fetchWithTimeout('https://chat.invalid/v1', { signal: controller.signal })
    expect(transportSignal?.aborted).toBe(false)
    controller.abort()
    expect(transportSignal?.aborted).toBe(true)
  })

  it('requests OpenAI usage and separates structured reasoning from answer', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      response([
        { choices: [{ delta: { reasoning_content: 'consider' } }] },
        { choices: [{ delta: { content: 'answer' } }] },
        {
          choices: [],
          usage: {
            prompt_tokens: 90,
            completion_tokens: 20,
            prompt_tokens_details: { cached_tokens: 30 },
            completion_tokens_details: { reasoning_tokens: 5 },
          },
        },
      ]),
    )
    const client = makeClient()
    const chunks: string[] = []
    const progress: unknown[] = []
    expect(
      await client.chat(
        messages,
        (chunk) => chunks.push(chunk),
        undefined,
        (value) => progress.push(value),
      ),
    ).toBe('<think>consider</think>answer')
    const body = JSON.parse(String(vi.mocked(safeFetch).mock.calls[0]?.[1]?.body))
    expect(body.stream_options).toEqual({ include_usage: true })
    expect(chunks.join('')).toBe('<think>consider</think>answer')
    expect(client.lastCallMetrics).toMatchObject({
      promptTokens: 90,
      completionTokens: 20,
      cachedInputTokens: 30,
      reasoningTokens: 5,
      status: 'completed',
      usageSource: 'reported',
    })
    expect(progress.length).toBeGreaterThan(1)
  })

  it('merges Claude message_start input with message_delta output without zeroing input', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      response([
        {
          type: 'message_start',
          message: { usage: { input_tokens: 88, output_tokens: 1, cache_read_input_tokens: 12 } },
        },
        { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'plan' } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'answer' } },
        { type: 'message_delta', usage: { output_tokens: 10 } },
        { type: 'message_stop' },
      ]),
    )
    const client = makeClient('claude')
    expect(await client.chat(messages)).toBe('<think>plan</think>answer')
    expect(client.lastCallMetrics).toMatchObject({ promptTokens: 100, completionTokens: 10, cachedInputTokens: 12 })
  })

  it('marks Gemini thought parts separately and includes reported thinking in total output', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      response([
        {
          candidates: [{ content: { parts: [{ text: 'plan', thought: true }, { text: 'answer' }] } }],
          usageMetadata: {
            promptTokenCount: 20,
            candidatesTokenCount: 7,
            thoughtsTokenCount: 3,
            cachedContentTokenCount: 4,
          },
        },
      ]),
    )
    const client = makeClient('gemini')
    expect(await client.chat(messages)).toBe('<think>plan</think>answer')
    expect(client.lastCallMetrics).toMatchObject({
      promptTokens: 20,
      completionTokens: 10,
      reasoningTokens: 3,
      cachedInputTokens: 4,
    })
  })

  it('derives Ollama input/output server rates only from corresponding server durations', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      response(
        [
          { message: { content: 'answer' } },
          {
            done: true,
            prompt_eval_count: 20,
            eval_count: 10,
            prompt_eval_duration: 1_000_000_000,
            eval_duration: 2_000_000_000,
          },
        ],
        true,
      ),
    )
    const client = makeClient('ollama')
    await client.chat(messages)
    expect(client.lastCallMetrics).toMatchObject({
      promptTokens: 20,
      completionTokens: 10,
      inputTokensPerSec: 20,
      serverOutputTokensPerSec: 5,
    })
  })

  it('does not turn a streamed provider error into an empty successful response', async () => {
    vi.mocked(safeFetch).mockResolvedValue(response([{ error: { message: 'synthetic provider failure' } }]))
    const client = makeClient()
    await expect(client.chat(messages)).rejects.toThrow('synthetic provider failure')
    expect(client.lastCallMetrics?.status).toBe('failed')
  })

  it('does not substitute zero for missing or invalid usage', async () => {
    vi.mocked(safeFetch).mockResolvedValue(
      response([
        { choices: [{ delta: { content: 'answer' } }], usage: { prompt_tokens: -10, completion_tokens: '20' } },
      ]),
    )
    const client = makeClient()
    await client.chat(messages)
    expect(client.lastCallMetrics?.promptTokens).toBeUndefined()
    expect(client.lastCallMetrics?.completionTokens).toBeUndefined()
    expect(client.lastCallMetrics?.usageSource).toBe('unavailable')
  })

  it('keeps unknown input unknown when only output usage exists', async () => {
    vi.mocked(safeFetch).mockResolvedValue(response([{ usage: { completion_tokens: 0 } }]))
    const client = makeClient()
    await client.chat(messages)
    expect(client.lastCallMetrics?.promptTokens).toBeUndefined()
    expect(client.lastCallMetrics?.completionTokens).toBe(0)
  })

  it('aborts an in-progress body without converting partial text into success', async () => {
    const controller = new AbortController()
    let cancelled = false
    vi.mocked(safeFetch).mockResolvedValue(
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n'))
          },
          cancel() {
            cancelled = true
          },
        }),
      ),
    )
    const client = makeClient()
    await expect(client.chat(messages, () => controller.abort(), controller.signal)).rejects.toBeDefined()
    expect(cancelled).toBe(true)
    expect(client.lastCallMetrics?.status).toBe('aborted')
  })

  it('does not retry after a user abort during a failed request', async () => {
    const controller = new AbortController()
    vi.mocked(safeFetch).mockImplementation(async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    const client = makeClient()
    const outcome = await client.chat(messages, undefined, controller.signal).then(
      () => 'completed',
      () => 'aborted',
    )
    expect(outcome).toBe('aborted')
    expect(vi.mocked(safeFetch).mock.calls).toHaveLength(1)
    expect(client.lastCallMetrics?.status).toBe('aborted')
  })
})
