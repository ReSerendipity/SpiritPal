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
    unregisterCallback: function (id) {
      if (window.__TAURI_CB__) { delete window.__TAURI_CB__[id]; }
    },
    convertFileSrc: function (path) { return path; },
    invoke: function (cmd, args) {
      // 模拟「已完成 SQLite 迁移」用户态：迁移门控键（__sqlite_migration_done，db.ts:915）
      // 返回 '1'，跳过 migrateFromLocalStorage（db.ts:924）。否则 initDB 迁移会删除所有
      // spiritpal-* localStorage 键（含 spiritpal-first-run-done），预置的「已完成首次启动」
      // 状态被清、页面停在首屏登场（第二轮 P1-1 E2E 修复配套，已实测定位）。
      if (cmd === 'sp_settings_get' && args && args.key === '__sqlite_migration_done') {
        return Promise.resolve('1')
      }
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
        // 记忆面板（memory-system.spec.ts 覆盖路径）：查询类命令返回空数组，
        // 避免 mock 返回 null 使面板数据加载崩溃（第二轮 P1-1 E2E 修复配套）
        sp_owner_facts_list: [],
        sp_owner_facts_as_of: [],
        sp_mem_by_character: [],
        sp_entity_list: [],
        sp_sem_facts_list: [],
        sp_char_list: [],
      };
      return Promise.resolve(defaults[cmd] !== undefined ? defaults[cmd] : null);
    },
  };
`

/** 扩展后的 test：自动注入 Tauri mock，spec 从本文件导入 test/expect 以启用 mock */
export const test = base.extend({
  page: async ({ page }, use) => {
    // 预置首次启动状态：AgreementGate（spiritpal:agreement:v1）+ 首屏登场
    // （spiritpal-first-run-done，PetWindow.tsx:233）。E2E 每次新 context 无 localStorage，
    // 不预置则页面停在「使用前须知/登场」门、宠物面板不可达，此前被弱断言掩盖成假绿
    // （第二轮 P1-1 显式断言后暴露）。预置=模拟「已完成首次启动」用户态，非弱化断言。
    await page.addInitScript(`
      try {
        localStorage.setItem('spiritpal:agreement:v1', '2026-09-15')
        localStorage.setItem('spiritpal-first-run-done', '1')
      } catch (e) {}
    `)
    await page.addInitScript(TAURI_MOCK_SCRIPT)
    await use(page)
  },
})
