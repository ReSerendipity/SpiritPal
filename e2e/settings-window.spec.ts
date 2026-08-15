// 设置窗口 E2E 测试 — 渲染、标签页导航、配置项
import { test, expect } from './fixtures/base'

test.describe('设置窗口', () => {
  test.beforeEach(async ({ tauriPage }) => {
    await tauriPage.goto('/#/settings')
    // 等待设置窗口渲染（侧边栏出现）
    await tauriPage.locator('text=SpiritPal 设置').waitFor({ state: 'visible', timeout: 10000 })
  })

  test('设置窗口侧边栏渲染', async ({ tauriPage }) => {
    const title = tauriPage.locator('text=SpiritPal 设置')
    await expect(title).toBeVisible()
  })

  test('所有标签页按钮存在', async ({ tauriPage }) => {
    const tabs = ['AI', '外观', '性格', '养成', '商店', '背包', '记忆', '成就', '通用', '关于']
    for (const tab of tabs) {
      const tabButton = tauriPage.locator(`[aria-label="${tab} 标签页"]`)
      await expect(tabButton).toBeVisible()
    }
  })

  test('标签页切换：AI 配置', async ({ tauriPage }) => {
    const aiTab = tauriPage.locator('[aria-label="AI 标签页"]')
    await aiTab.click()

    // AI 配置页面应显示 API Key 输入框
    const apiKeyInput = tauriPage.locator('input[placeholder="sk-..."]')
    await expect(apiKeyInput).toBeVisible({ timeout: 5000 })
  })

  test('标签页切换：外观', async ({ tauriPage }) => {
    const appearanceTab = tauriPage.locator('[aria-label="外观 标签页"]')
    await appearanceTab.click()

    // 外观页面应渲染成功（无错误页面）
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 3000 })
  })

  test('标签页切换：通用设置', async ({ tauriPage }) => {
    const generalTab = tauriPage.locator('[aria-label="通用 标签页"]')
    await generalTab.click()

    // 通用设置应包含开关项
    const autoStartSwitch = tauriPage.locator('[aria-label="开机自启"]')
    await expect(autoStartSwitch).toBeVisible({ timeout: 5000 })
    await expect(autoStartSwitch).toHaveAttribute('role', 'switch')
  })

  test('关闭设置窗口按钮', async ({ tauriPage }) => {
    const closeButton = tauriPage.locator('[aria-label="关闭设置窗口"]')
    await expect(closeButton).toBeVisible()
  })

  test('AI 配置保存按钮', async ({ tauriPage }) => {
    const aiTab = tauriPage.locator('[aria-label="AI 标签页"]')
    await aiTab.click()

    const saveButton = tauriPage.locator('[aria-label="保存 AI 配置"]')
    await expect(saveButton).toBeVisible({ timeout: 5000 })
  })
})
