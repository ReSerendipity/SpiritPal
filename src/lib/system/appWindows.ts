/**
 * 应用窗口管理（共享窗口配置与创建逻辑）
 *
 * 供 usePetWindows（窗口管理 Hook）与 petForm（形态切换）复用。
 *
 * 窗口配置单一事实来源：Rust 侧 `window_config()`（src-tauri/src/lib.rs），
 * 前端通过 `get_window_config` 命令查询，不再自带 WINDOW_CONFIGS——
 * 消除「前端与 Rust 两处各自维护窗口参数」的双源漂移
 * （曾导致前端创建的窗口无法最大化/边缘缩放的历史 bug）。
 */
import { getAllWindows, type Window } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { invoke } from '@tauri-apps/api/core'

export interface WindowConfig {
  title: string
  width: number
  height: number
  url: string
  transparent?: boolean
  decorations?: boolean
  alwaysOnTop?: boolean
  skipTaskbar?: boolean
  backgroundColor?: string
  /** 是否允许鼠标缩放窗口（无边框窗口配合 FramelessResizeHandles 使用） */
  resizable?: boolean
  minWidth?: number
  minHeight?: number
}

/** 从 Rust 权威表查询窗口配置（不存在时返回 null） */
export async function getWindowConfig(label: string): Promise<WindowConfig | null> {
  try {
    return await invoke<WindowConfig | null>('get_window_config', { label })
  } catch {
    return null
  }
}

/**
 * 确保窗口存在（不存在则创建），返回窗口实例或 null。
 */
export async function ensureAppWindow(label: string): Promise<Window | null> {
  try {
    const wins = await getAllWindows()
    const existing = wins.find((w) => w.label === label)
    if (existing) return existing

    const config = await getWindowConfig(label)
    if (!config) return null

    return new WebviewWindow(label, {
      title: config.title,
      width: config.width,
      height: config.height,
      minWidth: config.minWidth,
      minHeight: config.minHeight,
      resizable: config.resizable ?? false,
      decorations: config.decorations ?? true,
      transparent: config.transparent ?? false,
      alwaysOnTop: config.alwaysOnTop ?? false,
      skipTaskbar: config.skipTaskbar ?? false,
      // 显式设置背景色，避免继承 index.css 的 body { background: transparent }
      // 导致 WebView2 首帧呈现未定义颜色（通常是白/空白）
      backgroundColor: config.backgroundColor ?? '#0f172a',
      url: config.url,
    })
  } catch {
    return null
  }
}