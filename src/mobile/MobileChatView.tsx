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
import { Send, Square, Trash2, Bot, User, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
// SECURITY R-02 对齐：与桌面端 ChatWindow 使用同一套 rehype-sanitize 配置，
// 阻断 AI 输出型 XSS（此前移动端直接渲染 Markdown，无任何消毒）
import rehypeSanitize from 'rehype-sanitize'
import { composeFullSystemPrompt, getEffectivePersonality } from '@/lib/ai/personalityEngine'
import { getCharacter } from '@/lib/data/characters'
import { getEnhancedMemoryManager } from '@/lib/memory/enhancedMemory'
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

  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const character = getCharacter(currentCharacterId)
  const activeSessionId = activeSessionByCharacter[currentCharacterId] ?? ''
  // eslint-disable-next-line react-hooks/exhaustive-deps -- messages 是 ?? [] 逻辑表达式，每次渲染可能产生新引用；用 useMemo 包裹会改变 useEffect 滚动触发时机，故保留原依赖数组
  const messages = messagesBySession[activeSessionId] ?? []

  /** 末条助手消息内容为空 ⇒ 上一轮失败/被中断，可重试 */
  const lastMessage = messages[messages.length - 1]
  const canRetry = !!lastMessage && lastMessage.role === 'assistant' && !lastMessage.content.trim()

  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

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
    // 仅当末条是「内容为空的助手消息」时才允许重试（即上一轮确实失败/被中断）
    if (!last || last.role !== 'assistant' || last.content.trim()) return
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUser) return
    setError(null)
    void runCompletion(lastUser.content, last.id)
  }

  /**
   * 执行一次补全请求（发送与重试共用）
   * @param text 本轮用户输入
   * @param assistantId 承载回复的助手消息 ID
   */
  async function runCompletion(text: string, assistantId: string) {
    setLoading(true)

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
        finishStreaming(assistantId)
        setLoading(false)
        return
      }

      const client = getLLMClient(config)
      const char = getCharacter(currentCharacterId)
      if (!char) {
        setError(t('chat.errNoCharacter'))
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

      const abortController = new AbortController()
      setAbortController(abortController)

      const apiMessages: Array<{ id: string; role: 'system' | 'user' | 'assistant'; content: string; timestamp: number }> = [
        { id: 'system', role: 'system', content: systemPrompt, timestamp: Date.now() },
      ]
      if (memCtx) {
        apiMessages.push({ id: 'mem-ctx', role: 'system', content: memCtx, timestamp: Date.now() })
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
        memMgr.addExchange(text, fullText)
      } catch {
        // 记忆写入失败不影响正常使用
      }
      finishStreaming(assistantId)
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      // 常见错误转译为用户语言（原始技术错误保留在括号内便于排查）
      let msg = raw
      if (/error sending request for url|network|fetch failed|ERR_CONNECTION/i.test(raw)) {
        msg = t('chat.errNetwork')
      } else if (/401|403|unauthorized|invalid[ _-]?api[ _-]?key/i.test(raw)) {
        msg = t('chat.errAuth')
      } else if (/timeout|timed out|aborted/i.test(raw)) {
        msg = t('chat.errTimeout')
      }
      setError(msg)
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
    <div className={`flex h-full w-full flex-col ${bgClass} ${textClass}`}>
      {/* 顶部：角色信息 + 清空按钮 */}
      <header className={`flex items-center justify-between border-b ${inputBorderClass} px-4 py-2`}>
        <div className="flex items-center gap-2">
          <Bot size={18} className="text-tangerine" />
          <span className="text-sm font-medium">{character?.displayName ?? t('tab.pet')}</span>
        </div>
        <button
          onClick={handleClear}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-faint hover:bg-ink/5 hover:text-error"
          title={t('chat.clearHistory')}
        >
          <Trash2 size={14} />
          {t('app.clear')}
        </button>
      </header>

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
                <Markdown rehypePlugins={[rehypeSanitize]}>{msg.content || '...'}</Markdown>
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
    </div>
  )
}
