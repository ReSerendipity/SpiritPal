/**
 * LLM 统一客户端模块
 *
 * @fileoverview 多服务商 LLM 流式调用统一封装，支持 OpenAI/Claude/Gemini/Ollama 等
 *
 * 主要模块：
 * - fetchWithTimeout: 带超时控制的 fetch 封装
 * - computeRetryDelay: 指数退避+全抖动重试延迟计算
 * - streamChat: 流式聊天主函数（支持多服务商）
 * - detectOllama/parseSSEStream/parseOllamaStream: 服务商适配
 *
 * 依赖关系：
 * - types.ts: AIConfig, ChatMessage, CharacterProfile 类型
 * - llmProviders.ts: 服务商配置与 OLLAMA_TAGS_URL
 * - sseUtils.ts: SSE 流解析工具
 * - jsonUtils.ts: JSON 提取工具
 *
 * 核心接口：
 * - streamChat(): 流式聊天调用，返回 AsyncGenerator
 * - fetchWithTimeout(): 带超时和取消支持的 fetch
 *
 * 支持服务商：
 * - OpenAI 兼容格式: OpenAI, DeepSeek, Qwen, GLM, Kimi, Doubao, 自定义
 * - Ollama: 本地模型（/api/chat 逐行 JSON）
 * - Claude: Anthropic Claude（/v1/messages SSE）
 * - Gemini: Google Gemini（:streamGenerateContent SSE）
 *
 * 安全特性：
 * - 30秒请求超时
 * - 最多2次重试（指数退避+全抖动）
 * - 错误响应脱敏（密钥/Token 抹除）
 * - AbortController 中断支持
 */
import type { AIConfig, ChatMessage, CharacterProfile } from './types'
import { OLLAMA_TAGS_URL } from './llmProviders'
// [Quality Review] DRY 提取：共享 SSE 流解析和 JSON 提取逻辑
import { readTextStream, type StreamLineType } from './sseUtils'
import { extractJSONString } from './jsonUtils'
import { runtimeMonitor } from './runtimeMonitor'
// SECURITY R-09: SSRF 防护 — LLM 请求使用 safeFetch 替代原生 fetch
import { safeFetch } from './ssrfProtection'

// ============ LLM 请求超时与重试常量 ============
const LLM_REQUEST_TIMEOUT_MS = 30000
const LLM_RETRY_MAX = 2
const LLM_RETRY_BASE_DELAY_MS = 1000
// OPTIMIZE: Ollama 探测超时外置为常量，消除魔法数字
const OLLAMA_DETECT_TIMEOUT_MS = 2000
// SECURITY: 错误响应体最大回显长度，防止泄漏过多服务端信息
const MAX_ERROR_TEXT_LENGTH = 500

/**
 * SECURITY: 脱敏错误响应文本。
 * 部分 LLM 服务在 4xx/5xx 响应体中回显请求头（含 Authorization / api-key），
 * 直接透出会污染日志与 UI。此处截断并抹除常见密钥模式。
 *
 * R-13 v2.0: 补齐国内厂商密钥格式脱敏：
 * - DeepSeek / 通义百炼 DashScope / 月之暗面 Moonshot / 智谱 AI GLM：均使用 sk- 前缀（已覆盖）
 * - 百度千帆 ERNIE：Bearer <access_token>（统一 Bearer 脱敏覆盖）
 * - 腾讯云 Hunyuan：Bearer <hex>（统一 Bearer 脱敏覆盖）
 * - 统一长 Bearer token 保留前 12 字符（覆盖千帆、混元、OIDC 等通用 token 格式）
 * - 兜底：长度 >40 的连续十六进制 / base64 串，抹除前 8 位后的全部字符
 */
