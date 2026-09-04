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
 * - Tauri 运行时：所有网络请求经 `http_proxy` 命令由 Rust 侧发出
 *   （Rust 侧做第二道 SSRF 校验：私有 IP / 端口 / 回环放行，见 src-tauri/src/http_proxy.rs）。
 * - 非 Tauri 环境（浏览器开发 / Vitest / Playwright web 模式）：回退原生 fetch
 *   保证测试链路不变。
 * - Webview fetch 的语义保持一致：本模块把代理响应重建为标准 `Response`，
 *   调用方无需感知差异。
 */

import { invoke } from '@tauri-apps/api/core'

/** 是否为 Tauri 运行时（WebView 注入 __TAURI_INTERNALS__） */
export function isTauriRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
      'undefined'
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

/** Rust http_proxy 命令的响应载荷（与 http_proxy.rs HttpProxyResponse 对应） */
interface ProxyResponsePayload {
  status: number
  headers: Array<[string, string]>
  bodyBase64: string
}

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

  const payload = await invoke<ProxyResponsePayload>('http_proxy', {
    request: {
      url,
      method: init?.method ?? 'GET',
      headers: headersToPairs(init?.headers),
      bodyB64,
      timeoutMs: 120_000,
      maxBodyBytes: 32 * 1024 * 1024,
    },
  })

  const bodyBytes = fromBase64(payload.bodyBase64)
  const headers = new Headers()
  for (const [k, v] of payload.headers) {
    try {
      headers.set(k, v)
    } catch {
      // 非法头名/值（非 UTF-8 等）忽略，不阻断响应
    }
  }
  return new Response(bodyBytes, { status: payload.status, headers })
}