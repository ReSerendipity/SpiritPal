# deepseek-harness-pet 开源仓库技术分析报告

> 仓库地址：https://github.com/wraven68/deepseek-harness-pet
> 分析日期：2026-08-21
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，重点分析 Python(tkinter) 独立 EXE 桌宠如何读取 DeepSeek Harness 会话日志来展示任务状态

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

deepseek-harness-pet 是一款 **Windows 桌面助手 (Python / tkinter)**：只读取本机 DeepSeek Harness（DSH）会话日志，在无边框透明的顶置窗口中展示待办任务进度 / 状态 / 任务列表。程序本体为独立 EXE，普通用户无需安装 Python。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | deepseek-harness-pet |
| 仓库地址 | https://github.com/wraven68/deepseek-harness-pet |
| 作者 | wraven68 |
| 许可证 | **MIT**（`LICENSE`，©2026） |
| 主语言 | Python 3.11+（tkinter） |
| 形态 | PyInstaller 独立 EXE + PowerShell 安装器 |
| 一句话定位 | 读取 DSH 会话日志、展示任务完成状态的小桌面助手 |

### 规模

小项目（约 15 个文件：10 个根文件 + `assets/selected/` 5 张 PNG）。

---

## 2. 核心技术栈

| 技术 | 用途 |
|------|------|
| Python 3.11+ | 主程序 |
| tkinter | 无边框透明顶置窗口 / UI |
| Pillow | 图像处理 |
| zstandard | 解析 DSH 的 Zstandard 压缩会话日志 |
| PyInstaller | 打包独立 EXE |

---

## 3. 项目结构与关键文件

```
deepseek-harness-pet/
├── pet.py                    # 主程序（约 460 行）
├── harness_status.py         # 读取解析 DSH 本地会话日志
├── Install-DeepSeekHarnessPet.ps1   # 安装器（下载 EXE、核 SHA-256、建快捷方式）
└── assets/selected/          # 5 张状态 PNG（idle/working/complete/resting/blink）
```

---

## 4. 核心功能

| 功能 | 说明 |
|------|------|
| 任务状态显示 | 读取 DSH 会话日志，展示待办进度 / 状态 / 任务列表 |
| 五状态帧 | idle / working / complete / resting / blink |
| 绿幕去背 | 背景抠除实现透明 |
| 缩放 | 25%–145% 无级缩放 |
| 粒子特效 | 完成任务时的特效反馈 |
| 任务面板 | 大号任务面板展示清单 |
| 交互 | 拖拽移动、右键菜单 |

---

## 5. 与 SpiritPal 的异同及可借鉴特性

| 维度 | deepseek-harness-pet | SpiritPal | 差异 / 可借鉴 |
|------|---------------------|-----------|---------------|
| 技术栈 | Python/tkinter | Tauri2/React/Rust | 差异大，不可直移代码 |
| 数据源 | 读取 DSH 本地会话日志 | 自建 AI Agent/记忆 | 形态不同 |
| 状态帧 | 5 个状态 PNG | 50 种动画状态机 | SpiritPal 更丰富 |
| 任务面板 | 顶置任务清单 UI | 有 taskManager + 番茄钟 | ⭐ 有启发 |

### 可借鉴清单

| 特性 | 来源 | 优先级 | 难度 | 说明 |
|------|------|--------|------|------|
| **"任务完成 → 宠物状态反馈"闭环** | `pet.py` 五状态帧 + 粒子特效 | P1 | 低 | 把任务进度映射到宠物 idle/working/complete/blink，SpiritPal 已有 taskManager，可叠加状态行反馈 |
| **顶置任务面板** | `pet.py` | P2 | 中 | 在宠物旁展示待办清单的可折叠面板 |
| **SHA-256 校验安装器脚本** | `Install-*.ps1` | P3 | 低 | 发布校验与一键安装的工程化做法 |

---

## 6. 总结与技术参考价值

deepseek-harness-pet 以 **MIT** 开源，体量小、逻辑精简。最大启发是 **「任务状态 → 桌宠可视反馈」**的直白闭环：把工作/完成外化成宠物状态与特效。SpiritPal 已具备 taskManager，可低成本借鉴这套"状态帧切换 + 完成反馈"的思路。因技术栈差异，不建议代码级移植。

> 报告基于 wraven68 源码（main 分支，`c:\Users\Doro\repo_research\3_deepseek-harness-pet`）静态分析。