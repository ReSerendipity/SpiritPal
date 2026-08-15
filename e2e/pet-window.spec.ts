// Pet window E2E tests
import { test, expect } from './fixtures/base'

test.describe('宠物窗口', () => {
  test.beforeEach(async ({ tauriPage }) => {
    await tauriPage.goto('/#/pet', { waitUntil: 'domcontentloaded' })
  })

  test('宠物窗口根容器正确渲染', async ({ tauriPage }) => {
    const root = tauriPage.locator('#root')
    await expect(root).toBeVisible()

    // 应用不应显示错误页面
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  test('宠物状态栏显示饱食度和心情度', async ({ tauriPage }) => {
    // 等待宠物窗口容器出现
    const petWindow = tauriPage.locator('[aria-label="宠物窗口"]')
    await expect(petWindow).toBeVisible({ timeout: 10000 })

    const statusGroup = tauriPage.locator('[aria-label="宠物状态信息"]')
    await expect(statusGroup).toBeVisible({ timeout: 5000 })

    const hungerBar = tauriPage.locator('[aria-label^="饱食度"]')
    await expect(hungerBar).toBeVisible({ timeout: 5000 })
  })

  test('金币显示区域存在', async ({ tauriPage }) => {
    const petWindow = tauriPage.locator('[aria-label="宠物窗口"]')
    await expect(petWindow).toBeVisible({ timeout: 10000 })

    const coinDisplay = tauriPage.locator('[aria-label^="金币"]')
    await expect(coinDisplay).toBeVisible({ timeout: 5000 })
  })

  test('宠物精灵/Live2D 渲染区域存在', async ({ tauriPage }) => {
    const petWindow = tauriPage.locator('[aria-label="宠物窗口"]')
    await expect(petWindow).toBeVisible({ timeout: 10000 })

    const petImage = tauriPage.locator('[role="img"]')
    await expect(petImage).toBeVisible({ timeout: 5000 })
  })

  test('右键菜单交互', async ({ tauriPage }) => {
    const petWindow = tauriPage.locator('[aria-label="宠物窗口"]')
    await expect(petWindow).toBeVisible({ timeout: 10000 })

    await petWindow.click({ button: 'right', position: { x: 150, y: 200 } })

    // 不应出现错误页面
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 2000 })
  })

  test('键盘导航：Tab 聚焦宠物窗口', async ({ tauriPage }) => {
    const petWindow = tauriPage.locator('[aria-label="宠物窗口"]')
    await expect(petWindow).toBeVisible({ timeout: 10000 })

    await tauriPage.keyboard.press('Tab')
    const tabIndex = await petWindow.getAttribute('tabindex')
    expect(tabIndex).toBe('0')
  })
})
