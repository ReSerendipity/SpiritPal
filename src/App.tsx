/**
 * @file Application root component (with route persistence)
 * @module App
 * @description
 * SpiritPal application's root component, responsible for mobile/desktop detection,
 * routing distribution and error boundary handling.
 *
 * Main features:
 * - Mobile detection (UA + Tauri platform info)
 * - Hash routing with localStorage persistence
 * - Lazy loading of non-critical components (React.lazy + Suspense)
 * - ErrorBoundary for error capture and logging
 * - Shimeji character preloading
 * - Remove boot-critical CSS after mount
 */
import { Component, useEffect, useState, lazy, Suspense, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import PetWindow from './components/PetWindow'
import { setupExternalLinkInterceptor } from './lib/externalLinks'
import { loadShimejiCharacters } from './lib/shimejiLoader'

const MobileApp = lazy(() => import('./mobile/MobileApp'))
const SettingsWindow = lazy(() => import('./components/SettingsWindow'))
const ChatWindow = lazy(() => import('./components/ChatWindow'))

function detectMobile(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent.toLowerCase()
  if (/android/.test(ua)) return true
  if (/iphone|ipad|ipod/.test(ua)) return true
  if (navigator.maxTouchPoints > 1 && /macintosh/.test(ua)) return true
  if (typeof window !== 'undefined' && (window as unknown as { __TAURI_INTERNALS__?: { platform?: string } }).__TAURI_INTERNALS__?.platform) {
    const platform = (window as unknown as { __TAURI_INTERNALS__?: { platform?: string } }).__TAURI_INTERNALS__?.platform
    if (platform === 'android' || platform === 'ios') return true
  }
  return false
}

function getRoute(): string {
  // URL hash 优先：子窗口（聊天/设置/漫游）通过 index.html#/route 指定自身界面，
  // 不能被 localStorage 里的 last_route（宠物窗口写入的 /pet）覆盖，否则子窗口会渲染成宠物窗口
  const hash = window.location.hash.replace(/^#/, '')
  if (hash) return hash

  // 无 hash 时（如移动端入口/旧版本直达链接）恢复上次路由
  try {
    const lastRoute = localStorage.getItem('spiritpal:last_route')
    if (lastRoute && lastRoute.startsWith('/')) return lastRoute
  } catch {
    // Ignore if localStorage is not available
  }
  return '/pet'
}

export default function App() {
  const [route, setRoute] = useState(getRoute())
  const [isMobile, setIsMobile] = useState<boolean>(() => detectMobile())

  useEffect(() => {
    const onHash = () => setRoute(getRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  // 外链统一交给系统浏览器（安卓 WebView 无 target=_blank 新窗口流程；桌面 Tauri v2 拒绝新窗口请求）
  useEffect(() => setupExternalLinkInterceptor(), [])

  // 安卓桌面小组件 deep link 事件源：spiritpal:// URI → handleWidgetDeepLink（喂食/聊天/宠物/设置）
  useEffect(() => {
    if (!isMobile) return
    let unlisten: (() => void) | null = null
    let cancelled = false
    void (async () => {
      try {
        const { onOpenUrl } = await import('@tauri-apps/plugin-deep-link')
        const { handleWidgetDeepLink } = await import('./lib/widgetState')
        const fn = await onOpenUrl((urls) => {
          urls.forEach((url) => void handleWidgetDeepLink(url).catch(() => {}))
        })
        if (cancelled) fn()
        else unlisten = fn
      } catch {
        // 非 Tauri 环境（纯浏览器/vitest）或插件未就绪：静默跳过
      }
    })()
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [isMobile])

  // Persist route changes to localStorage
  useEffect(() => {
    if (!route) return
    try {
      localStorage.setItem('spiritpal:last_route', route)
    } catch {
      // Ignore if localStorage is not available
    }
  }, [route])

  useEffect(() => {
    const checkMobile = () => setIsMobile(detectMobile())
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    loadShimejiCharacters().catch(() => {})
  }, [])

  useEffect(() => {
    try {
      const critical = document.getElementById('boot-critical-css')
      if (critical) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => critical.remove())
        })
      }
    } catch {
      // no-op
    }
  }, [])

  if (isMobile) {
    return (
      <Suspense fallback={<div className="flex h-screen w-screen items-center justify-center bg-gray-900 text-white">Loading…</div>}>
        <ErrorBoundary>
          <MobileApp />
        </ErrorBoundary>
      </Suspense>
    )
  }

  if (route.startsWith('/settings')) {
    return (
      <Suspense fallback={<div className="flex h-screen w-screen items-center justify-center bg-gray-900 text-white">Loading…</div>}>
        <ErrorBoundary>
          <SettingsWindow />
        </ErrorBoundary>
      </Suspense>
    )
  }
  if (route.startsWith('/chat')) {
    return (
      <Suspense fallback={<div className="flex h-screen w-screen items-center justify-center bg-gray-900 text-white">Loading…</div>}>
        <ErrorBoundary>
          <ChatWindow />
        </ErrorBoundary>
      </Suspense>
    )
  }

  return (
    <ErrorBoundary>
      <PetWindow />
    </ErrorBoundary>
  )
}

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    const fullMsg = `${error.message}\n\nComponent Stack:\n${errorInfo.componentStack ?? ''}`
    console.error('[SpiritPal ErrorBoundary]', fullMsg)
    invoke('log_frontend_error', { level: 'error', message: fullMsg }).catch((e: unknown) => {
      // M-2: 日志上报失败不应阻断 ErrorBoundary，但需记录
      console.warn('[ErrorBoundary] log_frontend_error failed:', e instanceof Error ? e.message : e)
    })
  }

  handleCopy = () => {
    if (!this.state.error) return
    const text = `${this.state.error.message}\n`
    navigator.clipboard.writeText(text).catch((e: unknown) => {
      // M-2: clipboard 写入失败记录
      console.warn('[App] clipboard.writeText failed:', e instanceof Error ? e.message : e)
    })
  }

  render() {
    if (this.state.error) {
      const { error } = this.state
      return (
        <div style={{
          background: 'var(--color-error-bg, #1a0000)', color: 'var(--color-stat-bad, #ef4444)', padding: 20,
          fontFamily: 'Consolas, monospace', fontSize: 13, lineHeight: 1.6,
          minHeight: '100vh', userSelect: 'text', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          overflow: 'auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 18, fontWeight: 'bold', color: 'var(--color-stat-bad, #ef4444)' }}>SpiritPal Error</span>
            <button
              onClick={this.handleCopy}
              aria-label="Copy error message to clipboard"
              style={{
                marginLeft: 16, padding: '4px 12px', background: 'var(--color-ink, #333)', color: 'var(--color-surface, #fff)',
                border: '1px solid var(--color-ink-muted, #666)', borderRadius: 4, cursor: 'pointer', fontSize: 12
              }}
            >
              Copy Error
            </button>
            <span style={{ marginLeft: 12, color: 'var(--color-ink-faint, #888)', fontSize: 11 }}>
              Log saved to: %APPDATA%/com.spiritpal.desktop-pet/logs/spiritpal.log
            </span>
          </div>
          <div style={{ marginBottom: 8 }}>{error.message}</div>
          <div style={{ color: 'var(--color-ink-faint, #888)' }}>{error.stack}</div>
        </div>
      )
    }
    return this.props.children
  }
}
