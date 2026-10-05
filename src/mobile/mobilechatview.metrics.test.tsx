// P2-14：移动端消息指标采集与展示
// 桌面端 ChatWindow 会在回复后回写 setMessageMetrics（tokens/TTFT/速率）；
// 移动端此前整段没接，用户在手机上看不到任何耗时/用量信息。
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/lib/system/i18n'
import { useChatStore } from '@/stores/chatStore'
import { usePetStore } from '@/stores/petStore'
import { MobileChatView } from './MobileChatView'

const chatMock = vi.fn()

vi.mock('@/lib/ai/llmClient', () => ({
  getLLMClient: () => ({
    chat: chatMock,
    get lastCallUsage() {
      return { input: 120, output: 45 }
    },
    getConfig: () => ({ model: 'test-model', provider: 'custom' }),
  }),
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

async function sendMessage(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  fireEvent.click(screen.getByLabelText('发送'))
}

describe('MobileChatView 消息指标（P2-14）', () => {
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
    chatMock.mockImplementation(async (_msgs, onChunk) => {
      onChunk?.('你好呀')
      return '你好呀'
    })
  })

  it('回复完成后回写 metrics（tokens/TTFT/速率/模型），气泡下出现可展开指标条', async () => {
    render(<MobileChatView />)
    await sendMessage('嗨')

    await waitFor(() => {
      const msgs = useChatStore.getState().getMessages()
      const assistant = msgs.find((m) => m.role === 'assistant')
      expect(assistant?.metrics).toBeDefined()
    })
    const assistant = useChatStore.getState().getMessages().find((m) => m.role === 'assistant')
    expect(assistant?.metrics?.promptTokens).toBe(120)
    expect(assistant?.metrics?.completionTokens).toBe(45)
    expect(assistant?.metrics?.ttftMs).toBeGreaterThanOrEqual(0)
    expect(assistant?.metrics?.model).toBe('test-model')

    // 指标条渲染（简要行：总 tokens 165 = 120+45 + 耗时 + 速率），点击展开详情
    const bar = await screen.findByText(/165 tok/)
    expect(bar).toBeTruthy()
    act(() => {
      fireEvent.click(bar)
    })
    expect(screen.getByText(/首 token/)).toBeTruthy()
  })
})
