/**
 * 应用窗口管理（共享窗口配置与创建逻辑）
 *
 * 供 usePetWindows（窗口管理 Hook）与 petForm（形态切换）复用，
 * 避免漫游窗口创建逻辑在两处重复维护。
 */
import { getAllWindows, primaryMonitor, type Window } from '@tauri-apps/api/window'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'

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
}

export const WINDOW_CONFIGS: Record<string, WindowConfig> = {
  'settings-window': {
    title: 'SpiritPal Settings',
    width: 720,
    height: 540,
    url: 'index.html#/settings',
    decorations: false,
    backgroundColor: '#fdf6ec',
  },
  'chat-window': {
    title: 'SpiritPal Chat',
    width: 420,
    height: 600,
    url: 'index.html#/chat',
    decorations: false,
    backgroundColor: '#fdf6ec',
  },
  'roam-window': {
    title: 'SpiritPal 漫游',
    width: 520,
    height: 320,
    url: 'index.html#/roam',
    transparent: true,
    decorations: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
  },
}

/**
 * 确保窗口存在（不存在则创建），返回窗口实例或 null。
 * 漫游窗口创建时自动定位到主屏底部居中。
 */
export async function ensureAppWindow(label: string): Promise<Window | null> {
  try {
    const wins = await getAllWindows()
    const existing = wins.find((w) => w.label === label)
    if (existing) return existing

    const config = WINDOW_CONFIGS[label]
    if (!config) return null

    let x: number | undefined
    let y: number | undefined
    if (label === 'roam-window') {
      try {
        const primary = await primaryMonitor()
        if (primary) {
          x = Math.round((primary.size.width - config.width) / 2)
          y = Math.max(0, Math.round(primary.size.height - config.height - 90))
        }
      } catch {
        // 定位失败则使用默认位置
      }
    }

    return new WebviewWindow(label, {
      title: config.title,
      width: config.width,
      height: config.height,
      x,
      y,
      resizable: false,
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
