/**
 * 移动端聊天视图组件
 * @module mobile/MobileChatView
 * @description
 * 移动端聊天界面，包含消息列表、输入框，适配移动端软键盘弹出。
 * 与桌面端共享 chatStore，复用状态和流式输出逻辑。
 *
 * 功能特性：
 * - 消息列表自动滚动到底部
 * - 输入框固定底部，键盘弹出时自动上移（使用 dvh 视口单位）
 * - 流式输出支持（与桌面端 ChatWindow 共享 chatStore）
 * - Markdown 渲染支持
 * - 消息角色区分（用户/AI 头像、气泡样式）
 * - 停止生成按钮
 * - 清空历史按钮
 * - 错误提示显示
 *
 * @see {@link ../stores/chatStore} 聊天状态 Store
 * @see {@link ../stores/petStore} 宠物状态 Store
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Send,
  Square,
  Trash2,
  Bot,
  RefreshCw,
  MessagesSquare,
  X,
  Plus,
  Pin,
  PinOff,
  Pencil,
  Check,
  Search,
  ChevronUp,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ChatContextPanel } from '@/components/chat/ChatContextPanel'
import { ChatMessageCard } from '@/components/chat/ChatMessageCard'
import { ChatViewControls } from '@/components/chat/ChatViewControls'
import '@/components/chat/chat-workspace.css'
import { getEmotionAnalyzer, getEmotionStateManager } from '@/lib/ai/emotionEngine'
import { extractEmotion, emotionTagsToMood } from '@/lib/ai/emotionExtractor'
import { stripEmotionTags, extractEmotionTagKeywords } from '@/lib/ai/emotionTagFilter'
import type { LLMClient } from '@/lib/ai/llmClient'
import { truncateAssistantHistory } from '@/lib/ai/onDeviceContext'
import { composeFullSystemPrompt, getEffectivePersonality } from '@/lib/ai/personalityEngine'
import { getCharacter } from '@/lib/data/characters'
import type { ChatMessage } from '@/lib/data/types'
import { prepareChatMemory } from '@/lib/memory/chatMemoryContext'
import { getContextEpisodeManager } from '@/lib/memory/contextEpisodeManager'
import { deriveEmotionalIntensity } from '@/lib/memory/emotionIntensity'
import { getEnhancedMemoryManager } from '@/lib/memory/enhancedMemory'
import { getOwnerFactsManager } from '@/lib/memory/ownerFacts'
import { getCommitmentTracker } from '@/lib/nurture/commitmentTracker'
import { ThinkTagParser } from '@/lib/render/thinkTagParser'
import { MobileCommitmentBar } from '@/mobile/MobileCommitmentBar'
import { useChatStore } from '@/stores/chatStore'
import { usePetStore } from '@/stores/petStore'
// D8：移动端记忆注入

/**
 * 端侧（on-device MNN）聊天上下文预算。
 *
 * 背景：真机实测（RMX5010 / Qwen3.5-0.8B-MNN / 2B-MNN）prefill 一度到 **4359 token** ——
 * 大头不是系统提示词（persona + 性格块合计仅约 400 token），而是
 * `getContextForChat(3000)` 的记忆上下文 + **最近 20 轮**对话历史。
 * 小模型在这种 prompt 长度下注意力被大幅稀释，出现「角色没搞对、简单比较题也答错」——
 * 2B 的推理日志里甚至专门花一段纠正自己看到的 persona 块
 * （"Self-Correction: ... the prompt contained a 'System Instruction' block"）。
 *
 * 故对端侧单独收紧预算：prompt 越短，小模型越准，prefill 也越快。
 * 云端 provider 保留原预算（大模型吃得住）。
 */
export const ON_DEVICE_MEM_TOKEN_BUDGET = 1000
export const ON_DEVICE_HISTORY_TURNS = 6
export const CLOUD_HISTORY_TURNS = 20

/**
 * 移动端聊天视图组件
 * @returns 聊天界面组件
 */
