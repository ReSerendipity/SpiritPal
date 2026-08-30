# douyin-code 开源仓库技术分析报告

> 仓库地址：https://github.com/jianyangSong/douyin-code
> 分析日期：2026-08-21
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，重点分析其「桌面像素宠物（Python/PyQt5）」子项目的可借鉴点

---

## 目录

1. [项目概览](#1-项目概览)
2. 核心技术栈
3. 目录结构与关键文件
4. 核心功能
5. 与 SpiritPal 的异同及可借鉴特性（聚焦 desktop-pet）
6. 总结与技术参考价值

---

## 1. 项目概览

douyin-code 是作者「每日开发一个 AI 工具」的合集仓库，含两个相对独立的子项目：
1. **AI 写作助手**（TypeScript / Next.js 14，小红书种草文案生成）
2. **桌面像素宠物**（Python / PyQt5 + psutil + pygame）

本报告聚焦于其中的**桌面像素宠物子项目**。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | douyin-code |
| 仓库地址 | https://github.com/jianyangSong/douyin-code |
| 作者 | jianyangSong |
| 许可证 | **MIT**（根 `LICENSE`，©2025） |
| 主语言 | Python（desktop-pet）+ TypeScript（Next.js） |
| 形态 | 纯源码（desktop-pet 需 `python main.py` 运行；写作助手需 `next dev`） |
| 一句话定位 | 「每日一个 AI 工具」合集：桌面像素宠物 + AI 写作助手 |

### 规模

中等（约 30 文件，两子项目相对独立）。

---

## 2. 核心技术栈（desktop-pet）

| 技术 | 用途 |
|------|------|
| PyQt5 ==5.15.9 | 桌面窗口 / UI |
| psutil | 系统监控（CPU/内存/网速） |
| pygame | 动画帧渲染 |

---

## 3. 目录结构与关键文件（desktop-pet）

```
desktop-pet/
├── main.py          # 主程序
├── pet.py           # 宠物核心逻辑
├── memo.py          # 备忘录
├── monitor.py       # 系统监控
└── frames/          # idle/walk 动画帧
```

---

## 4. 核心功能（desktop-pet）

| 功能 | 说明 |
|------|------|
| 动画切换 | IDLE / WALK |
| 移动 | 横向往复移动 |
| 交互 | 左键单击暂停、双击开备忘录、拖拽、右键菜单 |
| 缩放 | 1–8 倍缩放 |
| 系统监控 | 悬停显示 CPU / 内存 / 网速 |

---

## 5. 与 SpiritPal 的异同及可借鉴特性

| 维度 | douyin-code desktop-pet | SpiritPal | 差异 / 可借鉴 |
|------|-------------------------|-----------|---------------|
| 技术栈 | Python/PyQt5 | Tauri2/React/Rust | 差异大，不可直移代码 |
| 动画 | IDLE/WALK 帧图 | 50 种动画状态机 | SpiritPal 更丰富 |
| 系统监控 | psutil CPU/内存/网速 | 有 contextAwareness | ⭐ 可借鉴：悬停展示系统信息 |
| 备忘录 | memo.py | 有日程/任务 | 功能重叠 |

### 可借鉴清单

| 特性 | 来源 | 优先级 | 难度 | 说明 |
|------|------|--------|------|------|
| **悬停展示系统监控** | `monitor.py` + `pet.py` | P2 | 低 | 在宠物气泡中展示 CPU/内存/网速，SpiritPal 的 contextAwareness 可扩展出系统状态气泡 |
| **1–8 倍滑块缩放** | `pet.py` | P3 | 低 | 缩放能力的简单实现演示 |

---

## 6. 总结与技术参考价值

douyin-code 以 **MIT** 开源，其桌面宠物子项目功能朴实，对 SpiritPal 的价值主要在**「悬停系统监控气泡」**这类轻量交互的参考，以及"每日一个工具"的开源学习组织方式。因技术栈差异，建议仅借鉴交互设计而非移植代码。

> 报告基于 jianyangSong 源码（main 分支，`c:\Users\Doro\repo_research\7_douyin-code`）静态分析。