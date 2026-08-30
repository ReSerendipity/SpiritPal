# AI-Desktop-Pet-Extended 开源仓库技术分析报告

> 仓库地址：https://github.com/ruguo0119/AI-Desktop-Pet-Extended
> 分析日期：2026-08-13
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，为 SpiritPal（Tauri v2 + React 19 + TypeScript + Rust 跨平台 AI 桌宠）提供可借鉴特性参考

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

AI-Desktop-Pet-Extended 是 **AI-Desktop-Pet 的社区扩展版本**，由 ruguo0119 基于原项目 fork 并扩展。原项目使用 Electron + React + Python FastAPI 架构，本扩展版在保留核心功能的基础上**增强了记忆系统、扩展了角色支持、优化了交互模式**。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | AI-Desktop-Pet-Extended |
| 仓库地址 | https://github.com/ruguo0119/AI-Desktop-Pet-Extended |
| 基础项目 | AI-Desktop-Pet |
| 许可证 | MIT（推测，继承原项目） |
| 一句话定位 | AI-Desktop-Pet 的扩展版本，增强记忆与多角色 |
| 平台 | Windows / macOS / Linux |

### 当前状态

项目处于活跃维护中（基于 fork 持续迭代）。扩展主要在三个方面：
1. **记忆系统增强**：扩展 ChromaDB 使用，添加时间线视图
2. **多角色扩展**：支持更多 Live2D 模型与自定义角色
3. **交互模式优化**：增强拖拽、右键菜单、表情切换

---

## 2. 核心技术栈

继承自原项目 + 扩展：

| 维度 | 技术选型 | 用途 |
|------|----------|------|
| **前端框架** | React 18 + Vite | UI 构建 |
| **桌面框架** | Electron | 跨平台桌面壳 |
| **Live2D** | pixi.js + live2d-widget | 角色渲染 |
| **后端框架** | Python FastAPI | API 服务 |
| **WebSocket** | FastAPI WebSocket | 实时双向通信 |
| **LLM** | OpenAI 兼容（Gemini-3-pro/deepseek） | 大模型对话 |
| **TTS** | CosyVoice2-0.5B | 文字转语音 |
| **STT** | SenseVoiceSmall | 语音转文字 |
| **向量记忆** | ChromaDB（增强） | 长期记忆 + 时间线 |
| **事实记忆** | JSON 文件 | 简单事实库 |
| **新增** | 角色资源管理器 | 多 Live2D 模型管理 |

### 与原项目差异

| 模块 | 原项目 | 扩展版 |
|------|--------|--------|
| 记忆系统 | ChromaDB 基础 | ChromaDB + 时间线索引 + 事实库扩展 |
| 角色支持 | 3 个预制 | 3 个预制 + 用户自定义导入 |
| 表情/动作 | 固定映射 | 动态映射 + AI 驱动切换 |
| 交互模式 | 基础拖拽/点击 | 增强：右键菜单、长按手势 |
| 后端 | Python FastAPI | 同样的 Python FastAPI（继承） |

---

## 3. 项目架构与目录结构

```
AI-Desktop-Pet-Extended/
├── backend/                       # 继承自原项目
│   ├── main.py                    # FastAPI + WebSocket
│   ├── llm/                       # LLM 集成
│   ├── tts_stt/                   # 语音服务
│   ├── memory/                    # 增强的记忆系统
│   │   ├── chroma_store.py        #   ChromaDB
│   │   ├── timeline.py            #   🆕 时间线索引
│   │   ├── fact_store.py          #   事实库（扩展）
│   │   └── retriever.py           #   检索器
│   ├── emotion/                   # 情感引擎（增强）
│   ├── vision/                    # 视觉感知
│   └── routes/                    # REST 路由
│
├── frontend/                      # 继承 + 扩展
│   ├── src/
│   │   ├── components/
│   │   │   ├── Pet/               # 🆕 角色资源管理器
│   │   │   ├── Chat/              # 聊天窗口（增强）
│   │   │   ├── Settings/          # 设置面板（增强）
│   │   │   ├── MemoryViewer/      # 🆕 记忆可视化
│   │   │   └── Timeline/          # 🆕 时间线组件
│   │   ├── live2d/                # Live2D 加载（支持自定义）
│   │   ├── store/                 # 状态管理
│   │   ├── hooks/                 # WebSocket + 表情
│   │   └── App.tsx
│   ├── electron/                  # Electron 主进程
│   └── package.json
│
├── models/                        # Live2D 模型
│   ├── default/                   #   预制 3 角色
│   └── custom/                    # 🆕 用户自定义角色目录
│
└── README.md
```

