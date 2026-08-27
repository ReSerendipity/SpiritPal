/**
 * @file auditLogger.ts
 * @description 安全审计日志前端封装
 *
 * H-4 修复：提供前端调用 Rust 端 audit_log 命令的统一接口。
 *
 * 审计事件类型：
 * - settings_change: 偏好设置变更
 * - mod_import: 模组导入
 * - character_import: 角色导入
 * - encryption: 加密/解密操作
 * - data_export: 数据导出
 * - data_import: 数据导入
 * - permission_change: 权限变更
 * - llm_provider_change: LLM 服务商切换
 * - security_event: 安全事件
 *
 * 依赖关系：
 * - @tauri-apps/api/core: Tauri invoke
 */

import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@tauri-apps/api/core'

/**
 * 记录安全审计事件
 *
 * @param eventType 事件类型（如 "settings_change" / "mod_import"）
 * @param message 事件描述
 * @param actor 操作者（默认 "user"）
 *
 * @example
 * ```ts
 * import { auditLog } from '@/lib/auditLogger'
 *
 * // 记录设置变更
 * await auditLog('settings_change', '用户修改了语言设置为 en')
 *
 * // 记录模组导入
 * await auditLog('mod_import', '导入了模组 cool-pet.petmod (sha256=abc...)')
 * ```
 */
export async function auditLog(
  eventType: string,
  message: string,
  actor: string = 'user',
): Promise<void> {
  // Tauri 不可用时静默跳过（开发/测试环境）
  if (!isTauri()) return

  try {
    await invoke('audit_log', { eventType, actor, message })
  } catch (e) {
    // 审计日志写入失败不应阻断业务流程
    console.warn('[AuditLogger] Failed to write audit log:', e)
  }
}

/**
 * 审计事件类型常量
 */
export const AuditEventType = {
  SETTINGS_CHANGE: 'settings_change',
  MOD_IMPORT: 'mod_import',
  CHARACTER_IMPORT: 'character_import',
  ENCRYPTION: 'encryption',
  DATA_EXPORT: 'data_export',
  DATA_IMPORT: 'data_import',
  PERMISSION_CHANGE: 'permission_change',
  LLM_PROVIDER_CHANGE: 'llm_provider_change',
  SECURITY_EVENT: 'security_event',
} as const
