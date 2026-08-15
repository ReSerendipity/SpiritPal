# SpiritPal AGENTS.md — AI 辅助开发指南

> 🧬 **自进化协议版本**：v1.2  
> 📅 **最后更新日期**：2026-08-15  
> 🎯 **对应项目版本**：v1.0.0（闭源）

---

## ⚠️ 🤖 Agent 行为契约（自进化协议 · 必须严格遵守）

AI Agent 打开本文件后的 **第一件事** 是执行下面的「🧪 自进化自检清单」，并遵守以下 5 条铁律：

### 🔴 5 条自进化铁律
1. **🔄 同步规则（Synchronize First）**：如果发现项目实际情况（目录结构、依赖版本、技术栈、配置文件名等）与本文件描述 **不一致** → **立即更新本文件**，不要只改代码不改 AGENTS.md。这是最高优先级的规则。
2. **📝 坑点累积（Gotchas Accumulation）**：每次修复 Bug / 踩坑后（哪怕是很小的坑），**必须** 追加一条到第 14 节「常见陷阱（Known Gotchas）」，写清楚：触发场景、现象/报错、正确做法、首次发现日期。
3. **📚 SOP 累积（SOP Accumulation）**：每次完成一个「本文件现有 SOP 没覆盖」的典型开发任务后，**必须** 把步骤整理成新 SOP 追加到第 13 节「典型 AI 开发场景 SOP」。
4. **✅ 自检流程（Self-Check on Startup）**：每次打开本文件准备工作前，**必须** 先运行下面的「🧪 自进化自检清单」，逐项核对，有任何一项不符先修正 AGENTS.md 再干活。
5. **🏷️ 版本递增（Version Increment）**：每次更新本文件内容后，**必须** 做三件事：① 文件顶部「自进化协议版本号」+0.1（小改）或 +1.0（大改/框架调整）；② 更新「最后更新日期」；③ 在文件末尾「📋 自进化修订记录表」追加一行记录。

### 🧪 自进化自检清单（每次启动工作前必跑）
- [ ] 目录结构（`src/`、`src-tauri/`、`components/`、`stores/`、`hooks/`、`lib/`）是否和第 3 节模块边界描述一致？
- [ ] 3 个窗口配置（pet-window / settings / chat）是否和 `lib/windowManager.ts` 实际配置一致？
- [ ] 上次工作是否踩了新坑？如果是，是否已追加到第 14 节 Known Gotchas？
- [ ] 修改了 Rust Tauri command 后，是否已在前端对应调用处更新了类型签名？
- [ ] 是否改了 package.json / Cargo.toml / tauri.conf.json 的版本号？如果改了一个，是否 3 个都同步（见第 10.2 节）？
- [ ] 上次更新是否正确递增了自进化协议版本号 + 追加了修订记录表？

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
| 样式方案 | TailwindCSS v3.4（JIT）+ CSS Variables | 颜色/圆角/阴影 100% Token 化，不许硬编码 `#ff6b6b` |
| 国际化（i18n） | react-i18next v15 | 5 种语言：中/繁/英/日/韩，翻译文件：`public/locales/<lang>/translation.json` |
| 包管理 | **pnpm 9**（shamefully-hoist = true） | 严禁 npm/yarn，node_modules 结构和 lockfile 会不兼容 |
| 前端构建工具 | Vite 6.x + @tauri-apps/cli 插件 | `vite.config.ts` 已配 Tauri dev server 代理 |
| Rust 后端工具链 | MSRV 1.80+ | `rust-toolchain.toml` 已锁 1.80 stable，cargo workspace 单包模式 |
| Rust 加密生态 | AES-GCM（aes-gcm crate）+ Argon2（argon2 crate）+ Tauri secureStore | 所有敏感数据：聊天记录、宠物档案、偏好设置 **全链路加密** |
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
- **`#![forbid(unsafe_code)]`**：`src-tauri/src/lib.rs` 顶部已加。除非调用 Tauri FFI 官方 API，**禁止写 `unsafe {}` 块**（即使你觉得能证明安全，也必须 PR 人工 review）
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

