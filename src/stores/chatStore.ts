/**
 * 聊天状态管理 Store
 * @module stores/chatStore
 * @description
 * 每个角色独立的消息历史管理 + 流式生成控制。
 * 使用 zustand v5 + persist 中间件，localStorage 持久化。
 *
 * 核心功能：
 * - 按角色隔离的消息列表存储
 * - 流式响应 chunk 批处理（微任务合并，减少重渲染）
 * - 消息数量上限控制（防止内存泄漏）
 * - 流式中断控制（AbortController）
 * - 消息一致性校验标记
 * - 内心独白（think）内容管理
 *
 * 性能优化：
 * - F4: appendAssistantChunk 使用微任务批处理，合并同一 tick 内的多个 chunk
 * - F5: messagesByCharacter 每角色消息数量上限（MAX_MESSAGES_PER_CHARACTER = 500）
 *
 * @see {@link ../lib/types/ChatMessage} 消息类型定义
 * @see {@link ./petStore} 宠物状态 Store（依赖 currentCharacterId）
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ChatMessage } from '../lib/types'
import { usePetStore } from './petStore'

// ============ 常量 ============

/** 每个角色保留的最大消息数量（F5 - 防止内存无限增长）
 *  超过上限时丢弃最旧的消息；500 条约等于 250 轮对话，足够覆盖长期上下文
 */
const MAX_MESSAGES_PER_CHARACTER = 500

/**
 * 聊天 Store 状态接口
 */
interface ChatStoreState {
  /** 按角色 ID 索引的消息列表 */
  messagesByCharacter: Record<string, ChatMessage[]>
  /** 是否正在生成 AI 回复 */
  isLoading: boolean
  /** 流式生成中断控制器，用于停止生成 */
  abortController: AbortController | null

  // ---- 动作 ----
  /**
   * 发送用户消息，创建用户消息和 assistant 占位消息
   * @param text 用户输入文本
   * @returns assistant 占位消息 ID，供流式填充使用
   */
  sendMessage: (text: string) => string

  /**
   * 流式追加 assistant 回复内容（批处理合并优化）
   * @param messageId 消息 ID
   * @param chunk 内容片段
   */
  appendAssistantChunk: (messageId: string, chunk: string) => void

  /**
   * 结束流式生成，标记消息完成状态
   * @param messageId 消息 ID
   */
  finishStreaming: (messageId: string) => void

  /** 中断当前生成，清空缓冲区 */
  stopGeneration: () => void

  /** 清空当前角色的消息历史 */
  clearHistory: () => void

  /**
   * 获取当前角色的消息列表
   * @returns 当前角色的消息数组
   */
  getMessages: () => ChatMessage[]

  /**
   * 设置加载状态
   * @param loading 是否加载中
   */
  setLoading: (loading: boolean) => void

  /**
   * 设置中断控制器
   * @param controller AbortController 实例或 null
   */
  setAbortController: (controller: AbortController | null) => void

  /**
   * 直接添加一条消息到当前角色历史
   * @param message 聊天消息对象
   */
  addMessage: (message: ChatMessage) => void

  /**
   * 标记消息不符性格（一致性校验）
   * @param messageId 消息 ID
   * @param violations 违规项列表
   */
  flagMessage: (messageId: string, violations: string[]) => void

  /**
   * 更新消息内容（用于重新生成回复）
   * @param messageId 消息 ID
   * @param content 新的消息内容
   */
  updateMessageContent: (messageId: string, content: string) => void

  /**
   * 更新消息的一致性校验字段
   * @param messageId 消息 ID
   * @param violations 违规项列表（空数组表示无违规）
   */
  setMessageConsistency: (messageId: string, violations: string[]) => void

  /**
   * Phase 1.4: 更新消息的 think 内容（内心独白）
   * @param messageId 消息 ID
   * @param thinkContent 内心独白内容
   */
  updateMessageThink: (messageId: string, thinkContent: string) => void
}

