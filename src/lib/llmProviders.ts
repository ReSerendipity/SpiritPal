/**
 * LLM 服务商配置与管理模块
 *
 * @fileoverview 定义多 LLM 服务商预设、统一接口、故障转移与成本追踪
 *
 * 主要模块：
 * - LLM_PROVIDERS: 服务商预设列表（DeepSeek/OpenAI/Qwen/GLM/Kimi/Doubao/Ollama/Claude/Gemini等）
 * - UnifiedLLMProvider: 统一接口封装（chat/chatStream/embed）
 * - FailoverConfig/ProviderHealthCheck: 故障转移与健康检查
 * - CostTracker: Token 用量与成本追踪
 *
 * 依赖关系：
 * - types.ts: AIConfig, ChatMessage, LLMProvider 类型定义
 *
 * 核心接口：
 * - LLM_PROVIDERS: 预设服务商配置数组
 * - getProviderConfig(): 获取指定服务商配置
 * - createUnifiedProvider(): 创建统一接口实例
 *
 * 支持服务商：
 * - 云端: DeepSeek, OpenAI, 千问(Qwen), 智谱GLM, Kimi, 豆包(Doubao), Claude, Gemini
 * - 本地: Ollama
 * - 自定义: 用户自定义 OpenAI 兼容端点
 *
 * 增强功能：
 * - 主备故障自动切换
 * - 服务商健康检查
 * - Token 消耗与成本统计
 */

import type { AIConfig, ChatMessage, LLMProvider } from './types'

// ============ 服务商预设 ============

export const LLM_PROVIDERS: LLMProvider[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    apiKeyRequired: true,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'],
    apiKeyRequired: true,
  },
  {
    id: 'qwen',
    name: '千问 (Qwen)',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen-plus',
    models: [
      'qwen-plus',
      'qwen-max',
      'qwen-turbo',
      'qwen-long',
      'qwen-coder-plus',
      'qwen-coder-turbo',
    ],
    apiKeyRequired: true,
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-4-flash',
    models: ['glm-4', 'glm-4-flash', 'glm-4-plus', 'glm-4-air', 'glm-4-flashx'],
    apiKeyRequired: true,
  },
  {
    id: 'kimi',
    name: 'Kimi (Moonshot)',
    baseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'moonshot/kimi-k2-0711-preview',
    models: [
      'moonshot/kimi-k2-0711-preview',
      'moonshot/kimi-k2-turbo-preview',
      'moonshot/kimi-k2.5-preview',
    ],
    apiKeyRequired: true,
  },
  {
    id: 'doubao',
    name: '豆包 (Doubao)',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-1.5-pro-32k',
    models: [
      'doubao-1.5-pro-32k',
      'doubao-1.5-pro-256k',
      'doubao-1.5-lite-32k',
      'doubao-pro-32k',
    ],
    apiKeyRequired: true,
  },
  {
    id: 'ollama',
    name: 'Ollama (本地)',
    baseUrl: 'http://localhost:11434',
    defaultModel: '',
    // 预设常用模型，运行时可通过 listOllamaModels 动态获取
    models: ['llama3', 'llama3.1', 'qwen2', 'qwen2.5', 'mistral', 'phi3'],
    apiKeyRequired: false,
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      'claude-sonnet-4-20250514',
      'claude-3-5-haiku-20241022',
      'claude-3-opus-20240229',
    ],
    apiKeyRequired: true,
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    apiKeyRequired: true,
  },
  {
    id: 'custom',
    name: '自定义 (Custom)',
    baseUrl: '',
    defaultModel: '',
    models: [],
    apiKeyRequired: true,
  },
]

// 根据 id 获取服务商预设
export function getProvider(id: string): LLMProvider | undefined {
  return LLM_PROVIDERS.find((p) => p.id === id)
}

// Ollama 本地服务检测地址
export const OLLAMA_TAGS_URL = 'http://localhost:11434/api/tags'

// 检测本地 Ollama 服务是否可用
// GET /api/tags 返回 { models: [...] }，2 秒超时
export async function detectOllama(): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(OLLAMA_TAGS_URL, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return false
    const data = await res.json()
    return Array.isArray(data?.models)
  } catch {
    return false
  }
}

// 获取 Ollama 可用模型列表
// GET /api/tags 返回 { models: [{ name: 'llama3:latest', ... }] }
export async function listOllamaModels(): Promise<string[]> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(OLLAMA_TAGS_URL, { signal: controller.signal })
    clearTimeout(timeout)
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data?.models)) return []
    return data.models
      .map((m: { name?: string }) => m.name)
      .filter((n: string | undefined): n is string => Boolean(n))
  } catch {
    return []
  }
}

