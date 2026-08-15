/**
 * @file 应用入口文件
 * @module main
 * @description
 * SpiritPal 应用的启动入口，负责全局错误捕获、初始化和 React 根组件挂载。
 *
 * ⚠️ 关键可靠性设计（防止白屏/空白透明窗口）：
 * 1. **绝不静态导入 App**：App 及其依赖链（PetWindow、usePetWindows 等）大量文件在
 *    模块顶层 `import { invoke } from '@tauri-apps/api/core'`。如果 Tauri API 注入时序
 *    异常（__TAURI_INTERNALS__ 未就绪），这些模块在 ESM 解析阶段就会同步抛错，
 *    导致整个入口文件在第一行就终止执行。因此：
 *    - main.tsx 自身对 Tauri API 零顶层静态依赖
 *    - App.tsx 通过 `import('./App')` 动态导入，所有错误都能被 catch
 * 2. **同步初始化全部 try/catch 包裹**：任何一项失败都不能阻塞 React 挂载。
 * 3. **index.html 内联 boot 遮罩 + 内联 window.onerror**：保证哪怕 ESM 解析阶段
 *    直接崩溃，用户也能看到启动动画和错误信息。
 * 4. **四层兜底**：
 *    - index.html 内联 boot 遮罩（JS 零依赖）
 *    - index.html 内联 window.onerror（在所有 ESM 之前注册）
 *    - main.tsx window.addEventListener('error'/'unhandledrejection')
 *    - React ErrorBoundary（组件级）
 */
import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { initAllCharacters } from './stores/petStore'
import { setLanguage as i18nSetLanguage } from './lib/i18n'
import { trackAppLaunch } from './lib/analytics'
import { runtimeMonitor } from './lib/runtimeMonitor'
import Logger from './lib/logger'

// =========================================================================
// safeInvoke：延迟动态 import 的 invoke 安全封装
// =========================================================================
// 这里故意不做顶层 import { invoke } from '@tauri-apps/api/core'，
// 避免 Tauri API 在模块装载阶段同步访问 __TAURI_INTERNALS__ 导致整个入口崩溃。
// 改为首次调用时才 import，并在不可用时降级为 no-op。
let _invoke: ((cmd: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null
let _invokeTried = false

/**
 * 安全的 Tauri invoke 调用
 * - 首次调用时懒加载 @tauri-apps/api/core
 * - 加载失败/环境不可用则静默返回 Promise.resolve(undefined)
 * - 任何异常都吞掉，避免未捕获 Promise rejection
 */
async function safeInvoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
  if (!_invokeTried && !_invoke) {
    _invokeTried = true
    try {
      const mod = await import('@tauri-apps/api/core')
      if (typeof mod.invoke === 'function') {
        _invoke = mod.invoke as unknown as typeof _invoke
      }
    } catch {
      // 非 Tauri 环境 or Tauri API 注入失败 → 保持 _invoke = null
    }
  }
  if (!_invoke) return undefined
  try {
    return (await _invoke(cmd, args)) as T
  } catch {
    return undefined
  }
}

/**
 * 移除 index.html 中的 boot 加载遮罩
 * 不管是否有初始化错误，只要 React 挂载完成就移除遮罩，
 * 让用户看到真实的页面内容或 ErrorBoundary 的错误页面
 */
function dismissBootLoading(delayMs = 150) {
  try {
    setTimeout(() => {
      const el = document.getElementById('boot-loading')
      if (el) {
        el.classList.add('hidden')
        // 过渡结束后从 DOM 中移除，避免拦截点击
        setTimeout(() => el.remove(), 350)
      }
      const criticalCss = document.getElementById('boot-critical-css')
      void criticalCss
    }, delayMs)
  } catch {
    // no-op
  }
}

/**
 * 渲染致命错误面板（当 App 依赖链本身加载失败时使用）
 */
function renderFatalErrorToRoot(title: string, detail: string) {
  dismissBootLoading(0)
  const rootEl = document.getElementById('root')
  if (rootEl) {
    rootEl.innerHTML =
      '<div style="padding:24px;color:#ff6b6b;background:#1a0000;min-height:100vh;font-family:Consolas,monospace;font-size:13px;line-height:1.6;overflow:auto;">' +
      '<h3 style="color:#ff4444;margin:0 0 12px 0;">' + title + '</h3>' +
      '<div style="white-space:pre-wrap;word-break:break-all;">' + detail + '</div>' +
      '<div style="margin-top:16px;color:#888;font-size:11px;">日志路径：%LOCALAPPDATA%\\com.spiritpal.desktop-pet\\logs\\spiritpal.log</div>' +
      '</div>'
  }
  void safeInvoke('log_frontend_error', {
    level: 'error',
    message: `[${title}] ${detail}`,
  })
}

/**
 * 格式化错误日志内容
 */
function getErrorPayload(prefix: string, msg: string, source?: string, lineno?: number, colno?: number) {
  const parts = [prefix, msg]
  if (source) parts.push(`  at ${source}:${lineno ?? '?'}:${colno ?? '?'}`)
  return parts.join('\n')
}

/**
 * 全局 JS 错误事件监听
 */
window.addEventListener('error', (event) => {
  const { message, filename, lineno, colno, error } = event
  const stackMsg = error instanceof Error ? `\n${error.stack ?? ''}` : ''
  const payload = getErrorPayload('[SpiritPal GlobalError]', message, filename, lineno, colno) + stackMsg
  Logger.error(payload)
})

/**
 * 全局未处理的 Promise rejection 监听
 */
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  const msg = reason instanceof Error ? `${reason.message}\n${reason.stack ?? ''}` : String(reason)
  Logger.error(`[SpiritPal UnhandledRejection] ${msg}`)
})

