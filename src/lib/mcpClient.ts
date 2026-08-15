/**
 * MCP（Model Context Protocol）客户端模块
 *
 * @fileoverview 使用 @modelcontextprotocol/sdk 连接外部 MCP 服务器，支持工具发现与执行
 *
 * 主要模块：
 * - McpServerConfig/ExternalTool: MCP 服务器配置与工具定义接口
 * - McpClient: MCP 客户端主类（连接、发现、执行）
 * - 连接管理: SSE/stdio 双传输支持
 *
 * 依赖关系：
 * - @modelcontextprotocol/sdk: MCP 官方 TS SDK
 * - events: EventEmitter 事件机制
 * - mcpInputValidator.ts: 输入安全校验
 *
 * 核心接口：
 * - connect(): 连接到 MCP 服务器
 * - disconnect(): 断开连接
 * - listTools(): 获取可用工具列表
 * - callTool(): 执行工具（含权限检查）
 *
 * 功能特性：
 * - SSE/stdio 双传输协议支持
 * - 工具发现与元数据获取
 * - 工具执行代理 + 输入校验
 * - 心跳健康监控
 * - 连接丢失自动重连（最多5次）
 *
 * 参考：super-agent-party 项目
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { EventEmitter } from 'events'
import { validateMcpInput, type TextValidationOptions } from './mcpInputValidator'

// ============ 类型定义 ============

/** MCP 服务器连接配置 */
export interface McpServerConfig {
  /** 服务器唯一标识 */
  id: string
  /** 服务器显示名称 */
  name: string
  /** 传输类型 */
  transport: 'sse' | 'stdio'
  /** SSE 连接 URL（transport=sse 时必填） */
  url?: string
  /** stdio 命令（transport=stdio 时必填） */
  command?: string
  /** stdio 参数 */
  args?: string[]
  /** 环境变量 */
  env?: Record<string, string>
  /** 连接超时（毫秒，默认 10000） */
  timeout?: number
  /** 最大重连次数（默认 5） */
  maxReconnectAttempts?: number
  /** 重连间隔（毫秒，默认 3000） */
  reconnectInterval?: number
  /** 心跳间隔（毫秒，默认 30000，0=禁用） */
  heartbeatInterval?: number
}

/** 外部工具定义 */
export interface ExternalTool {
  /** 工具名称 */
  name: string
  /** 工具描述 */
  description?: string
  /** 输入参数 JSON Schema */
  inputSchema?: Record<string, unknown>
  /** 所属服务器 ID */
  serverId: string
  /** 是否需要用户授权 */
  requiresAuth?: boolean
}

/** 工具执行结果 */
export interface ToolExecutionResult {
  /** 是否成功 */
  success: boolean
  /** 结果内容 */
  content?: string
  /** 错误消息 */
  error?: string
  /** 执行耗时（毫秒） */
  duration: number
}

/** 连接状态 */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error'

/** 客户端事件 */
export interface McpClientEvents {
  /** 连接状态变化 */
  'status-change': (serverId: string, status: ConnectionStatus) => void
  /** 工具发现完成 */
  'tools-discovered': (serverId: string, tools: ExternalTool[]) => void
  /** 工具执行完成 */
  'tool-executed': (serverId: string, toolName: string, result: ToolExecutionResult) => void
  /** 健康检查失败 */
  'health-check-failed': (serverId: string, reason: string) => void
  /** 重连成功 */
  'reconnected': (serverId: string) => void
  /** 重连失败 */
  'reconnect-failed': (serverId: string, attempts: number) => void
}

// ============ 权限管理 ============

/** 工具权限级别 */
export type ToolPermission = 'allow' | 'confirm' | 'deny'

/** 权限规则 */
export interface PermissionRule {
  /** 服务器 ID（* 表示所有服务器） */
  serverId: string
  /** 工具名模式（支持 * 通配符） */
  toolPattern: string
  /** 权限级别 */
  permission: ToolPermission
}