export function redactErrorText(text: string): string {
  if (!text) return ''
  const truncated = text.length > MAX_ERROR_TEXT_LENGTH
    ? text.slice(0, MAX_ERROR_TEXT_LENGTH) + '...'
    : text
  return truncated
    // SECURITY R-13: 脱敏 OpenAI 风格 sk- 密钥（覆盖 OpenAI / DeepSeek / Qwen / GLM / Kimi / Doubao）
    .replace(/(sk-[A-Za-z0-9]{8})[A-Za-z0-9]*/g, '$1***')
    // SECURITY R-13: 脱敏 Anthropic 密钥 sk-ant-
    .replace(/(sk-ant-[A-Za-z0-9]{8})[A-Za-z0-9-]*/g, '$1***')
    // SECURITY R-13: 脱敏 Google AI / Gemini 密钥 AIza
    .replace(/(AIza[A-Za-z0-9_-]{8})[A-Za-z0-9_-]*/g, '$1***')
    // SECURITY R-13 v2.0: 统一 Bearer token 脱敏（使用 replacer 函数避免双重匹配）
    // 覆盖千帆 ERNIE / 混元 Hunyuan / OIDC token / JWT 等通用 token 格式
    // token >= 12 字符：保留前 12 字符便于调试；token < 12 字符：全部抹除
    .replace(/(Bearer\s+)([A-Za-z0-9\-_.]+)/gi, (_match, prefix: string, token: string) =>
      token.length >= 12 ? `${prefix}${token.slice(0, 12)}***` : `${prefix}***`
    )
    // SECURITY R-13: 脱敏 x-api-key / x-goog-api-key / api-key 头回显
    .replace(/((?:x-api-key|x-goog-api-key|api-key)\s*[:=]\s*)[A-Za-z0-9._-]+/gi, '$1***')
    // SECURITY R-13: 脱敏通用的 api_key / apikey / api_key= / authorization 字段回显
    // 注意：使用 (?!Bearer\s) 负向前瞻，避免吃掉 Bearer 前缀（Bearer 由上方正则处理）
    .replace(/((?:api_key|apikey|api_key=|authorization)\s*[:=]\s*['"]?)(?!Bearer\s)[A-Za-z0-9._-]+/gi, '$1***')
    // SECURITY R-13 v2.0: 兜底 — 任何长度 >40 的连续十六进制 / base64 串，保留前 8 位
    .replace(/([A-Za-z0-9+/]{8})[A-Za-z0-9+/]{33,}/g, '$1***')
}

/**
 * 判断 URL 是否为本地回环地址
 * 回环地址（localhost / 127.0.0.1 / ::1 / 0.0.0.0）是用户显式配置的本地服务端点，
 * 不属于 SSRF 防护的目标范围（SSRF 防护针对攻击者可控的远程 URL）
 */
function isLoopbackUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname === '0.0.0.0'
    )
  } catch {
    return false
  }
}

/**
 * 带超时控制的 fetch
 * 使用 AbortController 在指定超时时间后中断请求
 * OPTIMIZE: 修复 userSignal 监听器未移除导致的内存泄漏（C8）
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = LLM_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const userSignal = options.signal
  // SECURITY: 若调用方已 abort，立即失败，避免无谓请求
  if (userSignal?.aborted) {
    clearTimeout(timeout)
    throw new Error('LLM 请求已取消')
  }
  // OPTIMIZE: 用 { once: true } + finally removeEventListener 双保险，杜绝监听器累积
  const onUserAbort = () => controller.abort()
  if (userSignal) {
    userSignal.addEventListener('abort', onUserAbort, { once: true })
  }
  try {
    // SECURITY R-09: SSRF 防护 — 对远程 URL 使用 safeFetch 拦截私有 IP 段。
    // 本地回环地址（localhost / 127.0.0.1 / ::1 / 0.0.0.0）是用户在设置中显式配置的
    // 本地服务（如 Ollama 默认 http://localhost:11434），直接放行原生 fetch，
    // 否则会破坏本地模型服务这一核心功能。
    const isLoopback = isLoopbackUrl(url)
    const response = isLoopback
      ? await fetch(url, { ...options, signal: controller.signal })
      : await safeFetch(url, { ...options, signal: controller.signal }, undefined, 'llm')
    return response
  } catch (err) {
    // E2: 精准区分超时 abort 与用户主动 abort
    if (err instanceof Error && (err.name === 'AbortError' || controller.signal.aborted)) {
      if (userSignal?.aborted) {
        throw new Error('LLM 请求已取消', { cause: err })
      }
      throw new Error(`LLM 请求超时（${timeoutMs / 1000}s）`, { cause: err })
    }
    throw err
  } finally {
    // E7: 清理定时器与监听器，防止泄漏
    clearTimeout(timeout)
    if (userSignal) {
      userSignal.removeEventListener('abort', onUserAbort)
    }
  }
}

/**
 * 计算重试退避延迟（指数退避 + 全抖动 full jitter）
 * OPTIMIZE: [E3] 抽取为独立函数以 DRY（原 fetchWithRetry 中两处重复计算）+ 便于单测
 *
 * 公式：delay = baseDelay * 2^attempt * random(0.5, 1.0)
 *
 * 全抖动（full jitter）的必要性：
 *   多客户端并发遭遇 5xx/网络故障时，若退避无抖动，所有客户端会在同一时刻重试，
 *   形成「雷群效应（thundering herd）」再次压垮服务端，引发抖动放大。
 *   引入 50%-100% 随机抖动可将重试分散到时间窗内，保护下游服务。
 *
 * 参考：AWS Architecture Blog "Exponential Backoff and Jitter"
 *
 * @param attempt 当前重试轮次（0 表示第一次重试前的等待）
 * @returns 实际等待毫秒数（已向下取整为整数）
 */
