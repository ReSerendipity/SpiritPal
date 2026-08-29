# SpiritPal AGENTS.md — AI 辅助开发指南

> 🧬 **自进化协议版本**：v2.31  
> 📅 **最后更新日期**：2026-08-29  
> 🎯 **对应项目版本**：v0.1.0（闭源）

---

## 0. 文档优先级（单一事实来源）

当以下文档相互矛盾时，**以此顺序为准**，并立即按铁律 #1 修正靠后者：

1. 代码与配置本身（`pyproject.toml` / `package.json` / `.pre-commit-config.yaml` / 源码）
2. `docs/official_spec.md`（若本仓存在；当前本仓无此文件）
3. `AGENTS.md`
4. `README.md` / `docs/**`
5. `CHANGELOG.md`

> 判据：**能被机器验证的事实永远优先于自然语言描述。**

---

## ⚠️ 🤖 Agent 行为契约（自进化协议 · 必须严格遵守）

AI Agent 打开本文件后的**第一件事**是执行下面的「🧪 自进化自检清单」，并遵守以下 5 条铁律：

### 🔴 6 条自进化铁律
1. **🔄 同步规则（Synchronize First）**：如果发现项目实际情况（目录结构、依赖版本、技术栈、配置文件名等）与本文件描述 **不一致** → **立即更新本文件**，不要只改代码不改 AGENTS.md。这是最高优先级的规则。
2. **📝 坑点累积（Gotchas Accumulation）**：每次修复 Bug / 踩坑后（哪怕是很小的坑），**必须** 追加一条到 [KNOWN_GOTCHAS.md](docs/project/KNOWN_GOTCHAS.md)（原第 14 节，已移出），写清楚：触发场景、现象/报错、正确做法、首次发现日期。
3. **📚 SOP 累积（SOP Accumulation）**：每次完成一个「本文件现有 SOP 没覆盖」的典型开发任务后，**必须** 把步骤整理成新 SOP 追加到 [AI_DEV_SOPS.md](docs/project/AI_DEV_SOPS.md)（原第 13 节，已移出）。
4. **✅ 自检流程（Self-Check on Startup）**：每次打开本文件准备工作前，**必须** 先运行下面的「🧪 自进化自检清单」，逐项核对，有任何一项不符先修正 AGENTS.md 再干活。
5. **🏷️ 版本递增（Version Increment）**：每次更新本文件内容后，**必须** 做三件事：① 文件顶部「自进化协议版本号」+0.1（小改）或 +1.0（大改/框架调整）；② 更新「最后更新日期」；③ 在 [REVISION_LOG.md](docs/project/REVISION_LOG.md)（原「📋 自进化修订记录表」，已移出）末尾追加一行记录。
6. **🔬 证据绑定（Evidence Binding）**：本文件中每出现一个**可执行文件路径**（脚本、配置、workflow、源码），它必须是**当时可验证存在**的。引用前跑一次 `python scripts/check_spec_refs.py`；若确实想描述尚未实现的东西，必须显式加 `（计划，未实现）` 前缀。禁止把"CI 会阻断 X"写成一个 CI 里不存在的门禁。

### 🧪 自进化自检清单（每次启动工作前必跑）
- [ ] 目录结构（`src/`、`src-tauri/`、`components/`、`stores/`、`hooks/`、`lib/`）是否和 [MODULE_MAP.md](docs/project/MODULE_MAP.md)（模块边界 & 目录结构明细）描述一致？
- [ ] 3 个窗口配置（pet-window / settings / chat）是否和 `lib/appWindows.ts` 实际配置一致？
- [ ] 上次工作是否踩了新坑？如果是，是否已追加到 [KNOWN_GOTCHAS.md](docs/project/KNOWN_GOTCHAS.md)？
- [ ] 修改了 Rust Tauri command 后，是否已在前端对应调用处更新了类型签名？
- [ ] 是否改了 package.json / Cargo.toml / tauri.conf.json 的版本号？如果改了一个，是否 3 个都同步（见第 10.2 节）？
- [ ] 上次更新是否正确递增了自进化协议版本号 + 追加了修订记录表（[REVISION_LOG.md](docs/project/REVISION_LOG.md)）？
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
- **unsafe 约束**：⚠️ `#![forbid(unsafe_code)]` **实际未在 lib.rs 声明**（文档曾声称已加，与代码不符）；`lib.rs` 的 `get_mouse_pos` 使用 Win32 `GetCursorPos` unsafe 块。约定：新代码避免 unsafe，必须用 unsafe 时用 `tauri-plugin` 官方封装并单独 PR review
- **格式化 & Lint**：
  ```bash
  cargo fmt --all          # 格式化
  cargo clippy --all-targets --all-features -- -D warnings   # 把 warning 当 error 处理
  ```
- **Tauri Command 规则**（⚠️ 实际布局与旧描述不符，2026-08-28 核对）：
  - **不存在 `src-tauri/src/commands/` 目录**。所有 `.rs` 平铺在 `src-tauri/src/`（18 个文件），command 分散定义在各自模块（`lib.rs` 18 个、`petmod.rs` 6 个、`tray.rs` / `keychain.rs` / `crypto.rs` 各 3 个、`device.rs` / `encrypted_db.rs` 各 2 个、`mcp_bridge.rs` / `audit_log.rs` 各 1 个，**共 39 个**），统一在 `lib.rs` 的 `generate_handler!` 里注册（桌面端与移动端各一份，新增命令**两处都要加**）
  - ⚠️ 函数名前缀 `cmd_` **实际未被采用**（既有命令均无前缀，如 `import_petmod` / `set_tray_icon`）。新命令**沿用无前缀风格**以保持一致性，本条前缀约定视为作废
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

