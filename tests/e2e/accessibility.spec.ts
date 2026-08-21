import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { waitForSpiritPalApp } from './setup/tauri-helper';

/**
 * 可访问性（无障碍）测试
 */

test.describe('无障碍功能', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForSpiritPalApp(page);
  });

  test('不应发现严重的无障碍问题', async ({ page }) => {
    const accessibilityScanResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    
    const criticalIssues = accessibilityScanResults.violations.filter(v => v.impact === 'critical');
    expect(criticalIssues.length).toBe(0);
  });

  test('所有交互元素应具有适当的 ARIA 标签', async ({ page }) => {
    const buttons = await page.$$('button');
    for (const button of buttons) {
      const ariaLabel = await button.getAttribute('aria-label');
      const textContent = await button.innerText();
      const title = await button.getAttribute('title');
      
      // 至少有某种形式的可识别文本
      expect(ariaLabel || textContent || title).toBeTruthy();
    }
  });
});
