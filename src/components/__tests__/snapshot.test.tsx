// T-21: 快照测试 — 对稳定组件做回归保护
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { PetBubble } from '../PetBubble'

// 依赖的 mock 与现有测试一致
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => p),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

describe('T-21: 组件快照测试', () => {
  it('PetBubble 渲染快照', () => {
    const { container } = render(
      <PetBubble message="测试消息" onClose={() => {}} />
    )
    expect(container.firstChild).toMatchSnapshot()
  })

  it('PetBubble 空消息快照', () => {
    const { container } = render(
      <PetBubble message="" onClose={() => {}} />
    )
    expect(container.firstChild).toMatchSnapshot()
  })
})
