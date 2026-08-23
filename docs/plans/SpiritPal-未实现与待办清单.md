# SpiritPal 未实现与待办项清单（可执行版）

> 整理日期：2026-08-21
> 依据：全量核对 `docs/` 报告（80+ 份）与 `src/`、`src-tauri/src/` 实际代码后的最新结论。
> 统计口径：已实现约 55 / 部分约 8 / 骨架约 13 / 未实现约 14，整体实现率约 72%。

---

## 0. 整体可完成性评估（2026-08-21）

> 评估结论：**并非无条件全可完成**。分四级 —— **A** 可直接完成 / **B** 需前置改造但 #条件明确、可完成 / **C** 需外部资源 / **D** 有硬阻塞需架构决策。

| 级别 | 待办项 | 前置条件 / 阻塞 |
|------|--------|----------------|
| **A 可直接完成** | P0-1 修报告失实；P1-TTS（browser 引擎零依赖）；P0-4 的 entityGraph/dreaming；P2-ESLint | 无 |
| **B 可完成** | 收藏系统、GDPR 清库、PII 掩码、情感回写、视觉记忆、多分支对话、推送通知、记忆行级化 | 需接线/迁移；记忆行级化涉加密 schema 迁移 |
| **C 需外部资源** | 自动更新发布（GitHub Release + 签名私钥 + updates.json 托管） | 仓库/密钥/托管服务 |
| **B（原 D，方案已定）** | MCP Server（P0-3）、memoryEditor、MCP Client(stdio) | 根因：webview 非 Node。**已定**：Rust 进程内承载 MCP 传输层 + `invoke` 命令桥回 TS 工具，外部 Agent 经 **stdio** 驱动；无需打包 Node |

**跨项硬性条件**
1. **MCP 运行时**（唯一硬阻塞，影响 P0-3/P0-4(memoryEditor)/P1-MCP）：渲染进程跑不起 Node MCP server，需 sidecar 或 Rust 承载。
2. **外部资源**：自动更新需 Release+私钥+updates.json。
3. **安全审查**：MCP 开放端口、推送通知、点击穿透需评估后上线。
4. **真机验收**：V1~V4、性能基准、加密流式需真实运行 + 人工验证，代码完成≠功能完成。
5. **数据迁移**：记忆行级化、收藏持久化涉及加密与 db schema，需回归测试。

> MCP 承载方案已定（2026-08-21）：**Rust 进程内承载 MCP 传输层 + `invoke` 命令桥回 TS 工具**，外部 Agent 经 `spiritpal-mcp` **stdio** 驱动；不打包 Node。P0-3 已按此更新。

---

## 图例

- `[ ]` 待做，`[x]` 已完成
- 优先级：P0（当务之急/低成本高收益）→ P1（中期）→ P2（长期/探索）
- 标注「可直接启用」= 库/逻辑已就绪，补薄层即可上线

---

## P0 — 当务之急（修失实 + 低成本复活已就绪功能）

### P0-1 修正《功能实现状态分析报告》失实点 ✅（2026-08-21）
- [x] 删除/更正"Mini Pet 系统已生成"的说法 —— **代码库无 `miniPetSystem.ts`**
- [x] 更正"environmentAwareness.ts（4.5KB）" —— **该文件不存在**，真实为 `contextAwareness.ts`
- [x] 更正"ShopWindow.tsx"路径 —— 实际为 `src/components/ShopPanel.tsx`
- [x] 更正"收藏系统已实现""MCP 集成 75%" —— 均为**骨架未接线**

### P0-2 收藏系统启用 ✅（2026-08-21）
- [x] 收敛实现：采用 `collectionManager.ts`（纯逻辑+`serialize/deserialize`+回调）
- [x] 新增收藏 UI：`InventoryPanel.tsx` 加「收藏」Tab（`CollectionTab.tsx`），展示套件进度、装备/卸下、领取奖励
- [x] 接线：`useCollections` 以背包为准同步 `collectItem`
- [x] 持久化：`useCollections` 经 localStorage 按角色持久化 equip/claimed；奖励发放走 store 金币/亲密度
- ✅ 验收：可收集->套件完成->领奖励->金币/好感到账（测试 6/6 + 组件快照 2/2 通过）

