import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/lib/system/i18n'
import ChatWindow from '@/components/ChatWindow'
import type { ChatMessage, MessageMetrics } from '@/lib/data/types'
import { useChatStore } from '@/stores/chatStore'

// Keep the real session/generation store and shared UI. Only external services are doubled.
const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  chat: vi.fn(),
  prepare: vi.fn(),
  cognee: vi.fn(),
  addExchange: vi.fn(),
  updateIntensity: vi.fn(),
  extractFacts: vi.fn(),
  autoFacts: vi.fn(),
  diary: vi.fn(),
  emotion: vi.fn(),
  antiRep: vi.fn(),
  schedule: vi.fn(),
  saveCommitment: vi.fn(),
  detectAgent: vi.fn(),
  agent: vi.fn(),
  visual: vi.fn(),
  speak: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  abort: vi.fn(),
  supported: true,
  characterAvailable: true,
  lastMetrics: undefined as MessageMetrics | undefined,
  setStage: vi.fn(),
  restore: vi.fn(),
  scroll: vi.fn(),
}))
vi.mock('@/lib/data/db', () => ({
  sqliteStorage: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => {}),
    removeItem: vi.fn(async () => {}),
  },
}))
vi.mock('@/stores/petStore', () => {
  const state = { currentCharacterId: 'doro', stats: {} }
  return {
    usePetStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
      getState: () => state,
      setState: vi.fn(),
    }),
  }
})
vi.mock('@/lib/data/characters', () => ({
  getCharacter: () =>
    mocks.characterAvailable
      ? {
          id: 'doro',
          displayName: '多罗',
          signaturePhrase: '嘟嘟噜～',
          themeColor: { primary: '#FFB6C1', secondary: '#FFA500' },
          personality: { warmth: 0.5, liveliness: 0.8, dependence: 0.3, directness: -0.2, rationality: 0.1 },
          systemPrompt: '你是多罗',
          fewShotExamples: [],
        }
      : undefined,
}))
vi.mock('@/lib/ai/aiConfig', () => ({ loadAIConfig: mocks.config }))
vi.mock('@/lib/ai/llmClient', () => ({
  getLLMClient: () => ({
    chat: mocks.chat,
    get lastCallMetrics() {
      return mocks.lastMetrics
    },
  }),
  DEFAULT_AI_CONFIG: { provider: 'openai', model: 'test-model' },
}))
vi.mock('@/lib/memory/chatMemoryContext', () => ({ prepareChatMemory: mocks.prepare }))
vi.mock('@/lib/memory/cogneeClient', () => ({ cogneeAdd: mocks.cognee }))
vi.mock('@/lib/memory/enhancedMemory', () => ({
  getEnhancedMemoryManager: () => ({
    ensureLoaded: vi.fn(async () => {}),
    getWorkingMemories: () => [],
    getContextForChat: vi.fn(async () => ''),
    checkTriggers: vi.fn(async () => null),
    addExchange: mocks.addExchange,
    updateMemoryMood: vi.fn(),
    updateMemoryIntensity: mocks.updateIntensity,
  }),
}))
vi.mock('@/lib/memory/ownerFacts', () => ({
  getOwnerFactsManager: () => ({
    ensureLoaded: vi.fn(async () => {}),
    buildContext: () => '',
    getAllFacts: () => [],
    extractAndSave: mocks.extractFacts,
    autoExtractWithLLM: mocks.autoFacts,
  }),
}))
vi.mock('@/lib/nurture/petExperience', () => ({
  getPetExperienceManager: () => ({
    ensureLoaded: vi.fn(async () => {}),
    buildContext: () => '',
  }),
}))
vi.mock('@/lib/nurture/commitmentTracker', () => ({
  getCommitmentTracker: () => ({
    buildContext: vi.fn(async () => ''),
    extractFromText: () => [{ title: '计划' }],
    saveCommitment: mocks.saveCommitment,
    autoLapseOverdue: vi.fn(async () => {}),
  }),
}))
vi.mock('@/lib/nurture/diarySystem', () => ({ getDiarySystemManager: () => ({ recordExchange: mocks.diary }) }))
vi.mock('@/lib/nurture/scheduleManager', () => ({ getScheduleManager: () => ({ addFromChat: mocks.schedule }) }))
vi.mock('@/lib/nurture/achievementSystem', () => ({ getAchievementManager: () => ({ recordChat: vi.fn() }) }))
vi.mock('@/lib/ai/emotionEngine', () => ({
  getEmotionAnalyzer: () => ({
    analyze: (s: string) => ({ emotion: /开心|happy/.test(s) ? 'happy' : 'neutral', intensity: 0.6, confidence: 0.8 }),
  }),
  getEmotionStateManager: () => ({ update: mocks.emotion }),
}))
vi.mock('@/lib/system/antiRepetition', () => ({
  getAntiRepetitionManager: () => ({
    recordResponse: mocks.antiRep,
    getAntiRepetitionInstruction: () => '',
  }),
}))
vi.mock('@/lib/ai/contextAwareness', () => ({
  getContextAwarenessManager: () => ({
    getCurrentWindowState: () => 'idle',
    getLastIdleMinutes: () => 0,
  }),
}))
vi.mock('@/lib/memory/visualPerception', () => ({
  getVisualPerceptionManager: () => ({ triggerAnalysis: mocks.visual }),
}))
vi.mock('@/lib/memory/visualMemoryManager', () => ({
  getVisualMemoryManager: () => ({
    ensureLoaded: vi.fn(async () => {}),
    buildContext: () => '',
    record: vi.fn(),
  }),
}))
vi.mock('@/lib/ai/aiAgent', () => ({ detectAgentIntent: mocks.detectAgent, processAgentRequest: mocks.agent }))
vi.mock('@/lib/ai/agentSandbox', () => ({ setToolConfirmationHandler: vi.fn() }))
vi.mock('@/lib/ai/personalityEngine', () => ({
  composeFullSystemPrompt: () => 'system prompt',
  getEffectivePersonality: () => ({}),
}))
vi.mock('@/lib/nurture/characterConsistency', () => ({
  checkConsistency: () => ({ isConsistent: true, violations: [] }),
  generateCorrectionPrompt: () => 'correction',
}))
vi.mock('@/lib/ai/chatStages', () => ({ getChatStageManager: () => stageManager }))
const stageManager = { setStage: mocks.setStage, restore: mocks.restore }
vi.mock('@/hooks/usePetTTS', () => ({ usePetTTS: () => ({ speak: mocks.speak }) }))
vi.mock('@/lib/system/silentModeManager', () => ({ getSilentModeManager: () => ({ isSilent: () => false }) }))
vi.mock('@/lib/system/analytics', () => ({
  trackChatSend: vi.fn(),
  trackChatReceive: vi.fn(),
  trackMemoryTrigger: vi.fn(),
}))
vi.mock('@/lib/ai/stt', () => ({
  isSpeechRecognitionSupported: () => mocks.supported,
  STTEngine: vi.fn(function () {
    return { start: mocks.start, stop: mocks.stop, abort: mocks.abort }
  }),
}))
vi.mock('@/lib/ai/tts', () => ({
  voicevoxTTS: {
    isEngineAvailable: vi.fn(async () => true),
    synthesize: vi.fn(async () => new Blob()),
  },
}))
vi.mock('@/lib/ai/ttsPlayer', () => ({
  TTSPlayer: vi.fn(function () {
    return { play: vi.fn(async () => {}), stop: vi.fn() }
  }),
}))

