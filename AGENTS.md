# SpiritPal AGENTS.md — AI 辅助开发指南

> 🧬 **自进化协议版本**：v2.26  
> 📅 **最后更新日期**：2026-08-27  
> 🎯 **对应项目版本**：v0.1.0（闭源）

---

## ⚠️ 🤖 Agent 行为契约（自进化协议 · 必须严格遵守）

AI Agent 打开本文件后的 **第一件事** 是执行下面的「🧪 自进化自检清单」，并遵守以下 5 条铁律：

### 🔴 6 条自进化铁律
1. **🔄 同步规则（Synchronize First）**：如果发现项目实际情况（目录结构、依赖版本、技术栈、配置文件名等）与本文件描述 **不一致** → **立即更新本文件**，不要只改代码不改 AGENTS.md。这是最高优先级的规则。
2. **📝 坑点累积（Gotchas Accumulation）**：每次修复 Bug / 踩坑后（哪怕是很小的坑），**必须** 追加一条到第 14 节「常见陷阱（Known Gotchas）」，写清楚：触发场景、现象/报错、正确做法、首次发现日期。
3. **📚 SOP 累积（SOP Accumulation）**：每次完成一个「本文件现有 SOP 没覆盖」的典型开发任务后，**必须** 把步骤整理成新 SOP 追加到第 13 节「典型 AI 开发场景 SOP」。
4. **✅ 自检流程（Self-Check on Startup）**：每次打开本文件准备工作前，**必须** 先运行下面的「🧪 自进化自检清单」，逐项核对，有任何一项不符先修正 AGENTS.md 再干活。
5. **🏷️ 版本递增（Version Increment）**：每次更新本文件内容后，**必须** 做三件事：① 文件顶部「自进化协议版本号」+0.1（小改）或 +1.0（大改/框架调整）；② 更新「最后更新日期」；③ 在文件末尾「📋 自进化修订记录表」追加一行记录。
6. **🔬 证据绑定（Evidence Binding）**：本文件中每出现一个**可执行文件路径**（脚本、配置、workflow、源码），它必须是**当时可验证存在**的。引用前跑一次 `python scripts/check_spec_refs.py`；若确实想描述尚未实现的东西，必须显式加 `（计划，未实现）` 前缀。禁止把"CI 会阻断 X"写成一个 CI 里不存在的门禁。

### 🧪 自进化自检清单（每次启动工作前必跑）
- [ ] 目录结构（`src/`、`src-tauri/`、`components/`、`stores/`、`hooks/`、`lib/`）是否和第 3 节模块边界描述一致？
- [ ] 3 个窗口配置（pet-window / settings / chat）是否和 `lib/appWindows.ts` 实际配置一致？
- [ ] 上次工作是否踩了新坑？如果是，是否已追加到第 14 节 Known Gotchas？
- [ ] 修改了 Rust Tauri command 后，是否已在前端对应调用处更新了类型签名？
- [ ] 是否改了 package.json / Cargo.toml / tauri.conf.json 的版本号？如果改了一个，是否 3 个都同步（见第 10.2 节）？
- [ ] 上次更新是否正确递增了自进化协议版本号 + 追加了修订记录表？
- [ ] 本文引用的 scripts/ configs/ workflows/ 路径是否全部真实存在？（跑 `python scripts/check_spec_refs.py`，要求退出码 0）
- [ ] §pre-commit 表格是否与 `.pre-commit-config.yaml` **双向**一致？（既无虚构钩子，也无漏记实际钩子）

---

## 1. 项目概览 & 技术栈

> **SpiritPal** — 「无用，但治愈」的跨平台桌面宠物伴侣 App。  
> 核心理念：没有 KPI、不追求效率，让一只会眨眼、会撒娇、会碎碎念的小宠物陪在你桌面上。  
> 许可证：闭源（私有项目）  
> **代码入口**：React 前端 `src/main.tsx` → Tauri Rust 后端 `src-tauri/src/main.rs`

### 技术栈总表
| 层 | 技术 | 版本/说明 |
|----|------|----------|
| 打包框架 | **Tauri 2.x**（不是 Electron） | 核心优势：包体积 10MB（Electron 100MB+）、Rust 原生性能 |
| 前端框架 | **React 19 + TypeScript 5.5+（strict: true）** | TSC 严格模式 + `noUncheckedIndexedAccess: true` |
| 路由 | TanStack Router 2.x（File-based routing） | `src/routes/` 下每个文件对应一个路由 |
| 状态管理 | Zustand v5（轻量，无 Provider） | `stores/` 分模块 + `persist` 中间件做 localStorage 持久化 |
| 数据获取 | TanStack Query v5（React Query） | hooks `usePetInfo()` / `useChatHistory()`，Tauri command 作为 queryFn |
| UI 组件 | 自研 SpiritPal UI Kit（非 shadcn/ui） | `components/ui/` 目录，所有组件风格统一 |
| 动画 | Framer Motion v11 + Lottie Web | 宠物动作、表情切换用 Lottie，UI 交互动效用 Framer Motion |
| 3D 宠物渲染（可选，如开启） | Three.js R3F | `components/pet3d/` 目录 |
| Live2D（默认宠物形象） | pixi-live2d-display v0.4 | `components/petLive2d/`，模型文件 `assets/live2d/<petId>/` |
| 样式方案 | TailwindCSS v4.2（JIT，`@tailwindcss/vite` 插件）+ CSS Variables | 颜色/圆角/阴影 100% Token 化，不许硬编码 `#ff6b6b` |
| 国际化（i18n） | react-i18next v15 | 5 种语言：中/繁/英/日/韩，翻译文件：`public/locales/<lang>/translation.json` |
| 包管理 | **pnpm 9**（shamefully-hoist = true） | 严禁 npm/yarn，node_modules 结构和 lockfile 会不兼容 |
| 前端构建工具 | Vite 6.x + @tauri-apps/cli 插件 | `vite.config.ts` 已配 Tauri dev server 代理 |
| Rust 后端工具链 | MSRV 1.80+ | `rust-toolchain.toml` 已锁 1.80 stable，cargo workspace 单包模式 |
| Rust 加密生态 | AES-GCM（aes-gcm crate）+ Argon2（argon2 crate）+ Tauri secureStore | ⚠️ **部分落地**：聊天记录/记忆走 Rust 端加密（encryption.rs）；**偏好设置已接入 encryptedStorage 加密适配器**（settingsStore H-1 修复后通过 Rust encrypt_data/decrypt_data 命令加密，AES-256-GCM + 机器 ID 派生密钥） |
| Rust 数据存储 | SQLite + SQLx（typed sqlx::query_as! 宏） | 数据库路径 `app_data_dir()/spiritpal.db`，每次启动前自动加密校验 |
| 跨平台支持 | Windows 10+ / macOS 12+ / Linux（可选） | CI `ci.yml` 三个 Job 同时构建三个平台二进制 |

---

## 2. 代码风格约定

### 2.1 TypeScript / React 约定
- **严格模式**：`tsconfig.json` → `strict: true` + `noUncheckedIndexedAccess: true`。数组下标访问必须 `if (arr[i])` 判空。
- **命名规则**：
  - 组件/HOC：`PascalCase.tsx`（如 `PetWindow.tsx`、`withPetProvider.tsx`）
  - hook：`camelCase`，必须 `use` 前缀 → `useDraggableWindow.ts`
  - 函数/变量/属性：`camelCase`
  - 常量/Tailwind 配置/Tauri capability 名：`UPPER_SNAKE_CASE`
- **路径别名**（`tsconfig.json` 已配）：`@/` = `src/`。禁止相对路径出 `../` 超过 3 层（超了就改用 `@/components/...`）
- **Tailwind 约定**：
  - 颜色统一用 `bg-pet-primary` / `text-pet-on-surface`（Semantic Tokens），**严禁写 `bg-blue-500`**（即使效果一样，也必须用语义化 Token，方便换主题）
  - 尺寸统一用空格尺度 `p-4 / gap-6`（1 = 4px），**不许写 `px-17 py-[22px]`**（非标准尺寸先设计评审再进 Tailwind config）
- **React 专用**：
  - `React.FC` 不写（React 19 已弃用），直接 `function MyComponent(props: Props): JSX.Element`
  - 所有组件 props 接口独立写 `export interface PetCardProps`（组件外单独声明，方便外部复用类型）
  - effect 依赖数组 **不许漏依赖**，实在要一次性执行 → 用 `useSyncExternalStore` 或 Zustand 的 `useEffectOnce`（如果装了）。`// eslint-disable-next-line react-hooks/exhaustive-deps` 必须加注释说明为什么是故意的。

### 2.2 Rust 约定
- **命名规则**：函数/变量/模块 `snake_case`，结构体/Enum `PascalCase`，trait `PascalCase` 或 `<Verb>Noun`（`PetDataStore`、`Encryptable`），常量 `UPPER_SNAKE_CASE`
- **unsafe 约束**：⚠️ `#![forbid(unsafe_code)]` **实际未在 lib.rs 声明**（文档曾声称已加，与代码不符）；`commands/window.rs` 的 `get_mouse_pos` 使用 Win32 `GetCursorPos` unsafe 块。约定：新代码避免 unsafe，必须用 unsafe 时用 `tauri-plugin` 官方封装并单独 PR review
- **格式化 & Lint**：
  ```bash
  cargo fmt --all          # 格式化
  cargo clippy --all-targets --all-features -- -D warnings   # 把 warning 当 error 处理
  ```
- **Tauri Command 规则**（`src-tauri/src/commands/` 下）：
  - 每个 command 函数名前缀 `cmd_`（例：`pub async fn cmd_pet_get_info(id: &str) -> Result<PetInfo, String>`）
  - 返回类型必须是 `Result<T, String>`，**不允许 `panic!()` / `.unwrap()` 在生产代码里**（测试代码除外）
  - 错误分支：统一用 `anyhow` crate 的 `anyhow::Result` 记录上下文，然后转成用户可读的 `Err("无法加载宠物档案: xxxx".to_string())` 给前端
  - 访问文件系统必须用 `tauri::api::path::app_data_dir(ctx)` 作为 base，**不要写死 `~/.spiritpal/`**

### 2.3 导入顺序（TypeScript，ESLint `import/order` 强制执行）
```ts
// 1. React / Tauri 官方
import { useState } from "react"
import { invoke } from "@tauri-apps/api/core"

// 2. 第三方库
import { useQuery } from "@tanstack/react-query"
import { motion } from "framer-motion"
import { useTranslation } from "react-i18next"

// 3. 本地项目
import { PetHeader } from "@/components/PetHeader"
import { usePetStore } from "@/stores/petStore"
import { formatTime } from "@/lib/utils"

// 4. 本地资源 / 样式
import PetAvatar from "@/assets/images/default-avatar.webp"
import "./PetWindow.css"
```

---

## 3. 模块边界 & 目录结构