// ============================================================
// 同步初始化：全部 try/catch 包裹，任何一项失败都不能阻塞渲染
// ============================================================
try {
  initAllCharacters()
} catch (err) {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  try { console.error('[SpiritPal] initAllCharacters failed (non-fatal)', msg) } catch { /* no-op */ }
  void safeInvoke('log_frontend_error', {
    level: 'warn',
    message: `[SpiritPal initAllCharacters FAILED - non-fatal] ${msg}`,
  })
}

try {
  runtimeMonitor.start()
} catch (err) {
  const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  try { console.error('[SpiritPal] runtimeMonitor.start failed (non-fatal)', msg) } catch { /* no-op */ }
  void safeInvoke('log_frontend_error', {
    level: 'warn',
    message: `[SpiritPal runtimeMonitor FAILED - non-fatal] ${msg}`,
  })
}

try {
  const raw = localStorage.getItem('spiritpal-settings-store')
  if (raw) {
    const parsed = JSON.parse(raw)
    const lang = parsed?.state?.language
    if (lang === 'zh' || lang === 'en' || lang === 'ja' || lang === 'ko' || lang === 'zh-TW') {
      i18nSetLanguage(lang)
    }
  }
} catch {
  // 忽略解析错误，使用默认中文
}

try {
  const platform = typeof navigator !== 'undefined' ? (navigator.platform || 'unknown') : 'unknown'
  trackAppLaunch(platform, '0.1.0', false)
} catch {
  // 忽略埋点错误
}

// ============================================================
// Windows 置顶保活：应用启动时自动启用
// 调用 Rust 端 start_topmost_keepalive 命令，在后台线程中 16ms 轮询 SetWindowPos(HWND_TOPMOST)。
// 非 Windows 平台为空操作，不会产生副作用。
// 使用动态 import 避免在模块顶层引入 Tauri API 依赖。
// ============================================================
try {
  void import('./lib/windowManager').then(({ enableWindowsPinMode }) => {
    return enableWindowsPinMode()
  }).catch(() => {
    // 非 Tauri 环境或模块加载失败，静默降级
  })
} catch {
  // 忽略置顶保活初始化错误
}

// ============================================================
// 最终：动态 import App → 确保依赖链任何错误都能被 catch
// 这是修复「白屏」的关键：如果因 Tauri API 静态导入导致依赖链解析失败，
// 我们也会手动渲染错误面板，而不是让页面一直显示 boot-loading
// ============================================================
const rootEl = document.getElementById('root')

if (!rootEl) {
  renderFatalErrorToRoot(
    'SpiritPal 启动失败（Critical）',
    'index.html 中找不到 #root 元素，页面结构已损坏。请重新安装。',
  )
} else {
  // 用 Promise.resolve().then 包裹，确保动态 import 抛错时能走 catch（动态 import 是 Promise）
  Promise.resolve()
    .then(() => import('./App'))
    .then(({ default: App }) => {
      const root = ReactDOM.createRoot(rootEl)
      root.render(
        <React.StrictMode>
          <App />
        </React.StrictMode>,
      )
      dismissBootLoading()
    })
    .catch((importErr) => {
      const detail = importErr instanceof Error
        ? `${importErr.message}\n${importErr.stack ?? ''}`
        : String(importErr)
      // 把错误信息也写到 DOM 上的 boot-loading stuck 区域，用户不看日志也能看到
      try {
        const stuck = document.getElementById('boot-module-error')
        if (stuck) stuck.textContent = detail
        const boot = document.getElementById('boot-loading')
        if (boot) boot.classList.add('stuck')
      } catch { /* no-op */ }
      renderFatalErrorToRoot('SpiritPal 启动失败（App 模块加载失败）', detail)
    })
}
