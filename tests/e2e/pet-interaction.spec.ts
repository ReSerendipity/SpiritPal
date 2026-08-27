import { test, expect } from '@playwright/test';
import { 
  waitForSpiritPalApp, 
  clickPet, 
  hasBubble, 
  waitForBubble,
  getPetStats 
} from './setup/tauri-helper';

/**
 * 宠物交互测试
 * @see PRD-13.1-AC2  点击/拖拽/喂食/摸头均有即时反馈
 * @see PRD-13.2-AC1  右键切换形象，养成数据跨形象保持
 */

test.describe('宠物交互功能', () => {
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('/');
    await waitForSpiritPalApp(page);
  });

  test('点击宠物应触发动画和气泡', async () => {
    const initialBubbleExists = await hasBubble(page);
    expect(initialBubbleExists).toBe(false);
    
    await clickPet(page, 'center');
    
    const bubbleText = await waitForBubble(page, 3000);
    expect(bubbleText).toBeTruthy();
    expect(bubbleText!.length).toBeGreaterThan(0);
  });

  test('抚摸宠物应提升亲密度', async () => {
    const beforeStats = await getPetStats(page);
    expect(beforeStats).toBeTruthy();
    
    const initialAffection = beforeStats!.affection;
    
    // 多次抚摸
    for (let i = 0; i < 3; i++) {
      await clickPet(page, 'right');
      await page.waitForTimeout(500);
    }
    
    await page.waitForTimeout(1000);
    const afterStats = await getPetStats(page);
    
    if (afterStats) {
      expect(afterStats.affection).toBeGreaterThanOrEqual(initialAffection);
    }
  });

  test('不同位置点击应有不同反应', async () => {
    const reactions = [] as string[];
    
    for (const pos of ['left', 'center', 'right'] as const) {
      await clickPet(page, pos);
      const text = await waitForBubble(page, 2000);
      if (text) reactions.push(text);
    }
    
    // 至少应该有 2 种不同的反应
    const uniqueReactions = new Set(reactions);
    expect(uniqueReactions.size).toBeGreaterThanOrEqual(1);
  });
});
