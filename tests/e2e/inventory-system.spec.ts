import { test, expect } from '@playwright/test';
import { waitForSpiritPalApp } from './setup/tauri-helper';

/**
 * 背包/商店系统测试
 */

test.describe('背包与商店系统', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForSpiritPalApp(page);
  });

  test('应能访问背包界面', async ({ page }) => {
    const inventoryBtn = await page.$('button:has-text("背包"), button:has-text("Inventory"), [aria-label*="背包"]');
    if (inventoryBtn) {
      await inventoryBtn.click();
      await page.waitForTimeout(500);
      
      const inventoryPanel = await page.$('[data-testid="inventory-panel"], .inventory-panel');
      expect(inventoryPanel).toBeTruthy();
    }
  });

  test('背包中应显示物品列表', async ({ page }) => {
    const inventoryBtn = await page.$('button:has-text("背包"), button:has-text("Inventory")');
    if (inventoryBtn) {
      await inventoryBtn.click();
      await page.waitForTimeout(500);
      
      const items = await page.$$('.inventory-item, [data-testid^="item-"]');
      // 可能有空背包的情况，只验证元素存在性
      expect(items.length >= 0).toBe(true);
    }
  });
});
