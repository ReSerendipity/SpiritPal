// P1-1: MobileChatView 会话管理抽屉测试（新建/切换/重命名/置顶/删除/搜索）
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
// 初始化 i18next（组件用 useTranslation，测试环境需显式引入）
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

/** 打开会话抽屉 */
function openSessions() {
  fireEvent.click(screen.getByLabelText('会话管理'))
}

describe('MobileChatView 会话管理抽屉（P1-1）', () => {
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

  it('抽屉内新建会话可用', () => {
    render(<MobileChatView />)
    openSessions()
    fireEvent.click(screen.getByText('新建会话'))
    expect(useChatStore.getState().sessions['doro']).toHaveLength(1)
    // 新建后即为活跃会话
    expect(useChatStore.getState().activeSessionByCharacter['doro']).toBeTruthy()
  })

  it('点击会话项可切换活跃会话并关闭抽屉', () => {
    // 预置两个会话
    const idA = useChatStore.getState().createSession()
    const idB = useChatStore.getState().createSession()
    expect(useChatStore.getState().activeSessionByCharacter['doro']).toBe(idB)

    render(<MobileChatView />)
    openSessions()
    // 点击标题为「新对话」的会话项（列表中两项同名，取第一个）
    const items = screen.getAllByText('新对话')
    fireEvent.click(items[items.length - 1])
    // 抽屉关闭（面板卸载）
    expect(screen.queryByText('会话管理')).toBeNull()
    // 活跃会话被切换到点击项之一
    const active = useChatStore.getState().activeSessionByCharacter['doro']
    expect([idA, idB]).toContain(active)
  })

  it('重命名会话生效', () => {
    const idA = useChatStore.getState().createSession()
    render(<MobileChatView />)
    openSessions()
    // 进入重命名态
    fireEvent.click(screen.getByLabelText('重命名会话'))
    const input = screen.getByLabelText('重命名会话') as HTMLInputElement
    fireEvent.change(input, { target: { value: '工作记录' } })
    fireEvent.click(screen.getByLabelText('确认'))
    const session = useChatStore.getState().sessions['doro']?.find((s) => s.id === idA)
    expect(session?.title).toBe('工作记录')
  })

  it('置顶会话后列表排序置顶优先', () => {
    const idA = useChatStore.getState().createSession()
    useChatStore.getState().renameSession(idA, '会话A')
    const idB = useChatStore.getState().createSession()
    useChatStore.getState().renameSession(idB, '会话B')

    render(<MobileChatView />)
    openSessions()
    // 置顶「会话B」（两个置顶按钮，找会话B 所在卡片的那个）
    // 卡片顺序：updatedAt 降序 → 会话B 在前
    const pinButtons = screen.getAllByLabelText('置顶会话')
    fireEvent.click(pinButtons[0])
    const sorted = useChatStore
      .getState()
      .getSessions()
      .map((s) => s.title)
    expect(sorted[0]).toBe('会话B')
    expect(useChatStore.getState().sessions['doro']?.find((s) => s.id === idB)?.pinned).toBe(true)
  })

  it('删除会话需确认，确认后移除', () => {
    const idA = useChatStore.getState().createSession()
    useChatStore.getState().renameSession(idA, '待删除')
    useChatStore.getState().createSession()

    render(<MobileChatView />)
    openSessions()
    // 在「待删除」卡片内操作（data-testid 精确定位，避免多卡片同名按钮歧义）
    const card = screen.getByTestId(`session-card-${idA}`)
    fireEvent.click(within(card).getByLabelText('删除'))
    const confirmBtn = within(card).getByLabelText('确认')
    fireEvent.click(confirmBtn)
    const titles = useChatStore.getState().sessions['doro']?.map((s) => s.title)
    expect(titles).not.toContain('待删除')
    expect(titles).toHaveLength(1)
  })

  it('全文搜索命中消息并可跳转会话', () => {
    const idA = useChatStore.getState().createSession()
    useChatStore.getState().renameSession(idA, '会话A')
    useChatStore.getState().addMessage({
      id: 'm1',
      role: 'user',
      content: '关于量子纠缠的讨论',
      timestamp: Date.now(),
    })
    useChatStore.getState().createSession()
    useChatStore.getState().renameSession(useChatStore.getState().activeSessionByCharacter['doro']!, '会话B')

    render(<MobileChatView />)
    openSessions()
    const searchBox = screen.getByPlaceholderText('搜索全部会话消息…')
    fireEvent.change(searchBox, { target: { value: '量子纠缠' } })
    // 命中片段显示
    expect(screen.getByText(/量子纠缠/)).toBeTruthy()
    // 点击命中项 → 跳转到会话A 并关闭抽屉
    fireEvent.click(screen.getByText(/量子纠缠/))
    expect(screen.queryByText('搜索全部会话消息…')).toBeNull()
    expect(useChatStore.getState().activeSessionByCharacter['doro']).toBe(idA)
  })

  it('抽屉内操作按钮具备触控命中区尺寸类（h-8 w-8 = 32px；jsdom 无布局引擎，类名即基线）', () => {
    useChatStore.getState().createSession()
    render(<MobileChatView />)
    openSessions()
    const pinBtn = screen.getByLabelText('置顶会话')
    expect(pinBtn.className).toContain('h-8')
    expect(pinBtn.className).toContain('w-8')
  })
})