export function computeRetryDelay(attempt: number): number {
  const baseDelay = LLM_RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
  // E3: 50%-100% 全抖动，避免多客户端同步重试压垮服务端
  const jitter = 0.5 + Math.random() * 0.5
  return Math.floor(baseDelay * jitter)
}

/**
 * 带重试机制的 fetch（仅对 5xx 错误重试，4xx 不重试）
 * 使用指数退避 + 全抖动：第1次重试等 0.5-1s，第2次重试等 1-2s
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  timeoutMs?: number,
): Promise<Response> {
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= LLM_RETRY_MAX; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs)
      // 5xx 错误且还有重试次数时重试
      if (response.status >= 500 && attempt < LLM_RETRY_MAX) {
        await new Promise((resolve) => setTimeout(resolve, computeRetryDelay(attempt)))
        continue
      }
      return response
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      // 网络错误/超时且还有重试次数时重试
      if (attempt < LLM_RETRY_MAX) {
        await new Promise((resolve) => setTimeout(resolve, computeRetryDelay(attempt)))
        continue
      }
    }
  }
  throw lastError ?? new Error('LLM 请求失败')
}

// ============ LLM 客户端 ============
export class LLMClient {
  private config: AIConfig

  constructor(config: AIConfig) {
    this.config = config
  }

  // 更新配置
  updateConfig(config: AIConfig): void {
    this.config = config
  }

  // 获取当前配置
  getConfig(): AIConfig {
    return this.config
  }

  // 流式聊天：通过回调推送增量文本
  // onChunk 每收到一个文本片段时被调用
  // abortSignal 用于中断生成
  // 根据 provider id 分发到不同的协议实现
  async chat(
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const provider = this.config.provider
    const llmHandle = runtimeMonitor.startLLMCall(provider)
    try {
      let result: string
      if (provider === 'ollama') {
        result = await this.chatOllama(messages, onChunk, abortSignal)
      } else if (provider === 'claude') {
        result = await this.chatClaude(messages, onChunk, abortSignal)
      } else if (provider === 'gemini') {
        result = await this.chatGemini(messages, onChunk, abortSignal)
      } else {
        result = await this.chatOpenAI(messages, onChunk, abortSignal)
      }
      runtimeMonitor.endLLMCall(llmHandle, false)
      return result
    } catch (e) {
      runtimeMonitor.endLLMCall(llmHandle, true)
      throw e
    }
  }

  // ============ OpenAI 兼容格式 ============
  // 适用于 deepseek/openai/qwen/glm/kimi/doubao/custom
  // 拼接 chat completions 端点
  private getEndpoint(): string {
    const base = this.config.baseUrl.replace(/\/+$/, '')
    // 若已包含 /chat/completions 则直接用
    if (base.endsWith('/chat/completions')) return base
    // 若以 /v1 或类似结尾，直接补全
    return `${base}/chat/completions`
  }

  // 构建请求头
  private buildHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    }
    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`
    }
    return headers
  }

  // 构建请求体
  private buildBody(messages: ChatMessage[]): string {
    const apiMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))
    return JSON.stringify({
      model: this.config.model,
      messages: apiMessages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      stream: true,
    })
  }

  // OpenAI 兼容流式：SSE data: 行，json.choices[0].delta.content
  // [Quality Review] 使用 readTextStream 消除重复的流解析逻辑
  private async chatOpenAI(
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const endpoint = this.getEndpoint()
    const response = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: this.buildBody(messages),
      signal: abortSignal,
    })

    if (!response.ok) {
      // SECURITY: 脱敏错误响应体，防止 API Key 被回显后泄漏
      const errText = await response.text().catch(() => '')
      throw new Error(`LLM 请求失败 (${response.status}): ${redactErrorText(errText)}`)
    }
    if (!response.body) {
      throw new Error('响应中没有可读流')
    }

    return readTextStream(
      response.body,
      {
        lineType: 'sse' as StreamLineType,
        extractDelta: (json: unknown) => {
          const j = json as { choices?: { delta?: { content?: string } }[] }
          return j?.choices?.[0]?.delta?.content ?? null
        },
      },
      onChunk,
    )
  }

  // ============ Ollama 本地 ============
  // POST /api/chat，请求体 {model, messages, stream: true}
  // 响应为逐行 JSON，每行 {message: {content}, done: bool}
  // [Quality Review] 使用 readTextStream 消除重复的流解析逻辑
  private async chatOllama(
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const base = this.config.baseUrl.replace(/\/+$/, '')
    const endpoint = `${base}/api/chat`
    const apiMessages = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }))
    const body = JSON.stringify({
      model: this.config.model,
      messages: apiMessages,
      options: { temperature: this.config.temperature },
      stream: true,
    })

    const response = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: abortSignal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`Ollama 请求失败 (${response.status}): ${redactErrorText(errText)}`)
    }
    if (!response.body) {
      throw new Error('响应中没有可读流')
    }

    return readTextStream(
      response.body,
      {
        lineType: 'raw_json' as StreamLineType,
        extractDelta: (json: unknown) => {
          const j = json as { message?: { content?: string } }
          return j?.message?.content ?? null
        },
        isTerminated: (json: unknown) => (json as { done?: boolean })?.done === true,
      },
      onChunk,
    )
  }

  // ============ Anthropic Claude ============
  // POST /v1/messages，请求头 x-api-key + anthropic-version
  // 请求体 {model, messages, max_tokens, stream: true}
  // system 角色消息需提取到顶层 system 字段
  // 流式响应为 SSE，event: content_block_delta 包含 delta.text
  // [Quality Review] 使用 readTextStream 消除重复的流解析逻辑
  private async chatClaude(
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const base = this.config.baseUrl.replace(/\/+$/, '')
    const endpoint = `${base}/v1/messages`

    // Claude 的 system 消息需放在顶层 system 字段，不能出现在 messages 中
    const systemParts = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
    const system = systemParts.length > 0 ? systemParts.join('\n\n') : undefined

    // 其余消息只保留 user/assistant
    const apiMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }))

    const bodyObj: Record<string, unknown> = {
      model: this.config.model,
      messages: apiMessages,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: true,
    }
    if (system !== undefined) {
      bodyObj.system = system
    }

    const response = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(bodyObj),
      signal: abortSignal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`Claude 请求失败 (${response.status}): ${redactErrorText(errText)}`)
    }
    if (!response.body) {
      throw new Error('响应中没有可读流')
    }

    return readTextStream(
      response.body,
      {
        lineType: 'sse' as StreamLineType,
        extractDelta: (json: unknown) => {
          const j = json as { type?: string; delta?: { text?: string } }
          return j?.type === 'content_block_delta' ? (j?.delta?.text ?? null) : null
        },
        isTerminated: (json: unknown) => (json as { type?: string })?.type === 'message_stop',
      },
      onChunk,
    )
  }

  // ============ Google Gemini ============
  // POST /v1beta/models/{model}:streamGenerateContent?alt=sse（API Key 通过 x-goog-api-key 头传递）
  // 请求体 {contents: [{role, parts: [{text}]}], systemInstruction, generationConfig}
  // assistant 角色需映射为 model；system 提取到 systemInstruction
  // 流式响应为 SSE，data: 行包含 {candidates:[{content:{parts:[{text}]}}]}
  // [Quality Review] 使用 readTextStream 消除重复的流解析逻辑
  private async chatGemini(
    messages: ChatMessage[],
    onChunk?: (chunk: string) => void,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    const base = this.config.baseUrl.replace(/\/+$/, '')
    const model = encodeURIComponent(this.config.model)
    const endpoint =
      `${base}/v1beta/models/${model}:streamGenerateContent` +
      `?alt=sse`

    // Gemini 的 system 消息需放在 systemInstruction 字段
    const systemParts = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
    const systemInstruction =
      systemParts.length > 0 ? { parts: [{ text: systemParts.join('\n\n') }] } : undefined

    // 其余消息映射为 contents，assistant -> model
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }))

    const bodyObj: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: this.config.temperature,
        maxOutputTokens: this.config.maxTokens,
      },
    }
    if (systemInstruction !== undefined) {
      bodyObj.systemInstruction = systemInstruction
    }

    const response = await fetchWithRetry(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': this.config.apiKey,
      },
      body: JSON.stringify(bodyObj),
      signal: abortSignal,
    })

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      throw new Error(`Gemini 请求失败 (${response.status}): ${redactErrorText(errText)}`)
    }
    if (!response.body) {
      throw new Error('响应中没有可读流')
    }

    return readTextStream(
      response.body,
      {
        lineType: 'sse' as StreamLineType,
        extractDelta: (json: unknown) => {
          const j = json as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
          const parts = j?.candidates?.[0]?.content?.parts
          if (!Array.isArray(parts)) return null
          const text = parts.map((p) => p?.text).filter((t): t is string => typeof t === 'string' && t.length > 0).join('')
          return text.length > 0 ? text : null
        },
      },
      onChunk,
    )
  }

  // 非流式聊天（一次性返回完整文本）
  async chatOnce(
    messages: ChatMessage[],
    abortSignal?: AbortSignal,
  ): Promise<string> {
    return this.chat(messages, undefined, abortSignal)
  }

  // ============ Chapter 6: 增强流式响应支持 ============

  /** 当前活跃的流式请求 AbortController（用于 abortStream） */
  private activeStreamController: AbortController | null = null

  /**
   * 流式聊天：AsyncGenerator 接口
   * 每次迭代产出一个 StreamChunk，包含增量文本和状态信息
   * 支持背压控制（backpressure）和中断
   *
   * @param messages 消息列表
   * @param abortSignal 外部中断信号
   * @yields StreamChunk 增量文本片段
   */
  async *chatStream(
    messages: ChatMessage[],
    abortSignal?: AbortSignal,
  ): AsyncGenerator<import('./llmProviders').StreamChunk> {
    // 创建 AbortController 管理流式请求
    const controller = new AbortController()
    this.activeStreamController = controller

    // 连接外部中断信号
    const onExternalAbort = () => controller.abort()
    if (abortSignal) {
      if (abortSignal.aborted) {
        this.activeStreamController = null
        return
      }
      abortSignal.addEventListener('abort', onExternalAbort, { once: true })
    }

    try {
      const provider = this.config.provider
      const providerId = provider

      // 使用现有的 chat 方法，通过 onChunk 回调桥接到 generator
      const chunkQueue: import('./llmProviders').StreamChunk[] = []
      let resolveNext: (() => void) | null = null
      let done = false
      let error: Error | null = null

      const onChunk = (chunk: string) => {
        const streamChunk: import('./llmProviders').StreamChunk = {
          delta: chunk,
          done: false,
          providerId,
        }
        chunkQueue.push(streamChunk)
        if (resolveNext) {
          const fn = resolveNext
          resolveNext = null
          fn()
        }
      }

      // 在后台执行 chat
      const chatPromise = this.chat(messages, (chunk) => {
        try { onChunk(chunk) } catch (e) { console.error('[LLMClient] onChunk error:', e) }
      }, controller.signal)
        .then(() => {
          done = true
          // 发送最后一个 done chunk
          chunkQueue.push({ delta: '', done: true, providerId })
          if (resolveNext) {
            const fn = resolveNext
            resolveNext = null
            fn()
          }
        })
        .catch((e) => {
          error = e instanceof Error ? e : new Error(String(e))
          done = true
          if (resolveNext) {
            const fn = resolveNext
            resolveNext = null
            fn()
          }
        })

      // 产出 chunks（使用读指针避免 shift() O(n) 开销）
      let readIdx = 0
      while (!done || readIdx < chunkQueue.length) {
        if (readIdx < chunkQueue.length) {
          yield chunkQueue[readIdx++]!
          // 定期清理已消费的chunks，防止数组无限增长
          if (readIdx > 100) {
            chunkQueue.splice(0, readIdx)
            readIdx = 0
          }
        } else if (!done) {
          // 等待下一个 chunk
          await new Promise<void>((resolve) => {
            resolveNext = resolve
          })
        }
      }

      // 检查是否有错误
      if (error) {
        throw error
      }

      // 等待 chat 完成
      await chatPromise
    } finally {
      this.activeStreamController = null
      if (abortSignal) {
        abortSignal.removeEventListener('abort', onExternalAbort)
      }
    }
  }

  /**
   * 中断当前流式请求
   * 调用后当前 chatStream generator 将停止产出
   */
  abortStream(): void {
    if (this.activeStreamController) {
      this.activeStreamController.abort()
      this.activeStreamController = null
    }
  }

  // 获取 Ollama 可用模型列表（空数组表示服务不可用）
  static async fetchOllamaModels(): Promise<string[]> {
    try {
      const controller = new AbortController()
      // OPTIMIZE: 超时常量外置
      const timeout = setTimeout(() => controller.abort(), OLLAMA_DETECT_TIMEOUT_MS)
      const res = await fetch(OLLAMA_TAGS_URL, {
        signal: controller.signal,
      })
      clearTimeout(timeout)
      if (!res.ok) return []
      const data = await res.json()
      if (!Array.isArray(data?.models)) return []
      return data.models.map((m: { name?: string }) => m.name).filter(Boolean)
    } catch {
      return []
    }
  }

  // 检测本地 Ollama 服务是否可用
  static async detectOllama(): Promise<boolean> {
    return (await this.fetchOllamaModels()).length > 0
  }

  // 获取 Ollama 可用模型列表（向后兼容包装）
  static async listOllamaModels(): Promise<string[]> {
    return this.fetchOllamaModels()
  }

  // ============ Task 2: LLM 情绪驱动 — 表情选择 ============

  /**
   * 让 LLM 从可用表情列表中选择最合适的表情
   * @param context 当前对话/场景上下文
   * @param availableExpressions 可用表情 ID 列表
   * @returns 选中的表情 ID（若失败返回 null）
   */
  async selectEmotion(
    context: string,
    availableExpressions: string[],
  ): Promise<string | null> {
    if (availableExpressions.length === 0) return null

    const systemPrompt = `你是一个桌面宠物的情绪选择器。根据当前上下文，从可用表情列表中选择最合适的一个表情。
只返回表情 ID，不要包含其他文本。

可用表情：${availableExpressions.join(', ')}`

    try {
      const messages: ChatMessage[] = [
        { id: `sel-${Date.now()}-sys`, role: 'system', content: systemPrompt, timestamp: Date.now() },
        { id: `sel-${Date.now()}-usr`, role: 'user', content: context, timestamp: Date.now() },
      ]
      const response = await this.chat(messages)
      const selected = response.trim().toLowerCase()
      // 验证返回的表情 ID 是否在可用列表中
      const match = availableExpressions.find(
        e => e.toLowerCase() === selected,
      )
      return match ?? null
    } catch {
      return null
    }
  }

  // ============ Task 7: 向量记忆扩展 — LLM 自主提取 ============

  /**
   * 从对话中提取值得记忆的信息
   * @param context 对话上下文
   * @returns 需要记忆的内容列表
   */
  async extractMemories(context: string): Promise<string[]> {
    const systemPrompt = `你是一个记忆提取器。从给定的对话上下文中，提取值得长期记忆的信息。
包括：用户偏好、重要事件、情感表达、习惯模式、人际关系等。
返回 JSON 数组格式，每个元素是一条值得记忆的信息。
如果没有值得记忆的信息，返回空数组 []。
只返回 JSON，不要包含其他文本。`

    try {
      const messages: ChatMessage[] = [
        { id: `mem-${Date.now()}-sys`, role: 'system', content: systemPrompt, timestamp: Date.now() },
        { id: `mem-${Date.now()}-usr`, role: 'user', content: context, timestamp: Date.now() },
      ]
      const response = await this.chat(messages)
      const extracted = extractJSONString(response)
      if (!extracted) return []
      const parsed = JSON.parse(extracted)
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string')
      }
      return []
    } catch {
      return []
    }
  }
}