**架构演进**：在原项目基础上新增 `Timeline` 和 `MemoryViewer` 模块，体现"功能增强型 fork"模式。

---

## 4. 核心功能模块详解

### 4.1 增强的记忆系统
- **ChromaDB 基础**：继承原项目
- **时间线索引**：按时间组织记忆，支持"上个月/今天/最近"等时间维度查询
- **事实库扩展**：除简单事实外，添加"偏好/事件/人物"分类
- **记忆可视化**：UI 可查看 AI 记住了什么

### 4.2 多角色系统
- **预制角色**：Haru / Hiyori / PinkFox（继承）
- **自定义导入**：用户可导入 `.model3.json` Live2D 模型
- **角色配置**：每个角色独立的表情/动作/语音配置
- **角色切换**：UI 一键切换

### 4.3 增强的交互模式
- **右键菜单**：除点击/拖拽外，新增右键菜单（设置/切换角色/查看记忆等）
- **长按手势**：长按触发特殊动作
- **表情切换 UI**：手动切换 Live2D 表情

### 4.4 AI 驱动表情系统
- **自动表情**：根据对话情绪自动切换（继承）
- **手动覆盖**：用户可手动选择表情
- **情绪曲线**：记录情绪变化历史

### 4.5 时间线视图（核心新增）
- **按时间浏览记忆**：日/周/月视图
- **关键事件标记**：用户主动标记重要事件
- **回溯功能**：查看"昨天/上周 AI 学到了什么"

---

## 5. 技术实现细节

### 时间线索引
```python
# 伪代码：基于 ChromaDB 元数据过滤
results = collection.query(
    query_texts=[query],
    where={
        "timestamp": {"$gte": week_ago, "$lte": now},
        "user_id": user_id
    }
)
```

### 自定义角色导入
```python
# 后端：接收用户上传的 Live2D 模型
@app.post("/api/character/import")
async def import_character(files: List[UploadFile]):
    # 1. 解压 zip
    # 2. 验证 .model3.json
    # 3. 复制到 models/custom/
    # 4. 提取表情/动作元数据
    # 5. 注册到角色列表
```

### 记忆可视化 API
```python
@app.get("/api/memory/timeline")
async def get_timeline(user_id: str, range: str = "week"):
    # 返回时间线数据：[{date, count, summary, top_memories}]
```

### 表情动态映射
```javascript
// 前端：AI 返回情绪标签 → 映射到 Live2D 表情
async function onAIResponse(text, emotion) {
  const expression = await getExpressionForEmotion(emotion);
  live2dModel.expression(expression);
  // 同时记录到情绪曲线
  emotionCurve.push({ timestamp: Date.now(), emotion });
}
```

---

## 6. 数据处理流程

```
用户输入
  → WebSocket 发送
  → 后端接收
  → STT（如果是语音）
  → ChromaDB 检索（含时间过滤）
  → 构造 prompt（含时间线上下文）
  → LLM 流式生成
  → WebSocket 推送
  → 前端显示 + TTS 播放
  → AI 情绪标签
  → Live2D 表情切换
  → 情绪曲线记录
  → 存储记忆（含时间戳 + 情绪标签）
```

---

## 7. UI/UX 设计

- **继承原项目**：透明窗口、Live2D 角色
- **新增组件**：
  - 记忆可视化面板（时间线视图）
  - 角色资源管理器
  - 右键菜单
  - 表情选择器
- **交互优化**：长按手势、多点触控支持

---

## 8. 动画与渲染系统

继承原项目 + 增强：
- **AI 驱动表情**：根据情绪动态切换
- **情绪曲线**：记录情绪变化
- **角色动作库**：每个角色独立的动作集
- **动作随机化**：Idle 状态随机播放动作

---

## 9. AI/聊天集成分析

继承原项目 + 增强：
- **情绪标签输出**：AI 返回结构化响应（含 emotion 字段）
- **时间感知**：根据当前时间生成问候语
- **记忆引用**：AI 回答时可引用"我记得你昨天说..."

```json
{
  "type": "ai_response",
  "text": "早上好！",
  "emotion": "happy",
  "memory_refs": ["mem_001", "mem_005"]
}
```

---

## 10. 构建与打包流程

与原项目一致：
```bash
cd backend && pip install -r requirements.txt && python main.py
cd frontend && npm install && npm run dev
npm run electron:build
```

---

## 11. 版本发布与迭代历史

基于原项目 fork 后的扩展迭代：
- v1.0：与原项目同步基线
- v1.1：时间线索引
- v1.2：记忆可视化
- v1.3：自定义角色导入
- v1.4：情绪曲线
- v2.0：右键菜单 + 表情选择器

