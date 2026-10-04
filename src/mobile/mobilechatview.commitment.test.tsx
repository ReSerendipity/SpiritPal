// P1-7-be: 移动端承诺（commitments）接线测试
// 桌面端 ChatWindow 会注入约定上下文并在回复后抽取/落库/自动过期；移动端此前整段没接。
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/lib/system/i18n'
import { useChatStore } from '@/stores/chatStore'
import { usePetStore } from '@/stores/petStore'
import { MobileChatView } from './MobileChatView'

const chatMock = vi.fn()
const buildContextMock = vi.fn<() => Promise<string>>(() => Promise.resolve(''))
const extractFromTextMock = vi.fn<(user: string, assistant: string) => unknown[]>(() => [])
const saveCommitmentMock = vi.fn((_commitment: unknown) => Promise.resolve(1))
const autoLapseOverdueMock = vi.fn(() => Promise.resolve(0))

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

vi.mock('@/lib/nurture/commitmentTracker', () => ({
  getCommitmentTracker: () => ({
    buildContext: buildContextMock,
    extractFromText: extractFromTextMock,
    saveCommitment: saveCommitmentMock,
    autoLapseOverdue: autoLapseOverdueMock,
  }),
}))

/** 输入并发送 */
async function sendMessage(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  fireEvent.click(screen.getByLabelText('发送'))
}

describe('MobileChatView 承诺接线（P1-7-be）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    buildContextMock.mockResolvedValue('')
    extractFromTextMock.mockReturnValue([])
    saveCommitmentMock.mockResolvedValue(1)
    autoLapseOverdueMock.mockResolvedValue(0)
    usePetStore.setState({ currentCharacterId: 'doro' })
    useChatStore.setState({
      sessions: {},
      messagesBySession: {},
      activeSessionByCharacter: {},
      isLoading: false,
      abortController: null,
    })
    chatMock.mockImplementation(async (_msgs, onChunk) => {
      onChunk?.('好的，我记住了')
      return '好的，我记住了'
    })
  })

  it('发送前注入约定上下文（buildContext 结果进入 system 消息）', async () => {
    buildContextMock.mockResolvedValue('【主人的计划与约定】\n- 去爬山（预计 …）')
    render(<MobileChatView />)
    await sendMessage('在吗')

    await waitFor(() => {
      expect(chatMock).toHaveBeenCalledTimes(1)
    })
    const messages = chatMock.mock.calls[0][0] as Array<{ role: string; content: string }>
    expect(messages.some((m) => m.role === 'system' && m.content.includes('主人的计划与约定'))).toBe(true)
  })

  it('回复后抽取约定并落库 + 自动过期', async () => {
    extractFromTextMock.mockReturnValue([
      { content: '去爬山', actor: 'owner', due: '2026-10-06', repeat: null },
    ])
    render(<MobileChatView />)
    await sendMessage('我明天要去爬山')

    await waitFor(() => {
      expect(saveCommitmentMock).toHaveBeenCalledTimes(1)
    })
    // 取最后一次调用：上一用例的 void 异步链路可能跨用例落到这里
    const last = extractFromTextMock.mock.calls.at(-1)
    expect(last).toBeDefined()
    const userText = last?.[0]
    const assistantText = last?.[1]
    expect(userText).toBe('我明天要去爬山')
    expect(assistantText).toBe('好的，我记住了')
    expect(saveCommitmentMock.mock.calls[0][0]).toMatchObject({ content: '去爬山' })
    await waitFor(() => {
      expect(autoLapseOverdueMock).toHaveBeenCalled()
    })
  })

  it('承诺链路抛错不影响对话完成（非致命）', async () => {
    buildContextMock.mockRejectedValue(new Error('db locked'))
    extractFromTextMock.mockImplementation(() => {
      throw new Error('db locked')
    })
    render(<MobileChatView />)
    await sendMessage('你好')

    await waitFor(() => {
      const msgs = useChatStore.getState().getMessages()
      expect(msgs.some((m) => m.role === 'assistant' && m.content === '好的，我记住了')).toBe(true)
    })
    const assistant = useChatStore.getState().getMessages().find((m) => m.role === 'assistant')
    expect(assistant?.sendStatus).toBeUndefined()
  })
})
