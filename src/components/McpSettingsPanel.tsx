/**
 * MCP 管理面板（设置页）
 *
 * P1-MCP：设置页 MCP 管理
 * - 内置 spiritpal_* 工具授权开关（外部 Agent 可调用的工具确认，持久化到 localStorage）
 * - 外部 MCP 服务器注册（增/删/启停，SSE 端点真实握手探测）
 * - 本机命令桥连接信息展示（供外部 Agent 配置参考）
 *
 * 说明：stdio 类型的外部服务器无法在 webview 内 spawn 进程，
 * 注册信息会持久化并诚实提示由外部 Agent（spiritpal-mcp）侧使用。
 */
import { useCallback, useState } from 'react'
import { Plug, Plus, ShieldAlert, ShieldCheck, Server, Trash2, Wifi, WifiOff } from 'lucide-react'
import {
  isToolAllowed,
  setToolAllowed,
  getServerRecords,
  saveServerRecords,
  genServerId,
  type McpServerRecord,
} from '../lib/mcpPermissions'
import { BrandButton, BrandInput, BrandSelect } from './ui'

// ============ 内置工具清单（与 mcpBridge.MCP_TOOL_NAMES 对应） ============

const BUILT_IN_TOOLS: Array<{ name: string; label: string; description: string }> = [
  { name: 'spiritpal_status', label: '状态查询', description: '读取宠物等级/饥饿/心情/健康/好感/金币' },
  { name: 'spiritpal_react', label: '动作反应', description: '让宠物播放指定反应动画' },
  { name: 'spiritpal_say', label: '气泡说话', description: '让宠物说一句话（5 层输入安全校验）' },
  { name: 'spiritpal_memory', label: '记忆查询', description: '搜索或统计宠物记忆（只读）' },
  { name: 'spiritpal_memory_edit', label: '记忆编辑', description: '创建/更新/删除记忆（写入持久化，建议按需授权）' },
  { name: 'spiritpal_feed', label: '喂食', description: '消耗库存食物投喂宠物' },
  { name: 'spiritpal_pet', label: '抚摸', description: '抚摸宠物提升好感度' },
]

// ============ SSE 端点探测（纯 fetch，不引入 Node 依赖） ============

interface ProbeResult {
  reachable: boolean
  toolsDiscovered?: number
  error?: string
}

/** 通过 MCP SSE 握手探测外部服务器：GET /sse 获取 endpoint → POST initialize */
async function probeSseServer(url: string): Promise<ProbeResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const sseUrl = new URL(url)
    const resp = await fetch(sseUrl.toString(), {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
    })

    if (!resp.ok || !resp.body) {
      return { reachable: false, error: `HTTP ${resp.status}` }
    }

    // 读取 SSE 首个 endpoint 事件（拿到 messages POST 地址）
    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let messagesPath: string | null = null

    const deadline = Date.now() + 4000
    while (Date.now() < deadline && !messagesPath) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const match = buffer.match(/data:\s*(\/messages[^\s]*|http[^\s]*messages[^\s]*)/)
      if (match) messagesPath = match[1]
    }
    controller.abort()

    if (!messagesPath) {
      return { reachable: true, error: '端点可达，但未返回 MCP endpoint 事件（可能非 MCP 服务）' }
    }

    // 向 messages 端点发送 initialize 握手
    const postUrl = messagesPath.startsWith('http')
      ? messagesPath
      : new URL(messagesPath, sseUrl).toString()

    const initReq = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'spiritpal-settings', version: '1.0.0' },
      },
    }

    const initResp = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(initReq),
    })

    if (!initResp.ok) {
      return { reachable: true, error: `端点可达，initialize 返回 HTTP ${initResp.status}` }
    }

    return { reachable: true, toolsDiscovered: undefined }
  } catch (err) {
    const msg = err instanceof Error ? (err.name === 'AbortError' ? '连接超时（5s）' : err.message) : String(err)
    return { reachable: false, error: msg }
  } finally {
    clearTimeout(timeout)
  }
}

// ============ 组件 ============

type ProbeEntry = { status: 'idle' } | { status: 'probing' } | { status: 'done'; result: ProbeResult }