### 3.1 整体架构（桌面三窗口）
```
                ┌──────────────────────┐
                │   Tauri 2.x Runtime   │ ← Rust 单进程 + WRY WebView
                │ （Windows / macOS）   │
                └──────────┬─────────────┘
                           │  IPC（Tauri command）
┌──────────────────────────┴─────────────────────────────┐
│            3 个独立 WebView（同一个前端代码 3 实例）       │
│                                                         │
│  🐾 pet-window         ⚙️ settings-window     💬 chat-window │
│  （永远置顶/无边框）      （常规窗口）          （抽屉式）   │
└─────────────────────────────────────────────────────────┘
```

### 3.2 前端目录职责（`src/` 下）
| 目录 | 职责 | 修改注意事项 |
|------|------|-------------|
| `src/routes/` | TanStack Router 基于文件的路由（设置页、关于页、Chat 页） | 新增路由直接新建文件，注意文件名即路径：`src/routes/about.lazy.tsx` → `/about` |
| `src/components/` | **UI 公共组件**（跨页面复用的 Card / Button / Dialog / Tooltip 等） | 1. 每个组件 **单独文件夹**：`PetCard/index.tsx` + `PetCard/PetCard.module.css`（如需自定义样式）<br>2. 样式 **优先 Tailwind**，极少数特殊动效才用 module.css，不写全局污染的 CSS |
| `src/components/petLive2d/` | Live2D 宠物形象渲染（pixi-live2d-display） | 不要直接操作 canvas，统一走 `useLive2dController()` hook |
| `src/stores/` | Zustand stores（状态管理），持久化靠 `persist` 中间件 | 一个 store = 一个业务域：`petStore`（宠物档案）/ `settingsStore`（偏好）/ `chatStore`（聊天历史）/ `windowStore`（窗口布局）。**不要一个全局大 store**。 |
| `src/hooks/` | 公共自定义 Hooks | 命名必须 `useXxx`：`useDraggableWindow`、`useTauriInvoke<T>()`、`useDebounced()`。每个 hook **单独文件**，注释写清楚返回值类型。 |
| `src/lib/`（核心逻辑层 🔥） | **不允许出现 React** 的纯 TS 工具层（13 个子模块，重要度排序） | |
| `src/lib/windowManager.ts` | 3 窗口创建/销毁/定位逻辑 | 改必须人工 review，窗口边界穿透、无边框样式和 OS 强相关 |
| `src/lib/encryption/` | AES-GCM 加密 + Argon2 密钥派生（和 Rust 端保持一致算法） | 严禁改算法参数（IV 12字节、盐 16字节、Argon2 m=65536 t=3 p=1），否则旧数据解不开 |
| `src/lib/storage/` | IndexedDB 包装（聊天历史 + 宠物日记） | 写 schema 迁移脚本要同时改 Rust 端 migrations（防止两边不一致） |
| `src/lib/live2dManager.ts` | Live2D 模型加载、表情/动作触发 | 模型文件后缀 `.model3.json`，加载失败回退 DefaultModel |
| `src/lib/chatService.ts` | 聊天记录 CRUD + 前端 LRU 缓存（1000 条） | 所有写入必须先 Rust 端 AES 加密再入库 |
| `src/lib/types/` | 全局 TS 类型：Pet / ChatMessage / Settings / WindowConfig | 任何类型变动，同步改 `src-tauri/src/types.rs` 的 Rust struct |
| `src/lib/tauriInvoker.ts` | `invoke<T>()` 统一封装：超时 30s + 错误处理 + retry 1 次 | 所有 Tauri command 必须通过这个调用，不要直接 `import { invoke }` |
| `src/lib/petBehaviorEngine.ts` | FSM（有限状态机）：idle/happy/sad/sleeping/eating | 状态转移图 `pet_transitions.png`（见 docs），严禁跨状态跳转 |
| `src/lib/ipcTypes.ts` | Tauri IPC 协议：所有 command 名常量 + 入参/出参 interface | 命令名必须 `spiritpal:xxx`（例：`spiritpal:get_pet_info`），防冲突 |
| `src/lib/i18n.ts` | i18next 初始化（react-i18next） + 语言检测 | 语言切换同步写 settingsStore persist，刷新后保留 |
| `src/lib/utils/` | 纯函数工具：formatTime / classNames merge / 防抖节流 | 必须 100% Vitest 覆盖，不许有副作用 |
| `src/lib/constants.ts` | 全局常量：窗口尺寸 / 动画时长 / 图片 URL 前缀 | 不许散落魔法数字，全集中在这里 |
| `src/lib/errorBoundary.tsx` | React ErrorBoundary（错误边界）+ 兜底页面（「宠物离家出走了」） | 线上生产构建必须开启 SourceMaps upload（Sentry） |

