# SpiritPal 下一步实施计划（方案草案 · 待审核）

> 版本：v0.1（草案）  
> 生成日期：2026-08-27  
> 依据：《剩余任务交接报告.md》（2026-08-27 实测）、《学习成果落地分析报告.md》  
> 状态：**批次一、批次二均已执行完成（2026-08-27）**。批次一落地 A-1~A-5，批次二落地 A-9 i18n 收敛 / A-8 日记日程 / A-10 情绪引擎，两批全部通过 `tsc -b` + 全量 vitest（2125 passed / 0 failed）+ lint（0 错误）。

---

## 执行记录（实时更新）

### 批次一 · P0 体验回归 —— ✅ 完成（2026-08-27）

| 任务 | 落地方式 | 验收 |
|---|--------|------|
| **A-1 看看** | 在 PetWindow 右键动作面板加「看看」按钮 → 接**已接线的** `visualPerception.ts`（`getVisualPerceptionManager().triggerAnalysis()`，ChatWindow 同款生产路径），结果以气泡展示 + 写入视觉记忆；缺失 `take_screenshot`/LLM 时优雅兜底 | 补 `visualPerception.test.ts`（2 passed）；tsc/vitest 全绿 |
| **A-2+A-3 贴边互动** | 启动 `hiddenStateManager` 并监听 `spiritpal:hidden-state-change`，映射 climbing/peeking/hiding_wall → petState + 气泡；隐藏态期间经新增 `usePetBehavior` 的 `pauseRef` 暂停自动调度防抢状态。消费 `useDockVisualFeedback`，把 `peekScale` 折入 sprite 缩放、`triggerPeek()` 贴边触发、`expression` 驱动气泡 | tsc/vitest 全绿（2125 passed） |
| **A-4 记忆可视化** | SettingsWindow memory Tab 加「精简 \| 可视化」切换，可视化态挂载 `MemoryVisualizer` | tsc/vitest 全绿 |
| **A-5 静默模式** | `usePetTimers` proactive 回调与 `ChatWindow` 助手 TTS 静默拦截；PetWindow 右键面板加「静默/取消静默」开关（订阅 `onStateChange` 同步标签） | tsc/vitest 全绿 |

**关键偏差（已记入 KNOWN_GOTCHAS）**：
- **A-1 改接 `visualPerception.ts` 而非报告点名的 `visionPerception.ts`**：后者是未接线的死路孤岛，照接会永远走兜底；真实"屏幕描述"仍依赖 `take_screenshot` Rust 命令（计划中尚未实现）。见 gotcha #28。
- **A-5 仅接手动+计划(23–7)静音**：`silentModeManager` 的 meeting/focus 自动静音与 F9 快捷键是其模块内 TODO 空实现，未虚构。见 gotcha #29。
- **A-2 未造新状态写入路径**：直接复用 `hiddenStateManager` 的 CustomEvent → petState 链路，未新增 store action（避免假实现，符合铁律 #6）。

### 批次二 · 决策与统一 —— ✅ 完成（2026-08-27）

| 任务 | 落地方式 | 验收 |
|------|----------|------|
| **A-9 i18n 收敛** | 方案 B：将 `i18nManager` 的 Intl 格式化能力（formatDate/Time/RelativeTime/Number/Currency/getTextDirection）并入生产 `i18n.ts`，作为全仓唯一 locale-aware 格式化来源；`i18nManager`/`i18nTranslations` 标记 `@deprecated`（用户拒绝删除，保留为历史兼容存根）；`emojiCultureData` 解耦对 `i18nTranslations` 的类型依赖 | tsc -b 通过；残留 2 文件为废弃存根，运行期仍仅 `i18n.ts` 一个被接线模块 |
| **A-8 日记/日程** | D-2：`scheduleManager` 新增 `CalendarSourceAdapter` 插件接口（`registerCalendarSource`/`getImportedCalendarEvents`），webview 安全、不引入 Node 依赖；`timezoneSync` 接入 `SchedulePanel` 显示时区（消除孤岛）；设置页新增 `journal` Tab + `JournalPanel`（基于 chatStore + i18n 格式化器，点击生成/导出 Markdown，webview 安全） | SettingsWindow 日记 Tab「生成今日日记 / 导出 Markdown」可用；tsc/vitest 全绿 |
| **A-10 情绪引擎** | `emotionTagsToMood` 改为委托 `emotionEngine.moodFromEmotionTags`（同一调用点升级替换，下游 `updateMemoryMood` 零破坏）；ChatWindow 每轮回复将文本送入 `getEmotionStateManager().update(analyze(...))`，驱动 MemoryPanel 分布/每日曲线 | tsc/vitest 全绿（2125 passed） |

