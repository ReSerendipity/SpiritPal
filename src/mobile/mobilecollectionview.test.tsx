// MobileCollectionView smoke 测试 — 收藏套件渲染
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MobileCollectionView } from '@/mobile/MobileCollectionView'

// mock collectionManager：固定收藏套件，避免真实持久化依赖
vi.mock('@/lib/data/collectionManager', () => ({
  getCollectionManager: vi.fn(() => ({
    deserialize: vi.fn(),
    collectItem: vi.fn(),
    equipItem: vi.fn(),
    unequipItem: vi.fn(),
    claimReward: vi.fn(() => true),
  })),
  DEFAULT_COLLECTION_SETS: [
    {
      id: 'set-stars',
      name: '星光收藏',
      description: '收集星星物品',
      icon: '⭐',
      itemIds: ['col-star-1', 'col-star-2'],
      bonusRewards: { coins: 20 },
      fvReward: 0,
    },
  ],
}))

describe('MobileCollectionView', () => {
  beforeEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('渲染收藏套件与总进度', () => {
    render(<MobileCollectionView />)
    expect(screen.getByText('星光收藏')).toBeInTheDocument()
    expect(screen.getByText('收藏总进度')).toBeInTheDocument()
    // 套件百分比 + 总进度均为 0%
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0)
  })
})
