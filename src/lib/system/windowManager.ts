/**
 * Windows 窗口置顶保活模块
 *
 * @fileoverview
 * 防止其他应用覆盖宠物窗口。前端通过调用 Rust 端 `start_topmost_keepalive` 命令，
 * 在 Rust 后台线程中以 1s 轮询 SetWindowPos(HWND_TOPMOST) 实现持续置顶。
 *
 * 设计要点：
 * - Rust 后端已有 `start_topmost_keepalive` 命令（lib.rs → win32.rs），
 *   在后台线程中使用 Win32 API `SetWindowPos(HWND_TOPMOST)` 16ms 轮询。
 * - 前端只需调用一次 invoke('start_topmost_keepalive')，Rust 线程会在应用生命周期内持续保活。
 * - 非 Windows 平台为空操作（macOS/Linux 上 Tauri 的 alwaysOnTop 更稳定）。
 * - 使用 safeInvoke 模式，在非 Tauri 环境（如 Vitest）中安全降级为 no-op。
 *
 * @module windowManager
 */

// =========================================================================
// safeInvoke：延迟动态 import 的 invoke 安全封装
// =========================================================================
// 与 main.tsx 中的 safeInvoke 策略一致：不做顶层 import { invoke }，
// 避免 Tauri API 在模块装载阶段同步访问 __TAURI_INTERNALS__ 导致崩溃。

let _invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null
let _invokeTried = false

/**
 * 安全的 Tauri invoke 调用
 * - 首次调用时懒加载 @tauri-apps/api/core
 * - 加载失败/环境不可用则静默返回 undefined
 * - 任何异常都吞掉，避免未捕获 Promise rejection
 */
async function safeInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!_invokeTried && !_invoke) {
    _invokeTried = true
    try {
      const mod = await import('@tauri-apps/api/core')
      if (typeof mod.invoke === 'function') {
        _invoke = mod.invoke as unknown as typeof _invoke
      }
    } catch {
      // 非 Tauri 环境 or Tauri API 注入失败 → 保持 _invoke = null
    }
  }
  if (!_invoke) return undefined
  try {
    return (await _invoke(cmd, args)) as T
  } catch {
    return undefined
  }
}

// ============ 类型定义 ============

/**
 * 窗口置顶保活状态
 */
export interface TopMostState {
  /** 是否已启用置顶保活 */
  active: boolean
  /** 上次检测时间戳 */
  lastCheckTime: number
}

// ============ WindowManager 单例 ============

/**
 * Windows 窗口置顶保活管理器
 *
 * 通过调用 Rust 端 `start_topmost_keepalive` 命令实现后台线程轮询保活。
 * 前端只需调用一次 `startTopMostKeepAlive()`，Rust 线程会在应用生命周期内持续运行。
 */
class WindowManager {
  private static instance: WindowManager
  private state: TopMostState = {
    active: false,
    lastCheckTime: 0,
  }

  private constructor() {}

  /**
   * 获取单例实例
   */
  static getInstance(): WindowManager {
    if (!WindowManager.instance) {
      WindowManager.instance = new WindowManager()
    }
    return WindowManager.instance
  }

  /**
   * 启动窗口置顶保活
   *
   * 调用 Rust 端 `start_topmost_keepalive` 命令，在后台线程中启动 1s 轮询。
   * 该命令在非 Windows 平台为空操作。
   *
   * @returns Promise<void>，无论成功或失败都不会抛出异常
   */
  async startTopMostKeepAlive(): Promise<void> {
    if (this.state.active) return

    const result = await safeInvoke<void>('start_topmost_keepalive')
    if (result !== undefined) {
      this.state.active = true
      this.state.lastCheckTime = Date.now()
      console.log('[SpiritPal] 窗口置顶保活已启动')
    } else {
      // 非 Tauri 环境或非 Windows 平台，静默降级
      console.debug('[SpiritPal] 置顶保活未启动（非 Windows 平台或非 Tauri 环境）')
    }
  }

  /**
   * 获取当前置顶保活状态
   */
  getState(): TopMostState {
    return { ...this.state }
  }

  /**
   * 是否已启用置顶保活
   */
  isActive(): boolean {
    return this.state.active
  }
}

// 全局实例
export const windowManager = WindowManager.getInstance()

/**
 * 便捷函数：启用 Windows 置顶模式
 *
 * 调用 Rust 后端 `start_topmost_keepalive` 命令启动后台轮询线程。
 * 在应用启动时自动调用（仅 Windows 生效，其他平台为空操作）。
 */
export async function enableWindowsPinMode(): Promise<void> {
  await windowManager.startTopMostKeepAlive()
}

/**
 * 便捷函数：获取当前置顶状态
 *
 * @returns 是否已启用置顶保活
 */
export function isWindowsPinModeActive(): boolean {
  return windowManager.isActive()
}
