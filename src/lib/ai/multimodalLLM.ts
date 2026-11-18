/**
 * @file multimodalLLM.ts
 * @description 多模态 LLM 能力 —— 图像理解（视觉）链路
 *
 * TD-002（2026-11-08 偿还）：本文件此前是三处桩，各自错在不同地方：
 * 1. `callVisionAPI` 只有 `setTimeout(1000)` 的假延迟 + 固定文案「我收到了一张图片」——
 *    用空等冒充网络往返，调用方以为在等模型，实际一个字节没发；
 * 2. `parseAnalysisResponse` 把响应 `substring(0, 200)` 当 description、objects 恒空、
 *    sceneCategory 恒 unknown —— 把「没提取」包装成「提取结果」；
 * 3. `analyzeScreenshot` 拼了一个 `TEMP/screenshot.png` 路径 —— 那个文件从来不存在；
 *    而真实截屏通道 `take_screenshot` 返回的是 base64 而不是路径，「改成路径」这个方向本身就错。
 *
 * 现在三条链路都换成真实现，且**依赖全部可注入**（不注入时可离线测、也不偷偷出网）：
 * - **LLM 调用**：`VisionLLMRequester` 端口。默认实现走仓内唯一文本入口 `LLMClient.chat()`，
 *   按 provider 的**协议承载能力**组装图像消息（OpenAI 兼容 `image_url` parts / Claude `image` block）；
 *   协议带不了图的 provider（gemini / ollama / ondevice）明确判为不可用，不静默丢图只发文字。
 * - **结构化提取**：提示里给 JSON 契约，响应经 `extractJSONString` + 逐字段校验；
 *   坏 JSON / 缺字段 / 类型越界都返回带字段名的 `error`，不产出半成品结果。
 * - **截图来源**：`ScreenshotProvider` 端口。默认实现调 Rust 侧 `take_screenshot`
 *   拿 base64 PNG（该命令本就存在，自带窗口校验 / 安全模式拦截 / 审计）；非 Tauri 运行时如实不可用。
 *
 * 失败语义（三种状态，互不混淆）：
 * - `ok`         —— 真拿到了结构化结果（`raw` 一并返回，便于排查）；
 * - `unavailable`—— 能力/配置/授权层面就没有这条路（未启用、隐私模式、无凭据、provider 带不了图、
 *                    没有截图来源）。**不带 result 字段**，绝不伪造一份分析；
 * - `error`      —— 这条路本来能走但失败了（读图失败、调用失败、响应不合 JSON 契约），带 `reason` + `detail`。
 *
 * 依赖关系：
 * - `@/lib/ai/llmClient`：仓内唯一 LLM 入口（provider 分发 ollama / claude / gemini / ondevice / OpenAI 兼容）
 * - `@/lib/data/jsonUtils`：`extractJSONString`（代码块 / 大括号切片两种容错提取）
 * - `@tauri-apps/api/core`：默认截图 provider 的 `invoke`
 */

import { invoke } from '@tauri-apps/api/core'
import { readFile, stat } from 'fs/promises'
import { extname } from 'path'
import { getLLMClient } from '@/lib/ai/llmClient'
import { extractJSONString } from '@/lib/data/jsonUtils'
import type { AIConfig, ChatMessage } from '@/lib/data/types'

// ============ 类型定义 ============

export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif'

export type SceneCategory = 'screenshot' | 'document' | 'photo' | 'drawing' | 'unknown'
export type ImageSentiment = 'positive' | 'neutral' | 'negative'
export type ImageQuality = 'high' | 'medium' | 'low'

export interface ImageObject {
  /** 对象名（自然语言） */
  name: string
  /** 置信度 0~1 */
  confidence: number
  /** 可选外接框（像素） */
  boundingBox?: { x: number; y: number; width: number; height: number }
}

export interface ImageAnalysisResult {
  /** 图像描述（自然语言） */
  description: string
  /** 检测到的主要对象 */
  objects: ImageObject[]
  /** OCR 提取的文本 */
  ocrText?: string
  /** 场景分类 */
  sceneCategory?: SceneCategory
  /** 情感倾向 */
  sentiment?: ImageSentiment
  /** 颜色主题 */
  dominantColors?: string[]
  /** 图像质量评估 */
  quality?: ImageQuality
}

export interface VisionPrompt {
  /** 系统提示词（不给则用内置默认） */
  systemPrompt?: string
  /** 用户问题 */
  userQuestion?: string
  /** 分析目标 */
  analysisGoals?: string[]
  /** 是否要求提取文字 */
  includeOCR?: boolean
  /** 描述详略（结构化契约恒为 JSON，此处只影响描述的详略要求） */
  responseFormat?: 'concise' | 'detailed' | 'json'
}

/** 一份已编码好的图片（来自文件读取或截图 provider） */
export interface ImagePayload {
  /** 纯 base64（不含 data URI 前缀） */
  base64: string
  /** MIME 类型，如 image/png */
  mimeType: string
}

