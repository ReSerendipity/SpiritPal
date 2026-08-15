import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E 配置
 *
 * T-01: 新增 Tauri Driver 模式 — 在 Tauri 应用构建后使用 tauri-driver 进行真实 E2E 测试
 * T-09: 多浏览器 E2E — 添加 Firefox 和 WebKit 浏览器引擎
 *
 * 此配置提供两种模式：
 *  1. 通过 `vite dev` 启动 web 预览进行基础冒烟测试（不依赖 Tauri 后端）
 *  2. 在 Tauri 应用构建后使用 `tauri-driver` 进行完整 E2E 测试（需额外配置）
 *
 * 默认采用 web 冒烟测试模式。
 * 环境变量 TAURI_DRIVER=1 可切换到 Tauri Driver 模式。
 */

const isTauriDriver = process.env.TAURI_DRIVER === '1'

const projects = isTauriDriver
  ? [
      {
        // T-01: Tauri Driver 模式 — 使用 WebDriverIO 连接 tauri-driver
        name: 'tauri-driver',
        use: {
          ...devices['Desktop Chrome'],
          // Tauri Driver 使用本地 WebDriver 服务
          browserName: 'chromium' as const,
        },
      },
    ]
  : [
      // T-09: 多浏览器 E2E — Chromium / Firefox / WebKit
      {
        name: 'chromium',
        use: { ...devices['Desktop Chrome'] },
      },
      {
        name: 'firefox',
        use: { ...devices['Desktop Firefox'] },
      },
      {
        name: 'webkit',
        use: { ...devices['Desktop Safari'] },
      },
    ]

export default defineConfig({
  testDir: isTauriDriver ? './e2e/tauri-driver' : './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: isTauriDriver ? undefined : 'http://127.0.0.1:5223',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // T-19: 可访问性测试 — axe-core 配置
    ...(process.env.AXE_TEST === '1' ? { axe: {} } : {}),
  },
  projects,
  // 启动 vite dev server 用于 web 冒烟测试（非 Tauri Driver 模式）
  ...(isTauriDriver
    ? {}
    : {
        webServer: {
          command: 'pnpm dev',
          url: 'http://127.0.0.1:5223',
          reuseExistingServer: !process.env.CI,
          timeout: 60 * 1000,
        },
      }),
})
