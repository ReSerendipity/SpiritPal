import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { EnhancedMemoryList } from '@/components/memory/EnhancedMemoryList'
import { ConfirmDialogProvider } from '@/components/ui/ConfirmDialog'
import type { EnhancedMemory } from '@/lib/memory/enhancedMemory'

const { searchMemoriesMock, deleteMemoryMock } = vi.hoisted(() => ({
  searchMemoriesMock: vi.fn(),
  deleteMemoryMock: vi.fn(),
}))

vi.mock('@/lib/memory/enhancedMemory', () => ({
  getEnhancedMemoryManager: () => ({
    ensureLoaded: vi.fn(async () => {}),
    getAllMemories: vi.fn(() => []),
  }),
}))

vi.mock('@/lib/memory/memoryEditor', () => ({
  createMemoryEditor: () => ({
    searchMemories: searchMemoriesMock,
    deleteMemory: deleteMemoryMock,
    updateMemory: vi.fn(),
  }),
  sanitizeMemoryForDisplay: (memory: unknown) => memory,
}))

vi.mock('@/components/memory/MemoryFilterBar', () => ({
  MemoryFilterBar: () => <div data-testid="memory-filter-bar" />,
}))

vi.mock('@/components/memory/MemoryEditModal', () => ({
  MemoryEditModal: () => null,
}))

vi.mock('@/stores/petStore', () => ({
  usePetStore: (selector: (state: { currentCharacterId: string }) => unknown) =>
    selector({ currentCharacterId: 'doro' }),
}))

const memory: EnhancedMemory = {
  id: 'mem-delete-1',
  user: '喜欢爬山',
  assistant: '记住啦',
  created_at: new Date().toISOString(),
  importance: 50,
  emotionalIntensity: 0.5,
  category: '日常',
  tags: ['爬山'],
  accessCount: 0,
  lastAccessed: Date.now(),
  decayFactor: 1,
  isAutobiographical: false,
}

describe('EnhancedMemoryList 删除确认', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    searchMemoriesMock.mockResolvedValue({ success: true, details: { memories: [memory] } })
    deleteMemoryMock.mockResolvedValue({ success: true })
    // 若实现回退到系统确认框，此桩会直接放行，从而让“弹窗缺失”断言失败
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('点击删除打开应用内弹窗，确认后调用删除', async () => {
    render(
      <ConfirmDialogProvider>
        <EnhancedMemoryList />
      </ConfirmDialogProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '删除记忆' }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveTextContent('删除这条记忆？')
    expect(dialog).toHaveTextContent('此操作不可恢复。')
    expect(dialog).toHaveTextContent('喜欢爬山')
    // 不应再走系统 confirm（其按钮文案无法本地化）
    expect(window.confirm).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    await waitFor(() => expect(deleteMemoryMock).toHaveBeenCalledWith('mem-delete-1'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    // 删除成功后应重新搜索并刷新列表
    await waitFor(() => expect(searchMemoriesMock).toHaveBeenCalledTimes(2))
  })

  it('取消时关闭弹窗且不删除', async () => {
    render(
      <ConfirmDialogProvider>
        <EnhancedMemoryList />
      </ConfirmDialogProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: '删除记忆' }))
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(deleteMemoryMock).not.toHaveBeenCalled()
  })
})
