import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'test-results/report' }],
    ['json', { outputFile: 'test-results/report.json' }],
    ['list']
  ],
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:5223',
    actionTimeout: 0,
    // dev 模式下多窗口重部件（Live2D/模型）初始化易使首屏导航 >10s，放宽至 30s 降低 flaky
    navigationTimeout: 30000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } }
    }
  ],
  outputDir: 'test-results/screenshots/',
});
