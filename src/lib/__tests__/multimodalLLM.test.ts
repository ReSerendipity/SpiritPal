/**
 * @file multimodalLLM.test.ts
 * @description 多模态 LLM 模块单测 —— 图片处理 / 视觉客户端 / 视觉感知管理器
 *
 * TD-002（2026-11-08）之前这批用例断言的是**桩行为**，现随实现重写，逐条原因记在
 * `docs/TECH_DEBT.md` 的 TD-002 状态列（避免被误读成「为了变绿改断言」）：
 * - 「无凭据时走启发式降级、返回含『我收到了一张图片』的描述」→ 现断言 `unavailable` + 点名 apiKey，
 *   并显式断言旧假文案不再出现（旧断言断的正是 bug 本身）；
 * - 「超限时打 console.error」→ 现断言返回 `error` + `image-read-failed`，错误不靠日志传递；
 * - 「chatWithImage 返回启发式回复」→ 现断言注入 requester 时返回模型原文；
 * - 「batch 失败项 description = '分析失败'」→ 现断言 `error` 状态 + 原因点名（不再伪造描述文本）；
 * - 「未启用时 analyzeScreenshot 抛错」→ 现断言 `unavailable` 三态之一，调用方无需 try/catch。
 *
 * 三条硬约束（防「测试自己偷偷联网」）：
 * 1. `@/lib/ai/llmClient` 整体 mock —— 任何走到真实 LLMClient 的回退都会让本文件报错；
 * 2. `fs/promises` 整体 mock —— 不读真实磁盘；
 * 3. 注入 fake requester 时断言 `getLLMClient` 一次都没被调用。
 */
import { readFile, stat } from 'fs/promises'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  ImageProcessor,
  VisionLLMClient,
  VisualPerceptionManager,
  createTauriScreenshotProvider,
  detectImageMime,
  getVisualPerceptionManager,
  resetVisualPerceptionManager,
  type ImagePayload,
  type ScreenshotProvider,
  type VisionLLMRequest,
  type VisionLLMRequester,
} from '@/lib/ai/multimodalLLM'
import type { AIConfig as AIConfigType } from '@/lib/data/types'

const { llmClientMock } = vi.hoisted(() => ({
  llmClientMock: {
    getLLMClient: vi.fn(() => ({
      chat: vi.fn(async () => {
        throw new Error('测试禁止走真实 LLMClient.chat()')
      }),
      getConfig: () => ({ provider: 'openai', apiKey: 'should-not-be-used' }),
    })),
    DEFAULT_AI_CONFIG: { provider: 'deepseek', apiKey: '', baseUrl: '', model: '', temperature: 0.7, maxTokens: 512 },
  },
}))
vi.mock('@/lib/ai/llmClient', () => llmClientMock)

const { mockFs } = vi.hoisted(() => ({
  mockFs: () => {
    const readFileFn = vi.fn(async () => Buffer.from('hello'))
    const statFn = vi.fn(async () => ({ size: 1024 }))
    return { readFile: readFileFn, stat: statFn, default: { readFile: readFileFn, stat: statFn } }
  },
}))
vi.mock('node:fs/promises', mockFs)
vi.mock('fs/promises', mockFs)

const mockReadFile = vi.mocked(readFile)
const mockStat = vi.mocked(stat)
type StatsLike = Awaited<ReturnType<typeof stat>>

/** 远程 provider 的典型配置（只用于构造，不会真发请求） */
function makeConfig(over: Partial<AIConfigType> = {}): AIConfigType {
  return {
    provider: 'openai',
    apiKey: 'sk-test',
    baseUrl: 'https://api.example.com',
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 1024,
    ...over,
  }
}

/** 模型返回的合法结构化 JSON（由 fake requester 扮演模型） */
const VALID_JSON = JSON.stringify({
  description: '一张桌面截图，左侧是编辑器，右下角是终端',
  objects: [
    { name: '编辑器', confidence: 0.9 },
    { name: '终端', confidence: 0.7 },
  ],
  sceneCategory: 'screenshot',
})