export function MobileChatView({ onManageMemory }: { onManageMemory?: () => void } = {}) {
  const { t } = useTranslation()
  const [memoryEnabled, setMemoryEnabled] = useState(true)
  const [contextOpen, setContextOpen] = useState(false)
  const [modelLabel, setModelLabel] = useState(t('chatUi.scope.modelFromSettings'))
  const [hasUnread, setHasUnread] = useState(false)
  const followBottom = useRef(true)
  const messagesBySession = useChatStore((s) => s.messagesBySession)
  const activeSessionByCharacter = useChatStore((s) => s.activeSessionByCharacter)
  const isLoading = useChatStore((s) => s.isLoading)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const finishStreaming = useChatStore((s) => s.finishStreaming)
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const clearHistory = useChatStore((s) => s.clearHistory)
  const setAbortController = useChatStore((s) => s.setAbortController)
  const setLoading = useChatStore((s) => s.setLoading)
  const setMessageStatus = useChatStore((s) => s.setMessageStatus)
  const updateMessageContent = useChatStore((s) => s.updateMessageContent)
  // P1-2b：思维链折叠展示（流式写入 thinkContent，UI 侧默认折叠）
  const updateMessageThink = useChatStore((s) => s.updateMessageThink)
  // P2-14：消息指标回写（tokens/TTFT/速率）
  const setMessageMetrics = useChatStore((s) => s.setMessageMetrics)
  // P1-1: 多会话管理
  const createSession = useChatStore((s) => s.createSession)
  const switchSession = useChatStore((s) => s.switchSession)
  const deleteSession = useChatStore((s) => s.deleteSession)
  const renameSession = useChatStore((s) => s.renameSession)
  const togglePinSession = useChatStore((s) => s.togglePinSession)
  const searchMessages = useChatStore((s) => s.searchMessages)

  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const character = getCharacter(currentCharacterId)
  const activeSessionId = activeSessionByCharacter[currentCharacterId] ?? ''
  // P1-1: 当前角色会话列表。注意 selector 必须返回稳定引用（zustand v5
  // useSyncExternalStore 要求），不能写 (s) => s.sessions[id] ?? [] ——
  // ?? [] 每次产生新数组会导致无限重渲染。
  const charSessions = useChatStore((s) => s.sessions[currentCharacterId])
  const sessions = charSessions ?? []
  const temporary = sessions.find((session) => session.id === activeSessionId)?.temporary ?? false
  const messages = useMemo(() => messagesBySession[activeSessionId] ?? [], [messagesBySession, activeSessionId])
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant')

  /** 末条助手消息内容为空或显式 failed/timeout ⇒ 上一轮失败/被中断，可重试 */
  const lastMessage = messages[messages.length - 1]
  const canRetry =
    !!lastMessage &&
    lastMessage.role === 'assistant' &&
    (!lastMessage.content.trim() || lastMessage.sendStatus === 'failed' || lastMessage.sendStatus === 'timeout')

  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // P1-1: 会话管理抽屉状态
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const searchHits = searchQuery.trim() ? searchMessages(searchQuery) : []
  // 与 chatStore.getSessions 同序：置顶优先，再按 updatedAt 降序
  const sessionsSorted = [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return b.updatedAt - a.updatedAt
  })

  useEffect(() => {
    followBottom.current = true
    setHasUnread(false)
  }, [activeSessionId])

  useEffect(() => {
    try {
      const saved = localStorage.getItem('spiritpal-ai-config')
      if (!saved) return
      const config = JSON.parse(saved) as { model?: string; provider?: string }
      if (config.model) setModelLabel(`${config.model}${config.provider ? ` · ${config.provider}` : ''}`)
    } catch {
      // 配置读取失败时保持中性占位，不阻断聊天
    }
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element) return
    if (followBottom.current) element.scrollTop = element.scrollHeight
    else setHasUnread(true)
  }, [messages])

  function scrollToLatest() {
    followBottom.current = true
    setHasUnread(false)
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }

  function editMessage(message: ChatMessage) {
    if (isLoading) return
    const sessionId = useChatStore.getState().forkSessionAtMessage(message.id)
    if (!sessionId) return
    setInput(message.content)
    setError(null)
    inputRef.current?.focus()
  }

  function regenerateMessage(message: ChatMessage) {
    if (isLoading) return
    const index = messages.findIndex((item) => item.id === message.id)
    const user = messages
      .slice(0, index)
      .reverse()
      .find((item) => item.role === 'user')
    if (!user || !useChatStore.getState().forkSessionAtMessage(user.id)) return
    const assistantId = sendMessage(user.content)
    setError(null)
    void runCompletion(user.content, assistantId)
  }

  // 主题样式类（与桌面端 ChatWindow 一致的语义 Token 配色）
  const bgClass = 'bg-cream'
  const textClass = 'text-ink'
  const inputBgClass = 'bg-surface'
  const inputBorderClass = 'border-ink/10'

  /**
   * 发送消息处理函数
   * 读取 AI 配置、获取 API Key、调用 LLM 客户端进行流式对话
   */
  async function handleSend() {
    const text = input.trim()
    if (!text) return
    // 生成中拦截：消息保留在输入框不丢失，但给出可见提示（此前为静默 return）
    if (isLoading) {
      setError(t('chat.errGenerating'))
      return
    }
    setInput('')
    setError(null)
    // 重置输入框高度
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }

    const assistantId = sendMessage(text)
    await runCompletion(text, assistantId)
  }

  /**
   * 重试上一条失败的回复（对齐桌面端 ChatWindow 的「重新生成」）
   *
   * 复用同一条助手消息：失败后该消息内容为空，重试即重新填充它，
   * 不向历史追加新的用户/助手轮次（避免历史里堆叠重复对话）。
   */
  function handleRetry() {
    if (isLoading) return
    const last = messages[messages.length - 1]
    // 仅当末条是「内容为空的助手消息」或显式 failed/timeout 时才允许重试
    if (
      !last ||
      last.role !== 'assistant' ||
      (last.content.trim() && last.sendStatus !== 'failed' && last.sendStatus !== 'timeout')
    )
      return
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    setError(null)
    useChatStore.getState().startGeneration(last.id)
    void runCompletion(lastUser.content, last.id)
  }

  /**
   * 执行一次补全请求（发送与重试共用）
   * @param text 本轮用户输入
   * @param assistantId 承载回复的助手消息 ID
   */
  async function runCompletion(text: string, assistantId: string) {
    const snapshot = useChatStore.getState()
    const sessionId = Object.keys(snapshot.messagesBySession).find((id) =>
      snapshot.messagesBySession[id]?.some((message) => message.id === assistantId),
    )
    if (!sessionId) return
    const isTemporary =
      snapshot.sessions[currentCharacterId]?.find((session) => session.id === sessionId)?.temporary ?? false
    const useMemory = memoryEnabled && !isTemporary
    const sessionMessages = snapshot.messagesBySession[sessionId] ?? []
    const assistantIndex = sessionMessages.findIndex((message) => message.id === assistantId)
    const priorMessages = sessionMessages.slice(0, Math.max(0, assistantIndex - 1))
    const abortController = new AbortController()
    setAbortController(abortController, assistantId)
    setMessageStatus(assistantId, 'pending')
    let client: LLMClient | undefined
    const thinkParser = new ThinkTagParser()
    try {
      // 延迟导入避免循环依赖
      const { getLLMClient, DEFAULT_AI_CONFIG } = await import('@/lib/ai/llmClient')
      const { getApiKey } = await import('@/lib/data/secureStorage')

      const AI_CONFIG_KEY = 'spiritpal-ai-config'
      let config = DEFAULT_AI_CONFIG
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
        // 忽略密钥获取错误
      }

      // 端侧（移动端 = 进程内 MNN 引擎）无需 API Key；custom / ollama 常指向
      // llama.cpp 等**无鉴权本地服务**，同样不客户端强制——Key 真必要时由服务端
      // 401 在聊天错误条兜底（移动端 keychain 未接线，见 docs/execution/chat-llama-e2e-20260928.md P1-A）。
      const keylessProviders = ['ondevice', 'custom', 'ollama']
      if (!config.apiKey && !keylessProviders.includes(config.provider)) {
        setError(t('chat.errNoApiKey'))
        setMessageStatus(assistantId, 'failed')
        finishStreaming(assistantId)
        setLoading(false)
        return
      }

      abortController.signal.throwIfAborted()
      client = getLLMClient(config)
      setModelLabel(`${config.model} · ${config.provider}`)
      const char = getCharacter(currentCharacterId)
      if (!char) {
        setError(t('chat.errNoCharacter'))
        setMessageStatus(assistantId, 'failed')
        finishStreaming(assistantId)
        setLoading(false)
        return
      }

      const personality = getEffectivePersonality(currentCharacterId, char.personality)
      const systemPrompt = composeFullSystemPrompt(char.systemPrompt, personality)
      // 端侧上下文预算（见文件顶部注释）：小模型喂太长上下文会明显变笨、prefill 也变慢
      const isOnDevice = config.provider === 'ondevice'
      const historyTurns = isOnDevice ? ON_DEVICE_HISTORY_TURNS : CLOUD_HISTORY_TURNS
      // 重试场景下末条助手消息内容为空，不应进入上下文
      const history = truncateAssistantHistory(
        priorMessages
          .filter((m) => m.content.trim())
          .slice(-historyTurns)
          .map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: m.timestamp,
          })),
        // 端侧：截断助手自己的历史输出，降低「被自己上一轮的错误答案锚死」的概率（GOTCHAS #184）
        isOnDevice,
      )

      const preparedMemory = await prepareChatMemory({
        characterId: currentCharacterId,
        query: text,
        enabled: memoryEnabled,
        temporary: isTemporary,
        contextBudget: isOnDevice ? ON_DEVICE_MEM_TOKEN_BUDGET : 3000,
        totalBudget: isOnDevice ? 1500 : 5000,
      })
      abortController.signal.throwIfAborted()
      const apiMessages: ChatMessage[] = [
        { id: 'system', role: 'system', content: systemPrompt, timestamp: Date.now() },
        ...preparedMemory.messages,
        ...history,
        { id: 'user', role: 'user', content: text, timestamp: Date.now() },
      ]
      useChatStore.getState().setMessageMemoryTrace(assistantId, preparedMemory.trace)
      if (useMemory)
        void getContextEpisodeManager(currentCharacterId)
          .recordStateChange('chatting')
          .catch(() => {})
      const fullText = await client.chat(
        apiMessages,
        (chunk: string) => {
          const parsed = thinkParser.push(chunk)
          // 用「覆盖」而非「追加」：解析器遇到裸 `</think>`（开标签被 chat template 预填）时，
          // 会把此前**已经吐出的正文回溯改判为思考**，追加式写法撤不回来，只有整段覆盖才与解析结果一致。
          updateMessageContent(assistantId, stripEmotionTags(parsed.replyContent))
          if (parsed.thinkContent) {
            updateMessageThink(assistantId, parsed.thinkContent)
          }
        },
        abortController.signal,
        (metrics) => setMessageMetrics(assistantId, metrics),
      )
      abortController.signal.throwIfAborted()
      // 流结束：flush 补上仍扣在 buffer 里的尾巴（不足一个标签长度、无法判定为标签前缀的部分）
      const finalParsed = thinkParser.flush()
      updateMessageContent(assistantId, stripEmotionTags(finalParsed.replyContent))
      if (finalParsed.thinkContent) {
        updateMessageThink(assistantId, finalParsed.thinkContent)
      }

      try {
        const finalMetrics = client.lastCallMetrics
        if (finalMetrics) setMessageMetrics(assistantId, { ...finalMetrics, status: 'completed' })
      } catch {
        // 指标采集失败不影响对话
      }

      // D8：移动端写入记忆（临时聊天或本轮关闭记忆时绝不写入）
      if (useMemory)
        try {
          const memMgr = getEnhancedMemoryManager(currentCharacterId)
          const extraction = extractEmotion(fullText)
          const mem = memMgr.addExchange(text, extraction.cleanText)
          const analyzer = getEmotionAnalyzer()
          const replyAnalysis = analyzer.analyze(extraction.cleanText)
          memMgr.updateMemoryIntensity(
            mem.id,
            deriveEmotionalIntensity(
              mem.emotionalIntensity,
              [...extraction.animations, ...extractEmotionTagKeywords(fullText)],
              replyAnalysis,
              analyzer.analyze(text),
            ),
          )
          const mood = emotionTagsToMood(extraction.animations)
          if (mood) memMgr.updateMemoryMood(mem.id, mood.valence, mood.arousal)
          getEmotionStateManager().update(replyAnalysis)
          // P1-3-be: 规则层实体提取（EntityManager.extractAndLink）→ 节点写入
          // 图谱表 memory_entities + 同记忆共现实体两两建边 memory_entity_edges。
          // 此前抽取无生产调用且 entityLinking 只写旧表（sp_entity_*），图谱两端恒空。
          try {
            const { getEntityManager } = await import('@/lib/memory/entityLinking')
            const { upsertEntity, upsertEntityEdge } = await import('@/lib/memory/entityGraph')
            const em = getEntityManager(currentCharacterId)
            await em.ensureLoaded()
            const nodes = em.extractAndLink(text, mem.id)
            // entityLinking 与 entityGraph 的类型命名漂移：place↔location、thing↔object
            const typeMap: Record<string, 'person' | 'location' | 'object' | 'time' | 'concept' | 'event'> = {
              person: 'person',
              place: 'location',
              thing: 'object',
              time: 'time',
              concept: 'concept',
              event: 'event',
            }
            const ids: string[] = []
            for (const n of nodes) {
              ids.push(await upsertEntity(n.name, typeMap[n.type] ?? 'concept', mem.id))
            }
            for (let i = 0; i < ids.length; i++) {
              for (let j = i + 1; j < ids.length; j++) {
                await upsertEntityEdge(ids[i]!, ids[j]!, 1.0)
              }
            }
          } catch {
            // 实体提取失败不影响记忆写入
          }
        } catch {
          // 记忆写入失败不影响正常使用
        }
      // P1-7-be：从本轮对话抽取约定并落库，并自动把超期未提及的置为 lapsed
      // 与桌面端同序：记忆写入之后、主人事实提取之前；失败一律不影响回复。
      if (useMemory)
        void (async () => {
          const tracker = getCommitmentTracker(currentCharacterId)
          const extracted = tracker.extractFromText(text, fullText)
          for (const ext of extracted) {
            await tracker.saveCommitment(ext)
          }
          await tracker.autoLapseOverdue()
        })().catch(() => {
          // 约定提取失败不影响回复
        })
      // P2-1：规则层提取主人事实（桌面端 ChatWindow 有、移动端此前整段没接）
      // 只接规则层：纯正则 + 一次 upsert，不额外发 LLM 请求，
      // 否则每聊一句就多一次网络调用，手机上的流量/配额代价要单独决策。
      // 用 void 异步跑（与桌面端同一写法），不挡住 finishStreaming。
      if (useMemory)
        void (async () => {
          const factsMgr = getOwnerFactsManager(currentCharacterId)
          await factsMgr.ensureLoaded()
          await factsMgr.extractAndSave(text)
        })().catch(() => {
          // 事实提取失败不影响回复
        })
      if (abortController.signal.aborted) setMessageStatus(assistantId, 'aborted')
      else setMessageStatus(assistantId, undefined)
      if (useMemory)
        void getContextEpisodeManager(currentCharacterId)
          .recordStateChange('idle')
          .catch(() => {
            /* 情境记录失败不影响回复 */
          })
      finishStreaming(assistantId)
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      // P0-3: 精准区分用户中止与超时——llmClient 对用户 abort 抛「LLM 请求已取消」，
      // 对 30s 无响应抛「LLM 请求超时（Ns）」，二者此前混为同一「超时」文案。
      const isAbort =
        (err instanceof DOMException && err.name === 'AbortError') || /已取消|AbortError|aborted/i.test(raw)
      if (isAbort) {
        // 用户主动停止：非错误，不弹错误横幅（store.stopGeneration 亦会标记 aborted）
        setMessageStatus(assistantId, 'aborted')
        setError(null)
      } else if (/超时|timed?[ _-]?out|timeout/i.test(raw)) {
        setMessageStatus(assistantId, 'timeout')
        setError(t('chat.errTimeout'))
      } else {
        setMessageStatus(assistantId, 'failed')
        // 常见错误转译为用户语言（原始技术错误保留在括号内便于排查）
        let msg = raw
        if (/error sending request for url|network|fetch failed|ERR_CONNECTION/i.test(raw)) {
          msg = t('chat.errNetwork')
        } else if (/401|403|unauthorized|invalid[ _-]?api[ _-]?key/i.test(raw)) {
          msg = t('chat.errAuth')
        }
        setError(msg)
      }
      finishStreaming(assistantId)
    } finally {
      if (useChatStore.getState().activeGenerationId === assistantId) setLoading(false)
      setAbortController(null, assistantId)
    }
  }

  /**
   * 键盘事件处理
   * 移动端不使用 Enter 发送（需要换行），使用发送按钮；
   * 保留 Ctrl/Cmd + Enter 快捷发送
   * @param e React 键盘事件
   */
  function handleKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      void handleSend()
    }
  }

  /**
   * 输入框内容变化处理（高度自适应）
   * @param e React change 事件
   */
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value)
    const el = e.target
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  /**
   * 停止生成按钮点击处理
   */
  function handleStop() {
    stopGeneration()
  }

  /**
   * 清空历史按钮点击处理
   */
  function handleClear() {
    clearHistory()
    setError(null)
  }

  return (
    <div className={`relative flex h-full w-full flex-col ${bgClass} ${textClass}`}>
      <header className="chat-header">
        <div className="flex min-w-0 items-center gap-2">
          <Bot size={18} className="shrink-0 text-tangerine" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {character?.displayName ?? t('tab.pet')}
              {temporary && (
                <span className="ml-1.5 rounded bg-ink/8 px-1 py-0.5 text-[10px] font-normal text-ink-faint">
                  {t('chatUi.scope.tempBadge')}
                </span>
              )}
            </div>
            <div className="truncate text-[10px] text-ink-faint">{modelLabel}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={() => setSessionsOpen(true)}
            className="relative flex h-10 w-10 items-center justify-center rounded-lg text-ink-faint after:absolute after:-inset-2 after:content-[''] hover:bg-ink/5 hover:text-ink"
            aria-label={t('chat.sessions.title')}
            title={t('chat.sessions.title')}
          >
            <MessagesSquare size={16} />
          </button>
          <button
            onClick={() => setContextOpen(true)}
            className="relative flex h-10 w-10 items-center justify-center rounded-lg text-ink-faint hover:bg-ink/5 hover:text-ink"
            aria-label={t('chatUi.scope.context')}
            title="本轮指标与记忆引用"
          >
            <ChevronUp size={16} />
          </button>
          <ChatViewControls />
          <button
            onClick={handleClear}
            className="relative flex h-10 w-10 items-center justify-center rounded-lg text-ink-faint after:absolute after:-inset-2 after:content-[''] hover:bg-ink/5 hover:text-error"
            aria-label={t('app.clear')}
            title={t('chat.clearHistory')}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-ink/8 px-3 py-1.5 text-[11px]">
        <label className="flex min-h-8 items-center gap-1.5 text-ink-muted">
          <input
            type="checkbox"
            className="h-4 w-4 accent-tangerine"
            checked={memoryEnabled && !temporary}
            disabled={temporary}
            onChange={(event) => setMemoryEnabled(event.target.checked)}
            aria-label={t('chatUi.context.memory')}
          />
          {t('chatUi.context.memory')}
        </label>
        <button
          type="button"
          aria-pressed={temporary}
          onClick={() => {
            if (isLoading) return
            const created = createSession(temporary ? undefined : { temporary: true })
            if (created) setError(null)
          }}
          className={`min-h-8 rounded-full px-2.5 ${temporary ? 'bg-tangerine/15 text-tangerine-deep' : 'text-ink-faint hover:bg-ink/5'}`}
        >
          {temporary ? t('chatUi.scope.exitTemp') : t('chatUi.scope.temp')}
        </button>
        <span className="ml-auto text-ink-faint">
          {latestAssistant?.memoryTrace
            ? t('chatUi.scope.memoryInjected', { count: latestAssistant.memoryTrace.sections.length })
            : t('chatUi.scope.memoryState')}
        </span>
      </div>

      {/* P1-7-fe: 到期/逾期约定提示（无数据时不渲染） */}
      <div className="px-3 pt-2">
        <MobileCommitmentBar refreshKey={messages.length} />
      </div>

      <div
        ref={scrollRef}
        className="chat-scroll"
        style={{ overscrollBehavior: 'contain' }}
        onScroll={(event) => {
          const el = event.currentTarget
          followBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48
          if (followBottom.current && hasUnread) setHasUnread(false)
        }}
        role="log"
        aria-live="polite"
        aria-label="聊天消息列表"
      >
        <div className="chat-transcript">
          {messages.length === 0 && (
            <div className="chat-empty">
              <Bot size={44} className="mb-3 opacity-40" />
              <p className="text-sm">{t('chat.emptyHint', { name: character?.displayName ?? t('tab.pet') })}</p>
              <p className="mt-1 text-xs text-ink-muted">{t('chat.markdownHint')}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {[t('chatUi.scope.suggestion1'), t('chatUi.scope.suggestion2'), t('chatUi.scope.suggestion3')].map(
                  (suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        setInput(suggestion)
                        inputRef.current?.focus()
                      }}
                      className="min-h-9 rounded-full border border-ink/10 bg-surface px-3 text-xs text-ink-muted hover:border-tangerine/40 hover:text-tangerine-deep"
                    >
                      {suggestion}
                    </button>
                  ),
                )}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <ChatMessageCard key={msg.id} message={msg} onEdit={editMessage} onRegenerate={regenerateMessage} />
          ))}

          {error && (
            <div className="mb-3 rounded-lg border border-ink/10 bg-surface px-3 py-2 text-xs text-error ring-1 ring-error/40">
              <div className="flex items-start gap-2">
                <span className="flex-1">{error}</span>
                {/* 重试：仅当末条助手消息为空（上一轮确实失败）时可用 */}
                {canRetry && (
                  <button
                    type="button"
                    onClick={handleRetry}
                    disabled={isLoading}
                    className={`flex flex-shrink-0 items-center gap-1 rounded-md border border-ink/15 px-2 py-0.5 text-[11px] text-ink ${
                      isLoading ? 'opacity-50' : 'hover:bg-ink/5'
                    }`}
                  >
                    <RefreshCw size={11} />
                    {t('app.retry')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {hasUnread && (
        <button
          type="button"
          onClick={scrollToLatest}
          className="absolute bottom-24 left-1/2 z-20 min-h-9 -translate-x-1/2 rounded-full border border-ink/10 bg-surface px-3 text-xs text-ink shadow-soft"
        >
          {t('chatUi.scope.backToLatest')}
        </button>
      )}

      {/* 底部输入区：适配软键盘 */}
      <div
        className={`chat-composer border-t ${inputBorderClass} ${inputBgClass} px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+8px)]`}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={t('chat.placeholder')}
            rows={1}
            className={`flex-1 resize-none rounded-panel ${inputBgClass} ${textClass} border ${inputBorderClass} px-3 py-2 text-sm placeholder-ink-faint outline-none focus:ring-1 focus:ring-tangerine`}
            style={{ maxHeight: '120px' }}
          />
          {isLoading ? (
            <button
              onClick={handleStop}
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-error text-white"
              aria-label={t('app.stop')}
            >
              <Square size={18} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-tangerine text-white shadow-soft hover:bg-tangerine-deep disabled:opacity-40"
              aria-label={t('app.send')}
            >
              <Send size={18} />
            </button>
          )}
        </div>
      </div>

      {contextOpen && (
        <div className="absolute inset-0 z-30 flex flex-col bg-cream text-ink">
          <div className="flex items-center justify-between border-b border-ink/10 px-4 py-2">
            <span className="text-sm font-semibold">{t('chatUi.scope.context')}</span>
            <button
              onClick={() => setContextOpen(false)}
              aria-label={t('app.close')}
              className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-ink/5"
            >
              <X size={18} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <ChatContextPanel message={latestAssistant} onManage={onManageMemory} />
          </div>
        </div>
      )}

      {/* P1-1: 会话管理抽屉（全屏面板） */}
      {sessionsOpen && (
        <div className="absolute inset-0 z-30 flex flex-col bg-cream text-ink">
          {/* 面板头 */}
          <div className="flex items-center justify-between border-b border-ink/10 bg-surface/80 px-4 py-2">
            <span className="text-sm font-semibold">{t('chat.sessions.title')}</span>
            <button
              onClick={() => setSessionsOpen(false)}
              aria-label={t('app.close')}
              className="relative flex h-9 w-9 items-center justify-center rounded-full hover:bg-ink/5 after:absolute after:-inset-2 after:content-['']"
            >
              <X size={18} />
            </button>
          </div>

          {/* 消息全文搜索 */}
          <div className="px-3 pb-2 pt-3">
            <div className="flex items-center gap-2 rounded-xl border border-ink/10 bg-surface px-3 py-2">
              <Search size={15} className="text-ink-faint" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t('chat.sessions.searchPlaceholder')}
                className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  aria-label={t('app.cancel')}
                  className="text-ink-faint hover:text-ink"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            {searchQuery.trim() && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-ink/10 bg-surface">
                {searchHits.length === 0 && (
                  <div className="px-3 py-3 text-xs text-ink-faint">{t('chat.sessions.searchNoHit')}</div>
                )}
                {searchHits.map((hit) => (
                  <button
                    key={hit.messageId}
                    onClick={() => {
                      switchSession(hit.sessionId)
                      setSessionsOpen(false)
                      setSearchQuery('')
                    }}
                    className="block w-full border-b border-ink/5 px-3 py-2 text-left last:border-b-0 hover:bg-ink/5"
                  >
                    <div className="text-xs text-ink">{hit.snippet}</div>
                    <div className="mt-0.5 text-[10px] text-ink-faint">{new Date(hit.timestamp).toLocaleString()}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 新建会话 */}
          <div className="px-3 pb-2">
            <button
              onClick={() => {
                createSession()
                setEditingId(null)
                setDeleteConfirmId(null)
              }}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-ink/10 bg-surface py-2.5 text-sm font-medium text-tangerine-deep hover:bg-tangerine-soft"
            >
              <Plus size={15} />
              {t('chat.sessions.new')}
            </button>
          </div>

          {/* 会话列表（置顶优先 + 最近更新在前） */}
          <div className="flex-1 overflow-y-auto px-3 pb-4">
            {sessionsSorted.length === 0 && (
              <div className="py-6 text-center text-xs text-ink-faint">{t('chat.sessions.empty')}</div>
            )}
            {sessionsSorted.map((s) => {
              const isActive = s.id === activeSessionId
              if (editingId === s.id) {
                return (
                  <div key={s.id} className="mb-2 rounded-xl border border-tangerine/50 bg-surface p-2">
                    <input
                      autoFocus
                      value={editingTitle}
                      onChange={(e) => setEditingTitle(e.target.value)}
                      aria-label={t('chat.sessions.rename')}
                      className="w-full rounded-lg border border-ink/10 bg-cream px-2 py-1.5 text-sm text-ink outline-none"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => {
                          setEditingId(null)
                          setEditingTitle('')
                        }}
                        aria-label={t('app.cancel')}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/10 text-ink-faint"
                      >
                        <X size={14} />
                      </button>
                      <button
                        onClick={() => {
                          const title = editingTitle.trim()
                          if (title) renameSession(s.id, title)
                          setEditingId(null)
                          setEditingTitle('')
                        }}
                        aria-label={t('app.confirm')}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-tangerine text-white"
                      >
                        <Check size={14} />
                      </button>
                    </div>
                  </div>
                )
              }
              return (
                <div
                  key={s.id}
                  data-testid={`session-card-${s.id}`}
                  className={`mb-2 rounded-xl border p-2.5 ${
                    isActive ? 'border-tangerine/60 bg-tangerine-soft/40' : 'border-ink/10 bg-surface'
                  }`}
                >
                  <button
                    onClick={() => {
                      switchSession(s.id)
                      setSessionsOpen(false)
                    }}
                    className="block w-full text-left"
                  >
                    <div className="flex items-center gap-1.5">
                      {s.pinned && <Pin size={12} className="flex-shrink-0 text-tangerine" />}
                      <span className="flex-1 truncate text-sm font-medium text-ink">{s.title}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-ink-faint">
                      {t('chat.sessions.msgCount', { count: s.messageCount ?? 0 })} ·{' '}
                      {new Date(s.updatedAt).toLocaleDateString()}
                    </div>
                  </button>
                  {deleteConfirmId === s.id ? (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="flex-1 text-xs text-error">{t('chat.sessions.confirmDelete')}</span>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        aria-label={t('app.cancel')}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-ink/10 text-ink"
                      >
                        <X size={13} />
                      </button>
                      <button
                        onClick={() => {
                          deleteSession(s.id)
                          setDeleteConfirmId(null)
                        }}
                        aria-label={t('app.confirm')}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-error text-xs text-white"
                      >
                        <Check size={13} />
                      </button>
                    </div>
                  ) : (
                    <div className="mt-2 flex items-center gap-1">
                      <button
                        onClick={() => togglePinSession(s.id)}
                        aria-label={s.pinned ? t('chat.sessions.unpin') : t('chat.sessions.pin')}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-ink/5"
                      >
                        {s.pinned ? <PinOff size={14} /> : <Pin size={14} />}
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(s.id)
                          setEditingTitle(s.title)
                        }}
                        aria-label={t('chat.sessions.rename')}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-ink/5"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(s.id)}
                        aria-label={t('app.delete')}
                        className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-ink-faint hover:bg-ink/5 hover:text-error"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
