import { test, expect } from '@playwright/test';
import { waitForSpiritPalApp, isPetReady } from './setup/tauri-helper';

/**
 * 应用加载流程测试
 */

test.describe('SpiritPal 应用加载', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('应展示根容器和加载界面', async ({ page }) => {
    await expect(page.locator('#root')).toBeAttached({ timeout: 10000 });
  });

  test('应成功加载 Live2D 容器', async ({ page }) => {
    await waitForSpiritPalApp(page);
    await expect(page.locator('[data-testid="live2d-container"]')).toBeVisible({ timeout: 15000 });
  });

  test('宠物应在 15 秒内准备就绪', async ({ page }) => {
    await waitForSpiritPalApp(page);
    
    const isReady = await isPetReady(page);
    expect(isReady).toBe(true);
  });

  test('不应出现初始化错误', async ({ page }) => {
    await waitForSpiritPalApp(page);
    
    const errorElements = await page.locator('.init-error, .pet-load-error').all();
    expect(errorElements.length).toBe(0);
  });
});