### 3.3 Rust 后端（`src-tauri/` 下）
| 目录 | 职责 |
|------|------|
| `src-tauri/src/main.rs` | Tauri `Builder::default()` 启动入口 + capabilities 配置加载 |
| `src-tauri/src/lib.rs` | `#![forbid(unsafe_code)]` + 所有模块声明（`mod commands; mod encryption; ...`） |
| `src-tauri/src/commands/` | **12 个 Tauri Commands**（一一对应前端 `src/lib/ipcTypes.ts` 的命令名）：<br>`pet`（档案 CRUD）/ `chat`（历史加密读写）/ `settings`（偏好 secureStore）/ `backup`（JSON 导入导出）/ `window`（置顶/穿透）/ `update`（自动更新签名校验）/ `encryption`（Argon2 派生测试）/ `system-tray`（托盘菜单事件）/ `live2d-cache`（模型缓存清理）/ `log`（日志滚动）/ `analytics`（本地统计，不上传）/ `diagnose`（用户一键导出故障诊断包） |
| `src-tauri/src/encryption.rs` | 与前端 `lib/encryption/` **算法严格一致**：AES-256-GCM + Argon2id，互测通过才允许 |
| `src-tauri/src/db.rs` | SQLx + SQLite（含 7 个 migration 脚本），DB 路径 `app_data_dir().join("spiritpal.db")` |
| `src-tauri/src/types.rs` | Rust struct（对应前端 `lib/types.ts`）：`Pet`、`ChatMessage`、`Settings` |
| `src-tauri/src/tests.rs`（或 `tests/` 目录） | **32 个单元测试**：加密一致性 / DB 迁移 / command 参数校验 / 路径穿越攻击测试 |
| `src-tauri/capabilities/` | Tauri v2 capabilities JSON（安全权限白名单）：`default.json` / `pet-window.json` / `chat-window.json` | **修改必须人工 review**，capability 过大会导致跨窗口 IPC 安全漏洞 |
| `src-tauri/tauri.conf.json` | Tauri 应用配置：bundle ID / 图标路径 / 窗口定义 / updater 公钥 | 版本号改这里 + package.json + Cargo.toml 同步（见 §10.2） |
| `src-tauri/Cargo.toml` | Rust 依赖 + crate metadata | 版本号同步位置之一 |

---

## 4. 状态管理（stores/）

> 核心原则：**一个 Zustand Store = 一个业务域**。禁止全局 3000 行大 Store，每个 store 单独文件 + 单独 `persist` 配置（因为加密策略不同：settingsStore 加密、petStore 部分加密、windowStore 明文即可）。

