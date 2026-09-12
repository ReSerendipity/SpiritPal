// VOICEVOX TTS 引擎单元测试 — API 调用流程（mock safeFetch）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 与既有 ttsEngine.test.ts 一致：mock 网络层，不 stub 全局 fetch/URL
vi.mock('@/lib/system/ssrfProtection', () => ({
  safeFetch: vi.fn(),
  getSSRFProtector: vi.fn(),
  resetSSRFProtector: vi.fn(),
}))

import { safeFetch } from '@/lib/system/ssrfProtection'
import {
  TTSEngine,
  VoicevoxEngineError,
  DEFAULT_VOICEVOX_URL,
  type Speaker,
} from '@/lib/ai/tts'

const mockSafeFetch = vi.mocked(safeFetch)

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

function blobResponse(blob: Blob, ok = true, status = 200): Response {
  return {
    ok,
    status,
    blob: () => Promise.resolve(blob),
  } as unknown as Response
}

beforeEach(() => {
  mockSafeFetch.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('TTSEngine.isEngineAvailable', () => {
  it('引擎在线（/version 200）返回 true', async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse({ version: '0.20.0' }))
    const engine = new TTSEngine()
    await expect(engine.isEngineAvailable()).resolves.toBe(true)
    expect(mockSafeFetch).toHaveBeenCalledWith(
      `${DEFAULT_VOICEVOX_URL}/version`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('HTTP 非 2xx 返回 false', async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse({}, false, 500))
    await expect(new TTSEngine().isEngineAvailable()).resolves.toBe(false)
  })

  it('网络异常（引擎未启动）返回 false 而不抛错', async () => {
    mockSafeFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await expect(new TTSEngine().isEngineAvailable()).resolves.toBe(false)
  })
})

describe('TTSEngine.getSpeakers', () => {
  const speakers: Speaker[] = [
    {
      name: 'ずんだもん',
      speaker_uuid: 'uuid-1',
      styles: [{ name: 'あまあま', id: 1 }],
    },
    {
      name: '春日部つむぎ',
      speaker_uuid: 'uuid-2',
      styles: [
        { name: 'ノーマル', id: 8 },
        { name: 'かわいい', id: 9 },
      ],
    },
  ]

  it('返回解析后的声优列表', async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse(speakers))
    const result = await new TTSEngine().getSpeakers()
    expect(result).toHaveLength(2)
    expect(result[1]?.styles).toHaveLength(2)
    expect(mockSafeFetch).toHaveBeenCalledWith(`${DEFAULT_VOICEVOX_URL}/speakers`)
  })

  it('HTTP 错误抛出带状态码的 VoicevoxEngineError', async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse({}, false, 404))
    const err = await new TTSEngine().getSpeakers().catch((e) => e)
    expect(err).toBeInstanceOf(VoicevoxEngineError)
    expect((err as VoicevoxEngineError).status).toBe(404)
  })
})

describe('TTSEngine.synthesize', () => {
  const queryJson = { accent_phrases: [], speedScale: 1 }

  it('依次调用 /audio_query 与 /synthesis 并返回 wav Blob', async () => {
    const wav = new Blob(['wav-bytes'], { type: 'audio/wav' })
    mockSafeFetch
      .mockResolvedValueOnce(jsonResponse(queryJson))
      .mockResolvedValueOnce(blobResponse(wav))

    const engine = new TTSEngine()
    const result = await engine.synthesize('你好世界')

    // 第一步：audio_query，文本经 encodeURIComponent，speaker 默认 1
    const [queryUrl, queryOpts] = mockSafeFetch.mock.calls[0]!
    expect(queryUrl).toContain('/audio_query?')
    expect(queryUrl).toContain('text=' + encodeURIComponent('你好世界'))
    expect(queryUrl).toContain('speaker=1')
    expect(queryOpts?.method).toBe('POST')

    // 第二步：synthesis，body 为 audio_query JSON，Content-Type 正确
    const [synthUrl, synthOpts] = mockSafeFetch.mock.calls[1]!
    expect(synthUrl).toBe(`${DEFAULT_VOICEVOX_URL}/synthesis?speaker=1`)
    expect(synthOpts?.method).toBe('POST')
    expect((synthOpts?.headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(synthOpts?.body as string)).toEqual(queryJson)

    expect(result).toBe(wav)
  })

  it('支持自定义 speakerId 透传到两次调用', async () => {
    mockSafeFetch
      .mockResolvedValueOnce(jsonResponse(queryJson))
      .mockResolvedValueOnce(blobResponse(new Blob()))

    await new TTSEngine().synthesize('测试', 8)
    const [queryUrl] = mockSafeFetch.mock.calls[0]!
    expect(queryUrl).toContain('speaker=8')
    const [synthUrl] = mockSafeFetch.mock.calls[1]!
    expect(synthUrl).toContain('speaker=8')
  })

  it('空文本直接拒绝，不发起网络请求', async () => {
    await expect(new TTSEngine().synthesize('   ')).rejects.toBeInstanceOf(VoicevoxEngineError)
    expect(mockSafeFetch).not.toHaveBeenCalled()
  })

  it('audio_query 失败时抛出带状态码错误', async () => {
    mockSafeFetch.mockResolvedValueOnce(jsonResponse({}, false, 422))
    const err = await new TTSEngine().synthesize('坏文本').catch((e) => e)
    expect(err).toBeInstanceOf(VoicevoxEngineError)
    expect((err as VoicevoxEngineError).status).toBe(422)
    expect(mockSafeFetch).toHaveBeenCalledTimes(1)
  })

  it('synthesis 失败时抛出带状态码错误', async () => {
    mockSafeFetch
      .mockResolvedValueOnce(jsonResponse(queryJson))
      .mockResolvedValueOnce(blobResponse(new Blob(), false, 500))
    const err = await new TTSEngine().synthesize('你好').catch((e) => e)
    expect(err).toBeInstanceOf(VoicevoxEngineError)
    expect((err as VoicevoxEngineError).status).toBe(500)
  })
})

describe('TTSEngine.setEngineUrl', () => {
  it('更新后所有请求打到新地址（自动去除末尾斜杠）', async () => {
    const engine = new TTSEngine('http://127.0.0.1:50021/')
    engine.setEngineUrl('http://192.168.1.10:50021/')
    expect(engine.getEngineUrl()).toBe('http://192.168.1.10:50021')

    mockSafeFetch.mockResolvedValueOnce(jsonResponse({ version: '1' }))
    await engine.isEngineAvailable()
    expect(mockSafeFetch).toHaveBeenCalledWith(
      'http://192.168.1.10:50021/version',
      expect.anything(),
    )
  })
})
