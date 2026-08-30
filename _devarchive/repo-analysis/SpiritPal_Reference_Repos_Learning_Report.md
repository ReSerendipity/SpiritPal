# SpiritPal 新参考仓库学习报告

> 本文档对从 GitHub 搜索并克隆的 6 个高质量桌面宠物开源仓库进行全面分析，整合对 SpiritPal 项目的优化建议和集成方案。
>
> 生成时间：2026-07-23

---

## 目录

1. [仓库概述](#一仓库概述)
2. [技术分析](#二技术分析)
3. [可借鉴点](#三可借鉴点)
4. [集成建议](#四集成建议)
5. [总结与行动指南](#五总结与行动指南)

---

## 一、仓库概述

### 1.1 筛选标准

本次搜索以 "desktop pet"、"Tauri pet"、"AI pet"、"live2d pet"、"interactive pet"、"cross-platform pet" 等关键词在 GitHub 搜索，筛选条件：
- 排除本地已有的 15 个仓库（BongoCat, DyberPet, Mate-Engine, RunCat365, VPet, ameath_DesktopPet, Dororo, EchoBot, Feibi_desktop, MurasamePet, oc-claw, Open-LLM-VTuber, openpets, super-agent-party, WindowPet）
- 优先选择与 SpiritPal 技术栈（Tauri v2 + React + TypeScript + Rust + Live2D）相似的项目
- 关注功能特性：AI 交互、养成系统、跨平台支持、模组扩展、窗口管理
- 确保仓库活跃维护、有实际功能实现、代码质量合格

### 1.2 仓库总览

| # | 仓库名称 | GitHub 地址 | 技术栈 | 主要特点 | 与 SpiritPal 相关性 |
|---|---------|-----------|--------|---------|----------------|
| 1 | **CodeWalkers** | [you-want/CodeWalkers](https://github.com/you-want/CodeWalkers) | Tauri v2 + React + Rust | 像素级点击穿透、PTY AI 终端、自由漫游 | ⭐⭐⭐⭐⭐ |
| 2 | **Live2DPet** | [x380kkm/Live2DPet](https://github.com/x380kkm/Live2DPet) | Electron + Live2D + VOICEVOX | AI 视觉感知、关键帧记忆、情绪系统 | ⭐⭐⭐⭐⭐ |
| 3 | **AI-Desktop-Pet** | [ruguo0119/AI-Desktop-Pet](https://github.com/ruguo0119/AI-Desktop-Pet) | Electron + React + Live2D + Python | 向量记忆、语音交互、状态机 | ⭐⭐⭐⭐ |
| 4 | **OpenPets** | [alvinunreal/openpets](https://github.com/alvinunreal/openpets) | Electron + React + pnpm monorepo | Plugin SDK v3、MCP 协议、多 AI 客户端 | ⭐⭐⭐⭐⭐ |
| 5 | **Star-Office-UI** | [ringhyacinth/Star-Office-UI](https://github.com/ringhyacinth/Star-Office-UI) | Python FastAPI + Electron + Phaser 3 | 像素多 Agent 协作、AI 驱动 | ⭐⭐⭐ |
| 6 | **clawd-on-desk** | [rullerzhou-afk/clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) | Electron + SVG 动画 | AI 编程助手状态监测、多主题、权限气泡 | ⭐⭐⭐⭐ |

---

## 二、技术分析

### 2.1 CodeWalkers — Tauri v2 同栈桌面伴侣

**项目定位**：基于 Tauri v2 的跨平台桌面虚拟伴侣，集成 AI 终端，角色在屏幕底部自由漫游。

**技术栈**：
- 前端：React 19 + TypeScript 5.8 + Vite 7 + TailwindCSS + shadcn/ui
- 后端：Tauri v2 + Rust 2021 Edition
- 状态管理：Zustand 5
- 测试：Vitest + Playwright
- 包管理：pnpm

**架构亮点**：

```
CodeWalkers/
├── src/                          # React 前端
│   ├── components/
│   │   ├── CharacterWidget.tsx   # 核心角色组件（332行）
│   │   ├── CharacterBubble.tsx   # 思考/状态气泡
│   │   ├── SessionPanel.tsx      # AI终端面板（282行）
│   │   └── StatusSettingsModal.tsx # 状态设置弹窗
│   ├── hooks/
│   │   ├── useAgentSession.ts    # AI会话管理（536行，最复杂）
│   │   ├── useCharacterMovement.ts # 角色移动/拖拽逻辑
│   │   ├── useAppConfig.ts       # 像素穿透检测
│   │   └── useUserStatus.ts      # 用户状态提醒
│   └── store/                    # Zustand stores
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs               # 窗口管理、托盘菜单（344行）
│   │   ├── session.rs           # 子进程管理（222行）
│   │   └── providers.rs         # AI Provider探测（138行）
│   └── tauri.conf.json          # 透明窗口配置
```

**核心技术实现**：

1. **像素级点击穿透**（最高价值借鉴点）：
   - 每 100ms 轮询鼠标位置
   - Canvas Alpha 检测：`alpha > 10` → 实体区域，`alpha <= 10` → 透明穿透
   - 支持 DPI 适配（scale_factor）
   - 检测交互元素（bubble、popover、modal）避免误穿透
   - macOS 特殊适配：`core-graphics` crate 作为后备

2. **Rust 窗口管理**：
   - `transparent: true` + `decorations: false` + `alwaysOnTop: true`
   - `set_ignore_cursor_events` 切换穿透
   - `get_mouse_pos` 含 scale_factor 处理
   - 系统托盘菜单构建 + 事件分发

3. **运动状态机**：
   ```
   Idle (5-12秒随机) → Walking (10秒循环) → Idle
   ```
   - 梯形速度曲线（加速→匀速→减速）
   - 精确建模运动参数（Ethan/Luna 不同参数）
   - 通过 `scaleX(-1)` 水平翻转实现方向切换
   - 3px 死区区分点击和拖拽

**代码规模**：前端 ~2000 行，Rust 后端 ~700 行，CSS ~550 行

**质量评估**：⭐⭐⭐⭐⭐ — TypeScript strict mode + Zod 验证 + ESLint 9 + Husky 完整链路

---

### 2.2 Live2DPet — AI 视觉感知桌面宠物

**项目定位**：基于 Electron 的 Live2D AI 桌面伴侣，具备截屏感知、关键帧记忆、VOICEVOX 语音合成。

**技术栈**：
- 框架：Electron 42
- 渲染：PixiJS + pixi-live2d-display + Live2D Cubism SDK
- FFI：koffi（VOICEVOX Core DLL 绑定）
- 窗口检测：active-win
- 日志：electron-log

**架构亮点**：

```
Live2DPet/
├── main.js                       # Electron主进程（仅117行，极简编排）
├── src/
│   ├── core/                     # 核心业务逻辑
│   │   ├── desktop-pet-system.js # 主调度器（782行）
│   │   ├── emotion-system.js     # 情绪系统（398行）
│   │   ├── ai-chat.js            # OpenAI兼容API客户端
│   │   ├── prompt-builder.js     # System Prompt构建（136行）
│   │   ├── tts-service.js        # VOICEVOX FFI封装（332行）
│   │   ├── audio-state-machine.js # 音频降级状态机
│   │   └── enhance/
│   │       ├── vlm-extractor.js  # VLM关键帧提取器（488行）
│   │       └── context-pool.js   # 短期/长期记忆池
│   ├── main/                     # 主进程模块
│   │   ├── window-manager.js     # 窗口创建/控制（242行）
│   │   ├── character-manager.js  # 角色卡CRUD（311行）
│   │   ├── model-import.js       # 模型扫描/参数映射（284行）
│   │   ├── screen-capture.js     # 截屏/窗口检测
│   │   └── crypto-utils.js       # AES-256-GCM加密
│   └── renderer/
│       ├── model-adapter.js      # 策略模式适配器（457行）
│       └── settings-ui.js        # 设置界面（56KB）
```

**核心技术实现**：

1. **Live2D 集成方案**：
   - **策略模式**：`ModelAdapter` 基类 + `Live2DAdapter` / `ImageAdapter` / `NullAdapter`
   - **参数自动映射**：`PARAM_FUZZY_MAP` 支持多种命名风格模糊匹配（`ParamAngleX`, `ParamX`, `Angle_X`）
   - **表情文件自动扫描**：扫描 `.exp3.json` 和 `.motion3.json`
   - **眼睛追踪**：每帧更新 `angleX/Y/Z`、`eyeBallX/Y` 参数
   - **热导入**：任意 Live2D 模型可直接导入，参数自动映射

2. **AI 视觉感知系统**：
   - **活动窗口检测**：`active-win` 库获取窗口标题、进程信息
   - **截屏**：Electron `desktopCapturer` API，支持标准（512px, JPEG 30%）和高质量（768px, JPEG 40%）
   - **焦点追踪**：每 1 秒采样活动窗口，累计聚焦时间
   - **隐私设计**：截图仅发送给用户配置的 API，不存储到本地磁盘

3. **关键帧视觉记忆**（Mipmap 环形缓冲区）：
   ```
   L0（2条目，全分辨率）→ L1（2条目，50%缩放）→ L2（1条目，25%缩放）
   ```
   - 每 5 个周期采样候选帧（最多 10 个）
   - 每 120 秒调用 LLM 从候选帧中挑选 3 个关键帧
   - 按年龄自动降分辨率（≤2min: 512px, ≤5min: 256px, >5min: 128px）
   - 超过 10 分钟的关键帧自动淘汰

4. **情绪系统**：
   - 情绪值累积（每秒 tick，悬停加成 50%）
   - 阈值触发（默认 100）→ AI 从可用表情列表中选择
   - **TTS 对齐模式**：表情持续时间与音频时长同步
   - 表情/动作双轨系统

5. **反重复机制**：
   - 结构模式检测（反问句、相同开头词、相似长度等）
   - LLM 语义分析提取话题
   - 将最近 30 秒分析结果注入 prompt 避免重复

6. **消息双缓冲**：
   - 新消息覆盖 `pendingMessage`，确保播放最新
   - 新 session 自动取消旧 session
   - 最小消息间隔 5 秒

---

### 2.3 AI-Desktop-Pet — 前后端分离 AI 桌宠

**项目定位**：Python 后端 + Electron 前端的 AI 桌宠，具备向量记忆、语音交互、视觉感知。

**技术栈**：
- 后端：Python 3.13 + FastAPI + WebSocket + ChromaDB
- 前端：React 18 + Vite 6 + Electron 28 + PixiJS 6 + pixi-live2d-display
- AI：Gemini/DeepSeek LLM + CosyVoice TTS + SenseVoice STT

**架构亮点**：

```
├── backend/                      # Python后端
│   ├── main.py                  # WebSocket服务入口 + 状态机
│   ├── services.py              # AI能力封装（LLM/TTS/STT）
│   ├── memory.py                # 向量记忆（ChromaDB + JSON事实库）
│   └── config.py                # 配置管理
├── frontend/                     # React + Electron前端
│   ├── src/components/
│   │   ├── Chat/                # 聊天组件
│   │   └── Live2D/              # Live2D渲染
│   └── src/hooks/               # WebSocket、音频队列
```

**核心技术实现**：

1. **向量记忆系统**：
   - ChromaDB 长期记忆 + JSON 事实库
   - 记忆带时间戳
   - LLM 自主决定写入记忆（不依赖用户明确指令）
   - 时间衰减排序：近期记忆权重更高

2. **WebSocket 通信协议**：
   - 前端 → 后端：`text_input`、`audio_input`、`screenshot`
   - 后端 → 前端：`ai_thinking`、`ai_reply`、`ai_speaking`、`ai_emotion`、`game_loop`

3. **状态机设计**：Idle → Thinking → Speaking 的完整状态管理

4. **主动发言**：
   - 指数退避机制（长时间无交互时减少发言频率）
   - 防骚扰设计

---

### 2.4 OpenPets — 插件化桌面宠物平台

**项目定位**：具有 Plugin SDK v3 和 MCP 协议集成的桌面宠物伴侣平台。

**技术栈**：
- 运行时：Electron 42 + Node.js 20+
- 前端：React 19 + Vite 8 + Tailwind CSS 3 + TypeScript 6
- 构建：pnpm 11 monorepo + electron-builder
- MCP：`@modelcontextprotocol/sdk` ^1.29.0
- 验证：Zod ^4.4.3

**Monorepo 结构**：

```
openpets/
├── apps/desktop/           # Electron桌面应用
├── packages/
│   ├── client/             # IPC客户端库（所有集成的基础）
│   ├── mcp/                # MCP stdio服务器
│   ├── claude/             # Claude Code集成
│   ├── opencode/           # OpenCode插件
│   ├── cursor/             # Cursor MCP配置
│   ├── sdk/                # Plugin SDK v3类型定义
│   ├── cli/                # 用户CLI入口
│   ├── agent-events/       # 共享Agent事件
│   ├── pet-format/         # 宠物包格式定义
│   └── install-pet/        # 宠物安装器
├── plugins/
│   ├── official/           # 10个官方插件
│   └── community/          # 4个社区插件
└── docs/                   # 16份技术文档
```

**核心技术实现**：

1. **Plugin SDK v3**：
   - **纯类型包**：`@open-pets/plugin-sdk` 只包含 TypeScript 类型定义（1050 行），不含运行时代码
   - **注入式运行时**：`OpenPetsPlugin` global 由桌面应用在沙箱中注入
   - **声明式权限**：30+ 权限类型（`pet:speak`, `pet:interact`, `schedule`, `storage`, `voice:listen` 等）
   - **能力命名空间**：`ctx.ui`, `ctx.pets`, `ctx.audio`, `ctx.events`, `ctx.schedule`, `ctx.storage`, `ctx.net`, `ctx.ai`, `ctx.voice` 等

   ```js
   // 插件入口模式
   export function register(OpenPetsPlugin) {
     OpenPetsPlugin.register({
       async start(ctx) {
         ctx.pets.react("thinking");
         ctx.ui.bubble("Hello!");
         ctx.schedule.every("30m", () => { /* ... */ });
       },
       async stop() { /* 清理 */ },
     });
   }
   ```

2. **MCP 协议集成**：
   - 标准 `StdioServerTransport`
   - 3 个 MCP 工具：`openpets_status`、`openpets_react`、`openpets_speak`
   - **Lease 机制**：短期租约（15s TTL）+ 心跳续期
   - 多客户端支持：Claude Code hooks + OpenCode plugin + Cursor MCP + Pi extension

3. **沙箱安全模型**：
   - 隔离运行时：每个插件在沙箱化 BrowserWindow 中运行
   - 权限守门：manifest 声明权限，安装时用户审批
   - SSRF 防护：网络请求限制为声明的域名
   - 内容过滤：AI 语音文本经过严格本地过滤

4. **测试基础设施**：
   - FakeClock：虚拟时钟，支持 `"30s"`/`"90m"` 格式
   - MockContext：完整模拟的 `OpenPetsContext`
   - TestHarness：`expectSpoke()`, `expectScheduled()`, `expectReacted()` 等语义断言

---

### 2.5 Star-Office-UI — 像素 AI 办公室

**项目定位**：像素风 AI 多 Agent 协作办公室，含 Electron 桌面宠物模块。

**技术栈**：
- 后端：Python FastAPI + LangGraph Agent
- 前端：HTML5/Canvas 像素渲染 + Phaser 3 游戏引擎
- 桌面：Electron 桌面宠物模块
- AI：Gemini API

**核心特性**：
- 多 Agent 像素角色协作（主持人 + 访客）
- RPG 背景自动生成
- 实时状态同步
- 桌面宠物模块（透明窗口 + 像素动画）

**对 SpiritPal 的参考价值**：多 Agent 场景设计和像素动画渲染方案

---

### 2.6 clawd-on-desk — AI 编程助手状态监测桌宠

**项目定位**：实时监控 20+ 种 AI 编程助手工作状态的像素桌面宠物。

**技术栈**：
- 框架：Electron 41
- 动画：SVG + htmlparser2
- 进程检测：koffi（Windows 原生 API）
- 通信：HTTP 服务器 + WebSocket

**架构亮点**：

```
clawd-on-desk/
├── src/
│   ├── main.js               # 主进程（4246行）
│   ├── state.js              # 状态机 + 会话管理
│   ├── renderer.js           # SVG渲染 + 眼睛追踪（1728行）
│   ├── hit-renderer.js       # 输入处理
│   ├── animation-cycle.js    # SVG动画周期分析（LCM算法）
│   ├── server.js             # HTTP API端点
│   ├── permission.js         # AI操作权限管理
│   ├── theme-schema.js       # 主题验证（792行）
│   └── agent-installation-detector.js # 进程检测（730行）
├── themes/
│   ├── clawd/                # 像素螃蟹主题
│   ├── calico/               # 三花猫主题
│   └── cloudling/            # 云宝主题
└── hooks/                    # AI助手安装脚本
```

**核心技术实现**：

1. **AI 状态检测系统**：
   - 命令行 hooks（Claude Code、Codex CLI 等）
   - HTTP API 端点（`/state`、`/permission`）
   - 进程检测（koffi 原生 API）
   - 日志轮询（JSONL 格式）
   - 20+ 种 AI 助手支持

2. **SVG 动画系统**：
   - 眼睛追踪：基于 SVG 元素的实时追踪
   - 动画周期分析：自动计算 SVG 动画的 LCM 周期
   - 主题热切换：运行时切换主题不重启

3. **多主题 JSON 配置**：
   ```json
   {
     "viewBox": "0 0 256 256",
     "states": { "idle": "idle.svg", "thinking": "thinking.svg" },
     "eyeTracking": { "enabled": true, "ids": ["#eyes-js"] },
     "timings": { "minDisplayMs": 3000, "autoReturnMs": 10000 },
     "hitBoxes": [...],
     "reactions": { "drag": {...}, "click": {...} }
   }
   ```

4. **权限气泡系统**：
   - 浮动权限卡片（允许/拒绝/始终允许）
   - 全局热键：Ctrl+Shift+Y/N
   - 终端操作后气泡自动消失

---

## 三、可借鉴点

### 3.1 窗口管理与交互

| 借鉴点 | 来源 | SpiritPal 应用方案 |
|--------|------|----------------|
| **像素级点击穿透** | CodeWalkers | 将 SpiritPal 的 `set_ignore_cursor_events` 替换为 Canvas Alpha 检测方案，实现角色实体区域可点击、透明区域穿透。需解决 DPI 适配和 macOS 兼容性 |
| **运动状态机** | CodeWalkers | 参考 Idle → Walk → Idle 状态机和梯形速度曲线建模，优化 SpiritPal 的 `behaviorEngine.ts` |
| **拖拽交互** | CodeWalkers/clawd-on-desk | 3px 死区区分点击/拖拽，拖拽时角色前倾 + 放大效果 |
| **位置记忆** | clawd-on-desk | 跨重启保存宠物位置到本地存储 |
| **迷你模式** | clawd-on-desk | 边缘隐藏 + 悬停预览，减少桌面占用 |
| **多显示器适配** | CodeWalkers/clawd-on-desk | 比例缩放和位置计算考虑多屏幕场景 |

### 3.2 AI 交互与感知

| 借鉴点 | 来源 | SpiritPal 应用方案 |
|--------|------|----------------|
| **AI 视觉感知** | Live2DPet | 定时截屏 + 活动窗口检测 + 焦点追踪，让 AI 理解用户正在做什么 |
| **关键帧视觉记忆** | Live2DPet | Mipmap 环形缓冲区 + LLM 关键帧选择，让 AI 能"回忆"用户近期活动 |
| **反重复机制** | Live2DPet | 结构模式检测 + LLM 语义分析，避免桌面宠物重复唠叨 |
| **消息双缓冲** | Live2DPet | 新消息覆盖旧消息，避免播放过时内容 |
| **AI 状态监测** | clawd-on-desk | 检测 AI 编程助手运行状态，根据状态切换宠物动画 |
| **权限气泡** | clawd-on-desk/CodeWalkers | 浮动权限卡片，让 AI 操作需要用户确认 |
| **思考气泡** | CodeWalkers | AI 处理时显示随机思考短语，增强互动感 |

### 3.3 记忆与情感系统

| 借鉴点 | 来源 | SpiritPal 应用方案 |
|--------|------|----------------|
| **向量记忆系统** | AI-Desktop-Pet | ChromaDB + JSON 事实库，LLM 自主决定写入记忆 |
| **时间衰减排序** | AI-Desktop-Pet | 近期记忆权重更高，模拟人类遗忘曲线 |
| **情绪累积系统** | Live2DPet | 情绪值累积 → 阈值触发 → AI 选择表情，悬停加成 |
| **TTS 对齐模式** | Live2DPet | 表情持续时间与音频时长同步 |
| **音频状态机** | Live2DPet | TTS → 默认音声 → 静音的优雅降级 + 熔断器模式 |
| **主动发言** | AI-Desktop-Pet | 指数退避机制，长时间无交互时减少发言频率 |

### 3.4 插件与扩展系统

| 借鉴点 | 来源 | SpiritPal 应用方案 |
|--------|------|----------------|
| **Plugin SDK 设计** | OpenPets | Types-First 设计：只发布类型定义，运行时注入 |
| **权限声明模型** | OpenPets | 30+ 粒度化权限类型，用户可控 |
| **MCP 协议集成** | OpenPets | 标准 MCP 服务器 + 3 工具（status/react/say）+ Lease 机制 |
| **测试基础设施** | OpenPets | FakeClock + MockContext + TestHarness，确定性测试 |
| **沙箱安全** | OpenPets | 隔离运行时 + 权限守门 + SSRF 防护 + 内容过滤 |
| **主题 JSON 配置** | clawd-on-desk | 声明式主题定义 + 运行时验证 + 热切换 |

### 3.5 Live2D 与动画

| 借鉴点 | 来源 | SpiritPal 应用方案 |
|--------|------|----------------|
| **策略模式适配器** | Live2DPet | `Live2DAdapter` / `ImageAdapter` / `NullAdapter` 统一接口 |
| **参数自动映射** | Live2DPet | `PARAM_FUZZY_MAP` 模糊匹配，支持多种命名风格 |
| **模型热导入** | Live2DPet | 任意 Live2D 模型直接导入，参数自动扫描 |
| **角色卡系统** | Live2DPet | JSON 角色卡 + i18n + 模板变量 + 版本更新自动克隆 |
| **SVG 动画周期** | clawd-on-desk | LCM 算法计算 SVG 动画周期，精确控制播放时序 |

---

## 四、集成建议

### 4.1 高优先级（1-2 周可完成）

#### 4.1.1 优化透明窗口点击穿透

**现状**：SpiritPal 当前使用全局 `set_ignore_cursor_events(true)` 实现穿透，角色无法直接点击。

**改进方案**（参考 CodeWalkers）：
```typescript
// 在 petWindow 组件中实现
const pixelCanvas = document.createElement('canvas');
pixelCanvas.width = 1; pixelCanvas.height = 1;
const ctx = pixelCanvas.getContext('2d');

function checkClickThrough() {
  const mousePos = await invoke('get_mouse_pos');
  const element = document.elementFromPoint(mousePos.x, mousePos.y);
  
  if (element?.closest('.pet-character')) {
    const media = element.querySelector('video, img');
    if (media) {
      const scaleX = media.naturalWidth / media.clientWidth;
      const scaleY = media.naturalHeight / media.clientHeight;
      ctx.drawImage(media, 
        (mousePos.x - media.offsetLeft) * scaleX,
        (mousePos.y - media.offsetTop) * scaleY, 1, 1, 0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      if (a > 10) {
        await invoke('set_ignore_cursor_events', { ignore: false });
        return;
      }
    }
  }
  await invoke('set_ignore_cursor_events', { ignore: true });
}
```

**预期效果**：角色实体区域可拖拽/点击，透明区域穿透到底层应用。

#### 4.1.2 实现 LLM 情绪驱动

**改进方案**（参考 Live2DPet）：
```typescript
// emotionManager.ts 新增
class EmotionManager {
  private emotionValue = 0;
  private readonly threshold = 100;
  
  tick(isHovered: boolean) {
    const rate = this.threshold / this.frequencySeconds;
    this.emotionValue += isHovered ? rate * 1.5 : rate;
    
    if (this.emotionValue >= this.threshold) {
      this.triggerEmotionSelection();
      this.emotionValue = 0;
    }
  }
  
  private async triggerEmotionSelection() {
    const emotions = this.model.getAvailableExpressions();
    const selected = await llmClient.selectEmotion(emotions, recentReply);
    this.applyExpression(selected);
  }
}
```

#### 4.1.3 实现反重复机制

**改进方案**（参考 Live2DPet）：
- 在 `dialogueManager.ts` 中添加结构模式检测
- 检测反问句、相同开头词、相似长度等
- 将最近 30 秒的分析结果注入 prompt

### 4.2 中优先级（1-2 月）

#### 4.2.1 实现 AI 视觉感知

**改进方案**（参考 Live2DPet）：
1. 使用 Tauri 的 `desktopCapturer` API 定时截屏（每 30-60 秒）
2. 使用 `active-win` 或 Win32 API 检测活动窗口
3. 将截图 + 窗口信息发送给支持 Vision 的 LLM
4. 根据分析结果触发主动对话

#### 4.2.2 实现消息双缓冲

在 `bubbleManager.ts` 中：
- 新消息总是覆盖 `pendingMessage`
- 新 session 自动取消旧 session
- 最小消息间隔 5 秒

#### 4.2.3 实现向量记忆系统

**改进方案**（参考 AI-Desktop-Pet + OpenPets）：
1. 在 SpiritPal 已有的 `enhancedMemory.ts` 基础上扩展
2. 使用 ChromaDB 或类似的向量数据库
3. LLM 自主决定写入记忆（不依赖用户明确指令）
4. 时间衰减排序：近期记忆权重更高

### 4.3 低优先级（3-6 月）

#### 4.3.1 实现 Plugin SDK

**参考 OpenPets 的设计**：
1. 定义 `@spiritpal/plugin-sdk` 类型包
2. 沙箱化 JS/TS 运行时
3. 权限声明 + 用户审批
4. 标准化入口函数 `register()`

#### 4.3.2 实现 MCP 服务器

**参考 OpenPets + SpiritPal 已有的 `mcpServer.ts`**：
1. 使用 `@modelcontextprotocol/sdk` 实现标准 MCP 服务器
2. 暴露工具：`spiritpal_status`、`spiritpal_react`、`spiritpal_speak`
3. 支持 Claude Code、Cursor 等客户端

#### 4.3.3 实现关键帧视觉记忆

**参考 Live2DPet 的 Mipmap 架构**：
1. 三级分辨率环形缓冲区（L0/L1/L2）
2. 每 5 个周期采样候选帧
3. 每 120 秒调用 LLM 挑选关键帧
4. 按年龄自动降分辨率

---

## 五、总结与行动指南

### 5.1 整体学习收获

通过对 6 个新参考仓库的深入分析，我们获得了以下核心洞察：

1. **Tauri v2 是桌面宠物的最佳框架**：CodeWalkers 证明了 Tauri v2 + React + Rust 的技术栈在透明窗口、鼠标穿透、PTY 集成等方面的优势，与 SpiritPal 完全一致。

2. **AI 视觉感知是下一代桌面宠物的标配**：Live2DPet 的截屏感知 + 关键帧记忆 + 情绪系统代表了 AI 桌宠的前沿方向。

3. **插件生态是长期竞争力的关键**：OpenPets 的 Plugin SDK v3 + MCP 协议展示了桌面宠物平台化的最佳实践。

4. **反重复和情绪系统决定用户体验**：桌面宠物的核心价值是"治愈"，避免重复唠叨和实现情绪驱动的互动至关重要。

5. **安全和隐私不容忽视**：多个项目都采用了截图不存储、SSRF 防护、权限守门等安全措施。

### 5.2 对 SpiritPal 项目的提升方向

| 方向 | 当前状态 | 目标状态 | 参考项目 |
|------|---------|---------|---------|
| **透明窗口穿透** | 全局穿透，角色不可点击 | 像素级 Alpha 检测，角色可交互 | CodeWalkers |
| **AI 交互** | 纯文本对话 | 视觉感知 + 关键帧记忆 + 情绪驱动 | Live2DPet |
| **养成系统** | 基础数值系统 | 情绪累积 + TTS 对齐 + 反重复 | Live2DPet |
| **记忆系统** | 加密存储 | 向量记忆 + 时间衰减 + LLM 自主写入 | AI-Desktop-Pet |
| **扩展性** | .petmod 包 | Plugin SDK v3 + MCP 协议 + 沙箱安全 | OpenPets |
| **AI 集成** | 单一 LLM 对话 | 多客户端支持 + 状态监测 + 权限气泡 | clawd-on-desk |
| **动画系统** | Live2D + 像素 | 策略模式适配器 + 参数自动映射 + 热导入 | Live2DPet |
| **主题系统** | 基础配置 | JSON 声明式 + 运行时验证 + 热切换 | clawd-on-desk |

### 5.3 后续开发任务建议

#### Phase 1：核心优化（1-2 周）
1. [ ] 实现像素级点击穿透（参考 CodeWalkers 的 `useAppConfig.ts`）
2. [ ] 添加 LLM 情绪驱动系统（参考 Live2DPet 的 `emotion-system.js`）
3. [ ] 实现反重复机制（参考 Live2DPet 的结构检测 + LLM 语义分析）
4. [ ] 优化运动状态机（参考 CodeWalkers 的梯形速度曲线）

#### Phase 2：AI 增强（1-2 月）
5. [ ] 实现 AI 视觉感知（截屏 + 活动窗口检测 + Vision LLM）
6. [ ] 实现消息双缓冲（参考 Live2DPet 的 `pendingMessage` 机制）
7. [ ] 扩展向量记忆系统（参考 AI-Desktop-Pet 的 ChromaDB 集成）
8. [ ] 实现 TTS 对齐模式（表情持续时间与音频同步）

#### Phase 3：平台化（3-6 月）
9. [ ] 设计 Plugin SDK 类型定义（参考 OpenPets 的 `@open-pets/plugin-sdk`）
10. [ ] 实现 MCP 标准服务器（参考 OpenPets 的 3 工具 + Lease 机制）
11. [ ] 实现沙箱安全模型（权限守门 + SSRF 防护 + 内容过滤）
12. [ ] 开发测试基础设施（FakeClock + MockContext + TestHarness）

---

## 附录：仓库克隆信息

所有新仓库已克隆到 `c:\Users\HONOR\Pet\new_reference_repos\` 目录：

| 目录名 | GitHub 地址 |
|--------|-----------|
| `CodeWalkers` | https://github.com/you-want/CodeWalkers |
| `Live2DPet` | https://github.com/x380kkm/Live2DPet |
| `AI-Desktop-Pet` | https://github.com/ruguo0119/AI-Desktop-Pet |
| `openpets` | https://github.com/alvinunreal/openpets |
| `Star-Office-UI` | https://github.com/ringhyacinth/Star-Office-UI |
| `clawd-on-desk` | https://github.com/rullerzhou-afk/clawd-on-desk |
