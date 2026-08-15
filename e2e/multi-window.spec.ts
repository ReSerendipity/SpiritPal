// T-17: E2E 多窗口交互测试 — 测试跨窗口导航和状态同步
import { test, expect } from './fixtures/base'

test.describe('T-17: 多窗口交互', () => {
  test.describe.configure({ timeout: 60000 })

  test('从宠物窗口导航到设置窗口', async ({ tauriPage }) => {
    await tauriPage.goto('/#/pet', { waitUntil: 'domcontentloaded' })
    await expect(tauriPage.locator('#root')).toBeVisible()

    // 导航到设置窗口
    await tauriPage.goto('/#/settings')
    await tauriPage.locator('text=SpiritPal 设置').waitFor({ state: 'visible', timeout: 10000 })

    // 确认设置窗口渲染成功
    const title = tauriPage.locator('text=SpiritPal 设置')
    await expect(title).toBeVisible()
  })

  test('从设置窗口导航到聊天窗口', async ({ tauriPage }) => {
    await tauriPage.goto('/#/settings')
    await tauriPage.locator('text=SpiritPal 设置').waitFor({ state: 'visible', timeout: 10000 })

    await tauriPage.goto('/#/chat', { waitUntil: 'domcontentloaded', timeout: 45000 })

    const input = tauriPage.locator('[aria-label="聊天输入框"]')
    await expect(input).toBeVisible({ timeout: 15000 })
  })

  test('从聊天窗口返回宠物窗口', async ({ tauriPage }) => {
    await tauriPage.goto('/#/chat', { waitUntil: 'domcontentloaded', timeout: 45000 })

    await tauriPage.goto('/#/pet', { waitUntil: 'domcontentloaded' })

    const petWindow = tauriPage.locator('[aria-label="宠物窗口"]')
    await expect(petWindow).toBeVisible({ timeout: 10000 })
  })

  test('全链路：宠物 → 设置 → 聊天 → 宠物', async ({ tauriPage }) => {
    // 1. 宠物窗口
    await tauriPage.goto('/#/pet', { waitUntil: 'domcontentloaded' })
    await expect(tauriPage.locator('#root')).toBeVisible()

    // 2. 设置窗口
    await tauriPage.goto('/#/settings')
    await tauriPage.locator('text=SpiritPal 设置').waitFor({ state: 'visible', timeout: 10000 })

    // 3. 聊天窗口
    await tauriPage.goto('/#/chat', { waitUntil: 'domcontentloaded', timeout: 45000 })
    await expect(tauriPage.locator('#root')).toBeAttached()

    // 4. 返回宠物窗口
    await tauriPage.goto('/#/pet', { waitUntil: 'domcontentloaded' })
    const petWindow = tauriPage.locator('[aria-label="宠物窗口"]')
    await expect(petWindow).toBeVisible({ timeout: 10000 })

    // 全程无错误
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible()
  })
})
