/**
 * Tauri E2E 测试辅助工具
 * 
 * 提供与 Tauri 应用交互的通用方法：
 * - 等待应用加载完成
 * - 模拟全局快捷键
 * - 检查宠物渲染状态
 * - 验证 UI 组件存在性
 */

interface PetStats {
  level: number;
  hunger: number;
  mood: number;
  health: number;
  affection: number;
}

/**
 * 等待 SpiritPal 应用完全加载
 */
export async function waitForSpiritPalApp(page) {
  await page.waitForSelector('#root', { state: 'attached' });
  // 等待 Live2D 容器加载
  await page.waitForSelector('[data-testid="live2d-container"]', { state: 'attached' });
  // 等待初始化完成（无 loading 状态）
  await page.waitForFunction(() => {
    const loading = document.querySelector('.loading-screen');
    return !loading;
  }, { timeout: 15000 });
}

/**
 * 检查宠物是否已加载并可交互
 */
export async function isPetReady(page): Promise<boolean> {
  try {
    const container = await page.$('[data-testid="live2d-container"]');
    if (!container) return false;
    
    const visible = await container.isVisible();
    if (!visible) return false;
    
    // 检查是否有错误状态
    const errorElement = await page.$('.pet-load-error');
    if (errorElement) return false;
    
    return true;
  } catch {
    return false;
  }
}

/**
 * 获取当前宠物统计数据
 */
export async function getPetStats(page): Promise<PetStats | null> {
  try {
    const statsText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="pet-stats"]');
      return el?.textContent || null;
    });
    
    if (!statsText) return null;
    
    // 解析统计数据（根据实际格式调整）
    const match = statsText.match(/LVL:(\d+)\s+HUNGER:(\d+)\s+MOOD:(\d+)\s+HP:(\d+)\s+AFF:(\d+)/);
    if (match) {
      return {
        level: parseInt(match[1]),
        hunger: parseInt(match[2]),
        mood: parseInt(match[3]),
        health: parseInt(match[4]),
        affection: parseInt(match[5])
      };
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * 点击宠物区域触发交互
 */
export async function clickPet(page, position: 'left'|'center'|'right' = 'center') {
  const selector = '[data-testid="live2d-container"]';
  const element = await page.$(selector);
  if (!element) throw new Error('Pet container not found');
  
  const box = await element.boundingBox();
  if (!box) throw new Error('Could not get pet bounding box');
  
  const x = box.x + (box.width * (position === 'left' ? 0.25 : position === 'center' ? 0.5 : 0.75));
  const y = box.y + box.height * 0.6;
  
  await page.click(selector, { position: { x: Math.round(x - box.x), y: Math.round(y - box.y) } });
}

/**
 * 检查气泡是否显示
 */
export async function hasBubble(page): Promise<boolean> {
  try {
    const bubble = await page.$('.pet-bubble:not(.hidden)');
    return !!bubble && await bubble.isVisible();
  } catch {
    return false;
  }
}

/**
 * 等待气泡出现并消失
 */
export async function waitForBubble(page, timeoutMs = 5000): Promise<string | null> {
  try {
    await page.waitForSelector('.pet-bubble:not(.hidden)', { timeout: timeoutMs });
    const text = await page.textContent('.pet-bubble:not(.hidden)');
    await page.waitForSelector('.pet-bubble.hidden', { timeout: timeoutMs });
    return text;
  } catch {
    return null;
  }
}
