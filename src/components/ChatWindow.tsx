/**
 * AI聊天窗口组件
 *
 * 功能概述：
 * - 消息列表展示，支持用户/助手消息区分显示
 * - 流式输出实时渲染，支持停止生成
 * - Markdown渲染助手回复
 * - 消息内搜索功能，支持上下导航和高亮
 * - Think标签解析（内心独白半透明折叠显示）
 * - 情绪标签实时检测，触发宠物动画
 * - 四阶段记忆系统集成，上下文自动组装
 * - Agent工具调用模式（日程提醒、系统操作等）
 * - 角色一致性校验，标记不符性格回复并支持重新生成
 * - 聊天阶段管理（input/waiting/reply/error）驱动宠物动画
 * - 自动从对话提取日程提醒
 *
 * 核心Hooks/状态：
 * - useChatStore: 消息管理、流式状态、中止控制
 * - usePetStore: 当前角色信息
 * - useState: 输入框、搜索、错误、重新生成状态
 * - useRef: 消息列表滚动容器
 * - useEffect: 自动滚动、键盘快捷键、记忆预览
 *
 * 使用模块：
 * - llmClient: LLM客户端流式对话
 * - enhancedMemory: 四阶段记忆管理与触发
 * - emotionExtractor: 情绪标签提取
 * - thinkTagParser: Think标签流式解析
 * - aiAgent: Agent意图检测与工具执行
 * - personalityEngine: 性格化System Prompt合成
 * - characterConsistency: 角色一致性校验
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import Markdown from 'react-markdown'
// SECURITY R-02: 为 react-markdown 配置 rehype-sanitize，阻断 AI 输出型 XSS
import rehypeSanitize from 'rehype-sanitize'
import { Send, Square, Trash2, Bot, User, Search, X, ChevronUp, ChevronDown, Flag, AlertTriangle, RefreshCw } from 'lucide-react'
import { useChatStore } from '../stores/chatStore'
import { usePetStore } from '../stores/petStore'
import { emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCharacter } from '../lib/characters'
import { trackChatSend, trackChatReceive, trackMemoryTrigger } from '../lib/analytics'
import { getEnhancedMemoryManager } from '../lib/enhancedMemory'
import { getLLMClient } from '../lib/llmClient'
import { loadAIConfig } from '../lib/aiConfig'
// Phase 1.3 + 1.4: 情绪标签与 Think 标签解析
import { extractEmotionFromChunk, extractEmotion } from '../lib/emotionExtractor'
import { ThinkTagParser } from '../lib/thinkTagParser'
import { getChatStageManager } from '../lib/chatStages'
import { getAchievementManager } from '../lib/achievementSystem'
import { getScheduleManager } from '../lib/scheduleManager'
import { detectAgentIntent, processAgentRequest } from '../lib/aiAgent'
// P1-1：接线日记系统
import { getDiarySystemManager } from '../lib/diarySystem'
// P1-6：接线防重复机制
import { getAntiRepetitionManager } from '../lib/antiRepetition'
// P1-5：情绪标签提示词 + 好感度解析
import { EMOTION_PROMPT_FRAGMENT, extractAffectionDeltas, sumAffectionDeltas } from '../lib/emotionExtractor'
// P2-1：结构化用户画像层
import { getOwnerFactsManager } from '../lib/ownerFacts'
// P2-4：宠物共同经历记忆
import { getPetExperienceManager } from '../lib/petExperience'
// P2-2：情境感知信号
import { getContextAwarenessManager } from '../lib/contextAwareness'
// R2：约定与计划追踪
import { getCommitmentTracker } from '../lib/commitmentTracker'
import { ContextManager, getContextManager } from '../lib/contextManager'
import { composeFullSystemPrompt, getEffectivePersonality } from '../lib/personalityEngine'
import { checkConsistency, generateCorrectionPrompt } from '../lib/characterConsistency'
import { WindowControls } from './WindowControls'
import { FramelessResizeHandles } from './FramelessChrome'
import type { ChatMessage } from '../lib/types'

/**
 * 创建聊天消息对象
 * @param role 消息角色
 * @param content 消息内容
 * @returns 格式化的ChatMessage对象
 */
function mkMsg(role: 'user' | 'assistant' | 'system', content: string): ChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role,
    content,
    timestamp: Date.now(),
  }
}

/**
 * AI聊天窗口主组件
 *
 * 提供完整的AI对话界面，支持流式输出、Markdown渲染、记忆集成、
 * 情绪动画、Agent工具调用、角色一致性校验等功能。
 */