**关键偏差（已记入 KNOWN_GOTCHAS）**：
- **A-8 架构阻塞（诚实降级）**：`dailyJournal.ts`/`calendarIntegration.ts` 依赖 Node 内置模块（`fs`/`child_process`），无法在 Tauri webview 直接 import（顶层 `exec`/`fs` 加载即报错）。故日记采用 webview 安全实现（Blob 下载 + chatStore 数据），`calendarIntegration` 仅作为 `scheduleManager` 日历插件的 **Node 侧参考适配器**，待经 Tauri 命令桥接后在 webview 注册。见 gotcha #30。
- **A-9 文件未删除**：用户拒绝删除 `i18nManager`/`i18nTranslations`，改为 `@deprecated` 标记 + 指向 `i18n.ts`；双轨在「活动实现」层面收敛，文件待后续人工清理。
- **A-10 评分来源收敛**：情绪标签→坐标的评分表统一收敛到 `emotionEngine.EMOTION_SCORES`，`emotionTagsToMood` 退化为薄适配层（保留签名兼容既有记忆回写）。

> 批次三（能力补全：A-7 memoryExporter 导出 / A-6 事实归档 / A-11 记忆搜索性能）待后续启动。

---

## 0. 复核说明（本方案的信任基础）

本方案并非照抄交接报告，而是先对报告中的**关键声明做了磁盘实测复核**，全部通过：

| 报告声明 | 实测结果 | 结论 |
|---------|---------|------|
| `visionPerception` 等模块为孤岛 | 仅被自身文件与 `promptRegistry`/测试引用，无运行链路 importer | ✅ 属实 |
| `silentModeManager`/`emotionEngine`/`memoryExporter`/`dailyJournal` 无消费方 | 全仓仅命中模块自身文件 | ✅ 属实 |
| Rust 端不存在 `switch_mini_mode`/`set_window_opacity`/`resize_window` 命令 | `src-tauri/src/` grep 为零命中 | ✅ 属实 |
| `usePetDragging` 输出 `dockDir`（A-2/A-3 依赖） | 确认存在 | ✅ 依赖成立 |
| `SettingsWindow` 已有 `memory`/`mcp` Tab（A-4/B-1 落点） | 确认存在（`Tab` 联合类型含 20 个 Tab） | ✅ 落点成立 |
| `emotionTagsToMood` 在 `ChatWindow`/`enhancedMemory` 链路（A-10 替换点） | 确认存在 | ✅ 替换点成立 |
| Vite 无多页入口（A-14 缺口） | `vite.config.ts` 的 `rollupOptions` 仅 `output.manualChunks`，无 `input` | ✅ 属实 |
| A-14 invoke 无兜底会崩 | `miniModeManager.ts` 的 invoke 均有 `try/catch` 或 `.catch()` | ⚠️ 修正：**不会崩溃，仅功能静默失效**——紧急度低于报告暗示，但"功能不生效无提示"仍是体验问题 |

---

## 1. 未完成任务全量梳理

### 1.1 A 类 · 孤岛模块接线（主体工作，17 个模块）

> 统一特征：功能代码完整且有类型/测试保障，但未接入 UI/状态机/渲染管线，**用户不可见**。

