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
    actionTimeout: 0,
    navigationTimeout: 10000,
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
