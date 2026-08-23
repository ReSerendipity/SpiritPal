# DeepSeek-Balance-Whale-Widget 开源仓库技术分析报告

> 仓库地址：https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget
> 分析日期：2026-08-21
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，重点分析 DSH Web 插件型"余额小挂件"的实现（纯 JS、SVG 绘制、宿主路由）

---

## 目录

1. [项目概览](#1-项目概览)
2. [核心技术栈](#2-核心技术栈)
3. [项目结构与关键文件](#3-项目结构与关键文件)
4. [核心功能](#4-核心功能)
5. 与 SpiritPal 的异同及可借鉴特性
6. 总结与技术参考价值

---

## 1. 项目概览

DeepSeek-Balance-Whale-Widget 是一个 DSH Web 右下角的 **DeepSeek API 余额小鲸鱼挂件**：展示余额、今日已用、峰谷定价。它是标准 DSH bundle 插件，纯 JavaScript 实现，挂件本体由宿主代码绘制 SVG。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | DeepSeek-Balance-Whale-Widget |
| 仓库地址 | https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget |
| 作者 | MeteorNOX |
| 许可证 | MIT（package.json 标注；**无独立 LICENSE 文件**） |
| 主语言 | JavaScript（宿主插件 `lib/index.js`） |
| 形态 | DSH npm 插件 `dsh-whale-widget` |
| 一句话定位 | DSH 界面右下角的 DeepSeek 余额小鲸鱼挂件 |

### 规模

小项目（约 11 个文件）。

---

## 2. 核心技术栈

| 技术 | 用途 |
|------|------|
| Node / Cordis | DSH 插件体系 |
| 纯 JS | 宿主插件本体（无编译依赖、无 dependencies 字段） |
| SVG | 鲸鱼气泡 / 界面绘制 |

---

## 3. 项目结构与关键文件

```
DeepSeek-Balance-Whale-Widget/
├── lib/index.js              # 宿主侧插件本体
│                              # 路由：/dsh-whale/image.png /balance.json /size.json
├── assets/DSniang1.png       # 鲸鱼本体
├── Ya1/Ya2/D1/D2.mp3         # 音效
├── whale-widget-prompt.md    # 完整规格说明
└── cordis.patch.yml          # 挂载声明
```

发布：npm 包 + GitHub Actions `publish.yml`。

---

## 4. 核心功能

| 功能 | 说明 |
|------|------|
| 余额展示 | 自启 + 滚动动画 + 60s 刷新 |
| 今日已用 | 小鲸鱼记账 / 实时令牌双模式 |
| 吸附 | 拖拽四边吸附、水平镜像 |
| 交互 | 汉堡菜单、Q 弹、随机台词气泡、音效 |

---

## 5. 与 SpiritPal 的异同及可借鉴特性

| 维度 | Balance-Whale | SpiritPal | 差异 / 可借鉴 |
|------|---------------|-----------|---------------|
| 形态 | DSH Web 插件（纯 JS） | 独立 Tauri 应用 | 形态不同 |
| 功能 | 显示 API 余额/用量 | 无 API 用量展示 | ⭐ 可借鉴：为 LLM 用量做可视化 |
| 技术 | SVG 绘制 + 宿主路由 | React + Tailwind | SVG 思路可参考 |

### 可借鉴清单

| 特性 | 来源 | 优先级 | 难度 | 说明 |
|------|------|--------|------|------|
| **LLM/Tool 用量可视化挂件** | `lib/index.js`（balance.json + 60s 刷新） | P2 | 低 | SpiritPal 依赖多 LLM service，可在设置页增加 token 用量/余额展示，参考其数据刷新与布局 |
| **吸附 + 水平镜像交互** | `lib/index.js` | P3 | 低 | 通用桌面浮层吸附交互，SpiritPal 桌宠边缘吸附已类似 |

---

## 6. 总结与技术参考价值

该项目以 **MIT** 标注、纯 JS 极简实现，属"工具型寄生插件"。对 SpiritPal 的参考价值有限但明确：**把 LLM 用量/余额做成可视化小挂件** 的交互与数据刷新模式，可作为 SpiritPal 设置页或桌宠气泡的增强参考。技术栈与形态不重叠，不建议代码移植。

> 报告基于 MeteorNOX 源码（main 分支，`c:\Users\Doro\repo_research\4_DS-Balance-Whale`）静态分析。