/** 真 PNG 签名 + 一点载荷（magic byte 判定用） */
const PNG_PREFIX = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const pngBytes = () => Buffer.concat([PNG_PREFIX, Buffer.from('hello')])
/** 真 JPEG 签名 */
const jpegBytes = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('hello')])

function makeRequester(reply: string = VALID_JSON, supportsImageInput = true) {
  const chat = vi.fn(async (_req: VisionLLMRequest) => reply)
  const requester: VisionLLMRequester = {
    supportsImageInput,
    unsupportedDetail: supportsImageInput ? undefined : '测试：该 provider 协议承载不了图像',
    chat,
  }
  return { requester, chat }
}

const SHOT: ImagePayload = { base64: 'c2NyZWVuc2hvdA==', mimeType: 'image/png' }

beforeEach(() => {
  vi.clearAllMocks()
  mockReadFile.mockResolvedValue(Buffer.from('hello'))
  mockStat.mockResolvedValue({ size: 1024 } as unknown as StatsLike)
})
afterEach(() => {
  vi.restoreAllMocks()
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
})

// ============ ImageProcessor ============

describe('ImageProcessor', () => {
  const proc = new ImageProcessor()

  it('readImagePayload 按 magic byte 给出 png MIME', async () => {
    mockReadFile.mockResolvedValue(pngBytes())

    const payload = await proc.readImagePayload('/tmp/a.png')

    expect(payload.mimeType).toBe('image/png')
    expect(payload.base64).toBe(pngBytes().toString('base64'))
  })

  it('readImagePayload 忽略错误扩展名（文件名 .jpg 但字节是 PNG）', async () => {
    mockReadFile.mockResolvedValue(pngBytes())

    const payload = await proc.readImagePayload('/tmp/shot.jpg')

    // 旧实现固定 guessMimeType('jpeg')，这里证明字节优先
    expect(payload.mimeType).toBe('image/png')
  })

  it('readImagePayload 认不出字节时按扩展名兜底', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('hello'))

    const payload = await proc.readImagePayload('/tmp/photo.webp')

    expect(payload.mimeType).toBe('image/webp')
  })

  it('readImagePayload 字节与扩展名都不认识时报错（不猜 jpeg）', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('hello'))

    await expect(proc.readImagePayload('/tmp/file.xyz')).rejects.toThrow('无法识别的图片格式')
  })

  it('readImagePayload 超过 5MB 时抛错且不读盘', async () => {
    mockStat.mockResolvedValue({ size: 6 * 1024 * 1024 } as unknown as StatsLike)

    await expect(proc.readImagePayload('/tmp/big.png')).rejects.toThrow('图片过大')
    expect(mockStat).toHaveBeenCalledTimes(1)
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('readImageAsBase64 返回 base64', async () => {
    mockReadFile.mockResolvedValue(jpegBytes())

    const b64 = await proc.readImageAsBase64('/tmp/a.jpeg')

    expect(b64).toBe(jpegBytes().toString('base64'))
  })

  it('getImageStats 归一 jpg/jpeg 并保留未知扩展名', async () => {
    mockStat.mockResolvedValue({ size: 2048 } as unknown as StatsLike)

    expect((await proc.getImageStats('/tmp/a.jpg')).format).toBe('jpeg')
    expect((await proc.getImageStats('/tmp/a.jpeg')).format).toBe('jpeg')
    expect((await proc.getImageStats('/tmp/file.xyz')).format).toBe('xyz')
  })

  it('buildDataUri 拼 data URI', () => {
    expect(proc.buildDataUri('abc', 'image/png')).toBe('data:image/png;base64,abc')
  })

  it('guessMimeType 已知格式精确、未知格式兜底 jpeg', () => {
    expect(proc.guessMimeType('png')).toBe('image/png')
    expect(proc.guessMimeType('webp')).toBe('image/webp')
    expect(proc.guessMimeType('gif')).toBe('image/gif')
    expect(proc.guessMimeType('bmp')).toBe('image/jpeg')
  })
})

// ============ detectImageMime ============

