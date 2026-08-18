// MobileApp smoke 测试（审计 P3-10 S1：解除 src/mobile exclude 后的基础覆盖）
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MobileApp from './MobileApp'

// 子视图 mock：smoke 只验证 MobileApp 的导航外壳
vi.mock('./MobilePetView', () => ({
  MobilePetView: () => <div data-testid="mobile-pet-view" />,
}))
vi.mock('./MobileChatView', () => ({
  MobileChatView: () => <div data-testid="mobile-chat-view" />,
}))
vi.mock('./MobileNurturingView', () => ({
  MobileNurturingView: () => <div data-testid="mobile-nurturing-view" />,
}))
vi.mock('./MobileSettingsView', () => ({
  MobileSettingsView: () => <div data-testid="mobile-settings-view" />,
}))

describe('MobileApp', () => {
  it('默认渲染宠物视图', () => {
    render(<MobileApp />)
    expect(screen.getByTestId('mobile-pet-view')).toBeInTheDocument()
  })

  it('底部导航切换标签页', () => {
    render(<MobileApp />)

    // 切换到聊天
    fireEvent.click(screen.getByRole('button', { name: /聊天/i }))
    expect(screen.getByTestId('mobile-chat-view')).toBeInTheDocument()

    // 切换到设置
    fireEvent.click(screen.getByRole('button', { name: /设置/i }))
    expect(screen.getByTestId('mobile-settings-view')).toBeInTheDocument()
  })
})
