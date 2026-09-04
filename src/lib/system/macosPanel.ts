/**
 * macOS NSPanel 窗口管理模块
 *
 * @fileoverview 封装 macOS NSPanel 浮层操作，提供跨平台兼容的宠物窗口接口
 *
 * 主要模块：
 * - isMacOS(): 平台检测
 * - showPanel/hidePanel/togglePanel: NSPanel 显示/隐藏/切换
 * - setPanelLevel: 设置窗口级别（桌面级/悬浮级/屏保级）
 * - orderFrontRegardless/setIgnoresMouseEvents: 窗口行为控制
 *
 * 依赖关系：
 * - @tauri-apps/api/core: Tauri invoke 调用
 * - @tauri-apps/api/window: Tauri 窗口 API
 *
 * 核心接口：
 * - showPanel(): 显示宠物窗口
 * - hidePanel(): 隐藏宠物窗口
 * - setPanelLevel(): 设置窗口层级
 *
 * macOS 特殊行为：
 * - 宠物窗口被转换为 NSPanel（Rust端在setup阶段完成）
 * - 不能直接使用 Tauri 原生 window.show()/hide() 等方法
 * - 需要专用 Tauri 命令，避免 NSPanel 与 NSWindow 混用崩溃
 *
 * 跨平台兼容：
 * - 非 macOS 平台自动降级到 Tauri 原生 window 方法
 * - 前端代码无需平台判断
 *
 * 参考实现：
 * - BongoCat window/commands/macos.rs
 * - tauri-nspanel 库
 */

import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

// ============ 平台检测 ============

/** 缓存平台检测结果 */
let _isMacOS: boolean | null = null

/**
 * 检测当前是否运行在 macOS 上
 * 使用 Tauri WebviewWindow 的 nsWindow 仅在 macOS 上可用的特性判断
 * 降级方案：通过 navigator.platform 检测
 */
export function isMacOS(): boolean {
  if (_isMacOS !== null) return _isMacOS

  // navigator.platform 在 Tauri WebView 中仍然可用
  // macOS 的 platform 值以 "Mac" 开头
  if (typeof navigator !== 'undefined' && navigator.platform) {
    _isMacOS = navigator.platform.startsWith('Mac')
  } else {
    _isMacOS = false
  }

  return _isMacOS
}

// ============ NSPanel 操作接口 ============

/**
 * 显示宠物窗口
 * macOS: 使用 NSPanel.show()（通过 Rust 端 macos::set_pet_panel_visibility）
 * 其他平台: 使用 Tauri 原生 window.show() + setFocus()
 *
 * 安全性：NSPanel 转换后不能直接调用 Tauri 原生 window.show()，
 * 否则可能触发崩溃（参考 tauri-nspanel issue #37）
 */
export async function showPetWindow(): Promise<void> {
  try {
    const window = getCurrentWindow()
    await invoke('show_pet_window', { window })
  } catch (e) {
    console.warn('[macosPanel] showPetWindow failed:', e)
    // 降级：直接使用 Tauri API
    try {
      const window = getCurrentWindow()
      await window.show()
      await window.setFocus()
    } catch {
      // 忽略
    }
  }
}

/**
 * 隐藏宠物窗口
 * macOS: 使用 NSPanel.hide()（通过 Rust 端 macos::set_pet_panel_visibility）
 * 其他平台: 使用 Tauri 原生 window.hide()
 */
export async function hidePetWindow(): Promise<void> {
  try {
    const window = getCurrentWindow()
    await invoke('hide_pet_window', { window })
  } catch (e) {
    console.warn('[macosPanel] hidePetWindow failed:', e)
    // 降级
    try {
      const window = getCurrentWindow()
      await window.hide()
    } catch {
      // 忽略
    }
  }
}

/**
 * 设置宠物窗口置顶
 * macOS: 使用 NSPanel PanelLevel（通过 Rust 端 macos::set_pet_panel_level）
 *   - always_on_top = true: PanelLevel::Dock（浮在普通窗口之上）
 *   - always_on_top = false: PanelLevel = -1（普通级别）
 * 其他平台: 使用 Tauri 原生 window.set_always_on_top()
 *
 * @param alwaysOnTop 是否置顶
 */
export async function setPetAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  try {
    const window = getCurrentWindow()
    await invoke('set_pet_always_on_top', { window, alwaysOnTop })
  } catch (e) {
    console.warn('[macosPanel] setPetAlwaysOnTop failed:', e)
    // 降级
    try {
      const window = getCurrentWindow()
      await window.setAlwaysOnTop(alwaysOnTop)
    } catch {
      // 忽略
    }
  }
}

/**
 * 切换宠物窗口可见性
 * 根据当前可见状态调用 showPetWindow 或 hidePetWindow
 */
export async function togglePetWindowVisibility(): Promise<void> {
  try {
    const window = getCurrentWindow()
    const visible = await window.isVisible()
    if (visible) {
      await hidePetWindow()
    } else {
      await showPetWindow()
    }
  } catch (e) {
    console.warn('[macosPanel] togglePetWindowVisibility failed:', e)
  }
}

// ============ NSPanel 能力查询 ============

/**
 * 检查当前平台是否支持 NSPanel 浮层
 * NSPanel 是 macOS 专属功能
 */
export function isNSPanelSupported(): boolean {
  return isMacOS()
}

/**
 * 获取 NSPanel 浮层能力描述
 * 用于 UI 展示或调试日志
 */
export function getNSPanelCapabilities(): {
  platform: string
  nspanelSupported: boolean
  features: string[]
} {
  const macOS = isMacOS()
  return {
    platform: macOS ? 'macOS' : 'other',
    nspanelSupported: macOS,
    features: macOS
      ? [
          'nonactivating_panel: 点击不抢焦点',
          'move_to_active_space: 跨 Space 跟随',
          'full_screen_auxiliary: 全屏应用可见',
          'dock_level: 浮在普通窗口之上',
          'hidden_dock_icon: 隐藏 Dock 图标',
        ]
      : [],
  }
}
