// TTS 引擎适配器单元测试 — 浏览器原生 + API TTS
// P3-23: 语音交互（TTS/ASR）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createBrowserTTSGenerate,
  createBrowserTTSPlay,
  createApiTTSGenerate,
  createApiTTSPlay,
  TTSEngineManager,
  getTTSEngineManager,
  type TTSEngineConfig,
} from '../ttsEngine'
import type { TTSAudioData } from '../ttsTaskManager'

// ============ Mock SpeechSynthesis ============

const mockSpeak = vi.fn()
const mockCancel = vi.fn()
const mockGetVoices = vi.fn(() => [])

beforeEach(() => {
  // Mock speechSynthesis
  Object.defineProperty(globalThis, 'speechSynthesis', {
    value: {
      speak: mockSpeak,
      cancel: mockCancel,
      getVoices: mockGetVoices,
      pending: false,
      speaking: false,
      paused: false,
    },
    writable: true,
    configurable: true,
  })

  // Mock SpeechSynthesisUtterance
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', {
    value: class MockUtterance {
      text: string
      rate = 1
      pitch = 1
      volume = 1
      lang = 'zh-CN'
      voice: SpeechSynthesisVoice | null = null
      onend: (() => void) | null = null
      onerror: ((event: { error: string }) => void) | null = null
      constructor(text: string) {
        this.text = text
        // 自动触发 onend（模拟即时完成）
        setTimeout(() => this.onend?.(), 0)
      }
    },
    writable: true,
    configurable: true,
  })
})

afterEach(() => {
  vi.clearAllMocks()
})

// ============ 浏览器原生 TTS 测试 ============

describe('createBrowserTTSGenerate', () => {
  it('生成语音时调用 speechSynthesis.speak', async () => {
    const config: TTSEngineConfig = { engine: 'browser', rate: 1.0, pitch: 1.0, volume: 0.8, lang: 'zh-CN' }
    const generate = createBrowserTTSGenerate(config)
    const result = await generate('你好世界')
    expect(mockSpeak).toHaveBeenCalled()
    expect(result.durationMs).toBeGreaterThan(0)
  })

  it('设置正确的语音参数', async () => {
    const config: TTSEngineConfig = { engine: 'browser', rate: 1.5, pitch: 0.8, volume: 0.5, lang: 'zh-CN' }
    const generate = createBrowserTTSGenerate(config)
    await generate('测试')
    const utterance = mockSpeak.mock.calls[0][0]
    expect(utterance.rate).toBe(1.5)
    expect(utterance.pitch).toBe(0.8)
    expect(utterance.volume).toBe(0.5)
  })

  it('计算合理的时长估算', async () => {
    const config: TTSEngineConfig = { engine: 'browser', rate: 1.0, pitch: 1.0, volume: 1.0, lang: 'zh-CN' }
    const generate = createBrowserTTSGenerate(config)
    const result = await generate('这是一段比较长的文本，用来测试时长估算')
    // 中文约 4 字/秒，18 字约 4.5 秒
    expect(result.durationMs).toBeGreaterThanOrEqual(500)
  })
})

describe('createBrowserTTSPlay', () => {
  it('播放函数不抛错', async () => {
    const play = createBrowserTTSPlay()
    const audio: TTSAudioData = { url: '', durationMs: 10 }
    // 使用短时长避免测试过慢
    await expect(play(audio)).resolves.toBeUndefined()
  })
})

// ============ API TTS 测试 ============

describe('createApiTTSGenerate', () => {
  it('缺少端点时抛出错误', async () => {
    const config: TTSEngineConfig = { engine: 'api', rate: 1.0, pitch: 1.0, volume: 1.0, lang: 'zh-CN' }
    const generate = createApiTTSGenerate(config)
    await expect(generate('测试')).rejects.toThrow('apiEndpoint')
  })

  it('正确发送 API 请求', async () => {
    const mockBlob = new Blob(['audio data'], { type: 'audio/wav' })
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      blob: () => Promise.resolve(mockBlob),
    })
    vi.stubGlobal('fetch', mockFetch)

    const config: TTSEngineConfig = {
      engine: 'api',
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      lang: 'zh-CN',
      apiEndpoint: 'https://tts.example.com/api/generate',
      apiKey: 'test-key',
      speakerId: 'female-1',
    }
    const generate = createApiTTSGenerate(config)
    const result = await generate('你好')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://tts.example.com/api/generate',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer test-key',
        }),
      }),
    )
    expect(result.url).toBeTruthy()
    expect(result.durationMs).toBeGreaterThan(0)

    vi.restoreAllMocks()
  })

  it('API 错误时抛出异常', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    })
    vi.stubGlobal('fetch', mockFetch)

    const config: TTSEngineConfig = {
      engine: 'api',
      rate: 1.0,
      pitch: 1.0,
      volume: 1.0,
      lang: 'zh-CN',
      apiEndpoint: 'https://tts.example.com/api/generate',
    }
    const generate = createApiTTSGenerate(config)
    await expect(generate('你好')).rejects.toThrow('500')

    vi.restoreAllMocks()
  })
})

describe('createApiTTSPlay', () => {
  it('空 URL 时立即返回', async () => {
    const play = createApiTTSPlay()
    const audio: TTSAudioData = { url: '', durationMs: 0 }
    await expect(play(audio)).resolves.toBeUndefined()
  })
})

// ============ TTSEngineManager 测试 ============

describe('TTSEngineManager', () => {
  it('默认未启用', () => {
    const mgr = new TTSEngineManager()
    expect(mgr.isEnabled()).toBe(false)
  })

  it('启用后可用', () => {
    const mgr = new TTSEngineManager()
    mgr.enable()
    expect(mgr.isEnabled()).toBe(true)
  })

  it('禁用后不可用', () => {
    const mgr = new TTSEngineManager()
    mgr.enable()
    mgr.disable()
    expect(mgr.isEnabled()).toBe(false)
  })

  it('更新配置', () => {
    const mgr = new TTSEngineManager()
    mgr.updateConfig({ rate: 2.0, lang: 'en-US' })
    const config = mgr.getConfig()
    expect(config.rate).toBe(2.0)
    expect(config.lang).toBe('en-US')
  })

  it('未启用时 speak 返回 null', () => {
    const mgr = new TTSEngineManager()
    expect(mgr.speak('你好')).toBeNull()
  })

  it('isSupported 检测', () => {
    // 我们在 beforeEach 中 mock 了 speechSynthesis
    expect(TTSEngineManager.isSupported()).toBe(true)
  })
})

describe('getTTSEngineManager 单例', () => {
  it('返回同一实例', () => {
    const a = getTTSEngineManager()
    const b = getTTSEngineManager()
    expect(a).toBe(b)
  })
})
