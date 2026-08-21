/**
 * MCP 命令桥 · Webview 端（TS）
 *
 * 监听 Rust 应用进程发来的 `mcp://request` 事件，执行对应工具（executeMcpTool，
 * 真实读写 petStore/enhancedMemory 并驱动 UI），再把结果通过 `mcp_respond` 命令
 * 回填给挂起的 HTTP 请求。配合 `src-tauri/src/mcp_bridge.rs` 完成全链路打通。
 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { executeMcpTool } from './mcpBridge'

/** 收到一次 MCP 工具请求并处理。（导出以便单测/复用） */
export async function handleMcpRequestPayload(payload: {
  id: string
  tool: string
  arguments?: Record<string, unknown>
}): Promise<string> {
  const result = await executeMcpTool(payload.tool, payload.arguments ?? {})
  const text = result.content.map((c) => c.text).join('\n')
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