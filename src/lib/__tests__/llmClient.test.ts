// llmClient 模块测试 — 多服务商 LLM 流式调用
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../llmProviders', () => ({
  OLLAMA_TAGS_URL: 'http://localhost:11434/api/tags',
}))

import { LLMClient, DEFAULT_AI_CONFIG, getLLMClient, generateCharacterFromDescription, fetchWithTimeout, computeRetryDelay } from '../llmClient'

// 辅助：创建 mock ReadableStream
function createReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
}

// 辅助：创建 mock Response
function createMockResponse(stream: ReadableStream<Uint8Array>, ok = true, status = 200): Response {
  return {
    ok,
    status,
    body: stream,
    text: () => Promise.resolve(''),
    json: () => Promise.resolve({}),
  } as unknown as Response
}

describe('LLMClient', () => {
  let client: LLMClient

  beforeEach(() => {
    vi.clearAllMocks()
    client = new LLMClient({
      provider: 'deepseek',
      apiKey: 'sk-test',
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
      temperature: 0.8,
      maxTokens: 1024,
    })
  })

  describe('配置管理', () => {
    it('updateConfig 更新配置', () => {
      client.updateConfig({ ...client.getConfig(), model: 'new-model' })
      expect(client.getConfig().model).toBe('new-model')
    })

    it('getConfig 返回当前配置', () => {
      const config = client.getConfig()
      expect(config.provider).toBe('deepseek')
      expect(config.apiKey).toBe('sk-test')
    })
  })

  describe('chat OpenAI 兼容格式', () => {
    it('流式返回完整文本', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        'data: {"choices":[{"delta":{"content":" World"}}]}\n',
        'data: [DONE]\n',
      ]
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
        createMockResponse(createReadableStream(sseChunks))
      )))

      const chunks: string[] = []
      const result = await client.chat(
        [{ id: '1', role: 'user', content: 'hi', timestamp: 0 }],
        (chunk) => chunks.push(chunk),
      )
      expect(result).toBe('Hello World')
      expect(chunks).toEqual(['Hello', ' World'])
    })

    it('请求失败时抛出错误', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
        createMockResponse(createReadableStream([]), false, 500)
      )))
      await expect(
        client.chat([{ id: '1', role: 'user', content: 'hi', timestamp: 0 }]),
      ).rejects.toThrow('LLM 请求失败')
    })

    it('无 body 时抛出错误', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        body: null,
      } as unknown as Response)))
      await expect(
        client.chat([{ id: '1', role: 'user', content: 'hi', timestamp: 0 }]),
      ).rejects.toThrow('可读流')
    })

    it('chatOnce 返回完整文本（无回调）', async () => {
      const sseChunks = [
        'data: {"choices":[{"delta":{"content":"Hi"}}]}\n',
        'data: [DONE]\n',
      ]
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
        createMockResponse(createReadableStream(sseChunks))
      )))
      const result = await client.chatOnce([
        { id: '1', role: 'user', content: 'hi', timestamp: 0 },
      ])
      expect(result).toBe('Hi')
    })
  })

  describe('chat Ollama', () => {
    it('逐行 JSON 流式返回', async () => {
      const ollamaChunks = [
        '{"message":{"content":"Hello"},"done":false}\n',
        '{"message":{"content":" World"},"done":false}\n',
        '{"message":{"content":""},"done":true}\n',
      ]
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
        createMockResponse(createReadableStream(ollamaChunks))
      )))
      const ollamaClient = new LLMClient({
        provider: 'ollama',
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama2',
        temperature: 0.8,
        maxTokens: 1024,
      })
      const result = await ollamaClient.chat([
        { id: '1', role: 'user', content: 'hi', timestamp: 0 },
      ])
      expect(result).toBe('Hello World')
    })

    it('Ollama 请求失败时抛出错误', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
        createMockResponse(createReadableStream([]), false, 404)
      )))
      const ollamaClient = new LLMClient({
        provider: 'ollama',
        apiKey: '',
        baseUrl: 'http://localhost:11434',
        model: 'llama2',
        temperature: 0.8,
        maxTokens: 1024,
      })
      await expect(
        ollamaClient.chat([{ id: '1', role: 'user', content: 'hi', timestamp: 0 }]),
      ).rejects.toThrow('Ollama 请求失败')
    })
  })

  describe('chat Claude', () => {
    it('SSE 流式返回 delta.text', async () => {
      const claudeChunks = [
        'data: {"type":"content_block_delta","delta":{"text":"Hello"}}\n',
        'data: {"type":"content_block_delta","delta":{"text":" Claude"}}\n',
        'data: {"type":"message_stop"}\n',
      ]
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
        createMockResponse(createReadableStream(claudeChunks))
      )))
      const claudeClient = new LLMClient({
        provider: 'claude',
        apiKey: 'sk-ant-test',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-3',
        temperature: 0.7,
        maxTokens: 1024,
      })
      const result = await claudeClient.chat([
        { id: '1', role: 'system', content: 'You are helpful', timestamp: 0 },
        { id: '2', role: 'user', content: 'hi', timestamp: 0 },
      ])
      expect(result).toBe('Hello Claude')
    })

    it('Claude 请求失败时抛出错误', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
        createMockResponse(createReadableStream([]), false, 401)
      )))
      const claudeClient = new LLMClient({
        provider: 'claude',
        apiKey: 'bad',
        baseUrl: 'https://api.anthropic.com',
        model: 'claude-3',
        temperature: 0.7,
        maxTokens: 1024,
      })
      await expect(
        claudeClient.chat([{ id: '1', role: 'user', content: 'hi', timestamp: 0 }]),
      ).rejects.toThrow('Claude 请求失败')
    })
  })

  describe('chat Gemini', () => {
    it('SSE 流式返回 parts.text', async () => {
      const geminiChunks = [
        'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n',
        'data: {"candidates":[{"content":{"parts":[{"text":" Gemini"}]}}]}\n',
        'data: [DONE]\n',
      ]
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
        createMockResponse(createReadableStream(geminiChunks))
      )))
      const geminiClient = new LLMClient({
        provider: 'gemini',
        apiKey: 'gem-key',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini-pro',
        temperature: 0.7,
        maxTokens: 1024,
      })
      const result = await geminiClient.chat([
        { id: '1', role: 'system', content: 'Be helpful', timestamp: 0 },
        { id: '2', role: 'user', content: 'hi', timestamp: 0 },
      ])
      expect(result).toBe('Hello Gemini')
    })

    it('Gemini 请求失败时抛出错误', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
        createMockResponse(createReadableStream([]), false, 403)
      )))
      const geminiClient = new LLMClient({
        provider: 'gemini',
        apiKey: 'bad',
        baseUrl: 'https://generativelanguage.googleapis.com',
        model: 'gemini-pro',
        temperature: 0.7,
        maxTokens: 1024,
      })
      await expect(
        geminiClient.chat([{ id: '1', role: 'user', content: 'hi', timestamp: 0 }]),
      ).rejects.toThrow('Gemini 请求失败')
    })
  })

  describe('detectOllama', () => {
    it('检测成功返回 true', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ models: [{ name: 'llama2' }] }),
      } as unknown as Response)))
      expect(await LLMClient.detectOllama()).toBe(true)
    })

    it('检测失败返回 false', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('connect failed'))))
      expect(await LLMClient.detectOllama()).toBe(false)
    })

    it('返回非 models 数组返回 false', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ error: 'not found' }),
      } as unknown as Response)))
      expect(await LLMClient.detectOllama()).toBe(false)
    })
  })

  describe('listOllamaModels', () => {
    it('返回模型名列表', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          models: [{ name: 'llama2' }, { name: 'mistral' }],
        }),
      } as unknown as Response)))
      const models = await LLMClient.listOllamaModels()
      expect(models).toEqual(['llama2', 'mistral'])
    })

    it('请求失败返回空数组', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('failed'))))
      expect(await LLMClient.listOllamaModels()).toEqual([])
    })
  })
})