| # | 模块 | 落点 | 优先级 |
|---|------|------|:------:|
| A-1 | `visionPerception`（视觉感知"看看"） | PetWindow 右键菜单 → 气泡展示 | **P0** |
| A-2 | `hiddenStateManager`（爬墙/探头/躲藏） | `usePetDragging` dock 判定 → PetWindow 状态机 | **P0** |
| A-3 | `useDockVisualFeedback`（吸附视觉反馈） | PetWindow 消费 `dockDir` → Live2D 变换 | **P0** |
| A-4 | `MemoryVisualizer`（记忆可视化四 Tab） | SettingsWindow `memory` Tab 挂入 | **P0** |
| A-5 | `silentModeManager`（静默生效） | ChatWindow/proactiveSpeak + 右键/托盘菜单 | **P0** |
| A-6 | `frameCache` + `spriteAtlasBuilder`（帧缓存/图集） | Live2DRenderer 帧纹理 + GifToSprite 导出 | P2 |
| A-7 | `gpuParticleSystem`→`batchRenderer`→`webglWorker` 链 | 宠物互动彩蛋（抚摸粒子），Worker 变体降级 | P2 |
| A-8 | `dailyJournal` + `calendarIntegration` + `timezoneSync` | 设置页"日记"Tab + 日程源决策 | P1 |
| A-9 | `i18nManager`/`i18nTranslations`/`emojiCultureData` 三选一 | 并入 `i18n.ts`（方案 B）或删除 | **P1** |
| A-10 | `emotionEngine`（9+7 情绪分类器） | 替换 `emotionTagsToMood` 调用点 | P1 |
| A-11 | `memorySummarizer` + `memoryRecommendation` | memoryBackground 夜间任务 + proactiveSpeak 候选 | P1 |
| A-12 | `memoryExporter` + `batchOperationManager` | MemoryPanel 导出/多选批量删除 | P1 |
| A-13 | `live2dPhysicsParser`（精灵图伪物理） | PetSpriteRenderer 装饰部件摆动 | P2 |
| A-14 | `miniModeManager` + `mini-mode.html` | **Rust 新命令 + Vite 多页入口**（硬缺口） | P2 |
| A-15 | `scripts/modPackager.ts` ZIP 实现 | 引入 jszip 真实落盘 `.petmod`（硬缺口） | P2 |

### 1.2 B 类 · 原清单遗留项（非孤岛）

| # | 事项 | 关键点 | 优先级 |
|---|------|-------|:------:|
| B-1 | `mcpHooks` 接线 | `mcpAppBridge` 工具执行前后插入 pre/post hook | P1 |
| B-2 | 自动更新发布落地 | GitHub Release 工作流 + 签名私钥 + `updates.json`（**需仓库管理员权限**） | P2 |
| B-3 | at-rest 流式加密 / `.legacy` 清理入口 | >1MB blob 分块加密 + DataPanel 清理 UI | P2 |
| B-4 | 记忆评测集 / 性能基准 / V1-V4 真机验收 | 3 项基准 + 验收 checklist + 30 条召回评测集 | P2 |

### 1.3 C 类 · 已知代码债（小而明确）

| # | 位置 | 事项 | 建议 |
|---|------|------|------|
| C-1 | `CharacterCreator.tsx:674` | 动画行编辑 TODO 死 UI | 与 `characterCardImporter` 合并或移除 |
| C-2 | `aiAgent.ts:355-368` | Developer/Worker 工具注册 TODO | 按需注册或声明能力边界 |
| C-3 | `SettingsWindow.tsx` | 14 条 import/order 存量 warning | 单独一次 `eslint --fix` + 全量 vitest 回归 |
| C-4 | `memoryEditor.readMemory` | 返回对象泄露内部字段 | 加 `sanitizeForDisplay` 层 |
| C-5 | `LIVE2D_LICENSE_REMINDER.md` | 发行许可（人工流程，AI 不可代办） | **发布阻塞项**，提前启动 |
| C-6 | `modelHotLoader.ts` | 弃用死桩 | 下个 major 前物理删除 |
| C-7 | `webgl.worker.ts` | Worker 无 `document` 环境问题 | 随 A-7 处理 |

