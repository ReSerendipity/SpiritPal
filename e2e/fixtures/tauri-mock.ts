// E2E 测试专用：在浏览器环境中 mock Tauri API
// Playwright 通过 page.addInitScript() 注入此脚本

// Mock __TAURI_INTERNALS__ — Tauri IPC 核心
;(window as any).__TAURI_INTERNALS__ = {
  metadata: {
    currentWindow: { label: 'pet-window' },
    currentWebview: { label: 'pet-window' },
  },
  transformCallback: (cb: Function, once?: boolean) => {
    const id = Math.floor(Math.random() * 1_000_000)
    ;(window as any).__TAURI_CB__ = (window as any).__TAURI_CB__ || {}
    ;(window as any).__TAURI_CB__[id] = cb
    return id
  },
  invoke: (cmd: string, args?: any) => {
    // 常见 Tauri 命令的默认返回值
    const defaults: Record<string, any> = {
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
    }
    return Promise.resolve(defaults[cmd] ?? null)
  },
  registerPlugin: () => ({}),
}

// Mock Tauri Event API
;(window as any).__TAURI_EVENT__ = {
  listeners: new Map(),
}

// Mock window.__TAURI__ for plugin compatibility
;(window as any).__TAURI__ = {
  core: {
    invoke: (window as any).__TAURI_INTERNALS__.invoke,
  },
}
