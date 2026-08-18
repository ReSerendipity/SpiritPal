/**
 * mcpClient 契约测试 — MCP 客户端管理器
 *
 * 测什么：
 * - McpClientManager 的连接/注册/注销/工具发现/工具执行生命周期
 * - 权限规则匹配（allow / confirm / deny、通配符、模式匹配）
 * - 工具确认（confirmTool / revokeToolConfirmation）
 * - 输入校验失败、客户端未连接、callTool 抛错等错误路径
 * - 单例（getMcpClientManager / resetMcpClientManager）
 *
 * 网络层（@modelcontextprotocol/sdk）全部 mock，不发起真实网络请求。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ============ Mock 依赖（必须先于 import 源模块）============

/** 共享的 mock Client 实例，跨测试复用，beforeEach 重置 */
const mockClientInstance = {
  connect: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  listTools: vi.fn().mockResolvedValue({ tools: [] as unknown[] }),
  callTool: vi.fn(),
  ping: vi.fn<() => Promise<unknown>>().mockResolvedValue({}),
}

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn(function () {
    return mockClientInstance
  }),
}))

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: vi.fn(function () {
    return {
      start: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      send: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    }
  }),
}))

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn(function () {
    return {
      start: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      close: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      send: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    }
  }),
}))

vi.mock('../mcpInputValidator', () => ({
  validateMcpInput: vi.fn().mockReturnValue({ valid: true }),
  MAX_TEXT_LENGTH: 2000,
  MAX_ID_LENGTH: 100,
}))

import {
  McpClientManager,
  getMcpClientManager,
  resetMcpClientManager,
  type McpServerConfig,
  type PermissionRule,
} from '../mcpClient'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { validateMcpInput } from '../mcpInputValidator'

/** 构造一个心跳关闭、重连关闭的 SSE 配置，避免测试触发真实定时器 */
function sseConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'server-1',
    name: 'Test Server',
    transport: 'sse',
    url: 'https://mcp.example.com/sse',
    heartbeatInterval: 0,
    maxReconnectAttempts: 0,
    timeout: 30,
    ...overrides,
  }
}

function stdioConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'server-2',
    name: 'Stdio Server',
    transport: 'stdio',
    command: 'node',
    args: ['server.js'],
    heartbeatInterval: 0,
    maxReconnectAttempts: 0,
    timeout: 30,
    ...overrides,
  }
}

const SAMPLE_TOOLS = [
  { name: 'echo', description: 'Echo back', inputSchema: { type: 'object' } },
  { name: 'add', description: 'Add numbers', inputSchema: { type: 'object' } },
]

describe('getMcpClientManager / resetMcpClientManager 单例', () => {
  beforeEach(async () => {
    await resetMcpClientManager()
  })

  it('多次调用返回同一实例', () => {
    const a = getMcpClientManager()
    const b = getMcpClientManager()
    expect(a).toBe(b)
  })

  it('reset 后返回新实例', async () => {
    const a = getMcpClientManager()
    await resetMcpClientManager()
    const b = getMcpClientManager()
    expect(a).not.toBe(b)
  })
})

