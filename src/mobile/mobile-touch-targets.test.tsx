// P2-1：触控命中区 ≥48dp——同意框/发送/清空/主题切换/会话入口
// jsdom 无布局引擎，无法量像素；此处在类名层面锁定实现约定：
//  - 发送/停止：h-12 w-12（=48px）
//  - 清空/会话入口/主题切换：after:-inset-2 伪元素把命中区扩到 ≥48px
//  - 同意框：整行 label min-h-[48px]
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgreementGate, markAgreementAccepted } from '@/components/AgreementGate'
import MobileApp from '@/mobile/MobileApp'
import { MobileChatView } from '@/mobile/MobileChatView'

vi.mock('@/mobile/MobilePetView', () => ({ MobilePetView: () => <div data-testid="mobile-pet-view" /> }))
vi.mock('@/mobile/MobileNurturingView', () => ({ MobileNurturingView: () => <div /> }))
vi.mock('@/mobile/MobileSettingsView', () => ({ MobileSettingsView: () => <div /> }))
vi.mock('@/mobile/MobileMemoryView', () => ({ MobileMemoryView: () => <div /> }))

function classesOf(el: Element): string[] {
  return Array.from(el.classList)
}

describe('触控命中区 ≥48dp（P2-1）', () => {
  beforeEach(() => {
    localStorage.clear()
    markAgreementAccepted()
  })

  it('同意框：整行 label 命中区 ≥48px（min-h-[48px]），勾选框放大', () => {
    render(<AgreementGate onAccept={() => {}} />)
    const label = screen.getByText(/我已阅读并同意/).closest('label')
    expect(label).not.toBeNull()
    expect(classesOf(label!)).toContain('min-h-[48px]')
    const checkbox = screen.getByRole('checkbox')
    expect(classesOf(checkbox)).toContain('h-5')
    expect(classesOf(checkbox)).toContain('w-5')
  })

  it('发送按钮：h-12 w-12（48px）', () => {
    render(<MobileChatView />)
    const send = screen.getByLabelText('发送')
    const cls = classesOf(send)
    expect(cls).toContain('h-12')
    expect(cls).toContain('w-12')
  })

  it('清空与会话入口：after:-inset-2 扩展命中区', () => {
    render(<MobileChatView />)
    expect(classesOf(screen.getByLabelText('会话管理')).some((c) => c.startsWith('after:-inset-2'))).toBe(true)
    const clear = screen.getByText('清空').closest('button')
    expect(clear).not.toBeNull()
    expect(classesOf(clear!).some((c) => c.startsWith('after:-inset-2'))).toBe(true)
  })

  it('主题切换：after:-inset-2 扩展命中区，点击仍生效', () => {
    render(<MobileApp />)
    const toggle = screen.getByLabelText(/主题/)
    expect(classesOf(toggle).some((c) => c.startsWith('after:-inset-2'))).toBe(true)
    expect(() => fireEvent.click(toggle)).not.toThrow()
  })
})
