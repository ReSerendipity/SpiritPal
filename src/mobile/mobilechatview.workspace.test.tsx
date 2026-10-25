import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '@/lib/system/i18n'
import { useChatStore } from '@/stores/chatStore'
import { usePetStore } from '@/stores/petStore'
import { MobileChatView } from './MobileChatView'

const fixture = vi.hoisted(() => ({
  chat: vi.fn(),
  prepare: vi.fn(),
  addExchange: vi.fn(() => ({ id: 'stored', emotionalIntensity: 0 })),
  updateIntensity: vi.fn(),
  updateMood: vi.fn(),
  updateMemoryIntensity: vi.fn(),
  updateMemoryMood: vi.fn(),
  extract: vi.fn(async () => false),
  episode: vi.fn(async () => {}),
  metrics: {
    requestStartTs: 100,
    responseEndTs: 1000,
    durationMs: 900,
    promptTokens: 20,
    completionTokens: 10,
    ttftMs: 200,
    firstTextMs: 400,
    usageSource: 'reported',
    status: 'completed',
    model: 'fixture-model',
    provider: 'custom',
  },
}))
vi.mock('@/lib/ai/llmClient', () => ({
  getLLMClient: () => ({
    chat: fixture.chat,
    get lastCallMetrics() {
      return fixture.metrics
    },
    getConfig: () => ({ model: 'fixture-model', provider: 'custom' }),
  }),
  DEFAULT_AI_CONFIG: {
    provider: 'custom',
    apiKey: '',
    baseUrl: 'http://localhost:5231',
    model: 'fixture-model',
    temperature: 0.5,
    maxTokens: 100,
  },
}))
vi.mock('@/lib/data/secureStorage', () => ({ getApiKey: async () => null }))
vi.mock('@/lib/data/characters', () => ({
  getCharacter: () => ({
    id: 'doro',
    displayName: '多罗',
    systemPrompt: 'hello',
    themeColor: { primary: '#ff8a50', secondary: '#ff8a50' },
  }),
  getAllCharacters: () => [],
  getDefaultCharacter: () => ({ id: 'doro' }),
}))
vi.mock('@/lib/ai/personalityEngine', () => ({
  getEffectivePersonality: () => ({}),
  composeFullSystemPrompt: () => 'persona',
}))
vi.mock('@/lib/memory/chatMemoryContext', () => ({ prepareChatMemory: fixture.prepare }))
vi.mock('@/lib/memory/enhancedMemory', () => ({
  getEnhancedMemoryManager: () => ({
    ensureLoaded: async () => {},
    getContextForChat: async () => '',
    addExchange: fixture.addExchange,
    updateMemoryIntensity: fixture.updateIntensity,
    updateMemoryMood: fixture.updateMood,
  }),
}))
vi.mock('@/lib/memory/ownerFacts', () => ({
  getOwnerFactsManager: () => ({ ensureLoaded: async () => {}, extractAndSave: fixture.extract }),
}))
vi.mock('@/lib/memory/contextEpisodeManager', () => ({
  getContextEpisodeManager: () => ({ recordStateChange: fixture.episode }),
}))
vi.mock('@/mobile/MobileCommitmentBar', () => ({ MobileCommitmentBar: () => null }))
vi.mock('@/lib/nurture/commitmentTracker', () => ({
  getCommitmentTracker: () => ({
    buildContext: async () => '',
    extractFromText: () => [],
    autoLapseOverdue: async () => {},
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  usePetStore.setState({ currentCharacterId: 'doro' })
  useChatStore.setState({
    sessions: {},
    messagesBySession: {},
    activeSessionByCharacter: {},
    isLoading: false,
    abortController: null,
  })
  fixture.prepare.mockImplementation(async (options) => ({
    messages:
      options.enabled && !options.temporary
        ? [{ id: 'memory-section', role: 'system', content: '记忆测试片段', timestamp: 0 }]
        : [],
    trace: {
      mode: options.temporary ? 'temporary' : options.enabled ? 'enabled' : 'disabled',
      sections:
        options.enabled && !options.temporary
          ? [{ id: 'memory-section', label: '主人画像', content: '记忆测试片段', estimatedTokens: 6 }]
          : [],
      capturedAt: 0,
    },
  }))
  fixture.chat.mockImplementation(async (_messages, onChunk, _signal, onProgress) => {
    onChunk('新的回复')
    onProgress?.(fixture.metrics)
    return '新的回复'
  })
})

afterEach(async () => {
  // 等待本轮生成真正结束：episode('idle') 在 finishStreaming 之前调用，
  // 若用例在回复刚显示时就结束，它的调用会落到下一个用例的断言里。
  await waitFor(() => expect(useChatStore.getState().isLoading).toBe(false))
})

async function send(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  fireEvent.click(screen.getByLabelText('发送'))
  await screen.findByText('新的回复')
  await waitFor(() => expect(useChatStore.getState().isLoading).toBe(false))
}

describe('mobile chat workspace', () => {
  it('offers display controls and exposes actual sent memory with request metrics', async () => {
    render(<MobileChatView />)
    expect(screen.getByRole('button', { name: '显示选项' })).toBeInTheDocument()
    await send('你好')
    const assistant = useChatStore
      .getState()
      .getMessages()
      .find((m) => m.role === 'assistant')
    expect(assistant?.memoryTrace?.sections[0]?.content).toBe('记忆测试片段')
    expect(fixture.chat.mock.calls[0][0].filter((m: { content: string }) => m.content === '记忆测试片段')).toHaveLength(
      1,
    )
    expect(assistant?.metrics?.firstTextMs).toBe(400)
  })
  it('emotion tags in the reply raise the stored memory intensity on mobile too', async () => {
    fixture.chat.mockImplementation(async (_messages, onChunk) => {
      onChunk('[happy]太开心了！')
      return '[happy]太开心了！'
    })
    render(<MobileChatView />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '今天真好' } })
    fireEvent.click(screen.getByLabelText('发送'))
    await waitFor(() => expect(fixture.addExchange).toHaveBeenCalled())
    await waitFor(() => expect(fixture.updateIntensity).toHaveBeenCalled())
    const [, intensity] = fixture.updateIntensity.mock.calls.at(-1)!
    expect(Number(intensity)).toBeGreaterThanOrEqual(0.4)
    expect(fixture.updateMood).toHaveBeenCalled()
    const stored = useChatStore
      .getState()
      .getMessages()
      .find((m) => m.role === 'assistant')
    expect(stored?.content).toBe('太开心了！')
    expect(fixture.addExchange).toHaveBeenCalledWith('今天真好', '太开心了！')
    await waitFor(() => expect(useChatStore.getState().isLoading).toBe(false))
  })
  it('temporary conversation neither records long-term memory nor receives remembered context', async () => {
    render(<MobileChatView />)
    fireEvent.click(screen.getByRole('button', { name: '临时聊天' }))
    await send('这个不保存')
    expect(fixture.prepare).toHaveBeenCalledWith(expect.objectContaining({ temporary: true }))
    expect(fixture.addExchange).not.toHaveBeenCalledWith('这个不保存', expect.anything())
    expect(fixture.extract).not.toHaveBeenCalledWith('这个不保存')
    expect(fixture.episode).not.toHaveBeenCalled()
    expect(fixture.chat.mock.calls[0][0].some((m: { content: string }) => m.content === '记忆测试片段')).toBe(false)
    expect(useChatStore.getState().getSessions()[0]?.temporary).toBe(true)
  })
  it('memory toggle disables reading and recording without changing display controls', async () => {
    render(<MobileChatView />)
    fireEvent.click(screen.getByLabelText('本轮记忆'))
    await send('暂不记住')
    expect(fixture.prepare).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }))
    expect(fixture.addExchange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '显示选项' })).toBeInTheDocument()
  })
  it('editing preserves old messages and drafts into a separate conversation', async () => {
    const assistantId = useChatStore.getState().sendMessage('旧问题')
    useChatStore.getState().updateMessageContent(assistantId, '旧回复')
    useChatStore.getState().finishStreaming(assistantId)
    const oldId = useChatStore.getState().activeSessionByCharacter.doro
    render(<MobileChatView />)
    fireEvent.click(screen.getByRole('button', { name: '编辑重发' }))
    expect(screen.getByRole('textbox')).toHaveValue('旧问题')
    expect(useChatStore.getState().activeSessionByCharacter.doro).not.toBe(oldId)
    expect(useChatStore.getState().messagesBySession[oldId!]?.map((m) => m.content)).toEqual(['旧问题', '旧回复'])
  })
  it('stopping during memory preparation prevents launching the model', async () => {
    let resolve!: (value: unknown) => void
    fixture.prepare.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r
      }),
    )
    render(<MobileChatView />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'cancel before request' } })
    fireEvent.click(screen.getByLabelText('发送'))
    await waitFor(() => expect(fixture.prepare).toHaveBeenCalled())
    fireEvent.click(screen.getByLabelText('停止'))
    resolve({ messages: [], trace: { mode: 'enabled', sections: [], capturedAt: 0 } })
    await waitFor(() => expect(useChatStore.getState().isLoading).toBe(false))
    expect(fixture.chat).not.toHaveBeenCalled()
  })
})
