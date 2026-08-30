# WindowPet 开源仓库技术分析报告

> 仓库地址：https://github.com/SeakMengs/WindowPet
> 分析日期：2026-07-14
> 分析分支：main（最新版本：v0.0.9）
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，并与 SpiritPal（Tauri v2 + React 19 + TypeScript + Rust 跨平台 AI 桌宠应用）进行逐项对比，为后续功能移植提供参考

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

WindowPet 是一款基于 **Tauri v1 + React 18 + TypeScript + Phaser.js** 构建的跨平台桌面宠物覆盖（overlay）应用，允许用户在屏幕上放置可爱的宠物或动漫角色作为常驻伴侣。项目内置 45+ 个宠物角色（涵盖《原神》《宝可梦》《鬼灭之刃》《JOJO》等 IP 的 Shimeji 风格精灵图），支持自定义宠物、点击穿透、开机自启、自动更新、多语言、宠物商店浏览等完整功能，是 Tauri 桌宠领域参考价值极高的开源实现。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | WindowPet |
| 仓库地址 | https://github.com/SeakMengs/WindowPet |
| 作者 | SeakMengs（Seakmeng） |
| 许可证 | MIT License（Copyright (c) 2023 Seakmeng） |
| Stars | 约 196 |
| Forks | 约 13 |
| Watchers | 1 |
| 开放 Issues | 5 |
| 默认分支 | main |
| 最新版本 | v0.0.9（`package.json:4`、`src-tauri/tauri.conf.json:11`） |
| 创建时间 | 2023-07-18 |
| 最近推送 | 2025-04-11 |
| 仓库大小 | 约 43.8 MB |
| 主要语言 | TypeScript（前端）+ Rust（后端） |
| Topics | companion, cross-platform, html, learn, mantine, overlay, pet, productivity, react, react-query, rust, tauri, typescript, zustand |
| 一句话定位 | 用 Tauri + React + Phaser 构建的多角色、可穿透、可自定义的跨平台桌面宠物 overlay 应用 |

### 当前状态

项目最新版本为 v0.0.9，支持 Windows / macOS / Linux 三平台（通过 GitHub Actions 矩阵构建，见 `.github/workflows/release.yml:13`）。项目由 Seakmengs 一人主导开发，README 声明支持 45+ 宠物角色与 4 种语言。最近一次代码推送在 2025 年 4 月，目前处于维护态。

---

## 2. 核心技术栈

| 层级 | 技术 | 版本 | 职责 |
|------|------|------|------|
| **桌面框架** | Tauri | 1.5.4（`src-tauri/Cargo.toml:16`） | 跨平台窗口管理、系统托盘、IPC、自动更新、文件系统 |
| **前端框架** | React | 18.3.1（`package.json:26`） | 设置窗口 UI、Phaser 宿主 |
| **类型系统** | TypeScript | 5.4.5（`package.json:48`） | 全量类型约束 |
| **2D 渲染引擎** | Phaser.js | 3.80.1（`package.json:23`） | 精灵图加载、动画、Arcade 物理引擎、场景管理 |
| **状态管理** | Zustand | 4.5.2（`package.json:37`） | 全局设置/宠物/标签页状态 |
| **UI 组件库** | Mantine | 7.10.0（`package.json:15-17`） | 设置窗口 UI（AppShell、Modal、Notification 等） |
| **图标库** | @tabler/icons-react | 2.47.0 | 设置导航图标 |
| **国际化** | i18next + react-i18next | 23.11.5 / 14.1.2 | 4 语言（en/kh/zh-CN/zh-TW） |
| **数据请求** | react-query | 3.39.3 | 设置/宠物配置异步加载与缓存 |
| **路由** | react-router-dom | 6.23.1 | 主窗口/设置窗口路由切换 |
| **构建工具** | Vite | 5.2.11 | 前端构建与开发服务器 |
| **测试** | Vitest + Testing Library | 1.6.0 / 14.3.1 | 组件与函数单测 |
| **包管理** | npm | — | `package-lock.json` 锁定 |
| **后端语言** | Rust | edition 2021（`src-tauri/Cargo.toml:8`） | 系统级命令、鼠标位置、托盘、窗口管理 |
| **Rust 关键依赖** | tauri-plugin-autostart/store/single-instance/log | v1 分支 | 自启、配置持久化、单实例、日志 |
| **Rust 鼠标库** | mouse_position | 0.1.3 | 全局鼠标坐标获取（穿透窗口下 JS 无法获取鼠标） |

### 技术栈架构特征

- **双窗口分离**：主窗口（Phaser Canvas，全屏透明置顶）与设置窗口（React + Mantine，独立窗口）通过 React Router 路由分发（`src/App.tsx:32-64`）
- **Phaser 全权负责渲染**：宠物精灵图加载、动画状态机、Arcade 物理碰撞、拖拽惯性全部在 Phaser 场景内完成
- **Zustand + react-query 双数据流**：Zustand 管理全局 UI 状态，react-query 负责从 Rust 侧异步读取 JSON 配置
- **Rust 侧极薄**：仅暴露 5 个命令（`src-tauri/src/main.rs:54-60`），核心逻辑全在 TS 侧

---

## 3. 项目架构与目录结构

### 3.1 整体架构

WindowPet 采用**主窗口（Phaser 渲染层）/ 设置窗口（React UI 层）/ Rust 系统层**的三层分离架构：

```
┌─────────────────────────────────────────────────────────┐
│              设置窗口 (React + Mantine)                   │
│  SettingWindow.tsx → MyPets / PetShop / AddPet /         │
│  Settings / About                                        │
├─────────────────────────────────────────────────────────┤
│              主窗口 (Phaser Canvas Overlay)               │
│  PhaserWrapper.tsx → Pets 场景 → ConfigManager /         │
│  InputManager → 多宠物精灵渲染                            │
├─────────────────────────────────────────────────────────┤
│              状态与数据层 (TS)                            │
│  Zustand stores (useSettingStore / usePetStateStore /    │
│  useSettingTabStore) + react-query + i18next             │
├─────────────────────────────────────────────────────────┤
│              Rust 系统层 (Tauri v1)                      │
│  main.rs / cmd.rs / conf.rs / tray.rs / utils.rs         │
│  鼠标位置 / 窗口管理 / 托盘 / 配置初始化 / 自启 / 更新     │
└─────────────────────────────────────────────────────────┘
```

### 3.2 完整目录结构

