# dsh-pet 开源仓库技术分析报告

> 仓库地址：https://github.com/PC2005-cloud/dsh-pet
> 分析日期：2026-08-21
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，重点分析「DeepSeek Harness（DSH）Web 插件型桌宠」的实现方式与素材生成管线，与 SpiritPal（独立桌面应用）形成形态对照

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

dsh-pet 是一款**住在 DeepSeek Harness（DSH）Web 界面里的桌面宠物插件**。项目为"三件套"工程：提示词配方 → 素材生成链 → 插件成品，可从零生成属于自己的桌宠（共 **91 个动作**，素材由豆包生成 + PR 手工抠像）。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | dsh-pet |
| 仓库地址 | https://github.com/PC2005-cloud/dsh-pet |
| 作者 | PC2005-cloud |
| 许可证 | **MIT**（根 `LICENSE`，©2026） |
| 主语言 | TypeScript（插件本体）+ Python（素材生成链） |
| 形态 | DSH Web 插件（npm 包 `dsh-pet`） |
| 一句话定位 | 住在 DSH 界面里的、可零成本自生成的桌宠插件 |

### 规模

大项目：91 个动作的 GIF/webm 素材 + TS 插件 + Python 素材管线。

---

## 2. 核心技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 插件体系 | Cordis / React | DSH bundle 插件 |
| Peer 依赖 | `@deepseek-ai/cordis` / `dsh-client-runtime` | DSH 宿主接入 |
| 构建 | tsdown / rolldown | 插件打包 |
| 素材链 | Python + ffmpeg + numpy + scipy | 抠像 / 归一化管线 |

---

## 3. 项目结构与关键文件

```
dsh-pet/
├── src/
│   ├── host/index.ts            # 宿主（DSH 服务端）半边
│   ├── client/app.ts|config.ts|pickers.ts   # 浏览器半边动画链
│   └── design/                  # 动作设计配置
└── scripts/
    ├── chroma_step02.py         # 抠像管线
    └── normalize_step03.py      # 归一化管线
```

发布：npm 包 + Releases 附 `assets-videos.zip`（源视频）、`pr-project.zip`。

---

## 4. 核心功能

| 功能 | 说明 |
|------|------|
| 待机呼吸 | 基础待机动作 |
| 随机动作 | 打瞌睡等随机触发 |
| 转向 / 屏幕漫游 | 在 DSH 页面内移动 |
| 点击反应 / 可拖拽 | 交互反馈 |
| 动画链 | 永不停止；落地对齐 / 双缓冲交叉淡入 |
| 91 动作库 | 素材丰富度是其最大亮点 |

---

## 5. 与 SpiritPal 的异同及可借鉴特性

| 维度 | dsh-pet | SpiritPal | 差异 / 可借鉴 |
|------|---------|-----------|---------------|
| 形态 | DSH Web 插件（寄生宿主） | 独立 Tauri 应用 | 形态不同，生态不同 |
| 素材数量 | 91 个动作 | 50 种动画状态（自研） | SpiritPal 动画语义更丰富；dsh-pet 素材量大 |
| 素材管线 | Python 抠像 / 归一化（ffmpeg+numpy+scipy） | 精灵图工具（spriteSheetTool） | ⭐ 可借鉴：半自动生成 / 归一化管线，降低角色制作成本 |

### 可借鉴清单

| 特性 | 来源 | 优先级 | 难度 | 说明 |
|------|------|--------|------|------|
| **素材归一化 / 抠像管线** | `scripts/chroma_step02.py`、`normalize_step03.py` | P1 | 中 | 用 ffmpeg+numpy 将源视频统一缩放/对齐为标准帧，SpiritPal 的 `spriteSheetTool.ts` 可借鉴自动化流程 |
| **动画链落地对齐 / 双缓冲交叉淡入** | `src/client/` | P2 | 中 | 减少切换动画的跳变，提升体验 |
| **动作设计配置化** | `src/design/` | P2 | 低 | 用配置声明动作集，便于扩展 |

---

## 6. 总结与技术参考价值

dsh-pet 以 **MIT** 开源，价值集中在两处：一是它证明了"**寄生在 Web 宿主内的桌宠**"这一形态的可行性（与 SpiritPal 独立应用形态不同，可作竞品/生态观察）；二是其 **91 动作素材生成/归一化管线**为 SpiritPal 扩充角色动画资产提供了可借鉴的自动化流程。

> 报告基于 PC2005-cloud/dsh-pet 源码（main 分支，`c:\Users\Doro\repo_research\2_dsh-pet`）静态分析。