describe('McpClientManager 连接与工具发现', () => {
  let mgr: McpClientManager

  beforeEach(async () => {
    vi.clearAllMocks()
    mockClientInstance.connect.mockResolvedValue(undefined)
    mockClientInstance.listTools.mockResolvedValue({ tools: SAMPLE_TOOLS })
    mockClientInstance.callTool.mockReset()
    mockClientInstance.ping.mockResolvedValue({})
    await resetMcpClientManager()
    mgr = new McpClientManager()
  })

  it('registerServer(SSE) 连接成功后状态为 connected 并发现工具', async () => {
    await mgr.registerServer(sseConfig())
    expect(mockClientInstance.connect).toHaveBeenCalledTimes(1)
    expect(mgr.getAllStatus().get('server-1')).toBe('connected')
    expect(mgr.getServerTools('server-1')).toHaveLength(2)
    expect(mgr.getServerTools('server-1')[0]).toMatchObject({
      name: 'echo',
      serverId: 'server-1',
    })
  })

  it('SSE 传输用 URL 构造 SSEClientTransport', async () => {
    await mgr.registerServer(sseConfig({ url: 'https://mcp.example.com/events' }))
    expect(SSEClientTransport).toHaveBeenCalled()
    const urlArg = vi.mocked(SSEClientTransport).mock.calls[0][0]
    expect(urlArg).toBeInstanceOf(URL)
    expect((urlArg as URL).href).toBe('https://mcp.example.com/events')
  })

  it('stdio 传输用 command/args 构造 StdioClientTransport', async () => {
    await mgr.registerServer(stdioConfig())
    expect(StdioClientTransport).toHaveBeenCalledWith({
      command: 'node',
      args: ['server.js'],
      env: undefined,
    })
    expect(mgr.getAllStatus().get('server-2')).toBe('connected')
  })

  it('SSE 缺 url 时连接失败，状态为 error', async () => {
    await mgr.registerServer(
      sseConfig({ id: 'no-url', transport: 'sse', url: undefined }),
    )
    expect(mgr.getAllStatus().get('no-url')).toBe('error')
  })

  it('stdio 缺 command 时连接失败，状态为 error', async () => {
    await mgr.registerServer(
      stdioConfig({ id: 'no-cmd', transport: 'stdio', command: undefined }),
    )
    expect(mgr.getAllStatus().get('no-cmd')).toBe('error')
  })

  it('重复注册同一 id 先断开旧连接再建立新连接', async () => {
    await mgr.registerServer(sseConfig())
    await mgr.registerServer(sseConfig({ name: 'Renamed' }))
    expect(mockClientInstance.close).toHaveBeenCalled()
    // 最终只有一个连接
    expect(mgr.getAllStatus().size).toBe(1)
  })

  it('注册时发出 status-change 事件（connecting → connected）', async () => {
    const events: Array<[string, string]> = []
    mgr.on('status-change', (id: string, status: string) => events.push([id, status]))
    await mgr.registerServer(sseConfig())
    expect(events).toContainEqual(['server-1', 'connecting'])
    expect(events).toContainEqual(['server-1', 'connected'])
  })

  it('注册时发出 tools-discovered 事件', async () => {
    const spy = vi.fn()
    mgr.on('tools-discovered', spy)
    await mgr.registerServer(sseConfig())
    expect(spy).toHaveBeenCalledWith('server-1', expect.any(Array))
    expect(spy.mock.calls[0][1]).toHaveLength(2)
  })
})

describe('McpClientManager 注销', () => {
  let mgr: McpClientManager

  beforeEach(async () => {
    vi.clearAllMocks()
    mockClientInstance.connect.mockResolvedValue(undefined)
    mockClientInstance.listTools.mockResolvedValue({ tools: SAMPLE_TOOLS })
    mockClientInstance.close.mockResolvedValue(undefined)
    await resetMcpClientManager()
    mgr = new McpClientManager()
  })

  it('unregisterServer 关闭连接并移除', async () => {
    await mgr.registerServer(sseConfig())
    await mgr.unregisterServer('server-1')
    expect(mockClientInstance.close).toHaveBeenCalled()
    expect(mgr.getAllStatus().has('server-1')).toBe(false)
    expect(mgr.getServerTools('server-1')).toEqual([])
  })

  it('unregisterServer 未注册的 id 不抛错', async () => {
    await expect(mgr.unregisterServer('ghost')).resolves.toBeUndefined()
  })

  it('disconnectAll 断开所有连接', async () => {
    await mgr.registerServer(sseConfig())
    await mgr.registerServer(stdioConfig())
    await mgr.disconnectAll()
    expect(mgr.getAllStatus().size).toBe(0)
    expect(mockClientInstance.close).toHaveBeenCalledTimes(2)
  })

  it('destroy 清空权限和确认状态', async () => {
    mgr.setPermissions([{ serverId: '*', toolPattern: 'allow-all', permission: 'allow' }])
    mgr.confirmTool('server-1', 'echo')
    await mgr.destroy()
    expect(mgr.getPermissions()).toEqual([
      { serverId: '*', toolPattern: '*', permission: 'confirm' },
    ])
  })
})

