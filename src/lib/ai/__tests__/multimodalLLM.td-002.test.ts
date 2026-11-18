/**
 * @file multimodalLLM.td-002.test.ts
 * @description TD-002 专项单测 —— 多模态链路「真接线」的可注入性、失败语义与结构化提取
 *
 * 本文件只证明三件事，不证明别的：
 * 1. **真调用链路可注入、且真的把图发出去了**：注入 fake requester / fake 文本 LLM 后，
 *    断言消息体里的 content parts 含 `image_url` data URI（OpenAI 兼容）或 `image` block（Claude），
 *    base64 与 MIME 原样透传；
 * 2. **不可用与失败互不混淆**：`unavailable` 不带 result（不可能伪造分析），`error` 必带 reason + detail；
 * 3. **结构化提取不猜**：空响应 / 无 JSON / 坏 JSON / 缺字段 / 类型越界 / 枚举未知，逐条判红并点名到字段。
 *
 * 负控（证明这些测试不是空转）：
 * - `@/lib/ai/llmClient` 整体 mock：任何「悄悄回退到真实 LLMClient」的改动都会立刻报红；
 * - `fs/promises` 整体 mock：截图链路用例断言 `readFile` / `stat` 一次都没被调用 ——
 *   若实现又回去读 `TEMP/screenshot.png`，这条会红；
 * - 假延迟用例：三次分析必须在 500ms 内完成（旧桩每次固定 `setTimeout` 1000ms）。
 *
 * 红线：不联网、不用真 API Key、不读真实磁盘（所有请求都走注入的 fake）。
 */
import { readFile, stat } from 'fs/promises'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  VisionLLMClient,
  VisualPerceptionManager,
  createLLMClientVisionRequester,
  getVisionTransportCapability,
  parseAnalysisResponse,
  type ImagePayload,
  type ScreenshotProvider,
  type VisionLLMRequester,
  type VisionTextLLM,
} from '@/lib/ai/multimodalLLM'
import type { AIConfig, ChatMessage } from '@/lib/data/types'

const { llmClientMock } = vi.hoisted(() => {
  const chat = vi.fn(async () => {
    throw new Error('TD-002 负控：用例不应走到真实 LLMClient.chat()')
  })
  const fakeClient = {
    chat,
    getConfig: () => ({
      provider: 'openai',
      apiKey: 'fake',
      baseUrl: 'https://fake.invalid',
      model: 'fake',
      temperature: 0,
      maxTokens: 1,
    }),
  }
  return {
    llmClientMock: {
      getLLMClient: vi.fn(() => fakeClient),
      DEFAULT_AI_CONFIG: { provider: 'deepseek', apiKey: '', baseUrl: '', model: '', temperature: 0.7, maxTokens: 512 },
    },
  }
})
vi.mock('@/lib/ai/llmClient', () => llmClientMock)

const { mockFs } = vi.hoisted(() => ({
  mockFs: () => {
    const readFileFn = vi.fn(async () => Buffer.from('fake-bytes'))
    const statFn = vi.fn(async () => ({ size: 1024 }))
    return { readFile: readFileFn, stat: statFn, default: { readFile: readFileFn, stat: statFn } }
  },
}))
vi.mock('node:fs/promises', mockFs)
vi.mock('fs/promises', mockFs)

const mockReadFile = vi.mocked(readFile)
const mockStat = vi.mocked(stat)
type StatsLike = Awaited<ReturnType<typeof stat>>

/** 纯配置，不参与任何真实请求 */
function makeConfig(over: Partial<AIConfig> = {}): AIConfig {
  return {
    provider: 'openai',
    apiKey: 'sk-fake-for-test',
    baseUrl: 'https://api.example.invalid',
    model: 'gpt-4o',
    temperature: 0.7,
    maxTokens: 1024,
    ...over,
  }
}

const IMAGE: ImagePayload = { base64: 'iVBORw0KGgoAAA', mimeType: 'image/png' }

/** 真 PNG 签名（走文件读取的用例需要它，否则实现会按扩展名/报错兜底） */
const pngBytes = () =>
  Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('payload')])

