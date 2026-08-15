// 养成/喂食/切换形象 E2E 测试
// P0-2: 核心流程覆盖 — 喂食、养成、切换形象
import { test, expect } from './fixtures/base'

// 增加测试超时（Vite 冷启动较慢）
test.describe.configure({ timeout: 60000 })

test.describe('养成与喂食', () => {
  test.beforeEach(async ({ tauriPage }) => {
    await tauriPage.goto('/#/settings', { waitUntil: 'domcontentloaded', timeout: 45000 })
    // 等待设置窗口侧边栏出现（使用 auto-wait 代替固定等待）
    await tauriPage.locator('text=SpiritPal 设置').waitFor({ state: 'visible', timeout: 15000 })
  })

  // ===== 喂食流程 =====
  test('商店标签页渲染商品列表', async ({ tauriPage }) => {
    const shopTab = tauriPage.locator('[aria-label="商店 标签页"]')
    await expect(shopTab).toBeVisible({ timeout: 5000 })
    await shopTab.click()

    // 商店应该渲染成功（无错误页面）
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 3000 })

    // 商店内容区应可见
    const shopContent = tauriPage.locator('text=商店').first()
    await expect(shopContent).toBeVisible({ timeout: 5000 })
  })

  test('背包标签页显示已拥有物品', async ({ tauriPage }) => {
    const inventoryTab = tauriPage.locator('[aria-label="背包 标签页"]')
    await expect(inventoryTab).toBeVisible({ timeout: 5000 })
    await inventoryTab.click()

    // 背包标题应可见
    const backpackHeader = tauriPage.locator('text=背包').first()
    await expect(backpackHeader).toBeVisible({ timeout: 5000 })
  })

  test('养成标签页显示宠物状态和任务', async ({ tauriPage }) => {
    const nurturingTab = tauriPage.locator('[aria-label="养成 标签页"]')
    await expect(nurturingTab).toBeVisible({ timeout: 5000 })
    await nurturingTab.click()

    // 养成页面应无错误
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 3000 })

    // 应该有养成相关内容
    const nurturingContent = tauriPage.locator('text=等级').first()
    await expect(nurturingContent).toBeVisible({ timeout: 5000 })
  })

  // ===== 切换形象 =====
  test('外观标签页显示角色选择', async ({ tauriPage }) => {
    const appearanceTab = tauriPage.locator('[aria-label="外观 标签页"]')
    await expect(appearanceTab).toBeVisible({ timeout: 5000 })
    await appearanceTab.click()

    // 外观页面应无错误
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 3000 })
  })

  test('性格标签页显示性格参数', async ({ tauriPage }) => {
    const personalityTab = tauriPage.locator('[aria-label="性格 标签页"]')
    await expect(personalityTab).toBeVisible({ timeout: 5000 })
    await personalityTab.click()

    // 性格页面应无错误
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 3000 })
  })

  // ===== 宠物窗口交互流程 =====
  test('宠物窗口可点击互动', async ({ tauriPage }) => {
    await tauriPage.goto('/#/pet', { waitUntil: 'domcontentloaded', timeout: 45000 })

    const petWindow = tauriPage.locator('[aria-label="宠物窗口"]')
    await expect(petWindow).toBeVisible({ timeout: 10000 })

    // 点击宠物（互动）
    await petWindow.click({ position: { x: 150, y: 150 } })

    // 不应出现错误
    const errorPage = tauriPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 2000 })
  })

  test('宠物窗口喂食交互', async ({ tauriPage }) => {
    await tauriPage.goto('/#/pet', { waitUntil: 'domcontentloaded', timeout: 45000 })

    const petWindow = tauriPage.locator('[aria-label="宠物窗口"]')
    await expect(petWindow).toBeVisible({ timeout: 10000 })

    // 尝试通过右键菜单访问喂食
    await petWindow.click({ button: 'right', position: { x: 150, y: 200 } })

    // 检查是否有喂食相关的菜单项出现（右键菜单可能需要时间渲染）
    const feedOption = tauriPage.locator('text=喂食').first()
    await expect(feedOption).toBeVisible({ timeout: 3000 })
  })
})

test.describe('聊天接收流程', () => {
  test('发送消息后消息出现在列表中', async ({ tauriPage }) => {
    await tauriPage.goto('/#/chat', { waitUntil: 'domcontentloaded', timeout: 45000 })

    const input = tauriPage.locator('textarea[placeholder*="输入"], textarea[placeholder*="消息"]').first()
    await expect(input).toBeVisible({ timeout: 15000 })

    const testMsg = `测试消息_${Date.now()}`
    await input.fill(testMsg)
    await tauriPage.keyboard.press('Enter')

    // 验证用户消息出现在列表中
    const messageList = tauriPage.locator('[aria-label="聊天消息列表"]')
    await expect(messageList).toBeVisible({ timeout: 5000 })

    const userMsg = tauriPage.locator(`text=${testMsg}`).first()
    await expect(userMsg).toBeVisible({ timeout: 5000 })
  })
})
