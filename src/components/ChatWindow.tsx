import { emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Send,
  Square,
  Trash2,
  Search,
  X,
  ChevronUp,
  ChevronDown,
  Flag,
  AlertTriangle,
  Mic,
  Volume2,
  PanelLeft,
  Brain,
  Plus,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ChatContextPanel } from '@/components/chat/ChatContextPanel'
import { ChatMessageCard } from '@/components/chat/ChatMessageCard'
import { ChatViewControls } from '@/components/chat/ChatViewControls'
import { MemorySidePanel } from '@/components/chat/MemorySidePanel'
import { SessionList } from '@/components/chat/SessionList'
import { FramelessResizeHandles } from '@/components/FramelessChrome'
import { WindowControls } from '@/components/WindowControls'
import { usePetTTS } from '@/hooks/usePetTTS'
import { setToolConfirmationHandler } from '@/lib/ai/agentSandbox'
import { detectAgentIntent, processAgentRequest } from '@/lib/ai/aiAgent'
import { loadAIConfig } from '@/lib/ai/aiConfig'
import { getChatStageManager } from '@/lib/ai/chatStages'
import { getContextAwarenessManager } from '@/lib/ai/contextAwareness'
import { getEmotionAnalyzer, getEmotionStateManager } from '@/lib/ai/emotionEngine'
import {
  extractEmotionFromChunk,
  extractEmotion,
  EMOTION_PROMPT_FRAGMENT,
  extractAffectionDeltas,
  sumAffectionDeltas,
  emotionTagsToMood,
} from '@/lib/ai/emotionExtractor'
import { EmotionTagFilter, extractEmotionTagKeywords } from '@/lib/ai/emotionTagFilter'
import { getLLMClient } from '@/lib/ai/llmClient'
import { truncateAssistantHistory } from '@/lib/ai/onDeviceContext'
import { composeFullSystemPrompt, getEffectivePersonality } from '@/lib/ai/personalityEngine'
import { STTEngine, isSpeechRecognitionSupported } from '@/lib/ai/stt'
import { filterLLMOutput } from '@/lib/ai/toxicityFilter'
import { voicevoxTTS } from '@/lib/ai/tts'
import { TTSPlayer } from '@/lib/ai/ttsPlayer'
import { getCharacter } from '@/lib/data/characters'
import type { ChatMessage } from '@/lib/data/types'
import { prepareChatMemory } from '@/lib/memory/chatMemoryContext'
import { cogneeAdd } from '@/lib/memory/cogneeClient'
import { ContextManager } from '@/lib/memory/contextManager'
import { deriveEmotionalIntensity } from '@/lib/memory/emotionIntensity'
import { getEnhancedMemoryManager } from '@/lib/memory/enhancedMemory'
import { getOwnerFactsManager } from '@/lib/memory/ownerFacts'
import { getVisualPerceptionManager } from '@/lib/memory/visualPerception'
import { getAchievementManager } from '@/lib/nurture/achievementSystem'
import { checkConsistency } from '@/lib/nurture/characterConsistency'
import { getCommitmentTracker } from '@/lib/nurture/commitmentTracker'
import { getDiarySystemManager } from '@/lib/nurture/diarySystem'
import { getScheduleManager } from '@/lib/nurture/scheduleManager'
import { ThinkTagParser } from '@/lib/render/thinkTagParser'
import { trackChatSend, trackChatReceive } from '@/lib/system/analytics'
import { getAntiRepetitionManager } from '@/lib/system/antiRepetition'
import { genId } from '@/lib/system/randomId'
import { getSilentModeManager } from '@/lib/system/silentModeManager'
import { swallowedCatch } from '@/lib/system/swallowedCatch'
import { useChatStore } from '@/stores/chatStore'
import { useChatViewStore } from '@/stores/chatViewStore'
import { usePetStore } from '@/stores/petStore'
import './chat/chat-workspace.css'

/** Desktop companion on-device requests share the mobile context limits. */
export const ON_DEVICE_HISTORY_TOKEN_BUDGET = 2000
export const ON_DEVICE_MEM_SECTION_BUDGET = 1500
export const ON_DEVICE_MEM_CTX_BUDGET = 1000
export const ON_DEVICE_REGEN_HISTORY_TURNS = 6

function mkMsg(role: ChatMessage['role'], content: string): ChatMessage {
  return { id: genId(), role, content, timestamp: Date.now() }
}

