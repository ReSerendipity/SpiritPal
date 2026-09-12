// STT 引擎单元测试 — Web Speech API 主路径 + Whisper 可选后端
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { STTEngine, isSpeechRecognitionSupported, transcribeWithWhisper } from '@/lib/ai/stt'

// Whisper 网络层隔离：mock safeFetch（与 ttsEngine.test.ts 一致）
vi.mock('@/lib/system/ssrfProtection', () => ({
  safeFetch: vi.fn(),
}))
import { safeFetch } from '@/lib/system/ssrfProtection'
const mockSafeFetch = vi.mocked(safeFetch)

// ============ Mock SpeechRecognition ============

interface FakeResult {
  transcript: string
  isFinal: boolean
}

class MockRecognition {
  static last: MockRecognition | null = null
  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 0
  onresult: ((e: { resultIndex: number; results: FakeResult[] }) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn()
  abort = vi.fn()
  constructor() {
    MockRecognition.last = this
  }
  fireResult(results: FakeResult[], resultIndex = 0) {
    this.onresult?.({ resultIndex, results })
  }
  fireError(error: string) {
    this.onerror?.({ error })
  }
  fireEnd() {
    this.onend?.()
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  MockRecognition.last = null
  Object.defineProperty(window, 'SpeechRecognition', {
    value: MockRecognition,
    writable: true,
    configurable: true,
  })
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition
})

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).SpeechRecognition
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition
})

describe('isSpeechRecognitionSupported', () => {
  it('SpeechRecognition 存在时返回 true', () => {
    expect(isSpeechRecognitionSupported()).toBe(true)
  })

  it('仅 webkitSpeechRecognition 存在时也返回 true', () => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      value: MockRecognition,
      writable: true,
      configurable: true,
    })
    expect(isSpeechRecognitionSupported()).toBe(true)
  })

  it('两者都不存在时返回 false', () => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition
    expect(isSpeechRecognitionSupported()).toBe(false)
  })
})

describe('STTEngine（浏览器实时识别）', () => {
  it('start() 配置默认参数并启动识别', () => {
    const engine = new STTEngine()
    engine.start({}, {})
    expect(MockRecognition.last).not.toBeNull()
    expect(MockRecognition.last!.lang).toBe('zh-CN')
    expect(MockRecognition.last!.continuous).toBe(true)
    expect(MockRecognition.last!.interimResults).toBe(true)
    expect(engine.isActive()).toBe(true)
  })

  it('中间结果实时回调，定稿后触发 onFinal', () => {
    const onPartial = vi.fn()
    const onFinal = vi.fn()
    const engine = new STTEngine()
    engine.start({ onPartial, onFinal })
    const rec = MockRecognition.last!
    // 中间结果
    rec.fireResult([{ transcript: '你好', isFinal: false }])
    expect(onPartial).toHaveBeenLastCalledWith('你好')
    // 定稿
    rec.fireResult([{ transcript: '你好世界', isFinal: true }])
    expect(onPartial).toHaveBeenLastCalledWith('你好世界')
    expect(onFinal).toHaveBeenCalledWith('你好世界')
  })

  it('连续模式下多句话文本累加', () => {
    const onPartial = vi.fn()
    const engine = new STTEngine()
    engine.start({ onPartial })
    const rec = MockRecognition.last!
    rec.fireResult([{ transcript: '第一句', isFinal: true }])
    rec.fireResult([{ transcript: '第二句', isFinal: false }])
    expect(onPartial).toHaveBeenLastCalledWith('第一句第二句')
  })

  it('非 aborted 错误触发 onError 并给出可读文案', () => {
    const onError = vi.fn()
    const engine = new STTEngine()
    engine.start({ onError })
    MockRecognition.last!.fireError('not-allowed')
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('麦克风权限'))
  })

  it('aborted 错误（用户主动停止）不触发 onError', () => {
    const onError = vi.fn()
    const engine = new STTEngine()
    engine.start({ onError })
    MockRecognition.last!.fireError('aborted')
    expect(onError).not.toHaveBeenCalled()
  })

  it('onEnd 后 active 复位', () => {
    const onEnd = vi.fn()
    const engine = new STTEngine()
    engine.start({ onEnd })
    expect(engine.isActive()).toBe(true)
    MockRecognition.last!.fireEnd()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(engine.isActive()).toBe(false)
  })

  it('stop() 调用底层 recognition.stop()', () => {
    const engine = new STTEngine()
    engine.start({})
    engine.stop()
    expect(MockRecognition.last!.stop).toHaveBeenCalledTimes(1)
  })

  it('不支持环境下 start() 抛出明确错误', () => {
    delete (window as unknown as Record<string, unknown>).SpeechRecognition
    const engine = new STTEngine()
    expect(() => engine.start({})).toThrow(/不支持/)
    expect(engine.isSupported()).toBe(false)
  })
})

describe('transcribeWithWhisper（可选后端）', () => {
  it('缺少 API Key 时直接拒绝', async () => {
    await expect(
      transcribeWithWhisper(new Blob(['a']), { apiKey: '' }),
    ).rejects.toThrow(/API Key/)
  })

  it('成功时返回清洗后的文本', async () => {
    mockSafeFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ text: '  识别结果  ' }),
    } as Response)
    const text = await transcribeWithWhisper(new Blob(['a']), { apiKey: 'sk-test' })
    expect(text).toBe('识别结果')
    expect(mockSafeFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockSafeFetch.mock.calls[0]!
    expect(String(url)).toContain('audio/transcriptions')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk-test')
  })

  it('HTTP 非 2xx 时抛出可读错误', async () => {
    mockSafeFetch.mockResolvedValueOnce({ ok: false, status: 401 } as Response)
    await expect(
      transcribeWithWhisper(new Blob(['a']), { apiKey: 'sk-test' }),
    ).rejects.toThrow(/HTTP 401/)
  })
})
