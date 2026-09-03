# 学习计划：全量学习 7 个参考开源项目的可借鉴方案

> **生成日期**：2026-07-14
> **目标项目**：PetPal（Tauri v2 + React 19 + TypeScript + Rust 跨平台 AI 桌面宠物）
> **工作目录**：`c:\Users\HONOR\Pet`
> **关联参考**：`docs/analysis/`（已有 7 仓库分析 MD）、`repos/`（已有 7 仓库源码）

---

## 一、任务背景与目标

通过前序联网检索，识别出与 PetPal 在技术栈 / 功能 / 场景上高度相似的 7 个开源项目：

1. **BongoCat** — Tauri + Vue + Rust 跨平台 Live2D 桌宠（同栈验证标杆）
2. **WindowPet** — Tauri + React + TS + Zustand + Mantine 桌宠叠加层（同栈同前端）
3. **Open-LLM-VTuber** — Python + Electron + Live2D 的离线语音 AI 伴侣（AI+Live2D 桌宠模式）
4. **DyberPet** — Python + PySide6 养成框架（已在 `repos/` + `docs/analysis/` 存在分析）
5. **VPet** — C# + WPF 虚拟桌宠模拟器（养成 + Steam 创意工坊模组生态）
6. **super-agent-party** — JS + VRM + MCP 的 3D AI 桌面伴侣（长期记忆 / 多端部署）
7. **OpenPets** — TypeScript + Electron + MCP 的桌宠平台（插件 SDK + Agent 状态层）

**关键现状**：经探查 `petpal-app/src/lib/`，PetPal 已实现 `buffManager.ts`、`chatStages.ts`、`interactionCounter.ts`、`llmProviders.ts`、`items.ts`、`taskManager.ts`、`personalityEngine.ts`、`enhancedMemory.ts`、`modManager.ts` 等——即已大量吸收**前 7 仓库**（Dororo/DyberPet/EchoBot/Feibi/Murasame/Ameath/OC-Claw）的方案。

**本计划交付物**：
- 将 6 个**新仓库**（除 DyberPet 外）克隆到 `repos/`；
- 为每个新仓库编写一份源码级分析 MD（格式对齐 `OC-Claw_Repo_Analysis.md`）；
- 为 DyberPet 补一份补充分析（覆盖旧报告未涉及的模块）；
- 产出一份跨仓库的《新仓库对 PetPal 项目的持续价值分析》（对齐 `7仓库对PetPal项目的持续价值分析.md`），聚焦 PetPal **尚未吸收** 的可借鉴方案并给出优先级 / Phase / 移植难度。

**注意**：本计划是「研究 / 文档产出」计划，**不实现任何功能代码**，仅产出克隆仓库 + 分析文档。

---

## 二、当前状态分析（已确认事实）

| 项目 | GitHub 仓库 | 已验证 | 技术栈 | 许可证 | 最近活跃 |
|------|-------------|--------|--------|--------|----------|
| BongoCat | ayangweb/BongoCat | ✅ | Tauri + Vue3 + TS + Rust | MIT | 2026-04（v1.1.0） |
| WindowPet | SeakMengs/WindowPet | ✅ | Tauri + React + TS + Zustand + Mantine | MIT | 2025-04（v0.0.9） |
| Open-LLM-VTuber | Open-LLM-VTuber/Open-LLM-VTuber | ✅ | Python(FastAPI) + Electron + Live2D | MIT | 2026-05（v1.2.1） |
| VPet | LorisYounger/VPet | ✅ | C# + WPF (.NET8) | Apache-2.0 | 2026-06 |
| super-agent-party | heshengtao/super-agent-party | ✅ | JS + VRM/Three.js + MCP | AGPL-3.0 | 2026-06（v0.4.2） |
| OpenPets | OpenPetsHQ/openpets | ✅ | TS + Electron + MCP 插件 SDK | MIT | 2026-06（v3.1.0） |
| DyberPet | 已在 `repos/DyberPet` + `docs/analysis/DyberPet_Repo_Analysis.md` | ✅ | Python + PySide6 | — | 旧报告已覆盖 |

`repos/` 现有：Dororo、DyberPet、EchoBot、Feibi_desktop、MurasamePet、ameath_DesktopPet、oc-claw（**7 个**）。
`docs/analysis/` 现有：7 仓库各自报告 + `7仓库对PetPal项目的持续价值分析.md`。

---

## 三、具体执行步骤

### 步骤 1：克隆 6 个新仓库到 `repos/`

在 PowerShell 终端执行（使用浅克隆以减少体积，跳过大二进制 / 子模块）：

```powershell
cd c:\Users\HONOR\Pet\repos
git clone --depth 1 https://github.com/ayangweb/BongoCat.git
git clone --depth 1 https://github.com/SeakMengs/WindowPet.git
git clone --depth 1 --no-recurse-submodules https://github.com/Open-LLM-VTuber/Open-LLM-VTuber.git
git clone --depth 1 https://github.com/LorisYounger/VPet.git
git clone --depth 1 https://github.com/heshengtao/super-agent-party.git
git clone --depth 1 https://github.com/OpenPetsHQ/openpets.git
```