describe('McpClientManager.executeTool 权限与确认', () => {
  let mgr: McpClientManager

  beforeEach(async () => {
    vi.clearAllMocks()
    mockClientInstance.connect.mockResolvedValue(undefined)
    mockClientInstance.listTools.mockResolvedValue({ tools: SAMPLE_TOOLS })
    mockClientInstance.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'hello' }],
      isError: false,
    })
    await resetMcpClientManager()
    mgr = new McpClientManager()
    await mgr.registerServer(sseConfig())
  })

  it('默认权限 confirm：未确认时拒绝执行', async () => {
    const r = await mgr.executeTool('server-1', 'echo', {})
    expect(r.success).toBe(false)
    expect(r.error).toContain('需要用户确认')
    expect(mockClientInstance.callTool).not.toHaveBeenCalled()
  })

  it('确认后执行成功，返回文本内容', async () => {
    mgr.confirmTool('server-1', 'echo')
    const r = await mgr.executeTool('server-1', 'echo', {})
    expect(r.success).toBe(true)
    expect(r.content).toBe('hello')
    expect(r.error).toBeUndefined()
    expect(mockClientInstance.callTool).toHaveBeenCalledWith({
      name: 'echo',
      arguments: {},
    })
  })

  it('撤销确认后再次拒绝', async () => {
    mgr.confirmTool('server-1', 'echo')
    mgr.revokeToolConfirmation('server-1', 'echo')
    const r = await mgr.executeTool('server-1', 'echo', {})
    expect(r.success).toBe(false)
    expect(r.error).toContain('需要用户确认')
  })

  it('deny 规则拒绝执行', async () => {
    mgr.setPermissions([{ serverId: 'server-1', toolPattern: 'echo', permission: 'deny' }])
    const r = await mgr.executeTool('server-1', 'echo', {})
    expect(r.success).toBe(false)
    expect(r.error).toContain('被权限规则拒绝')
    expect(mockClientInstance.callTool).not.toHaveBeenCalled()
  })

  it('allow 规则无需确认直接执行', async () => {
    mgr.setPermissions([{ serverId: 'server-1', toolPattern: 'echo', permission: 'allow' }])
    const r = await mgr.executeTool('server-1', 'echo', {})
    expect(r.success).toBe(true)
    expect(r.content).toBe('hello')
  })

  it('执行未注册服务器返回错误', async () => {
    const r = await mgr.executeTool('ghost', 'echo', {})
    expect(r.success).toBe(false)
    expect(r.error).toBe('服务器 ghost 未注册')
  })

  it('执行成功发出 tool-executed 事件', async () => {
    mgr.setPermissions([{ serverId: '*', toolPattern: '*', permission: 'allow' }])
    const spy = vi.fn()
    mgr.on('tool-executed', spy)
    await mgr.executeTool('server-1', 'echo', {})
    expect(spy).toHaveBeenCalledWith(
      'server-1',
      'echo',
      expect.objectContaining({ success: true }),
    )
  })
})

describe('McpClientManager 权限规则匹配', () => {
  let mgr: McpClientManager

  beforeEach(async () => {
    vi.clearAllMocks()
    mockClientInstance.connect.mockResolvedValue(undefined)
    mockClientInstance.listTools.mockResolvedValue({ tools: SAMPLE_TOOLS })
    mockClientInstance.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    })
    await resetMcpClientManager()
    mgr = new McpClientManager()
    await mgr.registerServer(sseConfig())
  })

  it('通配符 serverId=* 匹配任意服务器', async () => {
    mgr.setPermissions([{ serverId: '*', toolPattern: 'echo', permission: 'allow' }])
    const r = await mgr.executeTool('server-1', 'echo', {})
    expect(r.success).toBe(true)
  })

  it('toolPattern=* 匹配任意工具', async () => {
    mgr.setPermissions([{ serverId: 'server-1', toolPattern: '*', permission: 'allow' }])
    const r = await mgr.executeTool('server-1', 'add', {})
    expect(r.success).toBe(true)
  })

  it('通配符模式匹配前缀（echo*）', async () => {
    mgr.setPermissions([
      { serverId: 'server-1', toolPattern: 'echo*', permission: 'allow' },
    ])
    const r = await mgr.executeTool('server-1', 'echo2', {})
    expect(r.success).toBe(true)
  })

  it('按规则顺序，首个匹配规则生效', async () => {
    mgr.setPermissions([
      { serverId: 'server-1', toolPattern: 'echo', permission: 'deny' },
      { serverId: '*', toolPattern: '*', permission: 'allow' },
    ])
    const r = await mgr.executeTool('server-1', 'echo', {})
    expect(r.success).toBe(false)
    expect(r.error).toContain('被权限规则拒绝')
  })

  it('setPermissions 返回副本而非引用', async () => {
    const rules: PermissionRule[] = [
      { serverId: 'x', toolPattern: 'y', permission: 'allow' },
    ]
    mgr.setPermissions(rules)
    rules.push({ serverId: 'z', toolPattern: 'z', permission: 'deny' })
    expect(mgr.getPermissions()).toHaveLength(1)
  })
})

