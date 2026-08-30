# ai-live2d-go (Hiyori) 开源仓库技术分析报告

> 仓库地址：https://github.com/Moeru-ai/ai-live2d-go
> 分析日期：2026-07-23
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，为 SpiritPal（Tauri v2 + React 19 + Rust）提供可借鉴特性参考

---

## 目录

1. [项目概览](#1-项目概览)
2. [核心技术栈](#2-核心技术栈)
3. [项目架构与目录结构](#3-项目架构与目录结构)
4. [核心功能模块详解](#4-核心功能模块详解)
5. [可借鉴特性](#5-可借鉴特性)
6. [与 SpiritPal 的异同及移植建议](#6-与-spiritpal-的异同及移植建议)
7. [总结与技术参考价值](#7-总结与技术参考价值)

---

## 1. 项目概览

Hiyori 是一款 Live2D 桌面角色应用，运行在 Windows 上，内置完整的 AI Agent 系统。不同于普通的 Live2D 桌宠只能聊天，Hiyori 拥有 40+ 工具，可以自主规划和执行多步任务，同时保持动漫角色的可爱形象。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | Hiyori (ai-live2d-go) |
| 许可证 | MIT |
| 平台支持 | Windows 10/11 |
| 运行时 | Electron |
| 语言 | TypeScript |
| 一句话定位 | Live2D Desktop Pet x Full-featured AI Agent |

### 当前状态

项目功能完整，提供 AI Agent 系统、记忆系统、跨平台远程控制、Live2D 渲染和语音合成。

---

## 2. 核心技术栈

| 层级 | 技术 | 职责 |
|------|------|------|
| **前端框架** | Electron | 桌面壳 |
| **前端语言** | TypeScript | 类型安全 |
| **LLM** | OpenAI 兼容 | 大模型对话 |
| **渲染引擎** | Live2D Cubism | 角色渲染 |
| **TTS** | Edge-TTS / MOSS-TTS-Nano | 语音合成 |
| **Agent** | ReAct Loop | 推理-行动循环 |
| **记忆** | SQLite | 持久化存储 |

---

## 3. 项目架构与目录结构

```
ai-live2d-go/
├── src/                        # TypeScript 源码
│   ├── agent/                 # AI Agent 核心
│   ├── memory/                # 记忆系统
│   ├── tools/                 # 40+ 工具集
│   ├── live2d/                # Live2D 渲染
│   └── ...
│
├── models/                    # Live2D 模型资源
├── docs/                      # 文档
└── package.json
```

---

## 4. 核心功能模块详解

### 4.1 AI Agent 系统
- **ReAct Loop**：推理 → 行动 → 观察，3-10 轮自动执行
- **4 级工具模式**：Chat → Agent → Developer → Worker
- **40+ 工具**：Browser / Terminal / Files / Git / OCR / Cron
- **技能系统**：单个工具调用执行多步操作
- **任务追踪**：内置 Todo 用于复杂任务分解
- **批量执行**：Worker 模式并行子任务

### 4.2 记忆系统
- **对话级摘要**：每 10 轮自动精炼
- **全局核心记忆**：跨会话用户档案（Hermes 风格 USER + MEMORY 双块）
- **空闲调度器**：用户不活跃时后台摘要
- **启动追赶**：重启时批量处理未摘要历史
- **AI 自管理**：Agent 通过 `memory` 工具主动更新用户知识
- **SQLite 持久化**：WAL 模式，零外部依赖

### 4.3 跨平台远程控制
- **Discord Bot**：手机命令 → PC 执行 → 文件/截图回传
- **微信集成**：iLink Bot API，AES-128-ECB 加密 CDN 传输
- **智能文件搜索**：扫描 Desktop / Downloads / Documents
- **自动工具注入**：检测消息源，动态加载平台工具

### 4.4 Live2D 与语音
- **Hiyori / Hiyori Pro** 高质量 Live2D 模型
- 桌面拖拽、点击交互、自动眨眼/注视
- **Edge-TTS**：在线语音合成，零配置
- **MOSS-TTS-Nano**：本地离线语音克隆（17 种预设声音）

---

## 5. 可借鉴特性

### 5.1 AI Agent 架构
- ReAct Loop 推理-行动循环的设计
- 4 级工具模式的分层设计
- 40+ 工具集的组织方式

### 5.2 记忆系统
- 对话级摘要 + 全局核心记忆的双层设计
- AI 自管理记忆的机制
- SQLite WAL 模式的持久化方案

### 5.3 远程控制
- Discord/微信远程控制的实现方式
- 智能文件搜索的设计

---

## 6. 与 SpiritPal 的异同及移植建议

### 技术栈差异
| 维度 | Hiyori | SpiritPal |
|------|--------|--------|
| 桌面框架 | Electron | Tauri v2 |
| 语言 | TypeScript | TypeScript + Rust |
| Agent | ReAct Loop | 待设计 |
| 记忆 | SQLite | 本地向量检索 |

### 可移植特性
1. **ReAct Loop Agent 架构**：推理-行动-观察的循环设计
2. **4 级工具模式**：Chat → Agent → Developer → Worker 分层
3. **记忆系统设计**：对话摘要 + 全局核心记忆的双层架构
4. **TTS 集成**：Edge-TTS 零配置方案

---

## 7. 总结与技术参考价值

Hiyori 在 AI Agent 架构和记忆系统方面提供了非常有价值的设计参考。其 40+ 工具集和 4 级工具模式的设计思路值得深入学习。

**参考价值评分**：⭐⭐⭐⭐⭐（5/5）
- AI Agent 架构：极高参考价值
- 记忆系统设计：高参考价值
- TTS 集成方案：高参考价值
- 技术栈匹配度：中（Electron vs Tauri，但 TypeScript 通用）
