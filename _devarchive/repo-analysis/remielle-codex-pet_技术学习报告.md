# remielle-codex-pet 开源仓库技术分析报告

> 仓库地址：https://github.com/HanaAyane/remielle-codex-pet
> 分析日期：2026-08-21
> 报告定位：基于 GitHub 素材仓库的技术分析，重点分析 Codex v2 原生桌宠资源包的格式（8×11 精灵图集、9 状态动作、16 向视线）与版权声明约束

---

## 目录

1. [项目概览](#1-项目概览)
2. 资源格式与核心技术
3. 目录结构与文件
4. 核心功能（状态动作）
5. 与 SpiritPal 的异同及可借鉴特性
6. 总结与技术参考价值（含版权提示）

---

## 1. 项目概览

remielle-codex-pet 是一个 **纯桌宠素材包**（不含程序代码），提供 Codex 原生 v2 桌宠资源：粉发白翼 Q 版蕾米小天使。将"工作中 / 检查中 / 完成庆祝"等状态映射成桌面反馈。

### 项目标识

| 属性 | 值 |
|------|-----|
| 项目名称 | remielle-codex-pet |
| 仓库地址 | https://github.com/HanaAyane/remielle-codex-pet |
| 作者 | HanaAyane |
| 许可证 | **无正式 LICENSE**；版权以 `NOTICE.md`（第三方来源）与 `ASSET-USAGE.md`（非商业署名说明）管理 |
| 形态 | 素材包（JSON + webp/GIF/PNG），Release 发 `remielle-codex-pet-v1.0.0.zip` |
| 一句话定位 | 米哈游《绝区零》非官方非商业同人衍生的 Codex v2 桌宠资源包 |

> ⚠️ **版权提示**：本项目为米哈游《绝区零》同人衍生，非官方、非商业，素材来自官方活动并 AI 重绘。**仅作格式学习参考，不可商用**。

### 规模

以素材为主（约 30 个文件，含 GIF/webp/PNG/JSON）。

---

## 2. 资源格式与核心技术

| 项 | 值 |
|----|-----|
| spritesheet | `output/xiaolemi/spritesheet.webp`，**1536×2288**，**8 列 × 11 行**精灵图集 |
| 安装清单 | `pet.json` + `spritesheet.webp` 两文件 |
| 安装目录 | `~/.codex/pets/xiaolemi/` |
| 视线 | 含 **16 向视线** |
| 动画触发映射 | `animation-triggers.json` |

---

## 3. 目录结构与文件

```
remielle-codex-pet/
├── output/xiaolemi/pet.json + spritesheet.webp   # 安装包本体
├── gif/1-7.gif                                   # 7 个原始动作源
├── animation-triggers.json                       # 状态 → 动作触发映射
└── 表情包单张预览/                               # 9 个透明 PNG 单帧
```

---

## 4. 核心功能（状态动作）

| 状态 | 说明 |
|------|------|
| idle / running | 待机 / 走动 |
| waving / jumping | 挥手 / 跳跃 |
| failed / waiting | 失败 / 等待 |
| working / review | 工作中 / 检查中 |
| 16 向视线 | 眼神跟随扩展 |

---

## 5. 与 SpiritPal 的异同及可借鉴特性

| 维度 | remielle-codex-pet | SpiritPal | 差异 / 可借鉴 |
|------|--------------------|-----------|---------------|
| 形态 | 素材包（无代码） | 完整应用 | 不重叠 |
| 精灵图 | 8×11 / 1536×2288 webp | 8×9 / 192×208 / 1536×1872 | ⭐ 结构高度相似（同 codex 生态），行数/尺寸略有差异但理念一致 |
| 状态动作 | 9 状态 + 16 向视线 | 6 类 50 种动画 | SpiritPal 更丰富；视线 16 向可借鉴 |
| 版权 | 同人非商业（NOTICE/ASSET-USAGE） | 自有资源 | 素材不可直接商用 |

### 可借鉴清单

| 特性 | 来源 | 优先级 | 难度 | 说明 |
|------|------|--------|------|------|
| **精灵图集结构验证** | `pet.json` + `spritesheet.webp` | P1 | 低 | 与 SpiritPal ATLAS（8 列×9 行）结构高度相似，印证 codex 桌宠素材规范；仅用于格式理解，素材不可商用 |
| **16 向视线扩展** | 精灵图集内视线方向 | P2 | 中 | SpiritPal 视线跟随目前较简单，可参考其视线分帧做法 |
| **animation-triggers 状态映射** | `animation-triggers.json` | P2 | 低 | 状态→动作触发声明式文件，SpiritPal `animationConfig.ts` 可参考其声明形式 |

---

## 6. 总结与技术参考价值（含版权提示）

remielle-codex-pet 是纯素材包，对 SpiritPal 的参考价值在于**验证 codex 生态桌宠精灵图集规范的一致性**（8 列 × 多行、webp、pet.json + spritesheet 双文件结构），以及 **16 向视线**与 **状态→动画触发映射** 的设计思路。因属米哈游同人非商业衍生且**无正式 LICENSE、素材不可商用**，**仅作格式与设计学习，禁止将素材用于 SpiritPal 发布物**。

> 报告基于 HanaAyane 素材仓库（main 分支，`c:\Users\Doro\repo_research\6_remielle-codex-pet`）静态分析。