> **关键结论**（2026-08-28 核对）：前端 `src/lib/` 为纯 TS 核心逻辑层（不允许出现 React，实际 **202 个 `.ts` 文件**）、`src/stores/` 一域一 store（pet/settings/chat/theme）、`src/components/` 为跨页面 UI 公共组件；Rust 端全部 Tauri Command 平铺在 `src-tauri/src/*.rs`（**39 个**，无 `commands/` 子目录），`crypto.rs` / `encrypted_db.rs` 负责数据加密落盘。
> ⚠️ **不存在 `src/lib/ipcTypes.ts`**（旧版文档引用了它）。前后端命令契约由 **`src/lib/__tests__/ipcContract.test.ts`** 守护：它扫描前端所有 `invoke('xxx')`，逐一核对 Rust 侧是否存在同名 `#[tauri::command]`，并校验关键命令的参数签名。**新增 invoke 时必须跑这个测试**，确实尚未实现的命令需显式登记进它的 `KNOWN_PLUGIN_COMMANDS` 排除列表。
> 📂 前端 `src/` 目录职责表 + Rust `src-tauri/` 模块表（含修改注意事项）已整节移入 [docs/project/MODULE_MAP.md](docs/project/MODULE_MAP.md)；新增/修改模块先到该文件核对职责边界。

---

## 🚫 禁区目录（禁止 AI 自动修改，必须人工确认）

| 路径 | 为什么禁 | 改动需什么 |
|---|---|---|
| `src-tauri/target/` | Rust 编译产物，手改即失效 | 只通过 cargo 构建更新 |
| `dist/` | 前端构建产物，手改即失效 | 只通过构建命令更新 |
| `src-tauri/gen/` | Tauri 生成代码 | 只通过构建命令更新 |
| `docs/_devarchive/` | 归档不可回写 | 只新增，不修改 |

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

> 📂 SOP-1 新增 Rust Tauri Command／SOP-2 新增 Zustand Store／SOP-3 新增宠物角色／SOP-4 新增一项设置已整节移入 [docs/project/AI_DEV_SOPS.md](docs/project/AI_DEV_SOPS.md)；新 SOP 追加模板见该文件顶部注释。

---

## 14. 常见陷阱（Known Gotchas）— 血泪教训汇总（原缺失，现在开始累积）

> 📂 完整陷阱表（29 条，2026-08-10 ~ 2026-08-26 累积）已整节移入 [docs/project/KNOWN_GOTCHAS.md](docs/project/KNOWN_GOTCHAS.md)；新坑按铁律 #2 追加到该文件表格末尾。

---

## 📋 自进化修订记录表（AGENTS.md 进化史）

> 历史修订记录已移入 [docs/project/REVISION_LOG.md](docs/project/REVISION_LOG.md)，今后新增行仍按铁律 #3 追加到该文件。

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

## 远程推送与同步规则（2026-08-27）

- **main 为私有开发主线**：本地开发与提交后，推送到 `private` 远程（`git push`，默认上游即 private/main）。
- **public 分支为公开演示内容**：仅在有公开需求时维护，推送用 `git push origin public`。目前无更新计划。
- **禁止静默直写远程**：任何通过 GitHub API / 网页端直接修改远程的操作，执行前必须向用户说明，执行后必须检查本地与远程差异并同步。
- **禁止动未提交改动**：用户本地存在未提交修改时，不得擅自 commit / push / stash / 覆盖，必须先征得用户同意。
- **删除即高危**：删除文件或分支必须经过用户明确审核。

## push 前预检铁律（2026-08-28）

- 提交并推送前必须通过本地预检：直接 `git push`（pre-push hook 自动执行 precheck.ps1），或手动 `powershell -File precheck.ps1` 全绿后推送。
- 预检失败时**修复代码**，而不是跳过检查；`--no-verify` 仅限用户明确要求时使用。
- 改动业务代码后需跑一次 `-Full`（含测试与覆盖率门禁）再推送。
- 预检脚本与 hook 均为本地文件（不入库），勿删除。

## CI 流程铁律（2026-08-28 反方审稿采纳）

1. **推送闭环**：push ≠ 完成。push 后必须用 `gh run list` / `gh run watch` 盯 CI 到终态并回报结果；红了**当场自己修**（刚推送的上下文最全），跑不完或修不动立即回报而不是留到明天。
2. **修复交接**：CI 红时先读 `FIX_LOG.md`；动手修必须追加一行：**失败签名（关键报错行）→ 假设 → 动作 → 结果**。同一失败签名第二次出现，禁止再试同方向，必须读完整失败日志或 revert 换策略。同一仓库同一时刻只允许一个修复者。
3. **红灯止损**：main 红后限时 30-60 分钟拿不出明确根因 → `git revert` 回到 last green，恢复 main 绿色后再从容修（配合 FIX_LOG.md）。**revert 是止损，不是失败。**
