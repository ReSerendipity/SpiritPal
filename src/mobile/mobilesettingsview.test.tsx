// MobileSettingsView smoke 测试（审计 P3-10 S1）
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
// 初始化 i18next（组件用 useTranslation，测试环境需显式引入）
import '@/lib/system/i18n'
import { MobileSettingsView } from '@/mobile/MobileSettingsView'
import { useSettingsStore } from '@/stores/settingsStore'

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

// ============ P2-11：高级设置面板 ============

describe('MobileSettingsView 高级设置（P2-11）', () => {
  it('主页有高级设置入口，进入后各控件可见', () => {
    render(<MobileSettingsView />)

    fireEvent.click(screen.getByRole('button', { name: /高级设置/ }))

    // 透明度滑块 / 边缘吸附 / 静默模式 / 四个能力开关
    expect(screen.getByTestId('pet-opacity-slider')).toBeInTheDocument()
    expect(screen.getByTestId('edge-snap-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('silent-mode-toggle')).toBeInTheDocument()
    expect(screen.getByTestId('cap-weatherEnabled')).toBeInTheDocument()
    expect(screen.getByTestId('cap-proactiveSpeakEnabled')).toBeInTheDocument()
    expect(screen.getByTestId('cap-emotionEnabled')).toBeInTheDocument()
    expect(screen.getByTestId('cap-contextAwarenessEnabled')).toBeInTheDocument()
    // 桌面专属区：禁用说明而非假控件
    expect(screen.getByText(/移动端固定为窗口内精灵模式/)).toBeInTheDocument()
    expect(screen.getByText(/请在系统设置的电池\/自启动管理中配置/)).toBeInTheDocument()
  })

  it('切换 AI 能力开关会写回 settingsStore', () => {
    render(<MobileSettingsView />)
    fireEvent.click(screen.getByRole('button', { name: /高级设置/ }))

    const before = useSettingsStore.getState().weatherEnabled
    fireEvent.click(screen.getByTestId('cap-weatherEnabled'))
    expect(useSettingsStore.getState().weatherEnabled).toBe(!before)
  })
})
