/**
 * @file Vitest 测试环境全局配置
 * @module test/setup
 * @description
 * 配置 Vitest 单元测试环境，提供所有必要的 mock 和 polyfill。
 * 在所有测试文件运行前自动执行。
 *
 * 主要配置内容：
 * - Mock 所有 Tauri API（@tauri-apps/api 和插件）
 * - Mock Web Worker（向量搜索 worker）
 * - jsdom 环境 polyfill（matchMedia、ResizeObserver）
 * - 注入测试所需的全局变量
 * - 测试隔离（localStorage 清理、React 组件卸载）
 */
import '@testing-library/jest-dom/vitest'
import { vi, beforeEach, afterAll } from 'vitest'
import { cleanup } from '@testing-library/react'

// ============ Mock @tauri-apps/api 核心模块 ============
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((p: string) => p),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(),
  listen: vi.fn(() => Promise.resolve(() => {})),
  once: vi.fn(() => Promise.resolve(() => {})),
  unlisten: vi.fn(),
}))

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    hide: vi.fn(),
    show: vi.fn(),
    setFocus: vi.fn(),
    listen: vi.fn(() => Promise.resolve(() => {})),
    emit: vi.fn(),
  }),
  WebviewWindow: vi.fn(),
}))

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(() => Promise.resolve('/mock/appdata')),
  join: vi.fn((...args: string[]) => Promise.resolve(args.join('/'))),
  resolve: vi.fn((...args: string[]) => args.join('/')),
}))

// ============ Mock @tauri-apps/plugin-* 插件 ============
vi.mock('@tauri-apps/plugin-sql', () => {
  const mockDb = {
    execute: vi.fn(() => Promise.resolve()),
    select: vi.fn(() => Promise.resolve([])),
    close: vi.fn(() => Promise.resolve()),
  }
  return {
    default: {
      load: vi.fn(() => Promise.resolve(mockDb)),
    },
  }
})

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(() => Promise.resolve('{}')),
  readBinaryFile: vi.fn(() => Promise.resolve(new Uint8Array())),
  writeTextFile: vi.fn(() => Promise.resolve()),
  writeBinaryFile: vi.fn(() => Promise.resolve()),
  exists: vi.fn(() => Promise.resolve(false)),
  remove: vi.fn(() => Promise.resolve()),
  renameFile: vi.fn(() => Promise.resolve()),
  mkdir: vi.fn(() => Promise.resolve()),
  readDir: vi.fn(() => Promise.resolve([])),
  BaseDirectory: { AppData: 'AppData', App: 'App' },
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(() => Promise.resolve(null)),
  save: vi.fn(() => Promise.resolve(null)),
  message: vi.fn(() => Promise.resolve()),
  ask: vi.fn(() => Promise.resolve(true)),
  confirm: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('@tauri-apps/plugin-store', () => ({
  load: vi.fn(() =>
    Promise.resolve({
      get: vi.fn(() => Promise.resolve(null)),
      set: vi.fn(() => Promise.resolve()),
      save: vi.fn(() => Promise.resolve()),
      delete: vi.fn(() => Promise.resolve()),
      clear: vi.fn(() => Promise.resolve()),
      entries: vi.fn(() => Promise.resolve([])),
      values: vi.fn(() => Promise.resolve([])),
      keys: vi.fn(() => Promise.resolve([])),
      length: vi.fn(() => Promise.resolve(0)),
      reset: vi.fn(() => Promise.resolve()),
    }),
  ),
}))

vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: vi.fn(),
  requestPermission: vi.fn(() => Promise.resolve('granted')),
  isPermissionGranted: vi.fn(() => Promise.resolve(true)),
}))

vi.mock('@tauri-apps/plugin-global-shortcut', () => ({
  register: vi.fn(() => Promise.resolve()),
  unregister: vi.fn(() => Promise.resolve()),
  isRegistered: vi.fn(() => Promise.resolve(false)),
}))

vi.mock('@tauri-apps/plugin-autostart', () => ({
  enable: vi.fn(() => Promise.resolve()),
  disable: vi.fn(() => Promise.resolve()),
  isEnabled: vi.fn(() => Promise.resolve(false)),
}))

vi.mock('@tauri-apps/plugin-process', () => ({
  exit: vi.fn(() => Promise.resolve()),
  relaunch: vi.fn(() => Promise.resolve()),
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(() => Promise.resolve(null)),
}))

// ============ Mock Web Worker（vectorSearch 使用 ?worker 导入）============
vi.mock('./vectorWorker?worker', () => ({
  default: vi.fn(function () {
    return {
      postMessage: vi.fn(),
      onmessage: vi.fn(),
      onerror: vi.fn(),
      terminate: vi.fn(),
    }
  }),
}))

vi.mock('../lib/vectorWorker?worker', () => ({
  default: vi.fn(function () {
    return {
      postMessage: vi.fn(),
      onmessage: vi.fn(),
      onerror: vi.fn(),
      terminate: vi.fn(),
    }
  }),
}))

// ============ jsdom 兼容补丁 ============

/**
 * jsdom 没有 matchMedia API，提供空实现以支持响应式组件
 */
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  })
}

/**
 * jsdom 没有 ResizeObserver API，提供空实现
 */
if (!window.ResizeObserver) {
  class MockResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  ;(window as unknown as { ResizeObserver: typeof MockResizeObserver }).ResizeObserver =
    MockResizeObserver
}

/**
 * 暴露 petStore 全局获取函数（bubbleManager 等模块使用）
 */
;(window as unknown as { __petStore_getState?: () => unknown }).__petStore_getState = () => ({
  currentCharacterId: 'doro',
})

// ============ 全局测试生命周期钩子 ============

beforeEach(() => {
  localStorage.clear()
})

afterAll(() => {
  cleanup()
})
