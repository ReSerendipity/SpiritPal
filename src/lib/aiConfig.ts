/**
 * AI 配置加载器 — 统一加载 AI 配置，消除重复实现
 * 从 localStorage + secureStorage 加载配置，apiKey 从安全存储读取
 *
 * @fileoverview
 * 主要模块：
 * - loadAIConfig()：异步加载 AI 配置函数
 *
 * 说明：
 * - 配置主体存储在 localStorage（不含明文 apiKey）
 * - apiKey 通过 secureStorage 加密存储（系统 keychain）
 * - 消除 ChatWindow.tsx / aiAgent.ts / llmClient.ts 中的重复 loadAIConfig 实现
 *
 * @module aiConfig
 * @requires ./types - AIConfig 类型定义
 * @requires ./llmClient - DEFAULT_AI_CONFIG 默认配置
 * @requires ./secureStorage - getApiKey 安全存储读取
 */

import type { AIConfig } from './types'
import { DEFAULT_AI_CONFIG } from './llmClient'
import { getApiKey } from './secureStorage'

const AI_CONFIG_KEY = 'spiritpal-ai-config'

/**
 * 从 localStorage + secureStorage 加载 AI 配置。
 * apiKey 不在 localStorage 明文中，从 secureStorage 读取。
 */
export async function loadAIConfig(): Promise<AIConfig> {
  let config: AIConfig = DEFAULT_AI_CONFIG
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY)
    if (raw) config = { ...DEFAULT_AI_CONFIG, ...JSON.parse(raw) }
  } catch {
    // 忽略解析错误
  }
  try {
    const apiKey = await getApiKey(config.provider)
    if (apiKey) config.apiKey = apiKey
  } catch {
    // 忽略 secureStorage 读取错误
  }
  return config
}
