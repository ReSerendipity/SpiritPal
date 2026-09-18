/**
 * 聊天状态管理 Store（v2 — 会话制）
 * @module stores/chatStore
 * @description
 * 按「角色 → 会话 → 消息」三级结构管理聊天历史。
 * 使用 zustand v5 + persist 中间件，SQLite 持久化（Rust sp_* 语义命令）。
 *
 * 核心功能：
 * - 多会话管理（新建、切换、删除、重命名）
 * - 按会话隔离的消息列表存储
 * - 流式响应 chunk 批处理（微任务合并，减少重渲染）
 * - 消息数量上限控制（防止内存泄漏）
 * - 流式中断控制（AbortController）
 * - 消息一致性校验标记
 * - 内心独白（think）内容管理
 * - 每条助手消息附带 LLM 性能指标（token/耗时/速率）
 * - 会话级汇总统计（累计 tokens、请求数）
 * - 旧版单会话数据自动迁移
 *
 * 性能优化：
 * - F4: appendAssistantChunk 使用微任务批处理，合并同一 tick 内的多个 chunk
 * - F5: 每会话消息数量上限（MAX_MESSAGES_PER_SESSION = 500）
 *
 * @see {@link ../lib/data/types} ChatMessage / ChatSession / MessageMetrics 类型定义
 * @see {@link ./petStore} 宠物状态 Store（依赖 currentCharacterId）
 */
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { ChatMessage, ChatSession, MessageMetrics } from '@/lib/data/types'
import { usePetStore } from '@/stores/petStore'
import { sqliteStorage } from '@/lib/data/db'

// ============ 常量 ============

/** 每个会话保留的最大消息数量（F5 - 防止内存无限增长） */
const MAX_MESSAGES_PER_SESSION = 500

/** 每个角色保留的最大会话数量（超出时归档最旧的） */
const MAX_SESSIONS_PER_CHARACTER = 100

// ============ 类型 ============

interface ChatStoreState {
  /** 会话元数据，按角色 ID 索引 */
  sessions: Record<string, ChatSession[]>
  /** 按会话 ID 索引的消息列表 */
  messagesBySession: Record<string, ChatMessage[]>
  /** 每个角色当前活跃的会话 ID */
  activeSessionByCharacter: Record<string, string>
  /** 是否正在生成 AI 回复 */
  isLoading: boolean
  /** 流式生成中断控制器 */
  abortController: AbortController | null

  // ---- 会话管理 ----
  /** 为当前角色新建一个会话，返回新会话 ID */
  createSession: () => string
  /** 切换当前角色的活跃会话 */
  switchSession: (sessionId: string) => void
  /** 删除指定会话（及其消息） */
  deleteSession: (sessionId: string) => void
  /** 重命名会话 */
  renameSession: (sessionId: string, title: string) => void
  /** 置顶/取消置顶会话 */
  togglePinSession: (sessionId: string) => void
  /** 获取当前角色的会话列表（按 updatedAt 降序） */
  getSessions: () => ChatSession[]

  // ---- 消息操作 ----
  sendMessage: (text: string) => string
  appendAssistantChunk: (messageId: string, chunk: string) => void
  finishStreaming: (messageId: string) => void
  stopGeneration: () => void
  clearHistory: () => void
  getMessages: () => ChatMessage[]
  setLoading: (loading: boolean) => void
  setAbortController: (controller: AbortController | null) => void
  addMessage: (message: ChatMessage) => void
  flagMessage: (messageId: string, violations: string[]) => void
  updateMessageContent: (messageId: string, content: string) => void
  setMessageConsistency: (messageId: string, violations: string[]) => void
  updateMessageThink: (messageId: string, thinkContent: string) => void

  // ---- 指标回写 ----
  /** 流式完成后将 LLM 性能指标写入对应消息并更新会话汇总 */
  setMessageMetrics: (messageId: string, metrics: MessageMetrics) => void
}

