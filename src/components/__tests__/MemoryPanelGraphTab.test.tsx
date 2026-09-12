/**
 * MemoryPanel「图谱」视图切换集成测试。
 * 点击「图谱」→ 渲染 EntityGraphView（测试替身）；切回「精简」→ 恢复列表。
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryPanel } from '@/components/MemoryPanel'

vi.mock('@/stores/petStore', () => ({
  usePetStore: (selector: (s: unknown) => unknown) => selector({ currentCharacterId: 'doro' }),
}))

vi.mock('@/lib/memory/ownerFacts', () => ({
  getOwnerFactsManager: () => ({
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getAllFacts: () => [],
  }),
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

vi.mock('@/lib/memory/memoryExporter', () => ({ exportMemories: vi.fn() }))

vi.mock('@/lib/data/batchOperationManager', () => ({
  createBatchManager: () => ({
    updateItems: vi.fn(),
    isSelected: () => false,
    toggleItem: vi.fn(),
    toggleSelectAll: vi.fn(),
    selectedIds: new Set(),
  }),
}))

vi.mock('@/components/MemoryVisualizer', () => ({
  default: () => <div data-testid="memory-visualizer">可视化视图</div>,
}))

vi.mock('@/components/memory/EntityGraphView', () => ({
  default: () => <div data-testid="entity-graph-view">图谱视图</div>,
}))

describe('MemoryPanel 图谱视图切换', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('切换条含「图谱」按钮', () => {
    render(<MemoryPanel />)
    expect(screen.getByText('图谱')).toBeTruthy()
  })

  it('点击「图谱」挂载 EntityGraphView，切回「精简」恢复', () => {
    render(<MemoryPanel />)
    expect(screen.queryByTestId('entity-graph-view')).toBeNull()

    fireEvent.click(screen.getByText('图谱'))
    expect(screen.getByTestId('entity-graph-view')).toBeTruthy()
    expect(screen.queryByText('导出记忆')).toBeNull()

    fireEvent.click(screen.getByText('精简'))
    expect(screen.queryByTestId('entity-graph-view')).toBeNull()
    expect(screen.getByText('导出记忆')).toBeTruthy()
  })
})
