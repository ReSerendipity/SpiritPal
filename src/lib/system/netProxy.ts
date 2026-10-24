/**
 * @file netProxy.ts
 * @description 网络统一出口（P0）
 *
 * # 背景
 * 生产构建的 CSP `connect-src` 白名单覆盖不全：Qwen/GLM/Kimi/Doubao（境内）、
 * 本地 Ollama、天气（ipapi/open-meteo）、模组注册表（registry.spiritpal.app）
 * 均被阻断；白名单中却曾有 3 个无实现域名（最小权限违反）。开发模式（Vite dev
 * server 无 CSP 注入）不受影响，导致问题未在 CI 被捕获。
 *
 * # 方案（评估报告 Q1 推荐：Rust 侧代理，不放宽 CSP）
 * - Tauri 运行时：请求经 `http_proxy_stream` 命令由 Rust 侧流式发出
 *   （Rust 侧做第二道 SSRF 校验：私有 IP / 端口 / 回环放行，见 src-tauri/src/http_proxy.rs）。
 * - 非 Tauri 环境（浏览器开发 / Vitest / Playwright web 模式）：回退原生 fetch
 *   保证测试链路不变。
 * - Webview fetch 的语义保持一致：本模块把代理响应重建为标准 `Response`，
 *   调用方无需感知差异。
 */

import { Channel, invoke } from '@tauri-apps/api/core'

/** 是否为 Tauri 运行时（WebView 注入 __TAURI_INTERNALS__） */
export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined'
  )
}

/** 回环地址（localhost / 127/8 / ::1 / 0.0.0.0）：用户显式配置的本地服务端点，放行 */
export function isLoopbackUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname === '0.0.0.0'
    )
  } catch {
    return false
  }
}

/** 与 http_proxy.rs HttpProxyEvent 对应；chunk 是字节，不单独解码 UTF-8。 */
type ProxyStreamEvent =
  | { type: 'headers'; status: number; headers: Array<[string, string]> }
  | { type: 'chunk'; dataBase64: string }
  | { type: 'end' }
  | { type: 'error'; message: string }

/** 把字节缓冲编码为 base64 */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(binary)
}

/** base64 解码为字节缓冲 */
function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

/** 规范化 HeadersInit → [key, value][] */
function headersToPairs(headers: HeadersInit | undefined): Array<[string, string]> {
  if (!headers) return []
  if (Array.isArray(headers)) return headers.map(([k, v]) => [k, v])
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return Array.from(headers.entries())
  }
  return Object.entries(headers as Record<string, string>)
}

/**
 * Tauri 环境下的统一网络出口。
 * 与原生 `fetch(url, init)` 语义对齐，返回标准 `Response`。
 */
export async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const signal = init?.signal
  const abortReason = () => signal?.reason ?? new DOMException('The operation was aborted.', 'AbortError')
  if (signal?.aborted) throw abortReason()

  // 请求体编码：支持 string / ArrayBuffer / Uint8Array
  let bodyB64: string | undefined
  if (init?.body != null) {
    if (typeof init.body === 'string') {
      bodyB64 = toBase64(new TextEncoder().encode(init.body))
    } else if (init.body instanceof ArrayBuffer) {
      bodyB64 = toBase64(new Uint8Array(init.body))
    } else if (init.body instanceof Uint8Array) {
      bodyB64 = toBase64(init.body)
    } else {
      // Blob / FormData 等复杂类型：回退字符串化
      bodyB64 = toBase64(new TextEncoder().encode(String(init.body)))
    }
  }

  const request = {
    url,
    method: init?.method ?? 'GET',
    headers: headersToPairs(init?.headers),
    bodyB64,
    timeoutMs: 120_000,
    maxBodyBytes: 32 * 1024 * 1024,
  }
  // 用户提供的 body/headers 转换也可能同步触发取消。
  if (signal?.aborted) throw abortReason()
  const requestId = crypto.randomUUID()

  return new Promise<Response>((resolve, reject) => {
    let terminal = false
    let receivedHeaders = false
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined
    let registered = false
    let cancelRequested = false
    let abortSent = false
    const onEvent = new Channel<ProxyStreamEvent>()

    const cancelBackend = () => {
      cancelRequested = true
      // invoke 的回复只确认状态表已登记，不等待网络结束。先登记后取消，
      // 避免 abort 抢在 stream command 之前到达而漏掉仍在启动的请求。
      if (registered && !abortSent) {
        abortSent = true
        void invoke('http_proxy_abort', { requestId }).catch(() => {})
      }
    }
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      onEvent.onmessage = () => {}
      // Channel 没有公共 close；不能只等待 Rust Drop（取消/IPC 失败也要释放）。
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: { unregisterCallback: (id: number) => void }
        }
      ).__TAURI_INTERNALS__
      internals.unregisterCallback(onEvent.id)
    }
    const fail = (reason: unknown, cancel = false) => {
      if (terminal) return
      terminal = true
      cleanup()
      if (cancel) cancelBackend()
      if (receivedHeaders) controller?.error(reason)
      else reject(reason)
    }
    const onAbort = () => fail(abortReason(), true)

    onEvent.onmessage = (event) => {
      if (terminal) return
      try {
        switch (event.type) {
          case 'headers': {
            if (receivedHeaders) throw new Error('Duplicate proxy headers')
            const headers = new Headers()
            for (const [k, v] of event.headers) {
              try {
                headers.append(k, v)
              } catch {
                /* 忽略非法响应头，与旧代理一致 */
              }
            }
            const nullBody = request.method.toUpperCase() === 'HEAD' || [204, 205, 304].includes(event.status)
            const body = nullBody
              ? null
              : new ReadableStream<Uint8Array>({
                  start(value) {
                    controller = value
                  },
                  cancel() {
                    if (terminal) return
                    terminal = true
                    cleanup()
                    cancelBackend()
                  },
                })
            const response = new Response(body, { status: event.status, headers })
            receivedHeaders = true
            resolve(response)
            break
          }
          case 'chunk':
            if (!receivedHeaders) throw new Error('Proxy chunk before headers')
            controller?.enqueue(fromBase64(event.dataBase64))
            break
          case 'end':
            if (!receivedHeaders) throw new Error('Proxy ended before headers')
            terminal = true
            cleanup()
            controller?.close()
            break
          case 'error':
            fail(new Error(event.message))
            break
        }
      } catch (error) {
        fail(error, true)
      }
    }

    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }
    try {
      void invoke<void>('http_proxy_stream', { request, requestId, onEvent }).then(
        () => {
          registered = true
          if (cancelRequested) cancelBackend()
        },
        (error: unknown) => fail(error instanceof Error ? error : new Error(String(error))),
      )
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
