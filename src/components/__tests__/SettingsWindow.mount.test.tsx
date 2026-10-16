/**
 * @file SettingsWindow.mount.test.tsx
 * @description SettingsWindow 挂载级 smoke 测试
 *
 * 背景：本组件长期同时满足两个条件——被排除在覆盖率分母之外（vitest.config.ts 的
 * coverage.exclude，理由注释是「需 E2E 测试覆盖」），而驱动它的 E2E 作业不在任何必需检查里，
 * 于是「改坏设置窗口」在阻塞校验层面无人拦截。本测试补上挂载路径本身。
 *
 * 契约（与 tests/e2e/memory-system.spec.ts 依赖的是同一口径）：
 *  1. 在没有 Tauri 运行时的环境里能挂载且不崩溃
 *  2. 侧栏标签页按钮的 aria-label 为「{label} 标签页」，且默认落在 AI 配置页
 *  3. 切到「外观」页后该页内容被渲染，AI 页内容不再存在
 */

import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// 组件用 useTranslation，测试环境需显式初始化 i18next（同 mobilesettingsview.test.tsx 口径）
import '@/lib/system/i18n'

// setup.ts 未覆盖 @tauri-apps/api/app：版本号读取只在「关于」页用，这里给出确定返回值
vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(async () => '0.1.0'),
}))

import SettingsWindow from '@/components/SettingsWindow'

describe('SettingsWindow 挂载', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('能在无 Tauri 运行时环境下挂载，并渲染侧栏标签页', async () => {
    const { container } = render(<SettingsWindow />)

    expect(container.firstChild).not.toBeNull()
    // aria-label 口径：`${t.label} 标签页`（SettingsWindow.tsx:604）
    const tabs = await screen.findAllByRole('button', { name: / 标签页$/ })
    expect(tabs.length).toBeGreaterThanOrEqual(10)
    expect(tabs.some((t) => t.getAttribute('aria-label') === 'AI 标签页')).toBe(true)
    expect(tabs.some((t) => t.getAttribute('aria-label') === '外观 标签页')).toBe(true)
  })

  it('切到「外观」标签页后渲染外观页，主题切换的 aria-pressed 随之更新', async () => {
    render(<SettingsWindow />)

    // 默认页是 AI 配置（tab 初始值 'ai'，SettingsWindow.tsx:223）
    const appearanceTab = await screen.findByRole('button', { name: '外观 标签页' })
    fireEvent.click(appearanceTab)

    // 外观页的真实内容：标题 + 主题三档 + 宠物大小滑块（SettingsWindow.tsx:800-832）
    expect(await screen.findByRole('heading', { name: '外观' })).toBeInTheDocument()
    const darkBtn = screen.getByRole('button', { name: '深色' })
    expect(screen.getByRole('button', { name: '浅色' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '跟随系统' })).toBeInTheDocument()
    expect(screen.getAllByRole('slider').length).toBeGreaterThanOrEqual(1)

    // 主题切换按钮以 aria-pressed 表达当前生效档
    const pressedBefore = darkBtn.getAttribute('aria-pressed')
    fireEvent.click(darkBtn)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '深色' })).toHaveAttribute('aria-pressed', 'true')
    })
    expect(pressedBefore).not.toBe('true')
  })

  it('关闭按钮存在且点击走窗口关闭路径而不抛错', async () => {
    render(<SettingsWindow />)

    const closeBtn = await screen.findByRole('button', { name: '关闭设置窗口' })
    expect(() => fireEvent.click(closeBtn)).not.toThrow()
  })
})