// ============ 失败语义 ============

export type VisionUnavailableReason =
  /** 管理器未 init 或被 setEnabled(false) */
  | 'perception-disabled'
  /** 隐私模式开启：截图不出本机 */
  | 'privacy-mode'
  /** 没有可用的 LLM 请求器 */
  | 'no-llm-requester'
  /** 远程 provider 没配 apiKey */
  | 'llm-missing-credentials'
  /** 该 provider 的传输协议承载不了图像输入 */
  | 'provider-cannot-send-image'
  /** 没有截图来源：未注入 provider，或运行时无法屏幕捕获 */
  | 'screenshot-provider-absent'

export type VisionErrorReason =
  /** 图片读取失败（不存在 / 超限 / 无法识别格式 / IO 错误） */
  | 'image-read-failed'
  /** 截图 provider 自己抛错（权限、安全模式等） */
  | 'screenshot-capture-failed'
  /** LLM 调用失败（网络、鉴权、模型拒绝等） */
  | 'llm-call-failed'
  /** 响应里找不到 JSON */
  | 'response-not-json'
  /** 找到 JSON 片段但 JSON.parse 失败 */
  | 'response-json-invalid'
  /** JSON 合法但不符合约定 schema（缺字段 / 类型或枚举越界） */
  | 'response-schema-invalid'

export type VisionAnalysisOutcome =
  | { status: 'ok'; result: ImageAnalysisResult; raw: string }
  | { status: 'unavailable'; reason: VisionUnavailableReason; detail: string }
  | { status: 'error'; reason: VisionErrorReason; detail: string; raw?: string }

export type VisionChatOutcome =
  | { status: 'ok'; text: string }
  | { status: 'unavailable'; reason: VisionUnavailableReason; detail: string }
  | { status: 'error'; reason: VisionErrorReason; detail: string; raw?: string }

/** provider 无法承载图像输入（配置层面，不是调用失败） */
export class VisionTransportError extends Error {
  readonly provider: string

  constructor(provider: string, detail: string) {
    super(`provider「${provider}」无法承载图像输入：${detail}`)
    this.name = 'VisionTransportError'
    this.provider = provider
  }
}

// ============ 图片处理器 ============

/**
 * 按字节识别图片类型（magic byte 优先）
 *
 * 截图 provider 给的是 base64 PNG，而磁盘上的文件可能叫 `shot.png` 其实是 JPEG；
 * 旧实现固定 `guessMimeType('jpeg')`，PNG/WEBP 一律按 image/jpeg 上传 ——
 * OpenAI 兼容端点按 data URI 的 MIME 解析，标错会让模型收到解不开的图。
 */
export function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 12) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    ) {
      return 'image/png'
    }
    // WEBP: "RIFF" … "WEBP"（两段签名，中间 4 字节是长度）
    if (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    ) {
      return 'image/webp'
    }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  // GIF: "GIF87a" / "GIF89a"
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return 'image/gif'
  }
  return null
}

export class ImageProcessor {
  private static readonly MAX_SIZE_MB = 5

  /**
   * 读取图片文件并编码为 base64 + 真实 MIME
   *
   * 判定顺序：magic byte → 扩展名 → 报错。两者都认不出时不按 jpeg 猜，
   * 因为猜错的结果是「模型收到一张解不开的图，再回一段与之无关的描述」，比直接报错更难查。
   */
  async readImagePayload(filePath: string): Promise<ImagePayload> {
    const stats = await this.getImageStats(filePath)

    if (stats.size > ImageProcessor.MAX_SIZE_MB * 1024 * 1024) {
      throw new Error(`图片过大：${(stats.size / 1024 / 1024).toFixed(2)}MB (最大 ${ImageProcessor.MAX_SIZE_MB}MB)`)
    }

    const buffer = await readFile(filePath)
    const mimeType = detectImageMime(buffer) ?? this.mimeFromExtension(stats.format)
    if (!mimeType) {
      throw new Error(`无法识别的图片格式：${filePath}（字节签名与扩展名 .${stats.format} 均不匹配）`)
    }

    return { base64: buffer.toString('base64'), mimeType }
  }

  /** 兼容旧入口：只要 base64 的调用方 */
  async readImageAsBase64(filePath: string): Promise<string> {
    const payload = await this.readImagePayload(filePath)
    return payload.base64
  }

  /**
   * 获取图片信息
   *
   * `format` 保持「扩展名归一后的字符串」：jpg/jpeg 统一为 jpeg，未知扩展名原样返回。
   * 真实格式以 `detectImageMime` 的字节判定为准，此字段只作兜底与日志用途。
   */
  async getImageStats(filePath: string): Promise<{ size: number; format: string }> {
    const stats = await stat(filePath)
    const ext = extname(filePath).toLowerCase().replace('.', '')

    return {
      size: stats.size,
      format: ['jpg', 'jpeg'].includes(ext) ? 'jpeg' : ext,
    }
  }