describe('detectImageMime', () => {
  it('识别 png / jpeg / gif87a / gif89a / webp', () => {
    expect(detectImageMime(pngBytes())).toBe('image/png')
    expect(detectImageMime(jpegBytes())).toBe('image/jpeg')
    expect(detectImageMime(Buffer.from('GIF87a...'))).toBe('image/gif')
    expect(detectImageMime(Buffer.from('GIF89a...'))).toBe('image/gif')
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WEBP')])
    expect(detectImageMime(webp)).toBe('image/webp')
  })

  it('RIFF 但不是 WEBP（如 wav）不误判', () => {
    const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0x00, 0x00, 0x00]), Buffer.from('WAVE')])
    expect(detectImageMime(wav)).toBeNull()
  })

  it('空字节 / 纯文本返回 null', () => {
    expect(detectImageMime(new Uint8Array(0))).toBeNull()
    expect(detectImageMime(Buffer.from('hello world'))).toBeNull()
  })
})

// ============ VisionLLMClient ============

describe('VisionLLMClient', () => {
  it('注入 requester 时 analyzeImage 返回真实解析结果，且不碰默认 LLMClient', async () => {
    mockReadFile.mockResolvedValue(pngBytes())
    const { requester, chat } = makeRequester()
    const client = new VisionLLMClient(makeConfig(), { requester })

    const outcome = await client.analyzeImage('/tmp/a.png')

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.result.description).toBe('一张桌面截图，左侧是编辑器，右下角是终端')
    expect(outcome.result.objects).toHaveLength(2)
    expect(outcome.result.sceneCategory).toBe('screenshot')
    expect(outcome.raw).toBe(VALID_JSON)
    expect(chat).toHaveBeenCalledTimes(1)
    expect(llmClientMock.getLLMClient).not.toHaveBeenCalled()

    const request = chat.mock.calls[0][0]
    expect(request.image.mimeType).toBe('image/png')
    expect(request.prompt).toContain('JSON 字段')
  })

  it('无凭据时报 unavailable 并点名 apiKey（不伪造描述）', async () => {
    const { requester, chat } = makeRequester()
    const client = new VisionLLMClient(makeConfig({ apiKey: '' }), { requester })

    const outcome = await client.analyzeImage('/tmp/a.png')

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') throw new Error('unreachable')
    expect(outcome.reason).toBe('llm-missing-credentials')
    expect(outcome.detail).toContain('apiKey')
    expect(chat).not.toHaveBeenCalled()
    expect(Object.prototype.hasOwnProperty.call(outcome, 'result')).toBe(false)
  })

  it('ondevice 免凭据（本地模型）', async () => {
    mockReadFile.mockResolvedValue(pngBytes())
    const { requester } = makeRequester()
    const client = new VisionLLMClient(makeConfig({ provider: 'ondevice', apiKey: '' }), { requester })

    expect(client.getAvailability().available).toBe(true)
    expect((await client.analyzeImage('/tmp/a.png')).status).toBe('ok')
  })

  it('协议承载不了图像时 unavailable，且不发请求（协议判定先于凭据）', async () => {
    const { requester, chat } = makeRequester(VALID_JSON, false)
    const client = new VisionLLMClient(makeConfig({ provider: 'ollama', apiKey: '' }), { requester })

    const outcome = await client.analyzeImage('/tmp/a.png')

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') throw new Error('unreachable')
    // ollama 本地不需要 key，真实卡点是协议，故不能被报成「缺凭据」
    expect(outcome.reason).toBe('provider-cannot-send-image')
    expect(outcome.detail).toContain('承载不了图像')
    expect(chat).not.toHaveBeenCalled()
  })

  it('requester 为 null 时 unavailable（显式「没有」，不回退默认）', async () => {
    const client = new VisionLLMClient(makeConfig(), { requester: null })

    const outcome = await client.analyzeImage('/tmp/a.png')

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') throw new Error('unreachable')
    expect(outcome.reason).toBe('no-llm-requester')
    expect(llmClientMock.getLLMClient).not.toHaveBeenCalled()
  })

  it('读图失败返回 image-read-failed（不抛异常）', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT: no such file'))
    const { requester, chat } = makeRequester()
    const client = new VisionLLMClient(makeConfig(), { requester })

    const outcome = await client.analyzeImage('/tmp/missing.png')

    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') throw new Error('unreachable')
    expect(outcome.reason).toBe('image-read-failed')
    expect(outcome.detail).toContain('ENOENT')
    expect(chat).not.toHaveBeenCalled()
  })

  it('超过 5MB 也归到 image-read-failed，且不发请求', async () => {
    mockStat.mockResolvedValue({ size: 10 * 1024 * 1024 } as unknown as StatsLike)
    const { requester, chat } = makeRequester()
    const client = new VisionLLMClient(makeConfig(), { requester })

    const outcome = await client.analyzeImage('/tmp/big.png')

    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') throw new Error('unreachable')
    expect(outcome.reason).toBe('image-read-failed')
    expect(outcome.detail).toContain('图片过大')
    expect(chat).not.toHaveBeenCalled()
  })

  it('请求抛错返回 llm-call-failed', async () => {
    mockReadFile.mockResolvedValue(pngBytes())
    const chat = vi.fn(async () => {
      throw new Error('401 Unauthorized')
    })
    const requester: VisionLLMRequester = { supportsImageInput: true, chat }
    const client = new VisionLLMClient(makeConfig(), { requester })

    const outcome = await client.analyzeImage('/tmp/a.png')

    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') throw new Error('unreachable')
    expect(outcome.reason).toBe('llm-call-failed')
    expect(outcome.detail).toContain('401')
  })

  it('空响应返回 llm-call-failed（不当成功）', async () => {
    mockReadFile.mockResolvedValue(pngBytes())
    const client = new VisionLLMClient(makeConfig(), { requester: makeRequester('   ').requester })

    const outcome = await client.analyzeImage('/tmp/a.png')

    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') throw new Error('unreachable')
    expect(outcome.reason).toBe('llm-call-failed')
    expect(outcome.detail).toContain('空响应')
  })

  it('响应不是 JSON 时 error 且带 raw 供排查', async () => {
    mockReadFile.mockResolvedValue(pngBytes())
    const client = new VisionLLMClient(makeConfig(), { requester: makeRequester('这张图里有一台电脑，没有别的了。').requester })

    const outcome = await client.analyzeImage('/tmp/a.png')

    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') throw new Error('unreachable')
    expect(outcome.reason).toBe('response-not-json')
    expect(outcome.raw).toContain('没有别的了')
  })

  it('解析失败时不会留下半成品 description', async () => {
    mockReadFile.mockResolvedValue(pngBytes())
    const client = new VisionLLMClient(makeConfig(), { requester: makeRequester('{"objects":[]}').requester })

    const outcome = await client.analyzeImage('/tmp/a.png')

    expect(outcome.status).toBe('error')
    // 旧实现会把 substring(0, 200) 当 description 返回
    expect(Object.prototype.hasOwnProperty.call(outcome, 'result')).toBe(false)
    expect(JSON.stringify(outcome)).not.toContain('我收到了一张图片')
  })

  it('chatWithImage 返回模型原文', async () => {
    mockReadFile.mockResolvedValue(pngBytes())
    const client = new VisionLLMClient(makeConfig(), { requester: makeRequester('这是代码编辑器截图。').requester })

    const outcome = await client.chatWithImage('/tmp/a.png', '这是什么？')

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.text).toBe('这是代码编辑器截图。')
    expect(outcome.text).not.toContain('我收到了一张图片')
  })

  it('chatWithImage 不可用时返回 unavailable（不抛异常）', async () => {
    const client = new VisionLLMClient(makeConfig({ apiKey: '' }), { requester: makeRequester().requester })

    const outcome = await client.chatWithImage('/tmp/a.png', '这是什么？')

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') throw new Error('unreachable')
    expect(outcome.reason).toBe('llm-missing-credentials')
  })

  it('batchAnalyzeImages 逐张独立：一失败不影响其余', async () => {
    mockStat
      .mockResolvedValueOnce({ size: 10 * 1024 * 1024 } as unknown as StatsLike)
      .mockResolvedValueOnce({ size: 100 } as unknown as StatsLike)
    mockReadFile.mockResolvedValue(pngBytes())
    const { requester, chat } = makeRequester()
    const client = new VisionLLMClient(makeConfig(), { requester })

    const outcomes = await client.batchAnalyzeImages(['/a.png', '/b.png'])

    expect(outcomes).toHaveLength(2)
    expect(outcomes[0].status).toBe('error')
    expect(outcomes[1].status).toBe('ok')
    expect(chat).toHaveBeenCalledTimes(1)
    // 不再出现旧的「分析失败」占位描述
    expect(JSON.stringify(outcomes[0])).not.toContain('分析失败')
  })

  it('getStatus 在不可用时给出原因', () => {
    const client = new VisionLLMClient(makeConfig({ apiKey: '' }), { requester: makeRequester().requester })

    const status = client.getStatus()

    expect(status.ready).toBe(false)
    expect(status.reason).toBe('llm-missing-credentials')
    expect(status.supportsImages).toBe(true)
  })

  it('没有假延迟：注入 requester 时立即返回', async () => {
    mockReadFile.mockResolvedValue(pngBytes())
    const client = new VisionLLMClient(makeConfig(), { requester: makeRequester().requester })

    const startedAt = Date.now()
    await client.analyzeImage('/tmp/a.png')

    // 旧桩有固定 1000ms setTimeout
    expect(Date.now() - startedAt).toBeLessThan(500)
  })
})

