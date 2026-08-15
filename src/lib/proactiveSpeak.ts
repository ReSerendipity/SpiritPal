/**
 * 主动说话机制模块
 *
 * @fileoverview 宠物空闲时主动发起对话，增强陪伴感（Phase 2.3，移植自Open-LLM-VTuber）
 *
 * 主要模块：
 * - ProactiveSpeakConfig: 配置常量（间隔、触发时间、概率）
 * - ProactiveSpeakManager: 主动说话管理器
 *
 * 依赖关系：
 * - llmClient.ts: LLM客户端（getLLMClient）
 * - types.ts: ChatMessage/NurturingStats类型
 * - emotionExtractor.ts: EMOTION_PROMPT_FRAGMENT
 * - thinkTagParser.ts: THINK_TAG_PROMPT_FRAGMENT
 *
 * 核心接口：
 * - start(): 启动主动说话定时器
 * - stop(): 停止定时器
 * - triggerProactiveSpeak(): 手动触发主动说话
 * - onSpeak(): 注册发言回调
 *
 * 设计（参考Open-LLM-VTuber，MIT许可）：
 * 1. 定时检查：每分钟检查是否满足触发条件
 * 2. 触发条件：空闲10分钟+距上次主动说话5分钟+30%概率
 * 3. LLM生成：专用prompt，标记skip_memory+skip_history
 * 4. 气泡显示：发言内容通过气泡系统呈现
 * 5. 情境联动：检测用户工作/空闲状态触发不同话题
 */

import { getLLMClient } from './llmClient'
import type { ChatMessage, NurturingStats } from './types'
import { EMOTION_PROMPT_FRAGMENT } from './emotionExtractor'
import { THINK_TAG_PROMPT_FRAGMENT } from './thinkTagParser'
// P1-2：接线记忆检索——主动说话时检索相关回忆拼入 prompt
import { getEnhancedMemoryManager } from './enhancedMemory'
// P1-2：从 contextAwareness 获取真实空闲时长
import { getContextAwarenessManager } from './contextAwareness'
// R2：约定跟进
import { getCommitmentTracker } from './commitmentTracker'
// P2-1：接入 RecallEngine LLM 渲染，让主动说话时能自然地回忆而非只用模板
import { getRecallEngine, buildRecallRenderPrompt } from './recallEngine'
// T-12: 统一配置入口
import { PROACTIVE_CONFIG } from './memoryConfig'

// ============ 配置常量 ============
// T-12: 值统一来自 memoryConfig

/** 主动说话的最小间隔（毫秒）— 避免过于频繁 */
const MIN_PROACTIVE_INTERVAL_MS = PROACTIVE_CONFIG.minIntervalMs

/** 主动说话随机触发概率（每次检查时） */
const RANDOM_TRIGGER_PROBABILITY = PROACTIVE_CONFIG.triggerProbability

/** 检查间隔（毫秒） */
const CHECK_INTERVAL_MS = PROACTIVE_CONFIG.checkIntervalMs

// ============ 主动说话提示词 ============
// 参考 Open-LLM-VTuber proactive_speak_prompt.txt
const PROACTIVE_SPEAK_SYSTEM_PROMPT = `你是 SpiritPal 桌面宠物，现在要主动对主人说一句话。
要求：
1. 简短自然，1-3 句话
2. 根据当前情境选择合适的话题：
   - 如果主人很久没互动：关心问候
   - 如果主人正在工作：轻声鼓励
   - 如果肚子饿了：委婉表达
   - 如果心情好：分享趣事
3. 保持角色性格一致性
4. 不要提问需要回答的问题（主人可能在忙）

${EMOTION_PROMPT_FRAGMENT}

${THINK_TAG_PROMPT_FRAGMENT}`

// ============ 单例（提前声明以便 dispose 访问）============
let proactiveManager: ProactiveSpeakManager | null = null

// ============ 主动说话管理器 ============

export class ProactiveSpeakManager {
  private lastProactiveAt: number = 0
  private checkTimer: number | null = null
  private listeners: Set<(message: string) => void> = new Set()
  /** 防止并发检查 */
  private isChecking = false

  /** 启动定时检查 */
  start(): void {
    if (this.checkTimer !== null) return
    this.scheduleNextCheck()
  }

