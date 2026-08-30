# BongoCat 开源仓库技术分析报告

> 仓库地址：https://github.com/ayangweb/BongoCat
> 分析日期：2026-07-14
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，重点对比 Tauri v2 桌面宠物实现方案，为 SpiritPal（Tauri v2 + React 19 + Rust）提供可移植特性参考

---

## 目录

1. [项目概览](#1-项目概览)
2. [核心技术栈](#2-核心技术栈)
3. [项目架构与目录结构](#3-项目架构与目录结构)
4. [核心功能模块详解](#4-核心功能模块详解)
5. [技术实现细节](#5-技术实现细节)
6. [可借鉴特性](#6-可借鉴特性)
7. [与 SpiritPal 的异同及移植建议](#7-与-spiritpal-的异同及移植建议)
8. [总结与技术参考价值](#8-总结与技术参考价值)

---

## 1. 项目概览

BongoCat 是一款基于 **Tauri v2 + Vue 3 + Rust** 构建的跨平台桌面宠物应用，灵感来源于 [Bongo-Cat-Mver](https://github.com/MMmmmoko/Bongo-Cat-Mver)（仅支持 Windows）。作者 ayangweb 作为深度 macOS 用户，借助 Tauri 的跨平台能力将其扩展到 macOS、Windows 和 Linux(x11) 三大平台。其核心玩法是通过监听键鼠/手柄输入，让一只 Live2D 猫咪在桌面上同步演示对应的按键动作，兼具趣味性与实用演示价值。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | BongoCat |
| 仓库地址 | https://github.com/ayangweb/BongoCat |
| 作者 | ayangweb（邮箱：ayangweb@foxmail.com） |
| 许可证 | **MIT**（`LICENSE` 文件确认） |
| 当前版本 | v1.1.0（`package.json:3` 与 `src-tauri/Cargo.toml:3` 一致） |
| 标识符 | `com.ayangweb.BongoCat`（`src-tauri/tauri.conf.json:5`） |
| 平台支持 | macOS / Windows / Linux(x11)（`README.md:5`） |
| 包管理器 | pnpm（强制，`package.json:19` 中 `preinstall: npx only-allow pnpm`） |
| 一句话定位 | 跟随键鼠/手柄动作的跨平台 Live2D 桌面猫咪宠物 |

### 当前状态

项目活跃度高，已发布至 v1.1.0，README 中展示 Trendshift 与 HelloGitHub 推荐徽章，具备完整的多语言（5 种）、自定义模型导入、自动更新、托盘菜单、全局快捷键等成熟桌面应用特性。采用 MIT 协议，允许自由借鉴与二次开发。

---

## 2. 核心技术栈

| 层级 | 技术 | 版本 | 职责 |
|------|------|------|------|
| **前端框架** | Vue 3 | ^3.5.32 | 响应式 UI、组件化、Composition API |
| **前端语言** | TypeScript | ^5.9.3 | 类型安全 |
| **桌面框架** | Tauri | v2（workspace `Cargo.toml:15`） | 跨平台桌面壳、IPC、窗口管理、插件体系 |
| **后端语言** | Rust | edition 2024（`src-tauri/Cargo.toml:6`） | 系统级交互、设备监听、窗口控制 |
| **Live2D 渲染** | easy-live2d | ^0.4.4 | Live2D Cubism 模型加载与渲染（封装层） |
| **渲染引擎** | pixi.js | ^8.18.1 | WebGL 2D 渲染（easy-live2d 底层依赖） |
| **状态管理** | Pinia | ^3.0.4 | 前端状态管理 + 持久化（tauri-plugin-pinia） |
| **UI 组件库** | antdv-next | ^1.2.2 | Ant Design Vue 的下一代分支 |
| **CSS 方案** | UnoCSS | ^66.6.8 | 原子化 CSS |
| **构建工具** | Vite | ^6.4.2 | 前端构建与 HMR |
| **包管理器** | pnpm | — | 依赖管理（强制） |
| **国际化** | vue-i18n | ^11.3.2 | 多语言（zh-CN/zh-TW/en-US/vi-VN/pt-BR） |
| **路由** | vue-router | ^4.6.4 | SPA 路由（main / preference 双页面） |
| **工具库** | es-toolkit / @vueuse/core | — | Lodash 替代 / Vue 组合式工具 |
| **键鼠监听** | rdev | git fork（`src-tauri/Cargo.toml:42`） | 跨平台键盘/鼠标事件监听 |
| **手柄监听** | gilrs | git fork（`src-tauri/Cargo.toml:43`） | 跨平台游戏手柄事件监听 |
| **macOS 窗口** | tauri-nspanel | v2.1 分支（`Cargo.toml:20`） | macOS NSPanel 私有 API 封装 |

### 技术栈特征

- **Tauri 原生插件自研**：在 `src-tauri/src/plugins/` 下自研 `tauri-plugin-custom-window`（窗口管理）与 `tauri-plugin-admin-status`（管理员权限检测）两个本地插件，通过 workspace path 依赖引入。
- **Rust + 前端双端事件通信**：Rust 端 `emit` 事件（`device-changed` / `gamepad-changed`），前端通过 `listen` 订阅。
- **Pinia 持久化下沉到 Rust**：使用 `@tauri-store/pinia` + `tauri-plugin-pinia`，状态自动持久化到 Rust 端存储，而非 localStorage。
- **平台条件编译**：大量使用 `#[cfg(target_os = "...")]` 实现同一命令在不同平台下的差异化实现。

---

## 3. 项目架构与目录结构

### 3.1 整体架构

BongoCat 采用 **Rust 原生层 / Tauri 插件层 / Vue 前端层** 三层架构，双窗口（main 宠物浮层 + preference 设置面板）通过路由切换：

```
┌──────────────────────────────────────────────────────────┐
│                  Vue 前端层 (src/)                         │
│  ┌──────────────┐    ┌──────────────────────────────┐    │
│  │  main 页面    │    │  preference 页面              │    │
│  │  (宠物浮层)   │    │  (设置: 通用/模型/快捷键/关于) │    │
│  └──────┬───────┘    └──────────────┬───────────────┘    │
│         │  composables (useDevice/   │                    │
│         │  useGamepad/useModel/      │                    │
│         │  useTray/useKeyPress...)   │                    │
│         │  stores (app/cat/general/  │                    │
│         │  model/shortcut)           │                    │
│         │  utils (live2d/keyboard/   │                    │
│         │  monitor/path/platform)    │                    │
│         └─────────────┬──────────────┘                    │
└───────────────────────┼──────────────────────────────────┘
                        │  invoke / listen (IPC)
┌───────────────────────┼──────────────────────────────────┐
│              Tauri 插件层 (src-tauri/src/plugins/)         │
│  ┌────────────────────┴───────────────────────────────┐  │
│  │  tauri-plugin-custom-window                         │  │
│  │    (show/hide/set_always_on_top/set_taskbar)        │  │
│  │    ├─ macos.rs (NSPanel)                            │  │
│  │    ├─ windows.rs (SetWindowPos 轮询)                │  │
│  │    └─ linux.rs                                      │  │
│  │  tauri-plugin-admin-status (Windows UAC 检测)       │  │
│  └────────────────────────────────────────────────────┘  │
└───────────────────────┬──────────────────────────────────┘
                        │
┌───────────────────────┼──────────────────────────────────┐
│              Rust 核心层 (src-tauri/src/core/)            │
│  ┌────────────┬───────────────┬───────────────────────┐  │
│  │ device.rs  │ gamepad.rs    │ setup/                │  │
│  │ (rdev 键鼠)│ (gilrs 手柄)  │  ├─ common.rs (空)    │  │
│  │            │               │  └─ macos.rs (NSPanel)│  │
│  │ prevent_default.rs         │                       │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

### 3.2 关键目录与文件

```
BongoCat/
├── src/                                    # 前端源码
│   ├── pages/
│   │   ├── main/index.vue                  # 宠物主窗口（Live2D 画布 + 键鼠监听）
│   │   └── preference/                     # 设置窗口（general/model/shortcut/about）
│   ├── composables/                        # 组合式逻辑
│   │   ├── useDevice.ts                    # 键鼠事件处理 + 光标平滑
│   │   ├── useGamepad.ts                   # 手柄事件 → Live2D 参数
│   │   ├── useModel.ts                     # 模型加载 + 按键映射 + 鼠标跟随
│   │   ├── useTray.ts                      # 托盘图标与菜单
│   │   ├── useAppMenu.ts                   # 应用菜单（缩放/透明度/穿透/退出）
│   │   ├── useKeyPress.ts                  # 全局快捷键注册
│   │   ├── useWindowState.ts              # 窗口位置/尺寸持久化与屏幕内钳制
│   │   └── useTauriListen.ts              # Tauri 事件监听封装
│   ├── stores/                             # Pinia 状态
│   │   ├── app.ts                          # 应用名/版本/窗口状态
│   │   ├── cat.ts                          # 猫咪窗口与模型配置
│   │   ├── general.ts                      # 通用设置（自启/主题/语言/更新）
│   │   ├── model.ts                        # 模型列表与当前模型
│   │   └── shortcut.ts                     # 全局快捷键绑定
│   ├── utils/
│   │   ├── live2d.ts                       # easy-live2d 封装单例
│   │   ├── keyboard.ts                     # 键盘按键处理
│   │   ├── monitor.ts                      # 显示器信息获取
│   │   ├── path.ts                         # 跨平台路径拼接
│   │   ├── platform.ts                     # 平台判断
│   │   ├── is.ts                           # 类型判断工具
│   │   └── shared.ts                       # 共享工具
│   ├── plugins/
│   │   ├── window.ts                       # 自定义窗口插件前端封装
│   │   └── adminStatus.ts                  # 管理员状态前端封装
│   ├── locales/                            # 5 种语言 JSON
│   └── constants/index.ts                  # 事件/命令/语言/窗口标签常量
├── src-tauri/
│   ├── tauri.conf.json                     # Tauri 主配置（双窗口 + 更新器）
│   ├── Cargo.toml                          # Rust 依赖
│   ├── src/
│   │   ├── lib.rs                          # 应用入口 + 插件注册
│   │   ├── core/
│   │   │   ├── device.rs                   # rdev 键鼠监听
│   │   │   ├── gamepad.rs                  # gilrs 手柄监听
│   │   │   ├── prevent_default.rs          # 调试模式禁用右键/刷新
│   │   │   └── setup/                      # 平台初始化
│   │   │       ├── mod.rs                  # 平台分发
│   │   │       ├── common.rs               # 非 macOS 空实现
│   │   │       └── macos.rs                # macOS NSPanel 配置
│   │   ├── utils/fs_extra.rs              # 目录复制命令
│   │   └── plugins/
│   │       ├── window/                     # 自定义窗口插件
│   │       │   └── src/
│   │       │       ├── lib.rs              # 插件注册
│   │       │       └── commands/
│   │       │           ├── mod.rs          # 平台分发 + show/hide 通用
│   │       │           ├── macos.rs        # NSPanel show/hide/置顶
│   │       │           ├── windows.rs      # SetWindowPos 轮询置顶
│   │       │           └── linux.rs        # set_always_on_top/bottom
│   │       └── admin-status/              # Windows 管理员检测
│   │           └── src/commands/mod.rs     # OpenProcessToken + TOKEN_ELEVATION
│   └── assets/models/                      # 3 套预设模型(standard/keyboard/gamepad)
├── Cargo.toml                              # workspace 根配置
└── package.json                            # 前端依赖与脚本
```

---

## 4. 核心功能模块详解

### 4.1 窗口管理模块

| 子功能 | 实现位置 | 说明 |
|--------|----------|------|
| 双窗口声明 | `src-tauri/tauri.conf.json:14-37` | main（透明置顶浮层）+ preference（隐藏设置窗） |
| 自定义窗口插件 | `src-tauri/src/plugins/window/src/lib.rs:10-19` | 注册 show/hide/set_always_on_top/set_taskbar_visibility 四个命令 |
| 平台分发 | `src-tauri/src/plugins/window/src/commands/mod.rs:6-22` | `#[cfg(target_os)]` 条件编译选择 macos/windows/linux 实现 |
| macOS NSPanel | `src-tauri/src/plugins/window/src/commands/macos.rs:16-60` | 通过 tauri-nspanel 管理 NSPanel 的 show/hide/level |
| Windows 置顶轮询 | `src-tauri/src/plugins/window/src/commands/windows.rs:26-79` | 16ms 间隔 SetWindowPos(HWND_TOPMOST) 保持续顶 |
| 前端封装 | `src/plugins/window.ts:11-54` | invoke 命令 + emit 跨窗口事件 |
| 关闭即隐藏 | `src-tauri/src/lib.rs:65-72` | `WindowEvent::CloseRequested` → `window.hide()` + `prevent_close()` |

### 4.2 设备输入追踪模块

| 子功能 | 实现位置 | 说明 |
|--------|----------|------|
| 键鼠监听命令 | `src-tauri/src/core/device.rs:24-63` | `start_device_listening` 使用 rdev::listen，emit `device-changed` |
| 事件类型 | `src-tauri/src/core/device.rs:7-14` | MousePress/Release/Move + KeyboardPress/Release |
| 手柄监听命令 | `src-tauri/src/core/gamepad.rs:22-52` | `start_gamepad_listing` 使用 gilrs 轮询，emit `gamepad-changed` |
| 手柄停止 | `src-tauri/src/core/gamepad.rs:54-61` | `stop_gamepad_listing` 通过 AtomicBool 停止轮询 |
| 单例防重入 | `src-tauri/src/core/device.rs:22` / `gamepad.rs:6` | `IS_LISTENING: AtomicBool` 保证只启动一次 |
| 前端键鼠处理 | `src/composables/useDevice.ts:43-223` | 监听事件 → Live2D 按键映射 + 光标平滑 |
| 前端手柄处理 | `src/composables/useGamepad.ts:35-103` | 监听事件 → 摇杆参数 + 按键映射 |

### 4.3 Live2D 渲染模块

| 子功能 | 实现位置 | 说明 |
|--------|----------|------|
| Live2d 单例封装 | `src/utils/live2d.ts:18-138` | 封装 pixi.js Application + easy-live2d Live2DSprite |
| 应用初始化 | `src/utils/live2d.ts:24-38` | `initApp` 创建 Application，绑定 canvas，背景透明 |
| 模型加载 | `src/utils/live2d.ts:40-85` | readDir 查找 `.model3.json` → JSON5 解析 → CubismSetting → convertFileSrc 重定向资源 → Live2DSprite |
| 模型缩放适配 | `src/utils/live2d.ts:95-108` | `resizeModel` 按比例缩放并居中 |
| 参数设置 | `src/utils/live2d.ts:121-127` | `getParameterValueRange` / `setParameterValue` |
| 动作/表情 | `src/utils/live2d.ts:110-119` | `startMotion` / `setExpression` |
| FPS 限制 | `src/utils/live2d.ts:133-135` | `Ticker.shared.maxFPS = fps` |
| 加载流程编排 | `src/composables/useModel.ts:68-112` | `handleLoad` 调用 live2d.load 并收集动作/表情快捷键 |
| 画布挂载 | `src/pages/main/index.vue:198` | `<canvas id="live2dCanvas" />` |

### 4.4 设置与状态持久化模块

| 子功能 | 实现位置 | 说明 |
|--------|----------|------|
| Pinia 持久化插件 | `src/main.ts:14-15` | `createPlugin({ saveOnChange: true })` |
| Rust 端 pinia | `src-tauri/src/lib.rs:41` | `tauri_plugin_pinia::init()` |
| 通用设置 store | `src/stores/general.ts:26-95` | 自启/任务栏/托盘/主题/语言/更新检查 |
| 猫咪配置 store | `src/stores/cat.ts:27-94` | 模型镜像/声音/行为/窗口可见性/穿透/置顶/缩放/透明度 |
| 模型 store | `src/stores/model.ts:20-67` | 模型列表 + 当前模型 + 按键映射（filterKeys 排除高频字段） |
| 字段迁移机制 | `src/stores/cat.ts:28-49` / `general.ts:27-46` | `@deprecated` 旧字段自动迁移到新结构，`migrated` 标志位 |

### 4.5 托盘与菜单模块

| 子功能 | 实现位置 | 说明 |
|--------|----------|------|
| 托盘创建 | `src/composables/useTray.ts:41-64` | `TrayIcon.new` 带 menu/icon/tooltip/iconAsTemplate |
| 托盘菜单构建 | `src/composables/useTray.ts:66-93` | 基础菜单 + 检查更新 + 开源链接 + 版本 + 退出 |
| 菜单动态更新 | `src/composables/useTray.ts:95-103` | watch 状态变化 + debounce 更新 |
| 应用菜单 | `src/composables/useAppMenu.ts:11-113` | 偏好设置/显隐猫咪/穿透/缩放子菜单/透明度子菜单/重启/退出 |
| 托盘可见性 | `src/composables/useTray.ts:105-111` | watch `trayVisible` 控制托盘显隐 |
| 平台图标差异 | `src/composables/useTray.ts:51-52` | macOS 用 `tray-mac.png`，其他用 `tray.png` |

### 4.6 自动更新模块

| 子功能 | 实现位置 | 说明 |
|--------|----------|------|
| 更新器配置 | `src-tauri/tauri.conf.json:65-73` | 双端点：自定义 API + gh-proxy 代理 |
| 更新器插件 | `src-tauri/src/lib.rs:42` | `tauri_plugin_updater::Builder::new().build()` |
| 更新组件 | `src/components/update-app/index.vue` | 前端更新检查 UI |
| 自动检查开关 | `src/stores/general.ts:58-60` | `update.autoCheck` |

### 4.7 国际化模块

| 子功能 | 实现位置 | 说明 |
|--------|----------|------|
| i18n 初始化 | `src/locales/index.ts:20-31` | vue-i18n 非 legacy 模式，5 种语言 |
| antd 本地化 | `src/locales/index.ts:33-43` | `getAntdLocale` 同步 antdv-next 组件语言 |
| 系统语言检测 | `src/stores/general.ts:62-70` | `getLocale` from `tauri-plugin-locale-api`，回退 en-US |
| 语言切换响应 | `src/App.vue:48-50` | watch language → `locale.value` |

---

## 5. 技术实现细节

本节提供精确到 `文件:行号` 的实现引用，便于移植时定位。

### 5.1 Tauri 透明窗口配置

**位置**：`src-tauri/tauri.conf.json:14-26`

```jsonc
{
  "label": "main",
  "title": "BongoCat",
  "url": "index.html/#/",
  "shadow": false,           // 无阴影
  "alwaysOnTop": true,       // 始终置顶
  "transparent": true,       // 透明背景
  "decorations": false,      // 无标题栏
  "acceptFirstMouse": true,  // 接受首次鼠标点击（macOS）
  "skipTaskbar": true,       // 不在任务栏显示
  "maximizable": false       // 禁止最大化
}
```

`macOSPrivateApi: true`（`src-tauri/tauri.conf.json:13`）启用 macOS 私有 API，配合 `tauri-nspanel` 实现 NSPanel 浮层。Cargo 依赖中显式开启 `macos-private-api` feature（`src-tauri/Cargo.toml:21`）。

### 5.2 始终置顶（alwaysOnTop）三平台实现

**Windows 轮询置顶**：`src-tauri/src/plugins/window/src/commands/windows.rs:26-79`

Windows 平台未使用 Tauri 原生 `set_always_on_top`，而是通过 `SetWindowPos(HWND_TOPMOST)` 在独立线程中每 16ms 重复调用以"强制续顶"（避免被其他置顶窗口覆盖）：

```rust
thread::spawn(move || {
    while running.load(Ordering::SeqCst) {
        unsafe {
            let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
        thread::sleep(Duration::from_millis(16));
    }
});
```

取消置顶时设置 `HWND_NOTOPMOST` 并将 `AtomicBool` 置 false 停止轮询（`windows.rs:62-78`）。

**macOS NSPanel Level**：`src-tauri/src/plugins/window/src/commands/macos.rs:49-55`

通过 `panel.set_level(PanelLevel::Dock.value())` 将面板层级提升至 Dock 级别；取消时设为 `-1`。

**Linux**：`src-tauri/src/plugins/window/src/commands/linux.rs:16-28`

使用 Tauri 原生 `set_always_on_top(true)` / `set_always_on_bottom(true)` 切换。

### 5.3 点击穿透（click-through）

**前端切换**：`src/pages/main/index.vue:118-120`

```ts
watch(() => catStore.window.passThrough, (value) => {
  appWindow.setIgnoreCursorEvents(value)
}, { immediate: true })
```

**悬停自动隐藏**：`src/composables/useDevice.ts:123-157`

`onHideOnHover` 闭包根据光标是否进入宠物窗口区域，延迟（`hideOnHoverDelay * 1000` ms）后设置 `document.body.style.opacity = '0'` 并 `setIgnoreCursorEvents(true)`；离开时恢复透明度并按 `passThrough` 状态决定是否恢复鼠标事件。

### 5.4 开机自启

**Rust 插件注册**：`src-tauri/src/lib.rs:55-58`

```rust
.plugin(tauri_plugin_autostart::init(
    MacosLauncher::LaunchAgent,   // macOS 使用用户级 LaunchAgent（非 LaunchDaemon）
    None,                          // 无额外启动参数（对比 SpiritPal 传 --autostart）
))
```

**前端开关**：`src/stores/general.ts:47-51` 中 `app.autostart` 字段，由设置页绑定。

### 5.5 自动更新器（双端点）

**配置**：`src-tauri/tauri.conf.json:65-73`

```jsonc
"updater": {
  "dangerousInsecureTransportProtocol": true,   // 允许 http（自定义 API）
  "pubkey": "dW50cnVzdGVkIGNvbW1lbnQ6...",
  "endpoints": [
    "http://api.upgrade.toolsetlink.com/v1/tauri/upgrade?tauriKey=...&versionName={{current_version}}&target={{target}}&arch={{arch}}",
    "https://gh-proxy.com/github.com/ayangweb/BongoCat/releases/latest/download/latest.json"
  ]
}
```

采用**主备双端点**策略：优先请求自定义 API（支持灰度/指定版本），失败后回退到 gh-proxy 代理的 GitHub Releases `latest.json`。`dangerousInsecureTransportProtocol` 因主端点为 http 而开启。

### 5.6 Live2D 模型加载（easy-live2d + pixi.js）

**依赖**：`package.json:41` `easy-live2d: ^0.4.4` + `package.json:47` `pixi.js: ^8.18.1`

**加载流程**：`src/utils/live2d.ts:40-85`

1. `initApp()`（`live2d.ts:24-38`）：创建 `pixi.js Application`，绑定 `#live2dCanvas`，`backgroundAlpha: 0` 透明，`resolution: devicePixelRatio`。
2. `readDir(path)` 读取模型目录，查找 `.model3.json` 文件（`live2d.ts:45-51`）。
3. `JSON5.parse` 解析模型配置（`live2d.ts:55`），支持 JSON5 注释。
4. 构造 `CubismSetting({ modelJSON })`（`live2d.ts:57-59`）。
5. `modelSetting.redirectPath` 将资源路径重定向为 `convertFileSrc(join(path, file))`（`live2d.ts:61-63`），使 Tauri 的 asset 协议能加载本地文件。
6. `new Live2DSprite({ modelSetting, ticker: Ticker.shared })` 创建精灵并 `addChild` 到 stage（`live2d.ts:65-70`）。
7. `await this.model.ready` 等待就绪后返回 `{ width, height, motions, expressions }`（`live2d.ts:72-84`）。

**鼠标跟随参数**：`src/composables/useModel.ts:172-222` 中 `handleMouseMove` 将光标在显示器中的比例映射到 `ParamMouseX/Y`、`ParamAngleX/Y/Z`、`ParamEyeBallX/Y` 等 Live2D 参数。

**光标平滑**：`src/composables/useDevice.ts:53-76` 使用 `Ticker` 回调 + 阻尼衰减（`DAMPING_DECAY = 0.75`）做指数平滑插值。

### 5.7 设备输入追踪（rdev + gilrs）

**rdev 键鼠监听**：`src-tauri/src/core/device.rs:1-63`

- 依赖：`src-tauri/Cargo.toml:42` `rdev = { git = "https://github.com/kunkunsh/rdev" }`（使用 fork 版本）。
- `start_device_listening`（`device.rs:24-63`）调用 `rdev::listen(callback)`，将 `EventType::ButtonPress/Release/MouseMove/KeyPress/KeyRelease` 转为 `DeviceEvent` 结构体，通过 `app_handle.emit("device-changed", device_event)` 推送到前端。
- `IS_LISTENING: AtomicBool`（`device.rs:22`）防止重复启动。

**gilrs 手柄监听**：`src-tauri/src/core/gamepad.rs:1-61`

- 依赖：`src-tauri/Cargo.toml:43` `gilrs = { git = "https://github.com/ayangweb/gilrs", default-features = false, features = ["xinput"] }`（作者自维护 fork，仅启用 xinput）。
- `start_gamepad_listing`（`gamepad.rs:22-52`）在 `while IS_LISTENING` 循环中 `gilrs.next_event()`，过滤 `ButtonChanged` / `AxisChanged` 事件 emit `gamepad-changed`。
- `stop_gamepad_listing`（`gamepad.rs:54-61`）通过 `AtomicBool` 停止循环。

**日志过滤**：`src-tauri/src/lib.rs:52` 中 `tauri_plugin_log` 配置 `.filter(|metadata| !metadata.target().contains("gilrs"))` 屏蔽 gilrs 噪音日志。

### 5.8 托盘图标

**创建**：`src/composables/useTray.ts:41-64`

```ts
const options: TrayIconOptions = {
  menu,
  icon,                       // macOS: tray-mac.png，其他: tray.png
  id: TRAY_ID,                // 'BONGO_CAT_TRAY'
  tooltip: `${appName} v${appVersion}`,
  iconAsTemplate: true,       // macOS 模板图标（自动适配深色模式）
  menuOnLeftClick: true,      // 左键点击直接弹出菜单
}
```

**菜单结构**：`src/composables/useTray.ts:66-93` 依次为：基础菜单（偏好/显隐/穿透/缩放/透明度）→ 分隔 → 检查更新 → 开源链接 → 分隔 → 版本号（禁用）→ 退出菜单（重启/退出）。

**动态更新**：`src/composables/useTray.ts:29-35` watch 窗口可见性/穿透/语言立即更新，缩放/透明度 debounce 200ms 更新。

### 5.9 单实例

**位置**：`src-tauri/src/lib.rs:44-48`

```rust
.plugin(tauri_plugin_single_instance::init(
    |app_handle, _argv, _cwd| {
        show_preference_window(app_handle);   // 再次启动时显示设置窗口
    },
))
```

第二次启动应用时不会创建新实例，而是回调显示已运行实例的 preference 窗口。

### 5.10 全局快捷键

**Rust 插件**：`src-tauri/src/lib.rs:63` `tauri_plugin_global_shortcut::Builder::new().build()`

**前端注册**：`src/composables/useKeyPress.ts:11-39`

```ts
watch(shortcut, async (value) => {
  await unbind()                          // 先解绑旧快捷键
  if (!value) return
  await register(value, (event) => {
    if (event.state === 'Released') return
    callback(event)                       // 仅在按下时触发
  })
  oldShortcut.value = value
}, { immediate: true })
```

`onUnmounted(unbind)` 确保组件销毁时解绑。绑定的快捷键存储在 `src/stores/shortcut.ts`（visibleCat/mirrorMode/penetrable/alwaysOnTop 等）。

### 5.11 国际化（i18n）

**初始化**：`src/locales/index.ts:20-31`

```ts
export const i18n = createI18n({
  legacy: false,                          // 使用 Composition API 模式
  locale: LANGUAGE.EN_US,                 // 默认英文
  fallbackLocale: LANGUAGE.EN_US,
  messages: { 'zh-CN': zhCN, 'zh-TW': zhTW, 'en-US': enUS, 'vi-VN': viVN, 'pt-BR': ptBR },
})
```

**系统语言检测**：`src/stores/general.ts:62-70` 调用 `tauri-plugin-locale-api` 的 `getLocale`，匹配支持列表则使用，否则回退 `EN_US`。

**antd 组件本地化**：`src/locales/index.ts:33-43` `getAntdLocale` 根据 language 返回对应的 antdv-next locale 包。

### 5.12 macOS 权限与 NSPanel

**Input Monitoring 权限**：`src/pages/preference/components/general/components/macos-permissions/index.vue:14-29`

由于 rdev 监听全局键鼠需要 macOS 输入监控权限，组件挂载时 `checkInputMonitoringPermission()` 检查授权状态，未授权则弹窗引导用户 `requestInputMonitoringPermission()`。

**NSPanel 配置**：`src-tauri/src/core/setup/macos.rs:28-91`

```rust
let panel = main_window.to_panel::<NsPanel>().unwrap();
panel.set_level(PanelLevel::Dock.value());                       // Dock 级别
panel.set_style_mask(StyleMask::empty().resizable().nonactivating_panel().into());  // 非激活面板
panel.set_collection_behavior(
    CollectionBehavior::new()
        .stationary()           // 固定位置
        .move_to_active_space() // 跟随活动 Space
        .full_screen_auxiliary() // 全屏辅助
        .into(),
);
```

`tauri_panel!` 宏（`macos.rs:11-26`）定义 NsPanel 及事件处理器（window_did_become_key/resign_key/resize/move），通过 `emit_to` 转发到前端。

**Dock 隐藏**：`src-tauri/src/core/setup/macos.rs:35` `app_handle.set_dock_visibility(false)` 隐藏 Dock 图标。

**macOS Reopen**：`src-tauri/src/lib.rs:77-79` 处理 `RunEvent::Reopen`（点击 Dock 图标时）显示 preference 窗口。

### 5.13 窗口关闭即隐藏

**位置**：`src-tauri/src/lib.rs:65-72`

```rust
.on_window_event(|window, event| match event {
    WindowEvent::CloseRequested { api, .. } => {
        let _ = window.hide();       // 隐藏而非关闭
        api.prevent_close();         // 阻止真正关闭
    }
    _ => {}
})
```

确保点击关闭按钮时窗口仅隐藏，应用常驻后台。

### 5.14 prevent-default 插件

**位置**：`src-tauri/src/core/prevent_default.rs:1-13`

调试模式下使用 `tauri_plugin_prevent_default` 禁用除右键菜单外的默认行为（F12 开发者工具等），发布模式直接 `init()`。

### 5.15 Windows 管理员权限检测

**位置**：`src-tauri/src/plugins/admin-status/src/commands/mod.rs:4-39`

通过 `OpenProcessToken` + `GetTokenInformation(TokenElevation)` 检测当前进程是否以管理员权限运行，非 Windows 平台直接返回 `Ok(true)`。

---

## 6. 可借鉴特性

以下特性对 SpiritPal 具备直接移植价值，按重要程度排列：

1. **Windows 置顶轮询保活机制** — `src-tauri/src/plugins/window/src/commands/windows.rs:26-79`
   解决 Tauri 原生 `set_always_on_top` 在某些场景下被其他置顶窗口覆盖的问题，16ms 轮询 `SetWindowPos(HWND_TOPMOST)` 强制续顶。

2. **macOS NSPanel 浮层方案** — `src-tauri/src/core/setup/macos.rs:28-91` + `src-tauri/src/plugins/window/src/commands/macos.rs:16-60`
   使用 tauri-nspanel 将宠物窗口转为 NSPanel，支持 `nonactivating_panel`（不抢焦点）、`move_to_active_space`（跨 Space 跟随）、`full_screen_auxiliary`（全屏可见），是 macOS 桌宠的最佳实践。

3. **rdev 全局键鼠监听** — `src-tauri/src/core/device.rs:24-63`
   跨平台键鼠事件捕获，配合 macOS Input Monitoring 权限申请流程（`src/pages/preference/components/general/components/macos-permissions/index.vue`）。

4. **双端点自动更新** — `src-tauri/tauri.conf.json:65-73`
   主端点（自定义 API 灰度）+ 备端点（gh-proxy 代理 GitHub）的双链路更新，提升国内可达性。

5. **窗口关闭即隐藏** — `src-tauri/src/lib.rs:65-72`
   一行代码实现常驻后台，避免误关闭退出。

6. **单实例 + Reopen 显示设置** — `src-tauri/src/lib.rs:44-48` / `77-79`
   防止多开 + 点击 Dock/任务栏图标时唤起设置窗口。

7. **Pinia 状态持久化下沉 Rust** — `src/main.ts:14-15` + `src-tauri/src/lib.rs:41`
   状态存储在 Rust 端而非 localStorage，支持 filterKeys 排除高频字段（`src/stores/model.ts:67-70`）。

8. **托盘菜单动态更新 + 平台图标差异** — `src/composables/useTray.ts:41-64`
   macOS 使用 `tray-mac.png` + `iconAsTemplate: true`，watch 状态变化 debounce 更新菜单。

9. **悬停自动隐藏 + 鼠标穿透联动** — `src/composables/useDevice.ts:123-157`
   光标进入宠物窗口区域时延迟隐藏并开启穿透，离开后恢复，兼顾交互与不遮挡操作。

10. **Live2D 资源 convertFileSrc 重定向** — `src/utils/live2d.ts:61-63`
    `CubismSetting.redirectPath` 将模型内部相对路径重定向为 Tauri asset 协议 URL，安全加载本地资源。

11. **光标平滑阻尼插值** — `src/composables/useDevice.ts:53-76`
    `DAMPING_DECAY = 0.75` 指数平滑，避免 Live2D 视线/头部参数抖动。

12. **easy-live2d + pixi.js 8 渲染栈** — `package.json:41,47` + `src/utils/live2d.ts:18-138`
    相比 SpiritPal 当前使用的 `pixi-live2d-display@0.4.0` + `pixi.js@7.4.3`，easy-live2d 是基于 pixi.js 8 的更新封装，性能与维护更优。

13. **字段迁移机制** — `src/stores/cat.ts:28-49` / `src/stores/general.ts:27-46`
    `@deprecated` 旧字段 + `migrated` 标志位，实现 store 结构升级时的平滑数据迁移。

14. **CSP 放宽 + assetProtocol 全局允许** — `src-tauri/tauri.conf.json:38-48`
    `csp: null` + `assetProtocol.scope.allow: ["**/*"]` + `dangerousDisableAssetCspModification: true`，便于加载任意本地模型资源（需评估安全权衡）。

---

## 7. 与 SpiritPal 的异同及移植建议

### 7.1 Tauri 配置对比

| 配置项 | BongoCat | SpiritPal | 差异 |
|--------|----------|--------|------|
| 透明窗口 | `transparent: true`（main） | `transparent: true`（pet-window） | 一致 |
| 无装饰 | `decorations: false`（main） | `decorations: false`（pet-window） | 一致 |
| 始终置顶 | `alwaysOnTop: true`（main） | `alwaysOnTop: true`（pet-window） | 一致 |
| 跳过任务栏 | `skipTaskbar: true`（main） | `skipTaskbar: true`（pet-window） | 一致 |
| macOSPrivateApi | `true`（`conf:13`） | `true`（`conf:54`） | 一致 |
| acceptFirstMouse | `true`（main） | 未设置 | BongoCat 更优 |
| maximizable | `false`（main） | 未设置 | BongoCat 更严谨 |
| 窗口数量 | 2（main + preference） | 3（pet + settings + chat） | SpiritPal 多一个聊天窗 |
| preference 窗口 | `titleBarStyle: Overlay` + `hiddenTitle: true` | settings: `decorations: true` | BongoCat 用 macOS 原生 Overlay 标题栏 |
| CSP | `null` + `dangerousDisableAssetCspModification` | 完整 CSP 策略 | SpiritPal 更安全 |
| 更新器端点 | 双端点（自定义 API + gh-proxy） | 单端点（GitHub raw） | BongoCat 更健壮 |
| bundle targets | nsis/dmg/app/appimage/deb/rpm | nsis/dmg/appimage/deb | BongoCat 多 app/rpm |

### 7.2 逐项移植建议

| 特性 | 优先级 | 对应 SpiritPal 现状文件 | 移植难度 | 建议 Phase | 说明 |
|------|--------|----------------------|----------|-----------|------|
| **Windows 置顶轮询保活** | P0 | `spiritpal-app/src-tauri/src/lib.rs:977-985`（仅注册快捷键，未处理置顶） | 低 | Phase 1 | 移植 `windows.rs:26-79` 的 `SetWindowPos` 轮询逻辑，解决 SpiritPal 宠物窗被其他置顶窗口覆盖问题 |
| **窗口关闭即隐藏** | P0 | SpiritPal 未实现（关闭即退出） | 极低 | Phase 1 | 在 `lib.rs` 的 `tauri::Builder` 链中加 `.on_window_event` 处理 `CloseRequested` → `hide` + `prevent_close`，单行改动 |
| **单实例插件** | P0 | SpiritPal 未实现 | 极低 | Phase 1 | 添加 `tauri-plugin-single-instance` 依赖 + `.plugin(tauri_plugin_single_instance::init(...))`，防止多开 |
| **macOS NSPanel 浮层** | P1 | SpiritPal 仅 `macOSPrivateApi: true`，未用 NSPanel | 高 | Phase 2 | 需引入 `tauri-nspanel` + 在 setup 中配置 PanelLevel/StyleMask/CollectionBehavior，涉及 macOS 私有 API，建议优先级高但实现需谨慎 |
| **rdev 全局键鼠监听** | P1 | SpiritPal 仅 Windows `get_idle_ms`（`lib.rs:88-101`） | 中 | Phase 2 | 移植 `device.rs` + gilrs，配合 macOS Input Monitoring 权限申请；SpiritPal 可用于"宠物注视光标""按键互动"等增强玩法 |
| **双端点自动更新** | P1 | `spiritpal-app/src-tauri/tauri.conf.json:87-94`（单端点 GitHub raw） | 低 | Phase 2 | 在 endpoints 数组追加 gh-proxy 镜像端点，提升国内更新可达性 |
| **easy-live2d 替换 pixi-live2d-display** | P1 | `spiritpal-app/package.json:37-38`（pixi-live2d-display 0.4 + pixi.js 7） | 高 | Phase 3 | 需重写 `src/utils/live2d.ts` 等价的加载/参数/动作逻辑，并验证现有模型兼容性；pixi.js 8 性能更好但 API 不兼容 |
| **悬停自动隐藏 + 穿透联动** | P1 | SpiritPal 有 `set_pet_click_through`（`lib.rs:283-295`，Windows only） | 中 | Phase 2 | 移植 `useDevice.ts:123-157` 的 `onHideOnHover` 闭包逻辑到 React，配合 Tauri `setIgnoreCursorEvents` |
| **托盘菜单动态更新 + 平台图标** | P2 | SpiritPal 托盘在 `lib.rs:1003-1075` Rust 端构建 | 中 | Phase 3 | BongoCat 在前端动态构建菜单（支持 i18n + 状态联动），SpiritPal 可参考将菜单逻辑迁移前端以支持多语言 |
| **Pinia→Zustand 持久化下沉** | P2 | SpiritPal 用 `tauri-plugin-store`（`lib.rs:966`） | 中 | Phase 3 | BongoCat 的 `tauri-plugin-pinia` 实现 Rust 端持久化 + filterKeys；SpiritPal 可寻找 zustand 等价方案或自研中间件 |
| **字段迁移机制** | P2 | SpiritPal 无显式迁移机制 | 低 | Phase 3 | 参考 `cat.ts:28-49` 的 `@deprecated` + `migrated` 标志位，在 store 升级时自动迁移旧字段 |
| **Input Monitoring 权限引导** | P2 | SpiritPal 无 macOS 权限引导 | 低 | Phase 3 | 若引入 rdev 键鼠监听则必须配套，参考 `macos-permissions/index.vue` 实现 React 版权限检查弹窗 |
| **gilrs 手柄监听** | P2 | SpiritPal 无手柄支持 | 中 | Phase 4 | 非核心特性，可按需移植 `gamepad.rs` + `useGamepad.ts`，扩展宠物交互维度 |
| **prevent-default 插件** | P2 | SpiritPal 无 | 极低 | Phase 3 | 调试体验优化，防止误触 F12/右键，发布模式自动禁用 |
| **CSP 放宽（asset 协议）** | P2 | SpiritPal CSP 较严格 | 低 | Phase 4 | 若需加载用户自定义本地模型资源，可参考 BongoCat 的 `assetProtocol.scope.allow: ["**/*"]`，但需评估安全风险 |

### 7.3 架构层面对比

| 维度 | BongoCat | SpiritPal |
|------|----------|--------|
| 前端框架 | Vue 3 Composition API | React 19 Hooks |
| 状态管理 | Pinia 3（Rust 持久化） | Zustand 5（tauri-plugin-store） |
| UI 库 | antdv-next + UnoCSS | Tailwind CSS 4 + lucide-react |
| Live2D | easy-live2d 0.4 + pixi.js 8 | pixi-live2d-display 0.4 + pixi.js 7 |
| 窗口架构 | 2 窗口（宠物 + 设置） | 3 窗口（宠物 + 设置 + 聊天） |
| 自定义插件 | 2 个（custom-window + admin-status） | 0 个（命令直接注册） |
| macOS 方案 | tauri-nspanel NSPanel | 仅 macOSPrivateApi |
| 设备输入 | rdev + gilrs（全局键鼠手柄） | Windows GetLastInputInfo（仅空闲检测） |
| 安全特性 | 无加密 | AES-256-GCM + Keychain + .petmod 签名 |
| AI 能力 | 无 | 有（聊天 + Agent） |

---

## 8. 总结与技术参考价值

### 8.1 BongoCat 的核心价值

BongoCat 是目前开源社区中 **Tauri v2 桌面宠物应用的标杆实现之一**，其技术参考价值集中体现在三个方面：

1. **macOS 桌面浮层的工程级解法**：通过 `tauri-nspanel` + `NSPanel` + `macOSPrivateApi` 的组合，解决了 Tauri 原生窗口在 macOS 上无法实现"不抢焦点 + 跨 Space + 全屏可见"浮层的痛点。这套方案（`src-tauri/src/core/setup/macos.rs` + `src-tauri/src/plugins/window/src/commands/macos.rs`）是当前 Tauri 生态中 macOS 桌宠的最佳实践，值得 SpiritPal 在 macOS 适配阶段直接参考。

2. **Windows 置顶保活的务实方案**：`src-tauri/src/plugins/window/src/commands/windows.rs` 中 16ms 轮询 `SetWindowPos(HWND_TOPMOST)` 的做法虽"粗暴"但有效，解决了 Tauri 原生 `set_always_on_top` 在多置顶窗口竞争下失效的问题，对 SpiritPal 的 Windows 体验提升立竿见影。

3. **Live2D + 键鼠联动的完整链路**：从 Rust 端 rdev 监听 → emit 事件 → 前端光标平滑阻尼 → Live2D 参数映射的完整数据流，为 SpiritPal 未来增强"宠物注视光标""按键互动"等玩法提供了可直接参考的实现路径。

### 8.2 对 SpiritPal 的关键启示

- **P0 级快速收益**：窗口关闭即隐藏（`lib.rs:65-72`）、单实例插件（`lib.rs:44-48`）、Windows 置顶轮询（`windows.rs:26-79`）三项特性移植难度极低，但能显著提升 SpiritPal 的桌面常驻体验，建议在 Phase 1 优先完成。
- **P1 级差异化能力**：macOS NSPanel 浮层、rdev 键鼠监听、双端点更新是 BongoCat 相对 SpiritPal 的核心能力差距，需在 Phase 2 重点投入。其中 macOS NSPanel 是 SpiritPal 跨平台战略的关键一环。
- **P2 级体验打磨**：悬停自动隐藏、字段迁移机制、托盘菜单动态化等属于体验打磨，可在 Phase 3 视优先级推进。

### 8.3 不建议移植的部分

- **CSP 完全放空**（`csp: null`）：BongoCat 为加载任意本地模型而放空 CSP，SpiritPal 当前 CSP 策略更安全，不建议倒退。
- **antdv-next UI 库**：SpiritPal 已采用 Tailwind CSS，无需引入新 UI 框架。
- **Pinia 状态管理**：SpiritPal 已用 Zustand，无需切换。

### 8.4 整体评价

BongoCat 以 **MIT 协议** 开源，代码组织清晰（Rust core/plugins/utils 分层 + Vue composables/stores/utils 分层），平台条件编译规范，是 Tauri v2 桌面宠物领域的高质量参考实现。其 macOS NSPanel 方案与 Windows 置顶轮询方案在开源社区中具有稀缺性，对 SpiritPal 的跨平台适配与桌面浮层体验优化具备直接的技术参考价值。