// ============ 工具函数 ============

function genId(): string {
  // 会话/消息 ID 必须用密码学安全随机数（CSPRNG）。
  // 原实现用 `Math.random()`，被 CodeQL 判为 "Insecure randomness"（security context），
  // 在 PR 上留下未解决评审意见从而阻塞合并（分支保护开了 required_conversation_resolution）。
  // crypto.getRandomValues 在 Tauri WebView 与 Node（vitest/jsdom）环境均可用。
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  const rand = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${Date.now()}-${rand}`
}

function getCurrentCharacterId(): string {
  return usePetStore.getState().currentCharacterId
}

/** 通用辅助：更新当前活跃会话的消息列表 */
function updateActiveMessages(
  set: (fn: (state: ChatStoreState) => Partial<ChatStoreState>) => void,
  updater: (list: ChatMessage[]) => ChatMessage[],
  extra?: Partial<ChatStoreState>,
): void {
  set((state) => {
    const charId = getCurrentCharacterId()
    const sessionId = state.activeSessionByCharacter[charId]
    if (!sessionId) return state
    const list = state.messagesBySession[sessionId] ?? []
    const updated = updater(list)
    const trimmed = updated.length > MAX_MESSAGES_PER_SESSION
      ? updated.slice(updated.length - MAX_MESSAGES_PER_SESSION)
      : updated
    return {
      ...extra,
      messagesBySession: {
        ...state.messagesBySession,
        [sessionId]: trimmed,
      },
    }
  })
}

// ============ 流式 chunk 批处理缓冲区 ============

let chunkBuffer: Map<string, string> = new Map()
let flushScheduled = false

// ============ 迁移辅助 ============

/**
 * 将旧版 messagesByCharacter 格式迁移为 sessions + messagesBySession。
 * 旧格式: { messagesByCharacter: { charId: ChatMessage[] } }
 * 新格式: { sessions, messagesBySession, activeSessionByCharacter }
 */
function migrateFromLegacy(persisted: Record<string, unknown>): Partial<ChatStoreState> {
  const legacy = persisted.messagesByCharacter as Record<string, ChatMessage[]> | undefined
  if (!legacy || Object.keys(legacy).length === 0) {
    return {
      sessions: {},
      messagesBySession: {},
      activeSessionByCharacter: {},
    }
  }

  const sessions: Record<string, ChatSession[]> = {}
  const messagesBySession: Record<string, ChatMessage[]> = {}
  const activeSessionByCharacter: Record<string, string> = {}

  for (const [charId, messages] of Object.entries(legacy)) {
    if (!messages || messages.length === 0) {
      sessions[charId] = []
      continue
    }
    const sessionId = genId()
    const firstUser = messages.find((m) => m.role === 'user')
    const title = firstUser
      ? firstUser.content.slice(0, 24) + (firstUser.content.length > 24 ? '…' : '')
      : '历史对话'

    sessions[charId] = [
      {
        id: sessionId,
        characterId: charId,
        title,
        createdAt: messages[0]?.timestamp ?? Date.now(),
        updatedAt: messages[messages.length - 1]?.timestamp ?? Date.now(),
        messageCount: messages.length,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        requestCount: 0,
      },
    ]
    messagesBySession[sessionId] = messages
    activeSessionByCharacter[charId] = sessionId
  }

  return { sessions, messagesBySession, activeSessionByCharacter }
}

// ============ Store 创建 ============

export const useChatStore = create<ChatStoreState>()(
  persist(
    (set, get) => ({
      sessions: {},
      messagesBySession: {},
      activeSessionByCharacter: {},
      isLoading: false,
      abortController: null,

      // ---- 会话管理 ----

      createSession: () => {
        const charId = getCurrentCharacterId()
        const sessionId = genId()
        const newSession: ChatSession = {
          id: sessionId,
          characterId: charId,
          title: '新对话',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: 0,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          requestCount: 0,
        }
        set((state) => {
          const charSessions = state.sessions[charId] ?? []
          // 超出上限时移除最旧的非置顶会话
          let updatedSessions = [newSession, ...charSessions]
          if (updatedSessions.length > MAX_SESSIONS_PER_CHARACTER) {
            const nonPinned = updatedSessions.filter((s) => !s.pinned)
            if (nonPinned.length > 0) {
              const oldest = nonPinned[nonPinned.length - 1]
              if (oldest) {
                updatedSessions = updatedSessions.filter((s) => s.id !== oldest.id)
                // 同时清理其消息
                const { [oldest.id]: _removed, ...restMsgs } = state.messagesBySession
                return {
                  sessions: { ...state.sessions, [charId]: updatedSessions },
                  messagesBySession: restMsgs,
                  activeSessionByCharacter: { ...state.activeSessionByCharacter, [charId]: sessionId },
                }
              }
            }
          }
          return {
            sessions: { ...state.sessions, [charId]: updatedSessions },
            messagesBySession: { ...state.messagesBySession, [sessionId]: [] },
            activeSessionByCharacter: { ...state.activeSessionByCharacter, [charId]: sessionId },
          }
        })
        return sessionId
      },

      switchSession: (sessionId) => {
        const charId = getCurrentCharacterId()
        set((state) => ({
          activeSessionByCharacter: { ...state.activeSessionByCharacter, [charId]: sessionId },
        }))
      },

      deleteSession: (sessionId) => {
        const charId = getCurrentCharacterId()
        set((state) => {
          const charSessions = (state.sessions[charId] ?? []).filter((s) => s.id !== sessionId)
          const { [sessionId]: _removed, ...restMsgs } = state.messagesBySession
          let activeId = state.activeSessionByCharacter[charId]
          // 如果删除的是当前活跃会话，切换到下一个
          if (activeId === sessionId) {
            activeId = charSessions[0]?.id ?? ''
            if (!activeId && charSessions.length === 0) {
              // 创建一个新的空会话
              const newId = genId()
              const newSession: ChatSession = {
                id: newId,
                characterId: charId,
                title: '新对话',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                messageCount: 0,
                totalPromptTokens: 0,
                totalCompletionTokens: 0,
                requestCount: 0,
              }
              return {
                sessions: { ...state.sessions, [charId]: [newSession] },
                messagesBySession: { ...restMsgs, [newId]: [] },
                activeSessionByCharacter: { ...state.activeSessionByCharacter, [charId]: newId },
              }
            }
          }
          return {
            sessions: { ...state.sessions, [charId]: charSessions },
            messagesBySession: restMsgs,
            activeSessionByCharacter: { ...state.activeSessionByCharacter, [charId]: activeId },
          }
        })
      },

      renameSession: (sessionId, title) => {
        const charId = getCurrentCharacterId()
        set((state) => ({
          sessions: {
            ...state.sessions,
            [charId]: (state.sessions[charId] ?? []).map((s) =>
              s.id === sessionId ? { ...s, title } : s,
            ),
          },
        }))
      },

      togglePinSession: (sessionId) => {
        const charId = getCurrentCharacterId()
        set((state) => ({
          sessions: {
            ...state.sessions,
            [charId]: (state.sessions[charId] ?? []).map((s) =>
              s.id === sessionId ? { ...s, pinned: !s.pinned } : s,
            ),
          },
        }))
      },

      getSessions: () => {
        const charId = getCurrentCharacterId()
        const list = get().sessions[charId] ?? []
        // 置顶优先，然后按 updatedAt 降序
        return [...list].sort((a, b) => {
          if (a.pinned && !b.pinned) return -1
          if (!a.pinned && b.pinned) return 1
          return b.updatedAt - a.updatedAt
        })
      },

      // ---- 消息操作 ----

      sendMessage: (text) => {
        const charId = getCurrentCharacterId()
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
          let sessionId = state.activeSessionByCharacter[charId]
          let sessions = state.sessions
          let messagesBySession = state.messagesBySession

          // 确保有活跃会话
          if (!sessionId || !sessions[charId]?.some((s) => s.id === sessionId)) {
            sessionId = genId()
            const newSession: ChatSession = {
              id: sessionId,
              characterId: charId,
              title: text.slice(0, 24) + (text.length > 24 ? '…' : ''),
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messageCount: 0,
              totalPromptTokens: 0,
              totalCompletionTokens: 0,
              requestCount: 0,
            }
            sessions = {
              ...sessions,
              [charId]: [newSession, ...(sessions[charId] ?? [])],
            }
            messagesBySession = { ...messagesBySession, [sessionId]: [] }
          }

          const existing = messagesBySession[sessionId] ?? []
          const combined = [...existing, userMsg, assistantMsg]
          const trimmed = combined.length > MAX_MESSAGES_PER_SESSION
            ? combined.slice(combined.length - MAX_MESSAGES_PER_SESSION)
            : combined

          // 更新会话元数据
          const charSessions = (sessions[charId] ?? []).map((s) => {
            if (s.id !== sessionId) return s
            const newCount = trimmed.length
            // 首条消息时自动设置标题
            const title = s.title === '新对话' && existing.length === 0
              ? text.slice(0, 24) + (text.length > 24 ? '…' : '')
              : s.title
            return { ...s, updatedAt: Date.now(), messageCount: newCount, title }
          })

          return {
            sessions: { ...sessions, [charId]: charSessions },
            messagesBySession: { ...messagesBySession, [sessionId]: trimmed },
            activeSessionByCharacter: { ...state.activeSessionByCharacter, [charId]: sessionId },
            isLoading: true,
          }
        })
        return assistantId
      },

      appendAssistantChunk: (messageId, chunk) => {
        chunkBuffer.set(messageId, (chunkBuffer.get(messageId) ?? '') + chunk)
        if (!flushScheduled) {
          flushScheduled = true
          queueMicrotask(() => {
            flushScheduled = false
            const buffered = chunkBuffer
            chunkBuffer = new Map()
            if (buffered.size === 0) return
            updateActiveMessages(set, (list) =>
              list.map((m) => {
                const chunks = buffered.get(m.id)
                if (chunks) return { ...m, content: m.content + chunks }
                return m
              }),
            )
          })
        }
      },

      finishStreaming: (messageId) => {
        if (chunkBuffer.size > 0) {
          const buffered = chunkBuffer
          chunkBuffer = new Map()
          flushScheduled = false
          updateActiveMessages(
            set,
            (list) =>
              list.map((m) => {
                const chunks = buffered.get(m.id)
                if (chunks) return { ...m, content: m.content + chunks, isStreaming: false }
                if (m.id === messageId) return { ...m, isStreaming: false }
                return m
              }),
            { isLoading: false, abortController: null },
          )
        } else {
          updateActiveMessages(
            set,
            (list) => list.map((m) => (m.id === messageId ? { ...m, isStreaming: false } : m)),
            { isLoading: false, abortController: null },
          )
        }
      },

      stopGeneration: () => {
        const { abortController } = get()
        if (abortController) abortController.abort()
        chunkBuffer.clear()
        flushScheduled = false
        set({ isLoading: false, abortController: null })
        updateActiveMessages(set, (list) =>
          list.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m)),
        )
      },

      clearHistory: () => {
        // 清空当前会话的消息（不删除会话本身）
        updateActiveMessages(set, () => [])
      },

      getMessages: () => {
        const charId = getCurrentCharacterId()
        const sessionId = get().activeSessionByCharacter[charId]
        if (!sessionId) return []
        return get().messagesBySession[sessionId] ?? []
      },

      setLoading: (loading) => set({ isLoading: loading }),
      setAbortController: (controller) => set({ abortController: controller }),

      addMessage: (message) => {
        const charId = getCurrentCharacterId()
        set((state) => {
          let sessionId = state.activeSessionByCharacter[charId]
          let sessions = state.sessions
          let messagesBySession = state.messagesBySession

          // 自动创建会话（与 sendMessage 同逻辑）
          if (!sessionId || !sessions[charId]?.some((s) => s.id === sessionId)) {
            sessionId = genId()
            const newSession: ChatSession = {
              id: sessionId,
              characterId: charId,
              title: '新对话',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              messageCount: 0,
              totalPromptTokens: 0,
              totalCompletionTokens: 0,
              requestCount: 0,
            }
            sessions = { ...sessions, [charId]: [newSession, ...(sessions[charId] ?? [])] }
            messagesBySession = { ...messagesBySession, [sessionId]: [] }
          }

          const existing = messagesBySession[sessionId] ?? []
          const combined = [...existing, message]
          const trimmed = combined.length > MAX_MESSAGES_PER_SESSION
            ? combined.slice(combined.length - MAX_MESSAGES_PER_SESSION)
            : combined

          return {
            sessions,
            messagesBySession: { ...messagesBySession, [sessionId]: trimmed },
            activeSessionByCharacter: { ...state.activeSessionByCharacter, [charId]: sessionId },
          }
        })
      },

      flagMessage: (messageId, violations) => {
        updateActiveMessages(set, (list) =>
          list.map((m) =>
            m.id === messageId
              ? { ...m, flagged: true, consistencyViolations: violations }
              : m,
          ),
        )
      },

      updateMessageContent: (messageId, content) => {
        updateActiveMessages(set, (list) =>
          list.map((m) => (m.id === messageId ? { ...m, content } : m)),
        )
      },

      setMessageConsistency: (messageId, violations) => {
        updateActiveMessages(set, (list) =>
          list.map((m) =>
            m.id === messageId
              ? { ...m, consistencyViolations: violations, flagged: violations.length > 0 ? m.flagged : false }
              : m,
          ),
        )
      },

      updateMessageThink: (messageId, thinkContent) => {
        updateActiveMessages(set, (list) =>
          list.map((m) => (m.id === messageId ? { ...m, thinkContent } : m)),
        )
      },

      // ---- 指标回写 ----

      setMessageMetrics: (messageId, metrics) => {
        const charId = getCurrentCharacterId()
        set((state) => {
          const sessionId = state.activeSessionByCharacter[charId]
          if (!sessionId) return state
          const list = state.messagesBySession[sessionId] ?? []
          const updatedList = list.map((m) =>
            m.id === messageId ? { ...m, metrics } : m,
          )
          // 更新会话级汇总
          const charSessions = (state.sessions[charId] ?? []).map((s) => {
            if (s.id !== sessionId) return s
            return {
              ...s,
              totalPromptTokens: s.totalPromptTokens + metrics.promptTokens,
              totalCompletionTokens: s.totalCompletionTokens + metrics.completionTokens,
              requestCount: s.requestCount + 1,
            }
          })
          return {
            messagesBySession: { ...state.messagesBySession, [sessionId]: updatedList },
            sessions: { ...state.sessions, [charId]: charSessions },
          }
        })
      },
    }),
    {
      name: 'spiritpal-chat-store',
      version: 2,
      storage: createJSONStorage(() => sqliteStorage),
      partialize: (state) => ({
        sessions: state.sessions,
        messagesBySession: state.messagesBySession,
        activeSessionByCharacter: state.activeSessionByCharacter,
      }),
      migrate: (persistedState, version) => {
        const state = persistedState as Record<string, unknown>
        // v1 → v2: 旧格式有 messagesByCharacter，无 sessions
        if (version < 2 && state.messagesByCharacter) {
          return migrateFromLegacy(state) as typeof state
        }
        return state
      },
    },
  ),
)
