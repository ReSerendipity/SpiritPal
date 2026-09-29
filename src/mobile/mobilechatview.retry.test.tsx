// MobileChatView 失败重试测试（对齐桌面端 ChatWindow 的「重新生成」）
//
// 覆盖点：
//   1. 请求失败后出现「重试」按钮
//   2. 点重试复用同一条助手消息重新请求，且**不**向历史追加重复的用户消息
//   3. 成功回复时不显示重试按钮
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useChatStore } from '@/stores/chatStore'
import { MobileChatView } from './MobileChatView'

const chatMock = vi.fn()

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
    addExchange: vi.fn(),
  }),
}))

vi.mock('@/lib/ai/personalityEngine', () => ({
  getEffectivePersonality: vi.fn(() => ({})),
  composeFullSystemPrompt: vi.fn(() => 'system prompt'),
}))

/** 输入并点击发送 */
async function sendMessage(text: string) {
  fireEvent.change(screen.getByPlaceholderText('输入消息…'), { target: { value: text } })
  fireEvent.click(screen.getByLabelText('发送'))
}

describe('MobileChatView 失败重试', () => {
  beforeEach(() => {
    chatMock.mockReset()
    useChatStore.setState({
      sessions: {},
      messagesBySession: {},
      activeSessionByCharacter: {},
      isLoading: false,
      abortController: null,
    })
  })

  it('请求失败后显示错误与「重试」按钮', async () => {
    chatMock.mockRejectedValueOnce(new Error('fetch failed'))
    render(<MobileChatView />)

    await sendMessage('你好')

    await waitFor(() => {
      expect(screen.getByText(/无法连接到 AI 服务/)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
  })

  it('点重试复用同一轮重新请求，且不追加重复的用户消息', async () => {
    chatMock.mockRejectedValueOnce(new Error('fetch failed'))
    render(<MobileChatView />)

    await sendMessage('你好')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /重试/ })).toBeInTheDocument()
    })

    // 第二次请求成功
    chatMock.mockImplementationOnce(async (_m, onChunk) => { onChunk('恢复的回复'); return '恢复的回复' })
    fireEvent.click(screen.getByRole('button', { name: /重试/ }))

    await waitFor(() => {
      expect(screen.getByText('恢复的回复')).toBeInTheDocument()
    })

    expect(chatMock).toHaveBeenCalledTimes(2)
    // 关键：用户消息只应出现一次（重试不追加新轮次）
    expect(screen.getAllByText('你好')).toHaveLength(1)
    // 重试成功后按钮消失
    expect(screen.queryByRole('button', { name: /重试/ })).toBeNull()
  })

  it('成功回复时不显示重试按钮', async () => {
    chatMock.mockImplementationOnce(async (_m, onChunk) => { onChunk('正常回复'); return '正常回复' })
    render(<MobileChatView />)

    await sendMessage('你好')

    await waitFor(() => {
      expect(screen.getByText('正常回复')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /重试/ })).toBeNull()
    expect(chatMock).toHaveBeenCalledTimes(1)
  })
})
