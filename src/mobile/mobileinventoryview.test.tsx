// MobileInventoryView smoke 测试 — 空背包状态
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MobileInventoryView } from './MobileInventoryView'

describe('MobileInventoryView', () => {
  beforeEach(() => {
    cleanup()
  })

  it('空背包显示空状态引导', () => {
    render(<MobileInventoryView />)
    expect(screen.getByText('背包是空的')).toBeInTheDocument()
    expect(screen.getByText(/去商店购买物品吧/)).toBeInTheDocument()
  })
})