---

## 2. 当前项目进度与状态分析

### 2.1 已确认完成且接线（无需重做）

- **P0-3 MCP Server 全链路**：Rust stdio 服务 + 命令桥 + Token 鉴权 + webview 执行端（`main.tsx` 已接线）。
- **P0-4**：`memoryEditor` 暴露为 MCP 工具 `spiritpal_memory_edit`（真实持久化，vitest 33/33）。
- **P1-MCP 设置面板**：`McpSettingsPanel` 已挂入 `mcp` Tab。
- **P1-1 窗口标题提取**：`windowTitleExtractor` ← `contextAwareness`。
- **记忆后台**：`entityGraph`/`dreamingConsolidation` 已接入 `memoryBackground`，`main.tsx` 启动挂载。
- 收藏系统 / TTS / GDPR 删除 / PII 掩码 / 推送通知 / autoMapper / 情感回写 / 视觉记忆召回 / 行级化 / 多分支对话。

### 2.2 核心判断：功能完备度与用户可见度严重失衡

这是当前项目**最主要的矛盾**。按报告实测，约 **17 个功能模块代码完整但完全不可见**，横跨：体验（看看/贴边互动/静默）、记忆纵深（可视化/摘要/推荐/导出）、性能基建（帧缓存/粒子/图集）、内容工具（日记/迷你模式/Mod 打包）。**代码资产已经大规模沉淀，但产品价值几乎零变现**——接下来所有工作都应围绕"让已建功能被用户摸到"展开。

### 2.3 硬缺口与决策债

| 类型 | 项 | 说明 |
|------|----|------|
| 硬缺口 | A-14 MiniMode Rust 命令 | 前端调 4 个命令全部不存在（但均有 catch 兜底，**不会崩、仅静默失效**） |
| 硬缺口 | A-15 Mod 打包 ZIP | `modPackager.ts:265` 占位，不产 `.petmod` |
| 决策债 | A-9 i18n 双轨 | `i18n.ts`（在用）vs `i18nManager`（新建无人用），不收敛则维护分裂 |
| 决策债 | A-8 日程重叠 | `scheduleManager`（已接线）vs `calendarIntegration`（空占位 fetch） |
| 假实现风险 | A-7 `batchRenderer.uploadToGPU` | 注释占位 TODO，**禁止静默假实现**——要么补全要么降级文档化 |
| 环境缺陷 | A-7/C-7 `webgl.worker.ts` | Worker 无 `document`、无 rAF，直接接会运行时报错 |
| 发布债 | B-2 自动更新 / C-5 许可 | 需管理员权限 / 人工流程，**不能等最后一刻** |

### 2.4 质量基线（当前可执行）

报告第 0 节给出全局验证命令：`tsc -b` / `vitest` / `build` / `cargo test` / `cargo check`。这表示**当前代码库处于"改一处可全量自证"的健康状态**，为批次化接线提供了安全网。

---

## 3. 下一步工作计划（建议实施顺序）

### 3.1 总体原则

1. **P0 优先**：先做用户一打开就能感知的体验接线（批次一）。
2. **合并实施**：共享同一事件源/面板的项强制合并为一个 PR（A-2+A-3；A-4 与 A-10/A-12 的 MemoryPanel 改动保持先后序）。
3. **先决策后接线**：凡有双轨/重叠风险的（A-8/A-9）必须先做"合并 or 替代"决策，严禁双轨并存。
4. **诚实降级**：A-7/A-14 等做不到的部分显式降级为"文档化设计稿/纯 CSS 兜底"，绝不假实现。
5. **每批完成标准**：该批验收全过 + 全局验证命令全绿 + 按模块 conventional commit（附任务编号）。

