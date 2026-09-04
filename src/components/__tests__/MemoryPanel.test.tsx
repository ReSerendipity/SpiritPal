/**
 * @file MemoryPanel.test.tsx
 * @description MemoryPanel 视图切换单测（A-4）
 *
 * 契约：
 *  1. 默认「精简」视图（保持旧行为零回归）：显示精简工具条与事实 Tab
 *  2. 点击「可视化」→ 渲染 MemoryVisualizer（测试替身），精简内容隐藏
 *  3. 切回「精简」→ 恢复精简内容
 */

import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryPanel } from '@/components/MemoryPanel'

vi.mock('@/stores/petStore', () => ({
  usePetStore: (selector: (s: unknown) => unknown) =>
    selector({ currentCharacterId: 'doro' }),
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

vi.mock('@/lib/memory/memoryExporter', () => ({
  exportMemories: vi.fn(),
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

vi.mock('@/components/MemoryVisualizer', () => ({
  default: () => <div data-testid="memory-visualizer">可视化视图</div>,
}))

describe('MemoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('默认渲染精简视图（零回归：工具条 + 事实 Tab 可见）', async () => {
    render(<MemoryPanel />)

    // 切换条存在
    expect(screen.getByText('精简')).toBeTruthy()
    expect(screen.getByText('可视化')).toBeTruthy()

    // 精简内容：导出工具条 + 事实 Tab
    expect(screen.getByText('导出记忆')).toBeTruthy()
    expect(screen.getByText('主人画像')).toBeTruthy()

    // 可视化视图默认不渲染
    expect(screen.queryByTestId('memory-visualizer')).toBeNull()
  })

  it('点击「可视化」挂载 MemoryVisualizer，切回「精简」恢复', () => {
    render(<MemoryPanel />)

    fireEvent.click(screen.getByText('可视化'))
    expect(screen.getByTestId('memory-visualizer')).toBeTruthy()
    expect(screen.queryByText('导出记忆')).toBeNull()

    fireEvent.click(screen.getByText('精简'))
    expect(screen.queryByTestId('memory-visualizer')).toBeNull()
    expect(screen.getByText('导出记忆')).toBeTruthy()
  })
})
