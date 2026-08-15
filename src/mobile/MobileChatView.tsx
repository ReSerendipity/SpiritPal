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
import Markdown from 'react-markdown'
import { Send, Square, Trash2, Bot, User } from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { usePetStore } from '../stores/petStore'
import { getCharacter } from '../lib/characters'
// D8：移动端记忆注入
import { getEnhancedMemoryManager } from '../lib/enhancedMemory'
import { composeFullSystemPrompt, getEffectivePersonality } from '../lib/personalityEngine'

/**
 * MobileChatView 组件属性
 */
interface MobileChatViewProps {
  /** 是否深色模式 */
  isDark: boolean
}

/**
 * 移动端聊天视图组件
 * @param props 组件属性
 * @returns 聊天界面组件
 */
export function MobileChatView({ isDark }: MobileChatViewProps) {
  const messagesByCharacter = useChatStore((s) => s.messagesByCharacter)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- messages 是 ?? [] 逻辑表达式，每次渲染可能产生新引用；用 useMemo 包裹会改变 useEffect 滚动触发时机，故保留原依赖数组
  const messages = messagesByCharacter[currentCharacterId] ?? []

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

  // 主题样式类
  const bgClass = isDark ? 'bg-gray-900' : 'bg-gray-50'
  const textClass = isDark ? 'text-gray-100' : 'text-gray-900'
  const bubbleUserClass = isDark
    ? 'bg-indigo-600 text-white'
    : 'bg-indigo-500 text-white'
  const bubbleBotClass = isDark
    ? 'bg-gray-800 text-gray-100'
    : 'bg-white text-gray-900'
  const inputBgClass = isDark ? 'bg-gray-800' : 'bg-white'
  const inputBorderClass = isDark ? 'border-gray-700' : 'border-gray-200'

  /**
   * 发送消息处理函数
   * 读取 AI 配置、获取 API Key、调用 LLM 客户端进行流式对话
   */
  async function handleSend() {
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    setError(null)
    // 重置输入框高度
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }

    const assistantId = sendMessage(text)
    setLoading(true)

    try {
      // 延迟导入避免循环依赖
      const { getLLMClient, DEFAULT_AI_CONFIG } = await import('../lib/llmClient')
      const { getApiKey } = await import('../lib/secureStorage')

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

      if (!config.apiKey) {
        setError('请先在设置中配置 AI API Key')
        finishStreaming(assistantId)
        setLoading(false)
        return
      }

      const client = getLLMClient(config)
      const char = getCharacter(currentCharacterId)
      if (!char) {
        setError('角色不存在')
        finishStreaming(assistantId)
        setLoading(false)
        return
      }

      const personality = getEffectivePersonality(currentCharacterId, char.personality)
      const systemPrompt = composeFullSystemPrompt(char.systemPrompt, personality)
      const history = messages.slice(-20).map((m) => ({
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
      const msg = err instanceof Error ? err.message : String(err)
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
          <Bot size={18} className="text-indigo-400" />
          <span className="text-sm font-medium">{character?.displayName ?? '宠物'}</span>
        </div>
        <button
          onClick={handleClear}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          title="清空历史"
        >
          <Trash2 size={14} />
          清空
        </button>
      </header>

      {/* 消息列表 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-3"
        style={{ overscrollBehavior: 'contain' }}
      >
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-gray-400">
            <Bot size={48} className="mb-3 opacity-40" />
            <p className="text-sm">和 {character?.displayName ?? '宠物'} 聊聊天吧～</p>
            <p className="mt-1 text-xs text-gray-500">支持流式输出和 Markdown</p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`mb-3 flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="mr-2 mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white">
                <Bot size={14} />
              </div>
            )}
            <div
              className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                msg.role === 'user' ? bubbleUserClass : bubbleBotClass
              } ${msg.isStreaming ? 'opacity-90' : ''}`}
            >
              {msg.role === 'assistant' ? (
                <Markdown>{msg.content || '...'}</Markdown>
              ) : (
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              )}
            </div>
            {msg.role === 'user' && (
              <div className="ml-2 mt-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gray-300 text-white dark:bg-gray-600">
                <User size={14} />
              </div>
            )}
          </div>
        ))}

        {error && (
          <div className="mb-3 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-600 dark:bg-red-900/30 dark:text-red-400">
            {error}
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
            placeholder="输入消息…"
            rows={1}
            className={`flex-1 resize-none rounded-2xl ${inputBgClass} ${textClass} border ${inputBorderClass} px-3 py-2 text-sm outline-none focus:border-indigo-400`}
            style={{ maxHeight: '120px' }}
          />
          {isLoading ? (
            <button
              onClick={handleStop}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-500 text-white"
              aria-label="停止"
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white disabled:opacity-40"
              aria-label="发送"
            >
              <Send size={16} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