const VALID_JSON = JSON.stringify({
  description: '一张桌面截图，左侧编辑器，右下角终端',
  objects: [
    { name: '编辑器', confidence: 0.92 },
    { name: '终端', confidence: 0.6, boundingBox: { x: 10, y: 20, width: 300, height: 200 } },
  ],
  ocrText: 'const a = 1',
  sceneCategory: 'screenshot',
  sentiment: 'neutral',
  dominantColors: ['#1e1e1e', '#ffffff'],
  quality: 'high',
})

function makeRequester(reply: string = VALID_JSON) {
  const chat = vi.fn(async (_req: { prompt: string; image: ImagePayload }) => reply)
  const requester: VisionLLMRequester = { supportsImageInput: true, chat }
  return { requester, chat }
}

/** 假文本 LLM：满足 `VisionTextLLM` 契约，`getConfig()` 用来声明 provider */
function makeTextLLM(provider: string, reply: string = VALID_JSON) {
  const chat = vi.fn(async (_messages: ChatMessage[]) => reply)
  const llm: VisionTextLLM = { chat, getConfig: () => makeConfig({ provider }) }
  return { llm, chat }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockReadFile.mockResolvedValue(pngBytes())
  mockStat.mockResolvedValue({ size: 1024 } as unknown as StatsLike)
})
afterEach(() => {
  vi.restoreAllMocks()
})

// ============ 1. provider 传输能力：按仓内协议实现判定 ============

describe('getVisionTransportCapability', () => {
  it('OpenAI 兼容族可用（含 default 分支的 custom / 未登记 provider）', () => {
    for (const provider of ['openai', 'qwen', 'glm', 'doubao', 'kimi', 'custom', 'some-new-provider']) {
      const capability = getVisionTransportCapability(provider)
      expect(capability.supported).toBe(true)
      expect(capability.detail).toContain('image_url')
    }
  })

  it('claude 可用（content block 协议）', () => {
    const capability = getVisionTransportCapability('claude')
    expect(capability.supported).toBe(true)
    expect(capability.detail).toContain('content block')
  })

  it('gemini / ollama / ondevice 不可用，且原因各指其真实卡点', () => {
    const gemini = getVisionTransportCapability('gemini')
    expect(gemini.supported).toBe(false)
    expect(gemini.detail).toContain('text part')

    const ollama = getVisionTransportCapability('ollama')
    expect(ollama.supported).toBe(false)
    expect(ollama.detail).toContain('images')

    const ondevice = getVisionTransportCapability('ondevice')
    expect(ondevice.supported).toBe(false)
    expect(ondevice.detail).toContain('纯文本')
  })
})

// ============ 2. 消息组装：图真的进到请求体里 ============

