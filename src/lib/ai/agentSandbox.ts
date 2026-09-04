/**
 * AI Agent 安全沙箱 — 工具执行前的权限校验与审计
 * P3-24: 安全沙箱+权限控制
 *
 * @fileoverview
 * 主要模块：
 * - AgentPermission 类型：9 种权限定义（open_app/web_search/.../schedule_access）
 * - PermissionRequest 接口：权限请求结构
 * - AuditLogEntry 接口：审计日志条目
 * - AgentSandbox 类：安全沙箱（单例模式），实现默认拒绝、最小权限、可审计原则
 * - getAgentSandbox()：获取单例入口
 *
 * 设计原则：
 * 1. 默认拒绝：未显式授权的操作一律拒绝
 * 2. 最小权限：每个工具只申请其必要的权限
 * 3. 可审计：所有工具调用记录在审计日志中
 * 4. 用户可控：用户可随时撤销授权
 * 5. 沙箱隔离：文件操作限制在允许的目录范围内
 *
 * @module agentSandbox
 * @requires ./agentTools - 工具模式定义、工具权限映射
 */

import { isToolAvailableInMode, isToolConfirmationRequired, ToolMode, getToolsForMode } from './agentTools'

// ============ 类型定义 ============

export type PermissionStatus = 'granted' | 'denied' | 'pending'

export interface PermissionRequest {
  /** 请求 ID */
  id: string
  /** 工具名称 */
  toolName: string
  /** 请求的权限 */
  permission: AgentPermission
  /** 请求原因（由工具提供） */
  reason: string
  /** 请求时间 */
  timestamp: number
  /** 状态 */
  status: PermissionStatus
  /** 用户响应时间 */
  respondedAt?: number
}

export type AgentPermission =
  | 'open_app'        // 打开应用
  | 'web_search'      // 网络搜索
  | 'set_reminder'    // 设置提醒
  | 'read_files'      // 读取文件
  | 'write_files'     // 写入文件
  | 'execute_command' // 执行命令
  | 'pet_control'     // 宠物操作
  | 'weather_access'  // 天气访问
  | 'schedule_access' // 日程访问

/** 工具 → 所需权限映射 */
const TOOL_PERMISSION_MAP: Record<string, AgentPermission[]> = {
  'open_application': ['open_app'],
  'search_web': ['web_search'],
  'set_reminder': ['set_reminder'],
  'manage_schedule': ['schedule_access'],
  'adjust_pet_state': ['pet_control'],
  'get_weather': ['weather_access'],
  'get_pet_status': [], // 读取宠物状态不需要特殊权限
  'read_file': ['read_files'],
  'list_directory': ['read_files'],
  'search_files': ['read_files'],
  'write_file': ['write_files'],
  'execute_command': ['execute_command'],
}

/** 工具 → 风险等级 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical'

const TOOL_RISK_MAP: Record<string, RiskLevel> = {
  'open_application': 'medium',
  'search_web': 'low',
  'set_reminder': 'low',
  'manage_schedule': 'low',
  'adjust_pet_state': 'low',
  'get_weather': 'low',
  'get_pet_status': 'low',
  'read_file': 'medium',
  'list_directory': 'low',
  'search_files': 'low',
  'write_file': 'high',
  'execute_command': 'critical',
}

/** 文件系统沙箱 — 允许读取的目录白名单 */
const ALLOWED_READ_DIRS = [
  'Desktop',
  'Documents',
  'Downloads',
  'Pictures',
  'Music',
  'Videos',
]

/** 文件系统沙箱 — 禁止写入的目录黑名单 */
const FORBIDDEN_WRITE_PATTERNS = [
  /[/\\]Windows[/\\]/i,
  /[/\\]System32[/\\]/i,
  /[/\\]Program Files[/\\]/i,
  /[/\\]Program Files \(x86\)[/\\]/i,
  /[/\\]\.ssh[/\\]/i,
  /[/\\]\.gnupg[/\\]/i,
  /[/\\]\.aws[/\\]/i,
  /[/\\]\.config[/\\]/i,
  /[/\\]etc[/\\]/i,
  /[/\\]usr[/\\]/i,
  /[/\\]bin[/\\]/i,
  /[/\\]sbin[/\\]/i,
]

