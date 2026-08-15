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
import { loadShimejiCharacters } from './lib/shimejiLoader'

const MobileApp = lazy(() => import('./mobile/MobileApp'))
const SettingsWindow = lazy(() => import('./components/SettingsWindow'))
const ChatWindow = lazy(() => import('./components/ChatWindow'))
const RoamWindow = lazy(() => import('./components/RoamWindow'))

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
  if (route.startsWith('/roam')) {
    return (
      <Suspense fallback={<div className="h-screen w-screen bg-transparent" />}>
        <ErrorBoundary>
          <RoamWindow />
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
    const fullMsg = `${error.message}\n\nComponent Stack:\n`
    console.error('[SpiritPal ErrorBoundary]', fullMsg)
    invoke('log_frontend_error', { level: 'error', message: fullMsg }).catch(() => {})
  }

  handleCopy = () => {
    if (!this.state.error) return
    const text = `${this.state.error.message}\n`
    navigator.clipboard.writeText(text).catch(() => {})
  }

  render() {
    if (this.state.error) {
      const { error } = this.state
      return (
        <div style={{ 
          background: '#1a0000', color: '#ff6b6b', padding: 20, 
          fontFamily: 'Consolas, monospace', fontSize: 13, lineHeight: 1.6,
          minHeight: '100vh', userSelect: 'text', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          overflow: 'auto'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 18, fontWeight: 'bold', color: '#ff4444' }}>SpiritPal Error</span>
            <button 
              onClick={this.handleCopy}
              style={{
                marginLeft: 16, padding: '4px 12px', background: '#333', color: '#fff',
                border: '1px solid #666', borderRadius: 4, cursor: 'pointer', fontSize: 12
              }}
            >
              Copy Error
            </button>
            <span style={{ marginLeft: 12, color: '#888', fontSize: 11 }}>
              Log saved to: %APPDATA%/com.spiritpal.desktop-pet/logs/spiritpal.log
            </span>
          </div>
          <div style={{ marginBottom: 8 }}>{error.message}</div>
          <div style={{ color: '#888' }}>{error.stack}</div>
        </div>
      )
    }
    return this.props.children
  }
}