// ============ 默认配置 ============
export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'deepseek',
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  temperature: 0.8,
  maxTokens: 1024,
}

// 单例客户端（使用默认配置）
// SECURITY/E8: sharedClient 仅承载默认配置；传入自定义 config 时返回独立实例，
// 避免并发调用（如角色生成 + 聊天）相互覆盖配置导致的数据错乱。
let sharedClient: LLMClient | null = null

export function getLLMClient(config?: AIConfig): LLMClient {
  if (!sharedClient) {
    sharedClient = new LLMClient(config ?? DEFAULT_AI_CONFIG)
    return sharedClient
  }
  if (config) {
    // OPTIMIZE: 返回独立实例，不污染共享单例，消除并发竞态
    return new LLMClient(config)
  }
  return sharedClient
}

// ============ AI 辅助生成角色配置 ============
// 根据用户描述生成宠物角色配置（Partial<CharacterProfile>）
// 使用当前配置的 LLM provider，非流式调用
const CHARACTER_GEN_SYSTEM_PROMPT = `根据用户描述，生成一个宠物角色配置。返回 JSON 格式，包含 name, personality (五维参数), systemPrompt, catchphrase, background 字段。

要求：
1. name: 角色名称（简洁，2-4字）
2. personality: 五维性格参数，每个值为 -1 到 1 之间的小数
   - warmth: 温度（-1=冷漠, 1=温暖）
   - liveliness: 活泼（-1=沉静, 1=活泼）
   - dependence: 依赖（-1=独立, 1=粘人）
   - directness: 直率（-1=含蓄, 1=直率）
   - rationality: 理性（-1=感性, 1=理性）
3. systemPrompt: 角色的 LLM System Prompt，详细描述角色性格、说话方式、背景故事
4. catchphrase: 角色口头禅
5. background: 角色背景故事（1-2句话）

请严格按照 JSON 格式返回，不要包含其他文本。JSON 格式示例：
{
  "name": "小喵",
  "personality": { "warmth": 0.8, "liveliness": 0.6, "dependence": 0.7, "directness": -0.2, "rationality": -0.3 },
  "systemPrompt": "你是小喵...",
  "catchphrase": "喵～",
  "background": "一只来自..."
}`

