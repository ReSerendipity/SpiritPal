# SpiritPal 技术债登记册（TD Register）

> 建立日期：2026-10-16　·　对应评估报告条目：架构技术债 Flash 报告 P1①「无 TD 编号债项清单 / TODO 41 处散落」
> 本文件为**最小登记机制**：给既有债务一个可引用编号（TD-xxx）与优先级，不构成实施承诺；实施排期由所有者决定。
> 编号规则：`TD-xxx` 顺序编号，只增不改不删（关闭时在状态列标注 `已关闭 <日期>`，编号保留）。

## 1. 债项总表

| 编号 | 债项 | 位置（锚点） | 影响 | 修复成本 | 优先级 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| TD-001 | 记忆巩固流程为桩：实体图更新 / 记忆重排序 / 自传记忆合并均为 TODO，调度器只打日志 | `lib/memory/dreamingConsolidation.ts`（6 处 TODO：行 405/410/415/420/425/430） | 记忆系统核心后处理不生效，长期记忆质量退化 | 高 | P1 | 开放 |
| TD-002 | 多模态 LLM 为桩：未接实际 LLM 调用、无结构化提取、截屏路径未获取 | `lib/ai/multimodalLLM.ts`（3 处 TODO：行 293/319/378） | 图像理解链路不可用 | 中 | P1 | 开放 |
| TD-003 | 批量操作回滚失效：删除/标签/修改三类 `createUndo` 恒返回 `undefined` | `lib/data/batchOperationManager.ts`（3 处 TODO：行 276/294/312） | 误操作后无法撤销，数据可丢失 | 中 | P1 | 开放 |
| TD-004 | 记忆摘要为启发式：未接 LLM、置信度硬编码 0.85、非真正增量算法 | `lib/memory/memorySummarizer.ts`（3 处 TODO：行 127/190/228） | 摘要质量与增量性能不达设计预期 | 中 | P2 | 开放 |
| TD-005 | 智能日记为模板拼装：对话提取/搜索/LLM 摘要/记忆提取/窗口日志提取均未实现 | `lib/nurture/dailyJournal.ts`（5 处 TODO：行 125/222/374/395/403） | 「智能日记」名不副实 | 中 | P2 | 开放 |
| TD-006 | 静音模式无持久化：设置不落盘、不监听会议状态 | `lib/system/silentModeManager.ts`（3 处 TODO：行 87/112/360） | 重启后静音配置丢失 | 低 | P2 | **已偿还（2026-11-06）**：复核后拆成两半。① 持久化其实早已写 localStorage（`spiritpal:silent-mode`），残留的是两条过时 TODO；本轮补的是**恢复语义**——`meeting` 静音不跨会话恢复（会议是会话级，恢复成静音会让用户重启后莫名没声音）、`temporary` 过期不恢复且未过期按剩余时长重挂定时器、`manual`/`schedule` 按存储值恢复；写盘失败（隐私模式/配额）只记日志不阻断静音。② 会议联动是真缺口：`setupSystemEventListeners` 原来是空实现 + `console.log('pending')`，现接到 `contextAwareness.onWorkStateChange`（Zoom / Teams / 腾讯会议 / 钉钉 / 飞书 / Google Meet / Slack 命中 `WorkState='meeting'`）——进会议自动静音、出会议只撤销「自己因会议打开」的那次；用户已手动静音时进会议不覆盖 reason、出会议也不解除；会议中用户手动关静音则本轮不再自动重开，下一轮会议恢复联动。`destroy()` 退订该监听避免泄漏。验证：新增 `src/lib/system/__tests__/silentModeManager.test.ts` 8 用例全 PASS（持久化恢复 4 条 + 联动 4 条），`tsc --noEmit` rc=0；负控把联动订阅改回空实现后同一测试 3 例判红（进入/离开会议、手动关闭后重开、destroy 退订），恢复文件后哈希一致且 8/8 复绿。未做真机桌面端会议检测复验（需要真实会议软件前台窗口 + 桌面端运行） |
| TD-007 | 视觉记忆为桩：降采样/Canvas 绘制未实现 | `lib/memory/visualMemory.ts`（7 处 TODO(P2)：行 26/174/204/243/277/286 等） | 视觉记忆不可用 | 中 | P2 | 开放 |
| TD-008 | 系统集成缺口：日历 Windows 权限对话框、宠物播报调用未接 | `lib/system/calendarIntegration.ts`（2 处 TODO：行 165/318） | 日历/播报体验不完整 | 低 | P2 | 开放 |
| TD-009 | 语音录制权限未配置：Tauri 桌面端麦克风需 capability/系统侧授权（Rust 侧未配置） | `lib/system/voiceRecorder.ts`（行 13） | 桌面端录音功能可能不可用 | 低 | P2 | **已偿还（2026-11-06）**：`getUserMedia` 的麦克风请求不走 Tauri capability（capability 只管命令/插件），而由 WebView 层决定 —— Windows 是 WebView2 的 `PermissionRequested`、macOS 是 `WKUIDelegate` 的 `requestMediaCapturePermission`。`src-tauri/src/lib.rs` 的 Builder 现挂 `on_permission_request`，策略收在 `desktop_permission_response()`：**只放行 `Microphone`，其余权限一律 `Default`（交回平台默认）**；同时补 `src-tauri/Info.plist` 的 `NSMicrophoneUsageDescription`（WKWebView 缺这条会直接拒绝请求）。验证：`cargo check --lib` rc=0；新增 2 条单测 `td009_microphone_request_is_allowed` / `td009_other_permissions_fall_back_to_platform_default` 均 PASS（cargo test 350 filtered / 2 passed）。未做真机录音复验（需启动桌面端并实际调用 `getUserMedia`，本机 `adb` 设备与 macOS 构建环境均不就绪） |
| TD-010 | 精灵 WebGL 绘制为桩 | `lib/system/webgl.worker.ts`（行 168） | 精灵渲染链路不完整 | 中 | P2 | 开放 |
| TD-010a | 记忆导出仅支持单角色 | `lib/memory/memoryExporter.ts`（行 144） | 全量导出需手动逐角色操作 | 低 | P3 | 开放 |
| TD-011 | 动画行编辑功能待导入向导统一实现（已挂 P1-3 导入向导） | `components/CharacterCreator.tsx`（行 673） | 自定义动画行不可编辑 | 中 | P3 | 开放 |
| TD-012 | 情绪评分增强待接 emotionEngine.analyzeFromText（挂 A-10） | `components/JournalPanel.tsx`（行 8/55） | 情绪评分为轻量启发式 | 低 | P3 | 开放 |
| TD-013 | aiAgent 模式工具集说明性 TODO（developer/worker 扩展工具注册） | `lib/ai/aiAgent.ts`（行 54/467/468） | 说明性，暂无功能影响 | 低 | P3 | **已关闭（2026-11-06）**：复核后确认「扩展工具注册」早已在 C-2 批次完成——权限单一真相源是 `agentTools.TOOL_MODE_PERMISSIONS`（Agent 7 个基础工具；Developer 再加 `read_file`/`list_directory`/`search_files`；Worker 再加 `write_file`/`execute_command`），两条执行路径（单轮 `processAgentRequest` 与 ReAct `processReActRequest`）都用 `isToolAvailableInMode` 强制。残留只是 `aiAgent.ts` 里两段过时注释（`TODO: 注册扩展工具` / `TODO: 注册系统工具`）与两处夸大文案（把 worker 的 `execute_command` 说成 developer 的「终端命令」、把 write_file/execute_command 说成「系统级操作」）。处置：注释按真实权限表逐条列出并说明 TD-013 原委；`getToolModeDescription` 的 developer/worker 文案改为「只读文件工具」「写文件与受控命令（执行前需确认）」。`install_package`/`system_setting`/`registry_edit` 等系统级写操作从未实现且不在计划内，已在注释里写明 |
| TD-014 | 情绪引擎记忆提取未接 | `lib/ai/emotionEngine.ts`（原行 244） | 情绪分析精度受限 | 低 | P3 | **已偿还（2026-11-06）**：`analyzeMemoryHistory()` 原为 `return []` 桩，情绪曲线只能看当前会话内存里的 `history`，看不到「过去几天的情绪」。现接四段式记忆的情景层：按角色取 `episodicMemory` → 逐条跑 `analyze()` → 时间戳用记忆的 `created_at`（不是"现在"）→ 打上 `trigger.source='memory_history'` 与 `relatedMemoryIds`。两条设计约束写进注释：① `characterId` 必须显式传，记忆按角色分库，没有角色上下文时返回空而不猜默认 id（防跨角色串数据）；② 记忆管理器走动态 `import()`，避免把 SQLite/RAG/Vec 拖进引用 `emotionEngine` 的轻量模块（`cultureEmoji` 等）的模块图。记忆栈未迁移/未就绪时降级为空不抛错。验证：新增 `src/lib/ai/__tests__/emotionEngine-memory-history.test.ts` 4 用例全 PASS（无角色返回空且不触库、逐条产出且时间戳来自 created_at、`limit` 取最近 N 条、记忆栈抛错时降级为空）；`tsc --noEmit` rc=0。未接到具体 UI（情绪曲线面板仍读内存 `history`，接面板属另一处改动，本次只偿还数据侧缺口） |

