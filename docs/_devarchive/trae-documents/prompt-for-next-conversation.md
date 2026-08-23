# PetPal 项目开发提示词（新对话使用）

> **使用方法**：将下方 `---` 之间的内容完整复制到新对话中即可。AI 会自动读取分析文档并按照优先级执行移植任务。

---

## 项目背景

我是 **PetPal** 项目的开发者。PetPal 是一款基于 **Tauri v2 + React 19 + TypeScript + Rust** 的跨平台 AI 桌面宠物应用，支持 Live2D/精灵图双渲染、本地 LLM（Ollama/vLLM/MXKit）、五维性格引擎、四段式记忆系统、养成系统、模组生态等。

项目路径：`c:\Users\HONOR\Pet\petpal-app\`

## 已完成的分析工作

我已经对 7 个参考开源项目完成了全量源码级分析，所有分析文档位于 `c:\Users\HONOR\Pet\docs\analysis\`，参考仓库源码位于 `c:\Users\HONOR\Pet\repos\`。

### 分析文档清单

| 文件 | 内容 |
|------|------|
| `BongoCat_Repo_Analysis.md` | Tauri + Vue3 同栈验证（透明窗/单实例/更新器/键鼠追踪） |
| `WindowPet_Repo_Analysis.md` | Tauri + React + Zustand 同栈同前端（50 角色资源/Phaser/9 行精灵图） |
| `OpenLLMVTuber_Repo_Analysis.md` | Python + Electron + Live2D（**情绪映射机制/Think 标签/多后端架构/MCP**） |
| `VPet_Repo_Analysis.md` | C# + WPF（32×4×3 动画矩阵/IFood 接口/Steam Workshop 模组生态） |
| `SuperAgentParty_Repo_Analysis.md` | JS + VRM + MCP（Fast&Slow Brain 双脑/RAG 记忆/多端部署，**AGPL-3.0**） |
| `OpenPets_Repo_Analysis.md` | TS + Electron + MCP（**8×9 spritesheet 像素级兼容**/插件 SDK v3） |
| `DyberPet_补充分析.md` | Python + PySide6（对话系统/收藏系统/商店 UI/气泡配置） |
| **`新仓库对PetPal项目的持续价值分析.md`** | **核心文档**：综合价值矩阵 + Phase 1/2/3 移植路线图 + 59 个关键文件索引 |

### PetPal 当前已实现模块（位于 `petpal-app/src/lib/`）

`types.ts`、`personalityEngine.ts`、`personalityTemplates.ts`、`enhancedMemory.ts`、`llmClient.ts`、`llmProviders.ts`、`aiAgent.ts`、`aiConfig.ts`、`agentTools.ts`、`animationConfig.ts`、`behaviorEngine.ts`、`bubbleManager.ts`、`buffManager.ts`、`characterConsistency.ts`、`characters.ts`、`chatStages.ts`、`clipboardManager.ts`、`communityApi.ts`、`contextAwareness.ts`、`dataManager.ts`、`db.ts`、`i18n.ts`、`interactionCounter.ts`、`items.ts`、`modManager.ts`、`musicAwareness.ts`、`pushNotificationManager.ts`、`scheduleManager.ts`、`screenshotManager.ts`、`secureStorage.ts`、`spriteSheetTool.ts`、`syncManager.ts`、`systemControls.ts`、`taskManager.ts`、`themeManager.ts`、`updater.ts`、`vectorSearch.ts`、`vectorWorker.ts`、`weatherAwareness.ts`、`achievementSystem.ts`、`jsonUtils.ts`、`sseUtils.ts`

## 你的任务

**请先阅读以下文件获取完整上下文，然后按优先级逐步实现：**

1. 阅读 `c:\Users\HONOR\Pet\docs\analysis\新仓库对PetPal项目的持续价值分析.md` — 这是核心指导文档
2. 阅读 `c:\Users\HONOR\Pet\petpal-app\src-tauri\src\lib.rs` — 了解当前 Rust 后端结构
3. 阅读 `c:\Users\HONOR\Pet\petpal-app\src\App.tsx` — 了解前端路由结构
4. 阅读 `c:\Users\HONOR\Pet\petpal-app\src\lib\types.ts` — 了解类型系统
5. 阅读对应的参考仓库源码（位于 `c:\Users\HONOR\Pet\repos\`）来理解具体实现

## Phase 1 任务清单（P0，立即可做，极低/低难度）

按以下顺序实现，每完成一项请告知：

### 1.1 窗口关闭即隐藏（BongoCat 方案）
- **参考**：`repos/BongoCat/src-tauri/src/lib.rs:65-72`（`on_window_event` → `CloseRequested` → `hide` + `prevent_close`）
- **改动**：在 PetPal `lib.rs` 的 `tauri::Builder` 链加 `.on_window_event` 闭包，匹配 pet-window 标签后调用 `window.hide()` + `api.prevent_close()`
- **验证**：关闭主窗口后宠物隐藏而非退出，托盘菜单可恢复

### 1.2 单实例插件（BongoCat 方案）
- **参考**：`repos/BongoCat/src-tauri/src/lib.rs:44-48`
- **改动**：`cargo add tauri-plugin-single-instance`，在 `lib.rs` 的 plugin 链加 `.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| { show_settings_window(app); }))`
- **验证**：多次启动只保留一个实例，重复启动时激活设置窗口

### 1.3 情绪映射机制（Open-LLM-VTuber 方案）
- **参考**：`repos/Open-LLM-VTuber/src/open_llm_vtuber/live2d_model.py:146-172`（`extract_emotion` 函数）+ `prompts/utils/live2d_expression_prompt.txt` + `src/open_llm_vtuber/agent/transformers.py:82-88`（`actions_extractor`）
- **改动**：
  - 在 PetPal 的 LLM 提示词模板中追加情绪标签指令（参考 Open-LLM-VTuber 的 `live2d_expression_prompt.txt`）
  - 新增 `emotionExtractor.ts`，从 LLM 流式输出中解析 `[emotion:happy]`、`[emotion:sad]`、`[motion:wave]` 等标签
  - 将提取的情绪/动作标签与 `animationConfig.ts` 中的动画行映射
- **验证**：LLM 回复中包含情绪标签时，宠物自动切换对应表情/动作

### 1.4 Think 标签（Open-LLM-VTuber 方案）
- **参考**：`repos/Open-LLM-VTuber/prompts/utils/think_tag_prompt.txt` + `src/open_llm_vtuber/agent/transformers.py:134-141`
- **改动**：在提示词中加入让 LLM 输出 `<think>思考过程</think>` 标签的指令，前端在流式输出时将 think 内容以半透明/折叠方式展示为"内心戏字幕"
- **验证**：LLM 回复中显示思考过程（折叠），正式回复正常显示

### 1.5 8×9 spritesheet 互操作确认（OpenPets 方案）
- **参考**：`repos/openpets/packages/pet-format/` + PetPal `types.ts:ATLAS = { cellW: 192, cellH: 208, cols: 8, rows: 9 }`
- **改动**：确认两者格式一致（已确认像素级兼容），在 `types.ts` 中添加注释标注兼容性，在 `communityApi.ts` 的宠物包下载逻辑中添加 OpenPets 格式识别
- **验证**：可直接使用 OpenPets 的宠物包资源

### 1.6 50 个 MIT 角色资源移植（WindowPet 方案）
- **参考**：`repos/WindowPet/public/media/*.png`（50+ PNG）+ `repos/WindowPet/src/config/*.json`（50 个配置）
- **改动**：将 PNG + JSON 复制到 `petpal-app/public/pets/shimeji/`，编写转换脚本将 WindowPet 的 JSON 配置格式转换为 PetPal 的 `CharacterProfile` 格式
- **验证**：宠物列表中出现新角色，可选择并正常显示

## Phase 2 任务清单（P1，中期，中难度）

### 2.1 动画多级回退策略（VPet 方案）
- **参考**：`repos/VPet/VPet-Simulator.Core/Graph/GraphCore.cs` 的动画查找回退机制
- **改动**：在 PetPal 的动画系统中实现多级回退（精确动画 → 通用动画 → 默认动画），避免动画缺失时卡住

### 2.2 MCP Server 双向闭环（OpenPets 方案）
- **参考**：`repos/openpets/packages/mcp/src/tools.ts`（3 个 MCP 工具：status/react/say）
- **改动**：在 PetPal 的 `agentTools.ts` 基础上新增 MCP Server 能力，让 Claude Code/Cursor 等 AI 编码代理可通过 MCP 控制宠物反应

### 2.3 主动说话机制（Open-LLM-VTuber 方案）
- **参考**：`repos/Open-LLM-VTuber/prompts/utils/proactive_speak_prompt.txt` + `src/open_llm_vtuber/conversations/single_conversation.py`
- **改动**：在 PetPal 的 `chatStages.ts` 中添加定时触发逻辑，宠物在空闲时主动发起对话

### 2.4 商店 UI 闭环（DyberPet 补充分析方案）
- **参考**：`repos/DyberPet/DyberPet/Dashboard/shopUI.py` + DyberPet 补充分析中的商店系统
- **改动**：完善 PetPal 的商店界面，实现物品浏览/购买/卖出/锁定状态视觉

### 2.5 对话系统（DyberPet 补充分析方案）
- **参考**：`repos/DyberPet/docs/` 中的对话系统文档 + DyberPet 补充分析中的对话系统章节
- **改动**：实现基于物品触发的对话系统，支持多分支选择

## 重要约束

1. **AGPL-3.0 限制**：super-agent-party 为 AGPL-3.0，**不可直接复制代码**，仅可参考设计思路独立实现
2. **Apache-2.0 限制**：VPet 为 Apache-2.0，可参考设计模式但不直接移植
3. **MIT 仓库可自由使用**：BongoCat、WindowPet、Open-LLM-VTuber、OpenPets、DyberPet 均为 MIT
4. **保持差异化**：五维性格引擎和四段式记忆是 PetPal 独有能力，所有移植应在此基础上增强，不替代

## 开始工作

请先阅读核心文档 `新仓库对PetPal项目的持续价值分析.md`，然后从 Phase 1 的 1.1 开始逐步实现。每完成一项请汇报改动文件和验证结果。
