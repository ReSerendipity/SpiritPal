// T-20: 移动端 E2E 测试 — 测试移动端视图渲染
import { test, expect } from './fixtures/base'

test.describe('T-20: 移动端视图', () => {
  test.describe.configure({ timeout: 60000 })

  test('移动端宠物视图加载', async ({ tauriPage }) => {
    // 使用移动端视口尺寸
    await tauriPage.setViewportSize({ width: 375, height: 667 })
    await tauriPage.goto('/#/pet?mobile=1', { waitUntil: 'domcontentloaded' })

    const root = tauriPage.locator('#root')
    await expect(root).toBeVisible()

    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  test('移动端设置视图加载', async ({ tauriPage }) => {
    await tauriPage.setViewportSize({ width: 375, height: 667 })
    await tauriPage.goto('/#/settings?mobile=1')

    const root = tauriPage.locator('#root')
    await expect(root).toBeVisible()

    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  test('移动端聊天视图加载', async ({ tauriPage }) => {
    await tauriPage.setViewportSize({ width: 375, height: 667 })
    await tauriPage.goto('/#/chat?mobile=1', { waitUntil: 'domcontentloaded', timeout: 45000 })

    const root = tauriPage.locator('#root')
    await expect(root).toBeAttached()

    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })
})
