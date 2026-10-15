// P1-2b: MobileChatView 思维链「流式接线」测试
//
// 背景（GOTCHAS #180）：折叠 UI 与 thinkContent 字段早就存在，但**移动端流式路径从没跑过
// ThinkTagParser** —— 原始 chunk 直接 append 进正文，于是推理链与 </think> 一起显示在气泡里，
// 折叠块永远不出现。本测试锁死「流式解析 → thinkContent / 正文分离」这条接线。
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/lib/system/i18n'
import { useChatStore } from '@/stores/chatStore'
import { usePetStore } from '@/stores/petStore'
import { MobileChatView } from './MobileChatView'

const chatMock = vi.fn()

vi.mock('@/lib/ai/llmClient', () => ({
  getLLMClient: () => ({
    chat: chatMock,
    lastCallUsage: { input: 10, output: 20 },
    getConfig: () => ({ provider: 'ondevice', model: 'Qwen3.5-0.8B-MNN' }),
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

vi.mock('@/lib/nurture/commitmentTracker', () => ({
  getCommitmentTracker: () => ({
    buildContext: vi.fn(() => Promise.resolve('')),
    extractFromText: vi.fn(() => []),
    saveCommitment: vi.fn(() => Promise.resolve(1)),
    autoLapseOverdue: vi.fn(() => Promise.resolve(0)),
  }),
}))

/** 输入并发送 */
async function sendMessage(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  fireEvent.click(screen.getByLabelText('发送'))
}

/** 让 mock 的 chat 依次吐出给定 chunk，并以拼接结果 resolve */
function stubStream(chunks: string[]) {
  chatMock.mockImplementation(async (_msgs: unknown, onChunk: (c: string) => void) => {
    for (const c of chunks) onChunk(c)
    return chunks.join('')
  })
}

/** 取最后一条 assistant 消息 */
function lastAssistant() {
  const sessions = useChatStore.getState().messagesBySession
  const all = Object.values(sessions).flat()
  return all.filter((m) => m.role === 'assistant').at(-1)
}

describe('MobileChatView 思维链流式接线（P1-2b）', () => {
  beforeEach(() => {
    chatMock.mockReset()
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

  it('裸 </think>（端侧 Qwen3 形态）：推理进 thinkContent，正文只留答案', async () => {
    stubStream(['让我想想', '9.11 和 9.9</think>', '9.9 更大！'])
    render(<MobileChatView />)
    await sendMessage('哪个大？')

    await waitFor(() => {
      const msg = lastAssistant()
      expect(msg?.content).toBe('9.9 更大！')
    })
    const msg = lastAssistant()
    expect(msg?.thinkContent).toBe('让我想想9.11 和 9.9')
    // 正文里不应再出现推理链，也不应残留标签
    expect(msg?.content).not.toContain('让我想想')
    expect(msg?.content).not.toContain('</think>')
    // 折叠块出现在界面上
    expect(screen.getByRole('button', { name: /内心独白/ })).toBeTruthy()
  })

  it('标准 <think>…</think>：同样分离，正文不含标签', async () => {
    stubStream(['<think>先确认一下', '再回答</think>', '答案是 9.9'])
    render(<MobileChatView />)
    await sendMessage('哪个大？')

    await waitFor(() => {
      expect(lastAssistant()?.content).toBe('答案是 9.9')
    })
    expect(lastAssistant()?.thinkContent).toBe('先确认一下再回答')
    expect(screen.getByRole('button', { name: /内心独白/ })).toBeTruthy()
  })

  it('无标签：正文照常流式落地，且不渲染折叠块（回归：旧解析器会把正文扣住）', async () => {
    stubStream(['你好', '呀！今天也要', '加油'])
    render(<MobileChatView />)
    await sendMessage('在吗')

    await waitFor(() => {
      expect(lastAssistant()?.content).toBe('你好呀！今天也要加油')
    })
    expect(lastAssistant()?.thinkContent ?? '').toBe('')
    expect(screen.queryByText(/内心独白/)).toBeNull()
  })
})
