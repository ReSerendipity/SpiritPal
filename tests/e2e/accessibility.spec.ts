import { test, expect } from './setup/tauri-fixture';
import AxeBuilder from '@axe-core/playwright';
import { waitForSpiritPalApp } from './setup/tauri-helper';

/**
 * 可访问性（无障碍）测试
 */

test.describe('无障碍功能', () => {
  test.beforeEach(async ({ page }) => {
    // waitUntil=domcontentloaded：dev 环境下应用重资源（Live2D/模型）常导致 load 事件 >10s，
    // 语义由 waitForSpiritPalApp（等待 #root 挂载，超时 30s）承接，避免误报超时
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForSpiritPalApp(page);
  });

  test('不应发现严重的无障碍问题', async ({ page }) => {
    const accessibilityScanResults = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();

    const criticalIssues = accessibilityScanResults.violations.filter(v => v.impact === 'critical');
    expect(criticalIssues.length).toBe(0);

    // P2-4：serious 级别同样纳入断言（此前仅拦截 critical；serious 多为可感知的对比度/名称缺失）
    const seriousIssues = accessibilityScanResults.violations.filter(v => v.impact === 'serious');
    expect(seriousIssues.length).toBe(0);
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

  test('Tab 键导航应能到达宠物面板设置按钮', async ({ page }) => {
    // P2-4：键盘导航可达性。宠物窗口收起态无可 Tab 聚焦元素（真实暴露：默认无 tabbable），
    // 故先右键展开面板（PetWindow.tsx:1054 handleContextMenu → panelOpen），
    // 展开后动作列表渲染，从页面顶部连续 Tab 应最终聚焦到设置按钮。
    const sprite = await page.waitForSelector('img[alt*="多罗"], [aria-label*="多罗"]', {
      state: 'attached',
      timeout: 20000,
    });
    expect(sprite).not.toBeNull();
    await sprite!.click({ button: 'right', force: true });
    await page.waitForSelector('button[aria-label="设置"]', { state: 'attached', timeout: 10000 });
    let found = false;
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const label = await page.evaluate(() => document.activeElement?.getAttribute?.('aria-label') ?? null);
      if (label === '设置') {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});
