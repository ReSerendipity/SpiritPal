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
import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Send,
  Square,
  Trash2,
  Bot,
  User,
  RefreshCw,
  MessagesSquare,
  X,
  Plus,
  Pin,
  PinOff,
  Pencil,
  Check,
  Search,
  Brain,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
// SECURITY R-02 对齐：与桌面端 ChatWindow 使用同一套 rehype-sanitize 配置，
// 阻断 AI 输出型 XSS（此前移动端直接渲染 Markdown，无任何消毒）
import rehypeSanitize from 'rehype-sanitize'
import { composeFullSystemPrompt, getEffectivePersonality } from '@/lib/ai/personalityEngine'
import { getCharacter } from '@/lib/data/characters'
import { getEnhancedMemoryManager } from '@/lib/memory/enhancedMemory'
import { getOwnerFactsManager } from '@/lib/memory/ownerFacts'
import { getCommitmentTracker } from '@/lib/nurture/commitmentTracker'
import { MobileCommitmentBar } from '@/mobile/MobileCommitmentBar'
import { useChatStore } from '@/stores/chatStore'
import { usePetStore } from '@/stores/petStore'
// D8：移动端记忆注入

/**
 * 移动端聊天视图组件
 * @returns 聊天界面组件
 */
export function MobileChatView() {
  const { t } = useTranslation()
  const messagesBySession = useChatStore((s) => s.messagesBySession)
  const activeSessionByCharacter = useChatStore((s) => s.activeSessionByCharacter)
  const isLoading = useChatStore((s) => s.isLoading)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const appendAssistantChunk = useChatStore((s) => s.appendAssistantChunk)
  const finishStreaming = useChatStore((s) => s.finishStreaming)
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const clearHistory = useChatStore((s) => s.clearHistory)
  const setAbortController = useChatStore((s) => s.setAbortController)
  const setLoading = useChatStore((s) => s.setLoading)
  const setMessageStatus = useChatStore((s) => s.setMessageStatus)
  const updateMessageContent = useChatStore((s) => s.updateMessageContent)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- messages 是 ?? [] 逻辑表达式，每次渲染可能产生新引用；用 useMemo 包裹会改变 useEffect 滚动触发时机，故保留原依赖数组
  const messages = messagesBySession[activeSessionId] ?? []

  /** 末条助手消息内容为空或显式 failed/timeout ⇒ 上一轮失败/被中断，可重试 */
  const lastMessage = messages[messages.length - 1]
  const canRetry =
    !!lastMessage &&
    lastMessage.role === 'assistant' &&
    (!lastMessage.content.trim() ||
      lastMessage.sendStatus === 'failed' ||
      lastMessage.sendStatus === 'timeout')

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
  // P1-2: 思维链展开状态（默认折叠，按消息 ID 记忆）
  const [thinkExpanded, setThinkExpanded] = useState<Set<string>>(new Set())
  const toggleThink = (id: string) => {
    setThinkExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  // 与 chatStore.getSessions 同序：置顶优先，再按 updatedAt 降序
  const sessionsSorted = [...sessions].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return b.updatedAt - a.updatedAt
  })

  // 新消息到达时自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // 主题样式类（与桌面端 ChatWindow 一致的语义 Token 配色）
  const bgClass = 'bg-cream'
  const textClass = 'text-ink'
  const bubbleUserClass = 'bg-tangerine text-white'
  const bubbleBotClass = 'border border-ink/10 bg-surface text-ink'
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
    // failed/timeout 的消息可能残留部分流式内容（流中异常），重试前先清空避免拼接
    if (last.content) updateMessageContent(last.id, '')
    void runCompletion(lastUser.content, last.id)
  }

  /**
   * 执行一次补全请求（发送与重试共用）
   * @param text 本轮用户输入
   * @param assistantId 承载回复的助手消息 ID
   */
  async function runCompletion(text: string, assistantId: string) {
    setLoading(true)
    // P0-3: 发送开始 → 显式 pending（成功/失败/超时/中止时由对应路径覆盖）
    setMessageStatus(assistantId, 'pending')

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

      const client = getLLMClient(config)
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
      // 重试场景下末条助手消息内容为空，不应进入上下文
      const history = messages
        .filter((m) => m.content.trim())
        .slice(-20)
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp,
        }))

      // D8：移动端注入记忆上下文
      let memCtx = ''
      try {
        const memMgr = getEnhancedMemoryManager(currentCharacterId)
        await memMgr.ensureLoaded()
        memCtx = await memMgr.getContextForChat(3000, text)
      } catch {
        // 记忆加载失败不影响正常使用
      }

      // P1-7-be：注入约定与计划上下文（桌面端 ChatWindow 有、移动端此前整段没接）
      // 让 AI 知道主人有哪些待完成的计划/承诺，才能在约定日主动关心。
      let commitmentCtx = ''
      try {
        commitmentCtx = await getCommitmentTracker(currentCharacterId).buildContext()
      } catch {
        // 约定上下文不可用不影响正常使用
      }

      const abortController = new AbortController()
      setAbortController(abortController)

      const apiMessages: Array<{ id: string; role: 'system' | 'user' | 'assistant'; content: string; timestamp: number }> = [
        { id: 'system', role: 'system', content: systemPrompt, timestamp: Date.now() },
      ]
      if (memCtx) {
        apiMessages.push({ id: 'mem-ctx', role: 'system', content: memCtx, timestamp: Date.now() })
      }
      if (commitmentCtx) {
        apiMessages.push({ id: 'commitment-ctx', role: 'system', content: commitmentCtx, timestamp: Date.now() })
      }
      apiMessages.push(...history)
      apiMessages.push({ id: 'user', role: 'user', content: text, timestamp: Date.now() })

      const fullText = await client.chat(
        apiMessages,
        (chunk: string) => {
          appendAssistantChunk(assistantId, chunk)
        },
        abortController.signal,
      )

      // D8：移动端写入记忆
      try {
        const memMgr = getEnhancedMemoryManager(currentCharacterId)
        const mem = memMgr.addExchange(text, fullText)
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
      void (async () => {
        const factsMgr = getOwnerFactsManager(currentCharacterId)
        await factsMgr.ensureLoaded()
        await factsMgr.extractAndSave(text)
      })().catch(() => {
        // 事实提取失败不影响回复
      })
      if (abortController.signal.aborted) {
        // P0-3: proxyFetch 不透传 AbortSignal（netProxy 无 signal 支持），用户中止后
        // client.chat 可能正常 resolve 部分文本而非抛 AbortError——以 signal 为准判定，
        // 保留 stopGeneration 已标记的 aborted，绝不静默标成功。
        setMessageStatus(assistantId, 'aborted')
      } else {
        // P0-3: 成功送达 → 清除 pending（sendStatus 回到缺省「已成功」）
        setMessageStatus(assistantId, undefined)
      }
      finishStreaming(assistantId)
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      // P0-3: 精准区分用户中止与超时——llmClient 对用户 abort 抛「LLM 请求已取消」，
      // 对 30s 无响应抛「LLM 请求超时（Ns）」，二者此前混为同一「超时」文案。
      const isAbort =
        (err instanceof DOMException && err.name === 'AbortError') ||
        /已取消|AbortError|aborted/i.test(raw)
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
      setLoading(false)
      setAbortController(null)
    }
  }

  /**
   * 键盘事件处理
   * 移动端不使用 Enter 发送（需要换行），使用发送按钮；
   * 保留 Ctrl/Cmd + Enter 快捷发送
   * @param e React 键盘事件
   */
  function handleKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
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
      {/* 顶部：角色信息 + 会话管理 + 清空按钮 */}
      <header className={`flex items-center justify-between border-b ${inputBorderClass} px-4 py-2`}>
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-tangerine" />
          <span className="text-sm font-medium">{character?.displayName ?? t('tab.pet')}</span>
        </div>
        <div className="flex items-center gap-1">
          {/* P1-1: 会话管理抽屉入口 */}
          <button
            onClick={() => setSessionsOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-faint hover:bg-ink/5 hover:text-ink"
            aria-label={t('chat.sessions.title')}
            title={t('chat.sessions.title')}
          >
            <MessagesSquare size={16} />
          </button>
          <button
            onClick={handleClear}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-faint hover:bg-ink/5 hover:text-error"
            title={t('chat.clearHistory')}
          >
            <Trash2 size={14} />
            {t('app.clear')}
          </button>
        </div>
      </header>

      {/* P1-7-fe: 到期/逾期约定提示（无数据时不渲染） */}
      <div className="px-3 pt-2">
        <MobileCommitmentBar refreshKey={messages.length} />
      </div>

      {/* 消息列表 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3"
        style={{ overscrollBehavior: 'contain' }}
      >
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-ink-faint">
            <Bot size={48} className="mb-3 opacity-40" />
            <p className="text-sm">
              {t('chat.emptyHint', { name: character?.displayName ?? t('tab.pet') })}
            </p>
            <p className="mt-1 text-xs text-ink-muted">{t('chat.markdownHint')}</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`mb-3 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="mr-2 mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blush-soft text-tangerine-deep">
                <Bot size={14} />
              </div>
            )}
            <div
              className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                msg.role === 'user' ? bubbleUserClass : bubbleBotClass
              } ${msg.isStreaming ? 'opacity-90' : ''}`}
            >
              {msg.role === 'assistant' ? (
                <>
                  {/* P1-2: 思维链折叠展示（默认折叠可展开；无 thinkContent 不渲染该块） */}
                  {msg.thinkContent?.trim() && (
                    <div className="mb-1">
                      <button
                        onClick={() => toggleThink(msg.id)}
                        aria-expanded={thinkExpanded.has(msg.id)}
                        className="flex items-center gap-1 rounded-lg bg-blush-soft/70 px-2 py-1 text-[11px] text-tangerine-deep/80"
                      >
                        <Brain size={11} />
                        {t('chat.thinkTitle')}
                        {thinkExpanded.has(msg.id) ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                      </button>
                      {thinkExpanded.has(msg.id) && (
                        <div className="mt-1 rounded-lg border border-blush/40 bg-blush-soft/70 px-2 py-1.5 text-[12px] italic leading-relaxed text-ink-muted">
                          {msg.thinkContent}
                        </div>
                      )}
                    </div>
                  )}
                  {msg.content ? (
                    <Markdown rehypePlugins={[rehypeSanitize]}>{msg.content}</Markdown>
                  ) : msg.sendStatus && msg.sendStatus !== 'pending' ? (
                    /* P0-3: 失败/超时/中止且无内容 → 显示状态文字（替代流式等待的 ...） */
                    <div
                      className={`text-xs ${
                        msg.sendStatus === 'aborted' ? 'text-ink-faint' : 'text-error'
                      }`}
                    >
                      {msg.sendStatus === 'failed' && t('chat.statusFailed')}
                      {msg.sendStatus === 'timeout' && t('chat.statusTimeout')}
                      {msg.sendStatus === 'aborted' && t('chat.statusStopped')}
                    </div>
                  ) : (
                    <Markdown rehypePlugins={[rehypeSanitize]}>{msg.content || '...'}</Markdown>
                  )}
                  {/* 流中中止（已有部分内容）时在气泡尾部补「已停止」标记 */}
                  {msg.content && msg.sendStatus === 'aborted' && (
                    <div className="mt-1 text-[11px] text-ink-faint">{t('chat.statusStopped')}</div>
                  )}
                  {/* 陈旧 pending：App 重启后持久化残留的发送中状态（无流式进行）＝失败 */}
                  {msg.sendStatus === 'pending' && !msg.isStreaming && (
                    <div className="mt-1 text-[11px] text-error">{t('chat.statusFailed')}</div>
                  )}
                </>
              ) : (
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="ml-2 mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-tangerine text-white">
                <User size={14} />
              </div>
            )}
          </div>
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

      {/* 底部输入区：适配软键盘 */}
      <div
        className={`border-t ${inputBorderClass} ${inputBgClass} px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+8px)]`}
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
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-error text-white"
              aria-label={t('app.stop')}
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-tangerine text-white shadow-soft hover:bg-tangerine-deep disabled:opacity-40"
              aria-label={t('app.send')}
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>

      {/* P1-1: 会话管理抽屉（全屏面板） */}
      {sessionsOpen && (
        <div className="absolute inset-0 z-30 flex flex-col bg-cream text-ink">
          {/* 面板头 */}
          <div className="flex items-center justify-between border-b border-ink/10 bg-surface/80 px-4 py-2">
            <span className="text-sm font-semibold">{t('chat.sessions.title')}</span>
            <button
              onClick={() => setSessionsOpen(false)}
              aria-label={t('app.close')}
              className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-ink/5"
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
                    <div className="mt-0.5 text-[10px] text-ink-faint">
                      {new Date(hit.timestamp).toLocaleString()}
                    </div>
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
                      {t('chat.sessions.msgCount', { count: s.messageCount })} ·{' '}
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
