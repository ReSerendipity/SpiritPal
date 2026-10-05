// P3-6：移动端情境片段——每轮对话开/闭一个 chatting episode（context_episodes 表）
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/lib/system/i18n'
import { useChatStore } from '@/stores/chatStore'
import { usePetStore } from '@/stores/petStore'
import { MobileChatView } from './MobileChatView'

const chatMock = vi.fn()
const recordStateChangeMock = vi.fn((_state: string) => Promise.resolve())

vi.mock('@/lib/ai/llmClient', () => ({
  getLLMClient: () => ({ chat: chatMock }),
  DEFAULT_AI_CONFIG: {
    provider: 'custom',
    apiKey: '',
    model: 'test-model',
    temperature: 0.7,
    maxTokens: 2000,
  },
}))

vi.mock('@/lib/data/secureStorage', () => ({
  getApiKey: vi.fn(() => Promise.resolve(null)),
  setApiKey: vi.fn(() => Promise.resolve()),
  deleteApiKey: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/data/characters', () => ({
  getCharacter: vi.fn(() => ({
    id: 'doro',
    displayName: '多萝',
    systemPrompt: '你是多萝',
    themeColor: { primary: '#FFB6C1', secondary: '#FFA500' },
  })),
  getAllCharacters: vi.fn(() => []),
  getDefaultCharacter: vi.fn(() => ({ id: 'doro', displayName: '多萝', spriteAsset: '' })),
}))

vi.mock('@/lib/memory/enhancedMemory', () => ({
  getEnhancedMemoryManager: () => ({
    ensureLoaded: () => Promise.resolve(),
    getContextForChat: () => Promise.resolve(''),
    addExchange: vi.fn(() => ({ id: 'mem-test-1' })),
  }),
}))

vi.mock('@/lib/ai/personalityEngine', () => ({
  getEffectivePersonality: vi.fn(() => ({})),
  composeFullSystemPrompt: vi.fn(() => 'system prompt'),
}))

vi.mock('@/lib/memory/contextEpisodeManager', () => ({
  getContextEpisodeManager: () => ({
    recordStateChange: recordStateChangeMock,
  }),
}))

async function sendMessage(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  fireEvent.click(screen.getByLabelText('发送'))
}

describe('MobileChatView 情境片段（P3-6）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    recordStateChangeMock.mockResolvedValue(undefined)
    usePetStore.setState({ currentCharacterId: 'doro' })
    useChatStore.setState({
      sessions: {},
      messagesBySession: {},
      activeSessionByCharacter: {},
      isLoading: false,
      abortController: null,
    })
    chatMock.mockImplementation(async (_msgs, onChunk) => {
      onChunk?.('好呀')
      return '好呀'
    })
  })

  it('发送时开 chatting episode，回复完成后闭为 idle', async () => {
    render(<MobileChatView />)
    await sendMessage('在吗')

    await waitFor(() => {
      const states = recordStateChangeMock.mock.calls.map((c) => c[0])
      expect(states).toContain('chatting')
      expect(states).toContain('idle')
    })
    // 顺序：先开后闭
    const states = recordStateChangeMock.mock.calls.map((c) => c[0])
    expect(states.indexOf('chatting')).toBeLessThan(states.indexOf('idle'))
  })

  it('情境记录失败不影响对话完成（非致命）', async () => {
    recordStateChangeMock.mockRejectedValue(new Error('db locked'))
    render(<MobileChatView />)
    await sendMessage('你好')

    await waitFor(() => {
      const msgs = useChatStore.getState().getMessages()
      expect(msgs.some((m) => m.role === 'assistant' && m.content === '好呀')).toBe(true)
    })
    const assistant = useChatStore.getState().getMessages().find((m) => m.role === 'assistant')
    expect(assistant?.sendStatus).toBeUndefined()
  })
})
