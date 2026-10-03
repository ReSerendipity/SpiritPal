// MobileChatView 回复完成后必须跑规则层的主人事实提取。
//
// 缺陷背景：桌面端 ChatWindow 在每轮回复后调 ownerFactsMgr.extractAndSave(text)
// （P2-1）与 autoExtractWithLLM（P3-3），移动端只接了 addExchange ⇒
// 手机上「记忆 › 主人画像」永远是 0，用户反复自我介绍也不会被记住。
// 这里只要求规则层（无额外 LLM 请求）；LLM 提取要不要上移动端是流量/配额决策，另议。
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@/lib/system/i18n'
import { useChatStore } from '@/stores/chatStore'
import { usePetStore } from '@/stores/petStore'
import { MobileChatView } from './MobileChatView'

const chatMock = vi.fn()
const extractSpy = vi.fn(() => Promise.resolve(false))

vi.mock('@/lib/ai/llmClient', () => ({
  getLLMClient: () => ({ chat: chatMock }),
  DEFAULT_AI_CONFIG: {
    provider: 'custom', apiKey: '', model: 'test-model', temperature: 0.7, maxTokens: 2000,
  },
}))
vi.mock('@/lib/data/secureStorage', () => ({
  getApiKey: vi.fn(() => Promise.resolve(null)),
  setApiKey: vi.fn(() => Promise.resolve()),
  deleteApiKey: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/data/characters', () => ({
  getCharacter: vi.fn(() => ({
    id: 'doro', displayName: '多萝', systemPrompt: '你是多萝',
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
vi.mock('@/lib/memory/ownerFacts', () => ({
  getOwnerFactsManager: () => ({
    ensureLoaded: () => Promise.resolve(),
    extractAndSave: extractSpy,
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

describe('MobileChatView 主人事实提取接线', () => {
  beforeEach(() => {
    chatMock.mockReset()
    extractSpy.mockClear()
    usePetStore.setState({ currentCharacterId: 'doro' })
    useChatStore.setState({
      sessions: {}, messagesBySession: {}, activeSessionByCharacter: {},
      isLoading: false, abortController: null,
    })
  })

  it('回复成功后用本轮用户原文跑一次规则提取', async () => {
    chatMock.mockImplementationOnce(async (_m: unknown, onChunk: (s: string) => void) => {
      onChunk('你好呀主人～')
      return '你好呀主人～'
    })
    render(<MobileChatView />)

    await sendMessage('我叫小林，我住在杭州')
    await waitFor(() => expect(screen.getByText('你好呀主人～')).toBeInTheDocument())

    await waitFor(() => expect(extractSpy).toHaveBeenCalledTimes(1))
    expect(extractSpy).toHaveBeenCalledWith('我叫小林，我住在杭州')
  })

  it('请求失败时不做提取（没有回复可依据）', async () => {
    chatMock.mockRejectedValueOnce(new Error('fetch failed'))
    render(<MobileChatView />)

    await sendMessage('你好')
    await waitFor(() => expect(screen.getByText(/无法连接到 AI 服务/)).toBeInTheDocument())

    expect(extractSpy).not.toHaveBeenCalled()
  })
})
