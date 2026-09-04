/**
 * Tauri 前端 E2E fixture — 在纯 Web 环境（vite dev server，无 Tauri 后端）注入 Tauri IPC mock
 *
 * 背景（2026-09-04）：应用组件（PetWindow 等）在挂载时调用 `getCurrentWindow()` / `invoke()`
 * 读取 `window.__TAURI_INTERNALS__`。纯浏览器环境无该对象会抛
 * `Cannot read properties of undefined (reading 'transformCallback'/'metadata')` → 页面白屏 → 所有 E2E 失败。
 * 本 fixture 通过 `page.addInitScript` 在每次导航前注入 mock，使应用在无 Tauri 环境下正常渲染。
 */
import { test as base, expect } from '@playwright/test'

export { expect }

/** 注入到页面的 Tauri IPC mock 脚本（与 vitest setup.ts 的 window mock 对齐） */
const TAURI_MOCK_SCRIPT = `
  ;(window).__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'pet-window' },
      currentWebview: { label: 'pet-window' },
      windows: [{ label: 'pet-window' }],
    },
    transformCallback: function (cb, once) {
      var id = Math.floor(Math.random() * 1000000);
      window.__TAURI_CB__ = window.__TAURI_CB__ || {};
      window.__TAURI_CB__[id] = cb;
      return id;
    },
    invoke: function (cmd, args) {
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
        plugin:window|hide: undefined,
        plugin:window|show: undefined,
        plugin:window|set_size: undefined,
        plugin:window|set_position: undefined,
      };
      return Promise.resolve(defaults[cmd] !== undefined ? defaults[cmd] : null);
    },
  };
`

/** 扩展后的 test：自动注入 Tauri mock，spec 从本文件导入 test/expect 以启用 mock */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(TAURI_MOCK_SCRIPT)
    await use(page)
  },
})