const metrics: MessageMetrics = {
  requestStartTs: 100,
  responseEndTs: 200,
  durationMs: 100,
  promptTokens: 12,
  completionTokens: 4,
  usageSource: 'reported',
  status: 'completed',
  provider: 'openai',
  model: 'test-model',
}
const memorySection = { id: 'facts', label: '用户画像', content: '你喜欢茶', estimatedTokens: 5 }
function message(id: string, role: ChatMessage['role'], content: string): ChatMessage {
  return { id, role, content, timestamp: 1 }
}
function seed(messages: ChatMessage[]) {
  useChatStore.setState({ messagesBySession: { 'sess-1': messages } })
}
function currentMessages() {
  return useChatStore.getState().getMessages()
}
async function mount() {
  await act(async () => {
    render(<ChatWindow />)
  })
}
async function send(text = '你好') {
  fireEvent.change(screen.getByLabelText('聊天输入框'), { target: { value: text } })
  await act(async () => {
    fireEvent.click(screen.getByLabelText('发送消息'))
  })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.characterAvailable = true
  mocks.supported = true
  mocks.lastMetrics = undefined
  mocks.config.mockResolvedValue({ provider: 'openai', model: 'test-model', apiKey: '' })
  mocks.detectAgent.mockReturnValue(false)
  mocks.agent.mockResolvedValue('工具完成')
  mocks.visual.mockResolvedValue(null)
  mocks.cognee.mockResolvedValue(undefined)
  mocks.addExchange.mockReturnValue({ id: 'memory-1', importance: 10, emotionalIntensity: 0 })
  mocks.extractFacts.mockResolvedValue(false)
  mocks.autoFacts.mockResolvedValue(false)
  mocks.saveCommitment.mockResolvedValue(undefined)
  mocks.schedule.mockReturnValue(null)
  mocks.prepare.mockImplementation(async ({ enabled, temporary }) => ({
    messages: enabled && !temporary ? [message('context', 'system', '你喜欢茶')] : [],
    trace: {
      mode: temporary ? 'temporary' : enabled ? 'enabled' : 'disabled',
      sections: enabled && !temporary ? [memorySection] : [],
      capturedAt: 123,
    },
  }))
  mocks.chat.mockImplementation(async (_messages, onChunk, _signal, onProgress) => {
    onChunk?.('AI 回复')
    mocks.lastMetrics = metrics
    onProgress?.(metrics)
    return 'AI 回复'
  })
  useChatStore.setState({
    sessions: {
      doro: [
        {
          id: 'sess-1',
          characterId: 'doro',
          title: '测试会话',
          createdAt: 1,
          updatedAt: 1,
          messageCount: 0,
          totalPromptTokens: 0,
          totalCompletionTokens: 0,
          requestCount: 0,
        },
      ],
    },
    messagesBySession: { 'sess-1': [] },
    activeSessionByCharacter: { doro: 'sess-1' },
    isLoading: false,
    abortController: null,
  })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: mocks.scroll })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ChatWindow desktop workspace', () => {
  it('保留窗口控制并展示会话标题、模型与显示设置入口', async () => {
    await mount()
    expect(screen.getByLabelText('最小化')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '测试会话' })).toBeInTheDocument()
    expect(screen.getByText(/test-model/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /显示选项/ })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /记忆读写/ })).toBeChecked()
  })
  it('空态建议仅填入输入框，不自动发送', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '一起聊聊今天' }))
    expect(screen.getByLabelText('聊天输入框')).toHaveValue('一起聊聊今天')
    expect(currentMessages()).toHaveLength(0)
    expect(mocks.chat).not.toHaveBeenCalled()
  })
  it('空输入禁用发送，Enter 发送并清空输入', async () => {
    await mount()
    expect(screen.getByLabelText('发送消息')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('聊天输入框'), { target: { value: '回车发送' } })
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('聊天输入框'), { key: 'Enter' })
    })
    expect(currentMessages()[0]?.content).toBe('回车发送')
    expect(screen.getByLabelText('聊天输入框')).toHaveValue('')
  })
  it('IME 合成期间 Enter 不发送，Shift+Enter 保留换行', async () => {
    await mount()
    const input = screen.getByLabelText('聊天输入框')
    fireEvent.change(input, { target: { value: '正在输入' } })
    fireEvent.compositionStart(input)
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 })
    fireEvent.compositionEnd(input)
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
    expect(currentMessages()).toHaveLength(0)
    expect(input).toHaveValue('正在输入')
  })
  it('清空历史必须先确认，取消时保留消息', async () => {
    seed([message('u1', 'user', '不能误删')])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await mount()
    fireEvent.click(screen.getByLabelText('清空聊天记录'))
    expect(confirm).toHaveBeenCalledOnce()
    expect(currentMessages()).toHaveLength(1)
    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByLabelText('清空聊天记录'))
    expect(currentMessages()).toHaveLength(0)
  })
  it('搜索通过消息 ID 定位卡片，并支持关闭搜索', async () => {
    seed([message('u1', 'user', '你好'), message('a1', 'assistant', '找到我')])
    await mount()
    fireEvent.click(screen.getByLabelText('搜索对话'))
    fireEvent.change(screen.getByPlaceholderText('搜索对话内容…'), { target: { value: '找到我' } })
    expect(mocks.scroll).toHaveBeenCalled()
    const target = mocks.scroll.mock.instances.at(-1) as HTMLElement
    expect(target.closest('[data-message-id]')?.getAttribute('data-message-id')).toBe('a1')
    fireEvent.click(screen.getByTitle('关闭搜索'))
    expect(screen.queryByPlaceholderText('搜索对话内容…')).not.toBeInTheDocument()
  })
  it('远离底部时新消息不强拉滚动，允许主动回到底部', async () => {
    await mount()
    const log = screen.getByRole('log')
    Object.defineProperties(log, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { configurable: true, value: 400 },
    })
    log.scrollTop = 100
    fireEvent.scroll(log)
    act(() => seed([message('a1', 'assistant', '新消息')]))
    expect(log.scrollTop).toBe(100)
    fireEvent.click(screen.getByRole('button', { name: '回到最新' }))
    expect(log.scrollTop).toBe(2000)
  })
  it('语音输入可开始、回填和停止，保留朗读入口', async () => {
    seed([message('a1', 'assistant', '可以朗读')])
    await mount()
    expect(screen.getByLabelText('朗读此回复')).toBeEnabled()
    fireEvent.click(screen.getByLabelText('语音输入'))
    act(() => mocks.start.mock.calls[0]?.[0].onPartial('识别文本'))
    expect(screen.getByLabelText('聊天输入框')).toHaveValue('识别文本')
    fireEvent.click(screen.getByLabelText('停止语音输入'))
    expect(mocks.stop).toHaveBeenCalledOnce()
  })
  it('语音不可用时明确报错', async () => {
    mocks.supported = false
    await mount()
    fireEvent.click(screen.getByLabelText('语音输入'))
    expect(screen.getByText(/当前环境不支持语音识别/)).toBeInTheDocument()
  })
})

