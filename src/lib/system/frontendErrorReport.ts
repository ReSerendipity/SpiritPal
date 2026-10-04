/**
 * 前端错误上报（P0-4: 错误可见化）
 * @module system/frontendErrorReport
 * @description
 * 背景：生产构建通过 vite esbuild.drop 剥离 console.*（SECURITY R-08，防元信息泄露），
 * 所有依赖 console 的 catch 错误在生产环境完全静默，排障无据可查。
 *
 * 本模块提供**不依赖 console** 的错误上报通道：
 * - reportError / reportWarn → invoke('log_frontend_error')
 *   → Rust tauri-plugin-log（{log_dir}/spiritpal.log）
 *   → export_diagnostics 诊断包收录（用户可一键导出）
 * - installGlobalErrorReport：全局兜底 window 'error' + 'unhandledrejection'，
 *   捕获未被任何 catch 处理的错误
 *
 * 上报本身尽力而为：invoke 失败时静默（错误通道自身绝不能再抛错造成循环）。
 * 同一 message 5s 内节流去重，避免同一错误刷屏日志。
 *
 * @see src-tauri/src/commands/window.rs log_frontend_error（命令实现）
 * @see src-tauri/src/diagnostics.rs export_diagnostics（诊断包收录 spiritpal.log）
 */

/** 全局兜底是否已安装（防重复安装） */
let installed = false

/** 同一消息的节流窗口（ms）——避免同一错误反复刷日志 */
const THROTTLE_MS = 5000

/** 最近一次上报时间表（key = level:message） */
const lastReportAt = new Map<string, number>()

/**
 * 核心上报：节流后 invoke log_frontend_error。
 * 失败静默——错误通道自身绝不能再抛。
 */
async function report(level: 'error' | 'warn' | 'info', message: string): Promise<void> {
  try {
    const now = Date.now()
    const key = `${level}:${message}`
    const last = lastReportAt.get(key)
    if (last !== undefined && now - last < THROTTLE_MS) return
    lastReportAt.set(key, now)
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('log_frontend_error', { level, message })
  } catch {
    // 上报失败静默（尽力而为）
  }
}

/** 上报错误（spiritpal.log error 级，诊断导出收录） */
export function reportError(message: string): void {
  void report('error', message)
}

/** 上报警告（非致命初始化失败等） */
export function reportWarn(message: string): void {
  void report('warn', message)
}

/** 格式化未知抛出值为紧凑单行（Error → "Name: message"） */
export function formatError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

/**
 * 安装全局错误兜底上报（window 'error' + 'unhandledrejection'）。
 * 幂等：重复调用只安装一次；非浏览器环境（SSR/测试）跳过。
 */
export function installGlobalErrorReport(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event) => {
    reportError(
      `uncaught: ${event.message ?? 'unknown error'} @ ${event.filename ?? '?'}:${event.lineno ?? '?'}`,
    )
  })

  window.addEventListener('unhandledrejection', (event) => {
    reportError(`unhandledrejection: ${formatError(event.reason)}`)
  })
}
