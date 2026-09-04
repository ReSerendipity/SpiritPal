/**
 * 应用窗口管理（共享窗口配置与创建逻辑）
 *
 * 供 usePetWindows（窗口管理 Hook）与 petForm（形态切换）复用。
 */
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { getAllWindows, type Window } from '@tauri-apps/api/window'

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

export const WINDOW_CONFIGS: Record<string, WindowConfig> = {
  'settings-window': {
    title: 'SpiritPal Settings',
    width: 720,
    height: 540,
    url: 'index.html#/settings',
    decorations: false,
    backgroundColor: '#fdf6ec',
    // 与 Rust 托盘路径创建的 settings-window 保持一致（resizable + 最小尺寸），
    // 否则前端创建出来的窗口无法最大化/边缘缩放
    resizable: true,
    minWidth: 580,
    minHeight: 400,
  },
  'chat-window': {
    title: 'SpiritPal Chat',
    width: 420,
    height: 600,
    url: 'index.html#/chat',
    decorations: false,
    backgroundColor: '#fdf6ec',
    resizable: true,
    minWidth: 320,
    minHeight: 400,
  },
}

/**
 * 确保窗口存在（不存在则创建），返回窗口实例或 null。
 */
export async function ensureAppWindow(label: string): Promise<Window | null> {
  try {
    const wins = await getAllWindows()
    const existing = wins.find((w) => w.label === label)
    if (existing) return existing

    const config = WINDOW_CONFIGS[label]
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
