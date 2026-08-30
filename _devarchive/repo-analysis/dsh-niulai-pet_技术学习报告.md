# dsh-niulai-pet 开源仓库技术分析报告

> 仓库地址：https://github.com/whitefirer/dsh-niulai-pet
> 分析日期：2026-08-21
> 报告定位：基于 GitHub 源码仓库的系统性技术分析，重点分析 DSH 插件型桌宠的「任务完成喊声」「六皮肤」「语音 KWS 停喊」等特色实现

---

## 目录

1. [项目概览](#1-项目概览)
2. [核心技术栈](#2-核心技术栈)
3. 项目结构与关键文件
4. 核心功能
5. 与 SpiritPal 的异同及可借鉴特性
6. 总结与技术参考价值

---

## 1. 项目概览

dsh-niulai-pet 是一个在 DSH Web 角落养一头《牛来》小牛的插件桌宠：平时呼吸、眨眼、踱步、打盹；agent 任务完成时"喊妈妈"，并支持**语音喊「牛来」停循环**。另有在线试玩 standalone 页面复用同一套代码。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | dsh-niulai-pet |
| 仓库地址 | https://github.com/whitefirer/dsh-niulai-pet |
| 作者 | whitefirer |
| 许可证 | **MIT**（`LICENSE`，©2026） |
| 主语言 | TypeScript/React（client 半）+ JavaScript（host 半） |
| 形态 | DSH npm 插件 `dsh-niulai-pet` |
| 一句话定位 | 任务完成喊「妈妈」、支持语音停喊的 DSH 牛牛桌宠 |

### 规模

中等偏大：完整 TS 插件工程 + 六套皮肤素材 + wasm 语音模型 + 素材管线。

---

## 2. 核心技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 插件 | Cordis / React | DSH bundle 插件 |
| 依赖 | `@deepseek-ai/dsh-settings`、`@deepseek-ai/schemastery` | DSH 设置 / schema |
| 语音停喊 | sherpa-onnx 中文 KWS（zipformer KWS，17MB wasm）或 MFCC+DTW 模板匹配 | 识别"牛来"停循环 |
| 构建 | esbuild | 插件打包 |

---

## 3. 项目结构与关键文件

```
dsh-niulai-pet/
├── src/
│   ├── client/pet.ts|skins.ts|voice.ts|kws.ts|card.tsx   # 桌宠逻辑/皮肤/语音/设置卡片
│   └── host/index.js                                     # 注册 settings 命名空间 + /niulai-kws 静态路由
├── kws/                                                   # wasm 语音模型
└── tools/                                                 # 素材管线
```

---

## 4. 核心功能

| 功能 | 说明 |
|------|------|
| 六皮肤 | 牛来 / 原皮 / 小黄 / 奶牛 / 熊猫 / 蓝鲸 |
| 动作库 | 飞行 / 摇摆 / 转圈 / 连跳 / 翻滚 / 跃水 |
| 任务完成喊声 | agent 任务完成时触发 |
| 语音停喊 | 用户喊「牛来」即停止循环喊声（KWS 或模板匹配） |
| 交互 | 拖拽落地回弹、设置卡片(rc.7+)、任务完成动画 |

---

## 5. 与 SpiritPal 的异同及可借鉴特性

| 维度 | dsh-niulai-pet | SpiritPal | 差异 / 可借鉴 |
|------|----------------|-----------|---------------|
| 形态 | DSH 插件 | 独立 Tauri 应用 | 形态不同 |
| 动作库 | 六皮肤 × 多种动作 | 50 种动画状态机 | SpiritPal 更系统 |
| 语音停喊 | sherpa-onnx 中文 KWS（wasm） | 无语音输入 | ⭐ 可借鉴：本地 KWS 交互 |
| 任务完成反馈 | 喊声 + 动画 | taskManager 金币反馈 | 可叠加声效 |

### 可借鉴清单

| 特性 | 来源 | 优先级 | 难度 | 说明 |
|------|------|--------|------|------|
| **本地 KWS 关键词触发** | `src/client/kws.ts` + `kws/`（sherpa-onnx） | P2 | 高 | 在 SpiritPal 加「喊宠物名触发互动」，用 onnx wasm KWS 实现本地唤醒 |
| **任务完成强反馈（喊话/全屏动画）** | `src/client/pet.ts` | P1 | 低 | 类似 spiritpal 在 taskManager 完成时叠加声效+状态反馈 |
| **多皮肤配置化** | `src/client/skins.ts` | P1 | 低 | 皮肤数组驱动，SpiritPal 角色系统可参考其 skin 级别配置 |

---

## 6. 总结与技术参考价值

dsh-niulai-pet 以 **MIT** 开源，特色集中在**任务完成的可感知反馈**与**本地语音 KWS 交互**。前者与 SpiritPal 的 taskManager 天然互补，后者为 SpiritPal 未来做本地语音唤醒提供了 wasm 落地方案参考。因形态差异，不建议代码级移植，可借鉴设计。

> 报告基于 whitefirer 源码（main 分支，`c:\Users\Doro\repo_research\5_dsh-niulai-pet`）静态分析。