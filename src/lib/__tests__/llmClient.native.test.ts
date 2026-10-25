import { invoke } from '@tauri-apps/api/core'
import { listen, type Event } from '@tauri-apps/api/event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LLMClient } from '@/lib/ai/llmClient'
import type { MessageMetrics } from '@/lib/data/types'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }))
vi.mock('@/lib/system/platform', () => ({ isMobileRuntime: () => true }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

type Subscription = {
  event: string
  handler: (event: Event<unknown>) => void
  active: boolean
  unlisten: ReturnType<typeof vi.fn<() => void>>
}
type Outcome = { value: string } | { error: unknown }
const tokenEvent = 'ondevice://token'
const doneEvent = 'ondevice://done'
const messages = [{ id: 'native-user', role: 'user' as const, content: 'hello', timestamp: 0 }]
let subscriptions: Subscription[]
let setupGates: Map<string, ReturnType<typeof deferred<void>>>
let generation: ReturnType<typeof deferred<void>>
let launched: ReturnType<typeof deferred<Record<string, unknown>>>
let commands: { command: string; args: unknown }[]

// Drain the event turn while the controlled native invoke stays pending.
const flushEvents = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

function startChat(onChunk?: (text: string) => void, onProgress?: (metrics: MessageMetrics) => void) {
  const client = new LLMClient({
    provider: 'ondevice',
    baseUrl: '',
    apiKey: '',
    model: 'qwen3.5-2b',
    temperature: 0.5,
    maxTokens: 100,
  })
  const controller = new AbortController()
  const chunks: string[] = []
  const progress: MessageMetrics[] = []
  const outcomes: Outcome[] = []
  const task = client
    .chat(
      messages,
      (text) => {
        chunks.push(text)
        onChunk?.(text)
      },
      controller.signal,
      (metrics) => {
        progress.push(metrics)
        onProgress?.(metrics)
      },
    )
    .then(
      (value) => {
        outcomes.push({ value })
      },
      (error) => {
        outcomes.push({ error })
      },
    )
  return { client, controller, chunks, progress, outcomes, task }
}

function eventFor(subscription: Subscription, sessionId: string, text?: string): Event<unknown> {
  return {
    event: subscription.event,
    id: subscriptions.indexOf(subscription),
    payload: text === undefined ? { sessionId } : { sessionId, text },
  }
}

function emit(event: string, sessionId: string, text?: string) {
  for (const subscription of subscriptions.filter((item) => item.event === event && item.active)) {
    subscription.handler(eventFor(subscription, sessionId, text))
  }
}

function expectCleaned() {
  expect(subscriptions.every((item) => !item.active)).toBe(true)
  for (const subscription of subscriptions) expect(subscription.unlisten).toHaveBeenCalledTimes(1)
}

beforeEach(() => {
  subscriptions = []
  setupGates = new Map()
  generation = deferred<void>()
  launched = deferred<Record<string, unknown>>()
  commands = []
  vi.mocked(listen).mockReset()
  vi.mocked(invoke).mockReset()
  vi.mocked(listen).mockImplementation(async (event, handler) => {
    const subscription: Subscription = {
      event,
      handler,
      active: false,
      unlisten: vi.fn(() => {
        subscription.active = false
      }),
    }
    subscriptions.push(subscription)
    await setupGates.get(event)?.promise
    subscription.active = true
    return subscription.unlisten
  })
  vi.mocked(invoke).mockImplementation((command, args) => {
    commands.push({ command, args })
    if (command === 'ondevice_generate') {
      launched.resolve(args as Record<string, unknown>)
      return generation.promise
    }
    if (command === 'ondevice_cancel') return Promise.resolve()
    throw new Error(`Unexpected native command: ${command}`)
  })
})

afterEach(async () => {
  for (const gate of setupGates.values()) gate.resolve()
  generation.resolve()
  await flushEvents()
  vi.restoreAllMocks()
})

describe('native generation lifecycle', () => {
  it.each([tokenEvent, doneEvent])('abort during %s setup rejects without launching generation', async (event) => {
    const gate = deferred<void>()
    setupGates.set(event, gate)
    const call = startChat()
    await flushEvents()
    expect(subscriptions.some((item) => item.event === event)).toBe(true)
    call.controller.abort()
    await flushEvents()
    // UI must be released even if listen itself has not finished yet.
    expect(call.outcomes).toEqual([{ error: call.controller.signal.reason }])
    gate.resolve()
    await flushEvents()
    expect(commands.filter((item) => item.command === 'ondevice_generate')).toHaveLength(0)
    expectCleaned()
    expect(call.client.lastCallMetrics?.status).toBe('aborted')
  })

  it('cleans the token listener when done listener setup fails', async () => {
    const gate = deferred<void>()
    const failure = new Error('done listener unavailable')
    setupGates.set(doneEvent, gate)
    const call = startChat()
    await flushEvents()
    gate.reject(failure)
    await call.task
    expect(call.outcomes).toEqual([{ error: failure }])
    expect(subscriptions[0]?.active).toBe(false)
    expect(subscriptions[0]?.unlisten).toHaveBeenCalledTimes(1)
    expect(commands).toEqual([])
    expect(call.client.lastCallMetrics?.status).toBe('failed')
  })

  it.each(['chunk', 'progress'])('rejects and cancels immediately when the %s consumer throws', async (consumer) => {
    const failure = new Error('consumer failed')
    const call = startChat(
      consumer === 'chunk'
        ? () => {
            throw failure
          }
        : undefined,
      consumer === 'progress'
        ? (metrics) => {
            if (metrics.status === 'streaming' && metrics.firstTextMs !== undefined) throw failure
          }
        : undefined,
    )
    const { sessionId } = await launched.promise
    expect(() => emit(tokenEvent, String(sessionId), 'partial')).not.toThrow()
    await flushEvents()
    expect(call.outcomes).toEqual([{ error: failure }])
    expect(call.chunks).toEqual(['partial'])
    expect(commands.filter((item) => item.command === 'ondevice_cancel')).toEqual([
      { command: 'ondevice_cancel', args: { sessionId } },
    ])
    expectCleaned()
    expect(call.client.lastCallMetrics).toMatchObject({ status: 'failed', firstTextMs: expect.any(Number) })
    // A native failure after cancellation must still have a rejection handler.
    generation.reject(new Error('late native rejection'))
    await flushEvents()
    expect(call.outcomes).toHaveLength(1)
  })

  it.each(['resolve', 'reject'])(
    'abort settles once and ignores late tokens while invoke later %ss',
    async (outcome) => {
      const call = startChat()
      const { sessionId } = await launched.promise
      const token = subscriptions.find((item) => item.event === tokenEvent)!
      emit(tokenEvent, String(sessionId), 'partial')
      call.controller.abort()
      // Simulate an already-queued Tauri callback, even after unlisten.
      expect(() => token.handler(eventFor(token, String(sessionId), 'late'))).not.toThrow()
      await flushEvents()
      expect(call.outcomes).toEqual([{ error: call.controller.signal.reason }])
      expectCleaned()
      const terminalCount = call.progress.filter((metrics) => metrics.status !== 'streaming').length
      expect(terminalCount).toBe(1)
      expect(commands.filter((item) => item.command === 'ondevice_cancel')).toEqual([
        { command: 'ondevice_cancel', args: { sessionId } },
      ])
      if (outcome === 'resolve') generation.resolve()
      else generation.reject(new Error('late native rejection'))
      await flushEvents()
      expect(() => token.handler(eventFor(token, String(sessionId), 'later'))).not.toThrow()
      expect(call.outcomes).toHaveLength(1)
      expect(call.chunks).toEqual(['partial'])
      expect(call.progress.filter((metrics) => metrics.status !== 'streaming')).toHaveLength(terminalCount)
      expect(call.client.lastCallMetrics).toMatchObject({ status: 'aborted', firstTextMs: expect.any(Number) })
      expectCleaned()
    },
  )

  it('done ends tokens but invoke rejection remains authoritative', async () => {
    const call = startChat()
    const { sessionId } = await launched.promise
    const token = subscriptions.find((item) => item.event === tokenEvent)!
    emit(tokenEvent, String(sessionId), 'partial')
    emit(doneEvent, String(sessionId))
    expect(() => token.handler(eventFor(token, String(sessionId), 'late'))).not.toThrow()
    await flushEvents()
    expect(call.outcomes).toEqual([])
    const failure = new Error('native generation failed')
    generation.reject(failure)
    await call.task
    expect(call.outcomes).toEqual([{ error: failure }])
    expect(call.chunks).toEqual(['partial'])
    expect(call.client.lastCallMetrics?.status).toBe('failed')
    expectCleaned()
  })

  it('returns every matching token on success and ignores terminal callbacks', async () => {
    const call = startChat()
    const args = await launched.promise
    const { sessionId } = args
    expect(args).toEqual({
      modelId: 'qwen3.5-2b',
      sessionId: expect.any(String),
      prompt: 'user: hello',
      paramsJson: '{}',
    })
    const token = subscriptions.find((item) => item.event === tokenEvent)!
    const done = subscriptions.find((item) => item.event === doneEvent)!
    emit(tokenEvent, 'another-session', 'wrong')
    emit(doneEvent, 'another-session')
    emit(tokenEvent, String(sessionId), 'hello')
    emit(tokenEvent, String(sessionId), ' world')
    emit(doneEvent, String(sessionId))
    generation.resolve()
    await call.task
    expect(call.outcomes).toEqual([{ value: 'hello world' }])
    expect(() => token.handler(eventFor(token, String(sessionId), 'late'))).not.toThrow()
    expect(() => done.handler(eventFor(done, String(sessionId)))).not.toThrow()
    call.controller.abort()
    expect(call.chunks).toEqual(['hello', ' world'])
    expect(call.client.lastCallMetrics?.status).toBe('completed')
    expect(commands.filter((item) => item.command === 'ondevice_cancel')).toEqual([])
    expectCleaned()
  })

  it('cleans listeners when invoke succeeds without a delivered done event', async () => {
    const call = startChat()
    const { sessionId } = await launched.promise
    emit(tokenEvent, String(sessionId), 'answer')
    generation.resolve()
    await call.task
    expect(call.outcomes).toEqual([{ value: 'answer' }])
    expectCleaned()
  })

  it('keeps abort active after done while invoke is pending', async () => {
    const call = startChat()
    const { sessionId } = await launched.promise
    emit(tokenEvent, String(sessionId), 'answer')
    emit(doneEvent, String(sessionId))
    call.controller.abort()
    await flushEvents()
    expect(call.outcomes).toEqual([{ error: call.controller.signal.reason }])
    expect(commands.filter((item) => item.command === 'ondevice_cancel')).toEqual([
      { command: 'ondevice_cancel', args: { sessionId } },
    ])
    expectCleaned()
  })
})
