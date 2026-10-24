import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatMetricsRecorder } from '@/lib/ai/chatMetrics'

afterEach(() => vi.restoreAllMocks())

describe('per-request chat metrics', () => {
  it('separates first model output, first visible text and client-observed throughput', () => {
    let clock = 100
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    vi.spyOn(Date, 'now').mockReturnValue(10_000)
    const recorder = new ChatMetricsRecorder({ model: 'test-model', provider: 'custom' })
    clock = 500
    recorder.observe('<think>planning</think>')
    clock = 1000
    recorder.observe('hello')
    clock = 2000
    recorder.observe(' world')
    clock = 3000
    expect(recorder.snapshot({ input: 40, output: 30, reasoning: 5 }, 'completed')).toMatchObject({
      promptTokens: 40,
      completionTokens: 30,
      reasoningTokens: 5,
      requestStartTs: 10_000,
      responseEndTs: 12_900,
      durationMs: 2900,
      ttftMs: 400,
      firstTextMs: 900,
      generationMs: 1500,
      tokensPerSec: 20,
      usageSource: 'reported',
      status: 'completed',
    })
  })

  it('does not invent counts or rates without provider usage or multiple output chunks', () => {
    const recorder = new ChatMetricsRecorder({ model: 'test-model', provider: 'custom' })
    recorder.observe('entire response')
    const metrics = recorder.snapshot(null, 'completed')
    expect(metrics.promptTokens).toBeUndefined()
    expect(metrics.completionTokens).toBeUndefined()
    expect(metrics.tokensPerSec).toBeUndefined()
    expect(metrics.inputTokensPerSec).toBeUndefined()
    expect(metrics.usageSource).toBe('unavailable')
  })

  it('preserves genuine zero usage but never derives prefill rate from TTFT', () => {
    const recorder = new ChatMetricsRecorder({ model: 'test-model', provider: 'custom' })
    recorder.observe('answer')
    const metrics = recorder.snapshot({ input: 0, output: 0 }, 'completed')
    expect(metrics.promptTokens).toBe(0)
    expect(metrics.completionTokens).toBe(0)
    expect(metrics.usageSource).toBe('reported')
    expect(metrics.inputTokensPerSec).toBeUndefined()
  })

  it('treats zero usage reported on an interrupted request as unavailable, not real consumption', () => {
    const recorder = new ChatMetricsRecorder({ model: 'test-model', provider: 'custom' })
    recorder.observe('partial')
    const metrics = recorder.snapshot({ input: 0, output: 0 }, 'aborted')
    expect(metrics.promptTokens).toBeUndefined()
    expect(metrics.completionTokens).toBeUndefined()
    expect(metrics.usageSource).toBe('unavailable')
  })

  it('ignores protocol-only chunks and uses monotonic time despite wall-clock jumps', () => {
    let clock = 50
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const wall = vi.spyOn(Date, 'now').mockReturnValue(5000)
    const recorder = new ChatMetricsRecorder({ model: 'test-model', provider: 'custom' })
    recorder.observe('<think>')
    expect(recorder.snapshot(null, 'streaming').ttftMs).toBeUndefined()
    clock = 250
    wall.mockReturnValue(1000)
    recorder.observe('reason')
    const metrics = recorder.snapshot(null, 'aborted')
    expect(metrics.durationMs).toBe(200)
    expect(metrics.ttftMs).toBe(200)
    expect(metrics.firstTextMs).toBeUndefined()
    expect(metrics.status).toBe('aborted')
  })

  it('invalidates premature visible-text timing when bare closing think reclassifies earlier output', () => {
    let clock = 0
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const recorder = new ChatMetricsRecorder({ model: 'test-model', provider: 'ondevice' })
    clock = 100
    recorder.observe('planning')
    clock = 400
    recorder.observe('</think>answer')
    expect(recorder.snapshot(null, 'completed').firstTextMs).toBe(400)
  })
})