  /** 安排下一次检查（使用 setTimeout 链式调度，避免 setInterval 堆积） */
  private scheduleNextCheck(): void {
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer)
    }
    this.checkTimer = window.setTimeout(() => {
      this.checkTimer = null
      void this.checkAndSpeak().finally(() => {
        // 如果还在运行状态，继续调度下一次
        if (this.listeners.size > 0) {
          this.scheduleNextCheck()
        }
      })
    }, CHECK_INTERVAL_MS)
  }

  /** 停止定时检查 */
  stop(): void {
    if (this.checkTimer !== null) {
      clearTimeout(this.checkTimer)
      this.checkTimer = null
    }
    this.isChecking = false
  }

  /** 检查是否应主动说话 */
  private async checkAndSpeak(): Promise<void> {
    if (this.isChecking) return
    const now = Date.now()

    // 距上次主动说话不足 5 分钟
    if (now - this.lastProactiveAt < MIN_PROACTIVE_INTERVAL_MS) return

    // 随机概率触发
    if (Math.random() > RANDOM_TRIGGER_PROBABILITY) return

    // P1-2 修复：从 contextAwareness 获取真实空闲时长，替代硬编码的 idleMinutes: 0
    // 仅在用户确实空闲时才主动说话（避免用户正忙时打扰）
    let idleMinutes = 0
    try {
      const ctxMgr = getContextAwarenessManager()
      idleMinutes = ctxMgr.getLastIdleMinutes()
    } catch {
      // contextAwareness 不可用时退化为 0（不影响触发，仅影响情境提示）
    }
    this.pendingIdleMinutes = idleMinutes

    this.isChecking = true
    try {
      const message = await this.generateProactiveMessage()
      if (message) {
        this.lastProactiveAt = Date.now()
        this.emitToListeners(message)
      }
    } catch {
      // LLM 不可用时静默失败
    } finally {
      this.isChecking = false
    }
  }

  /**
   * 安全地通知所有监听器（异常保护）
   */
  private emitToListeners(message: string): void {
    this.listeners.forEach((fn) => {
      try { fn(message) } catch (e) { console.error('[ProactiveSpeak] listener error:', e) }
    })
  }

  /** 当前空闲时长（由 checkAndSpeak 写入，供 generateProactiveMessage 读取） */
  private pendingIdleMinutes = 0

  /** 生成主动说话内容 */
  private async generateProactiveMessage(): Promise<string | null> {
    try {
      // 使用当前 LLM 客户端配置
      const client = getLLMClient()
      const store = await this.getStoreState()
      const contextHints = store
        ? this.buildContextHints(store.stats, this.pendingIdleMinutes)
        : '一切正常'

      // P1-2：检索相关回忆拼入 prompt——宠物主动提起上次的事
      let memoryContext = ''
      try {
        const characterId = store?.characterId
        if (characterId) {
          const memMgr = getEnhancedMemoryManager(characterId)
          await memMgr.ensureLoaded()
          // 取最近的自传记忆作为“上次聊过”的素材
          const recentMemories = memMgr.getAutobiographicalMemories().slice(-3)
          if (recentMemories.length > 0) {
            const memorySnippets = recentMemories
              .map(m => `- ${m.user.slice(0, 60)}`)
              .join('\n')
            memoryContext = `\n\n【记忆参考】你可以自然地提起这些过往，但不要复述原文：\n${memorySnippets}`
          }
        }
      } catch {
        // 记忆检索失败不影响主动说话
      }

      // R2：约定跟进——检查是否有到期/逾期的约定，作为主动话题
      let commitmentContext = ''
      try {
        const characterId = store?.characterId
        if (characterId) {
          const tracker = getCommitmentTracker(characterId)
          const candidates = await tracker.generateFollowUpCandidates()
          if (candidates.length > 0) {
            // 取最高优先级的约定作为话题
            const top = candidates[0]
            commitmentContext = `\n\n【约定提醒】你可以自然地提起：${top.message}`
          }
        }
      } catch {
        // 约定追踪失败不影响主动说话
      }

      // P2-1：尝试通过 RecallEngine 生成更自然的回忆消息
      // RecallEngine 会检查预算、勿扰、空闲门槛，在合适时输出一条回忆
      try {
        const characterId = store?.characterId
        if (characterId) {
          const recallEngine = getRecallEngine(characterId)
          // T-3: 注入当前用户情绪，使情绪一致性打分生效
          try {
            const memMgr = getEnhancedMemoryManager(characterId)
            await memMgr.ensureLoaded()
            recallEngine.setCurrentMood(memMgr.getCurrentMood())
          } catch {
            // 情绪获取失败不影响回忆流程（使用默认中性）
          }
          const recallMessage = await recallEngine.recall(
            undefined, // 主动模式下无用户输入
            async (candidate, contextHints) => {
              // LLM 渲染：用现有 LLM client 生成一句话回忆
              const renderPrompt = buildRecallRenderPrompt(candidate, contextHints)
              const renderMessages: ChatMessage[] = [
                {
                  id: 'recall-system',
                  role: 'system',
                  content: `你是 SpiritPal 桌面宠物。请根据记忆素材自然地回忆一句话。\n${EMOTION_PROMPT_FRAGMENT}\n${THINK_TAG_PROMPT_FRAGMENT}`,
                  timestamp: Date.now(),
                },
                {
                  id: 'recall-user',
                  role: 'user',
                  content: renderPrompt,
                  timestamp: Date.now(),
                },
              ]
              const resp = await client.chatOnce(renderMessages)
              return resp
                .replace(/\[emotion:[\w]+\]/gi, '')
                .replace(/\[motion:[\w]+\]/gi, '')
                .replace(/<think>[\s\S]*?<\/think>/g, '')
                .trim()
            },
          )
          if (recallMessage) {
            // RecallEngine 已通过 BubbleManager 发送，直接返回避免重复
            return null
          }
        }
      } catch {
        // RecallEngine 不可用或未触发，继续走原有逻辑
      }

      // F8：Legacy 回退路径也受 RecallEngine 纪律约束（quiet hours / 预算）
      // 确保 RecallEngine 返回 null 时，不会绕过全局勿扰/预算直接走 LLM 发言
      try {
        const characterId = store?.characterId
        if (characterId) {
          const recallEngine = getRecallEngine(characterId)
          // 如果 RecallEngine 的 canRecall 检查不通过（勿扰/预算），直接返回 null
          if (!recallEngine.canSpeakNow()) {
            return null
          }
        }
      } catch {
        // RecallEngine 不可用时，legacy 路径继续（保底）
      }

      const now = Date.now()
      const messages: ChatMessage[] = [
        {
          id: 'proactive-system',
          role: 'system',
          content: PROACTIVE_SPEAK_SYSTEM_PROMPT,
          timestamp: now,
        },
        {
          id: 'proactive-context',
          role: 'user',
          content: `当前情境：${contextHints}${memoryContext}${commitmentContext}\n请主动说一句话。`,
          timestamp: now,
        },
      ]

      const response = await client.chatOnce(messages)
      // 清理可能的情绪标签和 think 标签
      return response
        .replace(/\[emotion:[\w]+\]/gi, '')
        .replace(/\[motion:[\w]+\]/gi, '')
        .replace(/<think>[\s\S]*?<\/think>/g, '')
        .trim()
    } catch {
      return null
    }
  }

  /** 构建情境提示 */
  private buildContextHints(stats: NurturingStats, idleMinutes: number): string {
    const hints: string[] = []

    if (idleMinutes >= 30) {
      hints.push('主人已经很久没有互动了（可能很忙）')
    } else if (idleMinutes >= 10) {
      hints.push('主人有一会儿没互动了')
    }

    // 修复：先判断更严重的饥饿状态（hunger 越低越饿）
    if (stats.hunger < 10) {
      hints.push('非常饿')
    } else if (stats.hunger < 30) {
      hints.push('肚子有点饿了')
    }

    if (stats.mood >= 80) {
      hints.push('心情很好')
    } else if (stats.mood < 30) {
      hints.push('心情不太好')
    }

    const hour = new Date().getHours()
    if (hour >= 0 && hour < 6) {
      hints.push('现在是深夜')
    } else if (hour >= 6 && hour < 9) {
      hints.push('现在是早上')
    } else if (hour >= 12 && hour < 14) {
      hints.push('现在是中午')
    } else if (hour >= 18 && hour < 20) {
      hints.push('现在是傍晚')
    } else if (hour >= 22) {
      hints.push('现在是晚上，该休息了')
    }

    return hints.length > 0 ? hints.join('；') : '一切正常'
  }

  /** 获取当前 store 状态 */
  private async getStoreState(): Promise<{
    stats: NurturingStats
    idleMinutes: number
    characterId: string
  } | null> {
    try {
      const { usePetStore } = await import('../stores/petStore')
      const store = usePetStore.getState()
      return {
        stats: store.getCurrentStats(),
        // P1-2 修复：不再硬编码 0，但这里仅作为 fallback；真实值在 checkAndSpeak 中通过 contextAwareness 获取
        idleMinutes: 0,
        characterId: store.currentCharacterId,
      }
    } catch {
      return null
    }
  }

  /** 强制触发一次主动说话（用于测试或手动触发） */
  async forceSpeak(): Promise<string | null> {
    const message = await this.generateProactiveMessage()
    if (message) {
      this.lastProactiveAt = Date.now()
      this.emitToListeners(message)
    }
    return message
  }

  /** 监听主动说话事件 */
  onProactiveSpeak(fn: (message: string) => void): () => void {
    this.listeners.add(fn)
    // 如果还没启动，启动检查
    if (this.checkTimer === null) {
      this.scheduleNextCheck()
    }
    return () => this.listeners.delete(fn)
  }

  /**
   * 销毁实例：清理定时器和监听器，并重置单例
   */
  dispose(): void {
    this.stop()
    this.listeners.clear()
    proactiveManager = null
  }
}

export function getProactiveSpeakManager(): ProactiveSpeakManager {
  if (!proactiveManager) {
    proactiveManager = new ProactiveSpeakManager()
  }
  return proactiveManager
}