### P0-3 MCP 启用（✅ 方案已定：Rust 承载 + 命令桥接，外部 Agent 经 stdio 驱动）
- [x] **Rust MCP stdio 核心** ✅（2026-08-21）：独立 crate `src-tauri/mcp-server`，`spiritpal-mcp` 实现 JSON-RPC stdio + `initialize`/`tools/list`（6 工具）+ 实机冒烟
- [x] **命令桥·传输端** ✅（2026-08-21）：`tools/call` 转发到本机 bridge（`127.0.0.1:3124`，env `SPIRITPAL_MCP_BRIDGE_ADDR`），bridge 不可达返回诚实错误——`cargo test 6/6`（含本地 TCP 往返）
- [x] **命令桥·工具执行端** ✅（2026-08-21）：`mcpBridge.executeMcpTool`（6 工具，真实 petStore/enhancedMemory）——vitest 6/6；PetWindow 监听 `spiritpal-mcp-*` 驱动气泡/动作——snapshot 通过
- [x] **应用进程监听端** ✅（2026-08-21）：`src-tauri/src/mcp_bridge.rs` 在 setup 宿主 `127.0.0.1:3124`，Rust 收 `/mcp/call` → 发 `mcp://request` 事件 → 等 `mcp_respond` 命令回填；`generate_handler!` 注册 + `Cargo.toml` path 依赖 + app setup `spawn` —— **`cargo check --lib` 通过**；webview 端 `mcpAppBridge.ts` 监听 `mcp://request` → `executeMcpTool` → `invoke mcp_respond`（main.tsx 接线）
- [x] **入口整合/安全** ✅（2026-08-21）：应用生成 SHA-256 本地 Token 并鉴权（`run_bridge_server_auth` 校验 `Authorization: Bearer`，缺失/错误返回 401）；`spiritpal-mcp` 转发带 Token（env `SPIRITPAL_MCP_BRIDGE_TOKEN` 或 `SPIRITPAL_MCP_TOKEN_FILE`）；`tauri.conf.json` 加 `externalBin`，release 二进制已放 `src-tauri/binaries/`（含 target-triple 名）；`cargo check --lib` 通过
- 验收（端到端需运行完整应用验证）：外部 Agent 经 `spiritpal-mcp` 调用 6 工具，宠物真实反应，状态正确

### P0-4 MCP 运行期遗漏项（记忆升级声称完成、实仅测试）
- [x] `entityGraph.ts`（实体多跳联想）接入生产 ✅（经 `memoryBackground` 启动建图，2026-08-21）
- [x] `dreamingConsolidation.ts`（离线做梦调度）接入生产 ✅（经 `memoryBackground` 启动，2026-08-21）
- [ ] `memoryEditor.ts`（MCP 记忆编辑）暴露为 MCP 工具（依赖 P0-3 MCP 专项）

---

## P1 — 中期（补齐闭环 / 缺口）

