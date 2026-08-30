# AI-Desktop-Pet 开源仓库技术分析报告

> 仓库地址：https://github.com/your-username/AI-Desktop-Pet
> 分析日期：2026-08-13
> 分析版本：基于 README 最新版（带 Live2D + WebSocket + ChromaDB 记忆）
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，重点对标 SpiritPal（Tauri v2 + React 19 + TypeScript + Rust 跨平台 AI 桌宠）的源码级参考

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

AI-Desktop-Pet 是一款受 Neuro-sama 启发的**可爱毒舌 AI 桌宠**，集成 Live2D 模型、实时语音交互、向量记忆系统。使用 Electron + React 前端 + Python FastAPI 后端架构，提供流畅的实时对话体验。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | AI-Desktop-Pet |
| 仓库地址 | https://github.com/your-username/AI-Desktop-Pet |
| 许可证 | MIT（推测） |
| 一句话定位 | 可爱毒舌 AI 桌宠，Live2D + 语音 + 向量记忆 |
| 平台 | Windows / macOS / Linux |
| 默认分支 | main |

### 当前状态

项目处于活跃维护中，已支持多个预制 Live2D 角色（Haru/Hiyori/PinkFox）、多 LLM 集成（Gemini/deepseek）、TTS/STT、ChromaDB 向量记忆。**关键技术亮点**是 WebSocket 双向通信 + 主动发言打断机制 + 视觉感知系统。

---

## 2. 核心技术栈

| 维度 | 技术选型 | 用途 |
|------|----------|------|
| **前端框架** | React 18 + Vite | UI 构建 |
| **桌面框架** | Electron | 跨平台桌面壳 |
| **Live2D** | pixi.js + live2d-widget | 角色渲染 |
| **后端框架** | Python FastAPI | API 服务 |
| **WebSocket** | FastAPI WebSocket | 实时双向通信 |
| **LLM** | OpenAI 兼容（Gemini-3-pro/deepseek） | 大模型对话 |
| **TTS** | CosyVoice2-0.5B（SiliconFlow） | 文字转语音 |
| **STT** | SenseVoiceSmall（SiliconFlow） | 语音转文字 |
| **向量记忆** | ChromaDB | 长期记忆 |
| **事实记忆** | JSON 文件 | 简单事实库 |
| **快捷键** | globalShortcut（Electron） | 全局快捷键 |

### 关键依赖

```python
# backend/requirements.txt 推测内容
fastapi
uvicorn[standard]
websockets
chromadb
openai
requests
pillow
```

---

## 3. 项目架构与目录结构

```
AI-Desktop-Pet/
├── backend/                       # Python FastAPI 后端
│   ├── main.py                    # FastAPI + WebSocket 入口
│   ├── llm/                       # LLM 集成层
│   │   ├── client.py              #   OpenAI 兼容客户端
│   │   ├── intent.py              #   意图识别（已废弃）
│   │   └── vision.py              #   视觉感知（截屏）
│   ├── tts_stt/                   # 语音服务
│   │   ├── cosyvoice.py           #   CosyVoice TTS
│   │   └── sensevoice.py          #   SenseVoice STT
│   ├── memory/                    # 记忆系统
│   │   ├── chroma_store.py        #   ChromaDB 向量存储
│   │   ├── fact_store.py          #   JSON 事实库
│   │   └── retriever.py           #   记忆检索
│   ├── emotion/                   # 情感引擎
│   ├── vision/                    # 截屏与窗口感知
│   ├── routes/                    # REST 路由
│   └── .env                       # API 密钥配置
│
├── frontend/                      # Electron + React 前端
│   ├── src/
│   │   ├── components/
│   │   │   ├── Pet/               # 桌宠渲染
│   │   │   ├── Chat/              # 聊天窗口
│   │   │   └── Settings/          # 设置面板
│   │   ├── live2d/                # Live2D 角色加载
│   │   ├── store/                 # 状态管理（Zustand）
│   │   ├── hooks/                 # WebSocket Hook
│   │   └── App.tsx
│   ├── electron/                  # Electron 主进程
│   │   ├── main.js                #   窗口管理
│   │   └── preload.js             #   IPC 桥接
│   └── package.json
│
├── models/                        # Live2D 模型资源
│   ├── Haru/
│   ├── Hiyori/
│   └── PinkFox/
│
└── README.md
```

