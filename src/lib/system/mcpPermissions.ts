/**
 * MCP 权限与服务器配置管理
 *
 * 供设置页「MCP 管理」面板与工具执行链路（mcpBridge.executeMcpTool）共用：
 * - 内置 spiritpal_* 工具的授权开关（用户在设置页确认/禁用外部 Agent 可调用的工具）
 * - 外部 MCP 服务器注册表（localStorage 持久化，供 McpClient 连接）
 *
 * 设计说明：
 * - 默认全部内置工具启用（首次使用时零配置可用）
 * - 禁用某工具后，外部 Agent 调用会收到诚实的 PERMISSION_DENIED 错误
 */

const TOOLS_PERMISSION_KEY = 'spiritpal-mcp-tool-permissions'
const SERVERS_CONFIG_KEY = 'spiritpal-mcp-servers'

export interface McpPermissionMap {
  /** 工具名 → 是否允许外部 Agent 调用 */
  [toolName: string]: boolean
}

/** 可持久化的外部 MCP 服务器配置（与 mcpClient.McpServerConfig 对齐的精简版） */
export interface McpServerRecord {
  id: string
  name: string
  transport: 'sse' | 'stdio'
  url?: string
  command?: string
  args?: string[]
  enabled: boolean
}

function safeGet(key: string): string | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(key, value)
  } catch {
    /* 隐私模式等场景静默 */
  }
}

// ============ 工具权限 ============

/** 读取工具权限映射（缺省视为允许） */
export function getToolPermissions(): McpPermissionMap {
  const raw = safeGet(TOOLS_PERMISSION_KEY)
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return parsed as McpPermissionMap
    }
    return {}
  } catch {
    return {}
  }
}

/** 判断某内置工具是否被允许调用（默认允许） */
export function isToolAllowed(toolName: string): boolean {
  const perms = getToolPermissions()
  return perms[toolName] !== false
}

/** 设置某工具的授权状态 */
export function setToolAllowed(toolName: string, allowed: boolean): void {
  const perms = getToolPermissions()
  perms[toolName] = allowed
  safeSet(TOOLS_PERMISSION_KEY, JSON.stringify(perms))
}

// ============ 外部服务器注册表 ============

/** 读取已注册的外部 MCP 服务器列表 */
export function getServerRecords(): McpServerRecord[] {
  const raw = safeGet(SERVERS_CONFIG_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return parsed as McpServerRecord[]
    }
    return []
  } catch {
    return []
  }
}

/** 保存外部 MCP 服务器列表 */
export function saveServerRecords(records: McpServerRecord[]): void {
  safeSet(SERVERS_CONFIG_KEY, JSON.stringify(records))
}

/** 生成服务器记录 ID */
export function genServerId(): string {
  return `mcp-srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