function cleanVoicevoxText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[[^\]]*\]|【[^】]*】/g, ' ')
    .replace(/[*#>`_~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Only desktop layout lives here; shared cards and theme tokens stay in chat-workspace.css.
const desktopLayout = `
.desktop-chat { display:flex; flex-direction:column; height:100%; width:100%; min-width:0; overflow:hidden; position:relative; }
.desktop-chat .desktop-titlebar { flex-shrink:0; position:relative; z-index:50; }
.desktop-chat .desktop-header { flex-shrink:0; display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px 18px; padding:12px 20px; }
.desktop-chat .desktop-heading { min-width:0; flex:1 1 220px; }
.desktop-chat .desktop-heading h1 { font-size:15px; font-weight:600; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.desktop-chat .desktop-subtitle { display:flex; flex-wrap:wrap; gap:4px 12px; font-size:11px; margin-top:4px; }
.desktop-chat .desktop-toolbar { display:flex; flex-wrap:wrap; align-items:center; gap:4px; }
.desktop-chat .desktop-body { display:flex; flex:1; min-width:0; min-height:0; position:relative; }
.desktop-chat .desktop-main { display:flex; flex:1; min-width:0; min-height:0; flex-direction:column; }
.desktop-chat .desktop-sessions, .desktop-chat .desktop-context { display:none; flex-direction:column; flex-shrink:0; min-height:0; overflow-y:auto; }
.desktop-chat .desktop-sessions { width:232px; }
.desktop-chat .desktop-sessions > div { width:100%; }
.desktop-chat .desktop-context { width:280px; }
.desktop-chat .desktop-sessions.is-open, .desktop-chat .desktop-context.is-open { display:flex; position:absolute; top:0; bottom:0; z-index:30; box-shadow:0 12px 36px #0003; }
.desktop-chat .desktop-sessions.is-open { left:0; }
.desktop-chat .desktop-context.is-open { right:0; max-width:90%; }
.desktop-chat .desktop-scrim { position:absolute; inset:0; z-index:20; background:#0003; border:0; }
.desktop-chat .desktop-context-close { display:flex; justify-content:flex-end; padding:6px 10px 0; }
.desktop-chat .desktop-scroll-region { display:flex; flex:1; min-height:0; position:relative; }
.desktop-chat .desktop-scroll { flex:1; min-height:0; overflow-y:auto; overscroll-behavior:contain; }
.desktop-chat .desktop-transcript { width:100%; max-width:860px; margin:0 auto; padding:20px 24px; }
.desktop-chat .desktop-composer { flex-shrink:0; padding:12px 24px 14px; }
.desktop-chat .desktop-composer-inner { max-width:812px; margin:0 auto; }
.desktop-chat .desktop-input-row { display:flex; align-items:flex-end; gap:8px; }
.desktop-chat .desktop-input { width:100%; flex:1; min-width:0; min-height:44px; max-height:200px; resize:none; line-height:1.6; }
.desktop-chat .desktop-composer-note { display:flex; flex-wrap:wrap; justify-content:space-between; gap:4px 16px; font-size:11px; margin-top:7px; }
.desktop-chat .desktop-search { display:flex; align-items:center; gap:8px; padding:8px 20px; flex-shrink:0; }
.desktop-chat .desktop-search input { flex:1; min-width:0; background:transparent; font-size:12px; outline:none; }
.desktop-chat .desktop-bottom { position:absolute; bottom:12px; left:50%; transform:translateX(-50%); }
.desktop-chat .desktop-suggestions { display:flex; flex-wrap:wrap; justify-content:center; gap:8px; margin-top:18px; }
.desktop-chat .desktop-match { outline:1px solid currentColor; outline-offset:3px; border-radius:12px; }
.desktop-chat .desktop-drawer { position:absolute; top:0; right:0; bottom:0; z-index:40; max-width:95%; box-shadow:0 12px 36px #0003; }
.desktop-chat .desktop-drawer-scrim { z-index:35; }
.desktop-chat.chat-workspace--compact .desktop-transcript { padding-top:12px; padding-bottom:12px; }
@media (min-width:1100px) {
  .desktop-chat .desktop-sessions:not(.is-closed), .desktop-chat .desktop-context:not(.is-closed) { display:flex; position:static; box-shadow:none; }
  .desktop-chat .desktop-side-scrim { display:none; }
}
@media (max-width:599px) {
  .desktop-chat .desktop-header { padding:10px 12px; }
  .desktop-chat .desktop-transcript { padding:12px; }
  .desktop-chat .desktop-composer { padding:10px 12px; }
}
`

export default function ChatWindow() {
  const { t } = useTranslation()
  const messagesBySession = useChatStore((s) => s.messagesBySession)
  const sessions = useChatStore((s) => s.sessions)
  const activeSessionByCharacter = useChatStore((s) => s.activeSessionByCharacter)
  const isLoading = useChatStore((s) => s.isLoading)
  const sendMessage = useChatStore((s) => s.sendMessage)
  const startGeneration = useChatStore((s) => s.startGeneration)
  const appendAssistantChunk = useChatStore((s) => s.appendAssistantChunk)
  const finishStreaming = useChatStore((s) => s.finishStreaming)
  const updateMessageThink = useChatStore((s) => s.updateMessageThink)
  const stopGeneration = useChatStore((s) => s.stopGeneration)
  const clearHistory = useChatStore((s) => s.clearHistory)
  const setAbortController = useChatStore((s) => s.setAbortController)
  const setMessageMetrics = useChatStore((s) => s.setMessageMetrics)
  const setMessageMemoryTrace = useChatStore((s) => s.setMessageMemoryTrace)
  const setMessageStatus = useChatStore((s) => s.setMessageStatus)
  const createSession = useChatStore((s) => s.createSession)
  const forkSessionAtMessage = useChatStore((s) => s.forkSessionAtMessage)
  const flagMessage = useChatStore((s) => s.flagMessage)
  const updateMessageContent = useChatStore((s) => s.updateMessageContent)
  const setMessageConsistency = useChatStore((s) => s.setMessageConsistency)
  const compact = useChatViewStore((s) => s.compact)
  const showMetrics = useChatViewStore((s) => s.showMetrics)
  const showMemory = useChatViewStore((s) => s.showMemory)
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)
  const character = getCharacter(currentCharacterId)
  const activeSessionId = activeSessionByCharacter[currentCharacterId] ?? ''
  const session = sessions[currentCharacterId]?.find((s) => s.id === activeSessionId)
  const messages = useMemo(() => messagesBySession[activeSessionId] ?? [], [messagesBySession, activeSessionId])

  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [modelLabel, setModelLabel] = useState('模型配置加载中')
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchIndex, setSearchIndex] = useState(0)
  // null: follow the CSS breakpoint (visible on desktop, closed on narrow windows).
  const [sessionListOpen, setSessionListOpen] = useState<boolean | null>(null)
  const [contextOpen, setContextOpen] = useState<boolean | null>(null)
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false)
  const [memoryEnabled, setMemoryEnabled] = useState(true)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
  const [awayFromBottom, setAwayFromBottom] = useState(false)
  const nearBottom = useRef(true)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const composing = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [sttActive, setSttActive] = useState(false)
  const sttEngineRef = useRef<STTEngine | null>(null)
  const [ttsAvailable, setTtsAvailable] = useState<boolean | null>(null)
  const [speakingId, setSpeakingId] = useState<string | null>(null)
  const voicevoxPlayerRef = useRef<TTSPlayer | null>(null)
  const chatStageMgr = getChatStageManager()
  const { speak } = usePetTTS()
  const prevStreamingIds = useRef<ReadonlySet<string>>(new Set())
  const spokenIds = useRef<Set<string>>(new Set())
  const latestAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  const contextMessage = messages.find((m) => m.id === selectedMessageId && m.role === 'assistant') ?? latestAssistant
  const knownTokens = useMemo(() => {
    const inputCounts = messages.flatMap((m) => (m.metrics?.promptTokens === undefined ? [] : [m.metrics.promptTokens]))
    const outputCounts = messages.flatMap((m) =>
      m.metrics?.completionTokens === undefined ? [] : [m.metrics.completionTokens],
    )
    return {
      input: inputCounts.length ? inputCounts.reduce((a, b) => a + b, 0).toLocaleString() : '—',
      output: outputCounts.length ? outputCounts.reduce((a, b) => a + b, 0).toLocaleString() : '—',
    }
  }, [messages])
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return q ? messages.filter((m) => m.content.toLowerCase().includes(q)) : []
  }, [messages, searchQuery])

  function getVoicevoxPlayer(): TTSPlayer {
    if (!voicevoxPlayerRef.current) voicevoxPlayerRef.current = new TTSPlayer()
    return voicevoxPlayerRef.current
  }

  useEffect(() => {
    let cancelled = false
    void loadAIConfig()
      .then((config) => {
        if (!cancelled) setModelLabel(`${config.model || '默认模型'} · ${config.provider}`)
      })
      .catch(() => {
        if (!cancelled) setModelLabel('模型未配置')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const stillStreaming = new Set(messages.filter((m) => m.isStreaming).map((m) => m.id))
    for (const m of messages) {
      if (!m.isStreaming && prevStreamingIds.current.has(m.id) && !spokenIds.current.has(m.id)) {
        spokenIds.current.add(m.id)
        if (m.role === 'assistant' && m.content && !m.sendStatus && !getSilentModeManager().isSilent()) speak(m.content)
      }
    }
    prevStreamingIds.current = stillStreaming
  }, [messages, speak])

  useEffect(() => {
    chatStageMgr.setStage('input')
    setToolConfirmationHandler((toolName, params) => {
      const approved = window.confirm(
        `SpiritPal 请求执行以下操作：\n\n工具：${toolName}\n参数：${JSON.stringify(params, null, 2)}\n\n是否允许执行？`,
      )
      return { approved, reason: approved ? '用户已确认' : '用户拒绝' }
    })
    return () => {
      chatStageMgr.restore()
      setToolConfirmationHandler(null)
      sttEngineRef.current?.abort()
      sttEngineRef.current = null
    }
  }, [chatStageMgr])

  useEffect(() => {
    let cancelled = false
    void voicevoxTTS
      .isEngineAvailable()
      .then((available) => {
        if (!cancelled) setTtsAvailable(available)
      })
      .catch(() => {
        if (!cancelled) setTtsAvailable(false)
      })
    return () => {
      cancelled = true
      voicevoxPlayerRef.current?.stop()
    }
  }, [])

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (memoryPanelOpen) setMemoryPanelOpen(false)
      else if (searchOpen) {
        setSearchOpen(false)
        setSearchQuery('')
      } else if (sessionListOpen === true || contextOpen === true) {
        setSessionListOpen(false)
        setContextOpen(false)
      } else void getCurrentWindow().hide()
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [searchOpen, memoryPanelOpen, sessionListOpen, contextOpen])

  useEffect(() => {
    const el = scrollRef.current
    if (el && nearBottom.current && !searchQuery) el.scrollTop = el.scrollHeight
  }, [messages, activeSessionId, searchQuery])

  useEffect(() => {
    const result = searchResults[searchIndex % searchResults.length]
    if (!result) return
    // IDs are opaque. Compare dataset values rather than interpolating CSS selectors or child indices.
    const target = Array.from(scrollRef.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? []).find(
      (el) => el.dataset.messageId === result.id,
    )
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [searchIndex, searchResults])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(200, Math.max(44, el.scrollHeight))}px`
  }, [input])

  async function handleSend(overrideText?: string) {
    // Fork actions switch synchronously: never use render-closure history here.
    const state = useChatStore.getState()
    const text = (overrideText ?? input).trim()
    if (!text || state.isLoading) return
    const sessionId = state.activeSessionByCharacter[currentCharacterId]
    const temporary = Boolean(state.sessions[currentCharacterId]?.find((s) => s.id === sessionId)?.temporary)
    const enabled = memoryEnabled
    const canUseMemory = enabled && !temporary
    const history = (state.messagesBySession[sessionId ?? ''] ?? []).filter((m) => m.role !== 'system')
    setError(null)
    setInput('')
    trackChatSend(text.length, 'default')
    const assistantId = sendMessage(text)
    startGeneration(assistantId)
    const controller = new AbortController()
    setAbortController(controller, assistantId)
    setMessageStatus(assistantId, 'pending')
    chatStageMgr.setStage('waiting')
    let client: ReturnType<typeof getLLMClient> | undefined

    // Recording failures must not turn a completed reply into a failed message.
    const record = async (task: () => unknown) => {
      if (!canUseMemory || controller.signal.aborted) return
      try {
        await task()
      } catch (err) {
        swallowedCatch('ChatWindow.recordMemory')(err)
      }
    }
    try {
      if (!character) throw new Error('Character unavailable')
      const config = await loadAIConfig()
      controller.signal.throwIfAborted()
      setModelLabel(`${config.model || '默认模型'} · ${config.provider}`)
      const isOnDevice = config.provider === 'ondevice'
      let query = text
      if (canUseMemory) {
        try {
          const awareness = getContextAwarenessManager()
          query = `${awareness.getCurrentWindowState()} ${awareness.getLastIdleMinutes() >= 30 ? '主人忙碌 ' : ''}${text}`
        } catch {
          /* Context-awareness is optional, not a requirement for text chat. */
        }
      }
      const prepared = await prepareChatMemory({
        characterId: currentCharacterId,
        query,
        enabled,
        temporary,
        contextBudget: isOnDevice ? ON_DEVICE_MEM_CTX_BUDGET : 4000,
        totalBudget: isOnDevice ? ON_DEVICE_MEM_SECTION_BUDGET : 5000,
      })
      controller.signal.throwIfAborted()

      const parseFinal = (raw: string) => {
        const parser = new ThinkTagParser()
        parser.push(raw)
        const parsed = parser.flush()
        updateMessageThink(assistantId, parsed.thinkContent)
        const extraction = extractEmotion(parsed.replyContent)
        const clean = filterLLMOutput(extraction.cleanText).filteredText
        updateMessageContent(assistantId, clean)
        return { clean, extraction, reply: parsed.replyContent }
      }
      let finalReply: ReturnType<typeof parseFinal>
      let toolPath = false
      if (canUseMemory && detectAgentIntent(text)) {
        toolPath = true
        // This trace describes the memory payload passed to Agent, NOT its hidden tool reasoning.
        setMessageMemoryTrace(assistantId, prepared.trace)
        controller.signal.throwIfAborted()
        const result = await processAgentRequest(
          text,
          config,
          currentCharacterId,
          prepared.messages.map((m) => m.content).join('\n\n'),
        )
        controller.signal.throwIfAborted()
        finalReply = parseFinal(result)
      } else {
        const historyBudget = isOnDevice ? ON_DEVICE_HISTORY_TOKEN_BUDGET : 6000
        const context = new ContextManager({ defaultMaxTokens: historyBudget })
        for (const m of history) context.addMessage(m.role, m.content)
        const prevMessages = truncateAssistantHistory(context.getContextWindow(historyBudget), isOnDevice)
        const dropped = history.length - prevMessages.length
        if (dropped > 0) {
          const snippets = history
            .slice(0, dropped)
            .filter((m) => m.role === 'user')
            .slice(-3)
            .map((m) => m.content.slice(0, 40))
            .join('；')
          prevMessages.unshift(
            mkMsg('system', `（更早还有 ${dropped} 条对话因篇幅未展示${snippets ? '，主要聊过：' + snippets : ''}）`),
          )
        }
        const effective = getEffectivePersonality(currentCharacterId, character.personality)
        const apiMessages: ChatMessage[] = [
          mkMsg(
            'system',
            composeFullSystemPrompt(character.systemPrompt, character.personality, effective) +
              '\n' +
              EMOTION_PROMPT_FRAGMENT,
          ),
          ...character.fewShotExamples.flatMap((ex) => [mkMsg('user', ex.user), mkMsg('assistant', ex.assistant)]),
          ...prepared.messages,
          ...prevMessages,
          mkMsg('user', text),
        ]
        const lookKeywords = /^(看看|你看看|看一下|瞅瞅|瞄一眼|看一眼|帮我看看)/
        if (canUseMemory && lookKeywords.test(text)) {
          toolPath = true
          const analysis = await getVisualPerceptionManager().triggerAnalysis()
          controller.signal.throwIfAborted()
          if (analysis) {
            const screenContext = `【视觉感知】宠物刚刚看了一眼屏幕，观察到：${analysis.userActivity}（工作状态：${analysis.inferredWorkState}，置信度：${((analysis.confidence ?? 0) * 100).toFixed(0)}%）${analysis.sceneDetails ? ' 场景详情：' + analysis.sceneDetails : ''}`
            apiMessages.splice(1, 0, mkMsg('system', screenContext))
            prepared.trace = {
              ...prepared.trace,
              sections: [
                ...prepared.trace.sections,
                {
                  id: 'screen-analysis',
                  label: '本轮屏幕观察',
                  content: screenContext,
                  estimatedTokens: Math.ceil(screenContext.length / 2),
                },
              ],
            }
            await record(async () => {
              const { getVisualMemoryManager } = await import('@/lib/memory/visualMemoryManager')
              controller.signal.throwIfAborted()
              getVisualMemoryManager(currentCharacterId).record('scene', analysis.userActivity, 'neutral')
            })
            controller.signal.throwIfAborted()
          } else {
            apiMessages.splice(1, 0, mkMsg('system', '本轮未能获取屏幕信息。请说明无法看清，不要猜测屏幕内容。'))
          }
        }
        client = getLLMClient(config)
        const parser = new ThinkTagParser()
        const emotionFilter = new EmotionTagFilter()
        let replyLength = 0
        setMessageMemoryTrace(assistantId, prepared.trace)
        controller.signal.throwIfAborted()
        const raw = await client.chat(
          apiMessages,
          (chunk) => {
            if (controller.signal.aborted) return
            const emotions = extractEmotionFromChunk(chunk)
            if (emotions.length > 0)
              void emit('spiritpal-emotion', { animationIds: emotions, characterId: currentCharacterId })
            const parsed = parser.push(chunk)
            const delta = parsed.replyContent.slice(replyLength)
            replyLength = parsed.replyContent.length
            if (delta) {
              const visible = emotionFilter.push(delta)
              if (visible) appendAssistantChunk(assistantId, visible)
            }
            if (parsed.thinkContent) updateMessageThink(assistantId, parsed.thinkContent)
          },
          controller.signal,
          (progress) => setMessageMetrics(assistantId, progress),
        )
        controller.signal.throwIfAborted()
        const tail = emotionFilter.flush()
        if (tail) appendAssistantChunk(assistantId, tail)
        finalReply = parseFinal(raw)
      }

      const { clean, extraction, reply } = finalReply
      setMessageStatus(assistantId, undefined)
      setMessageConsistency(assistantId, checkConsistency(clean, currentCharacterId).violations)
      trackChatReceive(clean.length, config.provider, client?.lastCallMetrics?.durationMs ?? 0)
      chatStageMgr.setStage('reply')
      getAchievementManager().recordChat()

      if (canUseMemory) {
        await Promise.all([
          record(() => cogneeAdd(currentCharacterId, text)),
          // The receiving window may derive memories from this event's text; never emit it in read-only chat.
          record(() => emit('user-chat-responded', { characterId: currentCharacterId, text })),
          record(() => {
            const memory = getEnhancedMemoryManager(currentCharacterId)
            const remember = /记住|记着|以后|别忘了|remember this/i.test(text)
            const exchange = memory.addExchange(remember ? `[用户要求记住] ${text}` : text, clean)
            const analyzer = getEmotionAnalyzer()
            const intensity = deriveEmotionalIntensity(
              exchange.emotionalIntensity,
              [...extraction.animations, ...extractEmotionTagKeywords(reply)],
              analyzer.analyze(clean),
              analyzer.analyze(text),
            )
            memory.updateMemoryIntensity(exchange.id, remember ? Math.max(intensity, 0.7) : intensity)
            const mood = emotionTagsToMood(extraction.animations)
            if (mood) memory.updateMemoryMood(exchange.id, mood.valence, mood.arousal)
            if (remember) {
              exchange.importance = Math.max(exchange.importance, 90)
              exchange.emotionalIntensity = Math.max(exchange.emotionalIntensity, 0.7)
              exchange.isAutobiographical = true
            }
          }),
        ])
        if (!toolPath) {
          await Promise.all([
            record(() => {
              const delta = sumAffectionDeltas(extractAffectionDeltas(reply))
              if (delta)
                usePetStore.setState((state) => {
                  const current = state.stats[currentCharacterId]
                  return current
                    ? {
                        stats: {
                          ...state.stats,
                          [currentCharacterId]: {
                            ...current,
                            affection: Math.max(0, Math.min(100, current.affection + delta)),
                          },
                        },
                      }
                    : state
                })
            }),
            record(() => getEmotionStateManager().update(getEmotionAnalyzer().analyze(clean))),
            record(() => getAntiRepetitionManager().recordResponse(clean)),
            record(() => getDiarySystemManager(currentCharacterId).recordExchange(text, clean)),
            record(() => getOwnerFactsManager(currentCharacterId).extractAndSave(text)),
            record(() => getOwnerFactsManager(currentCharacterId).autoExtractWithLLM(text, clean)),
            record(() => getScheduleManager().addFromChat(text, currentCharacterId)),
            record(async () => {
              const tracker = getCommitmentTracker(currentCharacterId)
              for (const item of tracker.extractFromText(text, clean)) {
                controller.signal.throwIfAborted()
                await tracker.saveCommitment(item)
                controller.signal.throwIfAborted()
              }
              await tracker.autoLapseOverdue()
            }),
          ])
        }
      }
    } catch (err) {
      const aborted = controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')
      setMessageStatus(assistantId, aborted ? 'aborted' : 'failed')
      if (!aborted) {
        setError('发送失败，请检查模型配置或网络后重试。')
        chatStageMgr.setStage('error')
      }
    } finally {
      if (client?.lastCallMetrics) setMessageMetrics(assistantId, client.lastCallMetrics)
      // Store finishes only this ID; an older request must not clear a newer generation's loading state.
      finishStreaming(assistantId)
    }
  }

  function handleEdit(message: ChatMessage) {
    if (useChatStore.getState().isLoading || message.role !== 'user') return
    if (!forkSessionAtMessage(message.id)) return
    setInput(message.content)
    setError(null)
    inputRef.current?.focus()
  }

  async function handleRegenerate(message: ChatMessage) {
    const state = useChatStore.getState()
    if (state.isLoading || message.role !== 'assistant') return
    const current = state.messagesBySession[state.activeSessionByCharacter[currentCharacterId] ?? ''] ?? []
    const index = current.findIndex((m) => m.id === message.id)
    const user = current
      .slice(0, index)
      .reverse()
      .find((m) => m.role === 'user')
    if (index < 0 || !user || !forkSessionAtMessage(user.id)) return
    await handleSend(user.content)
  }

  async function handleFlag(message: ChatMessage) {
    if (useChatStore.getState().isLoading) return
    flagMessage(message.id, checkConsistency(message.content, currentCharacterId).violations)
    await handleRegenerate(message)
  }

  function handleMicToggle() {
    if (sttActive) {
      sttEngineRef.current?.stop()
      setSttActive(false)
      return
    }
    if (!isSpeechRecognitionSupported()) {
      setError('当前环境不支持语音识别（需 Chrome/Edge 内核 WebView）')
      return
    }
    setError(null)
    try {
      const engine = new STTEngine()
      sttEngineRef.current = engine
      engine.start(
        {
          onPartial: setInput,
          onFinal: setInput,
          onError: (msg) => {
            setError(`语音识别失败：${msg}`)
            setSttActive(false)
          },
          onEnd: () => setSttActive(false),
        },
        { lang: 'zh-CN', continuous: true, interimResults: true },
      )
      setSttActive(true)
    } catch {
      setError('语音识别启动失败')
      sttEngineRef.current = null
    }
  }

  async function handleSpeak(message: ChatMessage) {
    if (speakingId === message.id) {
      getVoicevoxPlayer().stop()
      setSpeakingId(null)
      return
    }
    const text = cleanVoicevoxText(message.content)
    if (!text) return
    setSpeakingId(message.id)
    try {
      const blob = await voicevoxTTS.synthesize(text.slice(0, 500))
      await getVoicevoxPlayer().play(blob)
    } catch {
      setTtsAvailable(false)
      setError('语音朗读失败，请检查 VOICEVOX 引擎是否启动。')
    } finally {
      setSpeakingId((current) => (current === message.id ? null : current))
    }
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !composing.current && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault()
      void handleSend()
    }
  }

  function toggleSidebar(open: boolean | null) {
    return !(open ?? window.matchMedia('(min-width: 1100px)').matches)
  }

  return (
    <div className={`chat-workspace desktop-chat${compact ? ' chat-workspace--compact' : ''}`}>
      <style>{desktopLayout}</style>
      <div className="desktop-titlebar">
        <WindowControls title={`${character?.displayName ?? '宠物'} 聊天`} />
      </div>
      <header className="chat-header desktop-header">
        <div className="desktop-heading">
          <h1>{session?.title ?? '新对话'}</h1>
          <div className="chat-note desktop-subtitle">
            <span>{character?.displayName ?? '宠物'}</span>
            <span>{modelLabel}</span>
            {showMetrics && (
              <span
                aria-label={t('chatUi.scope.knownTokens', { input: knownTokens.input, output: knownTokens.output })}
              >
                {t('chatUi.scope.knownTokens', { input: knownTokens.input, output: knownTokens.output })}
              </span>
            )}
          </div>
        </div>
        <div className="desktop-toolbar">
          <button
            className="chat-button"
            onClick={() => setSessionListOpen(toggleSidebar)}
            aria-label="对话历史"
            title="对话历史"
          >
            <PanelLeft size={16} />
          </button>
          <button
            className="chat-button"
            onClick={() => {
              createSession()
              setInput('')
              setError(null)
            }}
            aria-label="新建对话"
            title="新建对话"
          >
            <Plus size={16} />
          </button>
          <button
            className="chat-button"
            aria-pressed={Boolean(session?.temporary)}
            onClick={() => {
              createSession(session?.temporary ? undefined : { temporary: true })
              setInput('')
              setError(null)
            }}
          >
            {session?.temporary ? t('chatUi.scope.exitTemp') : t('chatUi.scope.temp')}
          </button>
          <button
            className="chat-button"
            role="switch"
            aria-label="记忆读写"
            aria-checked={memoryEnabled && !session?.temporary}
            disabled={Boolean(session?.temporary)}
            onClick={() => setMemoryEnabled((value) => !value)}
            title="下一轮是否读取并写入长期记忆"
          >
            <Brain size={15} />
            {memoryEnabled && !session?.temporary ? t('chatUi.scope.memoryOn') : t('chatUi.scope.memoryOff')}
          </button>
          <ChatViewControls />
          <button
            className="chat-button"
            onClick={() => {
              setSearchOpen(!searchOpen)
              setSearchQuery('')
            }}
            aria-label="搜索对话"
            aria-expanded={searchOpen}
          >
            <Search size={16} />
          </button>
          <button
            className="chat-button"
            onClick={() => {
              useChatViewStore.getState().setOption('showMemory', true)
              setContextOpen(toggleSidebar)
            }}
            aria-label={t('chatUi.scope.context')}
            title={t('chatUi.scope.context')}
          >
            <Brain size={16} />
          </button>
          <button
            className="chat-button"
            onClick={() => setMemoryPanelOpen(true)}
            aria-label={t('chatUi.scope.manageMemory')}
            title={t('chatUi.scope.manageMemory')}
          >
            {t('chatUi.scope.manageMemory')}
          </button>
          <button
            className="chat-button"
            onClick={() => {
              if (window.confirm(t('chatUi.scope.clearConfirm'))) {
                if (isLoading) stopGeneration()
                clearHistory()
              }
            }}
            aria-label="清空聊天记录"
            title="清空聊天记录"
          >
            <Trash2 size={15} />
          </button>
        </div>
      </header>
      <div className="desktop-body">
        <aside
          className={`chat-side-panel desktop-sessions${sessionListOpen === true ? ' is-open' : sessionListOpen === false ? ' is-closed' : ''}`}
          aria-label="会话列表"
        >
          <SessionList onClose={() => setSessionListOpen(false)} />
        </aside>
        <main className="desktop-main">
          {searchOpen && (
            <div className="chat-header desktop-search">
              <Search size={14} aria-hidden="true" />
              <input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setSearchIndex(0)
                }}
                placeholder="搜索对话内容…"
                aria-label="搜索对话内容"
                autoFocus
              />
              {searchQuery && (
                <span className="chat-note">
                  {searchResults.length ? `${searchIndex + 1}/${searchResults.length}` : '未找到匹配的消息'}
                </span>
              )}
              {searchResults.length > 0 && (
                <>
                  <button
                    className="chat-button"
                    title="上一个"
                    onClick={() => setSearchIndex((i) => (i - 1 + searchResults.length) % searchResults.length)}
                  >
                    <ChevronUp size={14} />
                  </button>
                  <button
                    className="chat-button"
                    title="下一个"
                    onClick={() => setSearchIndex((i) => (i + 1) % searchResults.length)}
                  >
                    <ChevronDown size={14} />
                  </button>
                </>
              )}
              <button
                className="chat-button"
                title="关闭搜索"
                onClick={() => {
                  setSearchOpen(false)
                  setSearchQuery('')
                }}
              >
                <X size={14} />
              </button>
            </div>
          )}
          <div className="desktop-scroll-region">
            <div
              ref={scrollRef}
              className="chat-scroll desktop-scroll"
              role="log"
              aria-live="polite"
              aria-label="聊天消息列表"
              onScroll={() => {
                const el = scrollRef.current
                if (!el) return
                nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96
                setAwayFromBottom(!nearBottom.current)
              }}
            >
              <div className="chat-transcript desktop-transcript">
                {messages.length === 0 && !isLoading && (
                  <div className="chat-empty">
                    <h2>{t('chatUi.scope.emptyTitle', { name: character?.displayName ?? 'SpiritPal' })}</h2>
                    <p className="chat-note">{character?.signaturePhrase ?? t('chatUi.scope.emptySubtitle')}</p>
                    <div className="desktop-suggestions">
                      {[
                        t('chatUi.scope.suggestion1'),
                        t('chatUi.scope.suggestion2'),
                        t('chatUi.scope.suggestion3'),
                      ].map((text) => (
                        <button
                          key={text}
                          className="chat-button"
                          onClick={() => {
                            setInput(text)
                            inputRef.current?.focus()
                          }}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {messages.map((message) => (
                  <div
                    key={message.id}
                    data-message-id={message.id}
                    className={searchResults[searchIndex]?.id === message.id ? 'desktop-match' : undefined}
                  >
                    <ChatMessageCard
                      message={message}
                      onEdit={isLoading ? undefined : handleEdit}
                      onRegenerate={isLoading ? undefined : (m) => void handleRegenerate(m)}
                      actions={
                        message.role === 'assistant' ? (
                          <>
                            {Boolean(message.consistencyViolations?.length) && (
                              <span className="chat-note" title={message.consistencyViolations?.join('、')}>
                                <AlertTriangle size={12} />
                                可能不符性格
                              </span>
                            )}
                            {!message.isStreaming && !message.flagged && (
                              <button
                                className="chat-button"
                                disabled={isLoading}
                                onClick={() => void handleFlag(message)}
                                title="标记此回复不符性格并在新会话重新生成"
                              >
                                <Flag size={12} />
                                不符性格
                              </button>
                            )}
                            {message.flagged && (
                              <span className="chat-note">
                                <Flag size={12} />
                                已标记
                              </span>
                            )}
                            {!message.isStreaming && message.content && (
                              <button
                                className="chat-button"
                                onClick={() => void handleSpeak(message)}
                                disabled={ttsAvailable !== true}
                                aria-label={speakingId === message.id ? '停止朗读' : '朗读此回复'}
                                title={
                                  ttsAvailable === false
                                    ? 'VOICEVOX 引擎未启动（默认 http://127.0.0.1:50021）'
                                    : '用 VOICEVOX 朗读此回复'
                                }
                              >
                                {speakingId === message.id ? <Square size={12} /> : <Volume2 size={12} />}
                                {speakingId === message.id ? '停止朗读' : '朗读'}
                              </button>
                            )}
                            <button
                              className="chat-button"
                              onClick={() => {
                                setSelectedMessageId(message.id)
                                setContextOpen(true)
                                useChatViewStore.getState().setOption('showMemory', true)
                              }}
                            >
                              {t('chatUi.scope.context')}
                            </button>
                          </>
                        ) : undefined
                      }
                    />
                  </div>
                ))}
                {error && (
                  <p role="alert" className="chat-error">
                    {error}
                  </p>
                )}
              </div>
            </div>
            {awayFromBottom && (
              <button
                className="chat-button desktop-bottom"
                onClick={() => {
                  const el = scrollRef.current
                  if (el) el.scrollTop = el.scrollHeight
                  nearBottom.current = true
                  setAwayFromBottom(false)
                }}
              >
                <ChevronDown size={14} />
                {t('chatUi.scope.backToLatest')}
              </button>
            )}
          </div>
          <footer className="chat-composer desktop-composer">
            <div className="desktop-composer-inner">
              <div className="desktop-input-row">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={() => {
                    composing.current = true
                  }}
                  onCompositionEnd={() => {
                    composing.current = false
                  }}
                  placeholder="输入消息与宠物聊天…"
                  rows={1}
                  aria-label="聊天输入框"
                  className="desktop-input"
                />
                <button
                  className="chat-button"
                  onClick={handleMicToggle}
                  aria-label={sttActive ? '停止语音输入' : '语音输入'}
                  aria-pressed={sttActive}
                >
                  <Mic size={18} />
                </button>
                {isLoading ? (
                  <button className="chat-button" onClick={stopGeneration} aria-label="停止生成">
                    <Square size={18} />
                  </button>
                ) : (
                  <button
                    className="chat-button"
                    onClick={() => void handleSend()}
                    disabled={!input.trim()}
                    aria-label="发送消息"
                  >
                    <Send size={18} />
                  </button>
                )}
              </div>
              <div className="chat-note desktop-composer-note">
                <span>
                  {session?.temporary
                    ? t('chatUi.scope.memoryStatusTemp')
                    : !memoryEnabled
                      ? t('chatUi.scope.memoryStatusOff')
                      : t('chatUi.scope.memoryStatusOn')}
                </span>
                <span>Enter 发送 · Shift+Enter 换行</span>
              </div>
            </div>
          </footer>
        </main>
        {showMemory && (
          <aside
            className={`chat-side-panel desktop-context${contextOpen === true ? ' is-open' : contextOpen === false ? ' is-closed' : ''}`}
            aria-label="本轮上下文面板"
          >
            <div className="desktop-context-close">
              <button className="chat-button" aria-label={t('app.close')} onClick={() => setContextOpen(false)}>
                <X size={14} />
              </button>
            </div>
            <ChatContextPanel message={contextMessage} onManage={() => setMemoryPanelOpen(true)} />
            <p className="chat-note px-4 text-xs">{t('chatUi.context.sentInfo')}</p>
          </aside>
        )}
        {(sessionListOpen === true || (showMemory && contextOpen === true)) && (
          <button
            className="desktop-scrim desktop-side-scrim"
            aria-label="关闭侧栏"
            onClick={() => {
              setSessionListOpen(false)
              setContextOpen(false)
            }}
          />
        )}
        {memoryPanelOpen && (
          <>
            <button
              className="desktop-scrim desktop-drawer-scrim"
              aria-label="关闭记忆管理"
              onClick={() => setMemoryPanelOpen(false)}
            />
            <div className="desktop-drawer" role="dialog" aria-label="记忆管理">
              <MemorySidePanel onClose={() => setMemoryPanelOpen(false)} />
            </div>
          </>
        )}
      </div>
      <FramelessResizeHandles />
    </div>
  )
}