---

## 12. 社区与Issue概况

- **Stars**：基于原项目的影响力，star 数有所增长
- **Issues**：用户报告自定义角色导入、TTS 服务兼容性问题
- **PR 流程**：基于 fork 模式，社区贡献通过 PR 合并
- **文档**：README 与原项目类似，部分内容待补充扩展部分说明

---

## 13. 优缺点分析

### 优点
1. **增强记忆可视化**：用户可看到 AI 记住了什么
2. **时间线索引**：记忆按时间组织，检索更精准
3. **自定义角色**：用户可导入自己的 Live2D 模型
4. **AI 情绪驱动**：根据对话自动切换表情
5. **功能演进清晰**：版本化扩展
6. **继承原项目优点**：所有原项目功能保留

### 缺点
1. **依赖原项目**：原项目停止维护则扩展也受影响
2. **代码同步成本**：需定期与上游同步
3. **Electron 体积问题未解决**：继承原项目
4. **Python 后端**：未做一体化打包
5. **自定义角色版权**：用户导入的模型版权需用户负责

---

## 14. 可借鉴特性

| # | 特性 | 评分 | SpiritPal 移植建议 | 目标文件 |
|---|------|------|-------------------|---------|
| 1 | **时间线索引** | ★★★★★ | 记忆按时间组织 + 时间过滤 | `src/lib/keyframeMemory.ts` |
| 2 | **记忆可视化** | ★★★★ | MemoryPanel 增强时间线视图 | `src/components/MemoryVisualization.tsx` |
| 3 | **自定义角色导入** | ★★★★★ | 用户可导入 Live2D 模型 | `src/lib/characterResourceImporter.ts` |
| 4 | **AI 情绪驱动** | ★★★★ | LLM 返回 emotion 字段 | `src/lib/emotionExtractor.ts` |
| 5 | **情绪曲线** | ★★★ | 记录情绪变化历史 | `src/lib/emotionManager.ts` |
| 6 | **右键菜单** | ★★★★ | PetContextMenu 增强 | `src/components/PetContextMenu.tsx` |
| 7 | **记忆引用** | ★★★★ | AI 回答时引用历史 | `src/lib/recallEngine.ts` |
| 8 | **角色资源管理** | ★★★ | CharacterManager 模块 | `src/lib/characters.ts` |
| 9 | **时间感知问候** | ★★★ | 基于时间的主动发言 | `src/lib/proactiveSpeak.ts` |

---

## 15. 潜在改进点

1. **记忆去重**：检测相似记忆并合并
2. **记忆重要性评分**：让 AI 区分重要/普通记忆
3. **隐私模式**：本地优先 vs 云端记忆
4. **跨设备同步**：记忆可在多设备同步
5. **记忆导入/导出**：用户可备份
6. **多模态记忆**：支持图片/语音记忆

---

## 16. 跨平台支持评估

与原项目一致：Windows / macOS / Linux 三端支持（Electron 跨平台）。

---

## 17. 总结与技术参考价值

AI-Desktop-Pet-Extended 是**典型的"功能增强型 fork"案例**，在原项目基础上做有限的、针对性的扩展，避免了重写整个项目的高成本。对 SpiritPal 而言，**其扩展模块本身就是 SpiritPal 已规划或已实现的功能**，因此参考价值在于：

1. **如何做 fork 扩展**：保留基线、增量添加、新增独立模块
2. **时间线索引设计**：可直接复用 SpiritPal 的 `keyframeMemory.ts`
3. **记忆可视化 UI**：参考其 MemoryViewer 设计

**核心参考价值**：
- **P0**：时间线索引设计（SpiritPal 已部分实现，可对照）
- **P0**：AI 情绪驱动表情（SpiritPal `emotionExtractor`）
- **P1**：自定义角色导入（SpiritPal `characterResourceImporter`）
- **P1**：记忆引用机制（SpiritPal `recallEngine`）
- **P2**：情绪曲线追踪（SpiritPal `emotionManager` 扩展）

**参考价值评分**：⭐⭐⭐（3/5）
- 功能完整度：中（继承基线 + 增量）
- 与 SpiritPal 重叠度：高（很多功能 SpiritPal 已实现）
- 设计模式可借鉴：时间线索引
- 代码复用度：低（需重写为 Tauri + React）

**集成路径**：作为"对标参考"对比 SpiritPal 的记忆系统实现差异；时间线索引设计可直接借鉴到 `keyframeMemory.ts`。
