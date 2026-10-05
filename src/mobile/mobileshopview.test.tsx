// MobileShopView smoke 测试 — 商店分类/商品/操作渲染
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MobileShopView } from '@/mobile/MobileShopView'
import { usePetStore } from '@/stores/petStore'

// mock shopManager：固定目录避免真实商店依赖
vi.mock('@/lib/nurture/shopManager', () => ({
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

// ============ P2-9：分类可发现性 + 禁用原因 ============

describe('MobileShopView 分类与禁用态（P2-9）', () => {
  beforeEach(() => {
    cleanup()
  })

  it('七分类换行铺开（无横向滚动容器）', () => {
    const { container } = render(<MobileShopView />)
    // 7 个分类按钮全部渲染（flex-wrap 下不会被滚动裁剪）
    expect(container.textContent).toContain('食物')
    expect(container.textContent).toContain('玩具')
    expect(container.textContent).toContain('装饰')
    const wrap = screen.getByText('食物').parentElement
    expect(wrap?.className).toContain('flex-wrap')
    expect(wrap?.className).not.toContain('overflow-x-auto')
  })

  it('金币不足：购买禁用并显示还差多少（P2-9）', () => {
    // 把金币压到低于食物价格（10）制造不足场景
    usePetStore.setState({ sharedCoins: 4 })
    render(<MobileShopView />)
    const reason = screen.getByTestId('insufficient-reason')
    expect(reason.textContent).toBe('金币不足，还差 6')
    // 食物卡片内的购买按钮禁用（价格 10 > 金币 4）
    const buyBtn = screen.getByTestId('buy-food-1')
    expect(buyBtn.hasAttribute('disabled')).toBe(true)
  })
})