// [Quality Review] DRY 提取：使用 jsonUtils.ts 中的 extractJSONString 替代本地实现
// 保留函数名以维持向后兼容
const extractJSON = extractJSONString

export async function generateCharacterFromDescription(
  description: string,
  config?: AIConfig,
): Promise<Partial<CharacterProfile>> {
  const client = getLLMClient(config)
  const messages: ChatMessage[] = [
    { id: 'sys', role: 'system', content: CHARACTER_GEN_SYSTEM_PROMPT, timestamp: Date.now() },
    { id: 'user', role: 'user', content: description, timestamp: Date.now() },
  ]
  const rawText = await client.chatOnce(messages)

  const jsonStr = extractJSON(rawText)
  if (!jsonStr) {
    throw new Error('AI 返回的内容中未找到有效的 JSON 配置')
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(jsonStr)
  } catch (e) {
    throw new Error(`AI 返回的 JSON 解析失败：${e instanceof Error ? e.message : '未知错误'}`, { cause: e })
  }

  // 映射到 Partial<CharacterProfile>
  const result: Partial<CharacterProfile> = {}

  if (typeof parsed.name === 'string') {
    result.name = parsed.name
    result.displayName = parsed.name
    // SECURITY: ID 生成保留 Date.now() 但附加随机段，降低碰撞概率
    result.id = `custom-${parsed.name.toLowerCase().replace(/\s+/g, '-')}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  if (parsed.personality && typeof parsed.personality === 'object') {
    const p = parsed.personality as Record<string, unknown>
    result.personality = {
      warmth: typeof p.warmth === 'number' ? p.warmth : 0,
      liveliness: typeof p.liveliness === 'number' ? p.liveliness : 0,
      dependence: typeof p.dependence === 'number' ? p.dependence : 0,
      directness: typeof p.directness === 'number' ? p.directness : 0,
      rationality: typeof p.rationality === 'number' ? p.rationality : 0,
    }
  }

  if (typeof parsed.systemPrompt === 'string') {
    result.systemPrompt = parsed.systemPrompt
  }

  if (typeof parsed.catchphrase === 'string') {
    result.signaturePhrase = parsed.catchphrase
  }

  if (typeof parsed.background === 'string') {
    result.birthBackground = parsed.background
  }

  return result
}
