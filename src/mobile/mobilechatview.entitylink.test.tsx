// P1-3-be: 移动端实体抽取接线测试——发送消息后 extractAndLink 被生产调用
// （此前 EntityManager.extractAndLink 无任何生产调用方，entity_nodes/edges 恒空）
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import '@/lib/system/i18n'
import { useChatStore } from '@/stores/chatStore'
import { usePetStore } from '@/stores/petStore'
import { MobileChatView } from './MobileChatView'

const chatMock = vi.fn()
const extractAndLinkMock = vi.fn<(text: string, memoryId: string) => unknown[]>(() => [])
const ensureLoadedMock = vi.fn(() => Promise.resolve())
const upsertEntityMock = vi.fn((name: string) => Promise.resolve('ent-' + name))
const upsertEntityEdgeMock = vi.fn(() => Promise.resolve())

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

vi.mock('@/lib/memory/entityLinking', () => ({
  getEntityManager: () => ({
    ensureLoaded: ensureLoadedMock,
    extractAndLink: extractAndLinkMock,
  }),
}))

vi.mock('@/lib/memory/entityGraph', () => ({
  upsertEntity: upsertEntityMock,
  upsertEntityEdge: upsertEntityEdgeMock,
}))

/** 输入并发送 */
async function sendMessage(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  fireEvent.click(screen.getByLabelText('发送'))
}

describe('MobileChatView 实体抽取接线（P1-3-be）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePetStore.setState({ currentCharacterId: 'doro' })
    useChatStore.setState({
      sessions: {},
      messagesBySession: {},
      activeSessionByCharacter: {},
      isLoading: false,
      abortController: null,
    })
    localStorage.clear()
    chatMock.mockImplementation(async (_msgs, onChunk) => {
      onChunk?.('好的，我知道了')
      return '好的，我知道了'
    })
  })

  it('发送消息后 extractAndLink 以用户文本 + 记忆 ID 被调用，节点与共现边写入图谱表', async () => {
    extractAndLinkMock.mockReturnValue([
      { id: 'e1', name: '小明', type: 'person', linkedMemoryIds: [], mentionCount: 1, firstSeen: 0, lastSeen: 0 },
      { id: 'e2', name: '杭州', type: 'place', linkedMemoryIds: [], mentionCount: 1, firstSeen: 0, lastSeen: 0 },
    ])
    render(<MobileChatView />)
    await sendMessage('我住在杭州，喜欢爬山')
    await waitFor(() => {
      expect(extractAndLinkMock).toHaveBeenCalledTimes(1)
    })
    const [text, memoryId] = extractAndLinkMock.mock.calls[0]
    expect(text).toBe('我住在杭州，喜欢爬山')
    expect(memoryId).toBe('mem-test-1')
    expect(ensureLoadedMock).toHaveBeenCalled()
    // 图谱写入：2 个节点 + 1 条共现边
    expect(upsertEntityMock).toHaveBeenCalledTimes(2)
    expect(upsertEntityMock.mock.calls.map((c) => c[0])).toEqual(['小明', '杭州'])
    expect(upsertEntityEdgeMock).toHaveBeenCalledTimes(1)
    expect(upsertEntityEdgeMock.mock.calls[0].slice(0, 2)).toEqual(['ent-小明', 'ent-杭州'])
  })

  it('实体提取失败不影响对话与记忆写入（非致命）', async () => {
    extractAndLinkMock.mockImplementation(() => {
      throw new Error('db locked')
    })
    render(<MobileChatView />)
    await sendMessage('你好')
    await waitFor(() => {
      // 对话正常完成：助手消息有内容
      const msgs = useChatStore.getState().getMessages()
      expect(msgs.some((m) => m.role === 'assistant' && m.content === '好的，我知道了')).toBe(true)
    })
    // 不产生 failed 状态
    const msgs = useChatStore.getState().getMessages()
    const assistant = msgs.find((m) => m.role === 'assistant')
    expect(assistant?.sendStatus).toBeUndefined()
  })
})