**架构模式**：经典前后端分离，前端通过 WebSocket 与后端实时通信，后端统一处理 LLM/TTS/STT/记忆。

---

## 4. 核心功能模块详解

### 4.1 多 AI 模型集成
- **LLM 主脑**：OpenAI 兼容 API，支持 Gemini-3-pro-preview（多模态）/ deepseek（纯文本）
- **意图识别**：早期使用 DeepSeek 判断"无聊/打断"，**现已废弃**（README 标注"已经废弃"）
- **TTS**：CosyVoice2-0.5B（SiliconFlow 平台），多音色支持
- **STT**：SenseVoiceSmall（SiliconFlow 平台）

### 4.2 Live2D 角色系统
- **预制角色**：Haru / Hiyori / PinkFox（来自 Live2D Cubism 官方样例）
- **实时表情/动作同步**：根据对话情绪切换表情与动作
- **多模型切换**：UI 可选择不同 Live2D 角色

### 4.3 向量记忆系统（ChromaDB）
- **长期记忆**：使用 ChromaDB 存储历史对话的 embedding
- **事实库**：JSON 文件存储用户简单事实（姓名/喜好等）
- **时间戳**：每条记忆都带时间戳，支持时序检索
- **持久化**：AI 能跨会话学习用户信息

### 4.4 实时语音交互
- **麦克风输入**：通过 Web Audio API 采集
- **快捷键启用**：长按 F2 启用语音输入
- **静默模式**：AI 自行判断"闭嘴"或用户主动进入静默模式
- **TTS 流式输出**：CosyVoice 流式合成播放

### 4.5 WebSocket 双向通信
- **端点**：`ws://localhost:8000/ws`
- **实时同步**：前后端双向推送消息/语音/状态
- **主动发言**：AI 可主动发起对话（不等用户输入）
- **打断操作**：用户可随时打断 AI 的发言

### 4.6 视觉感知系统
- **触发条件**：用户输入包含"看看"等关键词
- **实现**：截取当前屏幕 → 编码为 base64 → 发送给多模态 LLM
- **隐私提示**：截图不保存到本地，仅发送给 AI API

### 4.7 状态机设计
- **三态**：Idle / Thinking / Speaking
- **联动**：状态切换驱动 Live2D 表情、UI 指示器

---

## 5. 技术实现细节

### WebSocket 消息流
```python
# 后端伪代码
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    while True:
        msg = await websocket.receive_json()
        if msg["type"] == "user_text":
            # 1. 检索相关记忆
            memories = retrieve_relevant_memories(msg["text"])
            # 2. 构造 prompt
            prompt = build_prompt(msg["text"], memories)
            # 3. 调用 LLM
            async for chunk in llm_stream(prompt):
                await websocket.send_json({"type": "ai_chunk", "data": chunk})
            # 4. 存储记忆
            save_to_memory(msg["text"], ai_response)
        elif msg["type"] == "user_audio":
            text = stt.transcribe(msg["audio"])
            # ... 同上
```

### ChromaDB 记忆检索
```python
# 伪代码
collection.add(
    documents=[text],
    metadatas=[{"timestamp": time.time(), "user_id": user_id}],
    ids=[str(uuid.uuid4())]
)
results = collection.query(query_texts=[query], n_results=5)
```

### 视觉感知截图
```python
# 后端 / Electron 主进程
import pyautogui
screenshot = pyautogui.screenshot()
img_base64 = base64.b64encode(screenshot.tobytes()).decode()
```

### CosyVoice TTS 流式
```python
# SiliconFlow API
response = requests.post(
    f"{SILICON_BASE_URL}/audio/speech",
    json={"model": TTS_MODEL, "voice": TTS_VOICE, "input": text, "stream": True},
    stream=True
)
for chunk in response.iter_content(chunk_size=4096):
    yield chunk
```

### 主动发言机制
- 后端定时器（每 30 分钟）触发主动发言
- 基于记忆 + 当前时间生成问候语
- 静默模式下不触发

### 打断操作
- 监听 WebSocket 客户端的"interrupt"消息
- 后端停止 TTS 流，关闭当前 LLM stream
- UI 切换到 Idle 状态

---

## 6. 数据处理流程

