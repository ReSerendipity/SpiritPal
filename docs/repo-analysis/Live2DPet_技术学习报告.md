# Live2DPet 开源仓库技术分析报告

> 仓库地址：https://github.com/x380kkm/Live2DPet
> 分析日期：2026-08-13
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，为 SpiritPal（Tauri v2 + React 19 + Rust）提供可借鉴特性参考

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

Live2DPet 是一款 **Electron 桌面宠物**，Live2D 角色常驻桌面，通过**截屏 + 窗口感知**理解用户行为，AI 大模型生成陪伴式对话，支持点击/拖拽互动，**关键帧视觉记忆**让 AI 了解用户近期活动，**VOICEVOX 语音合成**。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | Live2DPet |
| 仓库地址 | https://github.com/x380kkm/Live2DPet |
| 许可证 | 开源 |
| 技术栈 | Electron + JavaScript + Live2D |
| 一句话定位 | AI 视觉感知 Live2D 桌面宠物 + 情绪系统 |
| 平台 | Windows 优先 |

### 当前状态

**视觉感知 + 关键帧记忆** 是 SpiritPal 应该重点关注的特性。

---

## 2. 核心技术栈

| 维度 | 技术选型 | 用途 |
|------|----------|------|
| **桌面框架** | Electron | 跨平台桌面壳 |
| **前端** | 原生 JavaScript | 简单高效 |
| **Live2D** | pixi-live2d-display | 角色渲染 |
| **截屏** | 系统截屏 API | 视觉感知 |
| **AI** | OpenAI 兼容（推荐视觉模型） | 视觉理解 |
| **TTS** | **VOICEVOX**（本地日语 TTS） | 语音输出 |
| **记忆** | **关键帧视觉记忆** | 跨会话记忆 |
| **翻译** | OpenRouter 等 | 日语翻译 |

---

## 3. 项目架构与目录结构

```
Live2DPet/
├── main.js                       # Electron 主进程
├── preload.js                    # 预加载脚本
├── launch.js                     # 启动入口
├── desktop-pet.html              # 主窗口 HTML
├── config.json                   # 配置
├── libs/                         # 第三方库
│   └── pixi.min.js
├── assets/                       # 资源
│   ├── app-icon.png
│   ├── example-*.png             # 示例图
│   └── live2d/                   # Live2D 模型（用户导入）
├── CHANGELOG.md
├── PROGRESS.md
├── SPONSORS.md
├── README.md
├── README.en.md
└── README.ja.md
```

**架构模式**：简单 Electron + 单 HTML 入口 + pixi.js 渲染 Live2D。

---

## 4. 核心功能模块详解

### 4.1 视觉感知系统（核心创新）
- **定时截屏**：周期性捕获屏幕
- **发送给 AI API 分析**：使用多模态 LLM（如 Gemini 3 Pro）
- **AI 理解用户行为**：在看什么/在做什么
- **生成陪伴式对话**：基于场景的回应

### 4.2 关键帧视觉记忆
- 定期保存截屏作为"关键帧"
- AI 记住用户的视觉活动历史
- 跨会话保持记忆
- 类似人类的视觉记忆

### 4.3 Live2D 角色系统
- 用户导入自定义模型
- 支持 `.model.json` / `.model3.json`
- 自动识别表情/动作
- 多模型支持

### 4.4 情绪系统
- Live2D 表情/动作响应情绪
- AI 驱动的情绪变化
- 视觉感知触发情绪

### 4.5 VOICEVOX 语音合成
- **本地日语 TTS**：VOICEVOX 引擎
- 高质量日语语音
- **翻译 + TTS** 流程：外语→日语→语音

### 4.6 跨语言支持
- 中文（默认）
- 英文
- 日文

### 4.7 API 兼容性
- 兼容所有 OpenAI 格式
- 推荐使用支持 Vision 的模型
- OpenRouter 等聚合平台

---

## 5. 技术实现细节

