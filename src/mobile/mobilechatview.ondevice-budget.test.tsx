// 端侧上下文预算测试（on-device 上下文收紧）
//
// 背景：真机实测 prefill 一度到 4359 token —— 大头不是系统提示词（~400 token），而是
// `getContextForChat(3000)` 记忆上下文 + 最近 20 轮历史。小模型在这种 prompt 长度下
// 注意力被稀释（2B 的推理日志里专门花一段纠正自己看到的 persona 块）。
// 本测试锁死：provider 为 ondevice 时预算收紧，云端保持原预算。
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import '@/lib/system/i18n'
import { useChatStore } from '@/stores/chatStore'
import { usePetStore } from '@/stores/petStore'
import {
  ON_DEVICE_MEM_TOKEN_BUDGET,
  ON_DEVICE_HISTORY_TURNS,
  CLOUD_HISTORY_TURNS,
  MobileChatView,
} from './MobileChatView'

const chatMock = vi.fn()
const getContextForChatMock = vi.fn<(budget: number, query?: string) => Promise<string>>(() => Promise.resolve(''))
const buildContextMock = vi.fn<() => Promise<string>>(() => Promise.resolve(''))

const AI_CONFIG_KEY = 'spiritpal-ai-config'

vi.mock('@/lib/ai/llmClient', () => ({
  getLLMClient: () => ({
    chat: chatMock,
    lastCallUsage: { input: 10, output: 20 },
    getConfig: () => ({ provider: 'ondevice', model: 'Qwen3.5-2B-MNN' }),
  }),
  DEFAULT_AI_CONFIG: {
    provider: 'ondevice',
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
    getContextForChat: getContextForChatMock,
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
    extractFromText: vi.fn(() => []),
    saveCommitment: vi.fn(() => Promise.resolve(1)),
    autoLapseOverdue: vi.fn(() => Promise.resolve(0)),
  }),
}))

/** 写入 AI 配置（含 provider） */
function setAiProvider(provider: string) {
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify({ provider }))
}

/** 造 N 条历史消息（user/assistant 交替） */
function seedHistory(n: number) {
  const store = useChatStore.getState()
  store.clearHistory()
  for (let i = 0; i < n; i++) {
    store.addMessage({
      id: `h${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `历史消息 ${i}`,
      timestamp: Date.now() + i,
    })
  }
}

async function send(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  fireEvent.click(screen.getByLabelText('发送'))
}

describe('移动端端侧上下文预算', () => {
  beforeEach(() => {
    chatMock.mockReset()
    getContextForChatMock.mockClear()
    getContextForChatMock.mockImplementation(() => Promise.resolve(''))
    buildContextMock.mockClear()
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

  it('预算常量本身合理：端侧比云端更紧', () => {
    expect(ON_DEVICE_MEM_TOKEN_BUDGET).toBeLessThan(3000)
    expect(ON_DEVICE_HISTORY_TURNS).toBeLessThan(CLOUD_HISTORY_TURNS)
  })

  it('provider=ondevice：记忆预算收紧到 1000，历史只带最近 6 轮', async () => {
    setAiProvider('ondevice')
    seedHistory(30)
    chatMock.mockImplementation(async () => 'ok')
    render(<MobileChatView />)
    await send('在吗')

    await waitFor(() => {
      expect(getContextForChatMock).toHaveBeenCalledWith(ON_DEVICE_MEM_TOKEN_BUDGET, '在吗')
    })
    // apiMessages = [system, mem-ctx, commitment-ctx, ...history, user]
    // 有 memCtx/commitmentCtx 时 6 轮 → 总长 9
    await waitFor(() => {
      expect(chatMock).toHaveBeenCalled()
    })
    const apiMessages = chatMock.mock.calls[0]![0] as Array<{ role: string }>
    const historyMsgs = apiMessages.filter((m) => m.role === 'user' || m.role === 'assistant')
    expect(historyMsgs.length).toBeLessThanOrEqual(ON_DEVICE_HISTORY_TURNS + 1)
  })

  it('provider=非端侧（custom，本地无鉴权服务）：记忆预算保持 3000，历史放宽到 20 轮', async () => {
    setAiProvider('custom')
    seedHistory(30)
    chatMock.mockImplementation(async () => 'ok')
    render(<MobileChatView />)
    await send('在吗')

    await waitFor(() => {
      expect(getContextForChatMock).toHaveBeenCalledWith(3000, '在吗')
    })
    await waitFor(() => {
      expect(chatMock).toHaveBeenCalled()
    })
    const apiMessages = chatMock.mock.calls[0]![0] as Array<{ role: string }>
    const historyMsgs = apiMessages.filter((m) => m.role === 'user' || m.role === 'assistant')
    // 30 条历史 → 只取 20 轮 + 当前 1 条
    expect(historyMsgs.length).toBeGreaterThan(ON_DEVICE_HISTORY_TURNS + 1)
    expect(historyMsgs.length).toBeLessThanOrEqual(CLOUD_HISTORY_TURNS + 1)
  })
})