describe('ChatWindow generation boundaries', () => {
  it.each(['帮我打开计算器', '看看屏幕'])('关闭记忆时只做文本聊天且不产生任何派生记忆：%s', async (text) => {
    mocks.detectAgent.mockReturnValue(true)
    await mount()
    fireEvent.click(screen.getByRole('switch', { name: /记忆读写/ }))
    await send(text)
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, temporary: false }))
    expect(mocks.chat).toHaveBeenCalledOnce()
    expect(mocks.agent).not.toHaveBeenCalled()
    expect(mocks.visual).not.toHaveBeenCalled()
    for (const write of [
      mocks.cognee,
      mocks.addExchange,
      mocks.extractFacts,
      mocks.autoFacts,
      mocks.emotion,
      mocks.antiRep,
      mocks.diary,
      mocks.schedule,
      mocks.saveCommitment,
    ]) {
      expect(write).not.toHaveBeenCalled()
    }
    expect(currentMessages().at(-1)?.memoryTrace?.mode).toBe('disabled')
    expect(screen.getByText(/仅文本聊天/)).toBeInTheDocument()
  })
  it('临时会话不读取或写入长期记忆', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: '临时聊天' }))
    await send('记住这个秘密')
    const state = useChatStore.getState()
    expect(state.sessions.doro?.find((s) => s.id === state.activeSessionByCharacter.doro)?.temporary).toBe(true)
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ temporary: true }))
    expect(mocks.cognee).not.toHaveBeenCalled()
    expect(mocks.addExchange).not.toHaveBeenCalled()
    expect(currentMessages().at(-1)?.memoryTrace?.mode).toBe('temporary')
  })
  it('真正请求前绑定 trace，payload、已知指标与最终回复保持一致', async () => {
    mocks.chat.mockImplementation(async (payload, onChunk, _signal, onProgress) => {
      expect(currentMessages().at(-1)?.memoryTrace?.sections).toEqual([memorySection])
      expect(payload.map((m: ChatMessage) => m.content)).toContain('你喜欢茶')
      onChunk('<think>内部推理</think>可见回复')
      onProgress(metrics)
      mocks.lastMetrics = metrics
      return '<think>内部推理</think>可见回复'
    })
    await mount()
    await send()
    expect(currentMessages().at(-1)).toMatchObject({ content: '可见回复', thinkContent: '内部推理', metrics })
    expect(mocks.addExchange).toHaveBeenCalledWith('你好', '可见回复')
    expect(mocks.speak).toHaveBeenCalledWith('可见回复')
    expect(useChatStore.getState().sessions.doro?.[0]?.totalPromptTokens).toBe(12)
  })
  it('回复里的情绪标签会回写记忆强度，而不是只留下 0', async () => {
    mocks.chat.mockImplementation(async (_messages, onChunk) => {
      onChunk('[happy]太开心了！')
      return '[happy]太开心了！'
    })
    await mount()
    await send('今天怎么样')
    await waitFor(() => expect(mocks.updateIntensity).toHaveBeenCalled())
    const [, intensity] = mocks.updateIntensity.mock.calls.at(-1)!
    expect(Number(intensity)).toBeGreaterThanOrEqual(0.4)
    expect(currentMessages().at(-1)?.content).toBe('太开心了！')
    expect(mocks.addExchange).toHaveBeenCalledWith('今天怎么样', '太开心了！')
  })

  it('等待记忆期间停止，晚到上下文不能继续请求或覆盖新 generation', async () => {
    const pending = deferred<Awaited<ReturnType<typeof mocks.prepare>>>()
    mocks.prepare.mockReturnValueOnce(pending.promise)
    await mount()
    await send('第一轮')
    const firstId = currentMessages().at(-1)!.id
    fireEvent.click(screen.getByLabelText('停止生成'))
    expect(currentMessages().at(-1)?.sendStatus).toBe('aborted')
    const second = deferred<string>()
    mocks.chat.mockReturnValueOnce(second.promise)
    await send('第二轮')
    await act(async () => pending.resolve({ messages: [], trace: { mode: 'enabled', sections: [], capturedAt: 1 } }))
    expect(mocks.chat).toHaveBeenCalledOnce()
    expect(useChatStore.getState().isLoading).toBe(true)
    expect(currentMessages().find((m) => m.id === firstId)?.sendStatus).toBe('aborted')
    await act(async () => second.resolve('第二轮回复'))
  })
  it('配置失败清理 generation，不把异常堆栈拼入正文', async () => {
    mocks.config.mockRejectedValue(new Error('SECRET_STACK'))
    await mount()
    await send()
    expect(useChatStore.getState().isLoading).toBe(false)
    expect(currentMessages().at(-1)).toMatchObject({ content: '', isStreaming: false, sendStatus: 'failed' })
    expect(screen.queryByText(/SECRET_STACK/)).not.toBeInTheDocument()
    expect(mocks.chat).not.toHaveBeenCalled()
  })
  it('没有角色也必须终结 generation', async () => {
    mocks.characterAvailable = false
    await mount()
    await send()
    expect(useChatStore.getState().isLoading).toBe(false)
    expect(currentMessages().at(-1)?.sendStatus).toBe('failed')
  })
  it('记忆记录失败不会把成功回复变为 failed，也不异步追加确认文本', async () => {
    mocks.addExchange.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    mocks.extractFacts.mockResolvedValue(true)
    mocks.autoFacts.mockResolvedValue(true)
    await mount()
    await send('记住我喜欢茶')
    expect(currentMessages().at(-1)).toMatchObject({ content: 'AI 回复', isStreaming: false })
    expect(currentMessages().at(-1)?.sendStatus).toBeUndefined()
  })
  it('编辑 user 只 fork 前缀并预填，原会话不变', async () => {
    const original = [
      message('u0', 'user', '前文'),
      message('a0', 'assistant', '前文回复'),
      message('u1', 'user', '修改这句'),
      message('a1', 'assistant', '旧回复'),
    ]
    seed(original)
    await mount()
    const card = document.querySelector('[data-message-id="u1"]') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: /编辑/ }))
    expect(screen.getByLabelText('聊天输入框')).toHaveValue('修改这句')
    expect(currentMessages().map((m) => m.content)).toEqual(['前文', '前文回复'])
    expect(useChatStore.getState().messagesBySession['sess-1']).toEqual(original)
    expect(mocks.chat).not.toHaveBeenCalled()
  })
  it.each(['重新生成', '不符性格'])('%s fork 到前一个 user，使用最新会话前缀且不重复当前 user', async (action) => {
    const original = [
      message('u0', 'user', '前文'),
      message('a0', 'assistant', '前文回复'),
      message('u1', 'user', '再问一次'),
      message('a1', 'assistant', '旧回复'),
      message('u2', 'user', '不应带入'),
    ]
    seed(original)
    await mount()
    const card = document.querySelector('[data-message-id="a1"]') as HTMLElement
    await act(async () => fireEvent.click(within(card).getByRole('button', { name: action })))
    const payload = mocks.chat.mock.calls[0]?.[0] as ChatMessage[]
    expect(payload.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['前文', '再问一次'])
    expect(payload.some((m) => m.content === '旧回复' || m.content === '不应带入')).toBe(false)
    expect(useChatStore.getState().messagesBySession['sess-1']?.map((m) => m.content)).toEqual(
      original.map((m) => m.content),
    )
    expect(currentMessages().at(-1)?.metrics).toEqual(metrics)
    expect(currentMessages().at(-1)?.memoryTrace?.sections).toEqual([memorySection])
  })
})