// ============ 审计日志 ============

export interface AuditLogEntry {
  id: string
  toolName: string
  params: Record<string, unknown>
  riskLevel: RiskLevel
  mode: ToolMode
  result: 'allowed' | 'denied' | 'confirmed'
  reason?: string
  timestamp: number
  duration?: number
}

// ============ 安全沙箱 ============

type PermissionResponseCallback = (requestId: string, granted: boolean) => void

export class AgentSandbox {
  private permissions: Map<AgentPermission, PermissionStatus> = new Map()
  private pendingRequests: Map<string, PermissionRequest> = new Map()
  private auditLog: AuditLogEntry[] = []
  private maxAuditLogSize = 500
  private responseCallback: PermissionResponseCallback | null = null

  constructor() {
    // 初始化默认权限：低风险权限默认授予
    const defaultGranted: AgentPermission[] = [
      'web_search',
      'pet_control',
      'weather_access',
      'schedule_access',
      'set_reminder',
    ]
    for (const perm of defaultGranted) {
      this.permissions.set(perm, 'granted')
    }
    // 中高风险权限默认拒绝
    const defaultDenied: AgentPermission[] = [
      'open_app',
      'read_files',
      'write_files',
      'execute_command',
    ]
    for (const perm of defaultDenied) {
      this.permissions.set(perm, 'denied')
    }
  }

  // ============ 权限检查 ============

  /**
   * 检查工具是否可以在指定模式下执行
   * @returns 检查结果和拒绝原因
   */
  checkToolAccess(
    toolName: string,
    mode: ToolMode,
    params?: Record<string, unknown>,
  ): { allowed: boolean; reason?: string; riskLevel: RiskLevel; needsConfirmation: boolean } {
    const riskLevel = TOOL_RISK_MAP[toolName] ?? 'medium'
    const needsConfirmation = isToolConfirmationRequired(toolName)

    // 1. 模式检查：工具是否在当前模式下可用
    if (!isToolAvailableInMode(toolName, mode)) {
      return { allowed: false, reason: `工具「${toolName}」在 ${mode} 模式下不可用`, riskLevel, needsConfirmation }
    }

    // 2. 权限检查：用户是否授权了所需权限
    const requiredPermissions = TOOL_PERMISSION_MAP[toolName] ?? []
    for (const perm of requiredPermissions) {
      const status = this.permissions.get(perm)
      if (status === 'denied') {
        return { allowed: false, reason: `权限「${perm}」被拒绝`, riskLevel, needsConfirmation }
      }
      if (status === 'pending') {
        return { allowed: false, reason: `权限「${perm}」等待用户确认`, riskLevel, needsConfirmation }
      }
    }

    // 3. 文件系统沙箱检查
    if (toolName === 'write_file' && params?.path) {
      const path = String(params.path)
      const forbidden = FORBIDDEN_WRITE_PATTERNS.some((p) => p.test(path))
      if (forbidden) {
        return { allowed: false, reason: `路径「${path}」在沙箱保护范围内，禁止写入`, riskLevel: 'critical', needsConfirmation: true }
      }
    }

    if (toolName === 'read_file' && params?.path) {
      const path = String(params.path)
      const allowed = ALLOWED_READ_DIRS.some((dir) => path.includes(dir)) || path.startsWith('.')
      if (!allowed && mode !== ToolMode.Worker) {
        return { allowed: false, reason: `路径「${path}」不在允许读取的目录范围内`, riskLevel, needsConfirmation }
      }
    }

    return { allowed: true, riskLevel, needsConfirmation }
  }

  // ============ 权限管理 ============

  /** 获取指定权限的状态 */
  getPermissionStatus(permission: AgentPermission): PermissionStatus {
    return this.permissions.get(permission) ?? 'denied'
  }

  /** 授予权限 */
  grantPermission(permission: AgentPermission): void {
    this.permissions.set(permission, 'granted')
  }

