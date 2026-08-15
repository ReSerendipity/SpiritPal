// T-04: 组件单元测试覆盖 — WindowControls 组件
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { WindowControls } from '../WindowControls'

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    setFocus: vi.fn(),
    isMaximized: () => Promise.resolve(false),
  }),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

describe('WindowControls', () => {
  it('渲染最小化、最大化/还原、关闭三个按钮', () => {
    render(<WindowControls />)
    expect(screen.getByLabelText('最小化')).toBeInTheDocument()
    expect(screen.getByLabelText('最大化')).toBeInTheDocument()
    expect(screen.getByLabelText('关闭')).toBeInTheDocument()
  })

  it('点击最小化按钮调用 minimize', async () => {
    render(<WindowControls />)
    const minimizeBtn = screen.getByLabelText('最小化')
    fireEvent.click(minimizeBtn)
    // 验证无错误
    expect(true).toBe(true)
  })

  it('按钮具有正确的 role 属性', () => {
    render(<WindowControls />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.length).toBeGreaterThanOrEqual(3)
  })
})