/** 默认权限规则 — 保守策略：默认需要确认 */
const DEFAULT_PERMISSIONS: PermissionRule[] = [
  { serverId: '*', toolPattern: '*', permission: 'confirm' },
]

// ============ 单个服务器连接 ============

class ServerConnection extends EventEmitter {
  private client: Client | null = null
  private transport: SSEClientTransport | StdioClientTransport | null = null
  private config: McpServerConfig
  private _status: ConnectionStatus = 'disconnected'
  private tools: ExternalTool[] = []
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private lastHealthCheck = 0

  constructor(config: McpServerConfig) {
    super()
    this.config = config
  }

  get status(): ConnectionStatus { return this._status }
  get serverId(): string { return this.config.id }
  get serverName(): string { return this.config.name }
  get discoveredTools(): ExternalTool[] { return [...this.tools] }

  /** 建立连接 */
  async connect(): Promise<void> {
    if (this._status === 'connected' || this._status === 'connecting') return

    this.setStatus('connecting')

    try {
      const timeout = this.config.timeout ?? 10000

      // 创建传输层
      if (this.config.transport === 'sse') {
        if (!this.config.url) throw new Error('SSE 传输需要提供 url')
        this.transport = new SSEClientTransport(new URL(this.config.url))
      } else {
        if (!this.config.command) throw new Error('stdio 传输需要提供 command')
        this.transport = new StdioClientTransport({
          command: this.config.command,
          args: this.config.args,
          env: this.config.env as Record<string, string> | undefined,
        })
      }

      // 创建客户端
      this.client = new Client(
        { name: `spiritpal-client-${this.config.id}`, version: '1.0.0' },
        { capabilities: {} },
      )

      // 连接（带超时）
      await Promise.race([
        this.client.connect(this.transport),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('连接超时')), timeout),
        ),
      ])

      this.setStatus('connected')
      this.reconnectAttempts = 0

      // 发现工具
      await this.discoverTools()

      // 启动心跳
      this.startHeartbeat()
    } catch (err) {
      this.setStatus('error')
      const msg = err instanceof Error ? err.message : String(err)
      this.emit('connection-error', msg)
      this.attemptReconnect()
    }
  }

  /** 断开连接 */
  async disconnect(): Promise<void> {
    this.stopHeartbeat()
    this.clearReconnectTimer()

    if (this.client) {
      try {
        await this.client.close()
      } catch {
        // 忽略关闭错误
      }
      this.client = null
    }
    this.transport = null
    this.tools = []
    this.setStatus('disconnected')
  }

  /** 发现工具 */
  private async discoverTools(): Promise<void> {
    if (!this.client) return

    try {
      const result = await this.client.listTools()
      this.tools = (result.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown> | undefined,
        serverId: this.config.id,
      }))
      this.emit('tools-discovered', this.tools)
    } catch (err) {
      console.warn(`[MCP Client] 工具发现失败 (${this.config.id}):`, err)
    }
  }

  /** 执行工具 */
  async executeTool(
    toolName: string,
    args: Record<string, unknown>,
    validationOptions?: TextValidationOptions,
  ): Promise<ToolExecutionResult> {
    if (!this.client || this._status !== 'connected') {
      return {
        success: false,
        error: '客户端未连接',
        duration: 0,
      }
    }

    // 对字符串参数进行输入校验
    if (validationOptions) {
      for (const [key, value] of Object.entries(args)) {
        if (typeof value === 'string') {
          const result = validateMcpInput(value, { ...validationOptions, fieldName: key })
          if (!result.valid) {
            return {
              success: false,
              error: `参数校验失败: ${result.error}`,
              duration: 0,
            }
          }
        }
      }
    }

    const startTime = Date.now()
    try {
      const result = await this.client.callTool({ name: toolName, arguments: args })
      const duration = Date.now() - startTime

      // 提取文本内容
      const textContent = ((result.content ?? []) as Array<{ type: string; text?: string }>)
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('\n')

      return {
        success: !result.isError,
        content: textContent,
        error: result.isError ? textContent : undefined,
        duration,
      }
    } catch (err) {
      const duration = Date.now() - startTime
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration,
      }
    }
  }

  /** 健康检查 */
  async healthCheck(): Promise<boolean> {
    if (!this.client || this._status !== 'connected') return false

    try {
      // 使用 ping 检查连接是否存活
      await this.client.ping()
      this.lastHealthCheck = Date.now()
      return true
    } catch {
      this.emit('health-check-failed', 'ping 失败')
      return false
    }
  }

  /** 启动心跳 */
  private startHeartbeat(): void {
    const interval = this.config.heartbeatInterval ?? 30000
    if (interval <= 0) return

    this.heartbeatTimer = setInterval(async () => {
      const alive = await this.healthCheck()
      if (!alive && this._status === 'connected') {
        this.setStatus('error')
        this.attemptReconnect()
      }
    }, interval)
  }

  /** 停止心跳 */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  /** 尝试重连 */
  private attemptReconnect(): void {
    const maxAttempts = this.config.maxReconnectAttempts ?? 5
    const interval = this.config.reconnectInterval ?? 3000

    if (this.reconnectAttempts >= maxAttempts) {
      this.emit('reconnect-failed', this.reconnectAttempts)
      return
    }

    this.setStatus('reconnecting')
    this.reconnectAttempts++

    this.reconnectTimer = setTimeout(async () => {
      try {
        // 先断开旧连接
        if (this.client) {
          try { await this.client.close() } catch { /* 忽略 */ }
          this.client = null
        }
        this.transport = null
        this.setStatus('disconnected')

        // 重新连接
        await this.connect()
        this.emit('reconnected')
      } catch {
        this.attemptReconnect()
      }
    }, interval)
  }

  /** 清除重连定时器 */
  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /** 更新状态 */
  private setStatus(status: ConnectionStatus): void {
    if (this._status === status) return
    const prev = this._status
    this._status = status
    this.emit('status-change', status, prev)
  }
}

