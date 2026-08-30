# OpenPets 开源项目源码分析报告

> **注：本报告基于 GitHub 在线源码分析，未本地克隆仓库（网络不稳定导致克隆失败）。**
>
> 分析对象：[alvinunreal/openpets](https://github.com/alvinunreal/openpets)（主分支 `main`）
> 对比对象：SpiritPal（Tauri v2 + React 19 + TypeScript + Rust 跨平台 AI 桌宠应用）
> 报告日期：2026-07-14

---

## 1. 项目概览

| 项目属性 | 说明 |
|---------|------|
| 仓库 | `alvinunreal/openpets` |
| 许可证 | **MIT**（`LICENSE`：Copyright (c) 2026 OpenPets） |
| 主要语言 | TypeScript（pnpm monorepo） |
| 运行时 | Electron 桌面应用 |
| 最新 Release | **v3.1.0**（2026-06-13，GitHub Releases 标记为 Latest） |
| 工作区版本 | `package.json` 中 `openpets-v2-workspace` 版本为 `3.3.0`（各子包同步 bump 至 3.3.0） |
| 提交数 | 171 commits（截至 2026-06-14） |
| 星标 | 约 900+（skills.sh 记录 898–989） |
| 一句话定位 | **面向 AI 编码代理（coding agents）的桌面宠物应用**——把一只动画桌宠放在屏幕上，让 Claude Code / Cursor / OpenCode / Codex 等 AI 编码助手通过 MCP 在"思考 / 编辑 / 测试 / 完成"等状态时驱动宠物做出对应反应。 |

OpenPets 由 **Boring Dystopia Development** 开发，其核心 README 开宗明义：

> "A desktop companion platform with pets, plugins, and optional local agent integrations."
> （一个带宠物、插件与可选本地代理集成的桌面伴侣平台。）

OpenPets 把桌宠重新定位为 **AI Agent 的状态可视化层（state layer）**：当 AI 编码助手在思考、编辑文件、运行测试、等待审批或完成任务时，桌宠会展示匹配的反应动画或简短状态消息。这与传统"养成系"桌宠（如 Live2D / DyberPet 系列）形成鲜明差异——OpenPets 的宠物是为"陪伴编码"而生的，而非为"被喂养"而生。

项目本地优先（local-first）：桌面应用、MCP 服务器、CLI 三者全部通过本地 socket（Unix domain socket / Windows named pipe）通信，除下载宠物包和检查更新外不做任何出站网络请求，无遥测。

---

## 2. 核心技术栈

OpenPets 的技术栈与 SpiritPal 有显著差异，下表对照两者：

| 维度 | OpenPets | SpiritPal |
|------|----------|--------|
| 壳层框架 | **Electron**（Chromium + Node.js） | **Tauri v2**（系统 WebView + Rust 后端） |
| 语言 | **TypeScript**（贯穿主进程 / 渲染 / SDK / MCP） | TypeScript（前端） + **Rust**（后端命令） |
| 前端 UI | React + Tailwind（Control Center 渲染层，Vite 构建） | React 19 + TypeScript |
| 包管理 | **pnpm 11** monorepo（`workspace:*`） | npm/pnpm（单包） |
| 代理协议 | **MCP（Model Context Protocol）** stdio server | 自研 agentTools（非 MCP） |
| 插件体系 | **Plugin SDK v3**（沙箱 BrowserWindow + 权限 + 配额） | JSON 驱动 modManager（数据配置型） |
| 精灵图格式 | **8×9 spritesheet**（WebP，1536×1872，192×208/帧） | **8×9 spritesheet**（ATLAS 同规格） |
| IPC | 本地 socket / named pipe + discovery token | Tauri `invoke` 桥接 |
| 构建工具 | tsc + Vite + Electron Forge | Tauri CLI + Vite |

OpenPets 的技术栈核心由四块构成：

1. **TypeScript + Electron**：主进程 `apps/desktop/src/main.ts` 是 Electron 引导入口，承载托盘、宠物窗口、本地 IPC 服务器、插件子系统、编辑器集成等全部主进程逻辑。
2. **MCP Server**：`packages/mcp` 基于 `@modelcontextprotocol/sdk` 实现 stdio MCP 服务器，向 AI 代理暴露 3 个工具（`openpets_status` / `openpets_react` / `openpets_say`）。
3. **Plugin SDK v3**：`packages/sdk` 是"纯类型包"（types-only），桌面应用在沙箱里注入 `OpenPetsPlugin` 全局对象并传给插件的 `start(ctx)` 一个 `OpenPetsContext`。
4. **8×9 spritesheet**：宠物资源采用 8 列 × 9 行的精灵图集规范，单帧 192×208，整图 1536×1872，与 SpiritPal 的 `ATLAS` 常量完全同源（均来自 codexPet 格式生态）。

---

## 3. 项目架构与目录结构

OpenPets 是一个标准的 pnpm monorepo，工作区包含 `apps/*` 与 `packages/*`。以下目录结构综合自 `codemap.md`（仓库 Atlas）与 README 的 Workspace Structure 章节。

### 3.1 顶层目录

```
openpets/
├── apps/
│   └── desktop/              # Electron 桌面应用（托盘优先设计）
│       ├── src/              # 主进程服务层：生命周期/状态/窗口/IPC/插件/集成
│       │   ├── main.ts       # Electron 主进程引导入口
│       │   ├── renderer/     # Vite 渲染层（React/Tailwind Control Center）
│       │   ├── i18n/         # 主机 UI 本地化 + 反应语音池
│       │   └── contracts/    # 公共边界契约测试
│       └── scripts/          # 打包清理与本地发布脚本
├── packages/                 # 可发布的 npm 包工作区
│   ├── sdk/                  # @open-pets/plugin-sdk（Plugin SDK v3 类型 + 测试套件）
│   ├── pet-format/           # @open-pets/pet-format（宠物清单与 schema 类型）
│   ├── mcp/                  # @open-pets/mcp（MCP stdio 服务器）
│   ├── client/               # @open-pets/client（IPC 客户端辅助库）
│   ├── claude/               # @open-pets/claude（Claude Code 集成：hooks/memory/MCP）
│   ├── opencode/             # @open-pets/opencode（OpenCode 插件与指令配置）
│   ├── cursor/               # @open-pets/cursor（Cursor MCP/rules 配置）
│   ├── pi/                   # @open-pets/pi（Pi CLI 扩展集成）
│   ├── cli/                  # @open-pets/cli（用户入口 CLI：配置与脚手架）
│   ├── agent-events/         # 共享的代理语音/事件消息池与校验工具
│   └── install-pet/          # 独立宠物安装器
├── plugins/
│   └── official/             # 官方第一方 SDK v3 插件（随主机目录打包）
├── skills/openpets/          # OpenPets 自身的 Skill 定义
├── docs/                     # 技术规范与架构文档
├── assets/                   # 资源
└── package.json              # 工作区根（openpets-v2-workspace v3.3.0）
```

### 3.2 关键包职责（来自 `codemap.md`）

| 包 | 职责 |
|----|------|
| `apps/desktop` | 面向用户的 Electron 伴侣应用：托盘 UX、宠物窗口、宠物安装、插件自动化/运行时、代理设置、更新检查、本地 IPC 服务器 |
| `packages/sdk` | 公共 SDK v3 类型契约 + 确定性测试套件（mock runtime、fake clock、插件测试 harness） |
| `packages/pet-format` | OpenPets 宠物包身份的最小标记/类型接口 |
| `packages/mcp` | 向兼容代理暴露 OpenPets 工具的 MCP 服务器包 |
| `packages/client` | 发现并与桌面应用通信的 IPC 客户端包 |
| `packages/claude` | Claude Code 集成：hooks 处理器、hook 设置、CLI 集成、导出的设置 API |
| `packages/opencode` | OpenCode 编辑器集成：插件运行时与全局设置助手 |
| `packages/cursor` | Cursor 编辑器集成：托管 MCP 配置与项目本地规则 |
| `packages/pi` | Pi 编码代理集成：扩展运行时与 slash 命令支持 |
| `packages/cli` | 用户入口 CLI：跨 client/claude/opencode/mcp 包的命令解析与编排 |
| `packages/agent-events` | 共享的代理语音/事件消息池与校验工具 |

### 3.3 架构数据流（来自 `codemap.md` 的 Architecture Flow）

1. 桌面应用启动 `apps/desktop/src/main.ts`，初始化应用状态，创建托盘/任务窗口，启动本地 IPC 服务器。
2. 代理集成（`packages/claude` / `opencode` / `cursor` / `pi` / `mcp`）配置代理或通过 `@open-pets/client` 发出宠物命令。
3. 客户端发现 Unix socket、Windows named pipe 或 TCP 端点（WSL 跨平台访问）。
4. 桌面 IPC 服务器通过 **lease（租约）托管控制器** 路由命令，使默认宠物与代理宠物能安全共存。
5. 插件服务加载已批准的目录或本地 `openpets.plugin.json` 清单，持久化插件状态/配置，调度声明式定时器，通过权限校验的主机模块桥接 SDK v3 调用。
6. 宠物窗口渲染反应驱动的动画、本地化语音、主机渲染的气泡/告警/HUD，以及基于桌面状态 + 反应映射元数据的状态反应。
7. 宠物资源从内置资产、本地开发的 Codex 宠物或远程下载的目录 ZIP 解析。

---

## 4. 核心功能模块详解

### 4.1 MCP 工具（`packages/mcp`）

OpenPets 的 MCP 服务器向 AI 编码代理暴露 **3 个标准工具**，定义于 `packages/mcp/src/server.ts:createOpenPetsMcpServer`：

| 工具名 | 用途 | 输入 schema | 注解 |
|--------|------|------------|------|
| `openpets_status` | 检查 OpenPets 是否可达，以及当前 MCP 事件指向哪只宠物 | `{}`（无参数） | `readOnlyHint: true, idempotentHint: true` |
| `openpets_react` | 在桌宠上设置一个简短的编码导向反应（thinking/editing/testing/success/error 等） | `{ reaction: enum }` | `readOnlyHint: false, idempotentHint: false` |
| `openpets_say` | 在桌宠上显示一条简短的安全消息（禁止代码/日志/密钥/URL/路径） | `{ message: string, reaction?: enum }` | `readOnlyHint: false, idempotentHint: false` |

服务器在 `createOpenPetsMcpServer` 中注册工具时还设置了 `instructions` 字段：

> "Interact with the user's OpenPets desktop companion. Use openpets_status first. Use openpets_say only for short status/personality messages, never code, logs, secrets, URLs, or file paths."

这等于在协议层对 AI 代理做了使用约束。

#### 工具处理器实现（`packages/mcp/src/tools.ts`）

三个处理器 `handleStatus` / `handleReact` / `handleSay` 的核心特征：

- **Lease 优先**：每个处理器在执行前先 `await context.leaseReady`，并通过 `ensureLease(context)` 确保持有有效租约。`ensureLease` 实现了"心跳优先恢复"策略——当租约过期时，先用 `staleLeaseId` 尝试 `heartbeatLease`，失败再 `acquireLease`，避免不必要的重新获取。
- **严格输入校验**：`saySchema` 用 zod 对消息做 5 层 `refine` 校验：
  1. `min(1).max(140)` —— 长度 1–140 字符；
  2. 禁止换行（`[\r\n]`）—— 必须单行；
  3. 禁止代码特征（```` ``` ````、`<script`、`function`、`=>`、`class/import/export/const/let/var`）；
  4. 禁止 URL/路径（`https?://`、`www.`、`/path/path`、`A:\`）；
  5. 禁止密钥特征（`api_key`、`secret`、`token`、`password`、`BEGIN ... PRIVATE KEY`）。
- **错误信息脱敏**：`sanitizeMcpRuntimeError` 与 `sanitizeUnavailableReason` 会把包含路径分隔符、`.sock`、`pipe`、`token`、`ipc.json`、`ENOENT`、`ECONNREFUSED`、`EACCES` 的错误信息统一替换为"OpenPets desktop app or local IPC is unavailable."，避免向代理泄露本地文件结构。

#### MCP 服务器生命周期（`packages/mcp/src/index.ts`）

`main()` 函数的启动流程：

1. `parseMcpArgs` 解析命令行（支持 `--pet <petId>` 指定目标宠物、`--help`、`--version`）。
2. `createToolContext(options.petId)` 构造工具上下文（含 `createOpenPetsClient()`）。
3. `acquireStartupLease` 异步获取启动租约（失败不阻塞，记 `degradedReason`）。
4. `createOpenPetsMcpServer` 创建 MCP 服务器实例。
5. `wireTransportLifecycle` 把心跳、重试、优雅关闭逻辑挂到 transport 上：
   - 心跳每 **5 秒** 一次（`setInterval` + `unref`）；
   - 心跳失败时保存完整 stale lease，进入重试调度；
   - 重试退避从 5 秒起，指数翻倍，上限 **60 秒**；
   - transport `onclose` 触发完整 teardown：清定时器 → 释放租约 → 关闭服务器 → `process.exit(0)`。
6. SIGINT / SIGTERM 都走同一个 `close()` 优雅关闭。

### 4.2 Plugin SDK v3（`packages/sdk`）

SDK v3 被称为 "SuperPlugins"，是一个 **纯类型包（types-only）**：没有运行时代码可 import，桌面应用在插件沙箱里注入 `OpenPetsPlugin` 全局对象，并把 `OpenPetsContext` 传给插件的 `start(ctx)`。

> 来源：`packages/sdk/src/index.ts` 顶部文档注释——"This package ships **types only**. There is no runtime to import — the OpenPets desktop app injects the `OpenPetsPlugin` global into your plugin sandbox and passes your `start(ctx)` handler an {@link OpenPetsContext}."

#### 权限模型（`OpenPetsPermission`）

`packages/sdk/src/index.ts` 定义了 30+ 项权限，分 v2（兼容）与 v3（新增）两组：

- **v2 权限**：`pet:speak`、`pet:reaction`、`pet:move`、`schedule`、`storage`、`status`、`commands`、`network`
- **v3 新增**：`pet:interact`、`pet:pin`、`pet:animate`、`pet:speak:dynamic`、`pet:drop`、`pets:read`、`pets:manage`、`audio`、`events`、`ui:toast`、`ui:panel`、`ui:delivery`、`notify`、`bus`、`ai`、`secrets`、`voice:speak`、`voice:listen`、`auth`、`files`、`system:openExternal`、`system:metrics`、`clipboard`、`network:write`

权限必须在清单 `permissions` 数组中声明、安装时用户批准、持久化到插件状态，且**每次 SDK 调用时由 bridge 重新校验**。敏感 API（`voice:listen`、`clipboard`、`pet:speak:dynamic`）还需额外的显式同意开关。

#### ctx 子系统 API

SDK v3 把宠物重构为"可编程表面"，API 按子系统组织（而非 v2 的扁平 `ctx.pet` 命名空间）。从 `packages/sdk/src/index.ts` 的类型定义与 README 可梳理出：

| 子系统 | 关键 API | 说明 |
|--------|---------|------|
| `ctx.pets` / `ctx.pet` | 管理默认与生成的宠物实例：spawn、move、animate、react | 宠物管理 |
| `ctx.ui` | `bubble()`、`toast()`、`alert()`、`panel()`、`delivery()`、`menu` | 气泡/吐司/告警/面板/投递/菜单，全部主机渲染 |
| `ctx.audio` | `play()`、`importUserSound()`、`forgetUserSound()`、`stop()` | 命名主机音或捆绑音，受全局静音/免打扰约束 |
| `ctx.schedule` | `once`、`every`、`daily`、`cron`、`at` | 精确计时钩子 |
| `ctx.ai` / `ctx.secrets` | 接入主机配置的 AI provider（Anthropic/OpenAI/Ollama） | 不向插件源暴露 API key |
| `ctx.storage` | JSON 键值存储 + 变更订阅 | 简单持久化 |
| `ctx.events` | 订阅策划的主机事件流 | 有界事件集（无键击/屏幕内容/窗口标题） |
| `ctx.assets` | `icon/image/svg/sprite/sound` | 解析清单声明的资产为不透明引用 |
| `ctx.bus`、`ctx.net`、`ctx.notify`、`ctx.voice`、`ctx.auth`、`ctx.files`、`ctx.system`、`ctx.commands`、`ctx.status`、`ctx.log` | 其他能力 | 网络流式、TTS/STT、PKCE OAuth、文件选取等 |

#### 气泡（Bubble）描述型 UI

`OpenPetsBubble` 接口是 SDK v3 的核心 UI 描述符——插件只"描述"想要的气泡，主机"渲染"它，原始 HTML/JS 永远不跨越 SDK 边界。一个气泡可包含：

- 内容：`text`（纯文本，长度受限，内容过滤）、`markdown`（受限 markdown，主机消毒）、`icon`/`svg`/`image`（资产引用）、`hud`（2×2 网格 HUD，带进度条）、`indicator`（告警头）、`dynamic`（标记为模型生成，需 `pet:speak:dynamic`）
- 生命周期：`durationMs`、`sticky`、`pin`（占用持久 pinned 槽位，每只宠物最多 1 个）、`dismissOn`、`priority`（low/normal/high/urgent，喂给 bubble arbiter）
- 交互：`actions`（按钮，需 `pet:interact`）、`input`（text/number/select 输入）

`OpenPetsBubbleHandle` 提供活实例句柄：`update()`（原地更新，支持进度/倒计时/流式 token）、`dismiss()`、`pin()`/`unpin()`、`onAction()`、`onSubmit()`、`onDismiss()`。

#### 事件总线（`OpenPetsEventName`）

策划的只读主机事件集（明确有界——无键击、无屏幕内容、无其他应用窗口标题、无剪贴板、无文件系统监听）：

- 宠物交互：`pet:clicked`、`pet:doubleClicked`、`pet:dragStart`、`pet:dragEnd`、`pet:hover`、`pet:drop`
- 闲时：`idle:enter`、`idle:exit`
- **代理活动**：`agent:activity`（payload: `{ kind, reaction?, active, petId }`）——这是 AI 代理状态层的插件侧入口
- 系统：`config:changed`、`screen:locked`、`screen:unlocked`、`power:battery-low`、`power:charging`、`display:changed`、`online`、`offline`、`day:partChanged`

### 4.3 pet-format 包（`packages/pet-format`）

**关键发现**：`packages/pet-format/src/index.ts` 实际上只是一个最小标记接口，并不包含 spritesheet 维度 schema：

```ts
export interface PetFormatPackageMarker {
  readonly packageName: "@open-pets/pet-format";
}
export const petFormatPackageName = "@open-pets/pet-format";
```

`packages/pet-format/package.json` 也仅是 `v3.3.0` 的标记包（`main: dist/index.js`，无依赖）。`codemap.md` 同样把它描述为"Minimal package marker/type interface for OpenPets pet package identity"。

这意味着 OpenPets 的 **宠物资源格式规范并不在代码包里硬编码**，而是以文档形式定义在 `openpets.dev/docs/pet-format`。实际运行时的宠物清单校验逻辑位于桌面应用主进程（`apps/desktop/src/` 下的 pet 相关模块）。

### 4.4 8×9 Spritesheet 格式

综合 OpenPets 官方文档（`openpets.dev/docs` 的 Pet assets / Spritesheet / Reactions 章节）与同源生态（codexPet / Petdex）的公开资料，OpenPets 的宠物资源规范如下：

| 属性 | 值 |
|------|-----|
| 图集尺寸 | **1536 × 1872** 像素 |
| 布局 | **8 列 × 9 行**，共 72 帧 |
| 单帧尺寸 | **192 × 208** 像素（1536/8=192，1872/9=208） |
| 文件格式 | `spritesheet.webp`（单一 WebP 图） |
| 元数据 | `pet.json`（定义每行动画名、帧率、循环方式） |
| 缺省反应 | 未在图集中提供帧的反应回退到 `idle` |
| 抠图背景 | Magenta `#FF00FF`（Chroma-key 透明，同源生态约定） |

OpenPets 宠物包从三个来源读取（`openpets.dev/docs#pet-assets`）：

1. **内置宠物**（Built-in）：随桌面发布包捆绑的后备宠物。
2. **目录宠物**（Catalog）：从 OpenPets gallery 安装，ZIP 下载后校验（archive size、extracted size、entries 数、单文件 size、路径穿越、symlink 全部检查）再写盘。
3. **本地 Codex 宠物**（Local Codex pets）：开发者自研、实时导入测试，位于 `~/.codex/pets/<pet-id>/`。

> **与 SpiritPal 的关键对照**：SpiritPal 在 `spiritpal-app/src/lib/types.ts` 第 6 行硬编码了 `export const ATLAS = { cellW: 192, cellH: 208, cols: 8, rows: 9 } as const`，注释标明"来自 OC-Claw codexPet 格式"。两者**完全同源、维度一致、可直接互译**。

### 4.5 AI 代理集成

OpenPets 的代理集成有两条路径（`openpets.dev/docs#mcp-and-hooks`）：

| 路径 | 方向 | 能力 | 可用性 |
|------|------|------|--------|
| **MCP 工具** | 代理主动调用 OpenPets | 检查状态、改变反应、显示短消息 | 任何 MCP 兼容代理 |
| **Hooks** | 代理生命周期事件自动触发 OpenPets | thinking/editing/testing/waiting/success/error 自动反应 | 目前仅 Claude Code，可选安装 |

支持的代理（README + docs）：

- **Claude Code**：安装 OpenPets MCP、在 `~/.claude/CLAUDE.md` 写记忆指令、在 `~/.claude/settings.json` 写 hooks。
- **OpenCode**：安装 OpenPets MCP、自定义项目指令文件、`@open-pets/opencode` 自动 hook 插件。
- **Cursor / VS Code / Windsurf / Zed / Claude Desktop 等**：把 OpenPets 注册为标准 stdio 或 TCP MCP 服务器：
  ```json
  { "mcpServers": { "openpets": { "type": "stdio", "command": "npx", "args": ["-y", "@open-pets/mcp@latest"] } } }
  ```
- **Pi**：通过 `packages/pi` 扩展运行时集成。

#### 租约（Lease）机制

代理不直接发反应，而是先向 OpenPets 申请宠物的 **lease（租约）**：

| 步骤 | 行为 |
|------|------|
| 1. Acquire | 代理调用 `lease.acquire`（可带 pet id），OpenPets 返回 **15 秒** TTL 的租约 |
| 2. 首个显式租约 | 若该（非默认）宠物首次有活跃租约，OpenPets 打开该宠物窗口 |
| 3. Heartbeat | 代理持续调用 `lease.heartbeat`，每次续期 15 秒 |
| 4. React/Say | 带 lease id 的反应/消息路由到租约宠物；无租约的走默认宠物 |
| 5. Release/Expire | 释放或 15 秒无心跳则租约结束；某宠物最后一个租约结束时关闭其窗口 |

MCP 服务器透明地处理这一切：启动时获取租约、每 5 秒心跳、关闭时释放。`packages/client/src/protocol.ts` 的 `OpenPetsIpcMethod` 类型枚举了全部 IPC 方法：`hello`、`status`、`pets.list`、`pets.install`、`pets.install-local`、`lease.acquire`、`lease.heartbeat`、`lease.release`、`pet.react`、`pet.say`、`pet.showMedia`。

#### 默认宠物 vs 代理宠物

| 类型 | 何时显示 | 谁控制 |
|------|----------|--------|
| 默认宠物 | 始终（除非从托盘隐藏） | 用户（托盘控制可见性/位置/暂停） |
| 代理宠物 | 仅当助手活跃使用 OpenPets 时 | 助手（请求特定宠物时开窗，停止时关窗） |
| 内置宠物 | 默认宠物缺失或损坏时 | OpenPets（捆绑后备） |

---

## 5. 技术实现细节

本节以 `file:function` 引用形式给出关键技术实现细节。

### 5.1 MCP 工具定义（`packages/mcp/src/server.ts:createOpenPetsMcpServer`）

服务器实例化时注册 3 个工具，每个工具的 `inputSchema` 直接复用 `tools.ts` 导出的 zod schema：

- `openpets_status`：空 schema，`readOnlyHint + idempotentHint`，调用 `handleStatus(context)`。
- `openpets_react`：`reactSchema = z.object({ reaction: reactionSchema })`，其中 `reactionSchema = z.enum(allowedReactions)`，调用 `handleReact(input, context)`。
- `openpets_say`：`saySchema`（含 5 层 refine 校验，见 §4.1），调用 `handleSay(input, context)`。

### 5.2 反应枚举（`packages/client/src/protocol.ts:allowedReactions`）

```ts
export const allowedReactions = [
  "idle", "thinking", "working", "editing", "running",
  "testing", "waiting", "waving", "success", "error", "celebrating",
] as const;
export type OpenPetsReaction = typeof allowedReactions[number];
```

共 **11 个**反应，全部面向编码代理场景。`validateReaction(value)` 在 `createOpenPetsClient().react()` 调用链中被强制校验，非法反应抛 `OpenPetsClientError("invalid_reaction")`。

SDK 侧 `packages/sdk/src/index.ts:OpenPetsReaction` 类型额外允许 `string & {}`（即任意主机接受的字符串），但 MCP 入口严格限定为 11 个枚举值。

### 5.3 IPC 客户端（`packages/client/src/index.ts:createOpenPetsClient`）

客户端通过 `sendDiscoveredRequest` → `sendRequest` 实现请求-响应：

- **发现**：`readDiscoveryFile(options.discoveryPath)` 读取主机启动时写的 discovery 文件（含 endpoint 与 token）。
- **请求**：构造 `OpenPetsIcRequest`（`id: randomUUID()`、`version: 1`、`token`、`method`、`params`），序列化为 `JSON.stringify(request) + "\n"`。
- **大小限制**：`maxIpcMessageBytes = 16 * 1024`（16 KB），请求与响应均校验。
- **超时**：`connectTimeoutMs = 2_000`、`responseTimeoutMs = 3_000`。
- **传输**：TCP 端点用 `net.createConnection({ host, port })`，Unix socket / named pipe 用 `net.createConnection(path)`。
- **会话 nonce**：`SESSION_NONCE = randomUUID()` 模块加载时生成一次，随 `lease.acquire` 的 `clientPid` 一起发送，让桌面端区分"同进程重新获取"与"OS PID 复用碰撞"。

`OpenPetsClient` 接口的方法签名清晰反映了能力面：`hello`、`status`、`listPets`、`installPet`、`installLocalPet`、`acquireLease`、`heartbeatLease`、`releaseLease`、`react`、`say`、`showMedia`（`pet.showMedia` 是后增的本地图片气泡能力，支持 `clickUrl` 回调）。

### 5.4 Plugin SDK Context API（`packages/sdk/src/index.ts:OpenPetsContext`）

SDK v3 的 `OpenPetsContext` 把能力按子系统组织（见 §4.2 表格）。其设计哲学在文件顶部文档注释中阐明：

> "SDK v3 reframes a pet as a programmable surface: the API is organized into subsystems (`ui`, `pets`, `events`, `audio`, `ai`, …) instead of one flat `ctx.pet` namespace. The v2 surface (`ctx.pet.speak`, `ctx.http.fetch`, …) keeps working unchanged."

关键设计约束：

- **描述而非渲染**：插件描述气泡/告警/HUD/投递，主机渲染。HTML/JS 不能在宠物窗口里渲染原始 HTML 或执行任意脚本（`docs/plugins.md` 的 Mental model 节）。
- **资产引用不透明**：`OpenPetsAssetRef` 是对清单声明资产的不透明引用，由 `OpenPetsAssetsApi` 解析，插件永远不构造原始字节或 markup。
- **SSRF 防护**：网络 fetch 限制在开发者声明的 hostname，并防御本地 SSRF（`docs/plugins.md` Permission model 节）。

### 5.5 pet-format Schema（8×9 spritesheet）

如 §4.3 所述，`packages/pet-format/src/index.ts` 仅是标记接口。实际的 8×9 spritesheet 规范以文档形式存在于 `openpets.dev/docs/spritesheet` 与 `openpets.dev/docs/pet-json`，运行时校验逻辑在桌面应用主进程的 pet 相关模块中。

 spritesheet 的 9 行与 OpenPets 的 11 个反应并非一一对应——宠物只需为关心的反应提供帧，未实现的反应回退到 `idle`。这与 SpiritPal 的 `ANIMATION_ROWS`（9 行各自命名：idle/walk/run-left/waving/jumping/failed/waiting/running/review）是不同的行→状态映射策略，但**底层数据格式（8×9 网格、192×208 帧、1536×1872 整图）完全一致**。

### 5.6 代理状态可视化（thinking/editing/testing/complete → 宠物反应）

这是 OpenPets 的核心卖点。代理状态→宠物反应的映射通过两条路径实现：

1. **MCP 主动路径**：代理在编码过程中调用 `openpets_react`，传入 `thinking`/`editing`/`running`/`testing`/`waiting`/`success`/`error`/`celebrating` 等反应名。宠物窗口根据反应映射元数据切换动画行。
2. **Hooks 被动路径**（Claude Code 专用）：代理生命周期事件（如 PreToolUse、PostToolUse）自动触发对应反应，无需代理主动调用工具。

SDK 侧还暴露了 `agent:activity` 事件（`OpenPetsEventPayloads["agent:activity"]: { kind, reaction?, active, petId }`），让插件能订阅代理活动状态，实现更复杂的联动（如 Virtual Pet 插件在代理"working"时消耗更多能量）。

### 5.7 插件生命周期（`docs/plugins.md`）

插件运行时架构（`docs/plugins.md` 的 Runtime & sandbox 节）：

```
openpets.plugin.json ──validate──▶ plugin-service ──▶ plugin-runtime
                                                          │
                              ┌───────────────────────────┤
                              ▼                            ▼
                    declarative timers           plugin-js-host (sandbox)
                              │                            │  SDK calls (IPC, tokened)
                              └────────────┬───────────────┘
                                           ▼
                                  plugin-sdk-bridge
                          (permission + quota checks, then dispatch)
                                           ▼
              pet · schedule · storage · ui · audio · events · bus · ai · …
```

- `plugin-runtime.ts`：引擎。编译声明式定时器触发器、启停 JS host、校验权限、暴露公共命令/状态、标记损坏插件。
- `plugin-js-host.ts`：沙箱。隐藏 `BrowserWindow` + 每插件 session partition + navigation/window-open 加固 + SDK IPC token + 注册握手 + 配置监听清理 + teardown。插件 `index.js` 在此运行，与渲染层和主进程隔离。
- `plugin-sdk-bridge.ts`：沙箱与主机之间的门。校验路由、构建每插件 context、强制权限+配额、委派给聚焦的命名空间模块（`plugin-sdk-audio`/`-bus`/`-config`/`-events`/`-quotas`/`-routes`/`-state`/`-storage`/`-ui`，以及 `plugin-voice`/`plugin-oauth`/`plugin-secrets`/`plugin-ai-gateway`/`plugin-panels`/`plugin-pet-api`/`plugin-pet-registry`）。
- `plugin-state.ts`：原子 JSON 存储（`userData/openpets-plugin-state.json`），含已装插件、enabled 标志、已批准权限、配置、来源、损坏原因、更新元数据。
- `plugin-bubble-arbiter.ts`：transient vs pinned 气泡槽位的优先级与合并。

清单（`openpets.plugin.json`）当前版本 `manifestVersion: 3` / `sdkVersion: 3.x`，关键字段：`id`、`name`、`description`、`version`、`sdkVersion`、`runtime`（`javascript`）、`entry`、`permissions`、`configSchema`（text/number/boolean/select/time/date/secret/sound 字段，select 可选 `sprite-grid` 呈现）、`assets`、`commands`、`status`、`panels`、`network`、定时器触发器、本地化（`$t:` key）。

---

## 6. 可借鉴特性

### 6.1 MCP 工具设计

OpenPets 的 MCP 工具设计极为克制——**仅 3 个工具**，职责单一，输入严格校验，输出脱敏。其设计智慧在于：

- `openpets_status` 是"健康检查 + 目标确认"二合一，代理首调它确认连通性与目标宠物；
- `openpets_react` 与 `openpets_say` 分别覆盖"非语言反应"与"语言消息"两个正交维度；
- `saySchema` 的 5 层 refine 是"防 AI 泄密"的范本——代码、URL、路径、密钥全部拦截；
- `instructions` 字段在协议层约束代理行为。

**对 SpiritPal 的借鉴**：SpiritPal 的 `agentTools.ts` 当前是"让宠物执行系统操作"（打开应用、搜索网页），方向与 OpenPets 相反。可借鉴 OpenPets 的"代理→宠物"单向驱动模型，为 SpiritPal 增设 MCP server，让外部 AI 代理能驱动 SpiritPal 宠物做状态反应。

### 6.2 Plugin SDK 架构

OpenPets 的 SDK v3 架构有三层值得借鉴：

1. **描述型 UI**：插件描述气泡/HUD，主机渲染。原始 HTML/JS 不跨越 SDK 边界，从架构上杜绝了 XSS 与任意脚本注入。
2. **权限 + 配额双重门控**：清单声明 → 用户批准 → 运行时 bridge 逐调用校验 → 配额限制，四层纵深防御。
3. **纯类型包 + 沙箱注入**：SDK 是 types-only，运行时由主机注入 `OpenPetsPlugin` 全局。插件作者获得 IntelliSense，但包不进入插件产物。

**对 SpiritPal 的借鉴**：SpiritPal 的 `modManager.ts` 是 JSON 配置驱动（`pet_conf.json`/`act_conf.json`/`items_config.json`/`dialogue.json`），适合"换皮"，但不支持"加逻辑"。可借鉴 OpenPets 的描述型 UI + 权限模型，为 SpiritPal 设计轻量插件层。

### 6.3 8×9 Spritesheet 格式兼容性

**这是最直接的互操作点**。OpenPets 与 SpiritPal 的 spritesheet 格式完全同源：

| 属性 | OpenPets | SpiritPal（`types.ts:ATLAS`） |
|------|----------|---------------------------|
| 列数 | 8 | `cols: 8` |
| 行数 | 9 | `rows: 9` |
| 单帧宽 | 192 | `cellW: 192` |
| 单帧高 | 208 | `cellH: 208` |
| 整图 | 1536×1872 | 1536×1872 |
| 来源 | codexPet 生态 | OC-Claw codexPet 格式（注释明示） |

**结论**：两者的 spritesheet 在像素级完全兼容，宠物资源包理论上可互译（仅需适配 `pet.json` vs SpiritPal 的 `ANIMATION_ROWS` 行映射）。

### 6.4 代理状态层概念

OpenPets 把桌宠定位为"AI 编码代理的状态可视化层"，11 个反应全部面向编码场景（thinking/editing/running/testing/waiting/success/error/celebrating）。这一概念值得 SpiritPal 借鉴——SpiritPal 的 `ANIMATION_ROWS` 已经有 `waiting`(row 6)、`running`(row 7)、`review`(row 8) 三行编码向状态，可扩展为完整的"编码代理状态层"。

### 6.5 租约（Lease）多代理共存机制

当多个 AI 代理同时运行时，OpenPets 的 lease 机制让每只代理宠物独立运作而不互相踩踏。15 秒 TTL + 5 秒心跳 + 过期自动关窗的设计，天然适合"多代理并行编码"场景。

### 6.6 本地 IPC 安全模型

- discovery 文件 `0600` 权限 + `0700` 目录；
- token 每次启动轮换；
- 16 KB 消息上限；
- 连接 2 秒 / 响应 3 秒超时；
- 错误信息脱敏（抹去路径/socket/token）。

这套模型对 SpiritPal 的 Tauri `invoke` 桥接有参考价值——尤其当 SpiritPal 未来需要暴露本地 IPC 给外部进程时。

---

## 7. 与 SpiritPal 的异同及移植建议

### 7.1 整体差异对照

| 维度 | OpenPets | SpiritPal |
|------|----------|--------|
| **定位** | AI 编码代理的桌面状态层 | AI 桌宠应用（养成 + 代理工具） |
| **代理方向** | 代理 → 宠物（代理驱动宠物反应） | 宠物 → 系统（宠物执行系统操作） |
| **反应语义** | 11 个编码反应（thinking/editing/testing...） | 10 个养成状态（idle/walk/sleep/sit/eat/drag/happy/sad/sick/pet） |
| **MCP** | 有（3 工具，stdio server） | 无（agentTools 是 Tauri invoke 封装） |
| **插件** | SDK v3 代码插件（沙箱 + 权限） | JSON mod（数据配置，三层架构） |
| **图集** | 8×9 / 192×208 / 1536×1872（文档化） | 8×9 / 192×208 / 1536×1872（`ATLAS` 硬编码） |
| **壳层** | Electron | Tauri v2（Rust 后端） |

### 7.2 逐项移植建议

| 特性 | 优先级 | 对应 SpiritPal 现状文件 | 移植难度 | 建议 Phase | 建议 |
|------|--------|---------------------|----------|-----------|------|
| **8×9 spritesheet 互译** | **P0** | `spiritpal-app/src/lib/types.ts:ATLAS` | **极低** | Phase 1 | 两者格式已完全一致。建议在 SpiritPal 中增加 `pet.json` 解析器，使 SpiritPal 能直接加载 OpenPets 目录宠物包（仅需行映射：OpenPets reaction 名 → SpiritPal `ANIMATION_ROWS` 行号）。反向亦然。 |
| **编码反应行扩展** | **P0** | `spiritpal-app/src/lib/types.ts:ANIMATION_ROWS` | **低** | Phase 1 | SpiritPal 已有 `waiting`(row 6)/`running`(row 7)/`review`(row 8)。建议补全 `thinking`/`editing`/`testing`/`success`/`error`/`celebrating` 的行映射（可复用现有 9 行或扩展），使 SpiritPal 的 9 行 spritesheet 能覆盖 OpenPets 的 11 个编码反应。 |
| **MCP server（代理→宠物）** | **P1** | `spiritpal-app/src/lib/agentTools.ts` | **中** | Phase 2 | SpiritPal 当前 agentTools 是"宠物执行系统操作"。建议新增一个 MCP server（Rust 侧实现 stdio，或 TS 侧复用 `@modelcontextprotocol/sdk`），暴露 `spiritpal_status`/`spiritpal_react`/`spiritpal_say` 三工具，让外部 AI 代理能驱动 SpiritPal 宠物反应。Tauri 侧需开一个本地 IPC（参考 OpenPets 的 discovery + token 模型）。 |
| **MCP 输入校验（防泄密）** | **P1** | 新增（参考 `packages/mcp/src/tools.ts:saySchema`） | **低** | Phase 2 | 直接移植 OpenPets 的 5 层 zod refine（长度/单行/代码特征/URL 路径/密钥特征），防止 AI 代理通过 `say` 工具泄露代码或密钥到桌面气泡。 |
| **代理状态层概念** | **P1** | `spiritpal-app/src/lib/types.ts:PetState` | **中** | Phase 2 | 借鉴 OpenPets 把桌宠定位为"编码代理状态可视化层"。SpiritPal 可在现有养成状态之外，增设"编码模式"——当检测到 AI 代理活跃时，宠物自动切换到编码反应行（thinking/editing/testing...），与养成状态解耦。 |
| **租约（Lease）多代理机制** | **P2** | 无对应 | **高** | Phase 3 | 当 SpiritPal 需支持多代理同时驱动时移植。需在 Rust 后端实现 lease 表（TTL 15s、心跳 5s、过期清扫），并支持"代理宠物"窗口独立于"默认宠物"。Tauri 多窗口能力可承载此需求。 |
| **Plugin SDK（描述型 UI + 权限）** | **P2** | `spiritpal-app/src/lib/modManager.ts` | **高** | Phase 3 | SpiritPal 的 modManager 是 JSON 数据驱动，适合换皮。若要支持"加逻辑"插件，可借鉴 OpenPets 的描述型 bubble 描述符 + 权限模型。但 Tauri 无 BrowserWindow 沙箱，需用 WebView2/WKWebView 的隔离方案替代，难度较高。建议先用 JSON mod 满足 80% 需求。 |
| **本地 IPC 安全模型** | **P2** | Tauri `invoke`（进程内） | **中** | Phase 3 | 当 SpiritPal 需要暴露本地 IPC 给外部进程（MCP server）时移植。建议参考 OpenPets 的 discovery 文件 + token 轮换 + 消息大小上限 + 错误脱敏。Tauri 侧可用 Rust 实现 Unix socket / named pipe。 |
| **Hooks 自动反应** | **P2** | 无对应 | **中** | Phase 3 | 借鉴 OpenPets 的 Claude Code hooks 机制——代理生命周期事件（PreToolUse/PostToolUse）自动触发宠物反应，无需代理主动调用工具。SpiritPal 可在 MCP 集成稳定后增设。 |
| **pet.json 元数据格式** | **P1** | `spiritpal-app/src/lib/modManager.ts:PetConfJSON` | **低** | Phase 2 | SpiritPal 的 `pet_conf.json` 已含 `spriteAsset`/`spriteType`/`personality` 等。建议增加 `reactions` 字段（反应名→行号/帧率/循环映射），使 SpiritPal 能读取 OpenPets 风格的 `pet.json`，实现宠物包跨平台共享。 |
| **本地 Codex 宠物导入** | **P2** | `spiritpal-app/src/lib/modManager.ts`（已有 mod 导入） | **低** | Phase 3 | SpiritPal 已有 mod 导入能力。可借鉴 OpenPets 的 `~/.codex/pets/<pet-id>/` 约定，支持从该目录实时导入开发中的宠物，便于美术/开发者迭代。 |

### 7.3 移植路线图建议

- **Phase 1（格式互操作，P0）**：spritesheet 已兼容，仅需做行映射适配与 `pet.json` 解析。投入极小，收益极大——SpiritPal 可直接复用 OpenPets 生态的宠物资源包。
- **Phase 2（MCP 接入，P1）**：为 SpiritPal 增加 MCP server，让 AI 代理能驱动 SpiritPal 宠物。这是把 SpiritPal 从"养成桌宠"升级为"AI 编码伴侣"的关键一步，与 SpiritPal 自身的 AI 定位契合。
- **Phase 3（深度集成，P2）**：租约多代理、Plugin SDK、Hooks 自动反应。这些是 OpenPets 的进阶能力，适合在 SpiritPal MCP 验证稳定后逐步引入。

---

## 8. 总结与技术参考价值

### 8.1 OpenPets 的核心创新

OpenPets 的最大创新在于**重新定义了桌宠的产品定位**：桌宠不再是"被养成"的对象，而是"AI 编码代理的状态可视化层"。这一重新定位带来了三个连锁设计：

1. **反应语义编码化**：11 个反应全部面向编码场景（thinking/editing/testing/success/error...），而非养成场景（happy/sad/sick/hungry）。
2. **MCP 作为代理-宠物桥梁**：3 个极简 MCP 工具 + 严格输入校验 + 错误脱敏，构成了一条"代理状态→桌面可视化"的安全通道。
3. **租约机制支持多代理共存**：15 秒 TTL + 5 秒心跳的 lease 模型，让多只 AI 代理各驱动各的宠物窗口，互不踩踏。

### 8.2 对 SpiritPal 的核心参考价值

| 参考点 | 价值等级 | 说明 |
|--------|---------|------|
| **8×9 spritesheet 格式** | ⭐⭐⭐⭐⭐ | 两者已完全兼容，是最低成本的互操作点 |
| **MCP 工具设计（3 工具 + 防泄密校验）** | ⭐⭐⭐⭐⭐ | 直接可移植的"代理→宠物"驱动模型 |
| **代理状态层概念** | ⭐⭐⭐⭐ | 为 SpiritPal 的 `ANIMATION_ROWS` 编码行提供产品定位依据 |
| **Plugin SDK 描述型 UI** | ⭐⭐⭐ | 架构优雅，但 Tauri 无 BrowserWindow 沙箱，移植成本高 |
| **租约多代理机制** | ⭐⭐⭐ | 进阶能力，适合 SpiritPal 多代理场景成熟后引入 |
| **本地 IPC 安全模型** | ⭐⭐⭐ | discovery + token + 大小上限 + 脱敏，Tauri 侧可用 Rust 实现 |

### 8.3 关键结论

1. **SpiritPal 与 OpenPets 在 spritesheet 格式上是同源兼容的**——SpiritPal 的 `ATLAS = { cellW: 192, cellH: 208, cols: 8, rows: 9 }` 与 OpenPets 的 8×9 / 192×208 / 1536×1872 完全一致，均来自 codexPet 格式生态。这为两者的宠物资源包互译奠定了零成本基础。

2. **两者的"代理"方向相反但互补**——OpenPets 是"代理驱动宠物"（MCP 工具让代理控制宠物反应），SpiritPal 是"宠物驱动系统"（agentTools 让宠物执行系统操作）。SpiritPal 若能补齐"代理→宠物"方向（增设 MCP server），将形成完整的双向能力闭环。

3. **SpiritPal 的 `ANIMATION_ROWS` 已埋下编码状态钩子**——row 6 `waiting`、row 7 `running`、row 8 `review` 三行已经面向编码场景，与 OpenPets 的 `waiting`/`running` 反应同名。SpiritPal 只需补全 `thinking`/`editing`/`testing`/`success`/`error` 的行映射，即可完整支持 OpenPets 风格的编码代理状态层。

4. **OpenPets 的 pet-format 包是"文档化规范"而非"代码化 schema"**——`packages/pet-format/src/index.ts` 仅是标记接口，实际格式规范在 `openpets.dev/docs/pet-format`。这与 SpiritPal 在 `types.ts` 硬编码 `ATLAS` 常量的做法不同。SpiritPal 的硬编码方式更利于编译期类型检查，OpenPets 的文档化方式更利于运行时灵活性。两者各有所长。

5. **OpenPets 的安全设计值得系统学习**——从 MCP 输入的 5 层 zod refine，到 IPC 错误的路径/socket/token 脱敏，到插件的四层权限纵深（声明→批准→运行时校验→配额），到网络 fetch 的 SSRF 防护与 hostname 白名单，OpenPets 在"代理-宠物"这条链路上构筑了完整的防泄密防线。这对 SpiritPal 未来接入 MCP 尤为重要。

### 8.4 最终建议

SpiritPal 应优先落地 **Phase 1（spritesheet 互操作）** 与 **Phase 2（MCP server 接入）**——前者几乎零成本即可融入 OpenPets 宠物资源生态，后者是 SpiritPal 从"养成桌宠"升级为"AI 编码伴侣"的关键能力补齐。OpenPets 的 MIT 许可证与清晰的模块边界（`packages/mcp`、`packages/client` 可独立复用）为这种借鉴提供了法律与技术便利。

---

## 附录：分析的源文件清单

本报告基于以下 GitHub 在线源码文件分析（均通过 WebFetch 读取 `main` 分支原始文件）：

| # | 文件路径 | 用途 |
|---|---------|------|
| 1 | `README.md`（仓库主页） | 项目概览、工作区结构、SDK 表面、MCP 工具列表 |
| 2 | `LICENSE` | 确认 MIT 许可证 |
| 3 | `package.json`（根） | 工作区版本 3.3.0、MIT、pnpm 11、Node ≥20 |
| 4 | `packages/sdk/src/index.ts` | SDK v3 类型契约：权限、反应、气泡、UI、音频、事件 API（413 行） |
| 5 | `packages/mcp/src/index.ts` | MCP 服务器入口：lease 生命周期、心跳、重试、优雅关闭 |
| 6 | `packages/mcp/src/tools.ts` | MCP 工具处理器：status/react/say + zod 校验 + 脱敏 |
| 7 | `packages/mcp/src/server.ts` | MCP 工具注册：3 个工具 + instructions |
| 8 | `packages/client/src/index.ts` | IPC 客户端完整实现（206 行）：发现、请求、lease、showMedia |
| 9 | `packages/client/src/protocol.ts` | allowedReactions（11 个）、IPC 协议 v1、消息上限、超时 |
| 10 | `packages/pet-format/src/index.ts` | 仅标记接口（PetFormatPackageMarker） |
| 11 | `packages/pet-format/package.json` | 标记包 v3.3.0 |
| 12 | `codemap.md` | 仓库 Atlas：目录职责、架构数据流、入口点 |
| 13 | `docs/plugins.md` | 插件平台架构：清单、权限、沙箱、桥接、安装路径（245 行） |
| 14 | `openpets.dev/docs` | 官方文档：反应列表、宠物资源、租约、IPC、默认 vs 代理宠物 |

SpiritPal 对照文件：

| # | 文件路径 | 用途 |
|---|---------|------|
| 1 | `spiritpal-app/src/lib/types.ts`（前 30 行） | `ATLAS` 常量、`PetState`、`ANIMATION_ROWS`（9 行映射） |
| 2 | `spiritpal-app/src/lib/agentTools.ts`（前 80 行） | `APP_NAME_MAP`、`toolOpenApplication`、`toolSearchWeb` |
| 3 | `spiritpal-app/src/lib/modManager.ts`（前 80 行） | `PetConfJSON`/`ActConfJSON`/`ItemsConfJSON`/`DialogueConfJSON`/`CharacterMod` |
