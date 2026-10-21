import { defineConfig, devices } from '@playwright/test'

// Web E2E 的被测地址单一来源：use.baseURL 与 webServer.url 共用同一表达式，
// 避免两处口径漂移（端口与 vite.config.ts 的 server.port/strictPort 同源）。
const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:5223'

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
    baseURL,
    actionTimeout: 0,
    // dev 模式下多窗口重部件（Live2D/模型）初始化易使首屏导航 >10s，放宽至 30s 降低 flaky
    navigationTimeout: 30000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  // 入口自带前置：冷启动 `pnpm test:e2e` 时由 Playwright 拉起 vite dev server，
  // 调用方无需先手工起服务（此前该前置只编码在 ci.yml 的「Start dev server」步骤里，
  // README 与 local/agents/SOPS.md 只教命令，导致本地按文档执行必然连接失败）。
  // reuseExistingServer=true 让 CI 里已起好的服务被复用而不是二次占用端口
  // （vite 为 strictPort，端口被占时再起一个会失败）；两条路径共用上面同一个 baseURL 探活。
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
  ],
  outputDir: 'test-results/screenshots/',
})