**回退方案（若本机无网络/无 git）**：不克隆，改用 WebFetch 抓取各仓库关键源文件（`https://raw.githubusercontent.com/<owner>/<repo>/<branch>/<path>`）进行源码级分析；在对应分析 MD 顶部标注「未本地克隆，基于 GitHub 在线源码」。

**体积控制**：Open-LLM-VTuber 的 `live2d-models/`、`avatars/` 与 super-agent-party 的 `tha_models/`、`vrm/`、`tiktoken_cache/` 可能为大型二进制，浅克隆 `--depth 1` 已能控制；如仍过大，可加 `.git/info/sparse-checkout` 仅拉取源码目录（`src/`、`src-tauri/`、`packages/`、`VPet-Simulator.Core/`）。

**注意许可**：super-agent-party 为 **AGPL-3.0**（强 copyleft），分析时注明「仅作学习参考，商用需授权」；VPet 为 Apache-2.0；其余 MIT。

### 步骤 2：逐仓库源码级分析（产出 6 份 MD）

每份 MD 对齐 `OC-Claw_Repo_Analysis.md` 的结构，重点章节：

1. **项目概览**：owner/repo、Star/Fork/贡献者、许可证、最近版本与活跃度、定位一句话
2. **核心技术栈**：前端 / 后端 / 桌面框架 / 渲染 / 构建 / 包管理器
3. **项目架构与目录结构**（树形 + 关键文件说明）
4. **核心功能模块详解**（按模块列表 + 表格）
5. **技术实现细节**（**精确到文件:行号**，如 BongoCat `src-tauri/src/*.rs` 透明窗、WindowPet `src/**` 宠物叠加层、Open-LLM-VTuber `src/open_llm_vtuber/**` 情绪映射、VPet `VPet-Simulator.Core/Graph/PNGAnimation`、super-agent-party `py/**` 长期记忆、OpenPets `packages/sdk` 插件运行时）
6. **可借鉴特性**（列出具体可移植点 + 源文件定位）
7. **与 PetPal 的异同及移植建议**：每项标注 `优先级(P0/P1/P2)` / 对应 PetPal 现状文件（`petpal-app/src/lib/*.ts`）/ 移植难度（极低/低/中/高）/ 建议 Phase
8. **总结与技术参考价值**

**各仓库重点分析方向（基于已确认的 README/结构）**：

- **BongoCat**：Tauri 透明窗 + 置顶 + 点击穿透实现、自启、自动更新、模型导入、多显示器/输入追踪。对照 PetPal `tauri.conf.json`、`lib.rs`、`updater.ts`。
- **WindowPet**：**同栈同前端**（Tauri+React+TS+Zustand），45+ 宠物角色定义、宠物叠加层、点击穿透、自启、自动更新、设置窗口路由、`LEARN.md` 教学。对照 PetPal `App.tsx` 路由、`petStore.ts`、`settingsStore.ts`、角色系统。重点确认其 8×9 精灵图集是否与 PetPal `types.ts` 的 `ATLAS 8×9` 一致。
- **Open-LLM-VTuber**：**Live2D + 桌宠模式 + 本地 LLM** 融合；情绪映射（`set emotion`→Cubism 表情）、主动说话、AI 内心想法展示、多后端 TTS/ASR、MCP。对照 PetPal `personalityEngine.ts`、`animationConfig.ts`、`llmClient.ts`、`aiAgent.ts`。重点提取「LLM 输出 → 表情/动作标签」后处理机制（PetPal 尚未实现）。
- **VPet**：**养成 + 模组生态最强**；`IFood` 物品接口、`GameSave` 存档、`PNGAnimation`/`GraphCore` 动画核心、32×4×3 动画、Steam 创意工坊 + ModMaker + 插件 SDK（`VPet.Plugin.Demo`）。对照 PetPal `items.ts`、`petStore.ts`、`modManager.ts`、`communityApi.ts`。重点提取「动画状态×类型×互动」三维动画矩阵与插件化思路。
- **super-agent-party**：**Fast & Slow Brain 双脑架构**、长期记忆、SillyTavern 角色卡、MCP、任务中心、计算机控制、多端部署。对照 PetPal `enhancedMemory.ts`、`personalityEngine.ts`、`agentTools.ts`。重点提取「长期记忆持久化 + 多端（QQ/B站/Discord）」架构。
- **OpenPets**：**桌宠作为 AI Agent 状态层**；MCP 工具（`openpets_react`/`openpets_say`/`openpets_status`）、插件 SDK v3（`ctx.pets/ui/audio/schedule/ai/storage`）、`pet-format` 宠物清单 schema、8×9 spritesheet 格式（`@open-pets/pet-format`）。对照 PetPal `types.ts`(ATLAS)、`agentTools.ts`、`modManager.ts`。重点确认 spritesheet 格式一致性（可兼容 PetPal `8×9` 图集）。