## 2. 覆盖率棘轮阈值（测试 P1，批次五处置中）

当前 `vitest.config.ts` 阈值 lines 48 / branches 40 / functions 44 / **statements 47**。2026-10-16 实测全量覆盖率（json-summary + lcov 双口径）：**lines 49.81%、functions 46.11%、branches 41.67%、statements 49.02%（12217/24920）**。处置结论见 `vitest.config.ts` 提交记录（棘轮上调须以实测值为准；statements 原无可测口径，2026-10-16 追加 json-summary reporter 后取得，并按实测-2pp 棘轮至 47）。

## 3. 评测集缺口台账（`src/lib/ai/__tests__/prompt.eval.test.ts`）

| 编号 | 缺口 | 现状 | 搬入计分表条件 |
| --- | --- | --- | --- |
| GAP-01 | 提醒文本语义注入（提示内容伪装成系统提醒绕过注入检测） | **已关闭（2026-10-16）**：`inputInjectionScreen.ts` 语义初筛落地，命中升级为必须用户确认；用例已搬入 A 组计分表（G01），台账关闭留痕见「缺口台账收口记录」测试 | —— |
| GAP-02 | 搜索词越狱前缀 | **已关闭（2026-10-16）**：同上（G02 入计分表） | —— |
| GAP-03 | `FORBIDDEN_PATH_SEGMENTS` 仅覆盖 `.ssh/.gnupg/.aws/.config` 四类 dot 目录，不含 Windows 系统路径（如 `C:/Windows/System32`） | **已关闭（2026-10-16）**：补上 `windows/system32`、`windows/syswow64`、`windows/start menu`、`program files( x86)`、`programdata` 五段（段匹配要求两侧分隔符防误伤；刻意不拦 AppData——宠物数据目录在其下）；A04 搬回计分表（expect=reject），Rust 白名单兜底降级为第二道防线 | —— |

