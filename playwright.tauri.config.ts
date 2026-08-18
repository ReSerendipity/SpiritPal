// playwright.tauri.config.ts — Tauri Driver 真实 E2E 配置
//
// 与 playwright.config.ts 的 TAURI_DRIVER=1 模式等价，但作为独立配置文件
// 使用，便于与 web 冒烟测试隔离运行。
//
// 运行方式（前置条件见 e2e/tauri-driver/tauri-driver.spec.ts 头注释）:
//   1. 启动 tauri-driver: tauri-driver --port 4444
//   2. 运行:
//      TAURI_DRIVER_ENABLED=1 SPIRITPAL_EXE=<exe 路径> \
//      pnpm exec playwright test --config=playwright.tauri.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/tauri-driver',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'html',
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'tauri-driver',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
