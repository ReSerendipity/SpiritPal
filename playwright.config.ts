import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // tauri-driver 真实窗口 E2E 由 playwright.tauri.config.ts 单独运行（P2-5：
  // ci.yml tauri-driver-smoke job 内临时安装 webdriverio 并驱动真实 Tauri 窗口），
  // 默认 web E2E 集不包含，避免本地/CI 默认集因缺少 webdriverio 而失败。
  testIgnore: '**/tauri-driver/**',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'test-results/report' }],
    ['json', { outputFile: 'test-results/report.json' }],
    ['list'],
  ],
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5223',
    actionTimeout: 0,
    // dev 模式下多窗口重部件（Live2D/模型）初始化易使首屏导航 >10s，放宽至 30s 降低 flaky
    navigationTimeout: 30000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
  outputDir: 'test-results/screenshots/',
})