/**
 * 生成唯一消息 ID
 * @returns 格式为 "timestamp-random" 的唯一 ID 字符串
 */
function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * 获取当前选中的角色 ID
 * @returns 当前角色 ID
 */
function getCurrentCharacterId(): string {
  return usePetStore.getState().currentCharacterId
}

/**
 * 通用辅助：更新当前角色的消息列表。
 * 接收一个 updater 函数，返回新的消息数组，自动包装为 messagesByCharacter 的 set 调用。
 * 同时应用消息数量上限，防止内存无限增长。
 * @param set Zustand set 函数
 * @param updater 消息列表更新函数
 * @param extra 额外的状态更新字段
 */
function updateCurrentMessages(
  set: (fn: (state: ChatStoreState) => Partial<ChatStoreState>) => void,
  updater: (list: ChatMessage[]) => ChatMessage[],
  extra?: Partial<ChatStoreState>,
): void {
  set((state) => {
    const charId = getCurrentCharacterId()
    const list = state.messagesByCharacter[charId] ?? []
    // [OPTIMIZE] F5 - 应用消息数量上限，丢弃最旧的消息
    const updated = updater(list)
    const trimmed = updated.length > MAX_MESSAGES_PER_CHARACTER
      ? updated.slice(updated.length - MAX_MESSAGES_PER_CHARACTER)
      : updated
    return {
      ...extra,
      messagesByCharacter: {
        ...state.messagesByCharacter,
        [charId]: trimmed,
      },
    }
  })
}

// ============ 流式 chunk 批处理缓冲区 ============
// [OPTIMIZE] F4 - 使用微任务批处理合并同一 tick 内的多个 chunk
// 问题：流式生成时 chunk 频率可能很高（每秒几十次），每次 chunk 都触发
//       messagesByCharacter 对象重建 + list.map() + React 重渲染
// 方案：在同一个 microtask 内累积 chunk，下一个 microtask 一次性 flush
// 效果：无论 chunk 频率多高，每个 tick 只触发一次 store 更新和重渲染

/** Chunk 缓冲区：按消息 ID 累积待 flush 的内容 */
let chunkBuffer: Map<string, string> = new Map()
/** 是否已调度微任务 flush */
let flushScheduled = false

/**
 * 聊天状态 Store Hook
 * @example
 * ```tsx
 * const messages = useChatStore(s => s.getMessages())
 * const sendMessage = useChatStore(s => s.sendMessage)
 * ```
 */
