// E2E 测试基础 fixture — 提供 Tauri API mock 和通用工具
import { test as base, type Page } from '@playwright/test'

// Tauri API mock 脚本内容（从 tauri-mock.ts 编译内联）
const TAURI_MOCK_SCRIPT = `
  ;(window).__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'pet-window' },
      currentWebview: { label: 'pet-window' },
    },
    transformCallback: function(cb, once) {
      var id = Math.floor(Math.random() * 1000000);
      window.__TAURI_CB__ = window.__TAURI_CB__ || {};
      window.__TAURI_CB__[id] = cb;
      return id;
    },
    invoke: function(cmd, args) {
      var defaults = {
        greet: 'Hello from SpiritPal (mock)',
        log_frontend_error: undefined,
        set_pet_click_through: undefined,
        remove_pet_click_through: undefined,
        get_idle_time: 0,
        get_active_window: { title: '', process_name: '' },
        import_petmod: undefined,
        scan_mods_directory: [],
        encrypt_data: '',
        decrypt_data: '',
        compute_sha256: '',
        get_secret: null,
        set_secret: undefined,
        delete_secret: undefined,
        set_tray_icon: undefined,
        update_tray_icon: undefined,
        open_application: undefined,
        start_device_listening: undefined,
        stop_device_listening: undefined,
        show_pet_panel: undefined,
        hide_pet_panel: undefined,
        set_pet_always_on_top: undefined,
      };
      return Promise.resolve(defaults[cmd] !== undefined ? defaults[cmd] : null);
    },
    registerPlugin: function() { return {}; },
  };
  window.__TAURI__ = { core: { invoke: window.__TAURI_INTERNALS__.invoke } };

  // Mock Tauri plugin-sql Database
  var mockDbInstance = {
    execute: function() { return Promise.resolve({ rows: [], rowsAffected: 0 }); },
    select: function() { return Promise.resolve([]); },
    close: function() { return Promise.resolve(); },
  };
  window.__TAURI_PLUGIN_SQL__ = { default: { load: function() { return Promise.resolve(mockDbInstance); } } };
`

// 扩展 Playwright test，自动注入 Tauri mock
export const test = base.extend<{ tauriPage: Page }>({
  tauriPage: async ({ page }, use) => {
    // 设置更长的默认超时
    page.setDefaultTimeout(60000)
    page.setDefaultNavigationTimeout(60000)

    // 在页面加载前注入 Tauri API mock
    await page.addInitScript(TAURI_MOCK_SCRIPT)

    // 拦截 console.error 以捕获未处理的 Tauri 错误
    const errors: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        errors.push(msg.text())
      }
    })

    await use(page)
  },
})

export { expect } from '@playwright/test'
