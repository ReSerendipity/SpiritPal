// MobilePersonalityView smoke 测试 — 复用 PersonalityEditor 渲染
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { MobilePersonalityView } from './MobilePersonalityView'

describe('MobilePersonalityView', () => {
  beforeEach(() => {
    cleanup()
  })

  it('渲染性格编辑器核心区块', () => {
    render(<MobilePersonalityView />)
    expect(screen.getByText(/五维性格雷达图/i)).toBeInTheDocument()
    expect(screen.getByText(/说话风格/i)).toBeInTheDocument()
    expect(screen.getByText(/互动偏好/i)).toBeInTheDocument()
    expect(screen.getByText(/一键应用性格模板/i)).toBeInTheDocument()
  })
})