  /** 构建图片 URL（data URI） */
  buildDataUri(base64: string, mimeType: string): string {
    return `data:${mimeType};base64,${base64}`
  }

  /** 猜测 MIME 类型（已知格式映射；未知返回 image/jpeg，仅作兜底） */
  guessMimeType(format: ImageFormat | string): string {
    return this.mimeFromExtension(format) ?? 'image/jpeg'
  }

  /** 扩展名 → MIME；认不出返回 null（与 {@link guessMimeType} 的区别是它不猜） */
  private mimeFromExtension(format: ImageFormat | string): string | null {
    const mimeMap: Record<ImageFormat, string> = {
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
    }
    return mimeMap[format as ImageFormat] ?? null
  }
}

// ============ 截图来源（注入点 1）============

/**
 * 截图 provider —— 桌面侧（Tauri 命令 / 系统 API）注入，Node 侧可实现为「从磁盘取最近一张截图」。
 * 返回 `null` 表示当前环境没有可用的屏幕捕获（如实报告，不返回空白图片）。
 */
export interface ScreenshotProvider {
  capture(): Promise<ImagePayload | null>
}

/** 当前是否在 Tauri 运行时（`__TAURI_INTERNALS__` 未注入时 invoke 必抛） */
function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

/**
 * 默认截图 provider：调 Rust 侧 `take_screenshot`
 *
 * 该命令已在 `src-tauri/src/system_tools.rs` 实现（GDI 截屏 → PNG → base64），
 * 且自带两道门：只允许应用窗口调用、检测到调试器时拒绝。这里只负责「拿图」，
 * 不做任何伪造：非 Windows / 非 Tauri 运行时该命令会返回 null 或抛错，由上层如实上报。
 *
 * @param options.maxWidth 等比缩到最大宽度（默认 1280，控制 payload 体积）
 */
export function createTauriScreenshotProvider(options?: { maxWidth?: number }): ScreenshotProvider {
  return {
    async capture(): Promise<ImagePayload | null> {
      if (!isTauriRuntime()) return null
      const result = await invoke<{ imageData?: string; width?: number; height?: number } | null>('take_screenshot', {
        maxWidth: options?.maxWidth ?? 1280,
      })
      const base64 = result?.imageData
      if (typeof base64 !== 'string' || base64.length === 0) return null
      return { base64, mimeType: 'image/png' }
    },
  }
}

// ============ LLM 请求端口（注入点 2）============

/** 文本 LLM 的最小契约：`LLMClient` 直接满足，测试可注入 fake */
export interface VisionTextLLM {
  chat(messages: ChatMessage[], onChunk?: (chunk: string) => void, abortSignal?: AbortSignal): Promise<string>
  getConfig?(): AIConfig
}

export interface VisionLLMRequest {
  /** 完整提示词（系统提示 + 目标 + JSON 契约） */
  prompt: string
  image: ImagePayload
}

export interface VisionLLMRequester {
  /** 该请求器能否把图像一起发出去；false 时调用方须报 unavailable，而不是「只发文字」 */
  readonly supportsImageInput: boolean
  /** 不能发图时的具体原因（给用户/日志看的） */
  readonly unsupportedDetail?: string
  chat(request: VisionLLMRequest): Promise<string>
}

/**
 * provider 图像承载能力表（依据是**仓内传输实现**，不是「这家厂商支不支持视觉」的宣传）
 *
 * `llmClient.ts` 把 `messages[].content` 原样放进请求体：
 * - OpenAI 兼容族（default 分支）：`content` 可以是 parts 数组（`image_url`），服务端按 MIME 解析 data URI；
 * - Claude：`content` 可以是 content block 数组（`image` + `source.base64`）；
 * - Gemini：`chatGemini` 自己拼 `parts:[{text}]`，图像块进不去；
 * - Ollama：`chatOllama` 只发 `messages[].content` 字符串，不发 `images` 字段；
 * - ondevice：端侧 MNN 按纯文本 prompt 生成。
 *
 * 后三条要支持得改 `llmClient.ts`（本单范围外，且会波及全部文本调用路径），故如实判为不可用。
 * 这张表只回答「协议能不能带图」——「这个模型认不认图」只能由服务端报错反映，见 TD-002 未证边界。
 */
export function getVisionTransportCapability(provider: string): { supported: boolean; detail: string } {
  switch (provider) {
    case 'claude':
      return { supported: true, detail: 'Claude messages 支持 image/base64 content block' }
    case 'gemini':
      return { supported: false, detail: 'chatGemini 只把消息拼成 text part，承载不了 inlineData 图像块' }
    case 'ollama':
      return { supported: false, detail: 'chatOllama 只发送 messages[].content 字符串，不发送 images 字段' }
    case 'ondevice':
      return { supported: false, detail: '端侧 MNN 引擎按纯文本 prompt 生成，不接受图像输入' }
    default:
      return { supported: true, detail: 'OpenAI 兼容 content parts（image_url data URI）；模型本身须具备视觉能力' }
  }
}

