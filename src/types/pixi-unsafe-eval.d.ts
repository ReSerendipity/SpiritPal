/**
 * pixi.js/unsafe-eval 类型声明
 *
 * pixi8 提供专门使用 unsafe-eval 的入口（在 CSP 禁止 eval 的环境如 Tauri release 下，
 * 主入口 pixi.js 会抛 "Current environment does not allow unsafe-eval"）。
 * 该子路径仅有运行时 init 副作用，其 API 与 pixi.js 完全一致，此处直接转发类型。
 */
declare module 'pixi.js/unsafe-eval' {
  export * from 'pixi.js'
}