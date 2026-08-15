// Chat window E2E tests
// Note: Chat window is a lazy component, may stay in loading state in web mode
import { test, expect } from './fixtures/base'

// 增加超时（聊天窗口懒加载 + Vite 冷启动）
test.describe.configure({ timeout: 60000 })

test.describe('聊天窗口', () => {
  test.beforeEach(async ({ tauriPage }) => {
    // 聊天窗口是懒加载组件，web 模式可能停留在"加载中…"
    await tauriPage.goto('/#/chat', { waitUntil: 'commit', timeout: 60000 })
  })

  test('页面加载不崩溃', async ({ tauriPage }) => {
    const root = tauriPage.locator('#root')
    await expect(root).toBeAttached()

    // 不应显示错误页面
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  test('聊天消息列表正确渲染', async ({ tauriPage }) => {
    const messageList = tauriPage.locator('[aria-label="聊天消息列表"]')
    await expect(messageList).toBeVisible({ timeout: 15000 })
    await expect(messageList).toHaveAttribute('role', 'log')
  })

  test('聊天输入框存在且可用', async ({ tauriPage }) => {
    const input = tauriPage.locator('[aria-label="聊天输入框"]')
    await expect(input).toBeVisible({ timeout: 15000 })
    await expect(input).toHaveAttribute('placeholder', '输入消息与宠物聊天…')
  })

  test('发送消息按钮存在', async ({ tauriPage }) => {
    const sendButton = tauriPage.locator('[aria-label="发送消息"]')
    await expect(sendButton).toBeVisible({ timeout: 15000 })
  })

  test('搜索对话功能', async ({ tauriPage }) => {
    const searchButton = tauriPage.locator('[aria-label="搜索对话"]')
    await expect(searchButton).toBeVisible({ timeout: 15000 })
    await searchButton.click()

    const searchInput = tauriPage.locator('input[placeholder="搜索对话内容…"]')
    await expect(searchInput).toBeVisible({ timeout: 5000 })
  })

  test('清空聊天记录按钮存在', async ({ tauriPage }) => {
    const clearButton = tauriPage.locator('[aria-label="清空聊天记录"]')
    await expect(clearButton).toBeVisible({ timeout: 15000 })
  })

  test('输入消息并发送', async ({ tauriPage }) => {
    const input = tauriPage.locator('[aria-label="聊天输入框"]')
    await expect(input).toBeVisible({ timeout: 15000 })

    await input.fill('你好，小宠物！')
    await expect(input).toHaveValue('你好，小宠物！')

    const sendButton = tauriPage.locator('[aria-label="发送消息"]')
    await sendButton.click()
    await expect(input).toHaveValue('')
  })

  test('Enter 键发送消息', async ({ tauriPage }) => {
    const input = tauriPage.locator('[aria-label="聊天输入框"]')
    await expect(input).toBeVisible({ timeout: 15000 })

    await input.fill('测试 Enter 发送')
    await input.press('Enter')
    await expect(input).toHaveValue('')
  })
})