| Store 文件 | 作用域 | 持久化策略 | 关键 Actions |
|-----------|--------|-----------|-------------|
| `stores/petStore.ts` | 当前选中的宠物（activePetId）、所有宠物列表、好感度、饥饿值 | `persist(name="spiritpal:pet", partialize: {档案+好感度走 AES-GCM 持久化，瞬时状态（当前表情）仅内存})` | `setActivePet(id)` / `feedPet(id, food)` / `updatePetMood(id, -5)` |
| `stores/settingsStore.ts` | 语言、启动行为、窗口置顶、Live2D 画质、自动更新开关 | `persist(name="spiritpal:settings", encrypt: true（Tauri secureStore wrapper）)` | `setLanguage("zh-CN")` / `setAlwaysOnTop(true)` |
| `stores/chatStore.ts` | 当前对话、未读数、草稿、表情包列表 | `persist(name="spiritpal:chat", partialize: {messages走加密写入DB，草稿存IndexedDB})` | `sendMessage(text)` / `clearHistory(petId)` |
| `stores/windowStore.ts` | 3 窗口位置、尺寸、Z-order、当前可见性 | `persist(name="spiritpal:window", 明文即可，位置不敏感)` | `setPetWindowPos(x,y)` / `toggleChatWindow()` |
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
| `pnpm test:e2e` | Playwright E2E（需要 GUI 环境） | CI `e2e.yml` workflow 专门跑，不参与 PR CI |
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
| `e2e.yml` | 每周 Cron + PR tag `e2e` | Playwright for Tauri 跑完整 E2E（需要 macOS self-hosted runner，因为 GitHub hosted 不支持 GUI Tauri） |

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
1. 把新的 Live2D 模型文件（`.model3.json` + `.moc3` + 贴图 + 动作 motion3.json）放到 `public/assets/live2d/miko/` 目录
2. `src/lib/types.ts` 的 `PetSpecies` enum 加 `miko: "fox"` 变体（同步 Rust `types.rs`）
3. `src/stores/petStore.ts` 初始化 `availablePets` 数组里加一条 `{ id: "miko-001", species: "fox", name: "Miko", modelPath: "/assets/live2d/miko/miko.model3.json" }`
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

---

## 📋 自进化修订记录表（AGENTS.md 进化史）

| 自进化版本 | 日期 | 触发原因 | 更新内容摘要 | 对应项目版本 |
|:---------:|------|---------|------------|:------------:|
| v1.0 | 2026-08-10 | 初始建立自进化协议 | 从 SpiritPal 项目健康度评估报告建议补齐：建立自进化协议（5 条铁律 + 自检清单）+ 版本号 3 文件同步清单（package.json + Cargo.toml + tauri.conf.json）+ i18n 多语言规范（5 种语言 4 步流程）+ 4 个典型 SOP（新增 Tauri Command / 新增 Store / 新增宠物角色 / 新增设置）+ 10 条 Known Gotchas 集中化表格 | v1.0.0 |
| v1.1 | 2026-08-15 | S2 记忆存储架构重构补全 | 清理 enhancedMemory.ts 未使用导入（deleteMemorySummary/deleteMemoryState/FESTIVALS）；补全 S2 方案 §9 测试计划全部用例（迁移 4 场景/双模式回退/export-import 兼容/对账/corrupt 保留/行级 load-save/遗忘晋升行级化）共 32 例；全量回归 vitest 1494 通过 / tsc 0 错误 / eslint 0 错误 / cargo test 55 通过 | v1.0.0 |
| v1.2 | 2026-08-15 | 未完成任务清单 T-1~T-15 批量完成 | T-2 eslint warning 全项目清零；T-3 recallEngine 情绪一致性接入真实情绪（setCurrentMood + getCurrentMood 公开化）；T-4 semantic 容量配置生效（semanticSummaryMaxChars/semanticConsolidationMaxChars 替代硬编码 2000/5000）；T-1 ownerFacts.ts 二期行级化迁移（owner_facts 表 + 双模式回退 + .legacy 备份）；T-7 Agent 路径注入记忆上下文；T-8 响应式触发限流（canTriggerResponsive 每日上限共用配额）；T-9 contextFit 多信号化（工作状态 + 音乐信号）；T-10 响应判定语义化阈值 0.4；T-14 删除 timeDecaySort 死代码；T-15 文档同步；全量回归 vitest 1494 通过 / tsc 0 错误 / eslint 0 错误 / cargo test 全通过 | v1.0.0 |

<!-- 🔄 下次更新 AGENTS.md 时，在上面表格末尾追加新一行，不要删除历史记录 -->