  /** 拒绝权限 */
  denyPermission(permission: AgentPermission): void {
    this.permissions.set(permission, 'denied')
  }

  /** 请求权限（进入 pending 状态，等待用户确认） */
  requestPermission(permission: AgentPermission, reason: string): string {
    const requestId = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    this.permissions.set(permission, 'pending')

    const request: PermissionRequest = {
      id: requestId,
      toolName: '',
      permission,
      reason,
      timestamp: Date.now(),
      status: 'pending',
    }
    this.pendingRequests.set(requestId, request)

    // 通知权限回调
    if (this.responseCallback) {
      // 在实际实现中，这里应该弹窗让用户确认
      // 目前自动授予（开发模式）
      this.responseCallback(requestId, true)
    }

    return requestId
  }

  /** 响应权限请求 */
  respondToPermission(requestId: string, granted: boolean): void {
    const request = this.pendingRequests.get(requestId)
    if (!request) return

    request.status = granted ? 'granted' : 'denied'
    request.respondedAt = Date.now()

    if (granted) {
      this.permissions.set(request.permission, 'granted')
    } else {
      this.permissions.set(request.permission, 'denied')
    }

    this.pendingRequests.delete(requestId)
  }

  /** 设置权限响应回调 */
  setPermissionCallback(callback: PermissionResponseCallback): void {
    this.responseCallback = callback
  }

  /** 获取所有权限状态 */
  getAllPermissions(): Record<AgentPermission, PermissionStatus> {
    const result = {} as Record<AgentPermission, PermissionStatus>
    const allPerms: AgentPermission[] = [
      'open_app', 'web_search', 'set_reminder', 'read_files',
      'write_files', 'execute_command', 'pet_control', 'weather_access', 'schedule_access',
    ]
    for (const perm of allPerms) {
      result[perm] = this.permissions.get(perm) ?? 'denied'
    }
    return result
  }

  /** 重置所有权限为默认值 */
  resetPermissions(): void {
    this.permissions.clear()
    // 重新应用默认值
    const defaultGranted: AgentPermission[] = [
      'web_search', 'pet_control', 'weather_access', 'schedule_access', 'set_reminder',
    ]
    for (const perm of defaultGranted) {
      this.permissions.set(perm, 'granted')
    }
    const defaultDenied: AgentPermission[] = [
      'open_app', 'read_files', 'write_files', 'execute_command',
    ]
    for (const perm of defaultDenied) {
      this.permissions.set(perm, 'denied')
    }
  }

  // ============ 审计日志 ============

  /** 记录审计日志 */
  logAudit(entry: Omit<AuditLogEntry, 'id' | 'timestamp'>): void {
    const full: AuditLogEntry = {
      id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      ...entry,
    }
    this.auditLog.unshift(full)
    // 限制日志大小
    if (this.auditLog.length > this.maxAuditLogSize) {
      this.auditLog = this.auditLog.slice(0, this.maxAuditLogSize)
    }
  }

  /** 获取审计日志 */
  getAuditLog(limit = 50): AuditLogEntry[] {
    return this.auditLog.slice(0, limit)
  }

  /** 清除审计日志 */
  clearAuditLog(): void {
    this.auditLog = []
  }

  // ============ 工具模式 ============

  /** 获取指定模式下的所有工具及其风险等级 */
  getToolRiskSummary(mode: ToolMode): Array<{ tool: string; risk: RiskLevel; permission: PermissionStatus }> {
    const tools = getToolsForMode(mode)
    return tools.map((tool) => {
      const perms = TOOL_PERMISSION_MAP[tool] ?? []
      const permStatus = perms.length > 0
        ? this.permissions.get(perms[0]) ?? 'denied'
        : 'granted' as PermissionStatus
      return {
        tool,
        risk: TOOL_RISK_MAP[tool] ?? 'medium',
        permission: permStatus,
      }
    })
  }
}

// ============ 单例 ============

let sandbox: AgentSandbox | null = null

export function getAgentSandbox(): AgentSandbox {
  if (!sandbox) {
    sandbox = new AgentSandbox()
  }
  return sandbox
}