### 截屏实现
```javascript
// Electron desktopCapturer
const { desktopCapturer } = require('electron');

async function captureScreen() {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1920, height: 1080 }
  });
  return sources[0].thumbnail.toDataURL();
}
```

### 视觉感知 prompt
```
[系统截图]
请分析用户当前在做什么。
要求：
1. 描述用户屏幕内容
2. 推测用户的活动（工作/学习/娱乐）
3. 给出自然的陪伴式回应（30字以内）
```

### 关键帧记忆
```javascript
class KeyframeMemory {
  save(screenshot, analysis) {
    const keyframe = {
      timestamp: Date.now(),
      image: screenshot,
      analysis: analysis,
      embedding: await this.embed(analysis)
    };
    this.store(keyframe);
  }
  
  async search(query) {
    // 向量检索相关历史截屏
  }
}
```

### Live2D 加载
```javascript
const { Live2DModel } = PIXI.live2d;

async function loadModel(modelPath) {
  const model = await Live2DModel.from(modelPath);
  app.stage.addChild(model);
  return model;
}
```

### 模型导入
```javascript
// 用户选择文件夹 → 读取 .model3.json
function importModel(folderPath) {
  const configPath = path.join(folderPath, '*.model3.json');
  const config = require(configPath);
  // 注册到模型列表
}
```

### VOICEVOX 集成
```javascript
// VOICEVOX 本地 HTTP API
async function tts(text) {
  // 1. 翻译成日语（如果需要）
  // 2. 调用 VOICEVOX
  const audio = await fetch('http://localhost:50021/audio_query', {
    method: 'POST',
    body: JSON.stringify({ text, speaker: 1 })
  });
  // 3. 合成音频
  // 4. 播放
}
```

---

## 6. 数据处理流程

```
定时截屏
  → 编码为 base64
  → 发送给多模态 LLM
  → 获得场景分析 + 陪伴回应
  → 存储为关键帧
  → Live2D 表情/动作变化
  → TTS 播放（可选）
  → 关键帧记忆用于未来对话
```

---

## 7. UI/UX 设计

- **Electron 透明窗口**
- **Live2D 角色常驻**
- **点击/拖拽交互**
- **多语言界面**
- **简洁设置面板**

---

## 8. 动画与渲染系统

- **Live2D Cubism**：标准 SDK
- **pixi-live2d-display**：JS 集成
- **WebGL 渲染**
- **表情/动作系统**
- **多模型导入**

---

## 9. AI/聊天集成分析

### 视觉感知 prompt
- 系统截图作为 image 输入
- 要求多模态 LLM（GPT-4V / Gemini 3 Pro / Grok 4）
- 推荐模型：Grok 性价比 / GPT-o3 / Gemini 3 Pro

### 翻译 API
- 用于 TTS 前翻译
- 推荐 OpenRouter `x-ai/grok-4-fast`

### 关键帧检索
- 跨会话检索相关历史
- 增强上下文连贯性

---

## 10. 构建与打包流程

### 直接运行
```bash
# 1. 安装 Node.js
# 2. 安装依赖
npm install
# 3. 启动（必须用 node launch.js，不要 npx electron .）
node launch.js
```

### 下载运行
- 从 Releases 下载 `Live2DPet.exe`
- 双击运行，无需安装

### 配置
- 启动后打开设置面板
- 填入 API 地址、密钥、模型
- 选择 Live2D 模型

---

## 11. 版本发布与迭代历史

通过 GitHub Releases 推测：
- 早期：基础 Live2D
- 中期：AI 对话
- 近期：视觉感知 + 关键帧记忆
- 当前：完整功能

---

## 12. 社区与Issue概况

- **小众项目**：日文社区较多
- **三语 README**
- **活跃 Issue**：用户咨询配置
- **Claude Code 辅助开发**（README 提及）

---

## 13. 优缺点分析

### 优点
1. **视觉感知**：独特创新
2. **关键帧记忆**：跨会话视觉记忆
3. **VOICEVOX 集成**：高质量日语 TTS
4. **Live2D 自定义导入**
5. **OpenAI 兼容**：灵活 LLM
6. **多语言**