// ============ 统一 LLM Provider 接口 ============
// 所有服务商实现统一接口，支持 chat/chatStream/embed

/** 流式响应 chunk */
export interface StreamChunk {
  /** 增量文本 */
  delta: string
  /** 是否为最后一个 chunk */
  done: boolean
  /** 来源 provider ID */
  providerId: string
}

/** 统一 LLM Provider 接口 */
export interface UnifiedLLMProvider {
  /** Provider 唯一标识 */
  id: string
  /** 非流式聊天 */
  chat(messages: ChatMessage[], abortSignal?: AbortSignal): Promise<string>
  /** 流式聊天 */
  chatStream(
    messages: ChatMessage[],
    onChunk: (chunk: StreamChunk) => void,
    abortSignal?: AbortSignal,
  ): Promise<string>
  /** 嵌入（可选，不是所有 provider 都支持） */
  embed?(texts: string[]): Promise<Float32Array[]>
}

// ============ Failover 配置 ============

/** Failover 配置：primary → secondary → tertiary */
export interface FailoverConfig {
  /** 主 provider */
  primary: AIConfig
  /** 备选 provider 列表（按优先级排序） */
  fallbacks: AIConfig[]
  /** 健康检查间隔（毫秒，默认 5 分钟） */
  healthCheckIntervalMs: number
  /** 连续失败次数阈值（超过后切换到下一个 provider，默认 3） */
  failureThreshold: number
  /** 冷却时间（失败后多久重试该 provider，默认 10 分钟） */
  cooldownMs: number
}

/** 默认 Failover 配置 */
export const DEFAULT_FAILOVER_CONFIG: Omit<FailoverConfig, 'primary'> = {
  fallbacks: [],
  healthCheckIntervalMs: 5 * 60 * 1000,
  failureThreshold: 3,
  cooldownMs: 10 * 60 * 1000,
}

// ============ Provider 健康检查 ============

/** Provider 健康状态 */
interface ProviderHealth {
  /** Provider ID */
  providerId: string
  /** 是否可用 */
  available: boolean
  /** 连续失败次数 */
  consecutiveFailures: number
  /** 最后失败时间戳 */
  lastFailureAt: number
  /** 最后成功时间戳 */
  lastSuccessAt: number
  /** 平均响应时间（毫秒） */
  avgResponseTime: number
  /** 响应时间样本 */
  responseTimeSamples: number[]
}

/**
 * Provider 健康检查管理器
 * 追踪每个 provider 的健康状态，支持自动 Failover
 */
export class ProviderHealthManager {
  private healthMap: Map<string, ProviderHealth> = new Map()
  private failureThreshold: number
  private cooldownMs: number

  constructor(failureThreshold = 3, cooldownMs = 10 * 60 * 1000) {
    this.failureThreshold = failureThreshold
    this.cooldownMs = cooldownMs
  }

  /** 记录成功调用 */
  recordSuccess(providerId: string, responseTimeMs: number): void {
    const health = this.getOrCreate(providerId)
    health.available = true
    health.consecutiveFailures = 0
    health.lastSuccessAt = Date.now()

    // 更新平均响应时间（保留最近 20 个样本）
    health.responseTimeSamples.push(responseTimeMs)
    if (health.responseTimeSamples.length > 20) {
      health.responseTimeSamples = health.responseTimeSamples.slice(-20)
    }
    health.avgResponseTime = Math.round(
      health.responseTimeSamples.reduce((a, b) => a + b, 0) / health.responseTimeSamples.length,
    )
  }

  /** 记录失败调用 */
  recordFailure(providerId: string): void {
    const health = this.getOrCreate(providerId)
    health.consecutiveFailures++
    health.lastFailureAt = Date.now()

    // 超过阈值标记为不可用
    if (health.consecutiveFailures >= this.failureThreshold) {
      health.available = false
    }
  }

  /** 检查 provider 是否可用（考虑冷却期） */
  isAvailable(providerId: string): boolean {
    const health = this.healthMap.get(providerId)
    if (!health) return true // 未知 provider 默认可用

    if (health.available) return true

    // 冷却期后重试
    if (Date.now() - health.lastFailureAt >= this.cooldownMs) {
      health.available = true
      health.consecutiveFailures = 0
      return true
    }

    return false
  }

  /** 获取或创建健康状态 */
  private getOrCreate(providerId: string): ProviderHealth {
    let health = this.healthMap.get(providerId)
    if (!health) {
      health = {
        providerId,
        available: true,
        consecutiveFailures: 0,
        lastFailureAt: 0,
        lastSuccessAt: 0,
        avgResponseTime: 0,
        responseTimeSamples: [],
      }
      this.healthMap.set(providerId, health)
    }
    return health
  }

