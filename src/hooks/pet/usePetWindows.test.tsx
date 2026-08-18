// 最终放置位置: src/hooks/pet/usePetWindows.test.tsx
// 覆盖: usePetWindows —— 返回 showWindow/hideWindow、showWindow 创建并显示子窗口、hideWindow 隐藏、托盘图标同步 invoke、卸载清理
// Mock: settingsStore / appWindows / petForm / windowPositionMemory / @tauri-apps/api/window
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import { usePetWindows } from './usePetWindows'

const wins = vi.hoisted(() => {
  const appWindow = {
    show: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
  }
  const winMock = {
    hide: vi.fn().mockResolvedValue(undefined),
    show: vi.fn().mockResolvedValue(undefined),
    setFocus: vi.fn().mockResolvedValue(undefined),
    isVisible: vi.fn().mockResolvedValue(false),
    listen: vi.fn(() => Promise.resolve(() => {})),
    emit: vi.fn(),
  }
  return {
    appWindow,
    winMock,
    ensureAppWindow: vi.fn(),
    togglePetForm: vi.fn(),
    initPetWindowPosition: vi.fn(),
  }
})

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => wins.winMock,
  WebviewWindow: vi.fn(),
}))

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ startMinimized: false }) },
}))

vi.mock('../../lib/appWindows', () => ({
  ensureAppWindow: wins.ensureAppWindow,
}))

vi.mock('../../lib/petForm', () => ({
  togglePetForm: wins.togglePetForm,
}))

vi.mock('@/lib/windowPositionMemory', () => ({
  initPetWindowPosition: wins.initPetWindowPosition,
}))

describe('usePetWindows', () => {
  beforeEach(() => {
    wins.ensureAppWindow.mockReset().mockResolvedValue(wins.appWindow)
    wins.initPetWindowPosition.mockReset().mockResolvedValue(() => {})
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined)
  })

  function setup() {
    const opts = {
      setPomodoro: vi.fn(),
      showBubble: vi.fn(),
      setPetState: vi.fn(),
      setCurrentAnimId: vi.fn(),
      safeTimeout: vi.fn(),
      petStateRef: { current: 'idle' as any },
      petState: 'idle' as any,
      hunger: 80,
    }
    return renderHook(() => usePetWindows(opts))
  }

  it('返回 showWindow / hideWindow', () => {
    const { result } = setup()
    expect(typeof result.current.showWindow).toBe('function')
    expect(typeof result.current.hideWindow).toBe('function')
  })

  it('showWindow 创建并显示子窗口', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.showWindow('settings')
    })
    expect(wins.ensureAppWindow).toHaveBeenCalledWith('settings')
    expect(wins.appWindow.show).toHaveBeenCalled()
    expect(wins.appWindow.setFocus).toHaveBeenCalled()
  })

  it('hideWindow 隐藏当前窗口', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.hideWindow()
    })
    expect(wins.winMock.hide).toHaveBeenCalled()
  })

  it('根据宠物状态同步托盘图标', () => {
    setup()
    expect(invoke).toHaveBeenCalledWith('update_tray_icon', { state: 'normal' })
  })

  it('卸载时清理事件监听（不崩溃）', () => {
    const { unmount } = setup()
    expect(() => unmount()).not.toThrow()
  })
})