```
WindowPet/
├── src/
│   ├── App.tsx                    # 🔹 根组件，Router 分发主/设置窗口
│   ├── main.tsx                   # 入口，挂载 React + i18n + react-query
│   ├── PhaserWrapper.tsx          # 🔹 主窗口 Phaser 游戏宿主
│   ├── SettingWindow.tsx          # 🔹 设置窗口主框架（AppShell + Tabs）
│   ├── i18next.ts                 # i18n 初始化（4 语言）
│   ├── Loading.tsx / styles.css
│   ├── scenes/                    # 🔹 Phaser 场景
│   │   ├── Pet.ts                 # 单宠物预览场景（设置窗口卡片用）
│   │   ├── Pets.ts                # 主 overlay 场景（多宠物 + 物理交互）
│   │   └── manager.ts             # ConfigManager + InputManager
│   ├── config/                    # 🔹 50 个宠物 JSON 配置 + pet_config.ts 聚合
│   │   ├── pet_config.ts          # 导入并聚合所有 JSON 为 defaultPetConfig
│   │   ├── 68.json / Klee.json / Hu Tao.json / albedo.json ...
│   ├── types/                     # 🔹 类型定义
│   │   ├── IPet.ts                # 方向枚举 + IPet 接口 + Ease 缓动枚举
│   │   ├── ISpriteConfig.ts       # 🔹 精灵图配置接口（核心）
│   │   ├── ISetting.ts            # 设置枚举 + 标签页类型
│   │   ├── IEvents.ts             # 跨窗口事件类型 + DispatchType 枚举
│   │   ├── components/type.ts / hooks/type.ts
│   ├── hooks/                     # 🔹 自定义 hooks
│   │   ├── useSettingStore.tsx    # Zustand 全局设置 store
│   │   ├── usePetStateStore.tsx   # 宠物状态字典 store
│   │   ├── useSettingTabStore.tsx # 设置标签页 store
│   │   ├── useSettings.tsx        # react-query 加载 settings.json
│   │   ├── usePets.tsx            # react-query 加载 pets.json + 自定义宠物
│   │   ├── useInit.tsx            # 单次初始化 hook
│   │   └── useQueryParams.tsx     # URL 查询参数 hook
│   ├── ui/
│   │   ├── components/            # PetCard / PhaserCanvas / Logo / Title
│   │   ├── pop_up/Updater.tsx     # 更新弹窗
│   │   ├── setting_tabs/          # MyPets / PetShop / AddPet / Settings / About
│   │   └── shell/                 # SettingTab / SettingTabs 导航
│   ├── utils/                     # 🔹 工具
│   │   ├── settings.ts            # 配置读写 + 自定义宠物保存
│   │   ├── handleSettingChange.ts # 设置变更统一分发
│   │   ├── event.ts               # 跨窗口 emit
│   │   ├── update.tsx             # 自动更新检查
│   │   ├── notification.tsx
│   │   └── index.ts               # PrimaryColor / CanvasSize / 路径转换
│   └── locale/                    # en / kh / zh-CN / zh-TW 翻译
├── src-tauri/
│   ├── tauri.conf.json            # 🔹 Tauri 配置（窗口/更新/托盘/权限）
│   ├── Cargo.toml                 # Rust 依赖
│   └── src/
│       ├── main.rs                # 🔹 入口，构建 Tauri app + 插件注册
│       └── app/
│           ├── mod.rs
│           ├── cmd.rs             # get_mouse_position / open_folder 命令
│           ├── conf.rs            # AppConfig + 配置路径 + 默认配置初始化
│           ├── tray.rs            # 系统托盘菜单与事件
│           ├── utils.rs           # reopen_main_window / open_setting_window
│           └── default/           # settings.json / pets.json 默认值
├── public/
│   ├── media/                     # 🔹 50+ 宠物精灵图 PNG（128x128 帧）
│   └── flags/                     # 语言国旗
├── .github/workflows/release.yml  # 🔹 三平台矩阵构建发布
├── LEARN.md                       # 教学文档（当前为空占位）
├── contribute.md
├── README.md
├── LICENSE.md                     # MIT
└── package.json
```

### 3.3 架构设计模式

| 模式 | 实现 | 说明 |
|------|------|------|
| **双窗口路由分发** | `src/App.tsx:32-64` | 同一 React 应用通过 BrowserRouter 在 `/`（Phaser）和 `/setting`（Mantine）间切换，Rust 侧动态创建窗口 |
| **场景管理器模式** | `src/scenes/manager.ts` | ConfigManager 封装精灵图加载/动画注册，InputManager 封装鼠标穿透检测 |
| **状态机驱动动画** | `src/scenes/Pets.ts:477-520` | switchState + availableStates 实现 idle/walk/climb/crawl/jump/fall/drag 状态切换 |
| **事件总线跨窗口通信** | `src/utils/event.ts` + `src/types/IEvents.ts` | 设置窗口通过 `WebviewWindow.emit` 向主窗口派发 DispatchType 事件 |
| **Zustand 全局 store** | `src/hooks/useSettingStore.tsx` | 单一 store 管理语言/主题/宠物列表/交互开关等 |
| **react-query 异步加载** | `src/hooks/useSettings.tsx` / `usePets.tsx` | 从 Rust 配置目录读取 JSON，禁用缓存保证实时性 |

---

## 4. 核心功能模块详解

### 4.1 窗口与系统交互模块

| 模块 | 文件 | 功能 |
|------|------|------|
| **透明置顶窗口** | `src-tauri/tauri.conf.json:73-84` | `fullscreen:true` + `transparent:true` + `alwaysOnTop:true` + `skipTaskbar:true`，配合 `macOSPrivateApi:true`（line 89） |
| **点击穿透** | `src-tauri/src/main.rs:42-45`、`src/scenes/manager.ts:265-345` | 启动即 `set_ignore_cursor_events(true)`；InputManager 每帧检测鼠标是否悬停宠物，悬停时临时关闭穿透 |
| **全局鼠标获取** | `src-tauri/src/app/cmd.rs:5-25` | 穿透窗口下 JS 无法获取鼠标，使用 `mouse_position` crate 在 Rust 侧获取全局坐标 |
| **系统托盘** | `src-tauri/src/app/tray.rs:8-21` | Show / Pause / Setting / Restart / Quit 五项菜单 + 双击打开设置 |
| **单实例锁** | `src-tauri/src/main.rs:35-40` | `tauri-plugin-single-instance`，二次启动时 emit `single-instance` 事件 |
| **窗口重建** | `src-tauri/src/app/utils.rs:5-31` | `reopen_main_window` 命令：检测存在则聚焦，否则重建全屏透明窗口并开启穿透 |
| **设置窗口** | `src-tauri/src/app/utils.rs:33-48` | `open_setting_window`：1000x650，根据 settings 主题切换 Dark/Light |

### 4.2 Phaser 渲染与交互模块

