/**
 * 全屏检测 + 宠物自动隐藏/避让
 *
 * @fileoverview 参考 CodeWalkers：当用户前台应用进入全屏（游戏/视频/演示）时，
 * 自动隐藏 pet-window 避免遮挡；退出全屏后恢复显示。
 *
 * 检测源：Rust 命令 `is_fullscreen_detected`
 * （Windows：GetForegroundWindow 矩形覆盖整个主屏且未最小化；macOS/Linux v1 恒 false）。
 *
 * 设计纪律（对齐现有 singleton ticker 模式，如 petStore 的 pendingRecoveryTicker）：
 * - 模块级单例定时器，幂等启动、stop 清理；
 * - 仅由本检测器触发的隐藏才在退出全屏时恢复，不覆盖用户手动隐藏窗口；
 * - 命令不可用（浏览器预览 / 非桌面）时静默降级，不报错。
 */
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** 轮询间隔（ms）。2s 对全屏进出足够及时，又不至于高频打 IPC。 */
const POLL_INTERVAL_MS = 2000

/** 轮询定时器句柄（模块级单例；null 表示未运行）。 */
let timerId: number | null = null

/** 上一轮的全屏状态（用于沿检测边沿，只在 false→true / true→false 时动作）。 */
let wasFullscreen = false

/** 标记当前隐藏是否由本检测器造成——退出全屏时只恢复自己藏的窗口。 */
let selfHidden = false

export interface FullscreenDetectorOptions {
  /** 自定义轮询间隔（ms），默认 2000。 */
  intervalMs?: number
}

/**
 * 启动「全屏自动隐藏」轮询。
 *
 * 幂等：已在运行时重复调用不启动第二个定时器。
 * 进入全屏 → 隐藏 pet-window；退出全屏 → 恢复显示（仅当本检测器是隐藏来源）。
 */
export function startFullscreenAutoHide(options: FullscreenDetectorOptions = {}): void {
  if (timerId !== null) return
  const interval = options.intervalMs ?? POLL_INTERVAL_MS
  timerId = window.setInterval(async () => {
    let fullscreen: boolean
    try {
      fullscreen = await invoke<boolean>('is_fullscreen_detected')
    } catch {
      // 命令不可用（浏览器预览 / 非桌面 Tauri）→ 本轮跳过，保持现状
      return
    }
    try {
      const win = getCurrentWindow()
      if (fullscreen && !wasFullscreen) {
        // false → true：进入全屏。仅在窗口当前可见时隐藏，并记录来源。
        const visible = await win.isVisible()
        if (visible) {
          await win.hide()
          selfHidden = true
        }
      } else if (!fullscreen && wasFullscreen && selfHidden) {
        // true → false：退出全屏。仅恢复本检测器隐藏的窗口，不抢焦点。
        await win.show()
        selfHidden = false
      }
    } catch {
      // 窗口操作失败（窗口已销毁等）静默忽略
    }
    wasFullscreen = fullscreen
  }, interval)
}

/**
 * 停止全屏自动隐藏轮询并复位状态。
 *
 * 若退出时本检测器仍持有隐藏态，复位标记（下次启动从干净状态开始）。
 */
export function stopFullscreenAutoHide(): void {
  if (timerId !== null) {
    clearInterval(timerId)
    timerId = null
  }
  selfHidden = false
  wasFullscreen = false
}
