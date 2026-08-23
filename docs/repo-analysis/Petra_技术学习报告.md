# Petra 开源仓库技术分析报告

> 仓库地址：https://github.com/Wumiu/Petra
> 分析日期：2026-08-21
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，重点对比 Tauri v2 + 前端渲染的 AI 桌宠实现方案，为 SpiritPal（Tauri v2 + React 19 + Rust）提供可移植特性参考

---

## 目录

1. [项目概览](#1-项目概览)
2. [核心技术栈](#2-核心技术栈)
3. [项目结构与关键文件](#3-项目结构与关键文件)
4. [核心功能](#4-核心功能)
5. [与 SpiritPal 的异同及可借鉴特性](#5-与-spiritpal-的异同及可借鉴特性)
6. [总结与技术参考价值](#6-总结与技术参考价值)

---

## 1. 项目概览

Petra 是一款基于 **Tauri v2 + TypeScript + Rust** 构建的 Windows 桌面 AI 桌宠应用。其最大特色是内置 **Anime2.5DRig**——用户拖入分层 PSD 即可自动生成 2.5D 角色，同时兼容标准 Live2D 模型。宠物会漫游、躲避鼠标、视线跟随，并内置可聊天、可调用系统能力的 AI 小助手。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | Petra |
| 仓库地址 | https://github.com/Wumiu/Petra |
| 作者 | Wumiu（LICENSE 署名 FengLing） |
| 许可证 | **MIT**（`LICENSE` 文件，©2026） |
| 主语言 | TypeScript（前端）+ Rust（Tauri 2 后端） |
| 平台支持 | Windows（桌面） |
| 发布形态 | `Petra_*_x64.zip` + `setup.exe`（GitHub Releases） |
| 一句话定位 | 拖入 PSD 生成 2.5D 角色 / 兼容 Live2D 的 AI 桌宠小助手 |

### 规模

大型完整工程（前端 `src/`、Tauri 后端 `src-tauri/`、诊断脚本、Lock 文件等上百文件）。

---

## 2. 核心技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 桌面框架 | Tauri 2 | 透明窗口、托盘、自启、更新 |
| 前端框架 | Vite + TypeScript | 构建与类型安全 |
| 渲染引擎 | Pixi.js 6 | 2D 渲染基座 |
| Live2D | pixi-live2d-display | Live2D 模型加载与驱动 |
| PSD 解析 | ag-psd | 分层 PSD 解析（2.5D 生成） |
| 后端 | Rust + serde | 命令、SHELL 校验、DPAPI |
| 邮件 | lettre (smtp) | 后台邮件能力 |
| 窗口 | windows crate | Windows 原生交互 |
| 依赖插件 | @tauri-apps autostart / notification / updater | 自启/通知/更新 |

---

## 3. 项目结构与关键文件

```
Petra/
├── src/                         # 前端源码
│   ├── live2d/                  # PSD 运行时 + Live2D 渲染与驱动
│   ├── autonomous/
│   │   └── BehaviorEngine.ts    # 行为系统（漫游/待机）
│   ├── assistant/               # AI 小助手（流式对话/工具调用/记忆/主动问候）
│   ├── audio/
│   │   └── AudioAnalyzer.ts     # WASAPI 音乐驱动动画
│   ├── features/trash/          # 拖文件进回收站
│   └── input/                   # 鼠标视线追踪
└── src-tauri/src/
    ├── lib.rs                   # Tauri 命令 / SHELL 校验 / DPAPI
    ├── launch.rs                # 应用解析与启动
    ├── screen.rs / audio.rs / trash.rs
```

---

## 4. 核心功能

| 功能 | 说明 |
|------|------|
| 2.5D 角色生成 | 拖入分层 PSD，Anime2.5DRig 自动生成 2.5D 角色 |
| Live2D 兼容 | 标准 Live2D 模型支持 |
| 自主行为 | 漫游、躲避鼠标、15 项（1 组待机 + 动作库）动作 |
| AI 小助手 | 流式对话、工具调用（启动软件等）、长期记忆、主动问候 |
| 音乐驱动 | WASAPI 音频分析驱动宠物动画 |
| 系统集成 | 拖拽进回收站、托盘、开机自启、自动更新 |

---

## 5. 与 SpiritPal 的异同及可借鉴特性

| 维度 | Petra | SpiritPal | 差异 / 可借鉴 |
|------|-------|-----------|---------------|
| 桌面框架 | Tauri 2 | Tauri 2 | 同栈 |
| 前端渲染 | Pixi.js 6 + pixi-live2d-display | React + Live2D（待确认） | — |
| AI 助手 | 流式 + 工具调用 + 记忆 | 五维性格 + 四段式记忆历更先进 | Petra 的价值不在 AI，在「2.5D PSD 生成」 |
| 2.5D 生成 | ⭐ Anime2.5DRig（ag-psd 解析 PSD 生成角色） | 无 | **高价值**：免建模，用户拖 PSD 即可 DIY 桌宠，契合 SpiritPal「零基础个性化」定位 |

### 可借鉴清单

| 特性 | 来源 | 优先级 | 难度 | 说明 |
|------|------|--------|------|------|
| **PSD 分层 → 2.5D 角色生成** | `src/live2d/`（ag-psd） | P1 | 高 | 前端解析分层 PSD、按图层构建角色并叠加布局，是 Petra 最大差异点 |
| **行为系统分层** | `src/autonomous/BehaviorEngine.ts` | P1 | 中 | 漫游/待机/动作库的状态机组织方式可参考 |
| **AI 助手主动问候** | `src/assistant/` | P2 | 低 | 基于时段/事件触发的主动发言 |
| **WASAPI 音频驱动动画** | `src/audio/AudioAnalyzer.ts` | P2 | 高 | SpiritPal 已有 musicAwareness 概念，可参考其在 Rust 侧取音频频谱的做法 |

---

## 6. 总结与技术参考价值

Petra 以 **MIT** 开源，是与 SpiritPal 技术栈高度重合（Tauri 2）的 AI 桌宠。其核心参考价值在于 **「拖 PSD 自动生成 2.5D 角色」**的免建模路径，以及**行为系统 / AI 助手**的工程组织方式。因同为 Tauri 2 工程，`launch.rs`（应用解析启动）、`screen.rs`（多屏坐标）、DPAPI 加密等 Rust 侧实现也具备直接借鉴价值。

> 报告基于 Wumiu/Petra 源码（main 分支，`c:\Users\Doro\repo_research\1_Petra`）静态分析。