| 模块 | 文件 | 功能 |
|------|------|------|
| **主 overlay 场景** | `src/scenes/Pets.ts` | 多宠物创建、拖拽、世界边界碰撞、爬墙/爬行/跳跃状态机、随机行为 |
| **预览场景** | `src/scenes/Pet.ts` | 设置窗口宠物卡片中的单宠物动画预览（固定 30fps、无交互） |
| **配置管理器** | `src/scenes/manager.ts:6-263` | ConfigManager：精灵图加载、去重、校验、动画注册；支持 frameSize 与 width/height 两种规格 |
| **输入管理器** | `src/scenes/manager.ts:265-345` | InputManager：鼠标穿透开关、像素级悬停检测（`hitTestPointer`） |
| **Phaser 宿主** | `src/PhaserWrapper.tsx` | 全屏 Phaser.Game，Arcade 物理、30fps、RESIZE 缩放、preBoot 注入 spriteConfig |
| **卡片预览宿主** | `src/ui/components/PhaserCanvas.tsx` | 每张宠物卡片独立 Phaser.Game（224x224），`pointerEvents:none` 不阻塞滚动 |

### 4.3 宠物配置与商店模块

| 模块 | 文件 | 功能 |
|------|------|------|
| **宠物聚合** | `src/config/pet_config.ts:53-104` | 导入 50 个 JSON 配置为 `defaultPetConfig` 数组 |
| **宠物商店** | `src/ui/setting_tabs/PetShop.tsx` | 搜索 + 网格卡片 + 添加/移除自定义宠物 + 通知 |
| **我的宠物** | `src/ui/setting_tabs/MyPets.tsx` | 已添加宠物列表 + 移除 + 空状态对话框 |
| **自定义宠物添加** | `src/ui/setting_tabs/AddPet.tsx` | 表单式添加（名称/帧大小/精灵图路径/多状态 start-end）+ 校验 |
| **自定义宠物保存** | `src/utils/settings.ts:106-139` | `saveCustomPet`：复制图片到 assets、写入 custom-pets/*.json、更新 pet_linker.json |
| **宠物卡片** | `src/ui/components/PetCard.tsx` | IntersectionObserver 懒加载（仅可视区渲染 Phaser）+ 状态切换下拉 |

### 4.4 设置与国际化模块

| 模块 | 文件 | 功能 |
|------|------|------|
| **设置窗口框架** | `src/SettingWindow.tsx:42-156` | AppShell + 5 个 Tab（MyPets/PetShop/AddPet/Settings/About）+ 主题切换 + URL tab 同步 |
| **设置项** | `src/ui/setting_tabs/Settings.tsx` | 自启/任务栏上方/交互/爬墙/缩放覆盖+滑块/语言选择/配置目录打开 |
| **设置变更分发** | `src/utils/handleSettingChange.ts` | 统一入口：写 settings.json + 更新 store + emit 跨窗口事件 |
| **i18n 初始化** | `src/i18next.ts:1-29` | 4 语言资源注册，localStorage 持久化语言选择 |
| **语言列表** | `src/locale/languages.ts:1-22` | English / ខ្មែរ Khmer / 简体中文 / 繁體中文 |
| **默认设置** | `src-tauri/src/app/default/settings.json` | theme/language/allowPetAboveTaskbar/allowPetInteraction/allowPetClimbing/allowAutoStartUp/allowOverridePetScale/petScale=0.7 |

### 4.5 自动更新模块

| 模块 | 文件 | 功能 |
|------|------|------|
| **更新配置** | `src-tauri/tauri.conf.json:61-69` | updater.active:true，pubkey + endpoints 指向 GitHub releases latest.json，windows.installMode:passive |
| **更新检查** | `src/utils/update.tsx:13-36` | `checkForUpdate`：调用 `checkUpdate()`，有更新则弹出 Mantine 确认 Modal |
| **更新弹窗** | `src/ui/pop_up/Updater.tsx` | 展示 manifest 信息 |
| **更新执行** | `src/utils/update.tsx:38-54` | `installUpdate` + `relaunch`，监听 `onUpdaterEvent` |
| **About 页检查** | `src/ui/setting_tabs/About.tsx:15-22` | About 页提供手动检查更新按钮 |

---

## 5. 技术实现细节

### 5.1 Tauri 透明窗口与点击穿透（核心）

WindowPet 的桌宠 overlay 体验建立在 Tauri v1 的透明窗口 + 动态点击穿透之上。

**窗口配置**（`src-tauri/tauri.conf.json:73-84`）：
```json
{
  "fullscreen": true,
  "resizable": false,
  "title": "WindowPet",
  "width": 64,
  "height": 64,
  "transparent": true,
  "alwaysOnTop": true,
  "skipTaskbar": true
}
```
配合 `"macOSPrivateApi": true`（line 89）实现 macOS 透明。注意初始 `width/height` 仅 64，实际靠 `fullscreen:true` 撑满全屏。

**启动即开启穿透**（`src-tauri/src/main.rs:42-45`）：
```rust
let window = app.get_window("main").unwrap();
window.set_ignore_cursor_events(true).unwrap_or_else(|err| println!("{:?}", err));
```

**动态穿透切换**（`src/scenes/manager.ts:275-321`）：由于窗口全程穿透，JS 无法获取鼠标坐标，InputManager 每帧通过 `invoke("get_mouse_position")`（Rust 侧 `src-tauri/src/app/cmd.rs:6-25` 使用 `mouse_position` crate）获取全局坐标，再用 Phaser 的 `hitTestPointer`（`manager.ts:339`）做像素级悬停检测。若鼠标在宠物精灵上则 `setIgnoreCursorEvents(false)` 临时关闭穿透以允许拖拽，否则恢复穿透。切换时带 50ms 延迟（`IGNORE_CURSOR_EVENTS_DELAY`，`manager.ts:269`）避免崩溃。

### 5.2 Phaser 游戏场景（Pet.ts / Pets.ts / manager.ts）

#### 5.2.1 主场景 Pets.ts（`src/scenes/Pets.ts`）

核心常量（`Pets.ts:45-60`）：
- `FRAME_RATE = 9`，`UPDATE_DELAY = 1000/9`
- `PET_MOVE_VELOCITY = FRAME_RATE * 6 = 54`
- `PET_MOVE_ACCELERATION = VELOCITY * 2`
- `RAND_STATE_DELAY = 3000`，`FLIP_DELAY = 5000`
- `FORBIDDEN_RAND_STATE = ["fall","climb","drag","crawl","drag","bounce","jump"]`（禁止随机触发的状态）

**宠物创建**（`Pets.ts:324-353`）：从屏幕顶部坠落入场（`petY = 0 + frameHeight`），`setInteractive({draggable:true, pixelPerfect:true})` 启用像素级拖拽，存储 `availableStates` / `canPlayRandomState` / `canRandomFlip` / `id`。

**状态机**（`Pets.ts:477-520`）：`switchState(pet, state, options)` 统一入口，受 `allowPetClimbing` 开关约束，维护 `petClimbAndCrawlIndex` 数组追踪爬行/攀爬宠物。状态包括 idle/walk/sit/greet/crawl/climb/jump/fall/drag。

**方向系统**（`src/types/IPet.ts:1-10`）：7 向枚举 `UP/DOWN/LEFT/RIGHT/UPSIDELEFT/UPSIDERIGHT/UNKNOWN`，`updateMovement`（`Pets.ts:417-475`）按方向设置速度/加速度/重力，爬行/攀爬时禁用重力。

**拖拽与投掷**（`Pets.ts:116-197`）：`drag` 事件实时更新位置并切换 drag 状态、根据拖拽方向翻转；`dragend` 用 tween 实现 600ms QuartEaseOut 惯性投掷（`pointer.velocity * TWEEN_ACCELERATION`），结束后恢复碰撞体。

**世界边界处理**（`Pets.ts:199-248`）：监听 `worldbounds` 事件，触顶且允许爬墙则切 climb/crawl，触底则切 fall 后随机状态，左右越界则爬墙或翻转。

**随机行为**（`Pets.ts:716-775`）：`petOnTheGroundPlayRandomState` 用随机数区间（777-800、888-890、170-175）触发不同行为，walk 状态有 3-6 秒 idle 暂停，随机翻转带 5 秒冷却。

#### 5.2.2 预览场景 Pet.ts（`src/scenes/Pet.ts`）

用于设置窗口宠物卡片。`preload`（`Pet.ts:18-27`）从 registry 取 spriteConfig，`create`（`Pet.ts:29-47`）注册动画并播放指定 playState，禁用键盘/鼠标输入。帧率固定 9、repeat -1。

#### 5.2.3 管理器 manager.ts（`src/scenes/manager.ts`）

**ConfigManager**（`manager.ts:6-263`）：
- `loadAllSpriteSheet`（line 32-44）：批量加载精灵图
- `registerSpriteStateAnimation`（line 46-88）：动态注册动画，支持未加载时先 load 再重试
- `getAnimationConfigPerSprite`（line 137-180）：核心算法，支持两种状态定义：
  - `spriteLine + frameMax`：按行计算 `start = (spriteLine-1)*HighestFrameMax`，`end = start + frameMax - 1`
  - `start + end`：直接指定帧序号（1-based，内部 -1 转 0-based）
- `getFrameSize`（line 207-221）：支持 `frameSize` 直接给定，或 `width/highestFrameMax` 与 `height/totalSpriteLine` 计算
- `validatePetSprite`（line 232-262）：校验 name/imageSrc/states 必填，尺寸参数二选一

**InputManager**（`manager.ts:265-345`）：见 5.1 节穿透逻辑。

### 5.3 宠物精灵图配置格式（JSON）

WindowPet 的宠物配置 JSON 是其最核心的可移植资产。以 `src/config/Klee.json` 为例：

```json
{
    "name": "Klee",
    "imageSrc": "media/Klee.png",
    "frameSize": 128,
    "credit": { "link": "..." },
    "states": {
        "stand": { "spriteLine": 1, "frameMax": 1 },
        "walk":   { "spriteLine": 2, "frameMax": 4 },
        "sit":    { "spriteLine": 3, "frameMax": 1 },
        "greet":  { "spriteLine": 4, "frameMax": 4 },
        "jump":   { "spriteLine": 5, "frameMax": 1 },
        "fall":   { "spriteLine": 6, "frameMax": 3 },
        "drag":   { "spriteLine": 7, "frameMax": 1 },
        "crawl":  { "spriteLine": 8, "frameMax": 8 },
        "climb":  { "spriteLine": 9, "frameMax": 8 }
    }
}
```

**格式特征**（对应 `src/types/ISpriteConfig.ts:22-42`）：
- `frameSize: 128`：每帧 128×128 像素（绝大多数宠物）
- `spriteLine: 1-9`：精灵图按 9 行布局，每行对应一个状态
- `frameMax`：该行有效帧数（1-13 不等）
- 整图尺寸 = `frameSize × max(frameMax) × frameSize × 9`
- 支持两种尺寸定义：`frameSize` 直接给定，或 `width/height/highestFrameMax/totalSpriteLine` 计算（见 `pets.json` 中 Ganyu 用 width:1664/height:1152/highestFrameMax:13/totalSpriteLine:9）
- 支持两种状态定义：`spriteLine+frameMax` 或 `start+end`（自定义宠物用，见 `AddPet.tsx`）
- `credit` 字段记录资源来源链接/社交媒体

**与 SpiritPal ATLAS 格式对比**：SpiritPal `src/lib/types.ts:6` 定义 `ATLAS = { cellW: 192, cellH: 208, cols: 8, rows: 9 }`，`ANIMATION_ROWS`（line 18-28）同样按 9 行布局，row 0-8 对应 idle/walk/run-left/waving/jumping/failed/waiting/running/review。**两者都采用 9 行精灵图布局**，关键差异：
- 单元尺寸：WindowPet 128×128（方形）vs SpiritPal 192×208（非方形）
- 列数：WindowPet 按行可变 frameMax（1-13）vs SpiritPal 固定 8 列
- 状态语义：WindowPet 偏 Shimeji（stand/walk/sit/greet/crawl/climb/jump/fall/drag）vs SpiritPal 偏养成（idle/walk/sleep/eat/drag/happy/sad/sick/pet）

### 5.4 45+ 宠物角色定义

`src/config/pet_config.ts:1-104` 导入并聚合 50 个 JSON 配置（`defaultPetConfig` 数组，line 53-104），涵盖：
- **原神**：Ayaka/Ganyu/Albedo/Childe/Electro Childe/Hu Tao/Kazuha/Kazuha-xll/Klee/Thoma/Nahida/Rosaria-xll/Venti-ys/XiaoCat/Xingqiu-xll/Yoimiya-ys/Zhongli-ys/Zhongli-1/Lumine-xll/Zuo Ci/Yuan Ji
- **宝可梦**：Growlithe
- **鬼灭之刃**：Kamado Nezuko
- **JOJO**：Jotaro
- **东方Project**：Marisa
- **Kizuna AI**：Kizuna AI-ver1
- **Shimeji 系列**：Blooky/Gengar/Puro the Latex Wolf/Starphin/Caneko/Germouser/nekojapan/skoreacat/Turkat/honeychurros/lavender town ghost/tamamo
- **其他 IP**：Spider Man/Spongebob/slugcat/Pusheen/Punishing Bird/The Chosen One/The King/68/sanji/kuro/dearla

每个宠物有独立的 PNG 精灵图存放于 `public/media/`（共 50+ PNG 文件）。

### 5.5 自动更新

**配置**（`src-tauri/tauri.conf.json:61-69`）：
```json
"updater": {
    "active": true,
    "dialog": false,
    "pubkey": "dW50cnVzdGVk...(base64)",
    "endpoints": ["https://github.com/SeakMengs/WindowPet/releases/latest/download/latest.json"],
    "windows": { "installMode": "passive" }
}
```

**触发时机**：
1. 设置窗口打开时自动检查（`src/SettingWindow.tsx:50-52`，`useInit(checkForUpdate)`）
2. About 页面手动检查按钮（`src/ui/setting_tabs/About.tsx:15-22`）

**更新流程**（`src/utils/update.tsx`）：
- `checkForUpdate`（line 13-36）：调用 `@tauri-apps/api/updater` 的 `checkUpdate()`，有更新则用 Mantine `modals.openConfirmModal` 弹出确认窗，渲染 `<Updater>` 组件展示 manifest
- `update`（line 38-54）：`onUpdaterEvent` 监听事件 → `installUpdate()` → `relaunch()`

**CI 发布**（`.github/workflows/release.yml`）：tag `v*` 触发，矩阵 `macos-latest/ubuntu-20.04/windows-latest`，使用 `tauri-apps/tauri-action@v0`，注入 `TAURI_PRIVATE_KEY` / `TAURI_KEY_PASSWORD` 签名生成更新产物。

### 5.6 开机自启

**Rust 侧注册**（`src-tauri/src/main.rs:19-22`）：
```rust
.plugin(tauri_plugin_autostart::init(
    MacosLauncher::LaunchAgent,
    Some(vec!["--flag1", "--flag2"]),
))
```

**前端开关**（`src/utils/settings.ts:12-22`）：
```typescript
export function toggleAutoStartUp(allowAutoStartUp: boolean) {
    (async () => {
        const hasEnabledStartUp = await isEnabled();
        if (allowAutoStartUp) { if (!hasEnabledStartUp) await enable(); }
        else if (hasEnabledStartUp) { await disable(); }
    })()
};
```
自启状态不写入 settings.json，直接由 `tauri-plugin-autostart-api` 的 `isEnabled()` 查询（`src/hooks/useSettings.tsx:23`）。

### 5.7 设置窗口路由与跨窗口通信

**路由分发**（`src/App.tsx:32-64`）：`<Route path="/" element={<PhaserWrapper />}>` 与 `<Route path="/setting" element={<MantineProvider><SettingWindow/></MantineProvider>}>`。同一 webview 通过 URL 区分窗口内容，Rust 侧 `open_setting_window`（`src-tauri/src/app/utils.rs:33-48`）以 `WindowUrl::App("/setting")` 创建 1000×650 窗口。

**跨窗口事件**（`src/utils/event.ts:10-21`）：设置窗口通过 `WebviewWindow.getByLabel('main').emit(EventType.SettingWindowToPetOverlay, payload)` 向主窗口派发事件，payload 含 `dispatchType`（`src/types/IEvents.ts:20-30` 枚举 10 种）与 `value`。主场景 `Pets.ts:251-306` 监听并处理 AddPet/RemovePet/SwitchAllowPetInteraction/SwitchPetAboveTaskbar/OverridePetScale/ChangePetScale/SwitchAllowPetClimbing 等。

**URL tab 同步**（`src/SettingWindow.tsx:54-59`）：设置窗口支持 `?tab=N` 参数，刷新后保持标签页。

### 5.8 i18n 四语言

**初始化**（`src/i18next.ts:1-29`）：注册 en/kh/zh-CN/zh-TW 四语言资源，`lng` 取 `localStorage.getItem('language') || 'en'`，`fallbackLng: 'en'`。

**语言列表**（`src/locale/languages.ts:1-22`）：每项含 `image`（国旗 webp）、`label`（双语标签）、`value`（语言代码）。

**切换**（`src/utils/handleSettingChange.ts:34-39`）：`ChangeAppLanguage` 分支写入 settings.json + 更新 store + `i18next.changeLanguage` + localStorage 持久化。

**注意**：README 第 67 行仅提及 English and Khmer，但实际代码已扩展至 4 语言（含简繁中文）。

### 5.9 宠物商店与卡片组件

**PetShop**（`src/ui/setting_tabs/PetShop.tsx`）：
- 搜索框（line 90-95）按 name 过滤
- 网格布局 `repeat(auto-fill, minmax(250px, 1fr))`（line 98-100）
- `addPetToConfig`（line 25-48）：写入 pets.json + 更新 store + 若主窗口不存在则 `invoke("reopen_main_window")` + emit AddPet 事件 + Mantine 通知
- `removeCustomPet`（line 50-74）：从 pet_linker.json 移除自定义宠物 + DOM 直接移除卡片 + refetch

**PetCard**（`src/ui/components/PetCard.tsx`）：
- `react-intersection-observer` 懒加载（line 17）：仅 `inView` 时渲染 `<PhaserCanvas>`，否则渲染占位 224×224 Box（line 85-89），大幅节省多卡片 Phaser 实例开销
- 状态下拉（line 49-55）：NativeSelect 切换 playState（注释说明 Mantine 7 Select 太慢故用 NativeSelect）
- 自定义宠物显示额外删除按钮（line 69-80）
- `usePetStateStore` 缓存每个宠物的可用状态字典（line 21-24）

**PhaserCanvas**（`src/ui/components/PhaserCanvas.tsx`）：每张卡片独立 `new Phaser.Game`（224×224、CANVAS 类型、30fps、Pet 场景），`pointerEvents:none` 保证滚动不被阻塞，`useEffect` 依赖 `[pet, playState]` 重建。

### 5.10 GPU 加速与性能优化

**Windows GPU 加速**（`src-tauri/src/main.rs:70-75`）：
```rust
std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--ignore-gpu-blocklist");
```
解决 Tauri issue #4891 的 GPU 黑名单问题。

**Release 优化**（`src-tauri/Cargo.toml:33-37`）：`panic="abort"` + `codegen-units=1` + `lto=true` + `opt-level="s"` + `strip=true`，极致压缩二进制体积。

**FPS 限制**：主场景与卡片场景均 `fps.target=30, min=30, smoothStep:true`（`PhaserWrapper.tsx:46-50`、`PhaserCanvas.tsx:30-34`），适合常驻应用省电。

---

## 6. 可借鉴特性

| 特性 | 源文件位置 | 借鉴价值 |
|------|-----------|----------|
| **Phaser.js 精灵图渲染方案** | `src/PhaserWrapper.tsx`、`src/scenes/Pets.ts`、`manager.ts` | ★★★★★ 完整的 9 行精灵图加载/动画/物理/拖拽实现，Arcade 物理碰撞与惯性投掷 |
| **动态点击穿透（Rust 鼠标 + 像素检测）** | `src-tauri/src/app/cmd.rs:5-25`、`src/scenes/manager.ts:265-345` | ★★★★★ 解决穿透窗口无法获取鼠标的核心难题，每帧 hitTestPointer 像素级检测 |
| **宠物精灵图 JSON 配置格式** | `src/types/ISpriteConfig.ts`、`src/config/*.json`、`src/config/pet_config.ts` | ★★★★★ 50 个现成宠物配置，frameSize+spriteLine+frameMax 格式灵活，与 SpiritPal 9 行布局理念一致 |
| **45+ 内置宠物角色资源** | `public/media/*.png`（50+ PNG）、`src/config/*.json`（50 个 JSON） | ★★★★★ 现成的 Shimeji 风格精灵图库，MIT 许可可复用 |
| **自定义宠物添加流程** | `src/ui/setting_tabs/AddPet.tsx`、`src/utils/settings.ts:106-139` | ★★★★ 表单式添加 + 校验 + 图片复制 + linker 注册完整链路 |
| **跨窗口事件总线** | `src/types/IEvents.ts`、`src/utils/event.ts`、`src/scenes/Pets.ts:251-306` | ★★★★ DispatchType 枚举 + WebviewWindow.emit 的设置→主窗口通信模式 |
| **Zustand 多 store 分治** | `src/hooks/useSettingStore.tsx`、`usePetStateStore.tsx`、`useSettingTabStore.tsx` | ★★★★ 按职责拆分 store，与 SpiritPal 的 Zustand 用法可直接对比 |
| **宠物商店 + 卡片懒加载** | `src/ui/setting_tabs/PetShop.tsx`、`src/ui/components/PetCard.tsx` | ★★★★ IntersectionObserver 懒渲染 Phaser 实例，解决多卡片性能问题 |
| **Mantine 设置窗口框架** | `src/SettingWindow.tsx`、`src/ui/shell/SettingTabs.tsx` | ★★★ AppShell + 5 Tab + 主题切换 + URL tab 同步的完整设置 UI |
| **i18n 四语言 + 国旗下拉** | `src/i18next.ts`、`src/locale/languages.ts`、`src/locale/*/translation.json` | ★★★ en/kh/zh-CN/zh-TW 完整翻译文件，含中文资源 |
| **自动更新 + Mantine 弹窗** | `src-tauri/tauri.conf.json:61-69`、`src/utils/update.tsx`、`src/ui/pop_up/Updater.tsx` | ★★★ Tauri v1 updater 完整实现，含 pubkey 签名与被动安装模式 |
| **三平台 CI 矩阵发布** | `.github/workflows/release.yml` | ★★★ macOS/Linux/Windows 矩阵 + tauri-action 自动签名发布 |
| **单实例锁 + 托盘菜单** | `src-tauri/src/main.rs:35-40`、`src-tauri/src/app/tray.rs` | ★★ Show/Pause/Setting/Restart/Quit 托盘菜单 |
| **任务栏上方区域计算** | `src/scenes/Pets.ts:681-703` | ★★ `window.screen.height - window.screen.availHeight` 计算任务栏高度并调整 worldBounds |
| **Release 二进制极致压缩** | `src-tauri/Cargo.toml:33-37` | ★★ LTO + opt-level=s + strip 的 Rust release profile |

---

## 7. 与 SpiritPal 的异同及移植建议

### 7.1 技术栈对比

| 维度 | WindowPet | SpiritPal | 差异 |
|------|-----------|--------|------|
| 桌面框架 | Tauri v1.5.4 | Tauri v2.10.1 | SpiritPal 升级到 v2（capabilities 权限模型、移动端支持） |
| React | 18.3.1 | 19.2.4 | SpiritPal 用 React 19 |
| TypeScript | 5.4.5 | 5.9.3 | 接近 |
| 状态管理 | Zustand 4.5.2 | Zustand 5.0.2 | **相同选型**，版本差异 |
| 渲染引擎 | Phaser 3.80.1 | 自研 canvas + pixi-live2d-display 0.4.0 + pixi.js 7.4.3 | **核心差异**：WindowPet 用 Phaser 精灵图，SpiritPal 用 canvas + Live2D |
| UI 库 | Mantine 7.10 | Tailwind CSS 4.2 | WindowPet 组件化更彻底，SpiritPal 原子化更灵活 |
| 国际化 | i18next 23.11 | i18next 26.0 | **相同选型** |
| 数据请求 | react-query 3.39 | 无（Zustand 直连） | WindowPet 多一层查询缓存 |
| 路由 | react-router-dom 6.23 | hash 路由（`src/App.tsx:27-30`） | WindowPet 用 BrowserRouter，SpiritPal 用 hashchange |
| 移动端 | 无 | 有（lazy MobileApp + Android/iOS 配置） | SpiritPal 已支持移动端 |
| 测试 | Vitest + Testing Library | Vitest + Playwright + coverage | SpiritPal 测试更完善 |

### 7.2 逐项移植建议

| # | 特性 | 优先级 | 对应 SpiritPal 现状文件 | 移植难度 | 建议 Phase | 建议 |
|---|------|--------|---------------------|----------|-----------|------|
| 1 | **9 行精灵图 JSON 配置格式** | P0 | `src/lib/types.ts:6`（ATLAS 8×9，192×208） | 低 | Phase 1 | WindowPet 的 `frameSize+spriteLine+frameMax` 与 SpiritPal 的 `ATLAS.rows=9` 理念一致。建议在 SpiritPal 的 `pet_conf.json` 中扩展 `spriteLayout` 字段，兼容两种单元尺寸（128 方形 vs 192×208），并支持 `frameMax` 可变列数。参考 `src/types/ISpriteConfig.ts:22-42` |
| 2 | **45+ Shimeji 宠物资源库** | P0 | `public/pets/`（仅 doro/feibi/gugugaga 三个） | 极低 | Phase 1 | WindowPet 的 50 个 PNG + JSON（MIT 许可）可直接移植为 SpiritPal 的"经典 Shimeji"角色包。需注意单元尺寸 128→192×208 的重采样或保留原尺寸自适应。参考 `src/config/pet_config.ts:53-104` |
| 3 | **动态点击穿透（Rust 鼠标 + 像素检测）** | P0 | SpiritPal 已有 PetWindow，但穿透逻辑需确认 | 中 | Phase 2 | WindowPet 的 `set_ignore_cursor_events` + Rust `get_mouse_position` + `hitTestPointer` 三件套是 Tauri v1 方案；SpiritPal 在 Tauri v2 下需用 `@tauri-apps/api/window` 的 `setIgnoreCursorEvents` + `@tauri-apps/plugin-window` 等价能力。参考 `src/scenes/manager.ts:265-345`、`src-tauri/src/app/cmd.rs:5-25` |
| 4 | **Phaser 渲染引擎评估** | P1 | `src/components/PetWindow`（自研 canvas） | 高 | Phase 3+ | WindowPet 用 Phaser 省去手写动画状态机/物理碰撞/拖拽惯性。但 SpiritPal 已有 Live2D 路线，引入 Phaser 会增加 ~1MB 包体积与双渲染管线维护成本。建议仅在"2D 精灵图角色"场景可选引入，与 Live2D 角色并存。参考 `src/PhaserWrapper.tsx`、`src/scenes/Pets.ts` |
| 5 | **宠物商店 UI（搜索+网格+懒加载）** | P1 | SpiritPal 设置窗口（待补全角色选择） | 低 | Phase 2 | PetShop 的 `react-intersection-observer` 懒渲染方案值得直接移植到 SpiritPal 的角色选择页，避免大量角色卡片同时渲染卡顿。参考 `src/ui/components/PetCard.tsx:17,29-90` |
| 6 | **自定义宠物添加表单** | P1 | SpiritPal 暂无自定义角色入口 | 中 | Phase 2 | AddPet 的表单（名称/帧大小/路径/多状态 start-end）+ 校验 + 图片复制 + linker 注册链路完整，可移植为 SpiritPal 的"导入自定义角色"功能。需适配 Tauri v2 的 `@tauri-apps/plugin-fs`/`plugin-dialog`。参考 `src/ui/setting_tabs/AddPet.tsx`、`src/utils/settings.ts:106-139` |
| 7 | **跨窗口事件总线（DispatchType）** | P1 | SpiritPal 多窗口（pet/settings/chat）通信 | 低 | Phase 1 | WindowPet 的 `DispatchType` 枚举 + `WebviewWindow.emit` 模式比 SpiritPal 现有 hash 路由更解耦。建议 SpiritPal 统一采用 Tauri v2 的 `emit`/`listen` 跨窗口事件。参考 `src/types/IEvents.ts:20-30`、`src/utils/event.ts` |
| 8 | **Zustand 多 store 分治** | P1 | SpiritPal 已用 Zustand 5 | 极低 | Phase 1 | WindowPet 拆为 useSettingStore/usePetStateStore/useSettingTabStore 三个 store，职责清晰。SpiritPal 可参考拆分，避免单一 store 膨胀。参考 `src/hooks/useSettingStore.tsx`、`usePetStateStore.tsx` |
| 9 | **i18n 中文翻译资源** | P1 | SpiritPal 已有 i18next | 极低 | Phase 1 | WindowPet 的 `src/locale/zh-CN/translation.json` 与 `zh-TW` 可作为 SpiritPal 中文翻译的基础参考，补充桌宠领域术语。参考 `src/locale/languages.ts` |
| 10 | **自动更新 + 弹窗** | P1 | `spiritpal-app/src-tauri/tauri.conf.json:87-94`（已配 updater） | 低 | Phase 2 | SpiritPal 已配 Tauri v2 updater，但缺前端弹窗。可移植 WindowPet 的 `checkForUpdate` + Mantine/自定义 Modal 流程。参考 `src/utils/update.tsx:13-36` |
| 11 | **任务栏上方区域计算** | P2 | SpiritPal PetWindow 窗口尺寸 300×400 | 低 | Phase 2 | `window.screen.height - window.screen.availHeight` 计算任务栏高度并调整碰撞边界，让宠物可站在任务栏上。参考 `src/scenes/Pets.ts:681-703` |
| 12 | **Mantine 设置 UI 组件** | P2 | SpiritPal 用 Tailwind 自建 | 中 | Phase 3+ | WindowPet 的 AppShell + Tabs + SettingSwitch + Slider 设置页布局成熟，但 SpiritPal 已选 Tailwind 路线，不建议换库；可借鉴交互模式而非组件。参考 `src/SettingWindow.tsx:113-153` |
| 13 | **三平台 CI 矩阵** | P2 | SpiritPal 待补 CI | 低 | Phase 2 | `.github/workflows/release.yml` 的 macOS/Linux/Windows 矩阵 + tauri-action 模板可直接复用，SpiritPal 需追加移动端构建。参考 `.github/workflows/release.yml:13-23` |
| 14 | **Release Rust 压缩 profile** | P2 | SpiritPal Cargo.toml | 极低 | Phase 1 | `lto=true` + `opt-level="s"` + `strip=true` + `codegen-units=1` 可直接加入 SpiritPal 的 Cargo.toml 减小包体积。参考 `src-tauri/Cargo.toml:33-37` |
| 15 | **GPU 黑名单绕过** | P2 | SpiritPal 未配置 | 极低 | Phase 1 | `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--ignore-gpu-blocklist` 一行解决 Windows GPU 渲染问题，建议 SpiritPal 主入口加入。参考 `src-tauri/src/main.rs:72-73` |

### 7.3 关键差异深度分析

#### 7.3.1 渲染方案：Phaser vs 自研 canvas + Live2D

WindowPet 的 Phaser 方案优势：
- 内置 Arcade 物理引擎（重力/碰撞/速度/加速度），`Pets.ts` 仅用 ~945 行实现完整多宠物交互
- 内置动画状态机、tween 缓动、像素级 hitTest
- 拖拽惯性投掷只需 `pointer.velocity * TWEEN_ACCELERATION`（`Pets.ts:151-157`）

SpiritPal 现状：
- 自研 canvas 处理精灵图（`ATLAS` 8×9 格式）
- 引入 `pixi-live2d-display` + `pixi.js` 支持 Live2D 角色
- 需手写动画行表（`ANIMATION_ROWS`，`types.ts:18-28`）

**建议**：不建议 SpiritPal 全面切换到 Phaser。Live2D 路线已确立且表现力更强。但可考虑"双渲染管线"：Live2D 角色用 pixi，2D 精灵图角色用 Phaser 或继续自研 canvas。WindowPet 的 50 个 Shimeji 角色是 2D 精灵图，若要引入这些角色，Phaser 是最低成本方案。

#### 7.3.2 精灵图格式对齐

两者都采用 **9 行布局**，这是 Shimeji 生态的事实标准（stand/walk/sit/greet/jump/fall/drag/crawl/climb 9 个动作对应 9 行）。SpiritPal 的 `ANIMATION_ROWS`（`types.ts:18-28`）也是 9 行（idle/walk/run-left/waving/jumping/failed/waiting/running/review）。

**对齐建议**：SpiritPal 可在 `pet_conf.json` 中新增 `shimejiLayout` 字段，声明 `frameSize`、`spriteLineMap`（状态→行号）、`frameMaxMap`（状态→帧数），从而直接消费 WindowPet 的 50 个 JSON 配置，无需重制精灵图。

#### 7.3.3 tauri.conf.json 对比

| 配置项 | WindowPet (v1) | SpiritPal (v2) |
|--------|----------------|-------------|
| 主窗口 | fullscreen + transparent + alwaysOnTop + skipTaskbar（`tauri.conf.json:73-84`） | 300×400 + decorations:false + transparent + alwaysOnTop + skipTaskbar（`tauri.conf.json:14-27`） |
| 设置窗口 | 动态创建（`utils.rs:33-48`），1000×650 | 静态声明 720×540（`tauri.conf.json:28-38`） |
| 聊天窗口 | 无 | 420×600（`tauri.conf.json:39-49`） |
| 权限模型 | allowlist（v1 旧模型） | capabilities（v2 新模型，`src-tauri/capabilities/*.json`） |
| Updater | passive 安装模式 | dialog:true |
| 移动端 | 无 | Android minSdk 24 + iOS 13.0 |

SpiritPal 的 Tauri v2 配置更现代，支持移动端与细粒度权限。WindowPet 的 v1 allowlist 模型已过时，移植时需转换为 v2 capabilities。

---

## 8. 总结与技术参考价值

### 8.1 项目定位

WindowPet 是 **Tauri 桌宠领域 Phaser 渲染方案的标杆实现**，与 SpiritPal 同属 Tauri + React + TypeScript + Zustand 技术栈，且同样采用 9 行精灵图布局，是 SpiritPal 最直接的同源参考项目。其 50 个内置 Shimeji 角色、完整的点击穿透方案、成熟的宠物商店与自定义宠物流程，对 SpiritPal 的角色生态扩展具有立即可用的价值。

### 8.2 核心技术参考价值

| 维度 | 参考价值 | 说明 |
|------|----------|------|
| **角色资源库** | ★★★★★ | 50 个 MIT 许可的 Shimeji 风格精灵图 + JSON 配置，可直接扩充 SpiritPal 角色生态 |
| **点击穿透方案** | ★★★★★ | Rust 鼠标 + 像素级 hitTest 的完整穿透窗口交互范式，Tauri 桌宠的通用解法 |
| **Phaser 渲染参考** | ★★★★ | 若 SpiritPal 需支持 2D 精灵图角色，WindowPet 的 Phaser 集成是最成熟的 Tauri 参考 |
| **精灵图配置格式** | ★★★★ | frameSize + spriteLine + frameMax 的灵活格式，支持两种尺寸定义与两种状态定义 |
| **跨窗口通信** | ★★★★ | DispatchType 枚举 + emit 模式，比 SpiritPal 的 hash 路由更解耦 |
| **设置 UI 模式** | ★★★ | AppShell + Tabs + URL 同步 + 主题切换的完整设置窗口范式 |
| **自动更新** | ★★★ | Tauri v1 updater 完整流程，SpiritPal v2 可等价迁移 |

### 8.3 对 SpiritPal 的核心启示

1. **角色生态可速成**：WindowPet 的 50 个 MIT 角色资源是 SpiritPal 最快补全角色库的途径，只需对齐 9 行精灵图格式即可消费（P0，Phase 1）
2. **点击穿透是 Tauri 桌宠的必修课**：WindowPet 的 Rust 鼠标 + 像素检测方案应作为 SpiritPal 透明窗口交互的标准实现（P0，Phase 2）
3. **9 行精灵图是 Shimeji 生态共识**：SpiritPal 的 `ATLAS.rows=9` 与 WindowPet 的 `totalSpriteLine=9` 不谋而合，应固化为 SpiritPal 的精灵图标准布局
4. **Phaser 与 Live2D 可共存**：不建议 SpiritPal 放弃 Live2D，但可评估将 Phaser 作为 2D 精灵图角色的次要渲染管线，以低成本消费 WindowPet 资源（P1，Phase 3+）
5. **Zustand 多 store 分治值得借鉴**：WindowPet 的三 store 拆分（设置/宠物状态/标签页）比单一 store 更易维护，SpiritPal 可参考（P1，Phase 1）
6. **Tauri v1 → v2 迁移注意点**：WindowPet 的 allowlist 权限模型、`@tauri-apps/api` v1 调用、tauri-plugin-*-api v1 分支依赖在移植到 SpiritPal v2 时需全部转换

### 8.4 风险与局限

- **项目维护态**：WindowPet 最近推送在 2025-04，v0.0.9 后无新版本，存在维护停滞风险
- **单开发者**：Bus Factor = 1
- **Tauri v1 技术债**：updater/autostart/store 等 v1 插件 API 已过时，移植需重写为 v2
- **无测试覆盖核心场景**：虽有 Vitest，但 `__tests__` 仅覆盖组件与函数片段，Phaser 场景与跨窗口通信无测试
- **LEARN.md 为空**：README 提及的教学文档实际为空占位（`LEARN.md` 仅一行注释），无可借鉴教学内容
- **README 信息滞后**：README 第 67 行仅提及 English and Khmer，实际代码已支持 4 语言

### 8.5 综合评价

WindowPet 是 SpiritPal 在 7 个分析仓库中**技术栈重合度最高、资源可直接复用度最高**的项目。其 50 个 MIT 角色资源、9 行精灵图配置格式、点击穿透方案三项资产对 SpiritPal 具有 P0 级移植价值。建议优先完成角色资源移植（Phase 1）与点击穿透方案对齐（Phase 2），再评估 Phaser 渲染管线的引入（Phase 3+）。

---

> **报告结束**
> 本报告基于 2026-07-14 对 GitHub 仓库 SeakMengs/WindowPet main 分支（v0.0.9）的完整源码分析，涵盖 `src-tauri/` 全部 Rust 源码、`src/` 全部 TS/TSX 源码、50 个宠物 JSON 配置、tauri.conf.json、package.json、CI 工作流，并与 SpiritPal（`spiritpal-app/`）的 `src/lib/types.ts`、`src/App.tsx`、`package.json`、`src-tauri/tauri.conf.json` 进行了逐项对比。
