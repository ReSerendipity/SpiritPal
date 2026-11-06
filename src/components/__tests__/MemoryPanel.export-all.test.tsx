/**
 * @file MemoryPanel.export-all.test.tsx
 * @description TD-010a：记忆面板「全部角色」导出开关
 *
 * 契约：
 *  1. 默认（未勾选）导出只带当前角色，不碰全部角色分支
 *  2. 勾选「全部角色」后传 `characterId: undefined`，由导出器枚举有记忆的角色
 *  3. 取消勾选后回到当前角色（开关是双向的，不是一次性）
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryPanel } from '@/components/MemoryPanel'

const mockExport = vi.fn()

vi.mock('@/stores/petStore', () => ({
  usePetStore: (selector: (s: unknown) => unknown) => selector({ currentCharacterId: 'doro' }),
}))

vi.mock('@/lib/memory/ownerFacts', () => ({
  getOwnerFactsManager: () => ({
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getAllFacts: () => [],
  }),
  factKeyLabel: (k: string) => k,
}))

vi.mock('@/lib/nurture/petExperience', () => ({
  getPetExperienceManager: () => ({
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getRecent: () => [],
  }),
}))

vi.mock('@/lib/nurture/diarySystem', () => ({
  getDiarySystemManager: () => ({ getRecentDiaries: () => [] }),
}))

vi.mock('@/lib/memory/memoryExporter', () => ({
  exportMemories: (...args: unknown[]) => mockExport(...args),
}))

vi.mock('@/lib/data/batchOperationManager', () => ({
  createBatchManager: () => ({
    updateItems: vi.fn(),
    isSelected: () => false,
    toggleItem: vi.fn(),
    toggleSelectAll: vi.fn(),
    selectedIds: new Set(),
  }),
}))

vi.mock('@/components/memory/EnhancedMemoryList', () => ({
  EnhancedMemoryList: () => <div />,
}))

vi.mock('@/components/memory/EntityGraphView', () => ({ default: () => <div /> }))
vi.mock('@/components/MemoryVisualizer', () => ({ default: () => <div /> }))

describe('MemoryPanel 全部角色导出（TD-010a）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExport.mockResolvedValue({
      filename: 'x.json',
      content: '{}',
      fileSize: 2,
      memoryCount: 0,
      exportedAt: 1,
    })
  })

  it('默认导出当前角色', async () => {
    render(<MemoryPanel />)
    fireEvent.click(screen.getByText('JSON'))

    await waitFor(() => expect(mockExport).toHaveBeenCalledTimes(1))
    expect(mockExport).toHaveBeenCalledWith({ format: 'json', characterId: 'doro' })
  })

  it('勾选「全部角色」后传 undefined，取消后回到当前角色', async () => {
    render(<MemoryPanel />)
    const checkbox = screen.getByLabelText('导出所有有记忆的角色') as HTMLInputElement
    expect(checkbox.checked).toBe(false)

    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(true)

    fireEvent.click(screen.getByText('CSV'))
    await waitFor(() => expect(mockExport).toHaveBeenCalledTimes(1))
    expect(mockExport).toHaveBeenCalledWith({ format: 'csv', characterId: undefined })

    fireEvent.click(checkbox)
    expect(checkbox.checked).toBe(false)

    fireEvent.click(screen.getByText('MD'))
    await waitFor(() => expect(mockExport).toHaveBeenCalledTimes(2))
    expect(mockExport).toHaveBeenLastCalledWith({ format: 'markdown', characterId: 'doro' })
  })
})
