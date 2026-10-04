// P1-2: MobileChatView 思维链（thinkContent）折叠展示测试
// 验收：默认折叠可展开；无 thinkContent 不渲染该块
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@/lib/system/i18n'
import { useChatStore } from '@/stores/chatStore'
import { usePetStore } from '@/stores/petStore'
import { MobileChatView } from './MobileChatView'

vi.mock('@/lib/ai/llmClient', () => ({
  getLLMClient: () => ({ chat: vi.fn() }),
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

describe('MobileChatView 思维链折叠（P1-2）', () => {
  beforeEach(() => {
    usePetStore.setState({ currentCharacterId: 'doro' })
    useChatStore.setState({
      sessions: {},
      messagesBySession: {},
      activeSessionByCharacter: {},
      isLoading: false,
      abortController: null,
    })
    localStorage.clear()
  })

  function addAssistant(content: string, thinkContent?: string) {
    const sessionId = useChatStore.getState().createSession()
    useChatStore.getState().addMessage({
      id: 'a1',
      role: 'assistant',
      content,
      thinkContent,
      timestamp: Date.now(),
    })
    return sessionId
  }

  it('有 thinkContent 时默认折叠，点击展开/再点收起', () => {
    addAssistant('这是回复', '用户问的是量子物理，我应该先解释波粒二象性')
    render(<MobileChatView />)

    // 折叠态：标题按钮可见，内容不可见
    const toggle = screen.getByRole('button', { name: /内心独白/ })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(/波粒二象性/)).toBeNull()

    // 展开态：内容可见
    fireEvent.click(toggle)
    expect(screen.getByText(/波粒二象性/)).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    // 再点收起
    fireEvent.click(toggle)
    expect(screen.queryByText(/波粒二象性/)).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('无 thinkContent 时不渲染思维链块', () => {
    addAssistant('普通回复，没有思考过程')
    render(<MobileChatView />)
    expect(screen.queryByText(/内心独白/)).toBeNull()
  })

  it('空白 thinkContent 同样不渲染', () => {
    addAssistant('回复', '   ')
    render(<MobileChatView />)
    expect(screen.queryByText(/内心独白/)).toBeNull()
  })
})
