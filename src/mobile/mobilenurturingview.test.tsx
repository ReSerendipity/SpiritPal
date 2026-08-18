// MobileNurturingView smoke 测试（审计 P3-10 S1）
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MobileNurturingView } from './MobileNurturingView'

// items 模块依赖角色数据，mock 成固定商店数据
vi.mock('../lib/items', () => ({
  getAllShopItems: vi.fn(() => [
    { id: 'food-1', name: '测试食物', type: 'food', price: 10, rarity: 'common' as const },
    { id: 'deco-1', name: '测试装饰', type: 'decoration', price: 20, rarity: 'rare' as const },
  ]),
  getFoodsForCharacter: vi.fn(() => [{ id: 'food-1', name: '测试食物' }]),
  getRarityName: vi.fn((r: string) => r),
}))

describe('MobileNurturingView', () => {
  it('渲染商店/背包区域不崩溃', () => {
    render(<MobileNurturingView isDark={false} />)
    expect(document.body).toBeTruthy()
  })

  it('深色模式下可渲染', () => {
    render(<MobileNurturingView isDark={true} />)
    expect(document.body).toBeTruthy()
  })
})
