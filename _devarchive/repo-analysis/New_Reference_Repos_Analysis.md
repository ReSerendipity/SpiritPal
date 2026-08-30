# new_reference_repos 6 个新参考仓库综合分析报告

> **分析日期**：2026-07-23
> **分析范围**：Star-Office-UI、AI-Desktop-Pet、CodeWalkers、Live2DPet、clawd-on-desk、openpets（new_reference_repos）共 6 个仓库
> **目标项目**：SpiritPal（Tauri v2 + React 19 + TypeScript + Rust 跨平台 AI 桌面宠物）
> **报告定位**：在 6 份仓库分析基础上的横向对比，输出对 SpiritPal 的可借鉴点与集成建议

---

## 1. 仓库概览

### 1.1 总览表

| 仓库名 | GitHub | 技术栈 | 许可证 | Stars | 一句话定位 |
|--------|--------|--------|--------|-------|-----------|
| **Star-Office-UI** | [GitHub](https://github.com/AniviaY/Star-Office-UI) | Phaser 3 + Python Flask + Electron + Gemini API | MIT | — | 像素风 AI 办公室桌面宠物，多 Agent 协作 |
| **AI-Desktop-Pet** | [GitHub](https://github.com/your-username/AI-Desktop-Pet) | React 18 + Vite + Electron + Python FastAPI + Live2D + ChromaDB | MIT | — | 可爱毒舌 AI 桌宠，Live2D + 语音交互 + 向量记忆 |
| **CodeWalkers** | [GitHub](https://github.com/you-want/CodeWalkers) | Tauri v2 + React 19 + Rust + Gemini CLI | MIT | — | Tauri 跨平台桌面虚拟伴侣 + AI 终端 |
| **Live2DPet** | [GitHub](https://github.com/x380kkm/Live2DPet) | Electron + Live2D + PixiJS + VOICEVOX | MIT | — | AI 视觉感知 Live2D 桌面宠物 + 情绪系统 |
| **clawd-on-desk** | [GitHub](https://github.com/rullerzhou-afk/clawd-on-desk) | Electron + TypeScript | AGPL-3.0 | — | 多 AI 编码代理状态可视化桌面宠物 |
| **openpets** | [GitHub](https://github.com/alvinunreal/openpets) | Electron + TypeScript + React + pnpm monorepo | MIT | 900+ | 面向 AI 编码代理的桌面宠物 + MCP 生态 |

### 1.2 技术栈对比

| 技术维度 | Star-Office-UI | AI-Desktop-Pet | CodeWalkers | Live2DPet | clawd-on-desk | openpets |
|----------|---------------|----------------|-------------|-----------|---------------|----------|
| **桌面框架** | Electron + Tauri (可选) | Electron | **Tauri v2** | Electron | Electron | Electron |
| **前端框架** | Phaser 3 (游戏) | React 18 | React 19 | 原生 JS | React + Zustand | React + Zustand |
| **后端** | Python Flask | Python FastAPI | Rust (Tauri) | 无（纯前端） | Node.js (Electron) | Node.js (Electron) |
| **AI/LLM** | Gemini API | Gemini + DeepSeek | Gemini CLI (PTY) | OpenAI 兼容 | 多代理 Hook | MCP Server |
| **角色渲染** | Phaser SpriteSheet | Live2D Cubism | Canvas + 视频动画 | Live2D + PixiJS | 像素 GIF/APNG | 8x9 Spritesheet |
| **记忆系统** | Flask session + JSON | ChromaDB 向量记忆 | 无 | 关键帧视觉记忆 | 无 | 无 |
| **语音** | 无 | CosyVoice TTS + SenseVoice STT | 无 | VOICEVOX 本地 TTS | 无 | 无 |
| **窗口管理** | Electron transparent | Electron transparent | Tauri transparent | Electron transparent | Electron transparent | Electron transparent |
| **跨平台** | Win/Mac/Linux | Win/Mac/Linux | Win/Mac/Linux | Windows | Win/Mac/Linux | Win/Mac/Linux |

---

## 2. 逐仓库深度分析

### 2.1 Star-Office-UI（像素风 AI 办公室）

#### 项目概述
Star-Office-UI 是一个创新的像素风 AI 办公室桌面宠物项目，特色在于多 Agent 协作设计——多个 AI 角色在像素办公室场景中各自执行任务（写代码、审代码、聊天等），通过 Gemini API 驱动 AI 对话。

#### 架构设计（三层架构）

```
┌─────────────────────────────────────────────┐
│  Electron / Tauri Desktop Shell (透明窗口)   │
│  main.js: 窗口管理 + IPC + Tauri 兼容层     │
├─────────────────────────────────────────────┤
│  Phaser 3 游戏引擎 (game.js, 1035 行)       │
│  - 192x208 像素精灵图                       │
│  - WebP 动画 + PNG fallback                 │
│  - 6 角色 + 3 任务系统                      │
├─────────────────────────────────────────────┤
│  Python Flask 后端 (app.py, 2104 行)         │
│  - Agent 状态管理                           │
│  - Gemini API 集成                          │
│  - RPG 背景生成 + 安全工具                   │
└─────────────────────────────────────────────┘
```

#### 关键技术亮点

1. **Phaser 3 像素动画系统**
   - 192x208 像素精灵图，每帧一个动作
   - WebP 动画格式自动检测，PNG 静态帧 fallback
   - 基于 Phaser 的 `AnimatedSprite` 实现流畅动画切换
   - 6 个角色各有独立精灵图和动画状态

2. **多 Agent 协作设计**
   - 6 个 Agent 角色：CEO、产品经理、设计师、前端、后端、测试
   - 每个 Agent 有独立任务系统（写代码、审代码、聊天、学习、摸鱼等）
   - Agent 之间通过 Flask 后端协调状态
   - office-agent-push.py 实现 Agent 主动推送

3. **Gemini API 集成**
   - 系统提示词包含角色设定 + RPG 背景 + 交互规则
   - JSON 格式结构化输出（thought + reply + action + emotion）
   - 安全工具：prompt 注入检测、输入验证

4. **RPG 背景生成**
   - 多层次场景：办公室 / 花园 / 会议室
   - 天气系统联动角色行为
   - 时间系统影响角色状态

#### 对 SpiritPal 的可借鉴点

| 特性 | Star-Office-UI 实现 | SpiritPal 可借鉴 | 优先级 |
|------|---------------------|--------------|--------|
| Phaser 3 精灵图动画 | `game.js:1035` 行 | SpiritPal 已有 8x9 spritesheet，可参考 Phaser 渲染方案 | P2 |
| 多 Agent 协作架构 | `app.py` Agent 状态管理 | SpiritPal 可设计多宠物协作模式 | P3 |
| JSON 结构化 AI 输出 | `thought+reply+action+emotion` | SpiritPal 已有类似模式，可统一输出 schema | P1 |
| RPG 场景系统 | 像素场景 + 天气联动 | SpiritPal 可扩展场景感知（参考 weatherAwareness.ts） | P2 |
| 安全工具 | prompt 注入检测 | SpiritPal agentTools.ts 可增加 prompt 安全校验 | P1 |

#### 项目质量评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | 6/10 | 功能完整但缺乏类型安全，Python/JS 混用 |
| 架构设计 | 7/10 | 三层分离合理，但后端较重 |
| 创新性 | 8/10 | 多 Agent 办公室场景非常有创意 |
| 可维护性 | 5/10 | 缺乏测试，文档较少 |
| 与 SpiritPal 相关性 | 6/10 | 像素动画和 Agent 架构有参考价值 |

---

### 2.2 AI-Desktop-Pet（Live2D 毒舌 AI 桌宠）

#### 项目概述
AI-Desktop-Pet 是一个集成了 Live2D 3D 模型、语音交互（CosyVoice TTS + SenseVoice STT）、向量记忆系统（ChromaDB）的 AI 桌面宠物。角色灵感来自 Neuro，性格可爱毒舌。

#### 架构设计

```
┌─────────────────────────────────────────────┐
│  Electron + React 18 + Vite 6               │
│  ├── Live2D 渲染 (PixiJS + pixi-live2d-display)│
│  ├── 聊天组件 (文字 + 语音)                   │
│  └── WebSocket 双向通信                      │
├─────────────────────────────────────────────┤
│  Python FastAPI 后端                         │
│  ├── main.py: 状态机 + 游戏循环              │
│  ├── services.py: LLM/TTS/STT API 封装      │
│  ├── memory.py: ChromaDB 向量 + JSON 事实库   │
│  └── tools.py: 截图等工具                    │
└─────────────────────────────────────────────┘
```

#### 关键技术亮点

1. **状态机设计**
   ```python
   # 三状态: idle → thinking → speaking
   # 主动发言循环: 40s 无操作触发，阈值指数退避至 3600s 上限
   class NeuroBrain:
       state = "idle"  # idle, thinking, speaking
       boredom_threshold = 40  # 初始触发阈值
       max_threshold = 3600    # 退避上限
   ```

2. **向量记忆系统**
   - ChromaDB 长期记忆 + JSON 事实库
   - 记忆都带时间戳
   - LLM 自动提取新事实和事件摘要
   - 10 条滑动窗口短期记忆

3. **AI 驱动情绪系统**
   - LLM 返回 `emotion: "happy/neutral/bored/angry"`
   - 前端根据 emotion 切换 Live2D 表情
   - 支持视觉关键词触发截图（"看看"、"截图"等）

4. **WebSocket 双向通信**
   - 前端→后端：text_input、audio_input、set_dnd_mode、screenshot
   - 后端→前端：ai_thinking、ai_reply、ai_speaking、ai_emotion、game_loop

#### 对 SpiritPal 的可借鉴点

| 特性 | AI-Desktop-Pet 实现 | SpiritPal 可借鉴 | 优先级 |
|------|---------------------|--------------|--------|
| 主动发言 + 指数退避 | 40s→80s→...→3600s | SpiritPal 可在 aiAgent.ts 实现智能主动说话 | P1 |
| LLM 情绪提取 | emotion 字段 + Live2D 表情映射 | SpiritPal animationConfig.ts 可增加 AI→表情链路 | P0 |
| ChromaDB 向量记忆 | 带时间戳的长期记忆 | SpiritPal 已有 enhancedMemory.ts，可参考 ChromaDB 集成方式 | P2 |
| 视觉关键词检测 | "看看"/"截图"→屏幕截图 | SpiritPal screenshotManager.ts 已有，可增加关键词触发 | P1 |
| WebSocket 双向通信 | FastAPI WebSocket | SpiritPal 已有 Tauri IPC，无需 WebSocket | 不适用 |
| Live2D 集成 | PixiJS + pixi-live2d-display | SpiritPal 已有 live2d.ts 骨架，可参考渲染方案 | P2 |

#### 项目质量评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | 7/10 | 结构清晰，但 Python 后端较简单 |
| 架构设计 | 8/10 | 前后端分离 + WebSocket + 状态机设计优秀 |
| 创新性 | 7/10 | Live2D + 毒舌人设 + 向量记忆组合 |
| 可维护性 | 7/10 | 依赖项清晰，但缺乏测试 |
| 与 SpiritPal 相关性 | 8/10 | 情绪系统和主动发言机制高度可借鉴 |

---

### 2.3 CodeWalkers（Tauri + React 桌面伴侣）

#### 项目概述
CodeWalkers 是一个基于 **Tauri v2 + React 19 + Rust** 的跨平台桌面虚拟伴侣，特色是内置 AI 终端（PTY 集成 Gemini CLI），角色在屏幕底部自由行走，支持像素级点击穿透。

#### 架构设计

```
┌─────────────────────────────────────────────┐
│  Tauri v2 (Rust 后端)                       │
│  ├── 窗口管理 (透明/穿透/置顶)               │
│  ├── PTY 终端进程 (Gemini CLI)              │
│  ├── 系统托盘 (角色/主题/音效)               │
│  └── 多显示器适配                            │
├─────────────────────────────────────────────┤
│  React 19 + TypeScript 前端                  │
│  ├── Canvas Alpha 像素检测 (点击穿透)        │
│  ├── 动画渲染 (MOV 视频动画)                 │
│  ├── Zustand 状态管理                        │
│  └── 音效系统                                │
└─────────────────────────────────────────────┘
```

#### 关键技术亮点

1. **Tauri v2 架构（与 SpiritPal 同栈）**
   - Rust 后端：窗口管理 + PTY 进程 + 系统托盘
   - React 19 前端：透明窗口 + 像素检测
   - pnpm 严格依赖管理（npm/yarn 被阻止）
   - 极低资源占用（vs Electron）

2. **PTY 终端集成**
   - Rust `std::process::Command` 启动 Gemini CLI
   - stdout/stderr 异步读取 + Tauri event 转发
   - 支持多 Provider：Gemini、Claude、Copilot
   - 环境变量注入（~/.codewalkers.env）

3. **像素级点击穿透**
   - Canvas Alpha 检测：透明区域穿透，实体区域可拖拽
   - 多显示器适配：primary_monitor + scale_factor 转换

4. **自定义状态提醒**
   - 右键菜单自定义状态（Working/Break/Lunch）
   - 定时/定时间隔提醒 + 气泡通知
   - Zustand store 管理（useStatusSettingsStore）

#### 对 SpiritPal 的可借鉴点

| 特性 | CodeWalkers 实现 | SpiritPal 可借鉴 | 优先级 |
|------|-----------------|--------------|--------|
| Tauri v2 窗口管理 | Rust 透明窗口 + 穿透 | **同栈**，可直接参考 Rust 代码模式 | P0 |
| PTY 终端集成 | `session.rs` 进程管理 | SpiritPal agentTools.ts 可增加 PTY 模式 | P2 |
| 像素级点击穿透 | Canvas Alpha 检测 | SpiritPal petWindow 可实现更精确的穿透 | P1 |
| 多显示器适配 | `lib.rs` monitor 枚举 | SpiritPal 已有多窗口，可参考适配方案 | P1 |
| Zustand 状态管理 | useStatusSettingsStore | SpiritPal 已有 Zustand，参考 store 拆分模式 | P2 |
| 系统托盘菜单 | Rust 菜单构建 + 事件 | SpiritPal lib.rs 可参考动态菜单构建 | P1 |
| 音效系统 | 短音效 + 10s 冷却 | SpiritPal 可增加交互音效 | P3 |

#### 项目质量评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | 8/10 | TypeScript 类型安全 + Rust 内存安全 |
| 架构设计 | 9/10 | Tauri v2 + React 19 现代架构，PTY 集成精巧 |
| 创新性 | 8/10 | 桌宠 + AI 终端的创新组合 |
| 可维护性 | 8/10 | 清晰的模块划分，CI/CD 完善 |
| 与 SpiritPal 相关性 | **9/10** | **技术栈完全同构**（Tauri v2 + React + TypeScript），代码可直接参考 |

---

### 2.4 Live2DPet（AI 视觉感知 Live2D 桌宠）

#### 项目概述
Live2DPet 是一个功能非常完善的 AI 桌面宠物，特色是：定时截屏 + 窗口感知理解用户活动、AI 大模型生成陪伴式对话、关键帧视觉记忆、VOICEVOX 本地日语语音合成、**AI 驱动情绪系统**。

#### 架构设计

```
┌─────────────────────────────────────────────┐
│  Electron Main Process                      │
│  ├── 窗口管理 + 气泡 + 系统托盘              │
│  ├── 配置管理 (AES-256-GCM 加密)            │
│  ├── 角色卡管理 (JSON 模板)                  │
│  ├── TTS 服务 (VOICEVOX Core FFI via koffi) │
│  ├── 翻译服务 (LLM 中→日 + LRU 缓存)        │
│  ├── 模型导入 (参数自动映射)                  │
│  └── 关键帧视觉记忆 (VLM 提取)               │
├─────────────────────────────────────────────┤
│  Renderer (3 窗口)                           │
│  ├── Settings Window (配置 UI)               │
│  ├── Pet Window (Live2D/图片渲染)            │
│  └── Chat Bubble (对话气泡)                  │
├─────────────────────────────────────────────┤
│  Core Modules (renderer)                     │
│  ├── DesktopPetSystem (调度中心)             │
│  ├── EmotionSystem (情绪累积 + AI 选择)      │
│  ├── AudioStateMachine (TTS→默认→静音)       │
│  ├── MessageSession (文字+表情+音频同步)     │
│  ├── AIChatClient (OpenAI 兼容 API)         │
│  └── PetPromptBuilder (System Prompt 构建)  │
└─────────────────────────────────────────────┘
```

#### 关键技术亮点

1. **AI 驱动情绪系统（emotion-system.js, 398 行）**
   ```javascript
   // 情绪累积机制
   // 基础累积率 = emotionThreshold / (expectedFrequency * 1000 / tickMs)
   // 悬停加速: hoverAccumulationRate = baseAccumulationRate * 0.5
   // AI 回复奖励: bonus = 5 + random * 25 * (responseLength / 200)
   
   // 当 emotionValue >= emotionThreshold 时触发:
   // 1. 通过 AI 从 enabledEmotions 中选择最佳情绪
   // 2. 如果有 nextEmotionBuffer (AI 预选), 优先使用
   // 3. 否则随机选择
   // 4. 区分 expression (表情) 和 motion (动作) 两种类型
   ```

2. **音频状态机（audio-state-machine.js, 92 行）**
   - 三种模式：TTS → 默认音声 → 静音
   - 优雅降级：TTS 不可用时自动切换到默认音声
   - 用户可设偏好模式，系统根据可用性计算实际模式

3. **视觉感知系统**
   - 定时截屏 + 活动窗口检测
   - AI 根据屏幕内容主动对话
   - 关键帧视觉记忆：自动采样截图，VLM 挑选代表性关键帧
   - AI 可回顾近期活动

4. **桌面宠物系统（desktop-pet-system.js, 782 行）**
   - 定时 tick：每 10s 检测活动窗口 → 截屏 → AI 请求
   - 窗口焦点追踪：1s 采样，构建 Top 5 焦点上下文
   - 消息双缓冲：始终播放最新消息，跳过过期消息
   - 反重复机制：LLM 分析最近回复的话题/习惯，避免重复
   - 互动事件缓冲：点击/触摸/拖拽/划过/缩放 → 注入 AI 上下文

5. **角色人设系统**
   - JSON 模板定义角色性格和行为规则
   - 支持模板变量 `{{petName}}`、`{{userIdentity}}`
   - 多角色切换

#### 对 SpiritPal 的可借鉴点

| 特性 | Live2DPet 实现 | SpiritPal 可借鉴 | 优先级 |
|------|---------------|--------------|--------|
| **AI 情绪选择** | emotion-threshold + AI pick | SpiritPal 可在 animationConfig.ts 增加 AI→情绪→动画链路 | **P0** |
| **音频状态机** | TTS→默认→静音 三模式降级 | SpiritPal 可设计类似的语音降级策略 | P2 |
| **视觉感知** | 定时截屏 + 窗口检测 → AI 对话 | SpiritPal contextAwareness.ts 可扩展截屏感知 | P1 |
| **关键帧视觉记忆** | VLM 采样 + 中期视觉记忆 | SpiritPal enhancedMemory.ts 可增加视觉记忆层 | P2 |
| **反重复机制** | 话题/习惯 LLM 分析 + 结构模式检测 | SpiritPal aiAgent.ts 可增加回复去重 | P1 |
| **消息双缓冲** | pendingMessage + 播放锁 | SpiritPal 可参考此模式优化消息队列 | P2 |
| **互动事件注入** | hitBuffer → AI prompt 上下文 | SpiritPal interactionCounter.ts 可扩展事件注入 | P1 |
| **图片模型支持** | 图片文件夹 → 待机/说话/表情分类 | SpiritPal spriteSheetTool.ts 可支持图片模式 | P3 |

#### 项目质量评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | 9/10 | 模块化清晰，注释完善，AES 加密等安全实践 |
| 架构设计 | **9/10** | **三窗口 + Core Modules 分层设计非常优秀** |
| 创新性 | **9/10** | 关键帧视觉记忆 + 情绪累积系统极具创新 |
| 可维护性 | 8/10 | 模块职责单一，配置驱动 |
| 与 SpiritPal 相关性 | **9/10** | 情绪系统、反重复机制、视觉感知高度可借鉴 |

---

### 2.5 clawd-on-desk（多 AI 编码代理状态可视化）

#### 项目概述
clawd-on-desk 是一个面向 AI 编码代理的桌面宠物，特色是支持 20+ 种 AI 编码代理（Claude Code、Codex CLI、Copilot CLI、Gemini CLI、Cursor Agent、Qoder 等）的状态可视化。像素螃蟹角色实时反映编码代理的工作状态。

#### 架构设计

```
┌─────────────────────────────────────────────┐
│  Electron 桌面应用                           │
│  ├── 透明窗口 + 像素精灵动画 (12 种状态)     │
│  ├── 系统托盘 (大小/语言/DND/自动启动)       │
│  ├── 权限气泡 (Allow/Deny/Always)           │
│  └── Session HUD (实时会话状态)              │
├─────────────────────────────────────────────┤
│  多代理 Hook 系统                            │
│  ├── Claude Code (command hooks + HTTP)      │
│  ├── Codex CLI (hooks + JSONL 轮询)          │
│  ├── Copilot/Gemini/Cursor (settings hooks)  │
│  ├── 自定义 HTTP 代理 (动态 /state 端点)      │
│  └── 远程 SSH + WSL 支持                     │
├─────────────────────────────────────────────┤
│  移动端 PWA (只读镜像)                       │
│  └── LAN 桥接 + Token 轮换 + 实时状态同步    │
└─────────────────────────────────────────────┘
```

#### 关键技术亮点

1. **多代理状态映射**
   - 12 种动画状态：idle/thinking/typing/building/subagent-groove/juggling/error/happy/notification/sweeping/carrying/sleeping
   - 代理事件→动画状态自动映射
   - 多会话优先级仲裁

2. **权限气泡系统**
   - 代理请求权限时弹出浮动气泡卡片
   - 一键 Allow/Deny + 全局快捷键 (Ctrl+Shift+Y/N)
   - 自动消失（终端中已回答）
   - 堆叠布局 + Agent 级开关

3. **自定义主题系统**
   - 内置 3 主题：Clawd(螃蟹)、Calico(三花猫)、Cloudling(云宝)
   - 支持 Codex Pet 动画包导入
   - SVG + GIF/APNG + WebP 多格式
   - 主题能力徽章（Tracked idle/Static/Mini 等）

4. **Session Intelligence**
   - 多会话跟踪，最高优先级状态
   - 子代理感知（1个→耳机，2+个→杂耍）
   - 会话仪表板 + HUD
   - 进程存活检测 + 启动恢复

#### 对 SpiritPal 的可借鉴点

| 特性 | clawd-on-desk 实现 | SpiritPal 可借鉴 | 优先级 |
|------|-------------------|--------------|--------|
| 多代理状态映射 | 12 种动画 × 20+ 代理 | SpiritPal 可设计编码代理状态层 | P1 |
| 权限气泡系统 | Allow/Deny/Always + 堆叠 | SpiritPal 可扩展 agentTools.ts 权限管理 | P2 |
| 自定义主题系统 | 3 主题 + Codex Pet 导入 | SpiritPal themeManager.ts 可扩展主题生态 | P2 |
| Session 优先级仲裁 | 多会话最高优先级 | SpiritPal 可参考多宠物状态仲裁 | P2 |
| 子代理感知 | 1个→耳机，2+个→杂耍 | SpiritPal 多宠物模式的视觉区分 | P3 |
| 移动端 PWA 镜像 | LAN + Token + 实时同步 | SpiritPal 已有移动端，可参考同步模式 | P3 |

#### 项目质量评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | 8/10 | TypeScript 类型安全，模块化清晰 |
| 架构设计 | **9/10** | Hook 系统 + 代理抽象 + 权限模型设计精巧 |
| 创新性 | **10/10** | 编码代理状态可视化概念独一无二 |
| 可维护性 | 7/10 | 多代理支持导致复杂度高，AGPL-3.0 许可证限制 |
| 与 SpiritPal 相关性 | 7/10 | 状态映射和主题系统有参考价值，但定位差异大 |

---

### 2.6 openpets（AI 编码代理桌面宠物 + MCP 生态）

#### 项目概述
openpets 是面向 AI 编码代理的桌面宠物应用，特色是 **8x9 spritesheet 格式**（与 SpiritPal 完全兼容）和 **MCP Server 生态**（让外部 AI 代理通过 MCP 协议驱动宠物反应）。

#### 架构设计

```
┌─────────────────────────────────────────────┐
│  Electron + TypeScript monorepo (pnpm)       │
│  ├── apps/desktop (主应用)                   │
│  │   ├── DefaultPetController (窗口管理)     │
│  │   ├── AgentPetController (多代理宠物)     │
│  │   ├── PetMotionEngine (漫游引擎)          │
│  │   ├── PluginBubbleArbiter (气泡仲裁)      │
│  │   └── PetWindow (透明窗口)                │
│  ├── packages/pet-format (8x9 格式定义)      │
│  ├── packages/mcp (MCP Server)               │
│  ├── packages/sdk (Plugin SDK v3)            │
│  └── packages/claude (Claude Code 集成)      │
└─────────────────────────────────────────────┘
```

#### 关键技术亮点

1. **8x9 Spritesheet 格式（与 SpiritPal 像素级兼容）**
   ```
   OpenPets: 8 列 × 9 行, 192×208/帧, 1536×1872 整图
   SpiritPal:   8 列 × 9 行, 192×208/帧, 1536×1872 整图 (ATLAS = { cellW:192, cellH:208, cols:8, rows:9 })
   来源: codexPet 生态（两者同源！）
   ```

2. **反应系统（OpenPetsReaction）**
   ```typescript
   type OpenPetsReaction = "idle" | "thinking" | "working" | "editing" | "running" | "testing" | "waiting"
   // 11 个 allowedReactions，映射到 spritesheet 行
   ```

3. **PetMotionEngine（漫游引擎）**
   - 屏幕边缘检测 + 边界约束
   - 独立漫游控制器（roaming-pet-controller.ts）
   - 拖拽状态管理 + 释放后恢复漫游

4. **Plugin Bubble Arbiter（气泡仲裁器）**
   - 两个气泡槽位：transient（临时）和 pinned（固定）
   - 多插件气泡优先级仲裁
   - 气泡操作回调（action/submit）

5. **多代理宠物管理**
   - 每个 Agent 独立窗口 + 偏移定位
   - Agent 级瞬态显示和状态徽章
   - 15 秒 TTL 租约 + 5 秒心跳

6. **MCP Server**
   - 3 个工具：`openpets_status`/`openpets_react`/`openpets_say`
   - 5 层 zod 输入校验（防泄密）
   - 外部 AI 代理可通过 MCP 驱动宠物反应

#### 对 SpiritPal 的可借鉴点

| 特性 | openpets 实现 | SpiritPal 可借鉴 | 优先级 |
|------|-------------|--------------|--------|
| **8x9 spritesheet 互操作** | 完全兼容格式 | SpiritPal 可直接加载 OpenPets 宠物资源 | **P0** |
| **反应行映射** | 11 个 reactions → 行号 | SpiritPal ANIMATION_ROWS 可对齐扩展 | **P0** |
| **MCP Server 设计** | 3 工具 + zod 校验 | SpiritPal agentTools.ts 可增加 MCP 暴露 | P1 |
| **气泡仲裁器** | 双槽位优先级仲裁 | SpiritPal bubbleManager.ts 可参考仲裁模式 | P1 |
| **漫游引擎** | 屏幕边界检测 + 拖拽管理 | SpiritPal petWindow 可增加漫游模式 | P2 |
| **多代理宠物** | 每 Agent 独立窗口 | SpiritPal 多宠物模式的窗口管理参考 | P2 |
| **租约机制** | TTL + 心跳 + 过期清扫 | SpiritPal 多宠物资源管理参考 | P3 |

#### 项目质量评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 代码质量 | 9/10 | TypeScript 严格类型 + monorepo 架构 |
| 架构设计 | **9/10** | MCP 生态 + Plugin SDK 设计前瞻性极强 |
| 创新性 | **9/10** | 桌宠作为 AI 代理状态层的定位极具前瞻性 |
| 可维护性 | 8/10 | monorepo 模块化，但依赖复杂 |
| 与 SpiritPal 相关性 | **10/10** | **spritesheet 格式完全兼容 + MCP 生态直接可接入** |

---

## 3. 综合价值矩阵

### 3.1 按与 SpiritPal 相关性排名

| 排名 | 仓库 | 相关性评分 | 核心价值 | 可直接复用度 |
|------|------|-----------|---------|-------------|
| 1 | **openpets** | 10/10 | spritesheet 格式完全兼容 + MCP 生态 | **高**（格式零成本互操作） |
| 2 | **Live2DPet** | 9/10 | 情绪系统 + 反重复机制 + 视觉感知 | **中**（设计模式可借鉴） |
| 3 | **CodeWalkers** | 9/10 | Tauri v2 同栈 + PTY 终端 + 像素穿透 | **高**（Rust 代码直接参考） |
| 4 | **AI-Desktop-Pet** | 8/10 | 主动发言 + LLM 情绪提取 + 向量记忆 | **中**（模式可借鉴） |
| 5 | **clawd-on-desk** | 7/10 | 多代理状态映射 + 主题系统 | **中**（设计参考） |
| 6 | **Star-Office-UI** | 6/10 | 像素动画 + 多 Agent 架构 | **低**（架构参考） |

### 3.2 按技术栈匹配度排名

| 排名 | 仓库 | 技术栈匹配度 | 说明 |
|------|------|-------------|------|
| 1 | **CodeWalkers** | **100%** | Tauri v2 + React 19 + TypeScript + Rust，与 SpiritPal 完全同栈 |
| 2 | **openpets** | **80%** | Electron + React + TypeScript（桌面框架不同，但前端同栈） |
| 3 | **Live2DPet** | 60% | Electron + 原生 JS（前端不同，但架构理念可借鉴） |
| 4 | **AI-Desktop-Pet** | 50% | Electron + React 18 + Python（部分同栈） |
| 5 | **clawd-on-desk** | 40% | Electron + React（框架不同） |
| 6 | **Star-Office-UI** | 30% | Phaser + Flask + Electron（差异最大） |

### 3.3 按功能创新性排名

| 排名 | 仓库 | 创新性评分 | 核心创新点 |
|------|------|-----------|-----------|
| 1 | **clawd-on-desk** | 10/10 | 编码代理状态可视化 + 20+ 代理集成 + 权限气泡 |
| 2 | **Live2DPet** | 9/10 | 关键帧视觉记忆 + 情绪累积系统 + 音频降级状态机 |
| 3 | **openpets** | 9/10 | MCP 生态 + 桌宠作为 AI 代理状态层 |
| 4 | **AI-Desktop-Pet** | 7/10 | Live2D + 毒舌人设 + 向量记忆 |
| 5 | **CodeWalkers** | 8/10 | 桌宠 + AI 终端的创新组合 |
| 6 | **Star-Office-UI** | 8/10 | 多 Agent 像素办公室场景 |

---

## 4. 对 SpiritPal 项目的具体建议

### 4.1 P0 立即可做（Phase 1）

| # | 建议 | 来源仓库 | 实现思路 | 预计工作量 |
|---|------|---------|---------|-----------|
| 1 | **spritesheet 格式互操作** | openpets | SpiritPal ATLAS 与 openpets pet-format 已完全兼容，增加 `pet.json` 行映射适配器 | 2 小时 |
| 2 | **LLM 情绪→动画链路** | Live2DPet + AI-Desktop-Pet | 在 `llmClient.ts` 流式输出后扫描 emotion 关键词，调用动画切换 | 4 小时 |
| 3 | **主动发言 + 指数退避** | AI-Desktop-Pet | 在 `aiAgent.ts` 增加 `proactiveSpeak()`，40s→80s→...→3600s 阈值 | 3 小时 |
| 4 | **Tauri 窗口管理参考** | CodeWalkers | 参考 `lib.rs` 的窗口透明/穿透/托盘菜单 Rust 实现 | 4 小时 |

### 4.2 P1 中期实现（Phase 2）

| # | 建议 | 来源仓库 | 实现思路 | 预计工作量 |
|---|------|---------|---------|-----------|
| 5 | **MCP Server 暴露** | openpets | 参考 `packages/mcp` 的 3 工具设计，用 `@modelcontextprotocol/sdk` 实现 | 1 周 |
| 6 | **视觉感知扩展** | Live2DPet | `contextAwareness.ts` 增加定时截屏 + 活动窗口检测 + AI 分析 | 3 天 |
| 7 | **反重复机制** | Live2DPet | `aiAgent.ts` 增加话题/习惯 LLM 分析 + 结构模式检测 | 2 天 |
| 8 | **互动事件注入** | Live2DPet | `interactionCounter.ts` 扩展 hitBuffer → AI prompt 上下文注入 | 2 天 |
| 9 | **像素级点击穿透** | CodeWalkers | 参考 Canvas Alpha 检测方案优化 petWindow 穿透 | 3 天 |
| 10 | **气泡仲裁器** | openpets | `bubbleManager.ts` 增加 transient/pinned 双槽位 + 优先级仲裁 | 2 天 |
| 11 | **漫游引擎** | openpets | petWindow 增加屏幕边界检测 + 自由漫游 + 拖拽管理 | 3 天 |
| 12 | **音频状态机** | Live2DPet | 设计 TTS→默认音声→静音 三模式降级策略 | 2 天 |

### 4.3 P2 长期探索（Phase 3）

| # | 建议 | 来源仓库 | 实现思路 | 预计工作量 |
|---|------|---------|---------|-----------|
| 13 | **多代理宠物模式** | openpets + clawd-on-desk | 每个 AI 代理独立宠物窗口 + 状态徽章 | 2 周 |
| 14 | **PTY 终端集成** | CodeWalkers | agentTools.ts 增加 PTY 进程管理模式 | 1 周 |
| 15 | **关键帧视觉记忆** | Live2DPet | enhancedMemory.ts 增加视觉记忆层 | 1 周 |
| 16 | **Plugin SDK** | openpets + clawd-on-desk | modManager.ts 扩展为代码插件 SDK | 2 周 |
| 17 | **自定义主题生态** | clawd-on-desk | themeManager.ts 扩展多格式主题支持 | 1 周 |
| 18 | **移动端 PWA 镜像** | clawd-on-desk | 参考 LAN + Token 同步模式 | 1 周 |

---

## 5. 关键技术发现

### 5.1 Spritesheet 格式兼容性（极高价值发现）

**OpenPets 与 SpiritPal 的 spritesheet 格式在像素级完全兼容**：

| 属性 | OpenPets (pet-format) | SpiritPal (types.ts:ATLAS) |
|------|----------------------|-------------------------|
| 列数 | 8 | `cols: 8` |
| 行数 | 9 | `rows: 9` |
| 单帧宽 | 192 | `cellW: 192` |
| 单帧高 | 208 | `cellH: 208` |
| 整图尺寸 | 1536×1872 | 1536×1872 |
| 来源生态 | codexPet | OC-Claw codexPet 格式 |

**结论**：SpiritPal 可以直接加载 OpenPets 的宠物资源包，仅需适配 `pet.json` 行映射。这是零成本的生态互操作。

### 5.2 Live2DPet 情绪系统设计模式（高性价比借鉴）

Live2DPet 的情绪系统是 6 个仓库中最成熟的情绪驱动设计方案：

```
情绪累积 → AI 选择 → 表情/动作播放 → 恢复
   ↑                                      |
   └── 基础累积 + 悬停加速 + AI 奖励 ←──┘
```

**关键设计决策**：
- 情绪值是连续的浮点数，不是离散的枚举
- AI 在阈值达到时从可用表情池中选择（而非预设规则）
- 支持 expression（表情）和 motion（动作）两种类型并行
- 有 nextEmotionBuffer 机制让 AI 预选下一个情绪

### 5.3 CodeWalkers 的 Tauri PTY 集成模式（同栈直接参考）

CodeWalkers 的 `session.rs` 展示了如何在 Tauri v2 中管理外部进程：

```rust
// 关键模式:
// 1. Command::new(binary_path) 启动进程
// 2. child.stdout.take() 获取 stdout 句柄
// 3. std::thread::spawn 读取 stdout
// 4. app.emit("session_output_{id}", chunk) 转发到前端
// 5. 环境变量注入（shell env + .env 文件 + settings.json）
```

**这对 SpiritPal 的 agentTools.ts PTY 模式有直接参考价值**。

### 5.4 clawd-on-desk 的权限气泡系统（概念验证）

clawd-on-desk 的权限气泡系统验证了"桌宠作为 AI 权限代理"的可行性：
- AI 代理请求权限时 → 桌宠弹出气泡 → 用户在桌面审批
- 全局快捷键 (Ctrl+Shift+Y/N) 无需切换窗口
- 堆叠布局处理并发权限请求
- Agent 级开关控制气泡显示

---

## 6. 仓库质量评估总览

| 仓库 | 代码质量 | 架构设计 | 创新性 | 可维护性 | 与 SpiritPal 相关性 | 综合评分 |
|------|---------|---------|--------|---------|-----------------|---------|
| **openpets** | 9 | 9 | 9 | 8 | **10** | **9.0/10** |
| **Live2DPet** | 9 | **9** | 9 | 8 | **9** | **8.8/10** |
| **CodeWalkers** | 8 | **9** | 8 | 8 | **9** | **8.4/10** |
| **AI-Desktop-Pet** | 7 | 8 | 7 | 7 | 8 | **7.4/10** |
| **clawd-on-desk** | 8 | **9** | **10** | 7 | 7 | **8.2/10** |
| **Star-Office-UI** | 6 | 7 | 8 | 5 | 6 | **6.4/10** |

---

## 7. 总结与行动指南

### 7.1 核心收获

1. **格式兼容是最大红利**：openpets 的 8x9 spritesheet 与 SpiritPal 完全同源，可零成本互操作
2. **情绪系统是最大缺口**：Live2DPet 的 AI 驱动情绪累积系统是最值得移植的设计模式
3. **Tauri 同栈是最大便利**：CodeWalkers 的 Rust 代码可直接参考，减少 Tauri 集成风险
4. **MCP 生态是最大机会**：openpets 的 MCP Server 设计让 SpiritPal 可融入 AI 代理生态
5. **视觉感知是最大创新**：Live2DPet 的关键帧视觉记忆 + 窗口感知为 SpiritPal 提供了差异化方向

### 7.2 建议优先级路线图

```
Phase 1 (1-2 周):
  ├── spritesheet 格式互操作 ← openpets
  ├── LLM 情绪→动画链路 ← Live2DPet + AI-Desktop-Pet
  ├── 主动发言 + 指数退避 ← AI-Desktop-Pet
  └── Tauri 窗口管理优化 ← CodeWalkers

Phase 2 (1-2 月):
  ├── MCP Server 暴露 ← openpets
  ├── 视觉感知扩展 ← Live2DPet
  ├── 反重复机制 ← Live2DPet
  ├── 气泡仲裁器 ← openpets
  └── 漫游引擎 ← openpets

Phase 3 (3-6 月):
  ├── 多代理宠物模式 ← openpets + clawd-on-desk
  ├── 关键帧视觉记忆 ← Live2DPet
  ├── Plugin SDK ← openpets
  └── 自定义主题生态 ← clawd-on-desk
```

---

> **报告结束**
>
> 本报告基于 2026-07-23 对 `new_reference_repos` 目录下 6 个仓库的深度分析。所有代码引用均基于实际读取的源文件。