// ============ VisualPerceptionManager ============

describe('VisualPerceptionManager', () => {
  const shotCapture = vi.fn(async () => SHOT)
  const shotProvider: ScreenshotProvider = { capture: shotCapture }
  let mgr: VisualPerceptionManager

  beforeEach(() => {
    shotCapture.mockClear()
    mgr = new VisualPerceptionManager({ screenshotProvider: shotProvider, requester: makeRequester().requester })
  })

  it('未 init 时不可用，analyzeScreenshot 返回 perception-disabled', async () => {
    expect(mgr.isAvailable()).toBe(false)

    const outcome = await mgr.analyzeScreenshot()

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') throw new Error('unreachable')
    expect(outcome.reason).toBe('perception-disabled')
    expect(shotCapture).not.toHaveBeenCalled()
  })

  it('init 后可用；setEnabled(false) 后不可用', async () => {
    mgr.init(makeConfig())
    expect(mgr.isAvailable()).toBe(true)

    mgr.setEnabled(false)
    expect(mgr.isAvailable()).toBe(false)
    expect((await mgr.analyzeScreenshot()).status).toBe('unavailable')
  })

  it('隐私模式（默认）不取截图、不上传，返回 privacy-mode', async () => {
    mgr.init(makeConfig())

    const outcome = await mgr.analyzeScreenshot()

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') throw new Error('unreachable')
    expect(outcome.reason).toBe('privacy-mode')
    expect(shotCapture).not.toHaveBeenCalled()
  })

  it('关闭隐私模式后取一次截图并交给视觉客户端', async () => {
    const { requester, chat } = makeRequester()
    const local = new VisualPerceptionManager({ screenshotProvider: shotProvider, requester })
    local.init(makeConfig())
    local.setPrivacyMode(false)

    const outcome = await local.analyzeScreenshot()

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.result.description).toContain('一张桌面截图')
    expect(shotCapture).toHaveBeenCalledTimes(1)
    expect(chat).toHaveBeenCalledTimes(1)
    expect(chat.mock.calls[0][0].image).toEqual(SHOT)
  })

  it('截图抛错返回 screenshot-capture-failed', async () => {
    const failingProvider: ScreenshotProvider = {
      capture: async () => {
        throw new Error('安全模式：检测到调试器')
      },
    }
    const local = new VisualPerceptionManager({ screenshotProvider: failingProvider, requester: makeRequester().requester })
    local.init(makeConfig())
    local.setPrivacyMode(false)

    const outcome = await local.analyzeScreenshot()

    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') throw new Error('unreachable')
    expect(outcome.reason).toBe('screenshot-capture-failed')
    expect(outcome.detail).toContain('安全模式')
  })

  it('截图返回 null 时 unavailable（不拿空白图冒充截图）', async () => {
    const emptyProvider: ScreenshotProvider = { capture: async () => null }
    const local = new VisualPerceptionManager({ screenshotProvider: emptyProvider, requester: makeRequester().requester })
    local.init(makeConfig())
    local.setPrivacyMode(false)

    const outcome = await local.analyzeScreenshot()

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') throw new Error('unreachable')
    expect(outcome.reason).toBe('screenshot-provider-absent')
  })

  it('显式 screenshotProvider: null 时不回落到默认 Tauri provider', async () => {
    const local = new VisualPerceptionManager({ screenshotProvider: null, requester: makeRequester().requester })
    local.init(makeConfig())
    local.setPrivacyMode(false)

    const outcome = await local.analyzeScreenshot()

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') throw new Error('unreachable')
    expect(outcome.reason).toBe('screenshot-provider-absent')
    expect(local.getStatus().screenshotSource).toBe('none')
  })

  it('setPrivacyMode 切换并记录日志', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    mgr.setPrivacyMode(true)
    mgr.setPrivacyMode(false)

    expect(logSpy).toHaveBeenCalledTimes(2)
  })

  it('getStatus 反映隐私模式与截图来源', () => {
    mgr.init(makeConfig())
    const status = mgr.getStatus()

    expect(status.enabled).toBe(true)
    expect(status.privacyMode).toBe(true)
    expect(status.screenshotSource).toBe('injected')
    expect(status.ready).toBe(true)
  })

  describe('petLookAtScreen', () => {
    it('成功路径带出描述与对象', async () => {
      mgr.init(makeConfig())
      mgr.setPrivacyMode(false)

      const reply = await mgr.petLookAtScreen()

      expect(reply).toContain('一张桌面截图')
      expect(reply).toContain('我看到有 编辑器, 终端')
    })

    it('只拿到空对象时返回默认文案', async () => {
      mgr.init(makeConfig())
      const spy = vi.spyOn(mgr, 'analyzeScreenshot').mockResolvedValue({
        status: 'ok',
        result: { description: '', objects: [] },
        raw: '{}',
      })

      expect(await mgr.petLookAtScreen()).toBe('我在看着呢！')
      spy.mockRestore()
    })

    it('不可用时返回降级文案并记录原因', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // 未 init → perception-disabled
      const reply = await mgr.petLookAtScreen()

      expect(reply).toBe('抱歉，我现在还看不到屏幕内容呢...')
      expect(warnSpy).toHaveBeenCalled()
    })
  })
})