### 3.1 整体架构（桌面多窗口）
```
                ┌──────────────────────┐
                │   Tauri 2.x Runtime   │ ← Rust 单进程 + WRY WebView
                │ （Windows / macOS）   │
                └──────────┬─────────────┘
                           │  IPC（Tauri command）
┌──────────────────────────┴─────────────────────────────┐
│            3 个独立 WebView（同一个前端代码多实例）        │
│                                                         │
│  🐾 pet-window   ⚙️ settings-window   💬 chat-window      │
│  （永远置顶/无边框）  （常规窗口）       （抽屉式）          │
│  （内嵌可收起状态卡：角色状态+快捷入口）                  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 前端目录职责（`src/` 下）
| 目录 | 职责 | 修改注意事项 |
|------|------|-------------|
| `src/routes/` | TanStack Router 基于文件的路由（设置页、关于页、Chat 页） | 新增路由直接新建文件，注意文件名即路径：`src/routes/about.lazy.tsx` → `/about` |
| `src/components/` | **UI 公共组件**（跨页面复用的 Card / Button / Dialog / Tooltip 等） | 1. 每个组件 **单独文件夹**：`PetCard/index.tsx` + `PetCard/PetCard.module.css`（如需自定义样式）<br>2. 样式 **优先 Tailwind**，极少数特殊动效才用 module.css，不写全局污染的 CSS |
| `src/components/petLive2d/` | Live2D 宠物形象渲染（pixi-live2d-display） | 不要直接操作 canvas，统一走 `useLive2dController()` hook |
| `src/stores/` | Zustand stores（状态管理），持久化靠 `persist` 中间件 | 一个 store = 一个业务域：`petStore`（宠物档案）/ `settingsStore`（偏好）/ `chatStore`（聊天历史）/ `windowStore`（窗口布局）。**不要一个全局大 store**。 |
| `src/hooks/` | 公共自定义 Hooks | 命名必须 `useXxx`：`useDraggableWindow`、`useTauriInvoke<T>()`、`useDebounced()`。每个 hook **单独文件**，注释写清楚返回值类型。 |
| `src/lib/`（核心逻辑层 🔥） | **不允许出现 React** 的纯 TS 工具层（⚠️ 实际 159 个 .ts 文件，远超本节清单；以下为重要度排序的子集） | |
| `src/lib/windowManager.ts` | 3 窗口创建/销毁/定位逻辑 | 改必须人工 review，窗口边界穿透、无边框样式和 OS 强相关 |
| `src/lib/encryption/` | AES-GCM 加密 + Argon2 密钥派生（和 Rust 端保持一致算法） | 严禁改算法参数（IV 12字节、盐 16字节、Argon2 m=65536 t=3 p=1），否则旧数据解不开 |
| `src/lib/storage/` | IndexedDB 包装（聊天历史 + 宠物日记） | 写 schema 迁移脚本要同时改 Rust 端 migrations（防止两边不一致） |
| `src/lib/live2dManager.ts` | Live2D 模型加载、表情/动作触发 | 模型文件后缀 `.model3.json`，加载失败回退 DefaultModel |
| `src/lib/dataManager.ts` + `src/lib/db.ts` | 聊天记录 CRUD + 前端 LRU 缓存（1000 条）；`db.ts` 负责 SQLite 读写接入与 beforeunload 时先 checkpoint 再交 Rust 端加密 | 所有写入必须先 Rust 端 AES 加密再入库 |
| `src/lib/types/` | 全局 TS 类型：Pet / ChatMessage / Settings / WindowConfig | 任何类型变动，同步改 `src-tauri/src/types.rs` 的 Rust struct |
| `src/lib/tauriInvoker.ts` | `invoke<T>()` 统一封装：超时 30s + 错误处理 + retry 1 次 | 所有 Tauri command 必须通过这个调用，不要直接 `import { invoke }` |
| `src/lib/petBehaviorEngine.ts` | FSM（有限状态机）：idle/happy/sad/sleeping/eating | 状态转移图 `pet_transitions.png`（见 docs），严禁跨状态跳转 |
| `src/lib/ipcTypes.ts` | Tauri IPC 协议：所有 command 名常量 + 入参/出参 interface | 命令名必须 `spiritpal:xxx`（例：`spiritpal:get_pet_info`），防冲突 |
| `src/lib/i18n.ts` | i18next 初始化（react-i18next） + 语言检测 | 语言切换同步写 settingsStore persist，刷新后保留 |
| `src/lib/utils/` | 纯函数工具：formatTime / classNames merge / 防抖节流 | 必须 100% Vitest 覆盖，不许有副作用 |
| `src/lib/constants.ts` | 全局常量：窗口尺寸 / 动画时长 / 图片 URL 前缀 | 不许散落魔法数字，全集中在这里 |
| `src/App.tsx`（内联 `ErrorBoundary` 类组件，无独立文件） | React ErrorBoundary（错误边界）+ 兜底错误页（「SpiritPal Error」调试卡片：错误信息 + Copy Error + 日志路径提示） | 线上生产构建必须开启 SourceMaps upload（Sentry） |

### 3.3 Rust 后端（`src-tauri/` 下）
| 目录 | 职责 |
|------|------|
| `src-tauri/src/main.rs` | Tauri `Builder::default()` 启动入口 + capabilities 配置加载 |
| `src-tauri/src/lib.rs` | Tauri `Builder::default()` 启动入口 + capabilities 配置加载 + 窗口/托盘/系统事件（⚠️ 无 forbid(unsafe_code) 声明） |
| `src-tauri/src/commands/` | **30 个 Tauri Commands**（⚠️ 实际数；一一对应前端 `src/lib/ipcTypes.ts` 的命令名）：<br>`pet`（档案 CRUD）/ `chat`（历史加密读写）/ `settings`（偏好 secureStore）/ `backup`（JSON 导入导出）/ `window`（置顶/穿透）/ `update`（自动更新签名校验）/ `encryption`（Argon2 派生测试）/ `system-tray`（托盘菜单事件）/ `live2d-cache`（模型缓存清理）/ `log`（日志滚动）/ `analytics`（本地统计，不上传）/ `diagnose`（用户一键导出故障诊断包） |
| `src-tauri/src/encryption.rs` | 与前端 `lib/encryption/` **算法严格一致**：AES-256-GCM + Argon2id，互测通过才允许 |
| `src-tauri/src/encrypted_db.rs` | SQLite 数据库文件级静态加密（at-rest）：AES-256-GCM + PBKDF2 机器 ID 派生密钥，关闭时 `spiritpal.db` → `spiritpal.db.enc`、启动时反向解密；数据库本体经 tauri-plugin-sql 打开，DB 路径 `app_data_dir().join("spiritpal.db")` |
| `src-tauri/src/types.rs` | Rust struct（对应前端 `lib/types.ts`）：`Pet`、`ChatMessage`、`Settings` |
| `src-tauri/src/tests.rs`（或 `tests/` 目录） | **105 个单元测试**（⚠️ 实际数）：加密一致性 / DB 迁移 / command 参数校验 / 路径穿越攻击测试 |
| `src-tauri/capabilities/` | Tauri v2 capabilities JSON（安全权限白名单）：`default.json`（pet-window）/ `chat-window.json` / `settings-window.json` | **修改必须人工 review**，capability 过大会导致跨窗口 IPC 安全漏洞 |
| `src-tauri/tauri.conf.json` | Tauri 应用配置：bundle ID / 图标路径 / 窗口定义 / updater 公钥 | 版本号改这里 + package.json + Cargo.toml 同步（见 §10.2） |
| `src-tauri/Cargo.toml` | Rust 依赖 + crate metadata | 版本号同步位置之一 |

---

## 4. 状态管理（stores/）

> 核心原则：**一个 Zustand Store = 一个业务域**。禁止全局 3000 行大 Store，每个 store 单独文件 + 单独 `persist` 配置（因为加密策略不同：settingsStore 加密、petStore 部分加密、windowStore 明文即可）。

| Store 文件 | 作用域 | 持久化策略 | 关键 Actions |
|-----------|--------|-----------|-------------|
| `stores/petStore.ts` | 当前选中的宠物（activePetId）、所有宠物列表、好感度、饥饿值 | `persist(name="spiritpal:pet", partialize: {档案+好感度走 AES-GCM 持久化，瞬时状态（当前表情）仅内存})` | `setActivePet(id)` / `feedPet(id, food)` / `updatePetMood(id, -5)` |
| `stores/settingsStore.ts` | 语言、启动行为、窗口置顶、Live2D 画质、自动更新开关 | `persist(name="spiritpal:settings", encryptedStorage 加密)`（H-1 修复后已接入 Rust 端 AES-256-GCM 加密，Tauri 不可用时降级明文） | `setLanguage("zh-CN")` / `setAlwaysOnTop(true)` |
| `stores/chatStore.ts` | 当前对话、未读数、草稿、表情包列表 | `persist(name="spiritpal:chat", partialize: {messages走加密写入DB，草稿存IndexedDB})` | `sendMessage(text)` / `clearHistory(petId)` |
| ⚠️ 窗口状态**尚无独立 Zustand store**（原声称的 `windowStore.ts` 未实现），实际由 `src/lib/windowManager.ts` 的 `windowManager` 单例承担 | 3 窗口位置、尺寸、Z-order、当前可见性 | 不走 Zustand `persist`（windowManager 直接调 Tauri 窗口 API；位置信息不敏感，如需持久化再补 store） | `windowManager` 实例方法 + `enableWindowsPinMode()` / `isWindowsPinModeActive()` |
| `stores/themeStore.ts` | 主题（light/dark/跟随系统）、主色调 Token 覆盖 | `persist(name="spiritpal:theme")` 明文 | `setTheme("dark")` / `setPrimaryColor("#a78bfa")` |

---

## 5. 公共 Hooks 清单（hooks/）

> 每个 hook 一个文件，命名必须 useXxx，**不许一个 hooks.ts 里面塞 20 个函数**。

| Hook | 文件 | 作用 |
|------|------|------|
| `useDraggableWindow` | `useDraggableWindow.ts` | 给无边框 pet-window 加拖拽（处理 Windows DWM 标题栏命中测试 + Tauri 穿透开关互斥） |
| `useTauriInvoke<T>` | `useTauriInvoke.ts` | 封装 `lib/tauriInvoker.ts`，返回 { data, isLoading, error, refetch }，对应 TanStack Query 风格 |
| `useDebounced<T>` | `useDebounced.ts` | 防抖 value，默认 300ms |
| `useThrottled<T>` | `useThrottled.ts` | 节流 value，默认 500ms（拖动窗口节流事件） |
| `usePetMoodDecay` | `usePetMoodDecay.ts` | 每 5 分钟让宠物好感度 -1，写入 petStore（和 Rust 端 schedule task 双保险） |
| `useLive2dController` | `useLive2dController.ts` | 控制 Live2D：`motion("tap")` / `expression("happy")`，自带错误兜底 |
| `useIpcListener` | `useIpcListener.ts` | 监听 Rust 端 push event（如 `spiritpal:backup:progress`、`spiritpal:update:available`），自动 cleanup |
| `useIdleDetection` | `useIdleDetection.ts` | 5 分钟无操作 → 宠物进入 idle + 节省 CPU（降低 Live2D FPS） |
| `useClipboardFallback` | `useClipboardFallback.ts` | navigator.clipboard 不可用（如某些 Linux DE）自动 fallback 到 Tauri `cmd_copy_to_clipboard` |
| `usePetFloatingText` | `usePetFloatingText.ts` | 宠物头上冒气泡（「喵～」「想出去玩」），自带 LRU 最多 3 条并发 |

---

## 6. 测试约定（4 层测试体系）

| 层级 | 框架 | 命令 | 覆盖率阈值 |
|------|------|------|:----------:|
| **前端单元**（Store / Hook / Utils / 组件） | **Vitest + @testing-library/react + @testing-library/user-event** | `pnpm test:unit` | `branches ≥ 80, functions ≥ 80, lines ≥ 80, statements ≥ 85`（`vitest.config.ts` 已配 `coverage.thresholds`，fail 直接退出码 1） |
| **后端单元**（Rust 加密 / DB / Commands） | Rust built-in + `cargo test` | `pnpm test:rust`（或 `cd src-tauri; cargo test --all-targets`） | 暂不限覆盖率，但 `src/encryption.rs` / `src/db.rs` 的测试不许删 |
| **端到端（E2E）**（真实 Tauri + 真实 WebView） | **Playwright for Tauri**（`@playwright/test` + `@tauri-apps/plugin-playwright` 驱动） | `pnpm test:e2e` | 至少覆盖「启动 → 选默认宠物 → 发一条消息 → 关闭应用」主路径（`tests/e2e/main-path.spec.ts`） |
| **性能 / 内存**（桌面 App 最怕卡） | Tauri `tauri-plugin-perf` 自定义脚本 | `pnpm test:perf`（生成报告 `reports/perf/YYYYMMDD.html`） | 30 分钟宠物窗口常驻内存 ≤ 250MB（Live2D 开）、≤ 120MB（Live2D 关） |

### 6.1 测试命名规范（TypeScript / Vitest）
```ts
// describe 被测对象，it 行为+条件
describe("useTauriInvoke", () => {
  it("should return deserialized data when command succeeds", async () => { ... })
  it("should retry once on network error before throwing", async () => { ... })
})
```

---

## 7. 构建 / 运行命令

> 📌 所有命令根目录执行。`pnpm` 是唯一支持的包管理器。

| 命令 | 作用 | 说明 |
|------|------|------|
| `pnpm install` | 首次环境安装 | 会同时执行 `pnpm tauri install`（安装 Rust 端 cargo 依赖） |
| `pnpm dev` | **开发模式** | 同时启动 Vite dev server（HMR）+ Tauri dev（Rust 编译一次）。3 窗口同时弹出，**开发神器** |
| `pnpm build` | **生产构建**（Windows .exe / macOS .dmg / Linux .AppImage） | ⚠️ **重要：先看下面 Build After Code Changes 章节** |
| `pnpm test:unit` | Vitest 前端单元（含覆盖率报告） | CI 每次跑 |
| `pnpm test:rust` | `cargo test` Rust 单元（32 个用例） | CI 每次跑 |
| `pnpm test:e2e` | Playwright E2E | 在 CI 的 `ci.yml` 中由 `e2e` job（name: E2E Tests (Playwright)）跑，参与 PR CI；真实 Tauri GUI 冒烟仍需本地/self-hosted |
| `pnpm test:perf` | 性能脚本（生成 HTML 报告） | 发版前人工跑一次 |
| `pnpm lint` | ESLint（含 import 排序 + tailwind 顺序）+ TypeScript 严格检查（`tsc --noEmit`） | CI 必过 |
| `pnpm format` | Prettier 格式化（.ts / .tsx / .json / .md） | 提交前跑一次 |

### 7.1 🚨 Build After Code Changes（重要）
**Rust 代码改了之后（`src-tauri/src/*.rs` / `Cargo.toml`），必须手动执行生产构建并复制产物到 `artifacts/`**，否则：
1. 你以为 Rust 端逻辑生效了 → 实际 Tauri 仍然加载 `target/release/` 里旧的 `.exe/.app`
2. E2E 测试会跑旧代码 → 结果错乱

**正确流程（Rust 改动后）**：
```bash
# 1. 出生产二进制
pnpm build
# 2. 复制到 artifacts/（gitignore 已经包含这个目录，不需要提交，本地调试用）
mkdir -p artifacts
cp src-tauri/target/release/bundle/*/SpiritPal-*.* artifacts/
#    Windows: src-tauri/target/release/bundle/msi/SpiritPal_1.0.0_x64_en-US.msi
#    macOS:   src-tauri/target/release/bundle/dmg/SpiritPal_1.0.0_aarch64.dmg
```

---

## 8. 依赖管理

| 管理目标 | 工具 | 锁文件 | 说明 |
|---------|------|--------|------|
| 前端依赖（React / Tauri / Tailwind / Lottie） | **pnpm 9**（shamefully-hoist=true 解决部分 Tauri 插件 peer 问题） | `pnpm-lock.yaml`（必须提交 Git） | 添加依赖：`pnpm add zustand`；开发依赖：`pnpm add -D vitest`；绝对不要用 `--frozen-lockfile` 以外的 flag 绕过锁文件 |
| Rust 依赖（SQLx / aes-gcm / argon2 / tauri 等） | Cargo（MSRV 1.80） | `src-tauri/Cargo.lock`（必须提交 Git） | 添加依赖：`cd src-tauri; cargo add aes-gcm`；生产二进制会用 lock 里的精确版本，确保可复现 |

---

## 9. i18n 多语言规范（5 种语言：中 / 繁 / 英 / 日 / 韩）

### 9.1 翻译文件位置（react-i18next）
- JSON 格式：`public/locales/<lang>/translation.json`
- `<lang>` 取值（必须严格一致）：`zh-CN` / `zh-TW` / `en-US` / `ja-JP` / `ko-KR`
- fallback 链（react-i18next 已配）：`用户选语言 → en-US（兜底）`

### 9.2 新增翻译 Key 的 4 步流程
```ts
// 第 1 步：代码里写 t()，key 用点分语义，不许英文原句直接当 key
<div>{t("pet_window.greeting_morning", { defaultValue: "Good morning~ Have you had breakfast?" })}</div>
```

2. `pnpm i18n:extract` → 扫描所有 `t("xxx")`，输出 JSON keys，自动加到 `en-US/translation.json`（英文 = key 默认 defaultValue）
3. 为 5 种语言各翻译一遍，填到对应文件：
   - `zh-CN/translation.json` → `{"pet_window.greeting_morning": "早安~ 吃早饭了吗🐾"}`
   - `zh-TW/...` → 繁中
   - `ja-JP/...` → 日
   - `ko-KR/...` → 韩
4. `pnpm i18n:check` → 跑完整性校验脚本（`scripts/check-i18n-coverage.ts`）：输出 5 种语言各自的覆盖率，缺 key 直接阻断构建。

> ⚠️ **命名规范**：key 一律 `模块名.语义名`（如 `settings.language_label`、`chat.placeholder_input`），**不要** `good_morning` 这种没有上下文的 key（因为不同场景翻译不一样）。

---

## 10. Git / 提交规范 & 版本管理

### 10.1 Conventional Commits
```
<type>(<scope>): <subject>
```
Type：`feat` / `fix` / `docs` / `style` / `refactor` / `perf` / `test` / `chore` / `ci` / `security`  
Scope 建议：`pet-window` / `chat` / `settings` / `rust-encryption` / `i18n` / `live2d`

### 10.2 🚨 版本号同步修改清单（发版时 3 个文件 4 处一起改，漏一个二进制版本号不匹配）
| # | 文件路径 | 要改的字段 | 示例（1.0.0 → 1.1.0） |
|---|---------|-----------|---------------------|
| 1 | **`package.json`（根）** | `version: string`（语义化） | `"version": "1.0.0"` → `"1.1.0"` |
| 2a | **`src-tauri/Cargo.toml`** | `[package] version`（和 package.json **必须完全一致**） | `version = "1.0.0"` → `version = "1.1.0"` |
| 2b | `src-tauri/Cargo.toml` | `[dependencies] tauri = { version = "2.x" }`（Tauri 框架版本不需要每次改，只升级 Tauri 时改） | — |
| 3 | **`src-tauri/tauri.conf.json`** | `version: string`（显示在 Windows 资源管理器的 .exe 详细信息 / macOS Finder .app 简介里） | `"version": "1.0.0"` → `"version": "1.1.0"` |

> 📌 这 3 处（package.json / Cargo.toml / tauri.conf.json）的 `version` 字段 **必须完全一致**（比如都是 `1.1.0`）。CI `ci.yml` 有 `check-version-consistency.js` 脚本，3 个不一样 PR 直接失败。

> 📌 Git Tag 命名：`git tag -a v1.1.0 -m "Release v1.1.0"`（必须 v 开头，和 3 处版本号严格一致，仅前面多 `v`）

---

## 11. 安全注意事项

1. **所有敏感数据落盘必须加密**：聊天记录、宠物档案、用户偏好设置 → 前端 `lib/encryption/` 或 Rust 端 `encryption.rs`（AES-256-GCM），**禁止** 直接 `localStorage.setItem("chat_history", rawJSON)`。
2. **Tauri Capabilities 权限最小化原则**：`capabilities/*.json` 中 `allowlist` 必须一条一条加，**严禁** 写 `"fs": { "all": true }` 这种通配权限。比如：`"fs": { "readFile": true, "scope": ["$APPDATA/*"] }` 只允许读 app_data_dir。
3. **前端 IPC 调用必须校验 scope**：`window.__TAURI_INTERNALS__` 对象不要直接碰，所有 IPC 走 `@tauri-apps/api/core` 的 typed invoke，capability 不够会直接抛错（符合预期）。
4. **自动更新签名校验强制开启**：`tauri.conf.json` → `updater.active = true` + `pubkey` 已配置 Rust Ed25519 公钥。**禁止** `signatures.publicKey = ""` 空值（表示跳过签名校验直接更新 = 任意代码执行漏洞）。
5. **不要在前端代码写硬编码密钥 / API Key**：哪怕是 `const ENCRYPTION_SALT = "spiritpal_salt_2026!!"` 也不行（TypeScript 编译后的 bundle 反编译一下就能搜出来）。密钥统一走 `tauri-plugin-secure-store`，首次启动随机生成 + 存在 OS Keychain / Credential Manager。

---

## 12. CI/CD Workflow 说明（.github/workflows/ 下）
| Workflow 文件 | 触发 | 做什么 |
|---------------|------|--------|
| `ci.yml` | push 到 main / develop，所有 PR | 3 个 Job 并行：<br>1. `lint-and-test`：pnpm lint + pnpm test:unit（Vitest coverage 阈值）<br>2. `rust-test`：`cargo test`（32 个 Rust 单元 + 加密一致性）<br>3. `build`：3 个 matrix（windows-latest / macos-14 / ubuntu-latest）并行 `pnpm build`，产出 .msi / .dmg / .AppImage 上传 artifact（保留 7 天） |
| `release.yml` | 手动 `Run workflow`（选分支），或 Git Tag push v*.*.* | 调用 ci.yml build job + 自动创建 GitHub Release + 上传 3 平台安装包（自动更新签名的 private key 在 GitHub Secrets，不会泄露） |
| `ci.yml` → `e2e` job（⚠️ 不存在独立的 e2e workflow 文件；此前文档声称的独立 workflow 为幻影，已纠正） | 同 `ci.yml` 触发（push 到 main / develop + 所有 PR） | E2E 实际以 `ci.yml` 内的 `e2e` job（name: E2E Tests (Playwright)）运行：ubuntu-latest 上 `pnpm exec playwright install --with-deps chromium` 后跑 `tests/e2e/` 下 5 个 spec（app-loading / pet-interaction / accessibility / memory-system / inventory-system），失败时上传 report + 视频 artifact。涉及真实 Tauri 桌面二进制的 GUI 冒烟仍需本地（或 self-hosted runner）执行 |

---

## 13. 典型 AI 开发场景 SOP（照着做，少踩坑）

<!-- 📥 新SOP追加模板（AI 完成新类型任务后复制填好追加到这里）：
#### SOP-X: [场景名称]
**适用条件**：什么情况下走这个流程
**步骤**：
1. 第一步...
2. 第二步...
3. 第三步...
**验证**：怎么确认操作成功
**关联文件**：
- path/to/file1.ts
- path/to/file2.rs
-->

#### SOP-1: 新增一个 Rust Tauri Command（如 `cmd_pet_hug` 撸猫加好感度）
**适用条件**：前端需要访问 Rust 端才能做的操作（加密写库、改系统托盘、写文件）

**步骤**：
1. `src-tauri/src/types.rs` 加入参 + 出参 struct：
   ```rust
   #[derive(Debug, Serialize, Deserialize)]
   pub struct HugResult { pub mood_delta: i32, pub new_total: i32 }
   ```
2. `src-tauri/src/commands/pet.rs` 写函数：
   ```rust
   #[tauri::command]
   pub async fn cmd_pet_hug(app: tauri::AppHandle, pet_id: &str, strength: u8) -> Result<HugResult, String> {
       // 1. 参数校验（strength 1-10，越界 Err("strength out of range")）
       // 2. DB 事务：读 pet → 加好感度 → 写回
       // 3. 发事件给前端（可选） app.emit("spiritpal:mood_changed", ...)
       // 4. Ok(HugResult { mood_delta, new_total })
   }
   ```
3. `src-tauri/src/lib.rs` 的 `Builder::default().invoke_handler(tauri::generate_handler![...])` 里 **把新函数名加进去**（不加的话前端 invoke 会报「command not found」，调试半小时的经典坑）
4. 前端 `src/lib/ipcTypes.ts` 加常量 + 类型：
   ```ts
   export const CMD_PET_HUG = "spiritpal:pet_hug" as const
   export interface HugResult { mood_delta: number; new_total: number }
   ```
5. `src/stores/petStore.ts` 加 action `async hugPet(petId, strength)`，内部调用 `useTauriInvoke<HugResult>(CMD_PET_HUG, { pet_id: petId, strength })`
6. 单元测试：前端 Vitest mock tauri invoker 测 store action；Rust `cargo test cmd_pet_hug_*` 测参数校验和 DB 写入
7. **最后一步**（见 §7.1 Build After Code Changes）：`pnpm build` → 产物复制到 `artifacts/` → 手动点一下验证「撸猫」按钮真的加了好感度。

#### SOP-2: 新增一个 Zustand Store（如新增 achievementStore：成就系统）
1. 新建 `src/stores/achievementStore.ts`：
   ```ts
   import { create } from "zustand"
   import { persist, createJSONStorage } from "zustand/middleware"
   // 注意：如果是敏感数据（用户成就其实无所谓，示例示范加密）
   // import { encryptMiddleware } from "@/lib/encryption/storeMiddleware"

   interface AchievementState {
     unlocked: Record<string, { unlockedAt: number; count?: number }>
     unlock: (id: string) => void
     reset: () => void
   }

   export const useAchievementStore = create<AchievementState>()(
     persist(
       (set) => ({
         unlocked: {},
         unlock: (id) => set((s) => ({ unlocked: { ...s.unlocked, [id]: { unlockedAt: Date.now() } } })),
         reset: () => set({ unlocked: {} })
       }),
       {
         name: "spiritpal:achievements",  // persist 命名统一前缀 spiritpal:xxx
         storage: createJSONStorage(() => localStorage), // 敏感的话换成加密 storage
         partialize: (s) => ({ unlocked: s.unlocked })  // 只持久化需要的字段
       }
     )
   )
   ```
2. `src/lib/types.ts` 加 `AchievementDef` / `UnlockedAchievement` 类型定义（同步改 `src-tauri/src/types.rs` 如果 Rust 端也要读）
3. Vitest 测试：4 个最小用例（初始空、unlock 加、重复 unlock 幂等、reset 清空）
4. 如果 store 里字段要参与 Rust 端 backup/restore 流程 → 同步改 `commands/backup.rs` 的 schema。

#### SOP-3: 新增一个宠物角色（例如新增 Miko 小狐狸 Live2D 模型）

> ⚠️ 前置条件：本仓库不内置 Live2D 模型资产。需自行放置 `public/assets/live2d/<model>/<model>.model3.json`，否则本步骤无法执行。

1. 把新的 Live2D 模型文件（`.model3.json` + `.moc3` + 贴图 + 动作 motion3.json）放到 `public/assets/live2d/<model>/` 目录（例：`miko`）
2. `src/lib/types.ts` 的 `PetSpecies` enum 加 `miko: "fox"` 变体（同步 Rust `types.rs`）
3. `src/stores/petStore.ts` 初始化 `availablePets` 数组里加一条 `{ id: "miko-001", species: "fox", name: "Miko", modelPath: "/assets/live2d/<model>/<model>.model3.json" }`（路径与步骤 1 实际放置的模型目录一致）
4. `src/lib/petBehaviorEngine.ts` 的 FSM 表里加一条 fox 物种的专属动作映射（fox 兴奋时触发 `motion("jump")` 而不是 `motion("wag_tail")`，dog 才 wag tail）
5. **测试**：pnpm dev → 启动后设置里选 Miko → 手动验证：Idle 动画循环正常、点她触发 tap motion、表情切换正常（happy/sad）
6. 性能验证：打开「性能统计面板」(devtools)，确保 Miko FPS 稳定 30 且 30 分钟不泄漏内存（`pnpm test:perf` 单独跑）
7. 翻译补充：每种语言的 `pet_window.default_name_miko` key 补上（「Miko / 美子 / ミコ」等）→ 跑 `pnpm i18n:check`

#### SOP-4: 新增一项设置
1. `src/lib/types.ts` 的 `Settings` interface 加字段（例：`pet_autostart_on_login: boolean` = 开机自启开关）
2. Rust 端 `src-tauri/src/types.rs` 的 Settings struct 同步加
3. `src/stores/settingsStore.ts` 的 default 初始值 + 加 `setPetAutostartOnLogin(v: boolean)` action
4. 前端 `components/settings/GeneralSettings.tsx` 加 UI（Switch / Dropdown），UI 必须走 SpiritPal UI Kit（`BrandSwitch` 组件，不许原生 `<input type=checkbox>`）
5. **如果涉及 OS 能力**（如开机自启 = 写 Windows Registry / macOS LaunchAgents）→ 同步写一个 Rust command `cmd_settings_set_autostart(enabled: bool)`，action 内部调这个 command 而不是直接 localStorage
6. 备份/恢复：`commands/backup.rs` 的 settings 字段加新字段名，不然用户导出 JSON 再导入新字段就丢了
7. 翻译：每种语言 `settings.autostart_label` + `settings.autostart_hint` 补上 → `pnpm i18n:check`

---

## 14. 常见陷阱（Known Gotchas）— 血泪教训汇总（原缺失，现在开始累积）

<!-- 📥 新坑追加模板（AI 踩坑后复制填好追加到表格最后）：
| # | 坑点标题 | 触发场景 | 现象/报错 | 正确做法 | 首次发现日期 |
|---|---------|---------|---------|---------|------------|
| X | 简短标题 | 什么操作会触发 | 具体报错信息或现象 | 正确代码/配置/步骤 | YYYY-MM-DD |
-->

| # | 坑点标题 | 触发场景 | 现象/报错 | 正确做法 | 首次发现日期 |
|---|---------|---------|---------|---------|------------|
| 1 | **Rust 改动后只 pnpm dev 没重新 build → E2E 跑的还是旧 Rust 代码** | 改了 `commands/pet.rs`，想快速验证 → 直接 `pnpm dev` 然后 Playwright E2E | E2E 结果和预期不符、调试半天发现 Rust 端新命令根本没进 E2E 二进制（因为 dev 模式下 Tauri 可能缓存旧的 plugin） | **改完 Rust 代码必执行 pnpm build 一次**（见 §7.1 Build After Code Changes），然后复制到 artifacts/ → E2E 指向 artifacts 下的二进制跑 | 2026-08-10 |
| 2 | **3 处版本号（package.json + Cargo.toml + tauri.conf.json）必须一致** | 只改 package.json 的 `version`，忘记 Rust 端两个文件 | `pnpm build` 成功，但 CI `check-version-consistency.js` 报错：`version mismatch: pkg=1.0.1 cargo=1.0.0 tauri=1.0.0` → PR 失败 | 改版本直接按 §10.2 同步改 3 个文件，或者先让 release-please 自动改（如果项目接入了），改完本地跑 `node scripts/check-version-consistency.js` 先过一遍 | 2026-08-10 |
| 3 | **Tauri command 必须加入 generate_handler! 数组** | 写完 `cmd_pet_hug` 函数，忘记加到 `tauri::generate_handler![cmd_pet_get, cmd_pet_feed, ...]` 里 | 前端 invoke 报错 "command spiritpal:pet_hug not found"，搜 Rust 代码里函数确实存在，调试 1-2 小时才发现忘记加到宏数组 | 每次新增 command 的最后一步 **强制 checklist：「函数已加入 generate_handler! 数组 ✓」**（见 SOP-1 步骤 3） | 2026-08-10 |
| 4 | **Tauri 2.x Capability scope 必须显式写** | 写了个 fs.readFile 读 app_data_dir 的图片，capability allowlist 只写 `"fs": { "readFile": true }` 没 scope | 运行时报 `PermissionDenied: not in scope: $APPDATA/images/avatar.png`，生产环境图裂 | 每个 capability 的 fs 权限都显式写 scope：`"fs": { "readFile": true, "scope": ["$APPDATA/**", "$ASSET/**"] }`，不写 scope 默认空集 = 全拒绝 | 2026-08-10 |
| 5 | **Live2D 模型路径大小写敏感** | macOS 开发一切正常（`Miko.model3.json`），Windows 部署后模型加载失败控制台 404 | Windows NTFS 默认大小写不敏感所以开发没问题，但 Tauri asset 协议是 case-sensitive 的，生产构建 404 | 模型所有引用路径（代码里 `modelPath` + `.model3.json` 内部的 texture 路径）**全小写 + 下划线命名**（`miko_001.model3.json`） | 2026-08-10 |
| 6 | **Zustand persist 版本迁移** | settingsStore 新增了字段 `new_feature_flag: boolean`，但用户设备上存的是老版本 JSON（没有这个字段） | 应用启动报错：`Cannot destructure property 'new_feature_flag' of '...' as it is undefined`，新用户正常老用户全炸 | persist 必须配 `version: 1` + `migrate: (persistedState, version) => {...}`，迁移老版本 JSON 自动补默认值。每改一次 store schema version +1，写对应 migrate 逻辑 | 2026-08-10 |
| 7 | **Tailwind 颜色语义 Token 别写硬编码** | 新组件写 `className="bg-blue-500 text-white"`，过了 1 周产品说「我们要换紫色主题」 | grep 整个项目搜 blue-500，100+ 处硬编码，改到想死 + 必然漏改导致颜色不一致 | **所有 UI 组件颜色只能用语义化 Token**：`bg-pet-primary` / `text-pet-on-surface`（在 tailwind.config.js → `theme.extend.colors.pet` 里定义），换主题改一处全应用生效 | 2026-08-10 |
| 8 | **窗口拖拽 + 点击穿透互斥** | pet-window 启用「点击穿透（transparent mouse）」然后想同时支持「拖动宠物」 | Windows 上开启 WS_EX_TRANSPARENT 后窗口收不到任何鼠标消息 → 拖不动宠物，卡死 1 小时 | 两种模式互斥：拖动时**临时关闭穿透**（`lib/windowManager.setClickThrough(false)`），拖完松手再开回去。加 hook `useDraggableWindow` 内部处理切换。 | 2026-08-10 |
| 9 | **`#![forbid(unsafe_code)]` 下不允许写 FFI unsafe** | 想调一个 Windows API `SetWindowPos` 改窗口位置，手搓 `extern "system" { fn SetWindowPos(...) }` + `unsafe { SetWindowPos(...) }` | `cargo build` 直接报错：`forbidden unsafe_code attribute`，构建失败。想改成 `#![allow(unsafe_code)]` 又过不了 PR review | 用 Tauri 官方 `tauri-plugin-window` 已经封装好的 `window.set_position(x,y)` 安全接口。绝对不要自己写 unsafe，哪怕你认为你能证明安全。 | 2026-08-10 |
| 10 | **加密算法参数固定后绝对不要改** | 上线 2 个月后想：「Argon2 t=3 是不是太慢？改成 t=1 吧」 | 用户升级后打开 App：所有历史聊天记录、宠物档案 **全部 AES-GCM 解密失败**（因为 Argon2 派生出的密钥变了）→ 用户数据丢失，灾难性事故 | 上线前定好算法参数（AES-256-GCM IV=12B / Tag=16B，Argon2id m=65536 t=3 p=1），写死为 `pub const ENCRYPTION_PARAMS` 常量。想升级只能做「双算法兼容 + 后台迁移」，不能直接改老数据的算法。 | 2026-08-10 |
| 11 | **功能性改动后必须编译桌面端和移动端才能看到结果** | 修改了角色配置、UI 组件、业务逻辑等前端/共享代码后，只运行 `pnpm dev` 或 `pnpm test` 就以为改动生效 | 开发模式下改动看似生效（Vite HMR），但生产构建或实际应用中改动未体现；移动端完全未更新 | **任何功能性改动完成后，必须执行完整编译流程**：① 桌面端：`pnpm tauri build`（生成 Windows/macOS/Linux 安装包）；② 移动端：`pnpm tauri android build --apk` 或 `pnpm tauri ios build`（生成移动安装包）。编译产物复制到 `artifacts/` 目录进行验证。仅运行测试或开发模式不能替代完整编译。 | 2026-08-12 |
| 12 | **响应式触发限流不能有全局间隔检查** | T-8 给响应式触发加了 `canTriggerResponsive()` 含 15min 间隔检查 | 测试失败：周期触发 `recordTrigger('frequency')` 后，响应式触发也被全局间隔拦截 → 用户主动对话时无法触发情感回忆 | 响应式触发是用户驱动的（非主动打扰），只需检查每日总上限，**不加全局间隔检查**。间隔检查仅适用于主动触发（`canTrigger`） | 2026-08-15 |
| 13 | **Rust `computeContextFit` 中不能用 `await import`** | T-9 给 `computeContextFit` 加音乐信号时用了 `await import('./musicAwareness')` | `tsc` 编译通过但运行时报错：`computeContextFit` 是同步方法，不能使用 `await` | 同步方法中引用外部模块必须用顶部静态 `import`，不能用动态 `await import` | 2026-08-15 |
| 14 | **无边框窗口的窗口操作（最小化/最大化/缩放）必须显式加 capability 权限，否则静默失败** | settings/chat 窗口是 `decorations: false`，`WindowControls` 调 `minimize()/toggleMaximize()`、`FramelessResizeHandles` 调 `startResizeDragging()`，但 `capabilities/*.json` 里没写对应 allow | 按钮点了没反应、鼠标拖边缘无法缩放，**控制台无任何报错**（Promise 被 `.catch(() => {})` 吞掉），排查半天 | `core:window:default` 只含只读权限，写操作必须显式加：`allow-minimize` / `allow-maximize` / `allow-unmaximize` / `allow-toggle-maximize` / `allow-start-resize-dragging`；同时 `WebviewWindowBuilder`/前端 `WebviewWindow` 必须 `resizable: true`（`resizable: false` 的窗口在 Windows 上即使有权限也无法最大化） | 2026-08-19 |
| 15 | **面板/浮层可拖动时，顶层拖拽条（data-tauri-drag-region）必须让出 z-index** | pet-window 顶部有一条 h-8 的 `data-tauri-drag-region` 拖拽条（z-50），状态面板默认 `right-1 top-1` 恰好被它盖住 | 按住面板顶部（名字行）拖动 → 触发的是整窗拖拽而不是面板拖动，面板永远拖不走 | 拖拽条 z-index 降到面板（z-30）之下；面板拖拽用「3px 阈值后才 setPointerCapture」模式（立即 capture 会吞掉面板内按钮的 onClick）；拖拽期间临时关闭像素穿透（`usePixelClickThrough(!panelDragging, ...)`）防 WS_EX_TRANSPARENT 截断事件 | 2026-08-19 |
| 16 | **桌宠窗口内滚动型浮层（右键菜单等）滚不动 = max-h 超窗口 + 根节点 wheel 拦截 + 穿透白名单缺失三重叠加** | pet-window（高 400）右键弹出菜单，菜单 `max-h-[420px]`；滚轮滚动菜单 → 宠物被缩放、菜单不动；菜单底部项（退出）被窗口裁掉一半 | 菜单永远滑不到底；截图可见最后一项只有上半部分 | ① 浮层 max-height 用 `Math.min(420, winH - 8)` 动态计算，保证 ≤ 窗口视口高（否则容器底部被窗口物理裁剪）；② 浮层容器必须 `onWheel={e => e.stopPropagation()}`，否则滚轮冒泡到 PetWindow 根节点的 `handleWheel`（缩放宠物，preventDefault 吞掉原生滚动）；③ 浮层容器/遮罩必须加入像素穿透交互白名单（`[data-spiritpal-menu]` / `.spiritpal-menu-overlay`），否则悬停浮层空白区时窗口被切到 WS_EX_TRANSPARENT，滚轮事件直接丢失 | 2026-08-19 |
| 17 | **窗口边缘吸附判定不能用「窗口中心点」，必须用「窗口边缘距屏幕边」** | v1.7 实现实时磁吸时用中心点判定 + `max(40, 窗口宽×20%)` 阈值 | 默认 300px 窗口半宽 150 > 阈值 60，放大到 600px 后半宽 300 > 阈值 120——窗口中心永远到不了阈值范围，**吸附整体失效**（小窗口也不吸） | 判定改为窗口边缘距屏幕边缘 < 阈值（`x - screenX < thresh` / `screenX+screenW-(x+winW) < thresh`），窗口贴边时边缘距边为 0 恒满足；中心点只用于防卡屏（鼠标距中心超窗口尺寸时跳过吸附） | 2026-08-19 |
| 18 | **宠物头顶气泡（bottom-full 定位）在窗口高度只按精灵尺寸计算时被顶部裁剪** | 滚轮把宠物放大到 3×（精灵 624 高），handleWheel 的 needH = spriteH+32，宠物顶部只剩 24px | 气泡显示在宠物容器正上方，被窗口顶部物理裁剪，文字/图形显示不全 | 窗口目标高度预留气泡空间：`needH = max(WIN_H, spriteH + 32 + BUBBLE_TOP_SPACE(64))`，宠物 pos.y 相应下移；小窗口（默认 400）不受影响 | 2026-08-19 |
| 19 | **Tauri v2 的 `currentMonitor()` 是顶层函数，Window 实例没有该方法** | usePetDragging 写 `(win as any).currentMonitor()` 获取当前显示器 | 拖动开始缓存屏幕环境时抛 `TypeError: win.currentMonitor is not a function` → catch 吞掉 → dragEnvRef 恒为 null → **边缘吸附永不生效**（实时磁吸+释放吸附全部失效）；单测 mock 了 currentMonitor 掩盖此 bug，真实环境必现 | 用顶层函数：`import { currentMonitor } from '@tauri-apps/api/window'` 后直接 `currentMonitor()`；写 Tauri API 调用前先确认是模块函数还是实例方法（window.js 导出表）；排此类"功能不生效"先查运行时 console（CDP 注入日志最快） | 2026-08-19 |
| 20 | **气泡/浮层驱动的窗口自适应不能依赖「未贴边」状态——贴边停靠是常态，守卫会静默跳过导致长文本照旧被裁剪** | v2.7 气泡窗口自适应加 `if (dockDirRef.current) return` 守卫（担心贴边时改窗口尺寸和吸附抢位置） | 用户反馈长段说话仍被窗口顶部裁剪：宠物被拖到屏幕边缘（或启动时窗口移动 400ms 后 onMoved 自动 snapToEdge）→ dockDir 非空 → 气泡放大被静默跳过；底部停靠的宠物视觉上"正常站立"，极难察觉已贴边 | ① 自适应逻辑不要用 dockDir 做守卫（贴边时照常放大/恢复，改尺寸不解除吸附）；② applyWindowSize 锚定改为贴边感知：dir=left/right/top/bottom 时固定对应屏幕边缘（newX = dir==='left'? pos.x : dir==='right'? pos.x+dW : pos.x+round(dW/2)；newY = dir==='top'? pos.y : pos.y+dH），未贴边时保持中心 X/底部 Y——底部贴边时窗口向上生长、宠物原地不动；③ 验证手法：PowerShell GetWindowRect 每 2s 采样窗口矩形，观察气泡出现时高度增长、关闭后恢复，底边锚定恒定 | 2026-08-22 |
| 21 | **eslint react-hooks v7 的 purity 规则对「事件处理器内 Date.now/Math.random」的判定随组件结构变化而漂移** | v2.8 大改 PetWindow（新增面板/处理器/渲染分支）后 lint 从 0 报错变成 8 个 purity 错误：onDragStart/onDragEnd/pickBubble/triggerPet/handleFeed/handlePlay 等多年未动的代码全被标「Cannot call impure function during render」；且同一批 handler 中 handleBathe 没被标、handleStartPomodoro 被标，判定不一致 | 反复出现「改动前 eslint 全过、改动后老代码报错」且报错位置与改动无关，无法从代码语义推断规律 | ① 先修 React Compiler 的 memoization 报错（如 showBubble 依赖补 `setBubble`，稳定 setter 加进 deps 无害），编译器恢复完整分析后事件处理器通常不再被误伤；② 剩余报错按行逐个补 `// eslint-disable-next-line react-hooks/purity -- 仅事件处理器执行路径（xxx），非渲染路径`（与既有 onClick 注释同模式），不要批量加；③ 加完跑 lint 把 unused directive 的删掉（编译器判定漂移会导致部分豁免多余）；④ 判定基准 = 当前 eslint 实跑结果，不是代码语义 | 2026-08-22 |
| 22 | **宠物行走目标范围硬编码窗口尺寸，窗口/布局变化后宠物游走越界（"被挤到边缘"的假象）** | v2.10 面板并排布局后，用户反馈「打开左侧状态卡后宠物被挤到边缘」 | 根因：usePetBehavior 行走目标 `minX=8 / maxX=WIN_W(300)-SPRITE_W-8` 写死旧窗口宽；面板展开后窗口 444 宽、宠物本应在 x=188 列间区，但行走仍把它带向 x∈[8,100]——正好走到左侧状态卡后面，视觉上"被挤到边缘" | 行走范围改为由调用方注入 `getWalkBounds`（面板展开时返回列间缝隙区间，区间 <24px 则跳过行走改 idle；收起态返回 null 用默认范围）；任何改变宠物活动区域的布局（面板、窗口自适应）都要同步约束行走范围，宠物位置（pos.x）与行走目标必须同一坐标系 | 2026-08-22 |
| 23 | **组件内「渲染期读 ref.current」与「useCallback 闭包引用的 setter 漏进 deps」会被 eslint react-hooks 双规则拦截** | v2.14 重写 RoamWindow 时：① displayState 计算里读 `pausedRef.current` 判断行走态；② handlePanelInteractiveChange 的 useCallback deps 写 `[]`（自认为 ref+setter 稳定无需依赖） | ① `Cannot access refs during render`（react-hooks/refs，error）——渲染期读 ref 不触发重渲染，行走状态会显示错乱；② `Existing memoization could not be preserved`（react-hooks/preserve-manual-memoization，error）——React Compiler 推断依赖 `setPanelOpen` 与手写 deps 不一致直接跳过优化 | ① 渲染期判定用 state 镜像：pauseWalk/resumeWalk 同步 `setWalking`，displayState 只读 `walking && !panelOpen`，ref 仅给 interval/事件回调做即时判定；② 稳定 setter（如 `setPanelOpen`）直接加进 useCallback deps 无害（Gotcha 21 同款经验），编译器能保留 memoization | 2026-08-24 |
| 24 | **前端 WebviewWindow 创建的新窗口必须加入 capabilities 配置，否则该窗口所有 core IPC 被拒（自定义 command 不受限）** | v2.14 漫游窗口交互链路排查：roam-window 由 pet-window 通过 `new WebviewWindow('roam-window', ...)` 创建，但 capabilities 只有 default(pet-window)/chat-window/settings-window 三个文件，无任何文件覆盖 roam-window | 漫游窗口内 `getAllWindows`/`hide`/`show`/`setFocus`/事件监听全部 Promise reject（前端 catch 吞掉无提示）→ 「退出漫游/打开聊天/设置」全部无反应（用户反馈"连退出都无法操作"）；但像素穿透（get_mouse_pos/set_pet_click_through 等自定义 command）正常 → 宠物能走动，观感像"纯动画" | Tauri v2 capability 按窗口 label 匹配，窗口不在任何 capability 的 windows 数组里则该窗口 core IPC 全拒；**新建窗口（含前端动态创建的）必须同步创建/并入 capability 文件**（权限最小化：只加该窗口实际用到的 core:window:* / core:event:* / monitor 查询，勿带 store/sql/notification）；排查"窗口内功能集体不生效"先核对 capabilities 是否覆盖该窗口 label | 2026-08-24 |
| 25 | **WebView2 `additional_browser_args('--remote-debugging-port=...')` 注入 CDP 后，同 userData 下前端新创建的窗口（参数不同）创建失败** | v2.14 想用 CDP 做漫游 DOM 验证：给 pet-window（Rust WebviewWindowBuilder）加 `--remote-debugging-port=9222`，进入漫游时前端 `new WebviewWindow('roam-window')`（无额外参数） | 点击「漫游」→ pet-window 隐藏成功、roam-window **创建失败**（窗口枚举无漫游窗口）→ 应用卡在"pet 隐藏 + roam 未建"的中间态；`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 环境变量也被 WebView2 内部参数覆盖无效；**roam-window 创建成功与否与 CDP 参数存在直接因果**（还原参数后同操作即成功） | WebView2 中同 userData 目录的多个 webview 必须用**兼容的 browser args**，参数不一致时新 webview 创建失败；前端 `WebviewWindow` options **不支持 additionalBrowserArgs**（TS 报错），env 变量不生效 → **CDP 调试与"前端动态创建窗口"互斥**；需要 DOM 级验证时改用临时自动钩子（如漫游窗口挂载 2s 后自动调用目标 IPC，从 OS 窗口状态变化推断权限生效），验证完移除 | 2026-08-24 |
| 26 | **vitest `vi.mock` 工厂引用测试文件顶层 const 会因 mock 提升（hoisting）进入 TDZ 而静默失效——mock 的模块被真实实现替代** | v2.15 写 petForm.test.ts：`const petWin = {...}` + `vi.mock('@tauri-apps/api/window', () => ({ getAllWindows: () => Promise.resolve([petWin]) }))` 引用外层 petWin | 测试"3 failed | 1 passed"且失败诡异：mock 的 updateSettings 0 次调用、petSize 设置不生效（实际用了真实 settingsStore 的 1.0）、断言收到真实 PhysicalPosition/PhysicalSize——因为 vi.mock 工厂被提升到文件顶部执行，此时 petWin/mockSettingsState 处于 TDZ（undefined），mock 工厂静默产出 undefined → 模块回落真实实现；且路径写错（`../stores/settingsStore` 相对测试文件解析不到 src/stores）也会导致 mock 不匹配 | ① 测试用的 mock 数据（含 vi.fn()）必须放 `vi.hoisted(() => ({...}))` 中，mock 工厂引用 hoisted 返回值；② vi.mock 路径相对**测试文件**解析（`__tests__` 在 src/lib/ 下 → `../../stores/settingsStore`）；③ 出现"断言收到真实类实例（如 PhysicalSize）"= mock 未生效的第一信号，先查 hoisting 与路径 | 2026-08-25 |
| 27 | **WebView2「canvas 能读到 VP9 alpha 但显示合成丢弃 alpha」——色度键检测用 hasAlphaChannel 短路必然误判，黑底原样显示** | 视频宠物（咕咕嘎嘎 webm）Windows 上按住/静止都黑底；chromaKey 检测逻辑 `hasAlphaChannel→return false`（假设"canvas 有 alpha = 显示正常"） | 运行时实测（debug+CDP 逐像素）：canvas getImageData 透明区 alpha≈14、身体 255（**alpha 平面确实被解码**），但显示合成阶段丢弃 alpha → 用户看到黑底；检测因此返回 false → chromaKeyMode 恒 false → 修复前黑底永远在（单测也测不出：纯逻辑测试 mock 不到 WebView2 的解码/显示分离） | ① 检测**去掉 hasAlpha 短路**，仅按显示层可观察信号判定：四角近黑占比 ≥30% → 启用色度键；② 抠像双策略（drawChromaKeyFrame 逐帧选）：帧自带 alpha → `applyAlphaKey`（alpha<192 置透明，背景≈14 被抠、**不透明黑色身体保留不受损**）；无 alpha（纯黑幕不透明素材）→ `applyChromaKey`（RGB≤12，OC-Claw 原案）；③ 调试通道注意：document.title 不同步到 frameless 窗口 HWND 标题（GetWindowText 读不到）、webview console.log 不进 tauri-plugin-log 的日志文件 → DOM 观测必须走 debug 构建 `additional_browser_args("--remote-debugging-port=9222")` + playwright connectOverCDP（或临时 hook）；④ 副作用不进 setState updater：检测（DOM 操作）移到 setState 外先算结果 | 2026-08-26 |
| 28 | **Windows 退出时加密落盘失败：SQLite 连接关闭后文件锁延迟释放 + 启动双解密竞争** | V-1 验收：安装包对话后正常退出，`%APPDATA%` 下明文 `spiritpal.db` 残留、无 `.enc`。根因①：beforeunload 直接 `invoke('encrypt_db_at_rest')` 时前端 DB 连接未关闭 → Rust `fs::remove_file` 被锁失败；②：启动时 Rust spawn 异步解密与前端 initDB `invoke('decrypt_db_at_rest')` **并发执行**（两个解密同时写 spiritpal.db） | 明文 DB 不落盘即安全缺口（记忆/聊天数据全裸）；退出时静默失败（Rust 侧 Err 被忽略）；排查发现启动解密实际被调用两次 | ① 加密前必须先关闭 SQLite 连接：前端 `encryptDatabaseAtRest()` 先 `Database.close()`（WAL checkpoint）再 invoke 加密；② Rust `RunEvent::ExitRequested` 加 **300ms 延迟**等前端 beforeunload 完成，加密/删明文均带重试（PermissionDenied → 100ms×5，`remove_file_with_retry`）；③ **加密失败保留明文不删除**（宁可明文不删也不丢数据）；④ 启动解密统一由前端 initDB 负责，移除 Rust spawn（消除双解密竞争）；⑤ 验收手法：安装包对话→正常退出→检查 `.enc` 生成且明文/-wal/-shm 无残留 | 2026-08-26 |
| 29 | **3 套角色包清单格式互不兼容 + Rust 命令未注册 → 导入器看起来有代码但永远空结果** | characterResourceImporter 调用 `scan_character_directory`/`read_text_file` 但 lib.rs invoke_handler 未注册 → `invoke` 静默 catch 返回 `[]`（importer L277-281）；同时 CharacterPackConfig / CharacterResourcePackage / PetMetadata 三套格式字段各异，任何导入器接 UI 都各说各话 | 路径 E（资源包导入）看起来完整实际永远空结果；SillyTavern 卡导入只返回 Partial 不持久化 → 重启后消失 | ① 新建 `lib/characterPack.ts` 统一解析中枢（parseCharacterPack 识别 3 种格式 → CharacterProfile）；② Rust 新建 `character_import.rs`（scan_character_directory + read_text_file，含路径穿越防护 + 1MB 限制）并注册到 generate_handler!；③ 新建 `lib/characterImportService.ts` 统一入口 `importCharacter(source)` 汇聚 JSON/PNG/目录导入 → parseCharacterPack → 持久化；④ 视频类型自动 chromaKey='auto'（与内置 gugugaga 一致） | 2026-08-26 |

---

## 📋 自进化修订记录表（AGENTS.md 进化史）

| 自进化版本 | 日期 | 触发原因 | 更新内容摘要 | 对应项目版本 | 已校验 |
|:---------:|------|---------|------------|:------------:|:-----:|
| v1.0 | 2026-08-10 | 初始建立自进化协议 | 从 SpiritPal 项目健康度评估报告建议补齐：建立自进化协议（5 条铁律 + 自检清单）+ 版本号 3 文件同步清单（package.json + Cargo.toml + tauri.conf.json）+ i18n 多语言规范（5 种语言 4 步流程）+ 4 个典型 SOP（新增 Tauri Command / 新增 Store / 新增宠物角色 / 新增设置）+ 10 条 Known Gotchas 集中化表格 | v1.0.0  | — |
| v1.1 | 2026-08-15 | S2 记忆存储架构重构补全 | 清理 enhancedMemory.ts 未使用导入（deleteMemorySummary/deleteMemoryState/FESTIVALS）；补全 S2 方案 §9 测试计划全部用例（迁移 4 场景/双模式回退/export-import 兼容/对账/corrupt 保留/行级 load-save/遗忘晋升行级化）共 32 例；全量回归 vitest 1494 通过 / tsc 0 错误 / eslint 0 错误 / cargo test 55 通过 | v1.0.0  | — |
| v1.2 | 2026-08-15 | 未完成任务清单 T-1~T-15 批量完成 | T-2 eslint warning 全项目清零；T-3 recallEngine 情绪一致性接入真实情绪（setCurrentMood + getCurrentMood 公开化）；T-4 semantic 容量配置生效（semanticSummaryMaxChars/semanticConsolidationMaxChars 替代硬编码 2000/5000）；T-1 ownerFacts.ts 二期行级化迁移（owner_facts 表 + 双模式回退 + .legacy 备份）；T-7 Agent 路径注入记忆上下文；T-8 响应式触发限流（canTriggerResponsive 每日上限共用配额）；T-9 contextFit 多信号化（工作状态 + 音乐信号）；T-10 响应判定语义化阈值 0.4；T-14 删除 timeDecaySort 死代码；T-15 文档同步；全量回归 vitest 1494 通过 / tsc 0 错误 / eslint 0 错误 / cargo test 全通过 | v1.0.0  | — |
| v1.3 | 2026-08-19 | 修复桌宠窗口交互问题（面板独立拖动 + 无边框窗口最大化/最小化/缩放） | 状态面板改为可独立拖动停靠（petStore.panelPosition 持久化 + 3px 阈值拖拽 + 拖拽期临时关闭像素穿透 + 顶部拖拽条 z-50→z-20 让位）；settings/chat 窗口补 capability 权限（minimize/maximize/unmaximize/toggle-maximize/start-resize-dragging）；appWindows.ts 前端创建路径 resizable: false→true + min 尺寸对齐 Rust 托盘路径；新增 Gotcha 14/15；同步修正「对应项目版本」为实际 0.1.0；vitest petStore 57 通过 / tsc 0 错误 / eslint 0 错误 | v0.1.0  | — |
| v1.4 | 2026-08-19 | 修复右键菜单无法滚动到底 + 核对菜单功能实现 | 右键菜单三重修复：max-height 改为视口自适应 `Math.min(420, winH-8)`（否则容器底部被 400px 宠物窗口裁剪）、容器 onWheel stopPropagation（否则滚轮被根节点缩放处理器吞掉）、菜单容器+遮罩加入像素穿透白名单（`[data-spiritpal-menu]`/`.spiritpal-menu-overlay`）；新增 Gotcha 16；逐项核对菜单 13 项功能（11 项真实、换装半实现、对话内容少）；tsc/eslint 0 错误 | v0.1.0  | — |
| v1.5 | 2026-08-19 | 补齐换装直达 + 核对设置页 19 页签 | 换装补齐：windowEventBus 新增 `open-settings-tab` 事件（类型安全注册），右键菜单「换装」→ 打开设置窗口并直达外观/装饰页（先发一次+窗口创建完成后 250ms 补发一次的双发保险，规避新窗口监听器注册时序）；SettingsWindow 的 TABS 提升为模块级常量并监听该事件校验切换；设置页 19 页签全量核对：17 项完整真实（AI/外观/性格/性格编辑/养成/商店/背包/记忆/成就/日程/模组/相册/数据/快捷/精灵图/通用/关于），排行=本地单机对比（非在线），社区=UI 完整但数据为内置 mock（communityApi 占位 URL 回退 mock，待接真实后端）；tsc/eslint 0 错误 | v0.1.0  | — |
| v1.6 | 2026-08-19 | 社区/排行改「尚未完善」提示 + 宠物窗口随尺寸自适应 | 新增 FeatureComingSoon 共享占位组件，CommunityPanel/LeaderboardPanel 重写为明确的「功能尚未完善」提示页（删除全部 mock 数据与伪交互，communityApi 模块保留未引用）；宠物窗口随宠物缩放自适应：handleWheel 计算目标窗口尺寸（精灵+32px 边距，保底 300×400，上限 720×900 对齐 Rust max_inner_size）→ setSize + 锚定（中心 X/底部 Y 不动），usePetDragging.snapToEdge 改用动态 outerSize（删除固定 WIN_W/WIN_H 常量，避免窗口变大后吸附边界错误）；vitest 1820 通过 / tsc 0 / eslint 0 | v0.1.0  | — |
| v1.7 | 2026-08-19 | Dororo 学习成果落地：实时边缘磁吸 + 比例阈值 + 贴边视觉反馈 | ① 拖动中实时磁吸：handleMouseMove 每帧 dockToEdgeSync（窗口中心距边缘 < 阈值即贴边，Dororo window.gd dock_to_edge 对齐）；② 比例阈值：max(40px, 窗口宽×20%)，窗口放大后吸附依然跟手，monitor.position 支持多显示器；③ 防卡屏：鼠标距窗口中心超过窗口尺寸时跳过吸附；④ 贴边视觉反馈：usePetDragging 暴露 dockDir（ref 去抖防高频 setState），PetWindow 加停靠变换层（宠物向窗外偏移 55% 藏身、悬停弹回 30% 探头）+ 停靠气泡「贴边休息一下～」；snapToEdge 释放后兜底复用同一套中心点+比例阈值逻辑；拖拽环境（窗口/屏幕尺寸）拖动开始一次性缓存避免高频 IPC；vitest 1820 通过 / tsc 0 / eslint 0 | v0.1.0  | — |
| v1.8 | 2026-08-19 | 学习报告盘点后落地两项：喂食渐进恢复 + 托盘实时图标 | ① 喂食渐进恢复（VPet 借鉴）：feed 立即生效 30%（FEED_IMMEDIATE_RATIO），剩余进 pendingHunger/pendingMood（NurturingStats 新增可选字段），applyPendingRecovery 纯函数每秒补剩余 1/10（至少 1 点），模块级 ensurePendingRecoveryTicker 定时器（幂等启动/自停，导出 stopPendingRecoveryTicker 供测试清理；注意 petStore.tick 是每小时衰减，不可用于渐进）；② 托盘实时图标（ai-bubu 借鉴）：新增 Rust command set_tray_icon_png（base64 PNG → Image::from_bytes 解码 → tray.set_icon，tauri image-png feature），前端 trayIconRenderer.ts 把宠物当前帧渲染为 32×32 PNG（图集按动画行+frame 裁剪、视频抓可见缓冲 video、SVG 直绘，精灵图资源缓存），SpriteRenderer 新增 onFrameChange 回调暴露帧号，PetWindow 每 3s + 状态/角色变化时 invoke 更新；vitest 1825 通过 / tsc 0 / eslint 0 / cargo check 0 | v0.1.0  | — |
| v1.9 | 2026-08-19 | 修复大尺寸下的两个问题：气泡被顶部裁剪 + 边缘吸附失效 | ① 边缘吸附失效根因：v1.7 用「窗口中心点」判定吸附，窗口半宽（150~300px）永远大于阈值（40~120px），吸附整体不触发——判定改为「窗口边缘距屏幕边缘 < 阈值」（dockToEdgeSync + snapToEdge 同步修正），中心点仅保留用于防卡屏；② 气泡裁剪：PetBubble 定位在宠物容器正上方（bottom-full），handleWheel 目标高度只按精灵+32px 计算导致放大后顶部仅 24px——新增 BUBBLE_TOP_SPACE(64) 预留气泡空间；新增 Gotcha 17/18；vitest 1825 通过 / tsc 0 / eslint 0 | v0.1.0  | — |
| v2.0 | 2026-08-19 | 吸附覆盖全部拖动路径（拖拽条/背景拖拽）+ 单元测试验证 | 用户反馈"贴边无吸附/无藏身探头"：新增 usePetDragging 单元测试模拟拖到屏幕边缘 → 窗口贴边 + dockDir='left' 断言通过（证明吸附判定本身工作）；根因是吸附只在「拖宠物本体」路径生效——顶部拖拽条（Tauri 原生拖拽）与背景拖拽层完全不触发磁吸/释放吸附。新增「窗口移动停止吸附」：usePetDragging 监听 win.onMoved，窗口 400ms 静止且非鼠标拖拽中 → snapToEdge（覆盖所有拖动路径，松手后自动贴边 + dockDir 视觉反馈）；vitest 1826 通过 / tsc 0 / eslint 0 | v0.1.0  | — |
| v2.1 | 2026-08-19 | 找到吸附不生效的真正根因：currentMonitor 实例方法不存在 | 端到端排查（Rust 临时加 remote-debugging-port + CDP + playwright 模拟拖拽 + 运行时 console 日志）：`(win as any).currentMonitor()` 抛 `TypeError: win.currentMonitor is not a function` → 环境缓存 catch 吞掉 → dragEnvRef 恒 null → 吸附永不触发（v1.7~v2.0 所有吸附版本都因此失效，单测 mock 掩盖）。修复：改用 @tauri-apps/api/window 顶层 `currentMonitor()` 函数（拖动环境缓存 + snapToEdge 两处），真实运行环境验证 env 缓存成功（450×600 物理 @ 2560×1600，sf=1.5）；新增 Gotcha 19；vitest 1826 通过 / tsc 0 / eslint 0 | v0.1.0  | — |
| v2.2 | 2026-08-19 | 吸附视觉改为「宠物本体对齐屏幕边」+ 窗口尺寸改逻辑像素 | 用户实测：吸附只对下边缘正常，左/右/上"宠物没到边缘就吸附"且现象怪——根因：吸附对齐的是「窗口」，宠物在窗口内位置不定（行走/缩放后居中），窗口贴边时宠物仍悬空。修复：dockTransform 从固定 55% 藏身偏移改为按 pos/winW/winH/sprite 尺寸计算的贴边对齐（left: translateX(-pos.x)，right: winW-pos.x-sw 等，悬停 poke 24px 探头）；winW/winH 从 outerSize 物理像素改为 ÷scaleFactor 的逻辑像素（顺带修正 sf≠1 时 S/M/L 档位判定与停靠计算的坐标错位）；vitest 1826 通过 / tsc 0 / eslint 0 | v0.1.0  | — |
| v2.3 | 2026-08-19 | 新增窗口边框预览（调试用） | AppSettings 新增 showWindowBorder（默认 false，持久化）；PetWindow 开启时渲染 inset-0 虚线边框 + 角落尺寸/缩放标签（pointer-events-none，不影响像素穿透与交互）；入口两处：右键菜单「窗口边框：开/关」+ 设置页通用 tab 开关；vitest 1826 通过 / tsc 0 / eslint 0 | v0.1.0  | — |
| v2.4 | 2026-08-19 | 窗口随宠物缩小（边框预览暴露的最小尺寸问题） | 用户反馈：宠物缩小时边框依然巨大（0.5× 时窗口仍 300×400）。根因：handleWheel 保底 WIN_W/H(300/400) + Rust min_inner_size 280×320 都过大。修复：新增 WIN_MIN_W/H(160×200) 对齐 Rust min_inner_size(160×200)，handleWheel 保底改小——窗口随宠物缩放（0.5× 时 160×200，1.0× 时 224×304，3.0× 时 608×720），边框贴合宠物；面板钳位 clampPanelPos/panelDisplayPos 改用动态 winH（替代固定 WIN_H）；吸附判定基于窗口边缘，窗口≈宠物后触发时机自然；vitest 1826 通过 / tsc 0 / eslint 0 / cargo check 0 | v0.1.0  | — |
| v2.5 | 2026-08-19 | 右键菜单适配小窗口 + 状态面板拆分为独立窗口 | ① 菜单溢出：宠物 0.5× 时窗口 160 宽 < 菜单默认 192 宽，菜单横向溢出被裁剪且覆盖宠物——adjustedPos 加 maxW = min(192, winW-8)，菜单随窗口收窄；② 面板分离：新增独立 panel-window（透明置顶小窗，216×176，index.html#/panel 路由 + PanelWindow 组件），显示角色状态（等级/心情/饱食/活力/金币）+ 聊天/设置按钮，标题行 data-tauri-drag-region 拖动、透明区像素穿透；PetWindow 移除窗口内 S 档状态栏与 M/L 档面板（含面板拖拽全套代码/winTier/DockStat），启动时创建面板窗口并每 2s 经 windowEventBus 'pet-stats' 同步状态；capabilities default.json windows 加 panel-window；vitest 1826 通过 / tsc 0 / eslint 0 / cargo check 0 | v0.1.0  | — |
| v2.6 | 2026-08-21 | README 文档问题全面修复 + AGENTS 同步修正 | README：消除「Git 分支说明」两段互相矛盾的内容，合并为单一准确的「本地 main + 远程 public」双分支策略（远端确有 public 分支）；修正目录树（去除不存在的 `Pet/spiritpal-app/` 外层包装，改为实际根目录布局）；AGENTS：同步 Tailwind 版本 v3.4→v4.2（`@tailwindcss/vite`，package.json 确认 `^4.2.2`）、窗口模型 3→4（新增 panel-window，capabilities 清单改为 `default.json`(+panel)/`chat-window.json`/`settings-window.json`） | v0.1.0  | — |
| v2.7 | 2026-08-22 | 状态面板窗口合并回宠物窗口 + 气泡驱动窗口自适应（用户反馈：状态栏与宠物窗口分离导致问题，要求单窗口 + 默认尺寸贴合 + 说话内容自适应） | ① 取消独立 panel-window：删除 PanelWindow 组件（回收站）、appWindows panel 配置、App.tsx /panel 路由、windowEventBus 'pet-stats' 事件与 PetStatsPayload、capabilities default.json 的 panel-window 条目；状态卡改为宠物窗口内嵌（右上角折叠胶囊 ↔ 完整卡片，含心情/饱食/活力/金币 + 聊天/设置入口，z-30 高于顶部拖拽条，data-spiritpal-panel 入像素穿透白名单）；② 默认窗口尺寸贴合宠物：Rust inner_size 300×400→224×304（1.0× 基准适配），前端挂载按持久化 petSize 校正（新纯函数模块 `lib/petWindowSizing.ts`：computeWindowSizeFor/computeBubbleWindowSize/computePetPosInWindow，15 个单测）；③ 气泡驱动窗口自适应：PetBubble 增加 measureRef，气泡出现时测量实际尺寸→窗口自动放大（锚定中心 X/底部 Y），关闭后恢复 max(放大前尺寸, 基准适配)（尊重手动放大）；滚轮缩放叠加气泡尺寸；拖拽时跳过；**第二轮修复（用户实测长文本仍被裁剪）**：根因=贴边停靠（onMoved 400ms 自动 snapToEdge 触发）时 dockDir 守卫静默跳过放大——移除 dockDir 守卫 + applyWindowSize 改贴边感知锚定（贴边固定对应屏幕边缘，未贴边保持中心 X/底部 Y），GetWindowRect 采样实测窗口 200→296→200 自动放大/恢复、底边锚定恒定；新增 Gotcha 20；全量回归 vitest 1868 通过 / tsc 0 / eslint 0 / cargo check 0 | v0.1.0  | — |
| v2.8 | 2026-08-22 | 宠物窗口三区布局（用户要求：对话顶中 + 状态左侧 + 右侧放右键菜单动作列表） | 平时收起只显示宠物（小窗）；悬停宠物/点击右上角胶囊展开三区面板，光标离开交互区 600ms 防抖收起（复用 usePixelClickThrough 新增的 onHoverInteractiveChange 回调，覆盖「从透明缝隙移出窗口」的 mouseleave 盲区）：① 顶部对话区=PetBubble 新 anchor='top-center'（窗口顶中，随内容自适应），收起态仍为贴宠物头顶气泡；② 左侧状态卡（名称/等级/心情/饱食/活力/金币 + 聊天/设置）；③ 右侧动作列表（摸摸/喂食/玩耍/洗澡/对话/番茄钟/截图/聊天/设置/切换角色/退出，喂食·番茄钟·切角色可内联展开）；④ petWindowSizing 新增 computePanelWindowSize（可选 actionsH/statusH 实测高度覆盖估算）+ 面板常量，面板打开/子菜单展开后 rAF 实测两栏高度校准窗口；⑤ 气泡 effect 模式感知（panelOpen 入依赖 + prevModeRef 跨模式强制重测）；面板两栏宽度改常量内联 style 保持尺寸单一来源；新增 Gotcha 21（eslint purity 判定漂移，showBubble 依赖补 setBubble + 按报错行逐个补豁免）；全量回归 vitest 1873 通过 / tsc 0 / 改动文件 eslint 0 | v0.1.0  | — |
| v2.9 | 2026-08-22 | 交互模型细化（用户四条规则：默认只显示宠物 / 右键展开右侧动作列表 / 对话区随说话自动显示 / 状态卡可配置显示位置） | ① 删除常驻胶囊与独立右键菜单：PetContextMenu 组件+测试移入回收站，右键宠物改为 handleContextMenu→handlePanelModeChange(true)（展开面板动作列表），Escape 改收起面板；② 顶部对话区（PetBubble anchor=top-center）移出 panelOpen 块常驻渲染——宠物说话时自动显示、窗口随内容自适应，收起态不再有贴宠物头顶气泡；③ 状态卡可配置：AppSettings/settingsStore 新增 statusCardMode: 'off'（默认）\| 'left' \| 'top-right'，动作列表新增「状态卡」子菜单（关闭/左侧/右上方）+ 换装/漫游/窗口边框三项补全（右键菜单功能全量迁移）；'off' 时默认只显示宠物（无胶囊无卡片），'top-right' 时收起态显示右上胶囊+展开态卡片右上方（动作列表下移，style top=statusHMeasured+10）；④ computePanelWindowSize 增加 statusMode 参数分三档计算（off=仅动作栏 160 宽 / left=左卡+右栏 342 宽 / top-right=右卡+其下动作堆叠 188 宽）；全量回归 vitest 1856 通过 / tsc 0 / 改动文件 eslint 0 | v0.1.0  | — |
| v2.10 | 2026-08-22 | 用户反馈修正：悬停展开严重影响使用（须立刻删除）；动作列表须与宠物并排右侧而非上下堆叠 | ① 删除悬停展开：移除 handlePanelMouseEnter/root onMouseEnter，handlePanelInteractiveChange 只保留「光标离开交互区防抖收起」（面板仅右键/右上胶囊触发展开，收起仍可自动）；② 面板布局改并排行：宠物与动作列表同排（'off'=宠物左+列表右 / 'left'=状态左+宠物中+列表右 / 'top-right'=宠物左+右侧状态卡与列表堆叠），新增 computePanelPetPos（行内垂直居中），重写 computePanelWindowSize 行布局公式（'left' 0.5× =444×302，'off' =262×302）；③ 对话区高度 state（dialogueZoneH）驱动动作列表/左状态卡随气泡下移（避免气泡遮挡卡片）；全量回归 vitest 1856 通过 / tsc 0 / 改动文件 eslint 0 | v0.1.0  | — |
| v2.11 | 2026-08-22 | 用户反馈：① 打开左侧状态卡后宠物被挤到边缘；② 边缘吸附太强（差不多到边缘就被强制吸附）；③ 状态卡左侧模式没有胶囊（不对称）；④ 命名统一为左侧/右侧（去掉"上方"） | ① 行走范围面板感知：根因=usePetBehavior 行走目标硬编码 `WIN_W=300`，面板展开（窗口 444 宽）后宠物仍走向 x∈[8,100] 被"挤"到状态卡后面——新增 getWalkBounds 注入（面板展开时返回列间缝隙，区间 <24px 跳过行走改 idle；收起态 null 用默认），修复"宠物被挤到边缘"；② 吸附阈值收紧：DOCK_THRESHOLD_RATIO 20%→8%、MIN_PX 40→16（仅真正贴边才吸附）；③ 胶囊双模式：收起态胶囊在 statusCardMode≠'off' 时都显示（left=左上/right=右上），点击展开面板；④ 命名统一：'top-right'→'right'（标签「右上方」→「右侧」），类型/尺寸函数/测试同步；新增 Gotcha 22；全量回归 vitest 1859 通过 / tsc 0 / 改动文件 eslint 0 | v0.1.0  | — |

| v2.12 | 2026-08-22 | 上帝视角评审后全量修复：文档与现实同步 + 死代码清理 + 权限最小化 + 行走范围彻底修复 + 构建脚本化 | ① **文档同步**：修正 AGENTS.md 虚假声明——`forbid(unsafe_code)` 实际不存在（get_mouse_pos 含 unsafe 块）、偏好设置实为明文 localStorage（非 secureStore 加密）、command 数 12→30、Rust 测试 32→105、lib 模块 13→159；② **死代码清理**：petStore.panelPosition/setPanelPosition（v1.3 遗留无消费者）与其测试、communityApi 模块+测试（未引用占位）删除；③ **capabilities 最小化**：default.json 移除前端未使用的 global-shortcut 4 项（22→18；store/sql/notification/dialog 均被 pet 窗口实际使用保留）；④ **行走范围彻底修复**：收起态改用实际窗口宽（computeWalkBounds 纯函数，修复 1.0×/3.0× 宠物只走左半区残留），展开态返回列间缝隙，6 个新单测；⑤ 新增 `scripts/build-win.ps1`（构建+产物替换+进程锁处理脚本化）；全量回归 vitest / tsc / eslint / cargo 全过，生产构建通过 | v0.1.0  | — |
| v2.13 | 2026-08-22 | 用户反馈：漫游功能被限定在窗口内来回走（实为 CSS 假动画）；边缘吸附需开关 | ① **真桌面漫游**：RoamWindow 重写——漫游窗口铺满主屏（appWindows 按主显示器逻辑尺寸创建、透明点击穿透），宠物按随机目标点全屏行走（水平为主+35% 纵向，30% 概率休息 1.5~4s），悬停停下冒泡、移开继续、右键返回窗口形态；删除 index.css 的 spiritpal-roam CSS 假动画（16s 窗口内 4%↔84% 往返）；② **边缘吸附开关**：AppSettings/settingsStore 新增 edgeSnapEnabled（默认 true），usePetDragging 的 dockToEdgeSync/snapToEdge 按开关门控（关闭则不贴边、dockDir 复位），面板动作列表新增「边缘吸附」切换项；全量回归 vitest 1833 通过 / tsc 0 / eslint 0 | v0.1.0  | — |
| v2.14 | 2026-08-24 | 用户反馈：漫游开启后其他功能全部丧失——漫游模式应能同时使用其他功能（右键交互/状态卡/对话等） | ① **面板小组件抽取共享**：PetWindow 的 ActionButton/ActionRow/StatRow/tierColor 移至新文件 petPanelParts.tsx（纯展示组件，窗口/漫游两形态复用，PetWindow 改 import）；② **漫游内补全交互**：RoamWindow 重写——右键宠物展开动作列表（摸摸/喂食/玩耍/洗澡/对话/番茄钟/截图/聊天/设置/换装/切角色/状态卡/回到窗口/退出），点击宠物摸头反馈，面板打开时行走暂停（interval 跳过 + onMouseLeave 恢复），移出交互区 600ms 防抖收起（复用 usePixelClickThrough 回调 + Escape 兜底），交互气泡与悬停提示合并显示（bubble ?? 悬停文案），动画状态 animOverride 覆盖行走（eat/happy/pet 后恢复）；③ **漫游面板定位**：petWindowSizing 新增 computeRoamPanelLayout 纯函数（跟随宠物坐标、右缘放不下自动左移、垂直中线对齐 + 屏幕钳位、'left' 并排/'right' 堆叠尺寸公式，7 个新单测）；④ **capability 缺失修复（本次关键）**：roam-window 不在任何 capabilities 文件 → 窗口内 getAllWindows/hide/show/事件监听全被拒（"连退出都无法操作"根因），新增 src-tauri/capabilities/roam-window.json（最小权限：窗口显隐/聚焦/创建/枚举 + monitor 查询 + event，无 store/sql/notification），cargo check 通过；⑤ 像素穿透白名单加 `[data-spiritpal-roam-*]`（面板/状态卡/对话面板不穿透，透明区仍可点桌面）；⑥ 新增 RoamWindow 组件测试 9 例（右键展开/回到窗口/点击摸头/摸摸气泡/喂食子菜单/防抖收起/交互态保持/Escape）；⑦ **运行时黑盒验证（真实 exe）**：鼠标模拟进入漫游成功（roam 全屏 0,0,1722,1076）；临时自动钩子验证 roam-window 内 switchPetForm('window') 2s 自动执行成功 → **roam IPC（getAllWindows/hide/show）运行时生效确认**，钩子已移除；新增 Gotcha 23（渲染期读 ref + useCallback setter deps）/ Gotcha 24（新窗口必须配 capability）/ Gotcha 25（CDP additional_browser_args 导致同 userData 新窗口创建失败）；全量回归 vitest 1849 通过 / tsc 0 / 改动文件 eslint 0 / cargo check 0，release 安装包重建 + artifacts 替换（旧版备份 backup-20260824/） | v0.1.0  | — |
| v2.15 | 2026-08-25 | 用户否决 v2.14 的独立漫游窗口方案："不能为了漫游功能重复造轮子""漫游应与其他页面一样、能拖动" | ① **漫游改为主窗口全屏化（彻底删除独立漫游窗口）**：switchPetForm('roam') = pet-window 放大铺满主屏 + setPosition(0,0)（进入前快照存内存 roamRestoreRef），'window' = 还原快照/无快照按 petSize 恢复居中偏下——界面/右键面板/状态卡/聊天/设置/气泡全部复用 PetWindow 现有逻辑，不再有独立 RoamWindow 页面；② **usePetDragging 加 roamMode**：漫游拖拽 = 移动宠物精灵 pos（窗口内逻辑坐标，物理位移/sf 换算 + 屏幕钳位）而非窗口 setPosition，禁用 dockToEdgeSync/snapToEdge/startSnapPolling 窗口静止吸附/onMoved 吸附（松手停原地，与窗口形态一致）；③ **PetWindow 漫游分支**：isRoam 时窗口锁全屏——气泡自适应/滚轮缩放/面板展开收起/启动尺寸校正全部跳过 applyWindowSize（气泡只驱动 dialogueZoneH），背景拖拽/顶部拖拽条/FramelessResizeHandles 禁用（防破坏全屏），位置持久化跳过（防全屏坐标污染 petStore），Escape 收起面板后再次按 = 退出漫游，退出漫游 effect 重置宠物位置到小窗内；行走范围 getWalkBounds 用实时窗口尺寸（全屏）→ 宠物全屏自动走动（复用 usePetBehavior，无需独立行走逻辑）；④ **删除**：RoamWindow.tsx + App.tsx /roam 分支 + appWindows roam-window 配置 + capabilities/roam-window.json + computeRoamPanelLayout 及 16 个相关测试（RoamWindow 9 例 + sizing 7 例）；⑤ 新增 petForm.test.ts 4 例（全屏化/还原快照/无快照恢复/快照重记录）；新增 Gotcha 26（vi.mock 工厂引用顶层 const 的 hoisting TDZ 坑）；全量回归 vitest 1833 通过 / tsc 0 / 改动文件 eslint 0，release 安装包重建 + artifacts 替换 | v0.1.0  | — |
| v2.16 | 2026-08-25 | 用户否决 v2.15 的全屏化漫游："开启漫游会产生一个全屏窗口，导致屏幕上任何东西点击都无法正常使用……需要重构。先搜索借鉴市面桌宠漫游做法" | ① **调研结论（Dororo A.5 + shimeji 等主流桌宠）**：漫游 = 透明小窗口在桌面移动（窗口跟随宠物），**绝无全屏窗口方案**——全屏窗口必然遮挡桌面点击（像素穿透不可靠）；② **v2.16 漫游 = 窗口在桌面移动**：撤销 v2.15 全屏化（usePetDragging 恢复 v2.13 原版、petForm 恢复仅持久化、PetWindow 全部 isRoam 分支回退），**新增「漫游行走控制器」**（PetWindow effect，借鉴 Dororo move.gd）：进入漫游后 interval 驱动窗口 setPosition 向屏幕内随机目标移动，移动中 petState='walk'+facing 朝向目标，到达后 30% 休息 1.5~4s；**交互优先（Dororo move_lock）**：拖拽中/面板展开/鼠标悬停宠物时暂停行走；③ 漫游时 getWalkBounds 返回 0 区间（禁用 usePetBehavior 窗口内行走）；退出漫游（Escape 或面板）→ effect 清理、行走停止、窗口停原位；④ 窗口保持小窗 → 窗口外就是桌面天然可点，右键/面板/状态卡/聊天/拖拽全部沿用窗口形态逻辑（拖拽=拖窗口，与窗口形态一致）；⑤ **后续用户反馈修复**：面板「漫游」项加开/关状态显示（`漫游：开/关`）并支持点击切换（此前无开关标识用户不知状态）；**鼠标漂移修复**——行走目标随机点避开鼠标屏幕坐标（距离 ≥200px，最多重试 8 次，宠物不主动走到鼠标下），移动 IPC 频率减半（33ms→66ms/帧、步进 3→6px 保持 ~90px/s）；行走目标范围考虑窗口尺寸（窗口整体保持在屏幕内且距边缘 ≥40px，防面板展开窗口变宽时超屏/贴边吸附）；⑥ petForm.test 重写 4 例（仅持久化）；运行时验证（真实 exe）：漫游窗口小窗持续移动（5 采样位置全不同）、退出后停止；全量回归 vitest 1837 通过 / tsc 0 / eslint 0 error，release 重建 + artifacts 替换 | v0.1.0  | — |
| v2.17 | 2026-08-26 | 用户反馈：咕咕嘎嘎按住出现黑边——色度键未生效根因定位与修复（运行时 CDP 逐像素取证） | ① **根因**：`detectVideoChromaKeyNeed` 的 hasAlphaChannel 短路在 WebView2 上必然误判——canvas getImageData 能读到 VP9 alpha 平面（透明区 alpha≈14、身体 255），但**显示合成阶段丢弃 alpha** → 黑底可见；「有 alpha」≠「显示正常」，检测恒返回 false → chromaKeyMode 恒 false（此前单测/静态分析均无法发现：纯逻辑 mock 不到解码/显示分离）；② **修复**：检测去掉 hasAlpha 短路，仅按四角近黑 ≥30% 判定（显示层可观察信号）；`drawChromaKeyFrame` 双策略——帧自带 alpha → 新增 `applyAlphaKey`（alpha<192 置透明，背景≈14 被抠、不透明黑色身体保留不受损，避免 RGB 抠像打穿企鹅黑身体），无 alpha 纯黑幕素材 → 保留 `applyChromaKey`（RGB≤12，OC-Claw 原案）；`maybeDetectChromaKey` 检测移出 setState updater（DOM 副作用不进 updater）；③ **运行时验证**（debug 构建 + `additional_browser_args("--remote-debugging-port=9222")` + playwright connectOverCDP）：切到咕咕嘎嘎后 canvas 出现、四角 (0,0,0,0) 全透明（cornerTransparent=1.0）、中心身体 (156,150,149,255) 不透明；videos 全部 hidden；drag 态同验证；④ 新增 Gotcha 27（含调试通道教训：document.title 不同步 frameless 窗口标题、webview console.log 不进日志文件）；全量回归 vitest 1853 通过（+10 skipped）/ tsc 0 / eslint 0 error / cargo check 0；release 重建 + artifacts 替换（pre-fix 版备份 artifacts/backup-20260826/） | v0.1.0  | — |
| v2.18 | 2026-08-26 | 任务清单交接 AI 执行收官（V-1 加密落盘 + P0 功能 + 核实类），主会话复核 | ① **V-1 加密落盘修复**：`encrypted_db.rs` 文件读/删带重试（Windows SQLite 文件锁延迟释放，PermissionDenied 100ms×5）、加密失败保留明文不删、Rust `ExitRequested` 加 300ms 延迟等前端 beforeunload close DB、启动解密统一由前端 initDB invoke（移除 Rust spawn 双解密竞争）；前端 `db.ts` beforeunload 改为先 `Database.close()`（WAL checkpoint）再加密；② **2.1 视觉感知「看看」**：ChatWindow 检测「看看屏幕/你看看」关键词 → 截屏分析注入上下文；③ **2.2 记忆时间线索引**：`searchEpisodic/retrieve` 支持 timeRange 过滤、新增 `getMemoryTimeline`（日/周/月聚合）与 `getMemoriesByTimeRange`、TimeDensityChart 支持点击月份筛选（+13 测试）；④ **2.3 动画多级回退**：视频加载失败 → idle 视频 → 图集（fallbackToAtlas）；⑤ **2.4 隐藏互动**：PetState 新增 `hide`，usePetBehavior 贴边 5% 概率触发，宠物缩小 60% + 透明度 0.3，素材缺失回退 idle（types/animationConfig/animationFallback/trayIconRenderer/SpriteRenderer/Live2DRenderer/usePetBehavior/PetWindow）；⑥ **4.1~4.4 核实**：eslint 0 error（78 warning 均为既有未使用变量）、移动端轻量 UI 无需同步、e2e.yml 描述修正、Sentry 为 Mock 模式确认；⑦ 全量回归 vitest 1866 通过（+10 skipped，较 v2.17 +13）/ tsc 0 / eslint 0 error / cargo check 0；新增 Gotcha 28；6 批提交（fix-rust-encryption / feat-memory 时间线 / feat-animation 回退+hide / feat-pet-window 看看+hide 触发 / feat-memory-viz 时间密度图 / docs）；**跳过待决策**：2.6 自定义角色导入优化、2.7 社区/排行真实后端；主会话复核：提交/代码/回归数字全部属实，AGENTS 版本递增与修订记录由主会话补录 | v0.1.0  | — |
| v2.19 | 2026-08-26 | 任务 2.6：自定义角色导入优化（P1-1~P2） | ① **P1-1 统一清单格式与加载中枢**：新建 `lib/characterPack.ts`，`parseCharacterPack()` 统一解析 3 套格式（CharacterPackConfig / CharacterResourcePackage / PetMetadata）→ CharacterProfile，自动检测格式 + 字段映射 + 缺失默认值 + 视频自动 chromaKey='auto'；删除死代码 `CustomPetForm.tsx`（364 行，全项目无引用）；CharacterCreator 死 UI「自定义动画行」移除（customAnimRows 不写回 atlasLayout）；29 个单测（3 种格式 × 字段映射 + 边界 + JSON 便捷封装）；② **P1-2 接线现有导入器 + 修 Rust 命令**：Rust 新建 `character_import.rs`（scan_character_directory + read_text_file，含路径穿越防护 `..` 拒绝 + 1MB 限制 + 6 个 Rust 单测）并注册到 `generate_handler!`（desktop + non-desktop 两条路径）；前端新建 `lib/characterImportService.ts` 统一入口 `importCharacter(source)` 汇聚 JSON/PNG/目录导入 → parseCharacterPack → saveCustomCharacter 持久化，SillyTavern 卡回退 + Partial→完整 profile 补全；14 个单测（JSON 字符串/文件/PNG/目录/边界）；③ **P1-3 导入向导 UI**：新建 `CharacterImportWizard.tsx` 组件（拖拽 JSON/PNG + 目录选择 + 预览 + 错误/警告逐条显示 + 立即使用按钮），SettingsWindow 角色页新增「导入角色」按钮入口；i18n 5 语言同步 9 个新 key；6 个组件测试；④ **P2 素材管线对接**：Rust 新建 `asset_pipeline.rs`（detect_asset_tools 检测 python/ffmpeg + run_asset_pipeline 白名单执行 + 参数强校验防注入），16 个 Rust 单测（白名单拒绝/shell 元字符注入/路径穿越全拒绝）；⑤ 全量回归 vitest 1915 通过（+10 skipped，较 v2.18 +49）/ tsc 0 / eslint 0 error（2 warning 已修）/ cargo check 0；新增 Gotcha 29 | v0.1.0  | — |
| v2.20 | 2026-08-26 | 任务 2.6 P3 打磨收尾 + 依赖修复 | ① **P3 全量回归**：vitest 1915 passed / 10 skipped（0 failed）/ tsc 0 error / eslint 0 error / 79 warning（既有未使用变量）/ cargo check 0；② **依赖修复**（`d419c14` 提交意外删除多个测试依赖）：补回 `@testing-library/jest-dom` `@testing-library/react` `jsdom` `sql.js` `playwright`；升级 `eslint-plugin-react-hooks` v5→v7（v7 含 purity/immutability 规则，v5 缺失导致 eslint-disable 注释引用不存在规则报 12 error）；修复 `ttsEngine.test.ts` 缺少 `URL.createObjectURL` mock（jsdom 不支持）；③ **出包**：`pnpm tauri build` 成功 → artifacts 替换（setup 23.5MB / portable 18.9MB），旧版备份 artifacts/backup-20260826-p3/ | v0.1.0  | — |
| v2.21 | 2026-08-27 | MLOps 评估报告全量改进落地（P0-P3） | ① **P0-1 LLM 输出质量自动评估**：新建 `lib/qualityMonitor.ts`（隐式反馈信号 + 启发式评分 + LLM-as-judge），13 个单测；② **P0-2 Sentry 真实接入**：重写 `lib/sentry.ts`（动态加载 @sentry/react + Mock 降级 + 本地错误日志 localStorage 持久化 + PII 脱敏），12 个单测；③ **P1-1 Prompt 版本管理**：新建 `lib/promptRegistry.ts`（9 个 Prompt 集中定义 + 版本号 + 变更日志），aiAgent/llmClient/memorySummarizer/proactiveSpeak/characterCardImporter/visionPerception 7 个文件硬编码 Prompt 全部替换为 `getPrompt()` 调用，11 个单测；④ **P1-2 灰度发布**：新建 `lib/gradualRollout.ts`（确定性哈希灰度判定 + 配置覆盖 + 回退），11 个单测；⑤ **P1-3 Agent 工具参数 Zod schema 校验**：新建 `lib/toolParamValidator.ts`（7 个工具 Zod schema + shell 注入防护 + 路径穿越防护 + 长度限制），24 个单测；⑥ **P2-1 延迟 SLO + 自动降级**：新建 `lib/latencySLO.ts`（P95 阈值降级 + hysteresis 设计 + 3 级降级），8 个单测；⑦ **P2-2 记忆质量校验**：新建 `lib/memoryQualityCheck.ts`（关键词覆盖率 + 语义相似度 + 信息密度 + 幻觉检测），6 个单测；⑧ **P2-3 毒性过滤**：新建 `lib/toxicityFilter.ts`（本地毒性关键词黑名单 + PII 脱敏 + 控制字符清除 + 3 级严重程度），10 个单测；⑨ **P3-1 僵尸代码清理**：`modelHotLoader.ts` 移入 `docs/_devarchive/`；⑩ **P3-2 AGENTS.md 同步**：settingsStore 加密描述更新（H-1 修复后已接入 encryptedStorage）；总计 95 个新单测全通过 | v0.1.0  | — |
| v2.22 | 2026-08-27 | 安全与合规体系完整性落地（安全评估报告全量改进 H-1~L-1） | **高优先级**：① H-1 settingsStore 明文 localStorage → AES-256-GCM 加密持久化（encryptedStorage.ts 适配器 + 11 测试）；② H-2 SRI verify_integrity 落地实际校验（读取 dist/assets/ 文件计算 SHA-256 对比嵌入哈希）；③ H-3 Sentry Mock → 真实 SDK 动态加载（RealSentryHub Proxy）；④ H-4 审计日志模块（audit_log.rs 哈希链 + auditLogger.ts + 6 Rust 测试）；⑤ H-5 CodeQL 矩阵增加 Rust；**中优先级**：⑥ M-1 STRIDE 威胁建模文档（19 威胁）；⑦ M-2 静默 catch 块修复（swallowedCatch.ts 工具 + 6 处修复）；⑧ M-3 Dependabot 配置；⑨ M-4 Git Fork 评估报告；⑩ M-5 SBOM 生成 CI（CycloneDX）；⑪ M-6 漏洞响应 SLA 文档；⑫ M-7 pet-window capability 精简（移除 store/sql/notification/dialog）；⑬ M-8 PBKDF2 salt 随机化（OS CSPRNG 替代确定性派生）；**低优先级**：⑭ CSP connect-src 收紧（通配 https: → 7 个已知 LLM API 域名白名单）；回归 vitest 2025 passed / cargo test 全通过（133）；新增 Gotcha 30~32；5 批 Git 提交 | v0.1.0  | — |
| v2.24 | 2026-08-27 | UX 设计体系成熟度评估报告全量改进落地（H-1~M-6） | ① H-1 统一设计令牌：合并三套并行 CSS 变量（--color-* / --pet-* / --color-primary）为单一语义令牌体系，--pet-* 和 --color-primary 统一映射到 --color-* 主令牌；② H-2 创建 components/ui/ 基础 UI Kit（BrandButton/BrandSwitch/BrandSlider/BrandSelect/BrandInput，全部使用语义 Token + WCAG 可访问性）；③ H-3 设置页信息架构重构：19 个平级 Tab 分组为 4 大类别（基础/养成/高级工具/关于）；④ H-4 PetBubble 硬编码颜色修复（bg-white→bg-surface, text-gray-800→text-ink）+ spiritpal-pet-voice 字体；⑤ H-5 空 catch 块修复：PetWindow/WindowControls/FramelessChrome/SpriteRenderer/ChatWindow 共 12 处 .catch(()=>{}) 替换为 swallowedCatch(context)；⑥ H-7 可访问性：ink-faint 对比度提升（#b3a18c→#9d8a72 WCAG AA）、PetBubble 添加 role=status + aria-live=polite、移除全局 user-select:none 改为限定交互装饰元素；⑦ M-1 首次引导增强：角色确认后衔接 AI 配置引导提示（不阻断可跳过）；⑧ M-2 数据出境弹窗布局修复：复选框移到按钮上方避免误触；⑨ M-3 AI 配置表单优化：温度滑块加刻度标注（精确/平衡/创意）+ API Key 加可见性切换 + 模型选择统一为 BrandSelect；⑩ M-4 移动端功能对齐：补齐记忆 Tab 入口（MobileMemoryView.tsx）；⑪ M-6 UX 关键路径埋点：新增 7 个事件类型（firstrun_complete/skip, error_occurred, panel_open/close, roam_toggle, edge_snap_toggle）；⑫ L-1 CI 性能测试已集成（perf-baseline + perf-stress job）；i18n 5 语言同步新增 settings.group.* 和 firstrun.ai_hint_* 共 13 个 key；回归 tsc 0 error / eslint 0 error（747 warning 均为既有）/ vitest 2115 passed（3 failed 为 dirtyDataTracker 预存问题）；5 批 Git 提交 | v0.1.0  | — |
| v2.23 | 2026-08-27 | 幻影引用审计整改（家族规范治理 Phase A · T2，触发原因 = 幻影引用审计） | ① **模块清单表 4 处路径改真**（RETARGET）：Rust 表 db.rs 行改指 encrypted_db.rs（并按文件级 at-rest 加密真实职责改写描述）；前端表 chatService.ts 行改指 dataManager.ts + db.ts；stores 表 windowStore.ts 行如实标注「Zustand store 尚未实现」，实际承担者改指 windowManager 单例（不再虚构 setPetWindowPos/toggleChatWindow）；errorBoundary.tsx 行改指 App.tsx（ErrorBoundary 为内联类组件，兜底页按实际「SpiritPal Error」卡片改写）；② **Live2D 模型幻影删除**：SOP-3 增加显式前置条件块（本仓不内置模型资产），步骤 1/3 具体 miko 路径改 `<model>` 占位模板；③ **假 workflow 纠正**：独立 e2e workflow 幻影改述为 ci.yml 内 `e2e` job（name: E2E Tests (Playwright)，参与 PR CI，5 个 spec 实测存在），§7 命令表同步；④ **死链修复**：学习成果落地分析报告.md 开发经验教训链接改指 docs/reports/ 子目录 | v0.1.0  | — |
| v2.25 | 2026-08-27 | 产品管理体系完整性诊断报告全量改进落地 | ① **P0-1 指标看板脚本**：新建 `scripts/generate-metrics-dashboard.mjs`，读取埋点 localStorage 数据生成本地 HTML 看板（DAU/交互/对话/崩溃率/番茄钟/模组/形象切换 + 每日趋势 + 分布饼图），支持 JSON 文件/管道/环境变量三种输入，package.json 新增 `metrics:dashboard` script；② **P0-2 A/B 测试埋点接入**：analytics.ts 新增 `experiment_variant` 事件类型 + `trackExperimentVariant()` 函数，gradualRollout.ts `getRolloutOverrides()` 自动记录灰度判定结果到埋点系统，补齐价值验证闭环；③ **P1-1 需求追溯标签体系**：新建 `docs/project/requirements-traceability.md`（@req/@see 标签格式 + 需求 ID 命名规则 + 试点文件），E2E spec（smoke/app-loading/pet-interaction）已添加 @see 试点标签；④ **P1-2 变更管理流程**：新建 `docs/project/change-management.md`（A/B/C 三类变更 + 影响评估模板 + 与 AGENTS.md 自进化协议对接）；⑤ **P1-3 DoD 定义**：新建 `docs/project/definition-of-done.md`（7 类检查清单 + Full/Lite/Hotfix 三级 DoD）；⑥ **P1-4 用户反馈渠道**：SettingsWindow 关于页新增「反馈与建议」入口（Bug/功能建议/讨论区），新建 `.github/ISSUE_TEMPLATE/bug_report.yml` + `feature_request.yml`；⑦ **P2-1 需求索引**：新建 `docs/project/requirements-index.md`（PRD 24 章节结构化索引 + 模块化拆分建议）；⑧ **P2-2 优先级论证表**：新建 `docs/project/priority-justification.md`（MoSCoW 决策依据 + 假设验证跟踪表）；⑨ **lint 修复**：memoryRecommendation.ts/webglWorker.ts 剩余 eslint error 清零；回归 tsc 0 / eslint 0 error（745 warning 均为既有）/ vitest 2119 passed（+10 skipped）/ cargo check 0；5 批 Git 提交 | v0.1.0  | — |

| v2.26 | 2026-08-27 | **家族规范完整性审计（Phase B · B4）：自进化协议打补丁（第 6 条铁律 + 修订表已校验列）** | ① 新增第 6 条铁律「证据绑定（Evidence Binding）」：可执行路径必须当时可验证存在、未实现项须显式标注、禁止虚构 CI 门禁；② 自检清单追加两项：路径真实存在校验（跑 `python scripts/check_spec_refs.py`）与 pre-commit 双向一致校验；③ 修订记录表增加「已校验」列，历史行统一填 `—`（未校验），新条目须填 `✓ (check_spec_refs)` 或 `✗`；④ 本仓新增 `scripts/check_spec_refs.py` 家族审计 wrapper 与 `.github/workflows/docs-consistency.yml`（本地/含审计器环境强校验，纯 CI 环境找不到审计器时降级跳过保持绿）。本行即首个填写「已校验」的条目 | v0.1.0| ✓ (check_spec_refs) |

<!-- 🔄 下次更新 AGENTS.md 时，在上面表格末尾追加新一行，不要删除历史记录 -->

## 📂 文件归档与放置规范（重要：新增文件必须遵守）

> 本仓库目录已于 2026-08-23 系统整理（见 `docs/整理记录_20260823.md`）。后续任何新增/生成文件，**先判断类型再放置**，不要随意丢在仓库根目录或其他位置。

**docs/ 分类（项目文档）**
- `docs/project/`：需求(PRD)、架构、API、技术选型、设计上下文
- `docs/plans/`：实施计划、路线图、指南(Guide)、待办(TASKS)
- `docs/reports/`：评估/审计/安全/测试/优化报告、Lessons
- `docs/repo-analysis/`：仓库学习报告（命名 `{仓库名}_技术学习报告.md`）
- `docs/_devarchive/`：历史/一次性开发产物、交接方案、旧版本文档（**归档而非删除**）

**根目录只允许放置**
- 标准仓库文件：README、LICENSE、CHANGELOG、AGENTS、SECURITY、PRIVACY_POLICY、CONTRIBUTING
- 构建与配置：package.json、pnpm-*.yaml、tsconfig*.json、vite.config.ts、vitest.config.ts、playwright*.config.ts、eslint.config.js、stryker.config.json、.env(.example)、.npmrc/.prettier*、index.html、启动脚本(install/start)
- 明确被 build/CI 或文档要求从根目录运行的工具

**禁止事项（防止回归混乱）**
- ❌ 一次性调试脚本/截图/日志/草稿 → 放 `scripts/` 或 `docs/_devarchive/`，绝不堆在根目录
- ❌ 文档散落到 src/tests/perf 等业务目录 → 归入 `docs/` 对应分类
- ❌ 移动/删除 gitignored 运行时产物（`tsconfig.tsbuildinfo` 等）
- ❌ 删除旧版本文档 → 需要留档移入 `docs/_devarchive/`

> 本仓库特别说明：`docs/repo_research/` 是克隆的第三方仓库源码，属研究资料，**不**归入文档分类；
> PRD v0.1/v0.2、记忆系统各轮评估等版本文档保留在原分类（未删除）。
> 新增文件前若不确定归属，先询问，不要自作主张放置。