/** OpenAI 兼容族的文本分片 */
interface VisionTextPart {
  type: 'text'
  text: string
}
/** OpenAI 兼容族的图像分片 */
interface VisionImageUrlPart {
  type: 'image_url'
  image_url: { url: string }
}
/** Claude 的图像 block */
interface VisionAnthropicImagePart {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}
type VisionContentPart = VisionTextPart | VisionImageUrlPart | VisionAnthropicImagePart

/**
 * 按 provider 组装多模态消息
 *
 * 唯一的类型窄口子：`ChatMessage.content` 声明为 string，而多模态协议需要 parts 数组。
 * `LLMClient.buildBody` / `chatClaude` 都是**原样透传** content 到请求体，所以数组能真的发出去；
 * 这里用一次显式断言，而不是去改 `llmClient.ts`（改它等于给所有文本调用开同一个口子）。
 * 若上游将来把 content 收紧成纯文本类型，这一行会直接编译失败 —— 正好提醒改走正式多模态通道。
 */
function buildVisionMessages(provider: string, prompt: string, image: ImagePayload): ChatMessage[] {
  const parts: VisionContentPart[] =
    provider === 'claude'
      ? [
          { type: 'image', source: { type: 'base64', media_type: image.mimeType, data: image.base64 } },
          { type: 'text', text: prompt },
        ]
      : [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
        ]

  const message = {
    id: `vision-${Date.now()}`,
    role: 'user',
    content: parts,
    timestamp: Date.now(),
  } as unknown as ChatMessage

  return [message]
}

/**
 * 默认请求器：把图像请求打到 `LLMClient.chat()`
 *
 * provider 取注入 LLM 的当前配置（`getConfig()`）；不带 `getConfig` 的 fake 视为 OpenAI 兼容族
 * （`getVisionTransportCapability` 的 default 分支），由 `supportsImageInput` 如实反映。
 */
export function createLLMClientVisionRequester(llm: VisionTextLLM = getLLMClient()): VisionLLMRequester {
  const provider = llm.getConfig?.().provider ?? ''
  const capability = getVisionTransportCapability(provider)

  return {
    supportsImageInput: capability.supported,
    unsupportedDetail: capability.detail,
    async chat({ prompt, image }: VisionLLMRequest): Promise<string> {
      if (!capability.supported) {
        throw new VisionTransportError(provider || 'unknown', capability.detail)
      }
      return llm.chat(buildVisionMessages(provider, prompt, image))
    },
  }
}

// ============ Vision LLM 客户端 ============

export interface VisionLLMClientDeps {
  /** 自定义请求器；传 null 表示「明确没有」→ unavailable（而不是回落到默认） */
  requester?: VisionLLMRequester | null
  imageProcessor?: ImageProcessor
}

