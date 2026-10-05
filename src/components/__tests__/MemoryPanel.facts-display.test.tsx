// P2-7：主人画像去调试文本——中文标签 / 差异化置信度 / 来源标识
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryPanel } from '@/components/MemoryPanel'
import { factKeyLabel } from '@/lib/memory/ownerFacts'

// 展示侧用受控 fake 管理器；factKeyLabel 用真实实现（importOriginal 展开）
vi.mock('@/lib/memory/ownerFacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/memory/ownerFacts')>()
  const fakeMgr = {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getAllFacts: () => [
      {
        id: 'f1',
        key: 'name',
        value: '小林',
        confidence: 0.9,
        userProvided: false,
        updatedAt: Date.now(),
      },
      {
        id: 'f2',
        key: 'job',
        value: '工程师',
        confidence: 0.8,
        userProvided: true,
        updatedAt: Date.now(),
      },
    ],
    upsertFact: vi.fn().mockResolvedValue(undefined),
    deleteFact: vi.fn().mockResolvedValue(undefined),
  }
  return { ...actual, getOwnerFactsManager: () => fakeMgr }
})

vi.mock('@/stores/petStore', () => ({
  usePetStore: (selector: (s: unknown) => unknown) => selector({ currentCharacterId: 'doro' }),
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

describe('主人画像显示（P2-7）', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('factKeyLabel：已知 key 翻译为中文，未知 key 原样返回', () => {
    expect(factKeyLabel('name')).toBe('名字')
    expect(factKeyLabel('location')).toBe('所在地')
    expect(factKeyLabel('custom_thing')).toBe('custom_thing')
  })

  it('画像卡片显示中文标签与来源标识（手动/自动抽取），不再裸露英文 key', async () => {
    render(<MemoryPanel />)
    fireEvent.click(screen.getByText('主人画像'))

    await vi.waitFor(() => {
      expect(screen.getByText('小林')).toBeInTheDocument()
    })
    expect(screen.getByText('名字')).toBeInTheDocument()
    expect(screen.getByText('职业')).toBeInTheDocument()
    expect(screen.getByText('自动抽取')).toBeInTheDocument()
    expect(screen.getByText('手动')).toBeInTheDocument()
    expect(screen.getByText('置信度 90%')).toBeInTheDocument()
    expect(screen.getByText('置信度 80%')).toBeInTheDocument()
    // 英文 key 只允许出现在 title 提示里，不作为可见文本
    const visible = document.body.textContent ?? ''
    expect(visible).not.toMatch(/name(?![a-z])/)
  })
})
