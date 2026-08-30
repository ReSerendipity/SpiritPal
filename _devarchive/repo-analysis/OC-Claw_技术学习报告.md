# OC-Claw 开源仓库技术分析报告

> 仓库地址：https://github.com/rainnoon/oc-claw
> 分析日期：2026-07-11
> 分析分支：main
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，为后续跨平台桌面宠物 PRD 提供参考

---

## 目录

1. [项目概览](#1-项目概览)
2. [核心技术栈](#2-核心技术栈)
3. [项目架构与目录结构](#3-项目架构与目录结构)
4. [核心功能模块详解](#4-核心功能模块详解)
5. [技术实现细节](#5-技术实现细节)
6. [数据处理流程](#6-数据处理流程)
7. [UI/UX设计分析](#7-uiux设计分析)
8. [动画与渲染系统](#8-动画与渲染系统)
9. [AI/聊天集成分析](#9-ai聊天集成分析)
10. [构建与打包流程](#10-构建与打包流程)
11. [版本发布与迭代历史](#11-版本发布与迭代历史)
12. [社区与Issue概况](#12-社区与issue概况)
13. [优缺点分析](#13-优缺点分析)
14. [可借鉴特性](#14-可借鉴特性)
15. [潜在改进点](#15-潜在改进点)
16. [跨平台支持评估](#16-跨平台支持评估)
17. [总结与技术参考价值](#17-总结与技术参考价值)

---

## 1. 项目概览

OC-Claw 是一款桌面宠物应用，起源自 KAON Hackathon，定位为「监控 AI 编码代理的桌面伴侣」。它以可爱的桌面宠物形式停驻在 macOS 刘海区域或 Windows 任务栏，实时监控 Claude Code、Codex、Cursor、Gemini CLI 等 7 种 AI 编码代理的工作状态，同时提供完整的宠物养成系统（饥饿值、好感度、金币、食物、摸头、番茄钟）。项目采用 Tauri v2 + React 19 + TypeScript + Rust 技术栈，是 7 个项目中**唯一使用 Tauri v2 的项目**，也是**跨平台架构最现代的项目**。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | OC-Claw |
| 仓库地址 | https://github.com/rainnoon/oc-claw |
| 官网 | https://www.oc-claw.ai/ |
| 作者 | rainnoon |
| 许可证 | MIT（艺术资产附加非商业条款） |
| Stars | 324 |
| Open Issues | 5（已关闭 4，共 9） |
| 总提交数 | 527 |
| Releases | 33 |
| 最新版本 | v1.8.6（2026-06-08） |
| 创建时间 | 2026-03（KAON Hackathon） |
| 语言分布 | Rust 48.9% / TypeScript 44.0% / Astro 5.6% / CSS 0.8% / JS 0.4% / PowerShell 0.2% |
| Product Hunt | 已上榜 Featured |

### 当前状态

项目从 2026-03-20 v1.0.0 到 2026-06-08 v1.8.6，约 80 天内发布 33 个版本，平均 2.4 天/版本，开发极为活跃。最新版本支持 macOS + Windows 双平台，集成 7 种 AI 编码代理监控，拥有 12 个内置角色和完整的宠物养成系统。

---

## 2. 核心技术栈

### 前端（frontend/）

| 维度 | 技术选型 |
|------|----------|
| **桌面框架** | Tauri v2（`@tauri-apps/api` ^2.10.1, `@tauri-apps/cli` ^2.10.1） |
| **UI 框架** | React 19.2.4 + React DOM 19.2.4 |
| **类型系统** | TypeScript ~5.9.3 |
| **样式方案** | Tailwind CSS ^4.2.2（通过 `@tailwindcss/vite` 插件集成） |
| **动画库** | Motion ^12.38.0（即 Framer Motion 新版） |
| **构建工具** | Vite ^8.0.0 |
| **国际化** | i18next ^26.0.2 + react-i18next ^17.0.1（6 种语言：英/中/日/韩/西/法） |
| **图标库** | lucide-react ^0.577.0 |
| **Markdown 渲染** | react-markdown ^10.1.0 |
| **GIF 导出** | gif.js ^0.2.0 |
| **本地存储** | @tauri-apps/plugin-store ^2.4.2 |
| **开机自启** | @tauri-apps/plugin-autostart ^2.5.1 |
| **包管理器** | pnpm 9.15.1 |

### Rust 后端（frontend/src-tauri/）

| 维度 | 技术选型 |
|------|----------|
| **Rust 版本** | Edition 2021，最低 1.77.2 |
| **桌面框架** | Tauri v2（features: `macos-private-api`, `tray-icon`, `image-png`） |
| **异步运行时** | tokio 1（full features） |
| **HTTP 客户端** | reqwest 0.12（json feature） |
| **序列化** | serde / serde_json 1 |
| **数据库** | rusqlite 0.31（bundled，读取 opencode.db） |
| **文件监控** | notify 6 |
| **时间处理** | chrono 0.4 |
| **其他** | base64 0.22、dirs 5、percent-encoding 2 |
| **Tauri 插件** | tauri-plugin-log/store/dialog/autostart v2 |

### 平台特定依赖

**macOS：**
- `libc` 0.2
- `objc2` 0.6 + `block2` 0.6（Objective-C 互操作）
- `objc2-app-kit` 0.3（NSWindow/NSScreen/NSApplication/NSRunningApplication）
- `objc2-foundation` 0.3（NSGeometry/NSArray）
- `notify` 6 with `macos_kqueue` feature

**Windows：**
- `windows` 0.58（Win32_Foundation/System_Threading/Media_Audio/UI_WindowsAndMessaging/UI_Input_KeyboardAndMouse/System_Console/Graphics_Gdi/System_Diagnostics_ToolHelp/Media_Control/Foundation/Foundation_Collections）
- `encoding_rs` 0.8（解决 Cursor IDE 在 CJK Windows 上的 GBK→UTF-8 乱码问题）

### 网站与扩展

- **Astro**（官网 `website/` 目录）
- **VS Code Extension API** ^1.85.0（Cursor 终端聚焦扩展）

### 技术栈特征

- **Tauri v2 跨平台架构**：一套代码支持 macOS + Windows，利用各自原生 API 实现平台特性
- **Rust + TypeScript 双语言**：Rust 处理系统级操作（窗口管理、文件监控、Hook 通信），TypeScript 处理 UI 和业务逻辑
- **React 19 最新版**：采用 React 最新版本，享受并发渲染等新特性
- **Tailwind CSS v4**：使用最新版 Tailwind，通过 Vite 插件集成

---

## 3. 项目架构与目录结构

```
oc-claw/
├── assets/                          # README 用图片资源
├── extensions/
│   └── cursor/                      # Cursor VS Code 扩展
│       ├── package.json             # 扩展清单
│       ├── extension.js             # HTTP 服务器实现
│       └── icon.png
├── frontend/                        # 前端 + Tauri 项目根
│   ├── package.json
│   ├── src/                         # React 前端源码
│   │   ├── main.tsx                 # 入口（468 bytes）
│   │   ├── App.tsx                  # 主应用（674 bytes）
│   │   ├── Mini.tsx                 # ⭐ 核心窗口（321KB，最大文件）
│   │   ├── DemoMascot.tsx           # 演示宠物（15KB）
│   │   ├── index.css                # 全局样式（3KB）
│   │   ├── components/
│   │   │   ├── AgentDetailView.tsx       # Agent 详情视图（13KB）
│   │   │   ├── CharacterTab.tsx          # 角色管理标签页（35KB）
│   │   │   ├── ClaudeStatsView.tsx       # Claude Code 统计视图（16KB）
│   │   │   ├── CreateCharacterModal.tsx  # 创建角色弹窗（18KB）
│   │   │   ├── GifMakerTab.tsx           # GIF 制作工具（30KB）
│   │   │   ├── MiniPetMascot.tsx         # Mini 宠物形象（5KB）
│   │   │   ├── OnboardingModal.tsx       # 引导弹窗（9KB）
│   │   │   ├── PetContextMenu.tsx        # 右键菜单（20KB）
│   │   │   ├── PetPicker.tsx             # 宠物选择器（49KB）
│   │   │   ├── SettingsTab.tsx           # ⭐ 设置面板（77KB，第二大）
│   │   │   ├── SpritePet.tsx             # 精灵宠物（5KB）
│   │   │   └── UpdateModal.tsx           # 更新弹窗（6KB）
│   │   ├── lib/
│   │   │   ├── types.ts             # 类型定义（2.2KB）
│   │   │   ├── store.ts             # 设置存储（6.2KB）
│   │   │   ├── petStore.ts          # 宠物数据存储（11KB）
│   │   │   ├── agents.ts            # Agent 工具函数（1.4KB）
│   │   │   ├── codexPet.ts          # Codex 宠物配置（6.3KB）
│   │   │   └── pipeline.ts          # GIF 制作流水线（1.4KB）
│   │   ├── utils/
│   │   │   ├── spriteUtils.ts       # 精灵图工具（7.2KB）
│   │   │   ├── gifExport.ts         # GIF 导出（4.4KB）
│   │   │   └── nanoBanana.ts        # Nano Banana 工具（3.3KB）
│   │   └── i18n/                    # 国际化资源
│   ├── src-tauri/                   # Rust 后端
│   │   ├── Cargo.toml               # 依赖配置（2KB）
│   │   ├── Cargo.lock               # 依赖锁（156KB）
│   │   ├── tauri.conf.json          # Tauri 配置（1.6KB）
│   │   ├── build.rs                 # 构建脚本（37 bytes）
│   │   ├── Info.plist               # macOS 配置（227 bytes）
│   │   ├── capabilities/
│   │   │   └── default.json         # Tauri v2 权限配置
│   │   ├── icons/                   # 应用图标
│   │   └── src/
│   │       ├── main.rs              # 入口（177 bytes，仅调用 lib）
│   │       └── lib.rs               # ⭐⭐ 全部后端逻辑（755KB 单文件）
│   └── public/assets/
│       ├── backgrounds/             # 岛屿背景图片
│       └── builtin/                 # 内置角色资源
│           ├── characters.json      # 角色默认配置
│           ├── pets-manifest.json   # 宠物清单
│           ├── doro.codex-pet/      # Codex 宠物：doro
│           ├── phoebe.codex-pet/    # Codex 宠物：phoebe
│           ├── elaina-2/            # 角色：伊蕾娜
│           ├── homie/               # 角色：homie
│           ├── linnea-2/            # 角色：linnea
│           ├── mambo/               # 角色：曼波
│           ├── naruto/              # 角色：鸣人
│           ├── nezuko/              # 角色：祢豆子
│           ├── skirk-2/             # 角色：丝柯克
│           ├── taffy/               # 角色：塔菲
│           ├── wukong/              # 角色：悟空
│           └── 香企鹅/               # 默认角色
├── website/                         # Astro 官网
├── README.md / README.zh.md / 等    # 6 种语言 README
├── CLAUDE.md                        # ⭐ AI 开发上下文文档（详细实现笔记）
├── install.sh / install.ps1         # 安装脚本
└── LICENSE                          # MIT
```

### 架构特征

- **前后端分离**：React 前端 + Rust 后端，通过 Tauri IPC 通信
- **755KB 单文件 Rust 后端**：所有后端逻辑集中在 `lib.rs` 一个文件中，包含 SSH 隧道、hook 事件处理、窗口管理、文件监控、SQLite 读取等全部功能
- **组件化前端**：13 个核心组件，按功能域划分
- **CLAUDE.md 文档**：专门的 AI 开发上下文文档，记录详细实现笔记和已踩坑点

---

## 4. 核心功能模块详解

### 4.1 Code Mode（编码模式）— AI 代理监控

OC-Claw 的核心差异化功能是**监控 7 种 AI 编码代理**的工作状态：

| AI 代理 | 监控方式 | 说明 |
|---------|----------|------|
| **OpenClaw** | JSONL session 文件轮询 | 本地自动发现 |
| **Claude Code** | Hooks 监听 | 通过 hook 事件 |
| **Codex** | Hooks 监听 | Windows 也支持 hook 集成 |
| **Cursor** | Hooks + VS Code 扩展 | 最复杂的集成 |
| **OpenCode** | session 跟踪 + opencode.db | SQLite 读取 token 统计 |
| **Gemini CLI** | Hooks + 本地 telemetry | token 统计 |
| **Hermes Agent** | Plugin 监听 | 支持远程 SSH |

**实时状态：** working（工作中）、idle（空闲）、waiting（等待用户审批）、completed（完成）

### 4.2 Pet Mode（宠物模式）— 桌面宠物养成

完整的宠物养成系统：

| 系统 | 参数 | 说明 |
|------|------|------|
| **饥饿值** | 0-100，每小时衰减 2，睡眠时衰减 1，离线下限 10 | 食物补充 |
| **好感度** | 0-100，每日衰减 5，饥饿时额外每小时衰减 2 | 摸头/食物提升 |
| **金币系统** | 每日礼物 20-60 随机，番茄钟每分钟 1 金币 | 购买食物 |
| **食物系统** | 肉🍖 +15 饥饿/8 金币，奶茶🧋 +8 饥饿/+3 好感/6 金币 | 商店购买 |
| **摸头系统** | 每日限 5 次，每次 +2 好感度 | 交互限制 |
| **番茄钟** | 预设 15/25/45/60 分钟 | 生产力工具 |
| **好感度等级** | angry（<20）/ cold（20-49）/ happy（50-79）/ shy（≥80） | 4 级分级 |

**18 种宠物动作**：idle/sleep/work/study/watch/music/walk/dance/eat/hungry/headpat/farewell/grasp/angry/spin/milktea/rest/peek/walkout

### 4.3 刘海停驻 / 任务栏停驻

- **macOS**：宠物停驻在刘海区域（notch island），悬停展开详情面板
- **Windows**：宠物停驻在任务栏区域

### 4.4 角色系统

- **12 个内置角色**：香企鹅（默认）、doro、elaina、homie、linnea、mambo、naruto、nezuko、phoebe、skirk、taffy、wukong
- 按 IP 分组（原神/崩坏3/赛马娘/鬼灭之刃等）
- 支持自定义角色（GIF 制作器 + Gemini API）
- 不同 Agent 可配对不同角色
- 多宠物模式（v1.8.6 新增）：主宠物 + 额外宠物列表管理

### 4.5 GIF 制作工具

- 使用 Gemini API 生成角色
- 色键抠图处理
- gif.js 导出 GIF 动画

---

## 5. 技术实现细节

### 5.1 Tauri v2 窗口管理

**tauri.conf.json 配置要点：**

```json
{
  "identifier": "com.openclaw.ooclaw",
  "app": {
    "windows": [{
      "label": "mini",
      "width": 60,
      "height": 45,
      "x": -9999,
      "y": -9999,
      "transparent": true,
      "decorations": false,
      "alwaysOnTop": true,
      "skipTaskbar": true,
      "url": "index.html#/mini"
    }],
    "macOSPrivateApi": true
  }
}
```

- 主窗口 `mini`：60×45 像素，初始位置 (-9999, -9999) 屏幕外
- `transparent: true`、`decorations: false`、`alwaysOnTop: true`、`skipTaskbar: true`
- `macOSPrivateApi: true`（启用 macOS 私有 API 实现透明窗口）
- CSP 设为 null（允许所有来源）

**窗口标签**：`pet`、`detail`、`mini`、`room`、`demo-mascot-*`、`extra-mascot-*`

### 5.2 Rust 后端架构（755KB 单文件 lib.rs）

后端全部逻辑集中在 `frontend/src-tauri/src/lib.rs`（755,512 bytes），`main.rs` 仅 177 Bytes 作为入口。

**核心功能模块：**

| 功能域 | 关键函数 | 说明 |
|--------|----------|------|
| **Claude Code 集成** | `process_claude_event()` | 处理 CC/Codex/Cursor 的 hook 事件 |
| **会话管理** | `get_claude_sessions()` | 获取会话列表，标记 `isActiveTab` |
| **终端检测** | `get_active_ghostty_terminal_id()` | 检测 Ghostty 是否前台 |
| **Cursor 窗口聚焦** | `focus_cursor_terminal()` | 通过绑定的端口聚焦 Cursor 窗口 |
| **Cursor 工作区激活** | `activate_cursor_workspace_window()` | AppleScript fallback |
| **Hook 安装** | `install_claude_hooks()` / `install_codex_hooks()` / `install_cursor_hooks()` | 每次启动重新生成 hook 脚本 |
| **角色扫描** | `scan_characters` | 扫描内置+自定义角色 |
| **本地 HTTP** | `read_local_http_response()` | 读取 Cursor 扩展的 HTTP 响应 |
| **SSH** | `ssh_exec()` | 远程执行命令 |

### 5.3 Hook 系统与数据处理流程

```
OpenClaw Agents ──→ JSONL session 文件 ──→ 健康轮询 ──→ 活动状态
Claude Code     ──→ Hooks ──→ 事件解析 ──→ 活动状态
Codex           ──→ Hooks ──→ 事件解析 ──→ 活动状态
Cursor          ──→ Hooks + VS Code扩展 ──→ 事件解析 ──→ 活动状态
Gemini CLI      ──→ Hooks + 本地telemetry ──→ 事件解析 ──→ 活动状态
Hermes Agent    ──→ Plugin ──→ 事件解析 ──→ 活动状态
                                    ↓
                              动画精灵 ← 状态机 ← 提示音效
```

**Hook 通信机制：**
- **Unix**：Unix Domain Socket `/tmp/occlaw-cursor.sock`
- **Windows**：TCP `127.0.0.1:19284`
- Hook 脚本由 Rust 后端在每次启动时重新生成（确保更新生效）

### 5.4 Cursor HTTP 扩展集成机制

**`extensions/cursor/extension.js` 完整实现：**

每个 Cursor 窗口启动一个 HTTP 服务器（端口 23456-23460），提供 3 个端点：

| 端点 | 方法 | 功能 |
|------|------|------|
| `/window-meta` | GET | 返回窗口元数据：port、focused、workspaceName、workspaceRoots、nativeHandle |
| `/focus-window` | POST | 聚焦当前窗口的终端/编辑器 |
| `/focus-tab` | POST | 按 PID 聚焦终端标签 |

**会话绑定机制：**
1. 通过匹配 session `cwd` 与 `/window-meta` 返回的 `workspaceRoots` 绑定
2. 最长前缀匹配获胜，优先选择已绑定端口/当前聚焦窗口
3. 绑定后存储 `nativeHandle`（唯一窗口标识符）到 `ClaudeSession.cursor_native_handle`
4. 后续重绑定时优先匹配 native handle

**窗口聚焦策略（macOS）：**
1. VSCode 命令 `workbench.action.focusWindow`
2. `osascript` 通过 System Events 执行 `AXRaise`（利用 Cursor 进程已有的 AX 权限，绕过 oc-claw 自身缺乏 AX 权限的问题）
3. 激活终端 `terminal.show(false)` 或编辑器

**为什么用 HTTP 而非 URI scheme：**
- `cursor://` URI 每次触发"是否信任此扩展"确认对话框
- HTTP 静默无感，且能通过端口区分多窗口

### 5.5 Source 只升级不降级机制

Cursor 和 CC 的 hook 事件同时触发时的关键设计：

- **Source 只升级不降级**：一旦 session.source 为 `"cursor"`，忽略 CC 将其改回 `"cc"` 的尝试
- **cwd 只在非空时覆盖**：CC hook 事件常带空 `cwd: ""`，不能覆盖 Cursor 提供的 cwd

```rust
// 伪代码示意
if session.source == "cursor" && new_source == "cc" {
    // 忽略降级
} else {
    session.source = new_source;
}
if !new_cwd.is_empty() {
    session.cwd = new_cwd;
}
```

### 5.6 跨平台 URI 协议差异

| 平台 | 协议 |
|------|------|
| macOS | `localasset://localhost` / `customasset://localhost` |
| Windows | `http://localasset.localhost` / `http://customasset.localhost` |
| 开发模式 | `/assets/builtin` / `/assets/custom` |

WebView2 的 URI 映射差异需要在 `store.ts` 中检测平台选择正确前缀。

---

## 6. 数据处理流程

### 6.1 数据流架构

```
AI 代理 Hook 事件 ──→ Rust 后端（lib.rs）
                         ├─→ 事件解析（process_claude_event）
                         ├─→ 会话状态管理
                         ├─→ 文件系统监控（notify）
                         └─→ SQLite 读取（rusqlite，opencode.db）
                              ↓
                    Tauri IPC（emit/listen）
                              ↓
                    React 前端（Mini.tsx）
                         ├─→ 状态机驱动动画
                         ├─→ 宠物养成数据更新
                         └─→ UI 渲染
                              ↓
                    本地持久化（plugin-store）
                         ├─→ settings.json
                         └─→ pet-data.json
```

### 6.2 状态管理

- 使用 `@tauri-apps/plugin-store` 进行本地持久化（`settings.json` + `pet-data.json`）
- 两个 store：`store.ts`（应用设置）和 `petStore.ts`（宠物养成数据）
- 通过 Tauri 事件系统 `emit`/`listen` 跨组件通信（如 `character-changed` 事件）

### 6.3 会话排序优先级

waiting > completed > working > idle，然后按 `updatedAt` 排序

### 6.4 Hook 事件类型

**Claude Code Hook（8 种事件）：**
SessionStart、UserPromptSubmit、PreToolUse、PostToolUse、PermissionRequest、Stop、StopFailure、SubagentStop

**Cursor Hook（10 种事件，归一化映射到 CC）：**
beforeSubmitPrompt → UserPromptSubmit、stop → Stop、beforeShellExecution → PreToolUse、afterShellExecution → PostToolUse、beforeMCPExecution、afterMCPExecution、afterFileEdit、beforeReadFile、afterAgentThought、afterAgentResponse

---

## 7. UI/UX设计分析

### 7.1 界面布局

- **主窗口（Mini.tsx）**：60×45 像素的迷你窗口，包含宠物动画
- **详情面板**：悬停展开，显示会话列表、权限弹窗、完成弹窗
- **设置面板（SettingsTab.tsx）**：77KB，应用设置的核心
- **角色管理（CharacterTab.tsx）**：35KB，角色选择和管理
- **宠物选择器（PetPicker.tsx）**：49KB，支持多宠物模式
- **右键菜单（PetContextMenu.tsx）**：20KB，上下文菜单

### 7.2 设计风格

- **Tailwind CSS v4**：原子化 CSS，快速构建一致 UI
- **Motion v12**：流畅的动画过渡效果
- **lucide-react**：一致的图标风格
- **岛屿背景**：草地岛屿设计灵感来自 Notchi
- **刘海停驻**：macOS 刘海区域作为宠物停驻点，悬停展开详情

### 7.3 国际化

- 6 种语言支持：英语、中文、日语、韩语、西班牙语、法语
- i18next + react-i18next
- 6 种语言的 README 文件

---

## 8. 动画与渲染系统

### 8.1 双模式动画系统

OC-Claw 支持两种动画模式：

1. **精灵图动画（SpritePet）**：传统精灵图序列帧
2. **视频动画（大宠物模式，v1.8.0+）**：使用 `.mov` 视频文件（H.264 with alpha）

### 8.2 视频双缓冲动画实现（核心创新）

Pet Mode 的大宠物使用 `.mov` 视频文件实现动画。核心技术难点与解决方案：

**问题：**
1. `vid.load()` 会同步立即清除帧缓冲 → 单个 `<video>` 切换动画时闪白
2. WebKit 的 `drawImage()` 对 `.mov` alpha 透明帧的捕获不可靠 → Canvas 快照方案失败

**解决方案 — 双缓冲视频：**
- 两个 `<video>` 元素（A 和 B）堆叠
- 仅前缓冲可见（`visibility`）
- 切换动画时：新源加载到后缓冲 → `playing` 事件触发后交换（后变前，旧前暂停）
- 旧动画全程可见，零空白帧

**关键禁忌：**
- **绝不在交换时清除旧缓冲的 source**：`removeAttribute('src') + load()` 会同步清除帧缓冲，但 `setActiveBuffer()` 触发异步 React render，执行顺序为 (1) 排队 render → (2) 立即清除帧 → (3) React 渲染 `visibility: hidden`，导致空白闪烁。只调用 `old.pause()` 即可。

### 8.3 18 种宠物动作

idle/sleep/work/study/watch/music/walk/dance/eat/hungry/headpat/farewell/grasp/angry/spin/milktea/rest/peek/walkout

这些动作与 AI 代理状态和宠物养成数据联动：
- AI 代理 working → 宠物 work 动画
- AI 代理 waiting → 宠物 peek 动画
- 饥饿值低 → hungry 动画
- 好感度高 → shy 动画

### 8.4 GIF 制作工具

- 使用 Gemini API 生成角色素材
- 色键抠图处理（nanoBanana 工具）
- gif.js 导出 GIF 动画
- 支持自定义角色创建

---

## 9. AI/聊天集成分析

### 9.1 AI 代理监控（非聊天集成）

OC-Claw 的 AI 集成方向与其他项目不同——它不是让宠物本身具备 AI 聊天能力，而是**监控外部 AI 编码代理的工作状态**，以宠物行为反映 AI 工作进度。

### 9.2 监控的 AI 代理

| AI 代理 | 集成深度 | 特色功能 |
|---------|----------|----------|
| **Claude Code** | Hooks（8 种事件） | 会话列表、用量统计 |
| **Codex** | Hooks | Windows PowerShell 脚本 |
| **Cursor** | Hooks + VS Code 扩展 | 最复杂：10 种事件 + HTTP 服务器 + 窗口聚焦 |
| **OpenClaw** | JSONL 轮询 | 本地自动发现 |
| **OpenCode** | session + SQLite | opencode.db token 统计 |
| **Gemini CLI** | Hooks + telemetry | 本地 token 统计 |
| **Hermes Agent** | Plugin | 远程 SSH 支持 |

### 9.3 AI 驱动的宠物行为

- AI 代理 working → 宠物 work 动画 + 提示音效
- AI 代理 waiting → 宠物 peek 动画（等待用户审批）
- AI 代理 completed → 宠物 farewell 动画 + 完成弹窗
- AI 代理 idle → 宠物 idle 动画

### 9.4 Gemini API 用于角色创建

GIF 制作工具使用 Gemini API 生成角色素材，是 AI 能力在角色创作方面的应用。

---

## 10. 构建与打包流程

### 10.1 Tauri v2 打包配置

**macOS：**
- DMG 安装器（自定义背景图，660×400 窗口）
- `macOSPrivateApi: true` 启用透明窗口
- Info.plist 配置

**Windows：**
- NSIS 安装器（installMode: both）
- `encoding_rs` 处理 GBK→UTF-8 编码

### 10.2 资源映射

- `public/assets` → `assets/`
- `extensions/cursor` → `extensions/cursor/`

### 10.3 权限配置（capabilities/default.json）

允许窗口操作：create/show/hide/close/set-focus/start-dragging/set-position/set-size/inner-size/outer-position/scale-factor

### 10.4 构建

```bash
# 开发
pnpm tauri dev

# 生产构建
pnpm tauri build
```

### 10.5 CI/CD

- install.sh / install.ps1 安装脚本
- GitHub Releases 自动发布
- 33 个 Release，平均 2.4 天/版本

---

## 11. 版本发布与迭代历史

### 主要版本里程碑

| 版本 | 日期 | 关键变更 |
|------|------|----------|
| **v1.0.0** | 2026-03-20 | 首发版本，macOS 刘海宠物，支持 OpenClaw + Claude Code |
| **v1.1.0** | 2026-03-20 | 内置角色（胡桃/可莉/七七/塔菲）、`localasset://` 协议、API key 安全 |
| **v1.2.1** | 2026-03-23 | SSH 时区修复、clip-path 面板动画（Notchi 风格） |
| **v1.3.0** | 2026-03-24 | 角色按 IP 分组、characters.json 配置 |
| **v1.4.0** | 2026-03-25 | 多 OpenClaw 实例管理、Claude Code 用量统计 |
| **v1.4.3** | 2026-03-26 | 岛屿背景选择器 + 裁剪工具 |
| **v1.5.0** | 2026-03-26 | 自定义 DMG 安装器、SSH 轮询竞态修复 |
| **v1.5.3** | 2026-03-27 | **首个 Windows 正式版**，修复 GIF 加载/hook 编码/TCP 超时 |
| **v1.6.0-v1.6.2** | 2026-03-27 | Windows 自动更新测试 |
| **v1.7.0** | 2026-04-12 | 效率模式、IME 修复、会话详情改进（macOS） |
| **v1.8.0** | 2026-04-22 | **大宠物模式**（.mov 视频动画） |
| **v1.8.2** | 2026-04-30 | Windows 支持大宠物 |
| **v1.8.5** | 2026-06-06 | Cursor 多窗口精确聚焦、Hermes 远程 SSH、6 语言 i18n 完善 |
| **v1.8.6** | 2026-06-08 | OpenCode 集成、多宠物模式、Windows Codex hook |

### 发布节奏

从 2026-03-20 v1.0.0 到 2026-06-08 v1.8.6，约 80 天内发布 33 个版本，**平均 2.4 天/版本**，开发非常活跃。

---

## 12. 社区与Issue概况

### Open Issues（5 个）

| Issue | 标题 | 类型 |
|-------|------|------|
| #13 | demo video | 文档（作者自提） |
| #11 | 支持自定义 SSH 端口 | enhancement |
| #8 | SSH 连接泄漏：ControlMaster 多路复用失败 | bug |
| #4 | 扩展角色库 + 多会话随机分配 | enhancement |
| #3 | 集成 Tianji 匿名使用分析 | enhancement |

### Closed Issues（4 个）

已解决的多连接管理、Claude 用量统计、提示音触发、SSH 稳定性

### 社区

- 感谢 LINUX DO 社区支持
- Product Hunt 已上榜 Featured
- 致谢项目：[Notchi](https://github.com/sk-ruban/notchi)、[Vibe Island](https://github.com/vibeislandapp/vibe-island)

---

## 13. 优缺点分析

### 优点

1. **Tauri v2 跨平台架构**：7 个项目中唯一使用 Tauri v2 的项目，macOS + Windows 双平台支持
2. **视频双缓冲动画**：解决了 `.mov` alpha 视频切换闪白问题，是技术创新点
3. **AI 代理监控生态**：支持 7 种 AI 编码代理，集成深度业界领先
4. **Cursor 集成最复杂**：Hook 系统 + VS Code 扩展 + HTTP 服务器 + 窗口聚焦，工程设计精良
5. **React 19 + TypeScript**：采用最新前端技术栈，类型安全
6. **开发极其活跃**：80 天 33 个版本，平均 2.4 天/版本
7. **CLAUDE.md 文档**：专门的 AI 开发上下文文档，记录详细实现笔记和已踩坑点
8. **完整养成系统**：饥饿值/好感度/金币/食物/摸头/番茄钟
9. **6 语言国际化**：英/中/日/韩/西/法
10. **MIT 许可证**：商业友好

### 缺点

1. **755KB 单文件 Rust 后端**：所有逻辑集中在 `lib.rs`，可维护性差
2. **无移动端支持**：Tauri v2 虽支持移动端，但项目未实现
3. **无自动化测试**：未发现测试文件
4. **AI 代理监控过于特化**：功能高度绑定 AI 编码场景，通用性受限
5. **无 LLM 聊天集成**：宠物本身不具备 AI 聊天能力
6. **Linux 未支持**：仅 macOS + Windows
7. **Cursor 扩展需手动 Reload**：每次更新需用户手动 Reload Window

---

## 14. 可借鉴特性

### 14.1 Tauri v2 跨平台架构

OC-Claw 是 Tauri v2 跨平台桌面宠物的成功案例：
- 一套代码支持 macOS + Windows
- 平台特定 API 通过条件编译处理
- `macOSPrivateApi` 实现透明窗口
- Tauri IPC 实现前后端通信

### 14.2 视频双缓冲动画

解决 `.mov` alpha 视频切换闪白问题的方案，两个 `<video>` 元素堆叠 + `playing` 事件触发交换。这一技术可直接复用于任何需要视频动画的桌面宠物项目。

### 14.3 Hook 系统设计

- 事件名归一化映射（Cursor 的 `beforeSubmitPrompt` → CC 的 `UserPromptSubmit`）
- Source 只升级不降级机制
- cwd 只在非空时覆盖
- 每次启动重新生成 hook 脚本

### 14.4 CLAUDE.md AI 开发文档

专门的 AI 开发上下文文档，记录详细实现笔记和已踩坑点（10 个已踩坑点），是 AI 辅助开发的最佳实践。

### 14.5 跨平台 URI 协议处理

```typescript
// 平台检测选择正确前缀
const assetPrefix = platform === 'macos'
  ? 'localasset://localhost'
  : 'http://localasset.localhost';
```

### 14.6 Tauri v2 窗口配置

透明无边框置顶窗口的标准配置：
```json
{
  "transparent": true,
  "decorations": false,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "macOSPrivateApi": true
}
```

### 14.7 完整养成系统

饥饿值/好感度/金币/食物/摸头/番茄钟的完整设计，虽然不如 DyberPet 复杂，但更加精炼。

---

## 15. 潜在改进点

1. **拆分 Rust 后端**：将 755KB 的 `lib.rs` 按功能模块拆分
2. **添加移动端支持**：Tauri v2 支持 iOS/Android，可扩展到移动端
3. **添加 LLM 聊天**：宠物本身具备 AI 聊天能力，而非仅监控外部 AI
4. **Linux 支持**：Tauri v2 支持 Linux，可扩展
5. **添加自动化测试**：为核心模块添加单元测试
6. **Cursor 扩展自动重载**：解决每次更新需手动 Reload Window 的问题
7. **角色模组系统**：开放模组创建标准，支持社区贡献角色
8. **通用化**：降低对 AI 编码场景的依赖，支持更多通用桌面宠物场景

---

## 16. 跨平台支持评估

| 平台 | 支持度 | 说明 |
|------|--------|------|
| **macOS** | ✅ 完整支持 | 主力平台，刘海停驻、objc2 原生 API、AppleScript 窗口聚焦 |
| **Windows** | ✅ 完整支持 | v1.5.3 起正式支持，任务栏停驻、Win32 API、PowerShell hook |
| **Linux** | ❌ 未支持 | Tauri v2 支持 Linux，但项目未实现 |
| **移动端** | ❌ 未支持 | Tauri v2 支持 iOS/Android，但项目未实现 |

### macOS 实现细节

- 使用 `objc2` + `objc2-app-kit` 直接调用 NSWindow/NSScreen/NSApplication
- `macOSPrivateApi: true` 启用透明窗口
- 通过 AppleScript + System Events 实现 `AXRaise` 窗口聚焦
- Ghostty 终端活动标签检测：`get_active_ghostty_terminal_id()`
- 文件监控使用 `macos_kqueue` feature
- AX 权限与代码签名绑定：每次 `tauri build` 重新签名会使之前的 AX 授权失效

### Windows 实现细节

- 使用 `windows` crate 调用 Win32 API
- `encoding_rs` 处理 Cursor IDE 在 CJK Windows 上的 GBK→UTF-8 乱码
- Hook 脚本使用 PowerShell（非 Python/bash）
- TCP Socket（`127.0.0.1:19284`）替代 Unix Domain Socket
- v1.8.2 起允许 Windows 使用大宠物（之前仅 macOS）
- v1.5.3 起修复多项 Windows 特有问题：NSIS 安装器权限、UTF-8 编码、TCP 超时等

### 跨平台迁移到移动端的可行性

**Tauri v2 本身支持移动端**（iOS/Android），因此 OC-Claw 的技术栈是 7 个项目中最适合迁移到移动端的：

| 迁移维度 | 可行性 | 说明 |
|----------|--------|------|
| UI 层 | ⭐⭐⭐⭐⭐ | React + Tailwind 可直接复用 |
| 窗口管理 | ⭐⭐⭐ | 需适配移动端窗口模型（无多窗口） |
| Hook 系统 | ⭐ | 移动端无 AI 编码代理，需重新设计功能 |
| 养成系统 | ⭐⭐⭐⭐⭐ | 业务逻辑可直接复用 |
| 视频动画 | ⭐⭐⭐⭐ | HTML5 `<video>` 在移动端 WebView 可用 |
| 本地存储 | ⭐⭐⭐⭐ | Tauri plugin-store 支持移动端 |

---

## 17. 总结与技术参考价值

### 项目定位

OC-Claw 是 7 个项目中**技术栈最现代、跨平台架构最成熟**的项目。它以 Tauri v2 + React 19 + TypeScript + Rust 构建了一套真正意义上的跨平台桌面宠物框架，并通过 AI 代理监控这一创新场景实现了差异化定位。

### 核心技术价值

1. **Tauri v2 跨平台范本**：macOS + Windows 双平台实现的最佳实践
2. **视频双缓冲动画**：解决 `.mov` alpha 视频切换闪白的技术创新
3. **Hook 系统工程设计**：事件名归一化、Source 只升级不降级、每次启动重新生成
4. **Cursor 集成方案**：HTTP 服务器 + 端口绑定 + nativeHandle 持久化的完整方案
5. **CLAUDE.md AI 开发文档**：AI 辅助开发的最佳实践

### 对跨平台项目的参考意义

| 参考维度 | 价值 | 说明 |
|----------|------|------|
| Tauri v2 架构 | ⭐⭐⭐⭐⭐ | 直接复用跨平台方案 |
| 视频动画 | ⭐⭐⭐⭐⭐ | 双缓冲方案可直接复用 |
| 窗口配置 | ⭐⭐⭐⭐⭐ | 透明无边框置顶标准配置 |
| 养成系统 | ⭐⭐⭐⭐ | 精炼但完整的养成设计 |
| Hook 系统 | ⭐⭐⭐ | 过于特化于 AI 编码场景 |
| 移动端迁移 | ⭐⭐⭐⭐ | Tauri v2 支持移动端，技术栈可复用 |
| UI 框架 | ⭐⭐⭐⭐⭐ | React + Tailwind 跨平台通用 |

### 致谢与参考项目

- [Notchi](https://github.com/sk-ruban/notchi) — 刘海伴侣概念和草地岛屿设计灵感
- [Vibe Island](https://github.com/vibeislandapp/vibe-island) — 交互设计参考
- KAON Hackathon — 项目起源

---

> **报告结论**：OC-Claw 是跨平台桌面宠物技术栈的最佳参考项目。其 Tauri v2 + React 19 + TypeScript + Rust 的技术选型、视频双缓冲动画创新、以及完整的跨平台实现细节，为「桌面端+移动端通用桌面宠物」项目提供了直接可复用的技术方案。虽然其 AI 代理监控功能过于特化，但底层架构和养成系统设计具有高度通用价值。