### 步骤 3：DyberPet 补充分析

`repos/DyberPet` 与 `docs/analysis/DyberPet_Repo_Analysis.md` 已存在，但旧报告（2026-07-12）未覆盖其 v0.7.7+ 部分模块。产出 **`DyberPet_补充分析.md`**，聚焦旧报告未深入的：对话系统（`dialogue_exp`/`dialogue_graph` 多分支对话）、收藏系统（`collection.md`）、`Dashboard/shopUI.py` 商店 UI、`bubble_conf.json` 气泡配置、最新 `art_dev.md` 物品 schema 更新。明确标注「不重复旧报告已覆盖的 HP 概率矩阵 / Buff / 任务 / 物品 schema 主体」。

### 步骤 4：产出跨仓库 consolidated 分析

编写 **`新仓库对PetPal项目的持续价值分析.md`**，对齐 `7仓库对PetPal项目的持续价值分析.md` 的章节：

- 概述 + 方法 + PetPal 当前技术栈/已实现功能表（基于最新 `petpal-app/src/lib/` 实际文件）
- 逐仓库「已采纳 / 尚未采纳但高价值」，**每项给源文件:行号 + TypeScript 移植片段 + 优先级 + Phase + 难度**
- 综合价值矩阵（按功能缺口 / 仓库排名 / 移植难度）
- 关键发现：明确标注「PetPal 必须从头设计」且新仓库也无法提供的内容（如五维性格引擎、四段式记忆差异化）
- 推荐移植优先级（Phase 1/2/3 列表）
- 各仓库关键文件索引表
- 结论 + 资源复用比例

**重点映射 PetPal 当前已存在但可增强的模块**：
`buffManager.ts`(对标 VPet IFood/Buff)、`chatStages.ts`(对标 Open-LLM-VTuber 主动说话)、`interactionCounter.ts`(已吸收 Dororo，可对照 BongoCat 输入追踪)、`llmProviders.ts`(已吸收 Ameath，可对照 Open-LLM-VTuber 多后端)、`modManager.ts`/`communityApi.ts`(对标 VPet 创意工坊 / OpenPets 插件 SDK)、`enhancedMemory.ts`(对标 super-agent-party 长期记忆)、`agentTools.ts`(对标 OpenPets MCP 状态层)、`animationConfig.ts`(对标 VPet 三维动画矩阵 / Open-LLM-VTuber 情绪映射)。

---

## 四、输出文件清单

```
repos/                          （新增 6 个克隆仓库 + 已有 7 个）
  ├─ BongoCat/
  ├─ WindowPet/
  ├─ Open-LLM-VTuber/
  ├─ VPet/
  ├─ super-agent-party/
  └─ openpets/

docs/analysis/                  （新增 7 份 MD，沿用现有命名风格）
  ├─ BongoCat_Repo_Analysis.md
  ├─ WindowPet_Repo_Analysis.md
  ├─ OpenLLMVTuber_Repo_Analysis.md
  ├─ VPet_Repo_Analysis.md
  ├─ SuperAgentParty_Repo_Analysis.md
  ├─ OpenPets_Repo_Analysis.md
  ├─ DyberPet_补充分析.md
  └─ 新仓库对PetPal项目的持续价值分析.md
```

---

## 五、假设与决策

1. **交付范围**：仅克隆仓库 + 产出分析文档，不修改 PetPal 业务代码（与研究型计划一致）。
2. **分析深度**：源码级（尽量精确到 文件:行号），对齐现有报告质量；无法精确行号时给出文件路径 + 函数/类名。
3. **克隆策略**：默认 `git clone --depth 1`；无网络时用 WebFetch 在线源码替代，并在 MD 标注。
4. **DyberPet**：不重复旧报告，仅补充分支对话 / 收藏 / 最新 schema 等未覆盖模块。
5. **许可提示**：super-agent-party(AGPL-3.0) 与 VPet(Apache-2.0) 在分析 MD 中标注许可约束，仅作学习参考。
6. **格式对齐**：所有 MD 沿用 `OC-Claw_Repo_Analysis.md` 的中文结构、章节标题与「优先级/Phase/难度」标注体系，保证 `docs/analysis/` 内部一致。

---

## 六、验证步骤

1. `repos/` 下确认 6 个新目录存在且包含源码（非空）。
2. `docs/analysis/` 下确认 7 份新 MD 均生成，且文件名风格与现有报告一致。
3. 抽查 2~3 份 MD，确认含「与 PetPal 的异同及移植建议」且含优先级/Phase/难度标注。
4. 抽查 consolidated 报告，确认含「综合价值矩阵」与「关键文件索引」，且已对照 PetPal 当前 `petpal-app/src/lib/` 实际文件（非旧版假设）。
5. 确认 AGPL/Apache 许可项目已在对应 MD 中标注约束。