export const useChatStore = create<ChatStoreState>()(
  persist(
    (set, get) => ({
      messagesByCharacter: {},
      isLoading: false,
      abortController: null,

      sendMessage: (text) => {
        const currentCharacterId = getCurrentCharacterId()
        const userMsg: ChatMessage = {
          id: genId(),
          role: 'user',
          content: text,
          timestamp: Date.now(),
        }
        const assistantId = genId()
        const assistantMsg: ChatMessage = {
          id: assistantId,
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
        }
        set((state) => {
          const existing = state.messagesByCharacter[currentCharacterId] ?? []
          // [OPTIMIZE] F5 - 应用消息数量上限
          const combined = [...existing, userMsg, assistantMsg]
          const trimmed = combined.length > MAX_MESSAGES_PER_CHARACTER
            ? combined.slice(combined.length - MAX_MESSAGES_PER_CHARACTER)
            : combined
          return {
            messagesByCharacter: {
              ...state.messagesByCharacter,
              [currentCharacterId]: trimmed,
            },
            isLoading: true,
          }
        })
        return assistantId
      },

      appendAssistantChunk: (messageId, chunk) => {
        // 累积 chunk 到缓冲区
        chunkBuffer.set(messageId, (chunkBuffer.get(messageId) ?? '') + chunk)

        // 调度微任务 flush（同一 tick 内的后续 chunk 会合并到同一次 flush）
        if (!flushScheduled) {
          flushScheduled = true
          queueMicrotask(() => {
            flushScheduled = false
            const buffered = chunkBuffer
            chunkBuffer = new Map()
            if (buffered.size === 0) return

            // 一次性应用所有累积的 chunks
            updateCurrentMessages(set, (list) =>
              list.map((m) => {
                const chunks = buffered.get(m.id)
                if (chunks) {
                  return { ...m, content: m.content + chunks }
                }
                return m
              }),
            )
          })
        }
      },

      finishStreaming: (messageId) => {
        // [OPTIMIZE] F4 - finishStreaming 时立即 flush 缓冲区，避免最后的 chunk 丢失
        if (chunkBuffer.size > 0) {
          const buffered = chunkBuffer
          chunkBuffer = new Map()
          flushScheduled = false
          updateCurrentMessages(
            set,
            (list) =>
              list.map((m) => {
                const chunks = buffered.get(m.id)
                if (chunks) {
                  return { ...m, content: m.content + chunks, isStreaming: false }
                }
                if (m.id === messageId) {
                  return { ...m, isStreaming: false }
                }
                return m
              }),
            { isLoading: false, abortController: null },
          )
        } else {
          updateCurrentMessages(
            set,
            (list) => list.map((m) => (m.id === messageId ? { ...m, isStreaming: false } : m)),
            { isLoading: false, abortController: null },
          )
        }
      },

      stopGeneration: () => {
        const { abortController } = get()
        if (abortController) {
          abortController.abort()
        }
        // [OPTIMIZE] F4 - 中断时清空缓冲区，避免残留 chunk 影响下次生成
        chunkBuffer.clear()
        flushScheduled = false
        set({ isLoading: false, abortController: null })
        // 把所有仍在 streaming 的消息标记为完成
        updateCurrentMessages(set, (list) =>
          list.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
        )
      },

      clearHistory: () => {
        updateCurrentMessages(set, () => [])
      },

      getMessages: () => {
        const currentCharacterId = getCurrentCharacterId()
        return get().messagesByCharacter[currentCharacterId] ?? []
      },

      setLoading: (loading) => set({ isLoading: loading }),

      setAbortController: (controller) => set({ abortController: controller }),

      addMessage: (message) => {
        const currentCharacterId = getCurrentCharacterId()
        set((state) => {
          const existing = state.messagesByCharacter[currentCharacterId] ?? []
          // [OPTIMIZE] F5 - 应用消息数量上限
          const combined = [...existing, message]
          const trimmed = combined.length > MAX_MESSAGES_PER_CHARACTER
            ? combined.slice(combined.length - MAX_MESSAGES_PER_CHARACTER)
            : combined
          return {
            messagesByCharacter: {
              ...state.messagesByCharacter,
              [currentCharacterId]: trimmed,
            },
          }
        })
      },

      flagMessage: (messageId, violations) => {
        updateCurrentMessages(set, (list) =>
          list.map((m) =>
            m.id === messageId
              ? { ...m, flagged: true, consistencyViolations: violations }
              : m,
          ),
        )
      },

      updateMessageContent: (messageId, content) => {
        updateCurrentMessages(set, (list) =>
          list.map((m) => (m.id === messageId ? { ...m, content } : m)),
        )
      },

      setMessageConsistency: (messageId, violations) => {
        updateCurrentMessages(set, (list) =>
          list.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  consistencyViolations: violations,
                  flagged: violations.length > 0 ? m.flagged : false,
                }
              : m,
          ),
        )
      },

      updateMessageThink: (messageId, thinkContent) => {
        updateCurrentMessages(set, (list) =>
          list.map((m) =>
            m.id === messageId ? { ...m, thinkContent } : m,
          ),
        )
      },
    }),
    {
      name: 'spiritpal-chat-store',
      storage: createJSONStorage(() => localStorage),
      // 不持久化 isLoading 和 abortController
      partialize: (state) => ({ messagesByCharacter: state.messagesByCharacter }),
    },
  ),
)
