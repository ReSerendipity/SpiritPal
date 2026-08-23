// MobileShopView smoke 测试 — 商店分类/商品/操作渲染
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { MobileShopView } from './MobileShopView'

// mock shopManager：固定目录避免真实商店依赖
vi.mock('../lib/shopManager', () => ({
  ShopLockState: { NONE: 0, FVLOCK: 1, PETLIMIT: 2 },
  getShopManager: vi.fn(() => ({
    getCatalog: vi.fn(() => [
      { item: { id: 'food-1', type: 'food', name: '测试食物', icon: '🍎', price: 10, description: '补充饱食' }, lockState: 0, sellPrice: 5, owned: 0 },
      { item: { id: 'toy-1', type: 'toy', name: '测试玩具', icon: '🧸', price: 20, description: '玩耍' }, lockState: 0, sellPrice: 10, owned: 1 },
    ]),
    buyItem: vi.fn(() => true),
    sellItem: vi.fn(() => true),
    getLockState: vi.fn(() => 0),
  })),
}))

describe('MobileShopView', () => {
  beforeEach(() => {
    cleanup()
  })

  it('渲染七分类 Tab 与默认食物分类商品', () => {
    render(<MobileShopView />)
    expect(screen.getByText('食物')).toBeInTheDocument()
    expect(screen.getByText('玩具')).toBeInTheDocument()
    expect(screen.getByText('装饰')).toBeInTheDocument()
    // 默认 food 分类 → 只显示食物
    expect(screen.getByText('测试食物')).toBeInTheDocument()
  })

  it('切换分类过滤商品', () => {
    render(<MobileShopView />)
    fireEvent.click(screen.getByText('玩具'))
    expect(screen.getByText('测试玩具')).toBeInTheDocument()
    expect(screen.queryByText('测试食物')).not.toBeInTheDocument()
  })
})