/** 远程 provider 必须有 apiKey；ondevice 是本地模型，不需要 */
function hasLlmCredentials(config: AIConfig): boolean {
  if (config.provider === 'ondevice') return true
  return typeof config.apiKey === 'string' && config.apiKey.trim().length > 0
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 响应预览（拼进 detail，便于定位模型到底回了什么） */
function previewText(text: string, max = 120): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max)}…` : flat
}

/** 视觉链路状态快照（截图链路「每层都像有实现、结果为空」时用来定位卡在哪一关） */
export interface VisionStatusSnapshot {
  provider: string
  /** 传输协议能否承载图像 */
  supportsImages: boolean
  /** 是否真的发得出请求（凭据 + 传输能力） */
  ready: boolean
  /** 不可用的原因（ready=false 时必有） */
  reason?: VisionUnavailableReason
  detail?: string
}

export class VisionLLMClient {
  private config: AIConfig
  private requester: VisionLLMRequester | null
  private imageProcessor: ImageProcessor

  constructor(config: AIConfig, deps: VisionLLMClientDeps = {}) {
    this.config = config
    this.imageProcessor = deps.imageProcessor ?? new ImageProcessor()
    // deps.requester === undefined 才算「没指定」→ 造默认；显式 null 是「明确不要」
    this.requester = deps.requester === undefined ? createLLMClientVisionRequester(getLLMClient(config)) : deps.requester
  }

  getConfig(): AIConfig {
    return this.config
  }

  /**
   * 当前能否真的把图片发出去 —— 两层门槛，顺序有意：先看协议能不能带图，再看有没有凭据。
   *
   * 反过来先查凭据的话，ollama（本地、本来就不需要 key）会被报成「缺凭据」，
   * 与实际卡点（协议带不了图）不符，用户按提示去填 key 也照样不通。
   */
  getAvailability(): { available: true } | { available: false; reason: VisionUnavailableReason; detail: string } {
    if (!this.requester) {
      return { available: false, reason: 'no-llm-requester', detail: '未注入 VisionLLMRequester，且没有默认实现' }
    }
    if (!this.requester.supportsImageInput) {
      return {
        available: false,
        reason: 'provider-cannot-send-image',
        detail: this.requester.unsupportedDetail ?? `provider「${this.config.provider}」不支持图像输入`,
      }
    }
    if (!hasLlmCredentials(this.config)) {
      return {
        available: false,
        reason: 'llm-missing-credentials',
        detail: `provider「${this.config.provider}」未配置 apiKey（ondevice 本地模型视为免凭据）`,
      }
    }
    return { available: true }
  }

  /** 状态快照（给 UI / 排障用） */
  getStatus(): VisionStatusSnapshot {
    const availability = this.getAvailability()
    const base: VisionStatusSnapshot = {
      provider: this.config.provider,
      supportsImages: Boolean(this.requester?.supportsImageInput),
      ready: availability.available,
    }
    if (availability.available) return base
    return { ...base, reason: availability.reason, detail: availability.detail }
  }

  /** 分析本地图片文件 */
  async analyzeImage(imagePath: string, prompt?: Partial<VisionPrompt>): Promise<VisionAnalysisOutcome> {
    const availability = this.getAvailability()
    if (!availability.available) {
      // 不可用时先报配置缺口，不白读一次盘
      return { status: 'unavailable', reason: availability.reason, detail: availability.detail }
    }

    let payload: ImagePayload
    try {
      payload = await this.imageProcessor.readImagePayload(imagePath)
    } catch (error) {
      return { status: 'error', reason: 'image-read-failed', detail: errorMessage(error) }
    }
    return this.analyzePayload(payload, prompt)
  }

  /** 分析一份已编码的图片（截图 provider 用这条，不必落临时文件） */
  async analyzeImageData(image: ImagePayload, prompt?: Partial<VisionPrompt>): Promise<VisionAnalysisOutcome> {
    const availability = this.getAvailability()
    if (!availability.available) {
      return { status: 'unavailable', reason: availability.reason, detail: availability.detail }
    }
    return this.analyzePayload(image, prompt)
  }

  /** 图片对话（自由文本回答，不做结构化提取） */
  async chatWithImage(imagePath: string, question: string, context?: string): Promise<VisionChatOutcome> {
    const availability = this.getAvailability()
    if (!availability.available) {
      return { status: 'unavailable', reason: availability.reason, detail: availability.detail }
    }

    let payload: ImagePayload
    try {
      payload = await this.imageProcessor.readImagePayload(imagePath)
    } catch (error) {
      return { status: 'error', reason: 'image-read-failed', detail: errorMessage(error) }
    }

    return this.askModel(payload, context ? `${context}\n\n${question}` : question)
  }

  /** 批量分析：逐张独立，单张失败不牵连其余 */
  async batchAnalyzeImages(imagePaths: string[], prompt?: Partial<VisionPrompt>): Promise<VisionAnalysisOutcome[]> {
    const outcomes: VisionAnalysisOutcome[] = []
    for (const path of imagePaths) {
      outcomes.push(await this.analyzeImage(path, prompt))
    }
    return outcomes
  }

  /** 结构化分析核心 */
  private async analyzePayload(image: ImagePayload, prompt?: Partial<VisionPrompt>): Promise<VisionAnalysisOutcome> {
    const ask = await this.askModel(image, this.buildAnalysisPrompt(prompt))
    if (ask.status !== 'ok') return ask

    const parsed = parseAnalysisResponse(ask.text)
    if (!parsed.ok) {
      return { status: 'error', reason: parsed.reason, detail: parsed.detail, raw: ask.text }
    }
    return { status: 'ok', result: parsed.result, raw: ask.text }
  }

  /** 一次实际请求：可用性 → 调用 → 空响应判定 */
  private async askModel(image: ImagePayload, prompt: string): Promise<VisionChatOutcome> {
    const availability = this.getAvailability()
    if (!availability.available) {
      return { status: 'unavailable', reason: availability.reason, detail: availability.detail }
    }
    const requester = this.requester
    if (!requester) {
      return { status: 'unavailable', reason: 'no-llm-requester', detail: '未注入 VisionLLMRequester' }
    }

    let text: string
    try {
      text = await requester.chat({ prompt, image })
    } catch (error) {
      if (error instanceof VisionTransportError) {
        return { status: 'unavailable', reason: 'provider-cannot-send-image', detail: error.message }
      }
      return { status: 'error', reason: 'llm-call-failed', detail: errorMessage(error) }
    }

    if (typeof text !== 'string' || text.trim().length === 0) {
      // 空响应不能当成功：解析必然失败，这里提前给出可定位的原因
      return { status: 'error', reason: 'llm-call-failed', detail: '模型返回空响应', raw: text }
    }
    return { status: 'ok', text }
  }

  /**
   * 构建分析提示词（系统提示 + 目标 + 用户问题 + JSON 契约）
   *
   * JSON 契约是硬约束：结构化提取以它为解析依据，因此无论 `responseFormat` 取哪档都必须带。
   */
  private buildAnalysisPrompt(prompt?: Partial<VisionPrompt>): string {
    const systemPrompt = prompt?.systemPrompt ?? '你是一个专业的图像分析助手。请仔细分析图片内容，并按 JSON 契约输出。'
    const userQuestion = prompt?.userQuestion ?? '请描述这张图片的内容。'
    const goals = prompt?.analysisGoals ?? DEFAULT_ANALYSIS_GOALS
    const includeOCR = prompt?.includeOCR ?? true

    const lines: string[] = [systemPrompt, '', '分析目标：']
    goals.forEach((goal, index) => lines.push(`${index + 1}. ${goal}`))
    lines.push('', `用户问题：${userQuestion}`)

    if (includeOCR) {
      lines.push('图片中若含可读文字，把文字放进 ocrText 字段。')
    }
    if (prompt?.responseFormat === 'detailed') {
      lines.push('description 尽量写得具体、完整。')
    }

    lines.push('', JSON_OUTPUT_CONTRACT, JSON_SCHEMA_HINT)
    return lines.join('\n')
  }
}

// ============ 结构化提取 ============

const DEFAULT_ANALYSIS_GOALS = ['识别主要对象', '描述场景类型和环境', '提取图片中的文字', '判断整体情感倾向']

/** JSON 输出约定（同时是 prompt 漂移门禁登记的锚点，改动须同步 promptManifest 的版本） */
const JSON_OUTPUT_CONTRACT = '请以 JSON 格式返回分析结果：一个裸 JSON 对象，不要包裹额外说明。'

/** schema 提示：键名与类型逐条列出，模型少给/给错都会被下面的校验拦住 */
const JSON_SCHEMA_HINT = [
  'JSON 字段（description 必填，其余可省）：',
  'description: string 图片内容的中文描述',
  'objects: 数组，每项 { name: string, confidence: 0~1 的数字, boundingBox?: { x, y, width, height } }',
  'ocrText: string 图片中的可读文字',
  'sceneCategory: "screenshot" | "document" | "photo" | "drawing" | "unknown"',
  'sentiment: "positive" | "neutral" | "negative"',
  'dominantColors: string[] 主要颜色',
  'quality: "high" | "medium" | "low"',
].join('\n')

const SCENE_CATEGORIES: readonly SceneCategory[] = ['screenshot', 'document', 'photo', 'drawing', 'unknown']
const SENTIMENTS: readonly ImageSentiment[] = ['positive', 'neutral', 'negative']
const QUALITIES: readonly ImageQuality[] = ['high', 'medium', 'low']

export type AnalysisParseOutcome =
  | { ok: true; result: ImageAnalysisResult }
  | { ok: false; reason: 'response-not-json' | 'response-json-invalid' | 'response-schema-invalid'; detail: string }

/**
 * 解析并校验模型响应
 *
 * 口径：**宁可报错，不猜**。
 * - 找不到 JSON → `response-not-json`
 * - JSON 不合法 → `response-json-invalid`
 * - 缺必填 / 类型越界 / 枚举未知 → `response-schema-invalid`，detail 点名到字段（如 `objects[1].confidence`）
 *
 * 未知的多余键一律忽略（模型爱加 `summary` / `tags`），但**已知键的类型错误不放过**。
 */
export function parseAnalysisResponse(raw: string): AnalysisParseOutcome {
  const text = typeof raw === 'string' ? raw : ''
  if (text.trim().length === 0) {
    return { ok: false, reason: 'response-not-json', detail: '模型返回空文本，没有可解析的 JSON' }
  }

  const jsonStr = extractJSONString(text)
  if (!jsonStr) {
    return { ok: false, reason: 'response-not-json', detail: `响应中未找到 JSON 对象：${previewText(text)}` }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonStr)
  } catch (error) {
    return {
      ok: false,
      reason: 'response-json-invalid',
      detail: `JSON 解析失败（${errorMessage(error)}）：${previewText(jsonStr)}`,
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'response-schema-invalid', detail: '顶层必须是 JSON 对象' }
  }

  return validateAnalysisPayload(parsed as Record<string, unknown>)
}

/** 逐字段校验；所有问题收集后一次性返回，便于调用方一次改完 */
function validateAnalysisPayload(payload: Record<string, unknown>): AnalysisParseOutcome {
  const errors: string[] = []
  const result: ImageAnalysisResult = { description: '', objects: [] }

  // ---- description（必填）----
  if (typeof payload.description !== 'string' || payload.description.trim().length === 0) {
    errors.push('description 缺失或为空（必填字符串）')
  } else {
    result.description = payload.description.trim()
  }

  // ---- objects（可选；给错类型算错，不给算空）----
  if (payload.objects !== undefined) {
    if (!Array.isArray(payload.objects)) {
      errors.push('objects 应为数组')
    } else {
      const objects: ImageObject[] = []
      payload.objects.forEach((item, index) => {
        const path = `objects[${index}]`
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          errors.push(`${path} 应为对象`)
          return
        }
        const obj = item as Record<string, unknown>
        const nameOk = typeof obj.name === 'string' && obj.name.trim().length > 0
        if (!nameOk) errors.push(`${path}.name 缺失或为空`)

        const confidenceOk = typeof obj.confidence === 'number' && Number.isFinite(obj.confidence)
        if (!confidenceOk) {
          errors.push(`${path}.confidence 应为数字`)
        } else if ((obj.confidence as number) < 0 || (obj.confidence as number) > 1) {
          errors.push(`${path}.confidence 应在 0~1（实际 ${String(obj.confidence)}）`)
        }

        let boundingBox: ImageObject['boundingBox']
        if (obj.boundingBox !== undefined) {
          const box = obj.boundingBox
          if (!box || typeof box !== 'object' || Array.isArray(box)) {
            errors.push(`${path}.boundingBox 应为对象`)
          } else {
            const b = box as Record<string, unknown>
            const keys: Array<keyof NonNullable<ImageObject['boundingBox']>> = ['x', 'y', 'width', 'height']
            const bad = keys.filter((key) => typeof b[key] !== 'number' || !Number.isFinite(b[key] as number))
            if (bad.length > 0) {
              errors.push(`${path}.boundingBox.${bad.join('/')} 应为数字`)
            } else {
              boundingBox = { x: b.x as number, y: b.y as number, width: b.width as number, height: b.height as number }
            }
          }
        }

        if (nameOk && confidenceOk) {
          objects.push({
            name: (obj.name as string).trim(),
            confidence: obj.confidence as number,
            ...(boundingBox ? { boundingBox } : {}),
          })
        }
      })
      result.objects = objects
    }
  }

  // ---- 可选字符串字段 ----
  if (payload.ocrText !== undefined) {
    if (typeof payload.ocrText !== 'string') {
      errors.push('ocrText 应为字符串')
    } else if (payload.ocrText.trim().length > 0) {
      result.ocrText = payload.ocrText
    }
  }

  // ---- 可选枚举字段 ----
  result.sceneCategory = readEnum(payload, 'sceneCategory', SCENE_CATEGORIES, errors)
  result.sentiment = readEnum(payload, 'sentiment', SENTIMENTS, errors)
  result.quality = readEnum(payload, 'quality', QUALITIES, errors)

  // ---- 可选字符串数组 ----
  if (payload.dominantColors !== undefined) {
    if (!Array.isArray(payload.dominantColors)) {
      errors.push('dominantColors 应为字符串数组')
    } else if (payload.dominantColors.some((color) => typeof color !== 'string')) {
      errors.push('dominantColors 含非字符串元素')
    } else {
      result.dominantColors = payload.dominantColors as string[]
    }
  }

  if (errors.length > 0) {
    return { ok: false, reason: 'response-schema-invalid', detail: errors.join('；') }
  }
  return { ok: true, result }
}

/** 读一个可选枚举字段：缺省返回 undefined，取值不在表内记错 */
function readEnum<T extends string>(
  payload: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  errors: string[],
): T | undefined {
  const value = payload[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    errors.push(`${key} 应为 ${allowed.map((v) => `"${v}"`).join(' | ')}（实际 ${JSON.stringify(value)}）`)
    return undefined
  }
  return value as T
}

// ============ 视觉感知管理器 ============

export interface VisualPerceptionDeps {
  /** 自定义 LLM 请求器；`null` = 明确没有视觉 LLM */
  requester?: VisionLLMRequester | null
  /** 截图来源；`null` = 明确没有屏幕捕获能力（不回落默认） */
  screenshotProvider?: ScreenshotProvider | null
  imageProcessor?: ImageProcessor
}

/** 管理器状态快照：客户端状态 + 截图来源来自哪 */
export interface VisualPerceptionStatus extends VisionStatusSnapshot {
  enabled: boolean
  privacyMode: boolean
  screenshotSource: 'injected' | 'tauri' | 'none'
}

export class VisualPerceptionManager {
  private visionClient: VisionLLMClient | null = null
  private deps: VisualPerceptionDeps
  private enabled = false
  private privacyMode = true // 默认开启隐私模式：截图不出本机

  constructor(deps: VisualPerceptionDeps = {}) {
    this.deps = { ...deps }
  }

  /** 初始化视觉客户端（`deps` 与构造时注入的依赖合并，后者优先） */
  init(config: AIConfig, deps?: VisualPerceptionDeps): void {
    if (deps) {
      this.deps = { ...this.deps, ...deps }
    }
    this.visionClient = new VisionLLMClient(config, this.deps)
    this.enabled = true
    console.log('[VisualPerception] Vision LLM client initialized')
  }

  /** 启用/禁用视觉感知 */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (!enabled) {
      console.log('[VisualPerception] Visual perception disabled')
    }
  }

  /** 设置隐私模式 */
  setPrivacyMode(privacyMode: boolean): void {
    this.privacyMode = privacyMode
    console.log(`[VisualPerception] Privacy mode: ${privacyMode ? 'ON' : 'OFF'}`)
  }

  /**
   * 截屏分析
   *
   * 三处曾各自「假装成功」的地方现在都如实上报：
   * 未启用 / 隐私模式 / 没截图来源 → `unavailable`（不带 result），不再返回一句编好的描述。
   */
  async analyzeScreenshot(): Promise<VisionAnalysisOutcome> {
    if (!this.enabled || !this.visionClient) {
      return {
        status: 'unavailable',
        reason: 'perception-disabled',
        detail: '视觉感知未启用（需先 init，且未被 setEnabled(false)）',
      }
    }

    if (this.privacyMode) {
      return {
        status: 'unavailable',
        reason: 'privacy-mode',
        detail: '隐私模式开启：截图不出本机；本机也没有端侧视觉模型，因此不发起云端分析',
      }
    }

    const provider = this.resolveScreenshotProvider()
    if (!provider) {
      return {
        status: 'unavailable',
        reason: 'screenshot-provider-absent',
        detail: '未注入 ScreenshotProvider，当前运行时也没有可用的屏幕捕获',
      }
    }

    let snapshot: ImagePayload | null
    try {
      snapshot = await provider.capture()
    } catch (error) {
      return { status: 'error', reason: 'screenshot-capture-failed', detail: errorMessage(error) }
    }
    if (!snapshot) {
      return {
        status: 'unavailable',
        reason: 'screenshot-provider-absent',
        detail: '截图 provider 返回空：当前环境不支持屏幕捕获',
      }
    }

    return this.visionClient.analyzeImageData(snapshot)
  }

  /** 宠物「看看」功能 */
  async petLookAtScreen(): Promise<string> {
    const outcome = await this.analyzeScreenshot()
    if (outcome.status !== 'ok') {
      console.warn(`[VisualPerception] Pet look at screen unavailable: ${outcome.reason}（${outcome.detail}）`)
      return '抱歉，我现在还看不到屏幕内容呢...'
    }
    return this.generatePetResponse(outcome.result)
  }

  /** 生成宠物回应 */
  private generatePetResponse(result: ImageAnalysisResult): string {
    const responses: string[] = []

    if (result.description) {
      responses.push(result.description.substring(0, 100))
    }

    if (result.objects && result.objects.length > 0) {
      const objNames = result.objects.slice(0, 3).map((o) => o.name)
      if (objNames.length > 0) {
        responses.push(`我看到有 ${objNames.join(', ')}`)
      }
    }

    return responses.join('。') || '我在看着呢！'
  }

  /** 截图来源：显式注入（含 null）优先，未指定时才用默认的 Tauri provider */
  private resolveScreenshotProvider(): ScreenshotProvider | null {
    if ('screenshotProvider' in this.deps) {
      return this.deps.screenshotProvider ?? null
    }
    return createTauriScreenshotProvider()
  }

  /** 检查是否可用：启用 + 有客户端 + 客户端真的发得出图 */
  isAvailable(): boolean {
    return this.enabled && this.visionClient !== null && this.visionClient.getAvailability().available
  }

  /** 状态快照（含截图来源），用于排障与 UI 提示 */
  getStatus(): VisualPerceptionStatus {
    const clientStatus = this.visionClient?.getStatus()
    const hasInjected = 'screenshotProvider' in this.deps
    const screenshotSource: VisualPerceptionStatus['screenshotSource'] = hasInjected
      ? this.deps.screenshotProvider
        ? 'injected'
        : 'none'
      : isTauriRuntime()
        ? 'tauri'
        : 'none'

    const base: VisualPerceptionStatus = {
      enabled: this.enabled,
      privacyMode: this.privacyMode,
      screenshotSource,
      provider: clientStatus?.provider ?? '',
      supportsImages: clientStatus?.supportsImages ?? false,
      ready: Boolean(clientStatus?.ready) && screenshotSource !== 'none',
    }
    if (base.ready) return base

    if (clientStatus && !clientStatus.ready) {
      return { ...base, reason: clientStatus.reason, detail: clientStatus.detail }
    }
    if (screenshotSource === 'none') {
      return {
        ...base,
        reason: 'screenshot-provider-absent',
        detail: '没有截图来源：未注入 provider，且当前不是 Tauri 运行时',
      }
    }
    return { ...base, reason: 'perception-disabled', detail: '视觉感知未启用' }
  }
}

// ============ 单例 ============

let instance: VisualPerceptionManager | null = null

export function getVisualPerceptionManager(deps?: VisualPerceptionDeps): VisualPerceptionManager {
  if (!instance) {
    instance = new VisualPerceptionManager(deps)
  }
  return instance
}

/** 重置单例（测试与切换依赖时用） */
export function resetVisualPerceptionManager(): void {
  instance = null
}