- [x] **TTS 语音接线** ✅（2026-08-21）：`usePetTTS` + `ChatWindow` 过渡监听朗读助手回复（ChatWindow 21/21 通过）
- [ ] **MCP Client + 权限 UI**：设置页加 MCP 管理（注册外部 server、工具确认框）；`mcpHooks`/`mcpLease` 接线
- [x] **数据删除覆盖 SQLite**（GDPR）✅（2026-08-21）：`resetAll` 已清 memory+实体图表（`memory_entities`/`memory_entity_edges` 嵌套容错）
- [x] **导出含 PII 清单/掩码** ✅（2026-08-21）：`piiMasking`（邮箱/手机/身份证掩码）接入 `exportAll`（默认打码），加密导出 `exportEncryptedFile/downloadEncryptedExport` 已接线（piiMasking 5/5、dataManager 21/21）
- [x] **推送通知接线** ✅（2026-08-21）：`pushNotificationManager.init` 在 `main.tsx` 启动接入（本地通知+权限；宠物健康/日程本地通知走 contextAwareness 已有链路）
- [x] **autoMapper 接线** ✅（2026-08-21）：`Live2DRenderer` 模型加载后用 `internalModel.getModelParameterIds()` 真实参数名单扫描 → `paramAutoMapper.autoDiscover`（记录映射/覆盖率），非伪造（snapshot 通过）
- [x] **modelHotLoader** ✅（2026-08-21 处置）：核心能力（模型加载时参数自动映射）已由 `paramAutoMapper`+`Live2DRenderer` 真实接线；本体为依赖 Node `events` 的死桩，重复且不可靠，**标记弃用**（header 注明），不接假加载路径
- [x] **emotionExtractor ↔ 记忆情感打通** ✅（核实 2026-08-21）：ChatWindow 已用 `emotionTagsToMood` → `updateMemoryMood` 回写当轮记忆 valence/arousal；enhancedMemory 有 W1 三维情感（volence/arousal），检索按情绪一致召回
- [x] **视觉记忆进召回** ✅（核实 2026-08-21）：`searchEpisodic`/`searchEpisodicWithScores` 已合入 `getVisualMemoryCandidates`（视觉快照+字符串相似度）
- [x] **记忆行级化 3 模块** ✅（核实 2026-08-21）：`petExperience`/`visualMemoryManager`/`entityLinking` **均已行级化**（`useRowLevelStorage`+`migrateToRows`+`pet_experiences`/`visual_memories`/`entity_nodes` 行表与迁移标记）；`encrypt_data` 仅在旧 blob 回退分支。entityLinking 23/23、visualMemory 24、s2-migration 22 均通过
- [x] **多分支对话完整化** ✅（2026-08-21）：manager/dialogueConfig/Panel(startDialogue/selectOption/goBack/canGoBack) 本已完整；本轮补**对话物品→打开对话图**触发闭环（`open-dialogue` 跨窗口事件 + 图不存在兜底）——petStore 62/62、snapshot 2/2 通过

---

## P2 — 长期 / 探索

- [ ] **自动更新发布落地**：`updater.ts` + `UpdateNotification` 已接线，需完成 updates.json、签名、GitHub Release 发布
- [ ] **粒子系统特效 / AI 驱动表情**：无对应模块，按需新增
- [ ] **实体多跳 / 记忆评测集 / LLM 巩固接入**（记忆升级 P3-10 限制项）
- [ ] **at-rest 流式加密 / .legacy 清理入口 / V1-V4 手工验收 / 一周体验抽检 / 性能基准**（未完成清单 V-1~V-4、T-13、D-2/3/4）
- [ ] **`usePetDragging.ts:251` eslint error**：合并未完成清单自称的新增 react-hooks/immutability 告警（T-2）

---

## 备用：确认可直接启用（低改动）的清单

以下功能模块代码完整且依赖就绪，补薄层即可上线（按收益排序）：
1. **MCP Server（stdio/SSE）** —— 入口调用 + PetWindow 事件监听
2. **收藏系统** —— 收敛实现 + Inventory 收藏 Tab + 物品钩子 + 持久化
3. **MCP Memory 编辑工具** —— 把 `memoryEditor` 暴露为 `spiritpal_memory` 扩展工具
4. **TTS** —— `ttsEngine` 接入对话链路
5. **推送通知 / 加密导出** —— 单例接入开关

> 本清单所有条目均来自 `src/` 与 `src-tauri/src/` 的 import/符号级核对；「可直接启用」项已含待补薄层的具体文件。后续完成某项请勾选 `[x]` 并注明日期。