describe('createLLMClientVisionRequester 消息组装', () => {
  it('OpenAI 兼容：content 是 text + image_url(data URI) 两片', async () => {
    const { llm, chat } = makeTextLLM('openai')
    const requester = createLLMClientVisionRequester(llm)

    expect(requester.supportsImageInput).toBe(true)
    await requester.chat({ prompt: '分析这张图', image: IMAGE })

    expect(chat).toHaveBeenCalledTimes(1)
    const messages = chat.mock.calls[0][0]
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')

    const parts = messages[0].content as unknown as Array<Record<string, unknown>>
    expect(Array.isArray(parts)).toBe(true)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toEqual({ type: 'text', text: '分析这张图' })
    expect(parts[1]).toEqual({
      type: 'image_url',
      image_url: { url: `data:${IMAGE.mimeType};base64,${IMAGE.base64}` },
    })
  })

  it('Claude：content 是 image(base64) + text 两片', async () => {
    const { llm, chat } = makeTextLLM('claude')
    const requester = createLLMClientVisionRequester(llm)

    await requester.chat({ prompt: '分析这张图', image: IMAGE })

    const parts = chat.mock.calls[0][0][0].content as unknown as Array<Record<string, unknown>>
    expect(parts[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: IMAGE.mimeType, data: IMAGE.base64 },
    })
    expect(parts[1]).toEqual({ type: 'text', text: '分析这张图' })
  })

  it('不带 getConfig 的 fake LLM 按 OpenAI 兼容处理（可注入的最小契约）', async () => {
    const chat = vi.fn(async (_messages: ChatMessage[]) => VALID_JSON)
    const requester = createLLMClientVisionRequester({ chat })

    expect(requester.supportsImageInput).toBe(true)
    await requester.chat({ prompt: 'p', image: IMAGE })
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('协议带不了图时 chat 抛 VisionTransportError（而不是只发文字）', async () => {
    const { llm, chat } = makeTextLLM('gemini')
    const requester = createLLMClientVisionRequester(llm)

    expect(requester.supportsImageInput).toBe(false)
    await expect(requester.chat({ prompt: 'p', image: IMAGE })).rejects.toThrow(/无法承载图像输入/)
    expect(chat).not.toHaveBeenCalled()
  })
})

// ============ 3. 可用性判定：不可用绝不伪造结果 ============

describe('VisionLLMClient 可用性', () => {
  it('注入 requester 时不构造默认 LLMClient（不联网的自证）', async () => {
    const { requester, chat } = makeRequester()
    const client = new VisionLLMClient(makeConfig(), { requester })

    expect(llmClientMock.getLLMClient).not.toHaveBeenCalled()
    expect(client.getStatus().ready).toBe(true)

    const outcome = await client.analyzeImageData(IMAGE)
    expect(outcome.status).toBe('ok')
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('未注入 requester 时才走默认：getLLMClient(config) 被调用一次', async () => {
    const config = makeConfig({ provider: 'openai' })
    const client = new VisionLLMClient(config, { requester: undefined })

    expect(llmClientMock.getLLMClient).toHaveBeenCalledTimes(1)
    expect(llmClientMock.getLLMClient).toHaveBeenCalledWith(config)

    const outcome = await client.analyzeImageData(IMAGE)
    // 默认路径的 fake LLMClient.chat 故意抛错 → 必须被归到 llm-call-failed，而不是吞掉
    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') throw new Error('unreachable')
    expect(outcome.reason).toBe('llm-call-failed')
    expect(outcome.detail).toContain('负控')
  })

  it('claude + 空 apiKey → 报缺凭据（协议可用，卡在配置）', async () => {
    const { requester, chat } = makeRequester()
    const client = new VisionLLMClient(makeConfig({ provider: 'claude', apiKey: '  ' }), { requester })

    const outcome = await client.analyzeImageData(IMAGE)

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') throw new Error('unreachable')
    expect(outcome.reason).toBe('llm-missing-credentials')
    expect(chat).not.toHaveBeenCalled()
  })

  it('requester 为 null 时不回退、不调 getLLMClient', () => {
    const client = new VisionLLMClient(makeConfig(), { requester: null })

    expect(llmClientMock.getLLMClient).not.toHaveBeenCalled()
    expect(client.getStatus()).toMatchObject({ ready: false, reason: 'no-llm-requester' })
  })

  it('provider 不支持图像 → provider-cannot-send-image，且请求器一次没被调用', async () => {
    const chat = vi.fn(async () => VALID_JSON)
    const requester: VisionLLMRequester = { supportsImageInput: false, unsupportedDetail: 'gemini 只发 text part', chat }
    const client = new VisionLLMClient(makeConfig(), { requester })

    const outcome = await client.analyzeImageData(IMAGE)

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') throw new Error('unreachable')
    expect(outcome.reason).toBe('provider-cannot-send-image')
    expect(outcome.detail).toContain('text part')
    expect(chat).not.toHaveBeenCalled()
  })
})

// ============ 4. 结构化提取矩阵 ============

describe('parseAnalysisResponse', () => {
  it('纯 JSON：全字段通过', () => {
    const parsed = parseAnalysisResponse(VALID_JSON)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('unreachable')

    expect(parsed.result.description).toContain('桌面截图')
    expect(parsed.result.objects).toHaveLength(2)
    expect(parsed.result.objects[1].boundingBox).toEqual({ x: 10, y: 20, width: 300, height: 200 })
    expect(parsed.result.ocrText).toBe('const a = 1')
    expect(parsed.result.sceneCategory).toBe('screenshot')
    expect(parsed.result.sentiment).toBe('neutral')
    expect(parsed.result.dominantColors).toEqual(['#1e1e1e', '#ffffff'])
    expect(parsed.result.quality).toBe('high')
  })

  it('```json 围栏：能提取', () => {
    const parsed = parseAnalysisResponse('好的，结果如下：\n```json\n{"description":"一张猫"}\n```\n以上。')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('unreachable')
    expect(parsed.result.description).toBe('一张猫')
    expect(parsed.result.objects).toEqual([])
  })

  it('前后夹说明文字：按首个 { 到末个 } 切片', () => {
    const parsed = parseAnalysisResponse('分析完成。{"description":"一张图"} 希望有帮助。')
    expect(parsed.ok).toBe(true)
  })

  it('多余键被忽略，已知字段照常保留', () => {
    const parsed = parseAnalysisResponse(JSON.stringify({ description: '一张图', summary: '废话', tags: ['a'] }))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('unreachable')
    expect(Object.keys(parsed.result)).not.toContain('summary')
  })

  it('空文本 → response-not-json', () => {
    const parsed = parseAnalysisResponse('   ')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.reason).toBe('response-not-json')
  })

  it('散文无 JSON → response-not-json（不截断当描述）', () => {
    const parsed = parseAnalysisResponse('这张图里有一台电脑和两杯咖啡。')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.reason).toBe('response-not-json')
  })

  it('坏 JSON → response-json-invalid', () => {
    const parsed = parseAnalysisResponse('{description: 一张图}')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.reason).toBe('response-json-invalid')
  })

  it('顶层是数组 → response-schema-invalid', () => {
    const parsed = parseAnalysisResponse('[]')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.reason).toBe('response-schema-invalid')
    expect(parsed.detail).toContain('顶层必须是 JSON 对象')
  })

  it('顶层是 null → response-schema-invalid', () => {
    const parsed = parseAnalysisResponse('null')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.reason).toBe('response-schema-invalid')
  })

  it('缺 description → 点名 description', () => {
    const parsed = parseAnalysisResponse('{"objects":[]}')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.reason).toBe('response-schema-invalid')
    expect(parsed.detail).toContain('description')
  })

  it('description 只有空白 → 判缺失', () => {
    const parsed = parseAnalysisResponse(JSON.stringify({ description: '   ', objects: [] }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.detail).toContain('description')
  })

  it('objects 不是数组 → 点名 objects', () => {
    const parsed = parseAnalysisResponse(JSON.stringify({ description: '一张图', objects: {} }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.detail).toContain('objects 应为数组')
  })

  it('objects[0] 不是对象 → 点名 objects[0]', () => {
    const parsed = parseAnalysisResponse(JSON.stringify({ description: '一张图', objects: ['编辑器'] }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.detail).toContain('objects[0]')
  })

  it('objects[1].confidence 是字符串 → 点名到字段路径', () => {
    const json = JSON.stringify({
      description: '一张图',
      objects: [{ name: '编辑器', confidence: 0.9 }, { name: '终端', confidence: 'high' }],
    })
    const parsed = parseAnalysisResponse(json)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.detail).toContain('objects[1].confidence 应为数字')
  })

  it('confidence 超出 0~1 → 判越界', () => {
    const parsed = parseAnalysisResponse(
      JSON.stringify({ description: '一张图', objects: [{ name: 'x', confidence: 1.4 }] }),
    )
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.detail).toContain('0~1')
  })

  it('boundingBox 缺字段 → 点名 boundingBox.height', () => {
    const json = JSON.stringify({
      description: '一张图',
      objects: [{ name: 'x', confidence: 0.5, boundingBox: { x: 1, y: 2, width: 3 } }],
    })
    const parsed = parseAnalysisResponse(json)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.detail).toContain('boundingBox.height')
  })

  it('ocrText 非字符串 → 报错', () => {
    const parsed = parseAnalysisResponse(JSON.stringify({ description: '一张图', ocrText: 42 }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.detail).toContain('ocrText')
  })

  it('枚举越界（sceneCategory / sentiment）→ 逐条点名', () => {
    const parsed = parseAnalysisResponse(JSON.stringify({ description: '一张图', sceneCategory: 'video', sentiment: 3 }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.detail).toContain('sceneCategory')
    expect(parsed.detail).toContain('sentiment')
  })

  it('dominantColors 含非字符串 → 报错', () => {
    const parsed = parseAnalysisResponse(JSON.stringify({ description: '一张图', dominantColors: ['#fff', 1] }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.detail).toContain('dominantColors')
  })

  it('多个错误一次性返回（便于一次改完）', () => {
    const parsed = parseAnalysisResponse(JSON.stringify({ objects: [{ name: '', confidence: 'x' }] }))
    expect(parsed.ok).toBe(false)
    if (parsed.ok) throw new Error('unreachable')
    expect(parsed.detail).toContain('description')
    expect(parsed.detail).toContain('objects[0].name')
    expect(parsed.detail).toContain('objects[0].confidence')
  })
})

// ============ 5. 失败语义不混淆 ============

describe('outcome 三态语义', () => {
  it('unavailable 不带 result（类型层面就伪造不出分析）', async () => {
    const client = new VisionLLMClient(makeConfig({ apiKey: '' }), { requester: makeRequester().requester })

    const outcome = await client.analyzeImageData(IMAGE)

    expect(outcome.status).toBe('unavailable')
    expect('result' in outcome).toBe(false)
    expect(JSON.stringify(outcome)).not.toContain('我收到了一张图片')
  })

  it('error 不带 result，但带 reason + detail + raw', async () => {
    const client = new VisionLLMClient(makeConfig(), { requester: makeRequester('不是 JSON 的回答').requester })

    const outcome = await client.analyzeImageData(IMAGE)

    expect(outcome.status).toBe('error')
    if (outcome.status !== 'error') throw new Error('unreachable')
    expect('result' in outcome).toBe(false)
    expect(outcome.reason).toBe('response-not-json')
    expect(outcome.detail.length).toBeGreaterThan(0)
    expect(outcome.raw).toContain('不是 JSON')
  })

  it('chatWithImage 三种归宿都不吞原因', async () => {
    const ok = await new VisionLLMClient(makeConfig(), { requester: makeRequester('原文回答').requester }).chatWithImage(
      '/tmp/x.png',
      '这是什么？',
    )
    expect(ok).toEqual({ status: 'ok', text: '原文回答' })

    const unavailable = await new VisionLLMClient(makeConfig({ apiKey: '' }), {
      requester: makeRequester().requester,
    }).chatWithImage('/tmp/x.png', '这是什么？')
    expect(unavailable.status).toBe('unavailable')
    if (unavailable.status !== 'unavailable') throw new Error('unreachable')
    expect(unavailable.reason).toBe('llm-missing-credentials')

    const failed = await new VisionLLMClient(makeConfig(), {
      requester: {
        supportsImageInput: true,
        chat: async () => {
          throw new Error('500 server error')
        },
      },
    }).chatWithImage('/tmp/x.png', '这是什么？')
    expect(failed.status).toBe('error')
    if (failed.status !== 'error') throw new Error('unreachable')
    expect(failed.reason).toBe('llm-call-failed')
    expect(failed.detail).toContain('500')

    const empty = await new VisionLLMClient(makeConfig(), { requester: makeRequester('  ').requester }).chatWithImage(
      '/tmp/x.png',
      '这是什么？',
    )
    expect(empty.status).toBe('error')
    if (empty.status !== 'error') throw new Error('unreachable')
    expect(empty.detail).toContain('空响应')
  })

  it('关键 reason 各有对应用例（抽查 6 个）', async () => {
    const seen = new Set<string>()

    const noRequester = await new VisionLLMClient(makeConfig(), { requester: null }).analyzeImageData(IMAGE)
    seen.add(noRequester.status === 'unavailable' ? noRequester.reason : '')

    const noKey = await new VisionLLMClient(makeConfig({ apiKey: '' }), {
      requester: makeRequester().requester,
    }).analyzeImageData(IMAGE)
    seen.add(noKey.status === 'unavailable' ? noKey.reason : '')

    const badProtocol = await new VisionLLMClient(makeConfig(), {
      requester: { supportsImageInput: false, chat: async () => '' },
    }).analyzeImageData(IMAGE)
    seen.add(badProtocol.status === 'unavailable' ? badProtocol.reason : '')

    mockStat.mockRejectedValue(new Error('ENOENT'))
    const readFailed = await new VisionLLMClient(makeConfig(), {
      requester: makeRequester().requester,
    }).analyzeImage('/tmp/none.png')
    seen.add(readFailed.status === 'error' ? readFailed.reason : '')

    const callFailed = await new VisionLLMClient(makeConfig(), {
      requester: {
        supportsImageInput: true,
        chat: async () => {
          throw new Error('boom')
        },
      },
    }).analyzeImageData(IMAGE)
    seen.add(callFailed.status === 'error' ? callFailed.reason : '')

    const notJson = await new VisionLLMClient(makeConfig(), { requester: makeRequester('没有 JSON').requester })
      .analyzeImageData(IMAGE)
    seen.add(notJson.status === 'error' ? notJson.reason : '')

    expect(seen).toEqual(
      new Set([
        'no-llm-requester',
        'llm-missing-credentials',
        'provider-cannot-send-image',
        'image-read-failed',
        'llm-call-failed',
        'response-not-json',
      ]),
    )
  })
})

// ============ 6. 截图链路：不再读 TEMP/screenshot.png ============

describe('截图链路（TD-002 第三处桩）', () => {
  const shot: ImagePayload = { base64: 'UE5HYmFzZTY0', mimeType: 'image/png' }
  const capture = vi.fn(async () => shot)

  it('截图直接以 base64 进入分析，全程不读磁盘', async () => {
    const provider: ScreenshotProvider = { capture }
    const { requester } = makeRequester()
    const manager = new VisualPerceptionManager({ screenshotProvider: provider, requester })
    manager.init(makeConfig())
    manager.setPrivacyMode(false)

    const outcome = await manager.analyzeScreenshot()

    expect(outcome.status).toBe('ok')
    if (outcome.status !== 'ok') throw new Error('unreachable')
    expect(outcome.result.description).toContain('桌面截图')
    expect(capture).toHaveBeenCalledTimes(1)
    // 负控：若有人把实现改回「拼 TEMP/screenshot.png 再读盘」，这两条会红
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(mockStat).not.toHaveBeenCalled()
  })

  it('没有截图来源时 unavailable，绝不「假装看到屏幕」', async () => {
    const manager = new VisualPerceptionManager({ screenshotProvider: null, requester: makeRequester().requester })
    manager.init(makeConfig())
    manager.setPrivacyMode(false)

    const outcome = await manager.analyzeScreenshot()

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') throw new Error('unreachable')
    expect(outcome.reason).toBe('screenshot-provider-absent')
    expect(await manager.petLookAtScreen()).toBe('抱歉，我现在还看不到屏幕内容呢...')
  })

  it('隐私模式：截图 provider 一次都没被调用', async () => {
    const manager = new VisualPerceptionManager({
      screenshotProvider: { capture },
      requester: makeRequester().requester,
    })
    manager.init(makeConfig())

    const outcome = await manager.analyzeScreenshot()

    expect(outcome.status).toBe('unavailable')
    if (outcome.status !== 'unavailable') throw new Error('unreachable')
    expect(outcome.reason).toBe('privacy-mode')
    expect(capture).not.toHaveBeenCalled()
  })
})

// ============ 7. 提示词契约（结构化提取的前提） ============

describe('分析提示词', () => {
  it('无论 responseFormat 取值，JSON 契约与字段表都在提示里', async () => {
    const { requester, chat } = makeRequester()
    const client = new VisionLLMClient(makeConfig(), { requester })

    for (const responseFormat of ['concise', 'detailed', 'json'] as const) {
      await client.analyzeImageData(IMAGE, { responseFormat })
    }

    const prompts = chat.mock.calls.map((call) => call[0].prompt)
    expect(prompts).toHaveLength(3)
    for (const prompt of prompts) {
      // 这两条同时是 promptManifest 登记的锚点，不能只出现在某一档里
      expect(prompt).toContain('请以 JSON 格式返回分析结果')
      expect(prompt).toContain('description: string')
      expect(prompt).toContain('你是一个专业的图像分析助手。请仔细分析图片内容')
    }
  })

  it('自定义问题与目标被带进提示，默认目标被替换', async () => {
    const { requester, chat } = makeRequester()
    const client = new VisionLLMClient(makeConfig(), { requester })

    await client.analyzeImageData(IMAGE, { userQuestion: '图里有几个窗口？', analysisGoals: ['数窗口'] })

    const prompt = chat.mock.calls[0][0].prompt
    expect(prompt).toContain('图里有几个窗口？')
    expect(prompt).toContain('1. 数窗口')
    expect(prompt).not.toContain('识别主要对象')
  })
})

// ============ 8. 时序：假延迟确实被删掉了 ============

describe('时序', () => {
  it('三次分析在 500ms 内完成（旧桩每次固定等 1000ms）', async () => {
    const { requester } = makeRequester()
    const client = new VisionLLMClient(makeConfig(), { requester })

    const startedAt = Date.now()
    await client.analyzeImageData(IMAGE)
    await client.analyzeImageData(IMAGE)
    await client.analyzeImageData(IMAGE)

    expect(Date.now() - startedAt).toBeLessThan(500)
  })
})