## 4. 架构漂移结论（P1②，核实后不予处置）

报告称「ADR-0005 与增量 GOTCHAS 落在未入库目录」构成架构漂移。经核实 `AGENTS.md` 协议头：本仓实行**两级文档体系**——`AGENTS.md` 与 `local/agents/`（本地文档，未随仓库发布）属**本地层**，`docs/adr/`、`docs/execution/`、`docs/project/` 等属**公开层**。ADR-0005 与增量 GOTCHAS 落在 `local/agents/` 是**既定设计而非缺陷**；本地层另有 `scripts/snapshot_local_docs.py` 快照与异地镜像机制兜底。**结论：不强行把本地文档推入仓库，登记备查。**

> **2026-10-21 订正（本地层保护状态已变）**：`docs/agents/` 此前由 `.gitignore` 的 `docs/agents/` 目录条目显式忽略；该规则已在治理批次 PR #156（`e9d2281`，2026-10-20，§12.1「docs/ 纯入库」收敛）中随全部 `docs/` 忽略规则一并移除。现状：`git check-ignore docs/agents/GOTCHAS.md` 无命中（rc=1）、`git status` 显示 `?? docs/agents/`，即**整目录 untracked 且未被忽略**；仅其中名为 `AGENTS.md` 的文件仍被 `.gitignore` 的通用 `AGENTS.md` 条目命中。规范目标位置为 `local/agents/**`（`AGENTS.md` §7/§13.1）。上文「`.gitignore` 显式忽略」的表述**已过时**，结论（本地层不入库、登记备查）不变；是否需要把 `docs/agents/**` 整体迁至 `local/agents/**` 以免误提交，仍属待决策项。

