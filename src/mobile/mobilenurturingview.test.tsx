// MobileNurturingView smoke 测试（审计 P3-10 S1）
import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MobileNurturingView } from '@/mobile/MobileNurturingView'

// items 模块依赖角色数据，mock 成固定商店数据
vi.mock('@/lib/nurture/items', () => ({
  getAllShopItems: vi.fn(() => [
    { id: 'food-1', name: '测试食物', type: 'food', price: 10, rarity: 'common' as const },
    { id: 'deco-1', name: '测试装饰', type: 'decoration', price: 20, rarity: 'rare' as const },
  ]),
  getFoodsForCharacter: vi.fn(() => [{ id: 'food-1', name: '测试食物' }]),
  getRarityName: vi.fn((r: string) => r),
}))

describe('MobileNurturingView', () => {
  it('渲染商店/背包区域不崩溃', () => {
    render(<MobileNurturingView />)
    expect(document.body).toBeTruthy()
  })
})
