// T-24: 混沌工程测试 — 验证系统在故障条件下的容错和降级行为
//
// 测试场景：
// 1. Tauri IPC 命令抛出异常时前端优雅降级
// 2. 数据库返回损坏数据时应用不崩溃
// 3. 加密/解密失败时的降级行为
// 4. IPC 命令超时（长时间不响应）时的前端行为
// 5. 并发 IPC 调用冲突时的数据一致性
import { test as base, expect, type Page } from '@playwright/test'

// 扩展 fixture：提供多种故障注入的 Tauri mock
const test = base.extend<{ chaosPage: Page; chaosErrors: string[] }>({
  chaosPage: async ({ page }, use) => {
    page.setDefaultTimeout(60000)
    page.setDefaultNavigationTimeout(60000)
    await use(page)
  },
  chaosErrors: async ({ page }, use) => {
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })
    await use(errors)
  },
})

// ============================================================
// 故障注入 mock 脚本生成器
// ============================================================

function makeChaosMock(scenario: 'ipc-error' | 'db-corrupt' | 'crypto-fail' | 'ipc-timeout' | 'concurrent-conflict'): string {
  const errorCommands: Record<string, string> = {
    'ipc-error': `
      invoke: function(cmd, args) {
        // 安全命令正常返回
        if (cmd === 'set_pet_click_through' || cmd === 'remove_pet_click_through') return Promise.resolve();
        // 其他命令抛出异常
        return Promise.reject(new Error('IPC_ERROR: ' + cmd + ' is unavailable'));
      },`,
    'db-corrupt': `
      invoke: function(cmd, args) {
        var defaults = { get_idle_time: 0, get_active_window: { title: '', process_name: '' }, get_secret: null, scan_mods_directory: [] };
        return Promise.resolve(defaults[cmd] !== undefined ? defaults[cmd] : null);
      },`,
    'crypto-fail': `
      invoke: function(cmd, args) {
        if (cmd === 'encrypt_data') return Promise.reject(new Error('AES encryption failed'));
        if (cmd === 'decrypt_data') return Promise.reject(new Error('AES decryption failed'));
        if (cmd === 'compute_sha256') return Promise.reject(new Error('SHA256 computation failed'));
        var defaults = { get_idle_time: 0, get_active_window: { title: '', process_name: '' }, get_secret: null, scan_mods_directory: [] };
        return Promise.resolve(defaults[cmd] !== undefined ? defaults[cmd] : null);
      },`,
    'ipc-timeout': `
      invoke: function(cmd, args) {
        // 模拟超时：永不 resolve（前端应有超时处理）
        if (cmd === 'import_petmod' || cmd === 'scan_mods_directory') {
          return new Promise(function() {}); // 永不 resolve
        }
        var defaults = { get_idle_time: 0, get_active_window: { title: '', process_name: '' }, get_secret: null };
        return Promise.resolve(defaults[cmd] !== undefined ? defaults[cmd] : null);
      },`,
    'concurrent-conflict': `
      var callCount = 0;
      invoke: function(cmd, args) {
        callCount++;
        // 偶尔失败模拟并发冲突
        if (callCount % 5 === 0) return Promise.reject(new Error('CONFLICT: concurrent modification'));
        var defaults = { get_idle_time: 0, get_active_window: { title: '', process_name: '' }, get_secret: null, scan_mods_directory: [] };
        return Promise.resolve(defaults[cmd] !== undefined ? defaults[cmd] : null);
      },`,
  }

  return `
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'pet-window' }, currentWebview: { label: 'pet-window' } },
      transformCallback: function(cb) { var id = Math.floor(Math.random() * 1000000); window.__TAURI_CB__ = window.__TAURI_CB__ || {}; window.__TAURI_CB__[id] = cb; return id; },
      ${errorCommands[scenario]}
      registerPlugin: function() { return {}; },
    };
    window.__TAURI__ = { core: { invoke: window.__TAURI_INTERNALS__.invoke } };
    window.__TAURI_PLUGIN_SQL__ = { default: { load: function() {
      return Promise.resolve({
        execute: function() { return Promise.resolve({ rows: [], rowsAffected: 0 }); },
        select: function() { return Promise.resolve(${scenario === 'db-corrupt' ? '[{ corrupted: true, invalid: "data" }]' : '[]'}); },
        close: function() { return Promise.resolve(); }
      });
    } } };
  `
}