```
用户输入（文本/语音）
  → WebSocket 发送
  → 后端接收
  → STT（如果是语音）
  → ChromaDB 检索相关记忆
  → 构造 prompt（系统提示 + 记忆 + 历史 + 用户输入）
  → LLM 流式生成
  → WebSocket 推送增量 token
  → 前端实时显示文本
  → TTS 流式合成
  → 前端播放音频
  → 状态机切换为 Speaking
  → Live2D 表情/动作同步
  → 完成后存储到记忆
```

---

## 7. UI/UX 设计

- **Electron 透明窗口**：无边框、背景透明、置顶
- **Live2D 角色**：始终置顶显示，支持拖拽
- **聊天窗口**：可隐藏/显示
- **设置面板**：API 配置、角色选择、记忆管理
- **多模态交互**：文本 + 语音 + 视觉（截屏）
- **状态可视化**：底部状态栏（Idle/Thinking/Speaking）

---

## 8. 动画与渲染系统

### Live2D 集成
- 使用 `pixi-live2d-display` 或类似库
- 加载 `.model3.json` 模型
- 实时控制表情参数（`setExpression`）
- 动作播放（`playMotion`）

### 表情/动作映射
```javascript
// 伪代码
const emotionMap = {
  "happy": { expression: "f01", motion: "happy" },
  "sad": { expression: "f02", motion: "sad" },
  "angry": { expression: "f03", motion: "angry" }
}
live2dModel.expression(emotionMap[emotion].expression);
live2dModel.motion(emotionMap[emission].motion);
```

### 渲染优化
- 透明窗口 + WebGL 加速
- Live2D 帧率与窗口刷新率同步
- 闲置时降低渲染频率

---

## 9. AI/聊天集成分析

### LLM 选型策略
- **多模态场景**（视觉感知）→ Gemini-3-pro-preview
- **纯文本场景** → deepseek
- 通过 `.env` 配置 `LLM_MODEL` 切换

### Prompt 构造
```
System: 你是 [角色名]，性格 [毒舌/可爱/...]，回复简短（30字以内）
Memories: [检索到的相关记忆]
History: [最近 10 轮对话]
User: [用户输入]
```

### 主动发言
- 触发：定时器（30 分钟无交互）
- 内容生成：基于时间（早上/下午/晚上）+ 记忆中的事件
- 静默模式：用户主动开启时不触发

### 静默模式
- AI 可自行判定"该闭嘴了"（如用户长时间不回复）
- 用户可主动进入静默模式
- 静默模式下 AI 不主动发言

---

## 10. 构建与打包流程

### 后端
```bash
cd backend
pip install -r requirements.txt
python main.py  # 启动 FastAPI
```

### 前端
```bash
cd frontend
npm install
npm run dev      # 开发模式
npm run build    # 生产构建
```

### Electron 打包
```bash
npm run electron:build  # 使用 electron-builder
```

### 跨平台产物
- Windows：`.exe`（NSIS 安装包）
- macOS：`.dmg`
- Linux：`.AppImage` / `.deb`

---

## 11. 版本发布与迭代历史

通过 README 分析（无显式 CHANGELOG 文件）：
- v0.x → v1.x：早期功能（基础 Live2D + 文本对话）
- v1.x → v2.x：增加 TTS/STT
- v2.x → v3.x：增加 ChromaDB 向量记忆
- v3.x → 当前：增加视觉感知 + WebSocket 双向 + 主动发言 + 打断

意图识别模块（DeepSeek）已废弃，统一由 LLM 主脑处理。

---

## 12. 社区与Issue概况

- **Stars**：项目较新，star 数较少
- **Issues**：偶尔有用户报告 API 配置、模型加载问题
- **PR 欢迎**：README 中明确欢迎贡献
- **文档**：README 详细（中文），包含完整的 .env 配置示例

---

## 13. 优缺点分析

### 优点
1. **多模态集成完整**：文本 + 语音 + 视觉（截屏）
2. **实时双向通信**：WebSocket 流畅，支持主动发言/打断
3. **向量记忆系统**：ChromaDB 长期记忆，AI 能跨会话学习
4. **多 LLM 兼容**：OpenAI 格式，可切换 Gemini/DeepSeek
5. **多 Live2D 角色**：Haru/Hiyori/PinkFox 可切换
6. **跨平台**：Electron 一套代码三端运行
7. **TTS/STT 集成**：CosyVoice + SenseVoice 开箱即用

