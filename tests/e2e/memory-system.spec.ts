import { test, expect } from './setup/tauri-fixture';
import { waitForSpiritPalApp } from './setup/tauri-helper';

/**
 * 记忆系统测试（第二轮 P1-1 修复：移除条件包裹弱断言）
 *
 * 修复背景：原实现用 `if (el) { ... }` 包裹断言，元素缺失时测试静默通过
 * （伪测试，评估报告 P1-1）。现改为显式断言，元素缺失即红。
 *
 * 验证路径说明（web dev 模式）：
 * - dev 模式下多窗口以 URL hash 路由模拟（App.tsx：`#/settings` 渲染 SettingsWindow），
 *   真实窗口打开链路依赖 Tauri 窗口层（showWindow → ensureAppWindow），web mock
 *   环境下无法验证，由 tauri-driver 真实 E2E 覆盖（tauri-driver.spec.ts）。
 * - 宠物动作列表（含设置按钮）在展开态（panelOpen）渲染，展开由点击状态卡触发
 *   （PetStatusCard onExpand，PetWindow.tsx:1520）。
 * - 本文件验证可达部分：① 展开宠物面板后存在设置入口；② 设置窗口记忆页签与面板渲染。
 */

test.describe('记忆系统', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForSpiritPalApp(page);
  });

  test('展开宠物面板应提供设置入口', async ({ page }) => {
    // 等待宠物主界面渲染（启动链路含 DB 初始化等异步调用，E2E 需显式等待真实 UI 状态）。
    // 宠物状态卡可能是 role=img 的非 <img> 元素（aria snapshot 显示为 img），选择器同时覆盖
    // <img alt> 与 [aria-label]；可见性判定对桌面宠物窗口不稳定，用 state:'attached' 断言 DOM 存在
    // （入口存在性），可见性/交互由 tauri-driver 覆盖。
    const sprite = await page.waitForSelector(
      'img[alt*="多罗"], [aria-label*="多罗"]',
      { state: 'attached', timeout: 20000 }
    );
    expect(sprite).not.toBeNull();
    // 展开面板：右键宠物（PetWindow.tsx:1054 handleContextMenu → panelOpen），
    // force 跳过可点击性检查（桌面宠物窗口定位/尺寸在 web mock 下不稳定）
    await sprite!.click({ button: 'right', force: true });
    // 展开后动作列表渲染（PetWindow.tsx:1535 panelOpen 分支），设置按钮 aria-label="设置"
    const settingsBtn = await page.waitForSelector('button[aria-label="设置"]', {
      state: 'attached',
      timeout: 10000,
    });
    expect(settingsBtn).not.toBeNull();
  });

  test('设置窗口记忆页签可打开并渲染记忆面板', async ({ page }) => {
    // App.tsx 按 URL hash 路由渲染对应窗口界面（#/settings → SettingsWindow，React.lazy 异步加载）
    await page.goto('/#/settings');
    await waitForSpiritPalApp(page);

    // SettingsWindow 页签按钮 aria-label 为「{label} 标签页」（SettingsWindow.tsx:604）
    const memoryTab = await page.waitForSelector('button[aria-label="记忆 标签页"]', { timeout: 20000 });
    expect(memoryTab).not.toBeNull();
    await memoryTab!.click();

    // MemoryPanel 渲染：主人画像 Tab 在无记忆时展示空态文案（MemoryPanel.tsx:300）
    // 有记忆时展示「选择事实」复选框行（MemoryPanel.tsx:311）
    // 注意：不能混用 text= 引擎与 CSS 逗号（选择器会失效），用 :text() 伪类组合
    const emptyOrFacts = page.locator('p:text("还没有关于主人的记忆"), [aria-label^="选择事实"]')
    await emptyOrFacts.first().waitFor({ timeout: 10000 })
    expect(await emptyOrFacts.first().isVisible()).toBe(true)
  });
});
