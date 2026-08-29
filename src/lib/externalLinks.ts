/**
 * 外链统一处理：在 Tauri 环境（桌面 + Android）里把外部 http(s) 链接交给
 * 系统默认浏览器打开，而不是在应用内 WebView 里加载。
 *
 * 背景（2026-08-29）：
 * - 安卓端 wry 没有 target=_blank 的新窗口流程，外链会直接加载进应用内 WebView；
 * - 桌面端 Tauri v2 默认拒绝新建窗口，target=_blank 点击无反应；
 * - 复用已有的 `open_application` 命令（open::that 跨平台实现 + shell 元字符校验），
 *   不引入 tauri-plugin-opener，避免重复造轮子。
 *
 * 用法：在 App 挂载时调用 setupExternalLinkInterceptor()（全局一次即可，
 * 覆盖 SettingsWindow / MobileSettingsView / LegalDocument 等所有 target=_blank 链接）。
 */
import { invoke } from '@tauri-apps/api/core'

/** 是否在 Tauri 运行时内（纯浏览器 / vitest jsdom 下为 false，保持默认行为） */
export function isTauriEnvironment(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/**
 * 判断一次锚点点击是否应交给系统浏览器。
 * 返回需要打开的绝对 URL；不应拦截时返回 null。
 */
export function resolveExternalHref(
  anchor: HTMLAnchorElement,
  currentOrigin: string,
): string | null {
  const href = anchor.href
  if (!href || !/^https?:\/\//i.test(href)) return null

  const isExternalOrigin = (() => {
    try {
      return new URL(href).origin !== currentOrigin
    } catch {
      return false
    }
  })()

  // 外部域名，或显式 target=_blank 的同域链接 → 交给系统浏览器
  if (isExternalOrigin || anchor.target === '_blank') return href
  return null
}

let installed = false

/**
 * 安装全局点击拦截（捕获阶段，先于应用内 onClick）。
 * 返回卸载函数，供测试/热更新场景使用；重复调用幂等。
 */
export function setupExternalLinkInterceptor(): () => void {
  if (installed) return () => {}
  installed = true

  const onClick = (event: MouseEvent): void => {
    if (event.defaultPrevented) return
    // 仅处理左键且无修饰键的点击（ctrl/shift/alt/meta 留给用户显式的新窗口/下载行为）
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const path = event.composedPath?.() ?? []
    const anchor =
      (path.find((el) => el instanceof HTMLAnchorElement) as HTMLAnchorElement | undefined) ??
      ((event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null) ??
      undefined
    if (!anchor) return

    const href = resolveExternalHref(anchor, window.location.origin)
    if (href === null) return

    event.preventDefault()
    if (!isTauriEnvironment()) {
      // 纯浏览器环境（开发调试）回退到原生新标签
      window.open(href, '_blank', 'noopener,noreferrer')
      return
    }
    invoke('open_application', { appName: href }).catch(() => {
      window.open(href, '_blank', 'noopener,noreferrer')
    })
  }

  document.addEventListener('click', onClick, true)
  return () => {
    document.removeEventListener('click', onClick, true)
    installed = false
  }
}