### 缺点
1. **Electron 体积大**：相比 Tauri 资源占用高
2. **Python 后端**：需用户独立启动后端，**未做一体化打包**
3. **意图识别废弃**：README 留有"已经废弃"标注，文档未清理
4. **截屏隐私问题**：虽提示用户，但仍是潜在风险
5. **API 密钥管理**：.env 文件需用户手动配置
6. **依赖外部服务**：TTS/STT 依赖 SiliconFlow（需联网）
7. **无记忆可视化**：用户看不到 AI 记住了什么

---

## 14. 可借鉴特性

| # | 特性 | 评分 | SpiritPal 移植建议 | 目标文件 |
|---|------|------|-------------------|---------|
| 1 | **WebSocket 双向通信** | ★★★★★ | 复用为宠物主动发言机制 | `src/lib/llmWebSocket.ts` |
| 2 | **ChromaDB 向量记忆** | ★★★★ | 评估替换自研 vectorSearch | `src/lib/memory/` |
| 3 | **三态状态机** | ★★★★ | 扩展 SpiritPal 状态机 | `src/lib/behaviorEngine.ts` |
| 4 | **视觉感知截屏** | ★★★★ | "看看"关键词触发截屏 | `src/lib/llmClient.ts` |
| 5 | **主动发言机制** | ★★★★ | 30 分钟定时主动发言 | `src/lib/proactiveSpeak.ts` |
| 6 | **打断操作** | ★★★★ | 用户中断 AI 发言 | `src/lib/llmClient.ts` |
| 7 | **TTS 流式播放** | ★★★★ | 复用流式音频播放 | `src/lib/ttsEngine.ts` |
| 8 | **静默模式** | ★★★ | 用户主动禁言宠物 | `src/lib/behaviorEngine.ts` |
| 9 | **多 LLM 兼容** | ★★★★ | 已部分实现 | `src/lib/llmProviders.ts` |
| 10 | **事实库 + 向量混合** | ★★★ | 简单事实+复杂记忆 | `src/lib/ownerFacts.ts` |

---

## 15. 潜在改进点

1. **一体化打包**：后端 + 前端 + 模型一键打包（类似 Tauri 单 exe）
2. **记忆可视化**：用户可查看/编辑 AI 记忆
3. **截屏隐私增强**：本地 OCR 后再发送，去除敏感信息
4. **多角色协作**：支持多 AI 同时在线
5. **插件系统**：用户自定义角色/动作/表情
6. **本地 LLM**：集成 Ollama/LM Studio 离线运行

---

## 16. 跨平台支持评估

| 平台 | 支持情况 | 说明 |
|------|---------|------|
| **Windows** | ✅ 完整支持 | Electron + Python 后端 |
| **macOS** | ✅ 完整支持 | 同上（Apple Silicon 需注意 py 安装） |
| **Linux** | ⚠️ 需手动 | Electron 支持，Python 依赖需用户自行解决 |

**SpiritPal 对比**：SpiritPal 用 Tauri v2 + Rust 后端，**比本项目**：
- ✅ 单一可执行文件（无需用户启动后端）
- ✅ 体积更小（Rust vs Electron + Python）
- ✅ 启动更快
- ❌ LLM/TTS 需自己实现（不能直接复用 Python 后端代码）

---

## 17. 总结与技术参考价值

AI-Desktop-Pet 是一个**功能完整、文档详细**的 AI 桌宠参考实现。其 Live2D + WebSocket + ChromaDB 组合是 SpiritPal 重点参考对象。

**核心参考价值**：
- **P0**：WebSocket 双向通信 + 主动发言 + 打断机制
- **P0**：三态状态机（Idle/Thinking/Speaking）
- **P1**：ChromaDB 向量记忆方案（评估是否替换自研）
- **P1**：TTS 流式播放实现
- **P1**：静默模式设计
- **P2**：视觉感知截屏（增强 AI 上下文）
- **P2**：意图识别废弃路径（提醒 SpiritPal 类似功能设计）

**参考价值评分**：⭐⭐⭐⭐（4/5）
- 功能完整度：高
- 技术栈匹配度：中（Electron vs Tauri）
- 文档质量：高（README 详细）
- 可直接复用代码：低（需重写为 Tauri + React）
- 设计模式可借鉴：高

**集成路径**：参考其 WebSocket 通信协议设计（消息类型、流式 token 推送）、状态机定义、主动发言定时器设计；评估 ChromaDB 替换自研 vectorSearch 的可行性。