// ============ 默认截图 provider ============

describe('createTauriScreenshotProvider', () => {
  it('非 Tauri 运行时返回 null 且不调 invoke', async () => {
    const core = await import('@tauri-apps/api/core')
    const provider = createTauriScreenshotProvider()

    const shot = await provider.capture()

    expect(shot).toBeNull()
    expect(core.invoke).not.toHaveBeenCalled()
  })

  it('Tauri 运行时调 take_screenshot，返回 base64 PNG', async () => {
    ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { mocked: true }
    const core = await import('@tauri-apps/api/core')
    vi.mocked(core.invoke).mockResolvedValue({ imageData: 'UE5H', width: 1280, height: 720 } as never)

    const shot = await createTauriScreenshotProvider({ maxWidth: 640 }).capture()

    expect(core.invoke).toHaveBeenCalledWith('take_screenshot', { maxWidth: 640 })
    expect(shot).toEqual({ base64: 'UE5H', mimeType: 'image/png' })
  })

  it('imageData 为空时返回 null', async () => {
    ;(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { mocked: true }
    const core = await import('@tauri-apps/api/core')
    vi.mocked(core.invoke).mockResolvedValue({ imageData: '' } as never)

    expect(await createTauriScreenshotProvider().capture()).toBeNull()
  })
})

// ============ 单例 ============

describe('getVisualPerceptionManager 单例', () => {
  it('多次获取返回同一实例，reset 后换新实例', () => {
    resetVisualPerceptionManager()
    const first = getVisualPerceptionManager()
    expect(getVisualPerceptionManager()).toBe(first)

    resetVisualPerceptionManager()
    expect(getVisualPerceptionManager()).not.toBe(first)
  })
})