describe('ServerConnection.executeTool 输入校验与错误处理', () => {
  let mgr: McpClientManager

  beforeEach(async () => {
    vi.clearAllMocks()
    mockClientInstance.connect.mockResolvedValue(undefined)
    mockClientInstance.listTools.mockResolvedValue({ tools: SAMPLE_TOOLS })
    mockClientInstance.callTool.mockReset()
    vi.mocked(validateMcpInput).mockReturnValue({ valid: true })
    await resetMcpClientManager()
    mgr = new McpClientManager()
    // allow 规则便于直接测试底层 executeTool 行为
    mgr.setPermissions([{ serverId: '*', toolPattern: '*', permission: 'allow' }])
    await mgr.registerServer(sseConfig())
  })

  it('输入校验失败返回参数校验失败错误', async () => {
    vi.mocked(validateMcpInput).mockReturnValue({
      valid: false,
      error: '包含代码关键字',
      failedLayer: 3,
    })
    const r = await mgr.executeTool(
      'server-1',
      'echo',
      { text: 'function foo() {}' },
      { detectCode: true },
    )
    expect(r.success).toBe(false)
    expect(r.error).toContain('参数校验失败')
    expect(mockClientInstance.callTool).not.toHaveBeenCalled()
  })

  it('校验只作用于字符串参数', async () => {
    mockClientInstance.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
      isError: false,
    })
    const r = await mgr.executeTool(
      'server-1',
      'echo',
      { count: 3, label: 'hi' },
      { detectCode: true },
    )
    expect(r.success).toBe(true)
    // 字符串参数触发校验，数字参数不触发
    expect(validateMcpInput).toHaveBeenCalledWith('hi', expect.objectContaining({ fieldName: 'label' }))
    expect(validateMcpInput).not.toHaveBeenCalledWith(3, expect.anything())
  })

  it('callTool 返回 isError=true 时 success=false 且 error 为文本内容', async () => {
    mockClientInstance.callTool.mockResolvedValue({
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
    })
    const r = await mgr.executeTool('server-1', 'echo', {})
    expect(r.success).toBe(false)
    expect(r.error).toBe('boom')
  })

  it('callTool 抛错时 success=false 且携带错误消息', async () => {
    mockClientInstance.callTool.mockRejectedValue(new Error('network down'))
    const r = await mgr.executeTool('server-1', 'echo', {})
    expect(r.success).toBe(false)
    expect(r.error).toBe('network down')
  })

  it('多段文本内容按换行拼接', async () => {
    mockClientInstance.callTool.mockResolvedValue({
      content: [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
        { type: 'image', data: 'xxx' },
      ],
      isError: false,
    })
    const r = await mgr.executeTool('server-1', 'echo', {})
    expect(r.success).toBe(true)
    expect(r.content).toBe('a\nb')
  })
})

describe('McpClientManager.getAllStatus / getAllTools 聚合', () => {
  let mgr: McpClientManager

  beforeEach(async () => {
    vi.clearAllMocks()
    mockClientInstance.connect.mockResolvedValue(undefined)
    mockClientInstance.listTools.mockResolvedValue({ tools: SAMPLE_TOOLS })
    await resetMcpClientManager()
    mgr = new McpClientManager()
  })

  it('getAllTools 汇总所有服务器工具并标注 serverId', async () => {
    await mgr.registerServer(sseConfig())
    await mgr.registerServer(stdioConfig({ id: 'server-2' }))
    const tools = mgr.getAllTools()
    expect(tools).toHaveLength(4)
    expect(tools.filter((t) => t.serverId === 'server-1')).toHaveLength(2)
    expect(tools.filter((t) => t.serverId === 'server-2')).toHaveLength(2)
  })

  it('空管理器 getAllTools 返回空数组', () => {
    expect(mgr.getAllTools()).toEqual([])
  })

  it('getServerTools 未知 id 返回空数组', () => {
    expect(mgr.getServerTools('nope')).toEqual([])
  })
})

describe('Client 构造参数', () => {
  let mgr: McpClientManager

  beforeEach(async () => {
    vi.clearAllMocks()
    mockClientInstance.connect.mockResolvedValue(undefined)
    mockClientInstance.listTools.mockResolvedValue({ tools: [] })
    await resetMcpClientManager()
    mgr = new McpClientManager()
  })

  it('以服务器 id 命名客户端', async () => {
    await mgr.registerServer(sseConfig({ id: 'my-server' }))
    expect(Client).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'spiritpal-client-my-server' }),
      expect.anything(),
    )
  })
})