export default function ChatWindow() {
  const messagesByCharacter = useChatStore((s) => s.messagesByCharacter)
  const isLoading = useChatStore((s) => s.isLoading)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const appendAssistantChunk = useChatStore((s) => s.appendAssistantChunk)
  const finishStreaming = useChatStore((s) => s.finishStreaming)
  const updateMessageThink = useChatStore((s) => s.updateMessageThink)
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const clearHistory = useChatStore((s) => s.clearHistory)
  const setAbortController = useChatStore((s) => s.setAbortController)
  const setLoading = useChatStore((s) => s.setLoading)

  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const character = getCharacter(currentCharacterId)
  // 用 useMemo 稳定 messages 引用，避免 ?? [] 每次渲染产生新数组导致下游依赖频繁变化
  const messages = useMemo(
    () => messagesByCharacter[currentCharacterId] ?? [],
    [messagesByCharacter, currentCharacterId],
  )

  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  // 当前正在重新生成的消息 id（用于禁用按钮、显示加载态）
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const chatStageMgr = getChatStageManager()

  // 角色一致性校验相关方法
  const flagMessage = useChatStore((s) => s.flagMessage)
  const updateMessageContent = useChatStore((s) => s.updateMessageContent)
  const setMessageConsistency = useChatStore((s) => s.setMessageConsistency)

  // 高级搜索：查找所有匹配的消息
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.toLowerCase()
    return messages
      .map((m, i) => ({ message: m, index: i }))
      .filter(({ message }) =>
        message.content.toLowerCase().includes(q) ||
        (message.role === 'user' && message.content.toLowerCase().includes(q))
      )
  }, [messages, searchQuery])

  // 自动滚动到搜索结果
  useEffect(() => {
    if (searchResults.length > 0 && searchQuery) {
      const result = searchResults[searchIndex % searchResults.length]
      if (result) {
        const el = scrollRef.current?.children[result.index] as HTMLElement
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
      }
    }
  }, [searchIndex, searchResults, searchQuery])

  // 高亮搜索文本
  function highlightText(text: string, query: string): ReactNode {
    if (!query.trim()) return text
    const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
    return parts.map((part, i) =>
      part.toLowerCase() === query.toLowerCase()
        ? <mark key={i} className="bg-tangerine/20 text-tangerine-deep rounded px-0.5">{part}</mark>
        : part
    )
  }

  // 组件挂载时触发 input 阶段（宠物坐下听）
  useEffect(() => {
    chatStageMgr.setStage('input')
    return () => {
      // 组件卸载时恢复 idle
      chatStageMgr.restore()
    }
  }, [chatStageMgr])

  // Esc 键关闭聊天窗口（无障碍键盘导航）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false)
          setSearchQuery('')
        } else {
          void getCurrentWindow().hide()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [searchOpen])

  // 自动滚动到底部
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // 记忆引用预览
  const memoryPreview = useMemo(() => {
    const mgr = getEnhancedMemoryManager(currentCharacterId)
    const working = mgr.getWorkingMemories()
    if (working.length === 0) return null
    const last = working[working.length - 1]
    const preview = last.user.length > 20 ? `${last.user.slice(0, 20)}…` : last.user
    return preview
    // eslint-disable-next-line react-hooks/exhaustive-deps -- messages 作为触发源用于在消息更新时刷新记忆预览，移除会导致预览陈旧
  }, [currentCharacterId, messages])

  async function handleSend() {
    const text = input.trim()
    if (!text || isLoading) return
    setError(null)
    setInput('')

    // 埋点：发送消息（provider 在后续加载，此处用默认值）
    trackChatSend(text.length, 'default')

    const assistantId = sendMessage(text)
    if (!character) return

    // 通知 PetWindow 用户已响应（用于周期触发频率控制）
    // 阶段3：携带用户文本用于语义化响应判定
    void emit('user-chat-responded', { characterId: currentCharacterId, text })

    // ===== F5.5 Agent 模式：检测工具调用意图 =====
    // 如果用户消息包含工具调用意图（如"帮我打开计算器"、"提醒我明天9点开会"），
    // 走 Agent 流程而非普通聊天
    if (detectAgentIntent(text)) {
      const agentController = new AbortController()
      setAbortController(agentController)
      setLoading(true)
      chatStageMgr.setStage('waiting')
      try {
        const agentConfig = await loadAIConfig()
        // T-7: Agent 路径也注入记忆上下文
        let agentMemCtx = ''
        try {
          const agentMemory = getEnhancedMemoryManager(currentCharacterId)
          await agentMemory.ensureLoaded()
          agentMemCtx = await agentMemory.getContextForChat(2000, text)
        } catch {
          // 记忆获取失败不影响 Agent 流程
        }
        const result = await processAgentRequest(text, agentConfig, currentCharacterId, agentMemCtx)
        appendAssistantChunk(assistantId, result)
        chatStageMgr.setStage('reply')
        // Agent 结果也写入记忆
        const agentMemory = getEnhancedMemoryManager(currentCharacterId)
        agentMemory.addExchange(text, result)
        getAchievementManager().recordChat()
      } catch (err) {
        const msg = err instanceof Error ? err.message : '未知错误'
        setError(`Agent 执行失败：${msg}`)
        appendAssistantChunk(assistantId, `[Agent 执行失败：${msg}]`)
        chatStageMgr.setStage('error')
      } finally {
        finishStreaming(assistantId)
      }
      return
    }

    const config = await loadAIConfig()
    // F5：接线 ContextManager 做 token 预算管理（替代旧的硬编码滑窗）
    // ContextManager 支持优先级排序、token 预算控制、自动压缩
    const HISTORY_TOKEN_BUDGET = 6000
    const allHistory = (messagesByCharacter[currentCharacterId] ?? [])
      .filter((m) => m.role !== 'system')
    // F5：用 ContextManager 管理历史消息
    const ctxMgr = getContextManager({ defaultMaxTokens: HISTORY_TOKEN_BUDGET })
    // 将历史消息灌入 ContextManager
    for (const m of allHistory) {
      ctxMgr.addMessage(m.role as 'user' | 'assistant', m.content)
    }
    // 获取预算内的消息（自动按优先级排序 + 保留最近 N 轮）
    const prevMessages: ChatMessage[] = ctxMgr.getContextWindow(HISTORY_TOKEN_BUDGET)
      .map(m => mkMsg(m.role as 'user' | 'assistant', m.content))
    // 若有更早的历史被截断，插入一条衔接提示
    const droppedCount = allHistory.length - prevMessages.length
    if (droppedCount > 0) {
      const droppedMessages = allHistory.slice(0, Math.max(0, allHistory.length - prevMessages.length))
      const contentSnippets = droppedMessages
        .filter((m) => m.role === 'user')
        .slice(-3) // 最近3条用户消息
        .map((m) => m.content.slice(0, 40))
        .join('；')
      const droppedSummary = `（更早还有 ${droppedCount} 条对话因篇幅未展示${contentSnippets ? '，主要聊过：' + contentSnippets : ''}，如需回顾可询问具体内容）`
      prevMessages.unshift(mkMsg('system', droppedSummary))
    }

    // 构建 API 消息：系统提示 → few-shot → 记忆上下文 → 历史 → 当前用户消息
    // 合成带性格参数的 System Prompt
    // P1-5：注入情绪标签提示词，让主聊天模型也输出 [emotion] / [affection] 标签
    const effectivePersonality = getEffectivePersonality(currentCharacterId, character.personality)
    const fullSystemPrompt = composeFullSystemPrompt(character.systemPrompt, character.personality, effectivePersonality) + '\n' + EMOTION_PROMPT_FRAGMENT

    // P2-1：预加载结构化用户画像
    const ownerFactsMgr = getOwnerFactsManager(currentCharacterId)
    await ownerFactsMgr.ensureLoaded()
    const ownerFactsContext = ownerFactsMgr.buildContext(500)

    // P2-4：预加载宠物共同经历记忆
    const expMgr = getPetExperienceManager(currentCharacterId)
    await expMgr.ensureLoaded()
    const expContext = expMgr.buildContext(300)

    // P2-2：情境感知信号注入——让记忆检索考虑当前情境
    let contextQuery = text
    try {
      const ctxMgr = getContextAwarenessManager()
      const workState = ctxMgr.getCurrentWindowState()
      const idleMinutes = ctxMgr.getLastIdleMinutes()
      // 将情境信号拼接到检索 query 中（影响记忆检索的相关性）
      const contextSignals: string[] = []
      const hour = new Date().getHours()
      if (hour >= 0 && hour < 6) contextSignals.push('深夜')
      else if (hour >= 6 && hour < 9) contextSignals.push('早上')
      else if (hour >= 9 && hour < 12) contextSignals.push('上午')
      else if (hour >= 12 && hour < 14) contextSignals.push('中午')
      else if (hour >= 14 && hour < 18) contextSignals.push('下午')
      else if (hour >= 18 && hour < 22) contextSignals.push('晚上')
      else contextSignals.push('深夜')
      if (workState === 'coding') contextSignals.push('写代码')
      else if (workState === 'meeting') contextSignals.push('开会')
      else if (workState === 'browsing') contextSignals.push('浏览')
      if (idleMinutes >= 30) contextSignals.push('主人忙碌')
      // 将情境信号拼接到 query 以影响记忆检索
      if (contextSignals.length > 0) {
        contextQuery = `${contextSignals.join(' ')} ${text}`
      }
    } catch {
      // contextAwareness 不可用时不影响正常流程
    }

    const apiMessages: ChatMessage[] = [
      mkMsg('system', fullSystemPrompt),
      ...character.fewShotExamples.flatMap((ex) => [
        mkMsg('user', ex.user),
        mkMsg('assistant', ex.assistant),
      ]),
    ]

    // F5b：记忆注入预算统一收编进 ContextManager（联合预算，替代各自独立硬编码）
    // 四段式记忆 4000 + 画像 500 + 经历 300 + 感知 200 = 5000 联合预算：
    // 正常量下所有区块全部保留（与旧行为一致）；仅当总量超预算时按优先级/时间裁掉最旧的区块。
    // preserveSystem=false 保证 system 区块也受预算约束，preserveRecentRounds=0 不强制保留最近轮次。
    const MEMORY_TOKEN_BUDGET = 5000
    const memoryCtxMgr = new ContextManager({
      defaultMaxTokens: MEMORY_TOKEN_BUDGET,
      preserveSystem: false,
      preserveRecentRounds: 0,
    })

    // P2-1：注入结构化用户画像——每条对话的 system prompt 顶层固定注入
    if (ownerFactsContext) {
      memoryCtxMgr.addMessage('system', ownerFactsContext)
    }

    // P2-4：注入宠物共同经历记忆
    if (expContext) {
      memoryCtxMgr.addMessage('system', expContext)
    }

    // R2：注入约定与计划上下文——让 AI 知道主人有哪些待完成的计划
    try {
      const commitmentTracker = getCommitmentTracker(currentCharacterId)
      const commitmentCtx = await commitmentTracker.buildContext()
      if (commitmentCtx) {
        memoryCtxMgr.addMessage('system', commitmentCtx)
      }
    } catch {
      // commitmentTracker 不可用时不影响正常流程
    }

    // P3-6：注入视觉记忆上下文
    try {
      const { getVisualMemoryManager } = await import('../lib/visualMemoryManager')
      const vmMgr = getVisualMemoryManager(currentCharacterId)
      await vmMgr.ensureLoaded()
      const vmContext = vmMgr.buildContext(200)
      if (vmContext) {
        memoryCtxMgr.addMessage('system', vmContext)
      }
    } catch {
      // 视觉记忆不可用时不影响正常流程
    }

    const memory = getEnhancedMemoryManager(currentCharacterId)

    // 检查记忆触发
    const trigger = await memory.checkTriggers(text)
    // 四段式记忆按 token 预算组装（即时 > 短期 > 长期 > 核心）
    // P2-2：使用带情境信号的 contextQuery 进行记忆检索
    let memCtx = await memory.getContextForChat(4000, contextQuery)
    if (trigger && trigger.message) {
      trackMemoryTrigger(trigger.type, trigger.memories[0]?.id ?? '')
      memCtx = `${memCtx}\n\n【记忆触发】${trigger.message}\n${trigger.memories.map(m => m.user.slice(0, 80)).join('\n')}`
    }
    // P1-6：记忆注入指令——告诉模型不要复述原文，用自己的话自然带出
    if (memCtx) {
      memCtx += '\n\n【指令】以上历史记忆仅供参考，请不要直接复述原文，用自己的话自然提及即可。'
    }
    // P1-6：防重复指令注入
    const antiRepMgr = getAntiRepetitionManager()
    const antiRepInstruction = antiRepMgr.getAntiRepetitionInstruction()
    if (antiRepInstruction) {
      memCtx = `${memCtx}\n\n${antiRepInstruction}`
    }
    if (memCtx) {
      memoryCtxMgr.addMessage('system', memCtx)
    }

    // 取预算内的记忆上下文（getContextWindow 按时间升序返回，与注入顺序一致）
    for (const section of memoryCtxMgr.getContextWindow(MEMORY_TOKEN_BUDGET)) {
      apiMessages.push(mkMsg('system', section.content))
    }
    apiMessages.push(...prevMessages)
    apiMessages.push(mkMsg('user', text))

    const controller = new AbortController()
    setAbortController(controller)
    setLoading(true)

    // 触发 waiting 阶段（宠物吃东西等待）
    chatStageMgr.setStage('waiting')

    try {
      const client = getLLMClient(config)
      // Phase 1.3 + 1.4: 流式解析情绪标签与 Think 标签
      // 用 ThinkTagParser 实时分离 think 内容，用 extractEmotionFromChunk 提取情绪动画
      const thinkParser = new ThinkTagParser()
      let cleanBuffer = '' // 已清理情绪标签的累积文本
      const fullText = await client.chat(
        apiMessages,
        (chunk) => {
          // 情绪标签：实时检测并触发宠物动画（不送入最终文本）
          const emotions = extractEmotionFromChunk(chunk)
          if (emotions.length > 0) {
            void emit('spiritpal-emotion', { animationIds: emotions, characterId: currentCharacterId })
          }
          // 先解析 think 标签边界，分离出 think 增量
          const parsed = thinkParser.push(chunk)
          // 把 reply 增量（已去掉 think 标签）送入累积 buffer
          const replyDelta = parsed.replyContent.slice(cleanBuffer.length)
          if (replyDelta) {
            cleanBuffer = parsed.replyContent
            appendAssistantChunk(assistantId, replyDelta)
          }
          // 同步 think 内容到消息（用于半透明折叠显示）
          if (parsed.thinkContent) {
            updateMessageThink(assistantId, parsed.thinkContent)
          }
        },
        controller.signal,
      )
      // 流结束：刷新剩余 think 内容
      const finalParsed = thinkParser.flush()
      if (finalParsed.thinkContent) {
        updateMessageThink(assistantId, finalParsed.thinkContent)
      }
      // 最终清理：去除残留情绪标签和好感度标签
      const cleanFinal = extractEmotion(fullText).cleanText
      // P1-5：解析好感度变化并写回 petStore
      const affectionDeltas = extractAffectionDeltas(fullText)
      if (affectionDeltas.length > 0) {
        const totalDelta = sumAffectionDeltas(affectionDeltas)
        if (totalDelta !== 0) {
          // P2-6 修复：直接使用 Zustand setState 更新 affection 字段
          usePetStore.setState((state) => {
            const cur = state.stats[currentCharacterId]
            if (!cur) return state
            return {
              stats: {
                ...state.stats,
                [currentCharacterId]: {
                  ...cur,
                  affection: Math.max(0, Math.min(100, cur.affection + totalDelta)),
                },
              },
            }
          })
        }
      }
      // 写入四段式记忆（使用清理后的文本）
      // D6 修复：先判断是否命中"记住"指令；命中时单次写入带标记的文本，
      // 避免原实现下方再次 addExchange 造成同一轮对话重复入库
      const isRememberRequest = /记住|记着|以后|别忘了|remember this/i.test(text)
      const exchangedMem = memory.addExchange(
        isRememberRequest ? `[用户要求记住] ${text}` : text,
        cleanFinal,
      )
      // P1-6：记录回复到防重复管理器
      antiRepMgr.recordResponse(cleanFinal)
      // P1-1：记录对话到日记系统
      const diaryMgr = getDiarySystemManager(currentCharacterId)
      diaryMgr.recordExchange(text, cleanFinal)

      // P2-1：从对话中提取用户事实（规则层兜底）
      void ownerFactsMgr.extractAndSave(text).then((hasNew) => {
        if (hasNew) {
          // 如果提取到新事实，追加确认提示
          appendAssistantChunk(assistantId, '\n\n[我记住了关于你的新信息～]')
        }
      })

      // P3-3：LLM 自动提取用户事实（异步，不阻塞主流程）
      void ownerFactsMgr.autoExtractWithLLM(text, cleanFinal).then((hasNew) => {
        if (hasNew && !appendAssistantChunk.toString().includes('新信息')) {
          // 仅在规则层未提示时追加 LLM 提取确认
          appendAssistantChunk(assistantId, '\n\n[我记住了关于你的新信息～]')
        }
      }).catch(() => {})

      // P2-5：检测"记住"指令——用户明确要求记住的内容以高置信度存储
      if (isRememberRequest) {
        // D6 修复：原实现二次 addExchange 造成同一轮对话重复入库；
        // 写入时已附加 [用户要求记住] 标记，这里提升置信度后追加确认提示
        exchangedMem.importance = Math.max(exchangedMem.importance, 90)
        exchangedMem.emotionalIntensity = Math.max(exchangedMem.emotionalIntensity, 0.7)
        exchangedMem.isAutobiographical = true
        appendAssistantChunk(assistantId, '\n\n[好的，我记住了～]')
      }
      trackChatReceive(cleanFinal.length, config.provider, 0)
      // 触发 reply 阶段（宠物开心说话）
      chatStageMgr.setStage('reply')
      getAchievementManager().recordChat()

      // 尝试从对话中提取日程
      const schedMgr = getScheduleManager()
      const schedEvent = schedMgr.addFromChat(text, currentCharacterId)
      if (schedEvent) {
        const d = new Date(schedEvent.triggerTime)
        const timeStr = `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
        appendAssistantChunk(assistantId, `\n\n[已创建日程：${schedEvent.title} - ${timeStr}]`)
      }

      // R2：从对话中抽取约定并保存
      try {
        const commitmentTracker = getCommitmentTracker(currentCharacterId)
        const extracted = commitmentTracker.extractFromText(text, cleanFinal)
        for (const ext of extracted) {
          await commitmentTracker.saveCommitment(ext)
        }
        // 自动将超期 3 天未提及的约定标记为 lapsed
        await commitmentTracker.autoLapseOverdue()
      } catch {
        // 约定追踪失败不影响正常流程
      }

      // 角色一致性后处理校验（使用清理后的文本）
      const consistencyResult = checkConsistency(cleanFinal, currentCharacterId)
      if (!consistencyResult.isConsistent) {
        setMessageConsistency(assistantId, consistencyResult.violations)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误'
      setError(`发送失败：${msg}`)
      appendAssistantChunk(assistantId, `\n\n[发送失败：${msg}]`)
      // 触发 error 阶段（宠物难过）
      chatStageMgr.setStage('error')
    } finally {
      finishStreaming(assistantId)
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  // 标记消息不符性格并自动重新生成回复
  async function handleFlag(messageId: string) {
    if (!character || isLoading || regeneratingId) return

    const message = messages.find((m) => m.id === messageId)
    if (!message || message.role !== 'assistant') return

    // 校验获取违规列表
    const result = checkConsistency(message.content, currentCharacterId)
    // 标记消息
    flagMessage(messageId, result.violations)

    // 生成修正 prompt
    const correctionPrompt = generateCorrectionPrompt(currentCharacterId, result.violations)

    // 找到触发该回复的用户消息（前一条 user 消息）
    const msgIndex = messages.findIndex((m) => m.id === messageId)
    let userText = ''
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        userText = messages[i].content
        break
      }
    }
    if (!userText) return

    const config = await loadAIConfig()
    const effectivePersonality = getEffectivePersonality(currentCharacterId, character.personality)
    const fullSystemPrompt = composeFullSystemPrompt(character.systemPrompt, character.personality, effectivePersonality)

    // 构建 API 消息：系统提示 → 修正 prompt → few-shot → 记忆上下文 → 历史（到标记消息前）→ 用户消息
    const apiMessages: ChatMessage[] = [
      mkMsg('system', fullSystemPrompt),
      mkMsg('system', correctionPrompt),
      ...character.fewShotExamples.flatMap((ex) => [
        mkMsg('user', ex.user),
        mkMsg('assistant', ex.assistant),
      ]),
    ]

    // D8：重新生成路径也注入记忆上下文
    try {
      const regenMemory = getEnhancedMemoryManager(currentCharacterId)
      await regenMemory.ensureLoaded()
      const regenMemCtx = await regenMemory.getContextForChat(4000, userText)
      if (regenMemCtx) {
        apiMessages.push(mkMsg('system', regenMemCtx + '\n\n【指令】以上历史记忆仅供参考，请不要直接复述原文，用自己的话自然提及即可。'))
      }
    } catch {
      // 记忆注入失败不影响重新生成
    }

    // 添加标记消息之前的对话历史（排除 system 消息）
    for (let i = 0; i < msgIndex; i++) {
      const m = messages[i]
      if (m.role !== 'system') {
        apiMessages.push(mkMsg(m.role as 'user' | 'assistant', m.content))
      }
    }
    // 重新添加用户消息（触发重新生成）
    apiMessages.push(mkMsg('user', userText))

    // 清空原回复内容，准备流式接收新回复
    updateMessageContent(messageId, '')
    setRegeneratingId(messageId)

    const controller = new AbortController()
    setAbortController(controller)
    setLoading(true)
    chatStageMgr.setStage('waiting')

    try {
      const client = getLLMClient(config)
      const fullText = await client.chat(
        apiMessages,
        (chunk) => appendAssistantChunk(messageId, chunk),
        controller.signal,
      )
      chatStageMgr.setStage('reply')

      // 对新回复重新进行一致性校验
      const newResult = checkConsistency(fullText, currentCharacterId)
      setMessageConsistency(messageId, newResult.violations)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误'
      setError(`重新生成失败：${msg}`)
      appendAssistantChunk(messageId, `\n\n[重新生成失败：${msg}]`)
      chatStageMgr.setStage('error')
    } finally {
      finishStreaming(messageId)
      setRegeneratingId(null)
    }
  }

  return (
    <div className="flex h-full w-full flex-col bg-cream text-ink">
      {/* 无边框窗口标题栏 */}
      <div className="relative z-50 shrink-0">
        <WindowControls title={`${character?.displayName ?? '宠物'} 聊天`} />
      </div>

      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <div
            className="flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold"
            style={{
              background: `linear-gradient(135deg, ${character?.themeColor.primary ?? '#FFB6C1'}, ${character?.themeColor.secondary ?? '#FFA500'})`,
            }}
          >
            {character?.displayName.charAt(0) ?? '?'}
          </div>
          <div>
            <div className="text-sm font-semibold">{character?.displayName ?? '宠物'}</div>
            <div className="text-[11px] text-ink-faint">{character?.signaturePhrase}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setSearchOpen(!searchOpen); setSearchQuery('') }}
            className={`spiritpal-focusable rounded-md p-1.5 ${searchOpen ? 'bg-tangerine/15 text-tangerine-deep' : 'text-ink-faint hover:bg-ink/8'}`}
            aria-label="搜索对话"
            aria-expanded={searchOpen}
          >
            <Search size={16} aria-hidden="true" />
          </button>
          <button
            onClick={clearHistory}
            className="spiritpal-focusable rounded-md p-1.5 text-ink-faint hover:bg-ink/8 hover:text-red-500"
            aria-label="清空聊天记录"
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 搜索栏 */}
      {searchOpen && (
        <div className="border-b border-ink/10 bg-cream-deep/60 px-4 py-2">
          <div className="flex items-center gap-2">
            <Search size={14} className="text-ink-faint" />
            <input
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchIndex(0) }}
              placeholder="搜索对话内容…"
              className="flex-1 bg-transparent text-sm text-ink placeholder-ink-faint focus:outline-none"
              autoFocus
            />
            {searchQuery && searchResults.length > 0 && (
              <span className="text-[11px] text-ink-faint">
                {searchIndex + 1}/{searchResults.length}
              </span>
            )}
            {searchQuery && searchResults.length > 0 && (
              <>
                <button
                  onClick={() => setSearchIndex(i => Math.max(0, i - 1))}
                  className="rounded p-0.5 text-ink-faint hover:bg-ink/8"
                  title="上一个"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  onClick={() => setSearchIndex(i => Math.min(searchResults.length - 1, i + 1))}
                  className="rounded p-0.5 text-ink-faint hover:bg-ink/8"
                  title="下一个"
                >
                  <ChevronDown size={14} />
                </button>
              </>
            )}
            <button
              onClick={() => { setSearchOpen(false); setSearchQuery('') }}
              className="rounded p-0.5 text-ink-faint hover:bg-ink/8"
              title="关闭搜索"
            >
              <X size={14} />
            </button>
          </div>
          {searchQuery && searchResults.length === 0 && (
            <div className="mt-1 text-[11px] text-ink-faint">未找到匹配的消息</div>
          )}
        </div>
      )}

      {/* 记忆引用提示 */}
      {memoryPreview && (
        <div className="border-b border-ink/5 bg-blush-soft/70 px-4 py-1.5 text-[11px] text-tangerine-deep">
          📖 记得你上次说「{memoryPreview}」…
        </div>
      )}

      {/* 消息列表 */}
      <div
        ref={scrollRef}
        className="flex-1 space-y-3 overflow-y-auto px-4 py-3"
        role="log"
        aria-live="polite"
        aria-label="聊天消息列表"
      >
        {messages.length === 0 && !isLoading && (
          <div className="flex h-full items-center justify-center text-sm text-ink-faint">
            说点什么吧～ {character?.displayName ?? '我'}在等你
          </div>
        )}
        {messages.map((m) => {
          const isUser = m.role === 'user'
          const isSearchMatch = searchQuery && m.content.toLowerCase().includes(searchQuery.toLowerCase())
          const isCurrentResult = searchQuery && searchResults[searchIndex]?.message.id === m.id
          const hasViolations = !isUser && (m.consistencyViolations?.length ?? 0) > 0
          const isFlagged = !isUser && m.flagged === true
          const canFlag = !isUser && !m.isStreaming && !isFlagged && regeneratingId !== m.id && !isLoading
          const isRegenerating = regeneratingId === m.id
          return (
            <div
              key={m.id}
              className={`flex gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'} ${isCurrentResult ? 'ring-2 ring-tangerine/50 rounded-2xl' : ''}`}
            >
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                  isUser ? 'bg-tangerine text-white' : 'bg-blush-soft text-tangerine-deep'
                }`}
              >
                {isUser ? <User size={14} /> : <Bot size={14} />}
              </div>
              <div className={`flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
                {/* 一致性警告标记 */}
                {hasViolations && (
                  <div className="mb-1 flex items-center gap-1 rounded-md bg-tangerine-soft px-2 py-0.5 text-[11px] text-tangerine-deep">
                    <AlertTriangle size={11} />
                    <span>⚠️ 可能不符性格</span>
                    {m.consistencyViolations && m.consistencyViolations.length > 0 && (
                      <span className="text-tangerine-deep/70">
                        （{m.consistencyViolations.slice(0, 3).map((v) => `「${v}」`).join('')}）
                      </span>
                    )}
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                    isUser
                      ? 'bg-tangerine text-white'
                      : isFlagged
                        ? 'bg-surface text-ink ring-1 ring-red-400/40 border border-ink/10'
                        : 'bg-surface text-ink border border-ink/10'
                  } ${isSearchMatch && !isCurrentResult ? 'ring-1 ring-tangerine/30' : ''}`}
                >
                  {isUser ? (
                    searchQuery ? highlightText(m.content, searchQuery) : m.content
                  ) : (
                    <div className="prose prose-sm max-w-none break-words">
                      {/* Phase 1.4: Think 标签内容 — 半透明折叠显示（内心独白） */}
                      {m.thinkContent && m.thinkContent.trim() && (
                        <div className="mb-2 rounded-lg border border-blush/40 bg-blush-soft/70 px-2 py-1.5 text-[12px] italic text-ink-muted">
                          <span className="not-italic text-tangerine-deep/60">💭 内心独白：</span>
                          {' '}{m.thinkContent}
                        </div>
                      )}
                      {m.content ? (
                        <Markdown rehypePlugins={[rehypeSanitize]}>{m.content}</Markdown>
                      ) : (
                        <span className="text-ink-faint">{isRegenerating ? '重新生成中…' : '思考中…'}</span>
                      )}
                      {(m.isStreaming || isRegenerating) && (
                        <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-tangerine align-middle" />
                      )}
                    </div>
                  )}
                </div>
                {/* 不符性格按钮 */}
                {canFlag && (
                  <button
                    onClick={() => void handleFlag(m.id)}
                    className="mt-1 flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-ink-faint hover:bg-ink/5 hover:text-tangerine-deep"
                    title="标记此回复不符性格并重新生成"
                  >
                    {isRegenerating ? <RefreshCw size={11} className="animate-spin" /> : <Flag size={11} />}
                    不符性格
                  </button>
                )}
                {isFlagged && (
                  <span className="mt-1 flex items-center gap-1 px-2 py-0.5 text-[11px] text-red-500/70">
                    <Flag size={11} /> 已标记
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
        )}
      </div>

      {/* 输入框 */}
      <div className="border-t border-ink/10 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息与宠物聊天…"
            rows={2}
            aria-label="聊天输入框"
            className="flex-1 resize-none rounded-panel border border-ink/10 bg-surface px-3 py-2 text-sm text-ink placeholder-ink-faint focus:outline-none focus:ring-1 focus:ring-tangerine"
          />
          {isLoading ? (
            <button
              onClick={stopGeneration}
              className="spiritpal-focusable flex h-10 w-10 items-center justify-center rounded-full bg-red-500 hover:bg-red-400"
              aria-label="停止生成"
            >
              <Square size={16} aria-hidden="true" />
            </button>
          ) : (
            <button
              onClick={() => void handleSend()}
              disabled={!input.trim()}
              className="spiritpal-focusable flex h-10 w-10 items-center justify-center rounded-full bg-tangerine text-white shadow-soft hover:bg-tangerine-deep disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="发送消息"
            >
              <Send size={16} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* 无边框窗口缩放手柄 */}
      <FramelessResizeHandles />
    </div>
  )
}
