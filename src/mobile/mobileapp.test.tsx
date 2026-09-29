// MobileApp smoke 测试（审计 P3-10 S1：解除 src/mobile exclude 后的基础覆盖）
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { agreementAccepted, markAgreementAccepted } from '@/components/AgreementGate'
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
  // 外壳相关用例需要先跨过合规门槛（否则渲染的是 AgreementGate）
  beforeEach(() => {
    localStorage.clear()
    markAgreementAccepted()
  })

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

  it('未同意协议时先渲染合规门槛，且不渲染任何业务界面', () => {
    localStorage.clear()
    expect(agreementAccepted()).toBe(false)

    render(<MobileApp />)

    expect(screen.getByText('使用前须知')).toBeInTheDocument()
    expect(screen.queryByTestId('mobile-pet-view')).not.toBeInTheDocument()
    // 未勾选时按钮禁用
    expect(screen.getByRole('button', { name: /同意并开始/i })).toBeDisabled()
  })

  it('勾选并同意后进入业务界面，且同意状态被持久化', () => {
    localStorage.clear()
    render(<MobileApp />)

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: /同意并开始/i }))

    expect(screen.getByTestId('mobile-pet-view')).toBeInTheDocument()
    expect(agreementAccepted()).toBe(true)
  })
})