describe('DEFAULT_AI_CONFIG', () => {
  it('包含默认 provider', () => {
    expect(DEFAULT_AI_CONFIG.provider).toBe('deepseek')
  })
  it('包含默认 baseUrl', () => {
    expect(DEFAULT_AI_CONFIG.baseUrl).toBeTruthy()
  })
})

describe('getLLMClient 单例', () => {
  it('无参数时使用默认配置创建', () => {
    const c = getLLMClient()
    expect(c).toBeDefined()
  })
  it('相同参数返回同一实例', () => {
    const c1 = getLLMClient()
    const c2 = getLLMClient()
    expect(c1).toBe(c2)
  })
})

describe('generateCharacterFromDescription', () => {
  it('从 LLM 响应中提取角色配置', async () => {
    // 使用 JSON.stringify 正确处理转义
    const charConfig = {
      name: '小喵',
      personality: { warmth: 0.8, liveliness: 0, dependence: 0, directness: 0, rationality: 0 },
      systemPrompt: '你是小喵',
      catchphrase: '喵~',
      background: '来自喵星',
    }
    const sseData = JSON.stringify({ choices: [{ delta: { content: JSON.stringify(charConfig) } }] })
    const sseChunks = [
      `data: ${sseData}\n`,
      'data: [DONE]\n',
    ]
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      createMockResponse(createReadableStream(sseChunks))
    )))
    const result = await generateCharacterFromDescription('一只可爱的猫咪')
    expect(result.name).toBe('小喵')
    expect(result.displayName).toBe('小喵')
    expect(result.id).toContain('custom-')
    expect(result.personality?.warmth).toBe(0.8)
    expect(result.systemPrompt).toBe('你是小喵')
    expect(result.signaturePhrase).toBe('喵~')
    expect(result.birthBackground).toBe('来自喵星')
  })

  it('从 ```json 代码块中提取', async () => {
    const charConfig = {
      name: '小白',
      personality: { warmth: 0.5, liveliness: 0, dependence: 0, directness: 0, rationality: 0 },
      systemPrompt: '你是小白',
      catchphrase: '白~',
      background: '测试',
    }
    const jsonContent = JSON.stringify(charConfig)
    const wrappedContent = '```json\n' + jsonContent + '\n```'
    const sseData = JSON.stringify({ choices: [{ delta: { content: wrappedContent } }] })
    const sseChunks = [
      `data: ${sseData}\n`,
      'data: [DONE]\n',
    ]
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      createMockResponse(createReadableStream(sseChunks))
    )))
    const result = await generateCharacterFromDescription('白色宠物')
    expect(result.name).toBe('小白')
  })

  it('LLM 返回非 JSON 时抛出错误', async () => {
    const sseData = JSON.stringify({ choices: [{ delta: { content: '这不是JSON' } }] })
    const sseChunks = [
      `data: ${sseData}\n`,
      'data: [DONE]\n',
    ]
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(
      createMockResponse(createReadableStream(sseChunks))
    )))
    await expect(generateCharacterFromDescription('test')).rejects.toThrow('未找到')
  })
})

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('请求超时后抛出包含「超时」的错误', async () => {
    vi.useFakeTimers()
    // mock fetch：监听 abort 信号，超时后以 AbortError 拒绝
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_, reject) => {
      options.signal?.addEventListener('abort', () => {
        const err = new Error('The operation was aborted')
        err.name = 'AbortError'
        reject(err)
      })
    })))
    const promise = fetchWithTimeout('https://example.com', {}, 1000)
    promise.catch(() => {}) // 防止未处理拒绝警告
    await vi.advanceTimersByTimeAsync(1500)
    await expect(promise).rejects.toThrow('超时')
  })

  it('超时前完成请求时正常返回 Response', async () => {
    const mockResponse = { ok: true, status: 200 } as unknown as Response
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(mockResponse)))
    const result = await fetchWithTimeout('https://example.com', {}, 5000)
    expect(result).toBe(mockResponse)
  })
})

