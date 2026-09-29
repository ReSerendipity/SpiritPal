// MobileSettingsView smoke 测试（审计 P3-10 S1）
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
// 初始化 i18next（组件用 useTranslation，测试环境需显式引入）
import '@/lib/system/i18n'
import { MobileSettingsView } from '@/mobile/MobileSettingsView'

// settingsStore 依赖 characters 的 getDefaultCharacter，mock 需完整
vi.mock('@/lib/data/characters', () => ({
  getAllCharacters: vi.fn(() => [{ id: 'doro', name: '多萝', spriteAsset: '' }]),
  getCharacter: vi.fn(() => null),
  getDefaultCharacter: vi.fn(() => ({ id: 'doro', name: '多萝', spriteAsset: '' })),
}))

describe('MobileSettingsView', () => {
  it('渲染设置项列表不崩溃', () => {
    render(<MobileSettingsView />)
    expect(document.body).toBeTruthy()
  })

  it('关于页提供隐私政策 / 用户协议入口，可打开并关闭文档', () => {
    render(<MobileSettingsView />)

    // 主界面 → 关于
    fireEvent.click(screen.getByRole('button', { name: /关于/ }))
    expect(screen.getByText('法律信息')).toBeInTheDocument()

    // 打开隐私政策
    fireEvent.click(screen.getByRole('button', { name: '隐私政策' }))
    expect(screen.getByRole('heading', { name: '隐私政策' })).toBeInTheDocument()

    // 关闭
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(screen.queryByRole('heading', { name: '隐私政策' })).not.toBeInTheDocument()

    // 打开用户协议
    fireEvent.click(screen.getByRole('button', { name: '用户协议' }))
    expect(screen.getByRole('heading', { name: '用户协议' })).toBeInTheDocument()
  })
})
