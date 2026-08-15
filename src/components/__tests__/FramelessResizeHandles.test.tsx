// T-04: 组件单元测试覆盖 — FramelessResizeHandles 组件
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { FramelessResizeHandles } from '../FramelessChrome'

// Mock Tauri window
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn(),
    startResizeDragging: vi.fn(),
    setSize: vi.fn(),
    setFocus: vi.fn(),
    innerPosition: () => Promise.resolve({ x: 0, y: 0 }),
    outerPosition: () => Promise.resolve({ x: 0, y: 0 }),
    setOuterPosition: vi.fn(),
    outerSize: () => Promise.resolve({ width: 720, height: 540 }),
    innerSize: () => Promise.resolve({ width: 720, height: 540 }),
  }),
}))

describe('FramelessResizeHandles', () => {
  it('渲染所有 8 个方向调整手柄', () => {
    const { container } = render(<FramelessResizeHandles />)
    const handles = container.querySelectorAll('.spiritpal-resize-handle')
    expect(handles.length).toBe(8)
  })

  it('容器具有 aria-hidden 属性', () => {
    const { container } = render(<FramelessResizeHandles />)
    const wrapper = container.querySelector('[aria-hidden="true"]')
    expect(wrapper).not.toBeNull()
  })
})
