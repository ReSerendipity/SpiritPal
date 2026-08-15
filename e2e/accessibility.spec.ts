// T-19: 可访问性测试 — 使用 axe-core 验证 WCAG 合规性
// 需要安装 @axe-core/playwright: pnpm add -D @axe-core/playwright
import { test, expect } from './fixtures/base'

// axe-core 动态加载（如果安装了）
let injectAxe: Function | undefined
let checkA11y: Function | undefined

try {
  const axe = await import('@axe-core/playwright')
  injectAxe = axe.injectAxe
  checkA11y = axe.checkA11y
} catch {
  // 未安装时跳过
}

test.describe('T-19: 可访问性测试 (axe-core)', () => {
  test.skip(!injectAxe, '需要安装 @axe-core/playwright: pnpm add -D @axe-core/playwright')

  test('宠物窗口无严重可访问性违规', async ({ tauriPage }) => {
    await tauriPage.goto('/#/pet', { waitUntil: 'domcontentloaded' })
    await injectAxe!(tauriPage)
    await checkA11y!(tauriPage, undefined, {
      detailedReport: true,
      rules: {
        // 仅检查 critical 和 serious 级别
        'color-contrast': { enabled: false }, // 动态颜色可能不准确
      },
    })
  })

  test('设置窗口无严重可访问性违规', async ({ tauriPage }) => {
    await tauriPage.goto('/#/settings')
    await tauriPage.locator('text=SpiritPal 设置').waitFor({ state: 'visible', timeout: 10000 })
    await injectAxe!(tauriPage)
    await checkA11y!(tauriPage, undefined, {
      detailedReport: true,
      rules: {
        'color-contrast': { enabled: false },
      },
    })
  })

  test('聊天窗口无严重可访问性违规', async ({ tauriPage }) => {
    await tauriPage.goto('/#/chat', { waitUntil: 'domcontentloaded', timeout: 45000 })
    await injectAxe!(tauriPage)
    await checkA11y!(tauriPage, undefined, {
      detailedReport: true,
      rules: {
        'color-contrast': { enabled: false },
      },
    })
  })
})

// 即使没有 axe-core，也做基本的 ARIA 检查
test.describe('T-19: 基本 ARIA 检查（无需 axe-core）', () => {
  test('宠物窗口关键元素有 aria-label', async ({ tauriPage }) => {
    await tauriPage.goto('/#/pet', { waitUntil: 'domcontentloaded' })

    const petWindow = tauriPage.locator('[aria-label="宠物窗口"]')
    await expect(petWindow).toBeVisible({ timeout: 10000 })
  })

  test('设置窗口标签页有 aria-label', async ({ tauriPage }) => {
    await tauriPage.goto('/#/settings')
    await tauriPage.locator('text=SpiritPal 设置').waitFor({ state: 'visible', timeout: 10000 })

    const tabs = ['AI', '外观', '通用']
    for (const tab of tabs) {
      const tabButton = tauriPage.locator(`[aria-label="${tab} 标签页"]`)
      await expect(tabButton).toBeVisible()
    }
  })

  test('聊天窗口输入框有 aria-label', async ({ tauriPage }) => {
    await tauriPage.goto('/#/chat', { waitUntil: 'domcontentloaded', timeout: 45000 })

    const input = tauriPage.locator('[aria-label="聊天输入框"]')
    await expect(input).toBeVisible({ timeout: 15000 })
  })
})