### 3.2 四个 PR 批次与依赖关系

```
批次一（P0 体验回归）
  A-1 看看 ──────────────── 独立，低风险
  A-2+A-3 贴边互动 ──────── 共享 dockDir 事件源（强制合并）
  A-4 记忆可视化 ────────── 独立（为 A-10/A-12 打面板基础）
  A-5 静默生效 ──────────── 与 A-11 共享 proactiveSpeak 链路（先建约束）
  验收：右键→看看出气泡；拖贴边出攀爬/探头；设置→记忆可视化非空；静默后不再说话

批次二（决策与统一）
  A-9 i18n 统一 ────────── 先行：后续所有新 UI 文案（日记/日程/MCP）依赖其规范
  A-8 日记/日程 ────────── 决策：calendarIntegration 作为 scheduleManager 数据源插件
  A-10 情绪引擎替换 ────── 替换 emotionTagsToMood；数据喂给 A-4 情绪分布 + A-8 日记摘要
  验收：全仓仅一个 i18n 模块；设置页日记可生成/导出；情绪落库单链贯通

批次三（记忆纵深）
  A-11 摘要/推荐 ───────── 挂 memoryBackground 夜间任务 + proactiveSpeak（复用 A-5 静默约束）
  A-12 导出/批量 ───────── MemoryPanel（复用 A-4 视图容器 + 现有 PII 掩码）
  B-1 mcpHooks ─────────── mcpAppBridge 执行前后插 hook
  验收：周记缓存生成；导出文件 PII 已打码；spiritpal_say 触发反应链

批次四（基建与发布）
  A-6 帧缓存/图集 → A-7 粒子（含 Worker 修复/降级）→ A-13 物理
  A-14 MiniMode（Rust 命令 + Vite 多页 + 兜底）→ A-15 Mod ZIP
  B-2 自动更新 → B-3 流式加密/清理 → B-4 评测/基准 → C 类清理
```

### 3.3 任务依赖矩阵（关键路径）

| 前置任务 | 后置任务 | 依赖原因 |
|---------|---------|---------|
| A-2 的 dock 判定逻辑 | A-3 | 同一 `dockDir` 事件源，必须同 PR |
| A-5 静默约束建立 | A-11 推荐接入 proactiveSpeak | 推荐发言须受静默开关约束 |
| A-4 MemoryVisualizer 挂载 | A-10 情绪分布数据 / A-12 面板操作 / A-11 周记渲染 | 三者共享同一 MemoryPanel 容器与数据 |
| A-9 i18n 收敛 | A-8 日记 / A-12 导出 / B-1 面板文案 | 新增 UI 文案必须先有唯一 i18n 规范 |
| A-10 情绪引擎 | A-8 每日情绪曲线喂日记摘要 | 数据流前置 |
| C-7 Worker 修复 | A-7 粒子接入 | 同一文件链 |
| B-2 基础设施 | B-3（端口安全评审）、C-5 许可 | 发布前安全评审与许可为阻塞项 |

### 3.4 相对交接报告 D 节的增量建议（需您确认）

1. **A-14 拆分**：把"前端 invoke 兜底 + 降级提示"从批次四提前到批次一之后单独做一个 mini 任务（约 0.5 天）——因为这是**已存在但不生效的功能**，用户点"迷你模式"目前是无提示失败，属体验 bug 而非纯增量。
2. **B-2/C-5 并行启动**：它们需要仓库管理员权限/人工许可流程，不应排在最后才发起沟通。建议**本批次执行期间就向管理员提出 Release 工作流与许可申请**，与编码并行。
3. **A-9 固定在批次二第一位**：若后续批次新增大量 UI（日记/MCP/导出），i18n 收敛越晚迁移成本越高。
4. **批次一内部顺序建议**：A-1 → A-2+A-3 → A-4 → A-5。A-1 最简单先建立"接线 → 验收 → commit"的节奏样板；A-5 涉及多条链路（Chat/proactive/右键/托盘/会议联动）放最后，风险最高但可与批次二衔接。

