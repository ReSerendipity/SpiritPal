// 外链统一处理单元测试 — 判定逻辑 + 全局点击拦截
// 背景：安卓 WebView 无 target=_blank 新窗口流程，外链需交给系统浏览器（复用 open_application 命令）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveExternalHref, setupExternalLinkInterceptor, isTauriEnvironment } from '@/lib/system/externalLinks'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

function makeAnchor(href: string, target = ''): HTMLAnchorElement {
  const a = document.createElement('a')
  a.href = href
  a.target = target
  return a
}

describe('resolveExternalHref', () => {
  it('外部域名链接返回绝对 URL', () => {
    const a = makeAnchor('https://github.com/ReSerendipity/DraftPeek')
    expect(resolveExternalHref(a, 'http://localhost:1420')).toBe(
      'https://github.com/ReSerendipity/DraftPeek',
    )
  })

  it('同域 target=_blank 链接也交给系统浏览器', () => {
    const a = makeAnchor('http://localhost:1420/docs', '_blank')
    expect(resolveExternalHref(a, 'http://localhost:1420')).toBe('http://localhost:1420/docs')
  })

  it('同域普通链接不拦截（应用内路由）', () => {
    const a = makeAnchor('http://localhost:1420/settings')
    expect(resolveExternalHref(a, 'http://localhost:1420')).toBeNull()
  })

  it('非 http(s) 协议不拦截（hash/mailto 等）', () => {
    const a = makeAnchor('mailto:someone@example.com')
    expect(resolveExternalHref(a, 'http://localhost:1420')).toBeNull()
  })
})

describe('setupExternalLinkInterceptor', () => {
  let teardown: () => void

  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(undefined)
    // 模拟 Tauri 环境
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  })

  afterEach(() => {
    teardown?.()
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })

  it('点击外链锚点 → preventDefault 并调用 open_application', () => {
    teardown = setupExternalLinkInterceptor()
    const a = makeAnchor('https://www.bing.com/search?q=1', '_blank')
    document.body.appendChild(a)

    let defaultPrevented = false
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    a.addEventListener('click', (e) => {
      defaultPrevented = e.defaultPrevented
    })
    a.dispatchEvent(event)

    expect(defaultPrevented).toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith('open_application', {
      appName: 'https://www.bing.com/search?q=1',
    })
    a.remove()
  })

  it('点击同域内部链接不拦截、不调用命令', () => {
    teardown = setupExternalLinkInterceptor()
    const a = makeAnchor(`${window.location.origin}/pet`)
    document.body.appendChild(a)
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))

    expect(mockInvoke).not.toHaveBeenCalled()
    a.remove()
  })

  it('带修饰键的点击不拦截（保留浏览器原生行为）', () => {
    teardown = setupExternalLinkInterceptor()
    const a = makeAnchor('https://example.com', '_blank')
    document.body.appendChild(a)
    a.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }),
    )

    expect(mockInvoke).not.toHaveBeenCalled()
    a.remove()
  })

  it('isTauriEnvironment 反映 __TAURI_INTERNALS__ 存在性', () => {
    expect(isTauriEnvironment()).toBe(true)
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    expect(isTauriEnvironment()).toBe(false)
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
  })
})
