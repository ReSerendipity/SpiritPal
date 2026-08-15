// 冒烟测试 — 验证应用基础加载和路由
import { test, expect } from './fixtures/base'

test.describe('冒烟测试', () => {
  test('宠物窗口加载成功', async ({ tauriPage }) => {
    await tauriPage.goto('/#/pet')

    // 等待根容器渲染
    const root = tauriPage.locator('#root')
    await expect(root).toBeVisible()

    // 应用不应显示错误页面
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  test('聊天窗口路由可达', async ({ tauriPage }) => {
    await tauriPage.goto('/#/chat')

    const root = tauriPage.locator('#root')
    await expect(root).toBeVisible()

    // 聊天窗口应渲染（可能显示加载中）
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  test('设置窗口路由可达', async ({ tauriPage }) => {
    await tauriPage.goto('/#/settings')

    const root = tauriPage.locator('#root')
    await expect(root).toBeVisible()

    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  test('无路由时默认显示宠物窗口', async ({ tauriPage }) => {
    await tauriPage.goto('/')

    const root = tauriPage.locator('#root')
    await expect(root).toBeVisible()
  })
})
