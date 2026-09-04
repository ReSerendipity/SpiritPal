/**
 * @file diagnostics.ts
 * @description 运行时日志级别与诊断导出 — Rust 端 diagnostics.rs / log_level.rs 前端封装
 *
 * 命令对应：
 * - get_log_level   → 查询当前生效日志级别（产物见 src-tauri/src/log_level.rs）
 * - set_log_level   → 运行时调整日志级别（立即生效 + 持久化 log-level.json）
 * - export_diagnostics → 收集主日志/审计日志/崩溃日志/级别配置到诊断包（src-tauri/src/diagnostics.rs）
 *
 * 降级策略：非 Tauri 环境（浏览器/单测）静默降级，模仿 auditLogger.ts 风格，
 * 保证这些能力在开发/测试环境不抛错、不阻塞 UI。
 *
 * @module diagnostics
 * @requires ./tauriInvoker
 * @requires @tauri-apps/api/core
 */

import { isTauri } from '@tauri-apps/api/core'
import { tauriInvoke, tauriInvokeNoRetry } from '@/lib/system/tauriInvoker'

/** 可用日志级别选项（与 Rust 端 parse_level / level_name 双向一致） */
export const LOGGING_LEVELS: { value: string; label: string }[] = [
  { value: 'off', label: '关闭' },
  { value: 'error', label: '错误' },
  { value: 'warn', label: '警告' },
  { value: 'info', label: '信息' },
  { value: 'debug', label: '调试' },
  { value: 'trace', label: '追踪' },
]

/**
 * 查询当前运行时日志级别。
 *
 * 非 Tauri 环境返回 'info'（构建类型默认即为 Info）。
 *
 * @returns 当前级别字符串（off/error/warn/info/debug/trace）
 */
export async function getRuntimeLogLevel(): Promise<string> {
  if (!isTauri()) {
    console.warn('[Diagnostics] getRuntimeLogLevel: 非 Tauri 环境，返回默认级别 info')
    return 'info'
  }
  return tauriInvoke<string>('get_log_level')
}

/**
 * 运行时调整日志级别（立即生效 + 持久化）。该命令为写操作，不重试。
 *
 * 非 Tauri 环境直接返回传入的 level（无实际操作）。
 *
 * @param level 目标级别（off/error/warn/info/debug/trace）
 * @returns 生效后的级别字符串
 */
export async function setRuntimeLogLevel(level: string): Promise<string> {
  if (!isTauri()) {
    console.warn('[Diagnostics] setRuntimeLogLevel: 非 Tauri 环境，跳过设置:', level)
    return level
  }
  return tauriInvokeNoRetry<string>('set_log_level', { level })
}

/** 诊断导出结果 */
export interface ExportDiagnosticsResult {
  /** 导出的目录路径（用户可自行访问/压缩/分享） */
  path: string
  /** 实际包含的文件列表 */
  files: string[]
}

/**
 * 导出诊断包（主日志 + 审计日志 + 崩溃日志 + 级别配置）。
 *
 * 该命令为写操作，不重试。非 Tauri 环境返回 null。
 *
 * @returns 诊断包路径与文件列表；非 Tauri 环境返回 null
 */
export async function exportDiagnostics(): Promise<ExportDiagnosticsResult | null> {
  if (!isTauri()) {
    console.warn('[Diagnostics] exportDiagnostics: 非 Tauri 环境，跳过导出')
    return null
  }
  return tauriInvokeNoRetry<ExportDiagnosticsResult>('export_diagnostics')
}