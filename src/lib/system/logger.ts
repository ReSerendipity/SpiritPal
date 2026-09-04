/**
 * @file 前端统一日志封装
 * @module lib/logger
 * @description
 * SpiritPal 前端日志门面。统一日志格式与级别控制：
 * - 浏览器环境不适合 winston 文件 transport，因此将日志分两级：
 *   1. 本地 console（开发/调试）
 *   2. 转发到 Rust 端（tauri-plugin-log）写入云盘日志文件 spiritpal.log，实现持久化
 * - debug 构建记录 DEBUG 级；release 构建仅记录 INFO 及以上（避免敏感调试信息落盘）
 * - 每条日志携带时间戳 + 级别 + 调用源（file:line）
 */

// Tauri 环境标记：非 Tauri 环境（如浏览器预览）自动降级为仅 console 输出
let _tauriAvailable = true

/** 是否为 debug 构建 */
export const isDebug = typeof import.meta !== 'undefined'
  ? import.meta.env.DEV
  : false

/** 设置 Tauri 可用性（供桥接层在初始化失败时调用） */
export function setTauriAvailable(available: boolean) {
  _tauriAvailable = available
}

/** 提取调用源 file:line（栈帧第 3 层为调用方） */
function callerInfo(): string {
  try {
    const stack = new Error().stack?.split('\n') ?? []
    // stack[0] 为 Error，stack[1] 为 callerInfo 自身，stack[2] 为当前 Logger 方法，stack[3] 为实际调用方
    const frame = stack[3]?.trim() ?? stack[4]?.trim() ?? ''
    // 提取类似 "at file:///.../src/lib/foo.ts:12:34" 中的路径:行:列
    const match = frame.match(/[\\/]([\w.-]+\.(?:ts|tsx|js|jsx)):(\d+)/)
    return match ? `${match[1]}:${match[2]}` : 'unknown'
  } catch {
    return 'unknown'
  }
}

/** 格式化消息并附加调用源 */
function fmt(level: string, message: string, ...args: unknown[]) {
  const extra = args.length
    ? ' ' + args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ')
    : ''
  return `[${new Date().toISOString()}] [${level}] [${callerInfo()}] ${message}${extra}`
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** 转发到 Rust 端持久化日志（静默失败，不影响主流程） */
async function forward(level: 'error' | 'warn' | 'info' | 'debug', message: string) {
  if (!_tauriAvailable) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('log_frontend_error', { level, message })
  } catch {
    // 非 Tauri 环境或日志转发失败 → 静默降级
  }
}

const Logger = {
  debug(message: string, ...args: unknown[]) {
    if (!isDebug) return // release 构建不输出 debug 日志
    const line = fmt('DEBUG', message, ...args)
    try { console.debug(line) } catch { /* no-op */ }
    void forward('debug', line)
  },
  info(message: string, ...args: unknown[]) {
    const line = fmt('INFO', message, ...args)
    try { console.info(line) } catch { /* no-op */ }
    void forward('info', line)
  },
  warn(message: string, ...args: unknown[]) {
    const line = fmt('WARN', message, ...args)
    try { console.warn(line) } catch { /* no-op */ }
    void forward('warn', line)
  },
  error(message: string, ...args: unknown[]) {
    const line = fmt('ERROR', message, ...args)
    try { console.error(line) } catch { /* no-op */ }
    void forward('error', line)
  },
}

export default Logger