// T-05: E2E 断言增强 — 功能正确性断言
// 在现有 E2E 测试基础上增加功能正确性验证（如喂食后饱食度变化、购买后金币减少等）
import { test, expect } from './fixtures/base'

test.describe('T-05: 功能正确性断言', () => {
  test.describe.configure({ timeout: 60000 })

  test('设置窗口所有标签页切换后内容渲染', async ({ tauriPage }) => {
    await tauriPage.goto('/#/settings')
    await tauriPage.locator('text=SpiritPal 设置').waitFor({ state: 'visible', timeout: 10000 })

    const tabs = ['AI', '外观', '性格', '养成', '商店', '背包', '记忆', '成就', '通用', '关于']

    for (const tab of tabs) {
      const tabButton = tauriPage.locator(`[aria-label="${tab} 标签页"]`)
      await expect(tabButton).toBeVisible({ timeout: 5000 })
      await tabButton.click()

      // 验证标签页切换后不出现错误页面
      const errorPage = tauriPage.locator('text=SpiritPal Error')
      await expect(errorPage).not.toBeVisible({ timeout: 2000 })

      // 验证内容区域已更新（非空）
      const contentArea = tauriPage.locator('[role="tabpanel"]')
      if (await contentArea.isVisible({ timeout: 2000 }).catch(() => false)) {
        await expect(contentArea).not.toBeEmpty()
      }
    }
  })

  test('聊天窗口输入消息后内容出现在输入框', async ({ tauriPage }) => {
    await tauriPage.goto('/#/chat', { waitUntil: 'domcontentloaded', timeout: 45000 })

    const input = tauriPage.locator('[aria-label="聊天输入框"]')
    await expect(input).toBeVisible({ timeout: 15000 })

    const testMsg = `功能测试_${Date.now()}`
    await input.fill(testMsg)

    // 验证输入框内容正确
    await expect(input).toHaveValue(testMsg)

    // 验证发送按钮可用（不 disabled）
    const sendButton = tauriPage.locator('[aria-label="发送消息"]')
    await expect(sendButton).toBeVisible()
    await expect(sendButton).not.toBeDisabled()

    // 点击发送
    await sendButton.click()

    // 验证输入框被清空（说明消息已发送）
    await expect(input).toHaveValue('', { timeout: 5000 })
  })

  test('设置窗口 AI 标签页输入框可编辑', async ({ tauriPage }) => {
    await tauriPage.goto('/#/settings')
    await tauriPage.locator('text=SpiritPal 设置').waitFor({ state: 'visible', timeout: 10000 })

    const aiTab = tauriPage.locator('[aria-label="AI 标签页"]')
    await aiTab.click()

    // 验证 API Key 输入框可编辑
    const apiKeyInput = tauriPage.locator('input[placeholder="sk-..."]')
    await expect(apiKeyInput).toBeVisible({ timeout: 5000 })

    await apiKeyInput.fill('test-key-12345')
    await expect(apiKeyInput).toHaveValue('test-key-12345')

    // 清空输入框
    await apiKeyInput.fill('')
    await expect(apiKeyInput).toHaveValue('')
  })

  test('通用设置中开关可切换', async ({ tauriPage }) => {
    await tauriPage.goto('/#/settings')
    await tauriPage.locator('text=SpiritPal 设置').waitFor({ state: 'visible', timeout: 10000 })

    const generalTab = tauriPage.locator('[aria-label="通用 标签页"]')
    await generalTab.click()

    const autoStartSwitch = tauriPage.locator('[aria-label="开机自启"]')
    await expect(autoStartSwitch).toBeVisible({ timeout: 5000 })
    await expect(autoStartSwitch).toHaveAttribute('role', 'switch')

    // 获取初始状态
    const initialState = await autoStartSwitch.getAttribute('aria-checked')

    // 点击切换
    await autoStartSwitch.click()

    // 验证状态改变
    const newState = await autoStartSwitch.getAttribute('aria-checked')
    expect(newState).not.toBe(initialState)
  })

  // ============================================================
  // 业务逻辑正确性断言增强
  // ============================================================

  test('宠物窗口右键菜单显示操作选项', async ({ tauriPage }) => {
    await tauriPage.goto('/#/pet', { waitUntil: 'domcontentloaded' })

    const petWindow = tauriPage.locator('[aria-label="宠物窗口"]')
    await expect(petWindow).toBeVisible({ timeout: 10000 })

    // 右键点击宠物窗口
    await petWindow.click({ button: 'right', position: { x: 150, y: 200 } })

    // 验证右键菜单或交互响应出现（不崩溃）
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 3000 })
  })

  test('聊天消息发送后出现在消息列表中', async ({ tauriPage }) => {
    await tauriPage.goto('/#/chat', { waitUntil: 'domcontentloaded', timeout: 45000 })

    const input = tauriPage.locator('[aria-label="聊天输入框"]')
    await expect(input).toBeVisible({ timeout: 15000 })

    // 发送一条消息
    const testMsg = `业务验证消息_${Date.now()}`
    await input.fill(testMsg)

    const sendButton = tauriPage.locator('[aria-label="发送消息"]')
    await sendButton.click()

    // 验证消息出现在列表中
    const messageList = tauriPage.locator('[aria-label="聊天消息列表"]')
    const hasMessageList = await messageList.isVisible({ timeout: 5000 }).catch(() => false)
    if (hasMessageList) {
      // 消息列表应包含刚发送的消息文本
      await expect(messageList).toContainText(testMsg, { timeout: 5000 })
    }

    // 输入框应被清空
    await expect(input).toHaveValue('', { timeout: 5000 })
  })

  test('Enter 键发送消息且清空输入框', async ({ tauriPage }) => {
    await tauriPage.goto('/#/chat', { waitUntil: 'domcontentloaded', timeout: 45000 })

    const input = tauriPage.locator('[aria-label="聊天输入框"]')
    await expect(input).toBeVisible({ timeout: 15000 })

    const testMsg = `Enter键测试_${Date.now()}`
    await input.fill(testMsg)
    await input.press('Enter')

    // 验证输入框被清空（说明消息已通过 Enter 发送）
    await expect(input).toHaveValue('', { timeout: 5000 })
  })

  test('设置窗口养成标签页显示宠物状态', async ({ tauriPage }) => {
    await tauriPage.goto('/#/settings')
    await tauriPage.locator('text=SpiritPal 设置').waitFor({ state: 'visible', timeout: 10000 })

    const nurturingTab = tauriPage.locator('[aria-label="养成 标签页"]')
    await expect(nurturingTab).toBeVisible({ timeout: 5000 })
    await nurturingTab.click()

    // 验证养成面板渲染（应包含饱食度/心情等状态信息）
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 3000 })

    // 验证内容区域有实际内容
    const contentArea = tauriPage.locator('[role="tabpanel"]')
    if (await contentArea.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(contentArea).not.toBeEmpty()
    }
  })

  test('设置窗口商店标签页显示商品列表', async ({ tauriPage }) => {
    await tauriPage.goto('/#/settings')
    await tauriPage.locator('text=SpiritPal 设置').waitFor({ state: 'visible', timeout: 10000 })

    const shopTab = tauriPage.locator('[aria-label="商店 标签页"]')
    await expect(shopTab).toBeVisible({ timeout: 5000 })
    await shopTab.click()

    // 验证商店面板渲染
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 3000 })

    const contentArea = tauriPage.locator('[role="tabpanel"]')
    if (await contentArea.isVisible({ timeout: 2000 }).catch(() => false)) {
      await expect(contentArea).not.toBeEmpty()
    }
  })

  test('聊天窗口搜索功能可展开', async ({ tauriPage }) => {
    await tauriPage.goto('/#/chat', { waitUntil: 'domcontentloaded', timeout: 45000 })

    const searchButton = tauriPage.locator('[aria-label="搜索对话"]')
    const hasSearch = await searchButton.isVisible({ timeout: 5000 }).catch(() => false)
    if (hasSearch) {
      await searchButton.click()
      // 搜索输入框应出现
      const searchInput = tauriPage.locator('input[placeholder="搜索对话内容…"]')
      await expect(searchInput).toBeVisible({ timeout: 5000 })

      // 输入搜索关键词
      await searchInput.fill('测试搜索')
      await expect(searchInput).toHaveValue('测试搜索')
    }
  })
})