// [REFACTOR] R4-A 回归测试：computeRetryDelay 抖动行为
// 验证 50%-100% 全抖动区间，避免未来回归破坏 thundering herd 防护
describe('computeRetryDelay', () => {
  it('attempt 0 的 delay 落在 [500, 1000] ms 区间内（50%-100% 抖动）', () => {
    for (let i = 0; i < 100; i++) {
      const delay = computeRetryDelay(0)
      // baseDelay = 1000 * 2^0 = 1000，jitter = 0.5-1.0 → 500-1000ms
      expect(delay).toBeGreaterThanOrEqual(500)
      expect(delay).toBeLessThanOrEqual(1000)
    }
  })

  it('attempt 1 的 delay 落在 [1000, 2000] ms 区间内（50%-100% 抖动）', () => {
    for (let i = 0; i < 100; i++) {
      const delay = computeRetryDelay(1)
      // baseDelay = 1000 * 2^1 = 2000，jitter = 0.5-1.0 → 1000-2000ms
      expect(delay).toBeGreaterThanOrEqual(1000)
      expect(delay).toBeLessThanOrEqual(2000)
    }
  })

  it('多次调用产生不同 delay 值（验证抖动随机性，非恒定）', () => {
    const samples = new Set<number>()
    for (let i = 0; i < 50; i++) {
      samples.add(computeRetryDelay(2))
    }
    // 50 次调用应至少产生 10 个不同的值（极低概率全是同一个值）
    expect(samples.size).toBeGreaterThanOrEqual(10)
  })

  it('返回值为整数（Math.floor 保证）', () => {
    for (let i = 0; i < 20; i++) {
      const delay = computeRetryDelay(3)
      expect(Number.isInteger(delay)).toBe(true)
    }
  })
})