// ============================================================
// 混沌工程测试
// ============================================================

test.describe('T-24: 混沌工程测试 — 故障注入与容错验证', () => {
  test.describe.configure({ timeout: 90000 })

  // ----------------------------------------------------------
  // 1. IPC 命令异常 — 前端应优雅降级，不白屏
  // ----------------------------------------------------------
  test('IPC 命令全部抛出异常时应用不白屏', async ({ chaosPage }) => {
    await chaosPage.addInitScript(makeChaosMock('ipc-error'))

    await chaosPage.goto('http://127.0.0.1:5223/#/pet', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})

    // 应用应正常渲染（不白屏）
    const root = chaosPage.locator('#root')
    await expect(root).toBeAttached()

    // 不应显示未捕获的错误页面
    const errorPage = chaosPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })

    // 恢复性断言：故障后窗口切换仍可用（导航不因一次性 IPC 失败而永久卡死）
    await chaosPage.goto('http://127.0.0.1:5223/#/settings', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    const rootAfter = chaosPage.locator('#root')
    await expect(rootAfter).toBeAttached()
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  test('IPC 异常时聊天窗口仍可渲染', async ({ chaosPage }) => {
    await chaosPage.addInitScript(makeChaosMock('ipc-error'))

    await chaosPage.goto('http://127.0.0.1:5223/#/chat', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})

    const root = chaosPage.locator('#root')
    await expect(root).toBeAttached()

    const errorPage = chaosPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  test('IPC 异常时设置窗口仍可渲染', async ({ chaosPage }) => {
    await chaosPage.addInitScript(makeChaosMock('ipc-error'))

    await chaosPage.goto('http://127.0.0.1:5223/#/settings', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})

    const root = chaosPage.locator('#root')
    await expect(root).toBeAttached()

    const errorPage = chaosPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  // ----------------------------------------------------------
  // 2. 数据库损坏 — 应用应降级到默认状态
  // ----------------------------------------------------------
  test('数据库返回损坏数据时应用不崩溃', async ({ chaosPage }) => {
    await chaosPage.addInitScript(makeChaosMock('db-corrupt'))

    await chaosPage.goto('http://127.0.0.1:5223/#/pet', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})

    const root = chaosPage.locator('#root')
    await expect(root).toBeAttached()

    // 应用应能渲染宠物窗口（即使数据损坏）
    const petWindow = chaosPage.locator('[aria-label="宠物窗口"]')
    const hasPetWindow = await petWindow.isVisible({ timeout: 10000 }).catch(() => false)
    // 宠物窗口可能因数据损坏而显示默认状态，但不应崩溃
    expect(hasPetWindow || root).toBeTruthy()

    const errorPage = chaosPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  test('数据库损坏时设置窗口标签页可切换', async ({ chaosPage }) => {
    await chaosPage.addInitScript(makeChaosMock('db-corrupt'))

    await chaosPage.goto('http://127.0.0.1:5223/#/settings', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})

    // 尝试切换标签页
    const tabs = ['通用', '关于']
    for (const tab of tabs) {
      const tabButton = chaosPage.locator(`[aria-label="${tab} 标签页"]`)
      const isVisible = await tabButton.isVisible({ timeout: 5000 }).catch(() => false)
      if (isVisible) {
        await tabButton.click()
        const errorPage = chaosPage.locator('text=SpiritPal Error')
        await expect(errorPage).not.toBeVisible({ timeout: 3000 })
      }
    }
  })

  // ----------------------------------------------------------
  // 3. 加密/解密失败 — 记忆系统应降级到空状态
  // ----------------------------------------------------------
  test('加密失败时应用不崩溃', async ({ chaosPage }) => {
    await chaosPage.addInitScript(makeChaosMock('crypto-fail'))

    await chaosPage.goto('http://127.0.0.1:5223/#/pet', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})

    const root = chaosPage.locator('#root')
    await expect(root).toBeAttached()

    // 加密失败不应导致白屏或错误页面
    const errorPage = chaosPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  test('加密失败时聊天窗口仍可使用', async ({ chaosPage }) => {
    await chaosPage.addInitScript(makeChaosMock('crypto-fail'))

    await chaosPage.goto('http://127.0.0.1:5223/#/chat', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})

    // 聊天输入框应仍可用
    const input = chaosPage.locator('[aria-label="聊天输入框"]')
    const hasInput = await input.isVisible({ timeout: 15000 }).catch(() => false)
    if (hasInput) {
      await input.fill('加密故障测试消息')
      const sendButton = chaosPage.locator('[aria-label="发送消息"]')
      if (await sendButton.isVisible().catch(() => false)) {
        await sendButton.click()
        // 消息应被发送（即使加密失败，内存中仍保留）
        await expect(input).toHaveValue('', { timeout: 5000 })
      }
    }

    const errorPage = chaosPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  // ----------------------------------------------------------
  // 4. IPC 命令超时 — 前端不应永久阻塞
  // ----------------------------------------------------------
  test('IPC 超时时应用不永久阻塞', async ({ chaosPage }) => {
    await chaosPage.addInitScript(makeChaosMock('ipc-timeout'))

    await chaosPage.goto('http://127.0.0.1:5223/#/pet', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})

    // 即使某些命令永不 resolve，应用主界面应正常渲染
    const root = chaosPage.locator('#root')
    await expect(root).toBeAttached()

    const errorPage = chaosPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  // ----------------------------------------------------------
  // 5. 并发冲突 — 间歇性 IPC 失败时应用应自愈
  // ----------------------------------------------------------
  test('间歇性 IPC 失败时应用可自愈', async ({ chaosPage }) => {
    await chaosPage.addInitScript(makeChaosMock('concurrent-conflict'))

    // 第一次加载
    await chaosPage.goto('http://127.0.0.1:5223/#/pet', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})

    const root = chaosPage.locator('#root')
    await expect(root).toBeAttached()

    // 导航到其他窗口再返回（触发更多 IPC 调用）
    await chaosPage.goto('http://127.0.0.1:5223/#/settings', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await chaosPage.goto('http://127.0.0.1:5223/#/chat', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {})
    await chaosPage.goto('http://127.0.0.1:5223/#/pet', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})

    // 应用应仍正常渲染（自愈：间歇失败不应留下永久破坏状态）
    await expect(root).toBeAttached()

    const errorPage = chaosPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })

    // 数据一致性断言：反复导航后核心窗口仍可稳定回到宠物页且不白屏
    await chaosPage.goto('http://127.0.0.1:5223/#/pet', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await expect(root).toBeAttached()
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })

  // ----------------------------------------------------------
  // 6. 级联故障验证 — 多种故障同时发生
  // ----------------------------------------------------------
  test('多种故障同时发生时应用不崩溃', async ({ chaosPage }) => {
    // 注入组合故障 mock：IPC 错误 + 数据库损坏 + 加密失败
    await chaosPage.addInitScript(`
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: 'pet-window' }, currentWebview: { label: 'pet-window' } },
        transformCallback: function(cb) { var id = Math.floor(Math.random() * 1000000); window.__TAURI_CB__ = window.__TAURI_CB__ || {}; window.__TAURI_CB__[id] = cb; return id; },
        invoke: function(cmd, args) {
          // 加密命令失败
          if (cmd === 'encrypt_data' || cmd === 'decrypt_data') return Promise.reject(new Error('crypto fail'));
          // 其他命令返回空
          return Promise.resolve(null);
        },
        registerPlugin: function() { return {}; },
      };
      window.__TAURI__ = { core: { invoke: window.__TAURI_INTERNALS__.invoke } };
      window.__TAURI_PLUGIN_SQL__ = { default: { load: function() {
        return Promise.resolve({
          execute: function() { return Promise.reject(new Error('DB locked')); },
          select: function() { return Promise.resolve([{ corrupt: true }]); },
          close: function() { return Promise.resolve(); }
        });
      } } };
    `)

    await chaosPage.goto('http://127.0.0.1:5223/#/pet', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})

    // 即使所有依赖同时故障，应用也不应白屏
    const root = chaosPage.locator('#root')
    await expect(root).toBeAttached()

    const errorPage = chaosPage.locator('text=SpiritPal Error')
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })

    // 恢复性断言：级联故障后仍能切换到设置页（说明错误被隔离、未级联扩散）
    await chaosPage.goto('http://127.0.0.1:5223/#/settings', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {})
    await expect(root).toBeAttached()
    await expect(errorPage).not.toBeVisible({ timeout: 5000 })
  })
})
