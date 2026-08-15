// llmProviders 单元测试 — LLM 服务商预设完整性、Ollama 检测
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  LLM_PROVIDERS,
  getProvider,
  OLLAMA_TAGS_URL,
  detectOllama,
  listOllamaModels,
} from '../llmProviders'

const EXPECTED_PROVIDER_IDS = [
  'deepseek',
  'openai',
  'qwen',
  'glm',
  'kimi',
  'doubao',
  'ollama',
  'claude',
  'gemini',
  'custom',
]

describe('LLM_PROVIDERS', () => {
  it('包含 10 个服务商', () => {
    expect(LLM_PROVIDERS).toHaveLength(10)
  })

  it('每个 provider 配置完整（id/name/baseUrl/apiKeyRequired）', () => {
    for (const p of LLM_PROVIDERS) {
      expect(typeof p.id).toBe('string')
      expect(p.id.length).toBeGreaterThan(0)
      expect(typeof p.name).toBe('string')
      expect(p.name.length).toBeGreaterThan(0)
      expect(typeof p.baseUrl).toBe('string')
      expect(typeof p.apiKeyRequired).toBe('boolean')
      expect(Array.isArray(p.models)).toBe(true)
    }
  })

  it('provider id 唯一', () => {
    const ids = LLM_PROVIDERS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('包含所有预期 id', () => {
    const ids = LLM_PROVIDERS.map((p) => p.id)
    for (const id of EXPECTED_PROVIDER_IDS) {
      expect(ids).toContain(id)
    }
  })

  it('Ollama 配置存在且 apiKeyRequired=false', () => {
    const ollama = getProvider('ollama')
    expect(ollama).toBeDefined()
    expect(ollama!.apiKeyRequired).toBe(false)
    expect(ollama!.baseUrl).toContain('localhost')
  })

  it('Claude 配置存在', () => {
    const claude = getProvider('claude')
    expect(claude).toBeDefined()
    expect(claude!.apiKeyRequired).toBe(true)
    expect(claude!.baseUrl).toContain('anthropic')
  })

  it('Gemini 配置存在', () => {
    const gemini = getProvider('gemini')
    expect(gemini).toBeDefined()
    expect(gemini!.apiKeyRequired).toBe(true)
    expect(gemini!.baseUrl).toContain('googleapis')
  })

  it('OpenAI 配置存在且有默认模型', () => {
    const openai = getProvider('openai')
    expect(openai).toBeDefined()
    expect(openai!.apiKeyRequired).toBe(true)
    expect(openai!.defaultModel).toBeTruthy()
    expect(openai!.models.length).toBeGreaterThan(0)
  })

  it('除 Ollama 外所有 provider apiKeyRequired=true', () => {
    for (const p of LLM_PROVIDERS) {
      if (p.id === 'ollama') {
        expect(p.apiKeyRequired).toBe(false)
      } else {
        expect(p.apiKeyRequired).toBe(true)
      }
    }
  })
})

describe('getProvider', () => {
  it('按 id 返回对应 provider', () => {
    const p = getProvider('deepseek')
    expect(p).toBeDefined()
    expect(p!.id).toBe('deepseek')
  })

  it('未知 id 返回 undefined', () => {
    expect(getProvider('nonexistent')).toBeUndefined()
  })
})

describe('OLLAMA_TAGS_URL', () => {
  it('指向本地 Ollama tags 端点', () => {
    expect(OLLAMA_TAGS_URL).toBe('http://localhost:11434/api/tags')
  })
})

describe('detectOllama', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('服务可用时返回 true', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: [{ name: 'llama3' }] }), { status: 200 }),
    )
    expect(await detectOllama()).toBe(true)
  })

  it('HTTP 错误时返回 false', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 500 }))
    expect(await detectOllama()).toBe(false)
  })

  it('fetch 抛错时返回 false', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'))
    expect(await detectOllama()).toBe(false)
  })

  it('返回非数组 models 时返回 false', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ models: 'not-an-array' }), { status: 200 }),
    )
    expect(await detectOllama()).toBe(false)
  })
})

describe('listOllamaModels', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('返回模型名称列表', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ models: [{ name: 'llama3:latest' }, { name: 'qwen2:latest' }] }),
        { status: 200 },
      ),
    )
    const models = await listOllamaModels()
    expect(models).toEqual(['llama3:latest', 'qwen2:latest'])
  })

  it('HTTP 错误返回空数组', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(new Response('', { status: 404 }))
    expect(await listOllamaModels()).toEqual([])
  })

  it('fetch 抛错返回空数组', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('fail'))
    expect(await listOllamaModels()).toEqual([])
  })

  it('过滤掉无 name 字段的模型', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ models: [{ name: 'llama3' }, { version: '1.0' }, { name: '' }] }),
        { status: 200 },
      ),
    )
    const models = await listOllamaModels()
    // 空 name 会被 Boolean(n) 过滤掉
    expect(models).toEqual(['llama3'])
  })
})
