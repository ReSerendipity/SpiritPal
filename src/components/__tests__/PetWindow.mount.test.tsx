/**
 * @file PetWindow.mount.test.tsx
 * @description PetWindow 挂载级 smoke 测试
 *
 * 背景：与 SettingsWindow 同一缺口——本组件被排除在覆盖率分母之外（vitest.config.ts 的
 * coverage.exclude，理由注释是「需 E2E 测试覆盖」），而驱动它的 E2E 作业不在任何必需检查里。
 * 本窗口是桌宠主界面，30 天窗口内改动最重的文件之一，故补两条真实路径：协议门与主界面根节点。
 *
 * 契约：
 *  1. 首启且未接受协议时停在协议门；未勾选「我已阅读并同意」前「同意并开始」禁用，
 *     勾选后可点击，点击后同意状态被持久化且协议门消失（合规入口，不能点一下就跳过）
 *  2. 已接受协议且非首启时渲染主界面根节点 `role="application"` + `aria-label="宠物窗口"`，
 *     无边框窗口拖拽层（data-tauri-drag-region）随之存在
 */

import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

import '@/lib/system/i18n'

// Live2D / 精灵渲染层依赖 WebGL 与 canvas，jsdom 不实现 getContext()：
// 用占位替身保留组件树，本测试只覆盖窗口装配与协议门，不测绘制内部。
// 两个渲染器在 PetWindow.tsx:32/38 以命名导出引入，替身须同时给出命名与默认导出。
vi.mock('@/components/Live2DRenderer', () => {
  const Stub = () => <div data-testid="live2d-renderer" />
  return { Live2DRenderer: Stub, default: Stub }
})
vi.mock('@/components/SpriteRenderer', () => {
  const Stub = () => <div data-testid="sprite-renderer" />
  return { SpriteRenderer: Stub, default: Stub }
})
vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(async () => '0.1.0'),
}))

import PetWindow from '@/components/PetWindow'
import { agreementAccepted } from '@/components/AgreementGate'

describe('PetWindow 挂载', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it('首启未接受协议时停在协议门，勾选前后同意按钮由禁用变可用并持久化同意', async () => {
    render(<PetWindow />)

    const checkbox = await screen.findByRole('checkbox', { name: /我已阅读并同意/ })
    const acceptBtn = screen.getByRole('button', { name: '同意并开始' })

    // 未勾选不得进入（合规要求显式同意）
    expect(acceptBtn).toBeDisabled()
    expect(agreementAccepted()).toBe(false)

    fireEvent.click(checkbox)
    await waitFor(() => expect(acceptBtn).toBeEnabled())

    fireEvent.click(acceptBtn)

    expect(agreementAccepted()).toBe(true)
    // 协议门消失，首启流程推进且不崩溃
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '同意并开始' })).not.toBeInTheDocument()
    })
    expect(document.body.firstChild).not.toBeNull()
  })

  it('已接受协议且非首启时渲染宠物窗口主界面根节点与拖拽层', async () => {
    localStorage.setItem('spiritpal:agreement:v1', '2026-09-15')
    localStorage.setItem('spiritpal-first-run-done', '1')

    render(<PetWindow />)

    const root = await screen.findByRole('application', { name: '宠物窗口' })
    expect(root).toBeInTheDocument()
    expect(root.querySelector('[data-tauri-drag-region]')).not.toBeNull()
    expect(screen.queryByRole('checkbox', { name: /我已阅读并同意/ })).not.toBeInTheDocument()
  })
})