### 缺点
1. **截屏隐私**：用户需信任 API
2. **仅 Windows**（推荐平台）
3. **API 配置复杂**：用户需自备 key
4. **VOICEVOX 需本地安装**：日语 TTS
5. **视觉感知资源开销**：定期截屏

---

## 14. 可借鉴特性

| # | 特性 | 评分 | SpiritPal 移植建议 | 目标文件 |
|---|------|------|-------------------|---------|
| 1 | **视觉感知（截屏）** | ★★★★★ | SpiritPal 可集成"看看"功能 | `src/lib/contextAwareness.ts` |
| 2 | **关键帧视觉记忆** | ★★★★★ | 增强 SpiritPal `keyframeMemory` | `src/lib/keyframeMemory.ts` |
| 3 | **VOICEVOX 集成** | ★★★ | 评估 SpiritPal TTS 引擎扩展 | `src/lib/ttsEngine.ts` |
| 4 | **多模态 LLM 调用** | ★★★★ | SpiritPal `llmClient` 可参考 | `src/lib/llmClient.ts` |
| 5 | **Live2D 自定义导入** | ★★★★ | SpiritPal `characterResourceImporter` | `src/lib/characterResourceImporter.ts` |
| 6 | **情绪系统** | ★★★ | SpiritPal `behaviorEngine` 可参考 | `src/lib/behaviorEngine.ts` |
| 7 | **截屏 API 集成** | ★★★★ | SpiritPal `screenshotManager` | `src/lib/screenshotManager.ts` |
| 8 | **跨语言 TTS 流程** | ★★★ | 评估 SpiritPal 多语言 TTS | `src/lib/ttsEngine.ts` |
| 9 | **OpenAI 兼容** | ★★★ | SpiritPal 已有 | `src/lib/llmClient.ts` |

---

## 15. 潜在改进点

1. **本地视觉模型**：避免 API 截屏
2. **关键帧智能选择**：仅保留重要时刻
3. **多角色对话**：多 Live2D 同时在线
4. **macOS / Linux 完整支持**
5. **截屏隐私增强**：本地 OCR

---

## 16. 跨平台支持评估

| 平台 | 支持情况 | 说明 |
|------|---------|------|
| **Windows** | ✅ 完整 | 推荐平台 |
| **macOS** | ⚠️ 推测 | Electron 兼容 |
| **Linux** | ⚠️ 推测 | Electron 兼容 |
| **Web** | ❌ | 桌面应用 |

---

## 17. 总结与技术参考价值

Live2DPet 是一款 **"视觉感知 + 关键帧记忆"的 AI 桌宠**。其核心创新（视觉感知、关键帧记忆）正是 SpiritPal 应该重点参考的方向——SpiritPal `keyframeMemory` 模块可以借鉴。

**核心参考价值**：
- **P0**：视觉感知系统（截屏 + LLM 分析）
- **P0**：关键帧视觉记忆（增强 SpiritPal `keyframeMemory`）
- **P0**：多模态 LLM 调用（SpiritPal `llmClient`）
- **P1**：VOICEVOX 集成（SpiritPal TTS 扩展）
- **P1**：Live2D 自定义导入（SpiritPal `characterResourceImporter`）
- **P1**：截屏 API 集成（SpiritPal `screenshotManager`）
- **P2**：跨语言 TTS 流程

**参考价值评分**：⭐⭐⭐⭐（4/5）
- 视觉感知：**独特价值**
- 与 SpiritPal 重叠度：**高**（桌宠 + AI）
- 设计模式可借鉴：**高**
- 代码可复用：低（需独立实现）
- 隐私顾虑：需注意

**集成路径**：
1. **立即**：参考视觉感知集成到 SpiritPal `contextAwareness`
2. **短期**：增强 `keyframeMemory` 支持关键帧视觉记忆
3. **中期**：评估 VOICEVOX 集成
