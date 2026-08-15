/**
 * 上下文管理器 — 对话上下文的 token 预算管理、滑动窗口、上下文压缩
 * 参考 AI_Integration_Plan 的上下文管理设计
 *
 * @fileoverview
 * 主要模块：
 * - MessagePriority 类型：消息优先级（system/important/recent/old）
 * - ContextManagerConfig 接口：上下文管理器配置
 * - ContextMessage 接口：带元数据的消息（token 计数、优先级、重要度）
 * - ContextManager 类：上下文管理器，支持添加消息、获取上下文窗口、上下文压缩、消息优先级排序
 *
 * 核心功能：
 * 1. addMessage(role, content) — 自动 token 计数
 * 2. getContextWindow(maxTokens) — 返回 token 预算内的消息
 * 3. compressContext() — LLM 驱动的上下文压缩
 * 4. 消息优先级：system > recent > important > old
 * 5. 滑动窗口 + 被淘汰消息的摘要
 *
 * @module contextManager
 * @requires ./types - ChatMessage 类型定义
 * @requires ./stringSimilarity - estimateTokens token 估算
 */

import type { ChatMessage } from './types'
import { estimateTokens } from './stringSimilarity'

// ============ 消息优先级 ============

/** 消息优先级（越高越不容易被淘汰） */
export type MessagePriority = 'system' | 'important' | 'recent' | 'old'

/** 优先级数值（用于排序） */
const PRIORITY_WEIGHT: Record<MessagePriority, number> = {
  system: 100,
  important: 75,
  recent: 50,
  old: 25,
}

// ============ 上下文管理器配置 ============

export interface ContextManagerConfig {
  /** 默认最大 token 预算 */
  defaultMaxTokens: number
  /** system 消息永不淘汰（默认 true） */
  preserveSystem: boolean
  /** 始终保留最近 N 轮消息（默认 4） */
  preserveRecentRounds: number
  /** 消息被标记为 important 的最小重要度（0-100，默认 70） */
  importantThreshold: number
  /** 压缩后上下文的最大 token 占原窗口比例（默认 0.6） */
  compressionRatio: number
}

const DEFAULT_CONFIG: ContextManagerConfig = {
  defaultMaxTokens: 4096,
  preserveSystem: true,
  preserveRecentRounds: 4,
  importantThreshold: 70,
  compressionRatio: 0.6,
}

// ============ 带元数据的消息 ============

interface MessageWithMeta {
  /** 消息 */
  message: ChatMessage
  /** token 数量 */
  tokenCount: number
  /** 优先级 */
  priority: MessagePriority
  /** 重要度（0-100） */
  importance: number
  /** 是否被压缩摘要替代 */
  compressed: boolean
}

// ============ 上下文管理器 ============

/**
 * 上下文管理器
 * 管理 LLM 对话的消息列表，支持 token 预算控制和自动压缩
 */
export class ContextManager {
  private messages: MessageWithMeta[] = []
  private config: ContextManagerConfig
  /** 压缩摘要（被淘汰消息的摘要） */
  private compressedSummary: string = ''
  /** 压缩摘要的 token 数 */
  private compressedSummaryTokens = 0

