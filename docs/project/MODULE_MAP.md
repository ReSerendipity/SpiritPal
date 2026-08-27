<!-- 注记：本节内容于 2026-08-27（家族规范治理 Phase E3）自 AGENTS.md 第 3 节整节逐字移出，一个字符未改；新增/修改模块时直接更新本文件 -->
# 模块边界 & 目录结构（MODULE_MAP · 自 AGENTS.md 移出）

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