### 3.5 批次一详细拆解（执行样板，供审核）

**A-1「看看」**（预计 0.5–1 天）
1. `PetWindow.tsx` 右键菜单加"看看"项 → `visionPerception.captureAndAnalyze()`；
2. 结果经现有气泡组件 + `usePetStore` 写入情绪/上下文（**复用 contextAwareness 既有链路，不新建状态写入路径**）；
3. 无 LLM 配置/截屏拒绝 → 展示引导文案（静默失败）；
4. 验收：右键→看看→气泡显示屏幕描述；补 1+ vitest 用例。

**A-2+A-3 贴边互动**（预计 1–1.5 天）
1. `usePetDragging` 的 `dockDir` 释放判定 → `hiddenStateManager.enter(climbing/peeking)`；
2. `useDockVisualFeedback` 消费同一 dockDir，输出旋转角/表情 → Live2D 变换；
3. 渲染层按状态切换动画/朝向；躲藏 N 分钟定时回流（订阅内置计时）；
4. 验收：拖至屏幕左/右缘松手出攀爬/探头，拖回中央恢复，吸附瞬间可见过渡动画。

**A-4 记忆可视化**（预计 0.5–1 天）
1. `SettingsWindow` memory Tab 顶部加"精简 | 可视化"切换（默认精简，不回归旧行为）；
2. 挂 `MemoryVisualizer`；无数据时空态文案；
3. 验收：有记忆数据时时间线/情绪分布非空渲染。

**A-5 静默生效**（预计 1–2 天）
1. `ChatWindow`/`proactiveSpeak` 发送前检查 `isMuted()`，静默期入队或丢弃；
2. 右键菜单 + 托盘加"🔕 静默 5 分钟"；
3. `contextAwareness` 会议状态联动自动静音（复用现有 reason 机制）；
4. 验收：静默开启后对话/主动场景不再说话，到期自动恢复。

---

## 4. 验收与门禁（每项通用）

```bash
npx tsc -b
npx vitest run src/lib/__tests__ tests 2>&1 | tail -5
npm run build
cd src-tauri/mcp-server && cargo test    # 涉及 MCP 时
cd src-tauri && cargo check --lib        # 涉及 Rust 命令时
```

- 接线项额外标准：模块被 ≥1 个运行链路文件 import + 功能 UI 可达。
- 提交规范：`<type>(<scope>): 接线 xxx (A-n)`，如 `feat(pet-window): 接线隐藏互动状态至拖拽释放判定 (A-2)`。
- 每批结束后更新本计划文档状态与交接报告核对表（按 AGENTS.md 自进化铁律同步 `KNOWN_GOTCHAS.md`/`REVISION_LOG.md`）。

---

## 5. 需您决策/确认的点

| # | 决策点 | 选项 | 我的建议 |
|---|-------|------|---------|
| D-1 | 4 批次顺序是否认可 | 认可 / 调整 | 认可，但采纳 3.4 的增量建议 |
| D-2 | A-8 日程实现策略 | ① calendarIntegration 作为 scheduleManager 插件 ② 删除只留 scheduleManager ③ ICS 降级 | ①，成本与收益最优 |
| D-3 | A-9 i18n 方案 | 方案 A（删 i18nManager） / 方案 B（能力并入 i18n.ts） | **方案 B**（报告推荐），保留 Intl 增量能力 |
| D-4 | A-7 batchRenderer | 补全真实实现 / 降级为文档化设计稿 | 本批次先降级，避免伪实现风险 |
| D-5 | A-14 兜底小任务提前 | 是 / 保持批次四 | 提前（理由见 3.4-1） |
| D-6 | B-2 发布工作流 | 现在并行向管理员申请 / 到批次四再做 | 现在并行启动（理由见 3.4-2） |

---

*本方案基于《剩余任务交接报告.md》与 2026-08-27 磁盘实测复核，全部结论可被代码与命令验证。*
