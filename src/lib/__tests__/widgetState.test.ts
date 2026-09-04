// Widget Deep Link 处理器单元测试 — 四动作分发（feed/pet/open_chat/open_settings）
// 背景：修复 handleWidgetDeepLink 调用不存在 Rust 命令的断链（Gotcha #46），改为复用前端既有能力
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { mockUseItem, mockEmit, mockEnsureAppWindow, mockInvoke } = vi.hoisted(() => ({
  mockUseItem: vi.fn(),
  mockEmit: vi.fn(),
  mockEnsureAppWindow: vi.fn(),
  mockInvoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

// petStore 模拟：inventory 内容由各用例设置
let currentInventory: Array<{ id: string; count: number; type: string }> = []
vi.mock('@/stores/petStore', () => ({
  usePetStore: {
    getState: () => ({ inventory: currentInventory, useItem: mockUseItem }),
  },
}))

vi.mock('@/lib/system/windowEventBus', () => ({
  windowEventBus: { emit: (...args: unknown[]) => mockEmit(...args) },
}))

vi.mock('@/lib/system/appWindows', () => ({
  ensureAppWindow: (...args: unknown[]) => mockEnsureAppWindow(...args),
}))

import { handleWidgetDeepLink, parseWidgetDeepLink } from '@/lib/system/widgetState'

function setUA(ua: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true })
}

const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 15; Pixel 7) spiritpal'
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) spiritpal'

describe('parseWidgetDeepLink', () => {
  it('解析 feed 带 item_id', () => {
    expect(parseWidgetDeepLink('spiritpal://feed?item_id=apple')).toEqual({
      action: 'feed',
      itemId: 'apple',
    })
  })

  it('拒绝非 spiritpal 协议与未知动作', () => {
    expect(parseWidgetDeepLink('https://example.com/feed')).toBeNull()
    expect(parseWidgetDeepLink('spiritpal://unknown')).toBeNull()
  })
})

describe('handleWidgetDeepLink', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockEmit.mockResolvedValue(undefined)
    currentInventory = []
  })

  afterEach(() => {
    setUA(DESKTOP_UA)
  })

  it('feed：item_id 精确命中背包物品时直接使用', async () => {
    setUA(ANDROID_UA)
    currentInventory = [
      { id: 'doro-orange', count: 2, type: 'food' },
      { id: 'doro-chocolate', count: 1, type: 'food' },
    ]
    const ok = await handleWidgetDeepLink('spiritpal://feed?item_id=doro-chocolate')
    expect(ok).toBe(true)
    expect(mockUseItem).toHaveBeenCalledWith('doro-chocolate')
  })

  it('feed：item_id 无匹配（如小组件硬编码的 apple）回退首个可消耗食物', async () => {
    setUA(ANDROID_UA)
    currentInventory = [{ id: 'feibi-fish-dried', count: 3, type: 'food' }]
    const ok = await handleWidgetDeepLink('spiritpal://feed?item_id=apple')
    expect(ok).toBe(true)
    expect(mockUseItem).toHaveBeenCalledWith('feibi-fish-dried')
  })

  it('feed：背包无可用食物时返回 false 且不消耗', async () => {
    setUA(ANDROID_UA)
    currentInventory = [{ id: 'toy-ball', count: 0, type: 'toy' }]
    const ok = await handleWidgetDeepLink('spiritpal://feed?item_id=apple')
    expect(ok).toBe(false)
    expect(mockUseItem).not.toHaveBeenCalled()
  })

  it('pet：调用真实存在的 show_pet_window 命令', async () => {
    mockInvoke.mockResolvedValue(undefined)
    const ok = await handleWidgetDeepLink('spiritpal://pet')
    expect(ok).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith('show_pet_window')
  })

  it('open_chat（移动端）：经 windowEventBus 发 widget-navigate 切 tab', async () => {
    setUA(ANDROID_UA)
    const ok = await handleWidgetDeepLink('spiritpal://open_chat')
    expect(ok).toBe(true)
    expect(mockEmit).toHaveBeenCalledWith('widget-navigate', { tab: 'chat' })
    expect(mockEnsureAppWindow).not.toHaveBeenCalled()
  })

  it('open_settings（桌面端）：经 ensureAppWindow 唤起并聚焦窗口', async () => {
    setUA(DESKTOP_UA)
    const show = vi.fn().mockResolvedValue(undefined)
    const setFocus = vi.fn().mockResolvedValue(undefined)
    mockEnsureAppWindow.mockResolvedValue({ show, setFocus })
    const ok = await handleWidgetDeepLink('spiritpal://open_settings')
    expect(ok).toBe(true)
    expect(mockEnsureAppWindow).toHaveBeenCalledWith('settings-window')
    expect(show).toHaveBeenCalled()
    expect(setFocus).toHaveBeenCalled()
  })

  it('未知协议 URL 返回 false', async () => {
    expect(await handleWidgetDeepLink('spiritpal://nope')).toBe(false)
  })
})