  /** 获取所有 provider 的健康状态 */
  getAllHealth(): ProviderHealth[] {
    return Array.from(this.healthMap.values())
  }
}

// ============ 成本追踪 ============

/** Provider 成本记录 */
interface ProviderCost {
  /** Provider ID */
  providerId: string
  /** 总请求次数 */
  requestCount: number
  /** 总 token 数（输入 + 输出） */
  totalTokens: number
  /** 总成本（美元） */
  totalCostUsd: number
}

/** 模型定价信息 */
export interface ModelPricing {
  /** 输入 token 价格（美元 / 百万 token） */
  inputPricePerMillion: number
  /** 输出 token 价格（美元 / 百万 token） */
  outputPricePerMillion: number
}

/** 已知模型定价 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': { inputPricePerMillion: 2.5, outputPricePerMillion: 10 },
  'gpt-4o-mini': { inputPricePerMillion: 0.15, outputPricePerMillion: 0.6 },
  'deepseek-chat': { inputPricePerMillion: 0.14, outputPricePerMillion: 0.28 },
  'deepseek-reasoner': { inputPricePerMillion: 0.55, outputPricePerMillion: 2.19 },
  'qwen-plus': { inputPricePerMillion: 0.4, outputPricePerMillion: 1.2 },
  'glm-4-flash': { inputPricePerMillion: 0.1, outputPricePerMillion: 0.1 },
  'claude-sonnet-4-20250514': { inputPricePerMillion: 3, outputPricePerMillion: 15 },
  'gemini-2.0-flash': { inputPricePerMillion: 0.1, outputPricePerMillion: 0.4 },
}

/**
 * 成本追踪管理器
 * 记录每个 provider 的请求次数、token 消耗和成本
 */
export class CostTrackingManager {
  private costs: Map<string, ProviderCost> = new Map()

  /** 记录一次请求的成本 */
  recordRequest(
    providerId: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    const cost = this.getOrCreate(providerId)
    cost.requestCount++
    cost.totalTokens += inputTokens + outputTokens

    // 计算费用
    const pricing = MODEL_PRICING[model]
    if (pricing) {
      const inputCost = (inputTokens / 1_000_000) * pricing.inputPricePerMillion
      const outputCost = (outputTokens / 1_000_000) * pricing.outputPricePerMillion
      cost.totalCostUsd += inputCost + outputCost
    }
  }

  /** 获取指定 provider 的成本 */
  getCost(providerId: string): ProviderCost | undefined {
    return this.costs.get(providerId)
  }

  /** 获取所有 provider 的成本 */
  getAllCosts(): ProviderCost[] {
    return Array.from(this.costs.values())
  }

  /** 获取总成本 */
  getTotalCost(): number {
    let total = 0
    for (const cost of this.costs.values()) {
      total += cost.totalCostUsd
    }
    return total
  }

  private getOrCreate(providerId: string): ProviderCost {
    let cost = this.costs.get(providerId)
    if (!cost) {
      cost = {
        providerId,
        requestCount: 0,
        totalTokens: 0,
        totalCostUsd: 0,
      }
      this.costs.set(providerId, cost)
    }
    return cost
  }
}

// ============ 速率限制 ============

/** 速率限制配置 */
export interface RateLimitConfig {
  /** 窗口大小（毫秒） */
  windowMs: number
  /** 窗口内最大请求数 */
  maxRequests: number
}

/**
 * 简单的滑动窗口速率限制器
 */
export class RateLimiter {
  private requests: number[] = []
  private windowMs: number
  private maxRequests: number

  constructor(config: RateLimitConfig) {
    this.windowMs = config.windowMs
    this.maxRequests = config.maxRequests
  }

  /** 检查是否允许请求 */
  allowRequest(): boolean {
    const now = Date.now()
    // 清理过期请求
    this.requests = this.requests.filter((t) => now - t < this.windowMs)

    if (this.requests.length >= this.maxRequests) {
      return false
    }

    this.requests.push(now)
    return true
  }

  /** 获取当前窗口内请求数 */
  getCurrentCount(): number {
    const now = Date.now()
    return this.requests.filter((t) => now - t < this.windowMs).length
  }

  /** 获取距离下一个可用请求的等待时间（毫秒） */
  getWaitTime(): number {
    if (this.allowRequest()) return 0
    const oldest = this.requests[0]
    return oldest ? this.windowMs - (Date.now() - oldest) : 0
  }
}
