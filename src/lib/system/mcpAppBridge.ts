/**
 * MCP 命令桥 · Webview 端（TS）
 *
 * 监听 Rust 应用进程发来的 `mcp://request` 事件，执行对应工具（executeMcpTool，
 * 真实读写 petStore/enhancedMemory 并驱动 UI），再把结果通过 `mcp_respond` 命令
 * 回填给挂起的 HTTP 请求。配合 `src-tauri/src/mcp_bridge.rs` 完成全链路打通。
 */
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { executeMcpTool } from './mcpBridge'
import { getMcpHooksManager } from './mcpHooks'

/** 收到一次 MCP 工具请求并处理。（导出以便单测/复用） */
export async function handleMcpRequestPayload(payload: {
  id: string
  tool: string
  arguments?: Record<string, unknown>
}): Promise<string> {
  const hooks = getMcpHooksManager()

  // 前置钩子：宠物可在工具执行前做出反应，或（基于规则/用户配置）阻断工具
  const pre = hooks.firePreHook({
    toolName: payload.tool,
    args: payload.arguments ?? {},
    timestamp: Date.now(),
  })
  if (!pre.proceed) {
    return JSON.stringify({ isError: true, text: pre.error ?? 'blocked by pre-hook' })
  }
  const finalArgs = pre.modifiedArgs ?? payload.arguments ?? {}

  const startedAt = Date.now()
  const result = await executeMcpTool(payload.tool, finalArgs)
  const duration = Date.now() - startedAt

  // 后置钩子：工具执行后触发宠物反应（如表情/吐槽），失败不阻断结果返回
  try {
    hooks.firePostHook({
      toolName: payload.tool,
      args: finalArgs,
      timestamp: startedAt,
      success: result.isError !== true,
      duration,
      result: JSON.stringify(result),
    })
  } catch (err) {
    console.warn('[mcpAppBridge] post-hook failed (non-fatal):', err)
  }

  const text = result.content.map((c: { type: 'text'; text: string }) => c.text).join('\n')
  return JSON.stringify({ isError: result.isError === true, text })
}

/** 注册事件监听；返回取消函数（应在 app 启动/前端挂载时调用） */
export function startMcpAppBridge(): (() => void) | null {
  let unlisten: UnlistenFn | null = null
  // 监听 Rust 侧发来的工具调用请求
  void listen<{ id: string; tool: string; arguments?: Record<string, unknown> }>(
    'mcp://request',
    (event) => {
      const { id, tool, arguments: args } = event.payload
      void handleMcpRequestPayload({ id, tool, arguments: args ?? {} })
        .then((result) => {
          // 回填挂起的 HTTP 响应
          void invoke('mcp_respond', { id, result }).catch(() => {
            /* 忽略回调失败 */
          })
        })
        .catch(() => {
          void invoke('mcp_respond', {
            id,
            result: JSON.stringify({ isError: true, text: 'tool execution failed' }),
          }).catch(() => { /* 忽略 */ })
        })
    },
  ).then((fn) => {
    unlisten = fn
  })
  return () => {
    unlisten?.()
  }
}