// ============ MCP 客户端管理器 ============

export class McpClientManager extends EventEmitter {
  private connections = new Map<string, ServerConnection>()
  private permissions: PermissionRule[] = [...DEFAULT_PERMISSIONS]
  private confirmedTools = new Set<string>()

  /** 注册外部 MCP 服务器 */
  async registerServer(config: McpServerConfig): Promise<void> {
    if (this.connections.has(config.id)) {
      console.warn(`[MCP Client] 服务器 ${config.id} 已注册，先断开旧连接`)
      await this.unregisterServer(config.id)
    }

    const conn = new ServerConnection(config)

    // 代理事件
    conn.on('status-change', (status: ConnectionStatus) => {
      this.emit('status-change', config.id, status)
    })
    conn.on('tools-discovered', (tools: ExternalTool[]) => {
      this.emit('tools-discovered', config.id, tools)
    })
    conn.on('tool-executed', (toolName: string, result: ToolExecutionResult) => {
      this.emit('tool-executed', config.id, toolName, result)
    })
    conn.on('health-check-failed', (reason: string) => {
      this.emit('health-check-failed', config.id, reason)
    })
    conn.on('reconnected', () => {
      this.emit('reconnected', config.id)
    })
    conn.on('reconnect-failed', (attempts: number) => {
      this.emit('reconnect-failed', config.id, attempts)
    })

    this.connections.set(config.id, conn)
    await conn.connect()
  }

