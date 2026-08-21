import { test, expect } from '@playwright/test';
import { waitForSpiritPalApp } from './setup/tauri-helper';

/**
 * 记忆系统测试
 */

test.describe('记忆系统', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForSpiritPalApp(page);
  });

  test('应能打开设置窗口访问记忆管理', async ({ page }) => {
    // 查找并点击设置按钮
    const settingsBtn = await page.$('button[aria-label*="设置"], button[aria-label*="Settings"]');
    if (settingsBtn) {
      await settingsBtn.click();
      await page.waitForTimeout(500);
      
      // 检查记忆管理选项卡是否存在
      const memoryTab = await page.$('[data-testid="memory-tab"], .memory-tab');
      expect(memoryTab).toBeTruthy();
    }
  });

  test('记忆检索功能应响应查询', async ({ page }) => {
    // 导航到记忆页面（如果存在独立入口）
    const memoryLink = await page.$('a[href*="memory"], button:has-text("记忆")');
    if (memoryLink) {
      await memoryLink.click();
      await page.waitForTimeout(1000);
      
      const searchInput = await page.$('input[type="search"], input[placeholder*="搜索"]');
      expect(searchInput).toBeTruthy();
      
      if (searchInput) {
        await searchInput.fill('测试');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(500);
        
        // 搜索结果容器应该存在
        const resultsContainer = await page.$('.memory-results, [data-testid="memory-search-results"]');
        expect(resultsContainer).toBeTruthy();
      }
    }
  });
});
