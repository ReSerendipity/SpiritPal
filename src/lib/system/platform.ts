/**
 * 运行时平台判定
 *
 * @fileoverview 集中管理「是否为移动端口径」的嗅探，避免多处重复 userAgent 正则。
 *
 * 用途：
 * - cognee 记忆 sidecar 仅桌面端可用（Rust 侧 `src-tauri/src/memory_sidecar.rs`
 *   全 `#[cfg(desktop)]` 门控），移动端（Android/iOS）调其 API 必然失败，须短路；
 * - 窗口管理（widgetState.openWidgetSurface）按移动/桌面走不同导航。
 *
 * 判定依据：Tauri 移动端（Android/iOS）WebView 的 `navigator.userAgent` 含
 * `android` / `iphone` / `ipad` / `ipod` 关键字；桌面端（Win/Mac/Linux）WebView
 * 不会命中。SSR/非浏览器环境（typeof navigator === undefined）按桌面处理。
 */

/** 当前是否为移动端口径（Android / iOS）。 */
export function isMobileRuntime(): boolean {
  return typeof navigator !== 'undefined' && /android|iphone|ipad|ipod/i.test(navigator.userAgent)
}

/** 当前是否为桌面端口径（Windows / macOS / Linux）。 */
export function isDesktopRuntime(): boolean {
  return !isMobileRuntime()
}