  /** 注销外部 MCP 服务器 */
  async unregisterServer(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId)
    if (conn) {
      await conn.disconnect()
      this.connections.delete(serverId)
    }
  }

  /** 获取所有已发现的工具 */
  getAllTools(): ExternalTool[] {
    const tools: ExternalTool[] = []
    for (const conn of this.connections.values()) {
      tools.push(...conn.discoveredTools)
    }
    return tools
  }

  /** 获取指定服务器的工具 */
  getServerTools(serverId: string): ExternalTool[] {
    return this.connections.get(serverId)?.discoveredTools ?? []
  }

  /** 执行外部工具 */
  async executeTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    validationOptions?: TextValidationOptions,
  ): Promise<ToolExecutionResult> {
    const conn = this.connections.get(serverId)
    if (!conn) {
      return {
        success: false,
        error: `服务器 ${serverId} 未注册`,
        duration: 0,
      }
    }

    // 权限检查
    const permission = this.checkPermission(serverId, toolName)
    if (permission === 'deny') {
      return {
        success: false,
        error: `工具 ${toolName} 被权限规则拒绝`,
        duration: 0,
      }
    }
    if (permission === 'confirm') {
      const toolKey = `${serverId}:${toolName}`
      if (!this.confirmedTools.has(toolKey)) {
        return {
          success: false,
          error: `工具 ${toolName} 需要用户确认后才能执行`,
          duration: 0,
        }
      }
    }

    const result = await conn.executeTool(toolName, args, validationOptions)
    this.emit('tool-executed', serverId, toolName, result)
    return result
  }

  /** 确认工具执行权限 */
  confirmTool(serverId: string, toolName: string): void {
    this.confirmedTools.add(`${serverId}:${toolName}`)
  }

  /** 撤销工具执行权限 */
  revokeToolConfirmation(serverId: string, toolName: string): void {
    this.confirmedTools.delete(`${serverId}:${toolName}`)
  }

  /** 设置权限规则 */
  setPermissions(rules: PermissionRule[]): void {
    this.permissions = [...rules]
  }

  /** 获取当前权限规则 */
  getPermissions(): PermissionRule[] {
    return [...this.permissions]
  }

  /** 检查工具权限 */
  private checkPermission(serverId: string, toolName: string): ToolPermission {
    // 从最具体的规则开始匹配
    for (const rule of this.permissions) {
      if (this.matchRule(rule, serverId, toolName)) {
        return rule.permission
      }
    }
    return 'confirm' // 默认需要确认
  }

  /** 匹配权限规则 */
  private matchRule(rule: PermissionRule, serverId: string, toolName: string): boolean {
    // 服务器 ID 匹配
    if (rule.serverId !== '*' && rule.serverId !== serverId) return false
    // 工具名模式匹配（支持 * 通配符）
    if (rule.toolPattern === '*') return true
    if (rule.toolPattern === toolName) return true
    // 简单的通配符匹配
    const regex = new RegExp('^' + rule.toolPattern.replace(/\*/g, '.*') + '$')
    return regex.test(toolName)
  }

  /** 获取所有服务器状态 */
  getAllStatus(): Map<string, ConnectionStatus> {
    const result = new Map<string, ConnectionStatus>()
    for (const [id, conn] of this.connections) {
      result.set(id, conn.status)
    }
    return result
  }

  /** 断开所有连接 */
  async disconnectAll(): Promise<void> {
    const promises = Array.from(this.connections.keys()).map((id) =>
      this.unregisterServer(id),
    )
    await Promise.all(promises)
  }

  /** 销毁管理器 */
  async destroy(): Promise<void> {
    await this.disconnectAll()
    this.permissions = [...DEFAULT_PERMISSIONS]
    this.confirmedTools.clear()
    this.removeAllListeners()
  }
}

// ============ 单例 ============

let mcpClientManager: McpClientManager | null = null

/** 获取 MCP 客户端管理器单例 */
export function getMcpClientManager(): McpClientManager {
  if (!mcpClientManager) {
    mcpClientManager = new McpClientManager()
  }
  return mcpClientManager
}

/** 重置 MCP 客户端管理器 */
export async function resetMcpClientManager(): Promise<void> {
  if (mcpClientManager) {
    await mcpClientManager.destroy()
    mcpClientManager = null
  }
}