export function McpSettingsPanel() {
  // 惰性初始化：权限与服务器注册表存于 localStorage，挂载时一次性读取
  const [permissions, setPermissions] = useState<Record<string, boolean>>(
    () => Object.fromEntries(BUILT_IN_TOOLS.map(t => [t.name, isToolAllowed(t.name)])),
  )
  const [servers, setServers] = useState<McpServerRecord[]>(() => getServerRecords())
  const [probeState, setProbeState] = useState<Record<string, ProbeEntry>>({})
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState({ name: '', transport: 'sse' as 'sse' | 'stdio', url: '', command: '' })

  const toggleTool = useCallback((toolName: string, allowed: boolean) => {
    setToolAllowed(toolName, allowed)
    setPermissions(prev => ({ ...prev, [toolName]: allowed }))
  }, [])

  const addServer = useCallback(() => {
    if (!form.name.trim()) return
    if (form.transport === 'sse' && !form.url.trim()) return
    if (form.transport === 'stdio' && !form.command.trim()) return

    const record: McpServerRecord = {
      id: genServerId(),
      name: form.name.trim(),
      transport: form.transport,
      url: form.transport === 'sse' ? form.url.trim() : undefined,
      command: form.transport === 'stdio' ? form.command.trim() : undefined,
      enabled: true,
    }
    const next = [...servers, record]
    setServers(next)
    saveServerRecords(next)
    setForm({ name: '', transport: 'sse', url: '', command: '' })
    setShowAddForm(false)
  }, [form, servers])

  const removeServer = useCallback((id: string) => {
    const next = servers.filter(s => s.id !== id)
    setServers(next)
    saveServerRecords(next)
  }, [servers])

  const toggleServer = useCallback((id: string) => {
    const next = servers.map(s => (s.id === id ? { ...s, enabled: !s.enabled } : s))
    setServers(next)
    saveServerRecords(next)
  }, [servers])

  const probeServer = useCallback(async (record: McpServerRecord) => {
    if (record.transport !== 'sse' || !record.url) {
      setProbeState(prev => ({
        ...prev,
        [record.id]: { status: 'done', result: { reachable: false, error: 'stdio 服务器需在外部 Agent（spiritpal-mcp）侧启动' } },
      }))
      return
    }
    setProbeState(prev => ({ ...prev, [record.id]: { status: 'probing' } }))
    const result = await probeSseServer(record.url)
    setProbeState(prev => ({ ...prev, [record.id]: { status: 'done', result } }))
  }, [])

  return (
    <div className="space-y-6">
      {/* 命令桥连接信息 */}
      <section className="rounded-xl bg-cream-deep/40 p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Server className="h-4 w-4" /> 本机命令桥
        </h3>
        <p className="mb-2 text-xs text-ink-muted">
          SpiritPal 运行时会自动监听本机命令桥（默认 127.0.0.1:3124，一次性 Token 鉴权）。
          外部 Agent（Claude / Cursor 等）通过 <code className="rounded bg-cream-deep px-1">spiritpal-mcp</code> stdio
          服务接入，即可驱动下方已授权的工具。
        </p>
        <pre className="overflow-x-auto rounded-lg bg-cream-deep/70 p-3 text-[10px] leading-relaxed">
{`# 外部 Agent MCP 配置示例（claude_desktop_config.json）
{
  "mcpServers": {
    "spiritpal": {
      "command": "spiritpal-mcp",
      "env": { "SPIRITPAL_MCP_BRIDGE_ADDR": "127.0.0.1:3124" }
    }
  }
}`}
        </pre>
      </section>

      {/* 内置工具授权 */}
      <section>
        <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
          <Plug className="h-4 w-4" /> 外部 Agent 工具授权
        </h3>
        <p className="mb-3 text-xs text-ink-muted">关闭后外部 Agent 调用该工具会被拒绝（PERMISSION_DENIED）</p>
        <div className="space-y-2">
          {BUILT_IN_TOOLS.map(tool => {
            const allowed = permissions[tool.name] !== false
            const sensitive = tool.name === 'spiritpal_memory_edit'
            return (
              <label
                key={tool.name}
                className="flex cursor-pointer items-center justify-between rounded-lg bg-cream-deep/30 p-3 transition-colors hover:bg-cream-deep/50"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{tool.label}</span>
                    <span className="truncate font-mono text-[10px] text-ink-muted">{tool.name}</span>
                    {sensitive && allowed && (
                      <span className="flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                        <ShieldAlert className="h-3 w-3" /> 写入型
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-ink-muted">{tool.description}</p>
                </div>
                <input
                  type="checkbox"
                  checked={allowed}
                  onChange={(e) => toggleTool(tool.name, e.target.checked)}
                  className="ml-3 h-4 w-4 flex-shrink-0 accent-amber-500"
                />
              </label>
            )
          })}
        </div>
      </section>

      {/* 外部 MCP 服务器 */}
      <section>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Wifi className="h-4 w-4" /> 外部 MCP 服务器
          </h3>
          <BrandButton size="sm" onClick={() => setShowAddForm(v => !v)}>
            <Plus className="mr-1 h-3 w-3" /> 添加
          </BrandButton>
        </div>
        <p className="mb-3 text-xs text-ink-muted">
          登记宠物要连接的外部 MCP 服务（SSE 可在此直接探测连通性）
        </p>

        {showAddForm && (
          <div className="mb-3 space-y-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
            <BrandInput
              placeholder="名称（如：天气服务）"
              value={form.name}
              onChange={(value) => setForm(f => ({ ...f, name: value }))}
            />
            <BrandSelect
              value={form.transport}
              options={[
                { value: 'sse', label: 'SSE（HTTP 长连接）' },
                { value: 'stdio', label: 'stdio（外部 Agent 侧启动）' },
              ]}
              onChange={(value) => setForm(f => ({ ...f, transport: value as 'sse' | 'stdio' }))}
            />
            {form.transport === 'sse' ? (
              <BrandInput
                placeholder="http://localhost:PORT/sse"
                value={form.url}
                onChange={(value) => setForm(f => ({ ...f, url: value }))}
              />
            ) : (
              <BrandInput
                placeholder="启动命令（如 npx -y some-mcp-server）"
                value={form.command}
                onChange={(value) => setForm(f => ({ ...f, command: value }))}
              />
            )}
            <div className="flex justify-end gap-2">
              <BrandButton size="sm" variant="ghost" onClick={() => setShowAddForm(false)}>取消</BrandButton>
              <BrandButton size="sm" onClick={addServer}>保存</BrandButton>
            </div>
          </div>
        )}

        {servers.length === 0 && !showAddForm && (
          <p className="rounded-lg bg-cream-deep/30 p-3 text-center text-xs text-ink-muted">
            暂未登记外部 MCP 服务器
          </p>
        )}

        <div className="space-y-2">
          {servers.map(record => {
            const entry = probeState[record.id] ?? { status: 'idle' as const }
            const probing = entry.status === 'probing'
            const result = entry.status === 'done' ? entry.result : null
            return (
              <div key={record.id} className="rounded-lg bg-cream-deep/30 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{record.name}</span>
                    <span className="rounded bg-cream-deep px-1.5 py-0.5 text-[10px] uppercase">
                      {record.transport}
                    </span>
                    {!record.enabled && (
                      <span className="rounded bg-gray-200 px-1.5 py-0.5 text-[10px] text-gray-500">已停用</span>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      className="rounded p-1.5 text-ink-muted hover:bg-cream-deep hover:text-ink"
                      title={record.enabled ? '停用' : '启用'}
                      onClick={() => toggleServer(record.id)}
                    >
                      {record.enabled
                        ? <ShieldCheck className="h-4 w-4 text-emerald-500" />
                        : <ShieldAlert className="h-4 w-4 text-gray-400" />}
                    </button>
                    <button
                      className="flex items-center gap-1 rounded p-1.5 text-ink-muted hover:bg-cream-deep hover:text-ink"
                      title="探测连通性"
                      onClick={() => void probeServer(record)}
                    >
                      {probing ? (
                        <Wifi className="h-4 w-4 animate-pulse" />
                      ) : result?.reachable ? (
                        <Wifi className="h-4 w-4 text-emerald-500" />
                      ) : result && !result.reachable ? (
                        <WifiOff className="h-4 w-4 text-red-400" />
                      ) : (
                        <Wifi className="h-4 w-4" />
                      )}
                    </button>
                    <button
                      className="rounded p-1.5 text-ink-muted hover:bg-red-50 hover:text-red-500"
                      title="删除"
                      onClick={() => removeServer(record.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {record.url && (
                  <p className="mt-1 truncate font-mono text-[10px] text-ink-muted">{record.url}</p>
                )}
                {record.command && (
                  <p className="mt-1 truncate font-mono text-[10px] text-ink-muted">{record.command}</p>
                )}
                {result?.error && (
                  <p className="mt-1 text-[11px] text-red-500">{result.error}</p>
                )}
                {result?.reachable && !result.error && (
                  <p className="mt-1 text-[11px] text-emerald-600">MCP 握手成功，端点可用</p>
                )}
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
