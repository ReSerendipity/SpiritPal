/**
 * OnDeviceModelPanel 组件测试
 *
 * 覆盖：模型目录展示、可用模型列表、加载/卸载调用与参数、空态提示、桌面端降级说明。
 * 依赖 `@tauri-apps/api/core` 的 invoke 与 `@/lib/system/platform` 的 isMobileRuntime，均做 mock。
 */
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============ mock：invoke 按命令名分派 ============
const { mockInvoke, platformState } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  platformState: { mobile: true },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}))

vi.mock('@/lib/system/platform', () => ({
  isMobileRuntime: () => platformState.mobile,
  isDesktopRuntime: () => !platformState.mobile,
}))

import { OnDeviceModelPanel } from '@/components/OnDeviceModelPanel'

const DIR = '/storage/emulated/0/Android/data/com.spiritpal.desktop_pet/files/models'

/** 构造一次成功的 invoke 应答 */
function setupModels(models: unknown[]) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === 'ondevice_models_dir') return Promise.resolve({ dir: DIR })
    if (cmd === 'ondevice_list_models') return Promise.resolve(models)
    return Promise.resolve(undefined)
  })
}

const NOT_LOADED = {
  id: 'Qwen3.5-2B-MNN',
  available: true,
  loaded: false,
  path: `${DIR}/Qwen3.5-2B-MNN`,
  config_path: `${DIR}/Qwen3.5-2B-MNN/config.json`,
  size_bytes: 1390000000,
  resident_bytes: 0,
}

const LOADED = { ...NOT_LOADED, loaded: true, resident_bytes: 1400000000 }

beforeEach(() => {
  mockInvoke.mockReset()
  platformState.mobile = true
})

afterEach(() => cleanup())

describe('OnDeviceModelPanel', () => {
  it('移动端：展示模型目录（供用户 adb push）', async () => {
    setupModels([])
    render(<OnDeviceModelPanel />)
    expect(await screen.findByText(DIR)).toBeTruthy()
  })

  it('移动端：无模型时给出空态提示', async () => {
    setupModels([])
    render(<OnDeviceModelPanel />)
    expect(await screen.findByText(/未发现模型/)).toBeTruthy()
  })

  it('移动端：列出可用模型并显示体积', async () => {
    setupModels([NOT_LOADED])
    render(<OnDeviceModelPanel />)
    expect(await screen.findByText('Qwen3.5-2B-MNN')).toBeTruthy()
    expect(screen.getByText('1.29 GB')).toBeTruthy() // 1390000000 / 1024^3
    expect(screen.getByRole('button', { name: '加载' })).toBeTruthy()
  })

  it('移动端：点「加载」以 modelId + configPath + enableThinking(默认关) 调用 ondevice_load_model', async () => {
    setupModels([NOT_LOADED])
    render(<OnDeviceModelPanel />)
    const btn = await screen.findByRole('button', { name: '加载' })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('ondevice_load_model', {
        modelId: 'Qwen3.5-2B-MNN',
        configPath: `${DIR}/Qwen3.5-2B-MNN/config.json`,
        enableThinking: false,
      })
    })
  })

  it('移动端：开启思维链开关后，加载透传 enableThinking=true 并写入 localStorage', async () => {
    localStorage.clear()
    setupModels([NOT_LOADED])
    render(<OnDeviceModelPanel />)
    const sw = await screen.findByRole('switch', { name: '思维链（Thinking）' })
    expect(sw.getAttribute('aria-checked')).toBe('false') // 默认关
    fireEvent.click(sw)
    expect(sw.getAttribute('aria-checked')).toBe('true')
    const btn = await screen.findByRole('button', { name: '加载' })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('ondevice_load_model', {
        modelId: 'Qwen3.5-2B-MNN',
        configPath: `${DIR}/Qwen3.5-2B-MNN/config.json`,
        enableThinking: true,
      })
    })
    const stored = JSON.parse(localStorage.getItem('spiritpal-ai-config')!)
    expect(stored.ondeviceThinking).toBe(true)
  })

  it('移动端：已加载模型显示徽章与「卸载」按钮，点击调用 ondevice_unload_model', async () => {
    setupModels([LOADED])
    render(<OnDeviceModelPanel />)
    expect(await screen.findByText('已加载')).toBeTruthy()
    const btn = screen.getByRole('button', { name: '卸载' })
    fireEvent.click(btn)
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('ondevice_unload_model', {
        modelId: 'Qwen3.5-2B-MNN',
      })
    })
  })

  it('移动端：invoke 失败时显示错误而不是崩溃', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'ondevice_models_dir') return Promise.resolve({ dir: DIR })
      if (cmd === 'ondevice_list_models') return Promise.reject('boom')
      return Promise.resolve(undefined)
    })
    render(<OnDeviceModelPanel />)
    expect(await screen.findByText(/boom/)).toBeTruthy()
  })

  it('桌面端：显示降级说明，且不调用任何 ondevice_* 命令', async () => {
    platformState.mobile = false
    render(<OnDeviceModelPanel />)
    expect(await screen.findByText(/仅在 Android 构建中可用/)).toBeTruthy()
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