  constructor(config: Partial<ContextManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 添加消息到上下文
   * 自动计算 token 数并分配优先级
   *
   * @param role 消息角色
   * @param content 消息内容
   * @param importance 重要度（0-100，默认根据角色自动分配）
   * @returns 添加的消息
   */
  addMessage(
    role: ChatMessage['role'],
    content: string,
    importance?: number,
  ): ChatMessage {
    const message: ChatMessage = {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role,
      content,
      timestamp: Date.now(),
    }

    const tokenCount = estimateTokens(content)
    const priority = this.inferPriority(role, importance)
    const imp = importance ?? this.inferImportance(role, content)

    this.messages.push({
      message,
      tokenCount,
      priority,
      importance: imp,
      compressed: false,
    })

    return message
  }

  /**
   * 获取 token 预算内的消息列表
   * 按优先级排序，优先保留高优先级消息
   *
   * @param maxTokens 最大 token 预算（默认使用配置值）
   * @returns 预算内的消息列表
   */
  getContextWindow(maxTokens?: number): ChatMessage[] {
    const budget = maxTokens ?? this.config.defaultMaxTokens
    let usedTokens = 0
    const selected: MessageWithMeta[] = []

    // 1. 压缩摘要（如果有）
    if (this.compressedSummary) {
      usedTokens += this.compressedSummaryTokens
      // 将压缩摘要作为 system 消息插入
      const summaryMsg: MessageWithMeta = {
        message: {
          id: 'compressed-summary',
          role: 'system',
          content: `[对话历史摘要] ${this.compressedSummary}`,
          timestamp: Date.now(),
        },
        tokenCount: this.compressedSummaryTokens,
        priority: 'system' as MessagePriority,
        importance: 50,
        compressed: true,
      }
      selected.push(summaryMsg)
    }

    // 2. 按优先级排序消息
    const sorted = [...this.messages]
      .map((m, idx) => ({ ...m, originalIndex: idx }))
      .sort((a, b) => {
        // 优先级高的排前面
        const pa = PRIORITY_WEIGHT[a.priority]
        const pb = PRIORITY_WEIGHT[b.priority]
        if (pa !== pb) return pb - pa
        // 同优先级按时间排序（新的排前面）
        return b.message.timestamp - a.message.timestamp
      })

    // 3. 贪心选择消息直到超出预算
    for (const m of sorted) {
      if (usedTokens + m.tokenCount > budget) continue
      usedTokens += m.tokenCount
      selected.push(m)
    }

    // 4. 确保保留 system 消息和最近 N 轮
    if (this.config.preserveSystem) {
      for (const m of this.messages) {
        if (m.message.role === 'system' && !selected.some((s) => s.message.id === m.message.id)) {
          selected.push(m)
        }
      }
    }

    // 保留最近 N 轮（user + assistant = 1 轮）
    // 修复：preserveRecentRounds=0 时不强制保留——slice(-0) 等于 slice(0) 会返回整个数组，
    // 导致"严格预算"（如记忆注入预算 F5b）完全失效
    if (this.config.preserveRecentRounds > 0) {
      const recentMessages = this.messages.slice(-this.config.preserveRecentRounds * 2)
      for (const m of recentMessages) {
        if (!selected.some((s) => s.message.id === m.message.id)) {
          selected.push(m)
        }
      }
    }

    // 5. 按原始时间顺序排列
    const result = [...new Set(selected)]
      .sort((a, b) => a.message.timestamp - b.message.timestamp)
      .map((m) => m.message)

    return result
  }

  /**
   * 压缩上下文：当消息超出 token 预算时，使用 LLM 摘要淘汰旧消息
   *
   * @param llmCompressor LLM 压缩函数（可选，不传则使用简单截断）
   * @returns 压缩前的 token 总数
   */
  async compressContext(
    llmCompressor?: (messages: ChatMessage[]) => Promise<string>,
  ): Promise<number> {
    const totalTokens = this.getTotalTokens()
    const budget = this.config.defaultMaxTokens

    // 不需要压缩
    if (totalTokens <= budget) return totalTokens

    // 找出可被压缩的旧消息（非 system、非 important、非最近 N 轮）
    const recentStart = Math.max(
      0,
      this.messages.length - this.config.preserveRecentRounds * 2,
    )

    const compressible = this.messages
      .slice(0, recentStart)
      .filter((m) => m.priority !== 'system' && m.priority !== 'important')

    if (compressible.length === 0) return totalTokens

    // 使用 LLM 或简单截断生成摘要
    let summary: string
    if (llmCompressor) {
      try {
        const chatMessages = compressible.map((m) => m.message)
        summary = await llmCompressor(chatMessages)
      } catch {
        summary = this.generateSimpleSummary(compressible)
      }
    } else {
      summary = this.generateSimpleSummary(compressible)
    }

    // 更新压缩摘要
    this.compressedSummary = summary
    this.compressedSummaryTokens = estimateTokens(summary)

    // 移除被压缩的消息
    const compressedIds = new Set(compressible.map((m) => m.message.id))
    this.messages = this.messages.filter((m) => !compressedIds.has(m.message.id))

    return totalTokens
  }

  /** 简单摘要生成（LLM 不可用时的回退） */
  private generateSimpleSummary(messages: MessageWithMeta[]): string {
    return messages
      .map((m) => `${m.message.role}: ${m.message.content.slice(0, 60)}`)
      .join('\n')
      .slice(0, 1000)
  }

  // ============ 辅助方法 ============

  /** 推断消息优先级 */
  private inferPriority(role: ChatMessage['role'], importance?: number): MessagePriority {
    if (role === 'system') return 'system'
    if (importance !== undefined && importance >= this.config.importantThreshold) return 'important'
    // 最近 10 条消息视为 recent
    if (this.messages.length < 10) return 'recent'
    return 'old'
  }

  /** 推断消息重要度 */
  private inferImportance(role: ChatMessage['role'], content: string): number {
    if (role === 'system') return 100
    // 包含关键词的消息更重要的
    const importantPatterns = /喜欢|讨厌|偏好|生日|纪念日|重要|记住|love|hate|birthday|important/
    if (importantPatterns.test(content)) return 80
    return 50
  }

  /** 获取总 token 数 */
  getTotalTokens(): number {
    return this.messages.reduce((sum, m) => sum + m.tokenCount, 0) + this.compressedSummaryTokens
  }

  /** 获取消息总数 */
  getMessageCount(): number {
    return this.messages.length
  }

  /** 清空上下文 */
  clear(): void {
    this.messages = []
    this.compressedSummary = ''
    this.compressedSummaryTokens = 0
  }

  /** 获取所有消息（不限制 token 预算） */
  getAllMessages(): ChatMessage[] {
    return this.messages.map((m) => m.message)
  }

  /** 更新配置 */
  updateConfig(config: Partial<ContextManagerConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /** 获取配置 */
  getConfig(): ContextManagerConfig {
    return { ...this.config }
  }
}

// ============ 单例 ============

let instance: ContextManager | null = null

/**
 * 获取上下文管理器单例
 * @param config 可选配置
 */
export function getContextManager(config?: Partial<ContextManagerConfig>): ContextManager {
  if (!instance) {
    instance = new ContextManager(config)
  }
  return instance
}

/**
 * 重置上下文管理器（通常在新对话开始时调用）
 */
export function resetContextManager(): void {
  if (instance) {
    instance.clear()
  }
  instance = null
}