> **2026-10-21 关闭记录（待决策项已落地）**：该迁移已完成——`docs/agents/**` 共 11 份文件（ARCH_MAP / CODE_STYLE / CONFIG / GOTCHAS / QUALITY_CONTRACT / REVISION_LOG / SOPS / TEST_COMMANDS + ADR-0005 / ADR-0006 / ondevice-embed-plan，均 untracked）已迁入 `local/agents/`；`docs/agents/` 目录已清空并删除。引用同步范围（提交 `8b330ed`，28 files +39/−38）：`.githooks/*` 6 文件 7 处 + 其他 tracked 文档 22 文件（`.github/workflows/release.yml`、`docs/TECH_DEBT.md`、`docs/adr/0004-pixi-live2d-version-lock.md`、`docs/adr/README.md`、`docs/project/KNOWN_GOTCHAS.md`、`playwright.config.ts`、`scripts/` 10 文件、`src-tauri/` 4 文件、`src/lib/ai/` 2 文件）。**结论：该待决策项关闭。**

## 5. 前端工程四项「未能判断」项（前端 P1，批次六取证）

见 `docs/execution/` 批次六取证报告（Props Drilling / 过度封装 / 无效重渲染 / 无限循环），按交接单要求只取证登记、不顺手重构。

## 6. 依赖安全棘轮基线：cargo_vulns 7 → 4（2026-10-17，zip 直接依赖升级）

**背景**：RUSTSEC-2026-0367/0368/0369（zip 提取类三条通告，2026-10-09 发布）把
cargo_vulns 从 1 推到 7，`#132` 按「上游无补丁且本仓不可达」整体接受为 7。
本轮（Better Harness 批次 item4 方案 A 的直接依赖部分）复核发现该结论可收紧：

- **直接依赖 zip 0.6.6 → 9.0.4**：三条通告的补丁线均为 `>=9.0.0`，直接依赖可升。
  迁移面仅 `src-tauri/src/petmod.rs` 两处类型注解（zip 9.x 的 `FileOptions` 带
  生命周期参数，用 `SimpleFileOptions` 别名钉住）；读写 API（`ZipArchive::new` /
  `by_index` / `enclosed_name` / `is_dir` / `ZipWriter::start_file` /
  `CompressionMethod`）在 9.x 全部保留。`cargo check` 通过；`cargo test`
  286 passed（唯一失败 `embedded_assets_match_sri_manifest` 为本地 dist 哈希
  漂移的既有项，stash 对照证实与本次无关；CI 用占位 dist 跑，main 上该 job 绿）。
  `cargo audit`（RustSec DB 最新）：**7 → 4**。
- **剩余 4 条无法单方面修复**：rkyv 0.7.46 ×1（度量口径差异，不进构建图）+
  zip 4.6.1 ×3（`tauri-plugin-updater` 2.11.0 传递依赖；`[patch]` 强钉 9 会违反
  其约束直接编译失败）。重评条件：updater 发布不依赖 zip 4.x 的新版，或本仓弃用
  updater 插件；rkyv 项待其进入构建图再评估。

**动作**：`scripts/security_gate.py --update-baseline` 回写 `.ci/security_baseline.json`
cargo_vulns 7 → 4（棘轮「只降不升」：本次为下降后的自动收紧；未来任何上升仍会
判红）。基线构成与依据同步写入 `security_gate.py` docstring「当前基线说明」。
