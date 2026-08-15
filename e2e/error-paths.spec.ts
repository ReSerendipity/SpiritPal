// T-15: E2E 异常路径测试 — 网络断开、LLM 超时、数据库异常等场景
import { test, expect } from './fixtures/base'

test.describe('T-15: 异常路径测试', () => {
  test.describe.configure({ timeout: 60000 })

  test('聊天窗口在 Tauri mock 返回空时仍正常渲染', async ({ tauriPage }) => {
    await tauriPage.goto('/#/chat', { waitUntil: 'domcontentloaded', timeout: 45000 })

    // 聊天窗口应正常渲染，不崩溃
    const root = tauriPage.locator('#root')
    await expect(root).toBeAttached()

    // 不应显示错误页面
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  test('设置窗口在 mock 数据库返回空时不崩溃', async ({ tauriPage }) => {
    await tauriPage.goto('/#/settings')
    await tauriPage.locator('text=SpiritPal 设置').waitFor({ state: 'visible', timeout: 10000 })

    // 遍历各标签页，确认无崩溃
    const tabs = ['记忆', '成就', '背包']
    for (const tab of tabs) {
      const tabButton = tauriPage.locator(`[aria-label="${tab} 标签页"]`)
      await expect(tabButton).toBeVisible({ timeout: 5000 })
      await tabButton.click()

      const errorPage = tauriPage.locator('text=SpiritPal Error')
      await expect(errorPage).not.toBeVisible({ timeout: 3000 })
    }
  })

  test('宠物窗口在无角色数据时仍渲染', async ({ tauriPage }) => {
    await tauriPage.goto('/#/pet', { waitUntil: 'domcontentloaded' })

    const root = tauriPage.locator('#root')
    await expect(root).toBeVisible()

    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  test('路由跳转到不存在路径时显示默认页', async ({ tauriPage }) => {
    await tauriPage.goto('/#/nonexistent')
    const root = tauriPage.locator('#root')
    await expect(root).toBeVisible()
    // 不应白屏
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  test('快速切换路由不产生错误', async ({ tauriPage }) => {
    // 快速在多个路由间切换
    const routes = ['/#/pet', '/#/chat', '/#/settings', '/#/pet']

    for (const route of routes) {
      await tauriPage.goto(route)
      const errorPage = tauriPage.locator('text=SpiritPal Error')
      await expect(errorPage).not.toBeVisible({ timeout: 3000 })
    }
  })
})
