<!-- 注记：本节内容于 2026-08-27（家族规范治理 Phase E3）自 AGENTS.md 整节逐字移出，一个字符未改；此后新 SOP 按铁律 #3 直接追加到本文件末尾 -->
# 典型 AI 开发场景 SOP（自 AGENTS.md 移出）

## 13. 典型 AI 开发场景 SOP（照着做，少踩坑）

<!-- 📥 新SOP追加模板（AI 完成新类型任务后复制填好追加到这里）：
#### SOP-X: [场景名称]
**适用条件**：什么情况下走这个流程
**步骤**：
1. 第一步...
2. 第二步...
3. 第三步...
**验证**：怎么确认操作成功
**关联文件**：
- path/to/file1.ts
- path/to/file2.rs
-->

#### SOP-1: 新增一个 Rust Tauri Command（如 `cmd_pet_hug` 撸猫加好感度）
**适用条件**：前端需要访问 Rust 端才能做的操作（加密写库、改系统托盘、写文件）

**步骤**：
1. `src-tauri/src/types.rs` 加入参 + 出参 struct：
   ```rust
   #[derive(Debug, Serialize, Deserialize)]
   pub struct HugResult { pub mood_delta: i32, pub new_total: i32 }
   ```
2. `src-tauri/src/commands/pet.rs` 写函数：
   ```rust
   #[tauri::command]
   pub async fn cmd_pet_hug(app: tauri::AppHandle, pet_id: &str, strength: u8) -> Result<HugResult, String> {
       // 1. 参数校验（strength 1-10，越界 Err("strength out of range")）
       // 2. DB 事务：读 pet → 加好感度 → 写回
       // 3. 发事件给前端（可选） app.emit("spiritpal:mood_changed", ...)
       // 4. Ok(HugResult { mood_delta, new_total })
   }
   ```
3. `src-tauri/src/lib.rs` 的 `Builder::default().invoke_handler(tauri::generate_handler![...])` 里 **把新函数名加进去**（不加的话前端 invoke 会报「command not found」，调试半小时的经典坑）
4. 前端 `src/lib/ipcTypes.ts` 加常量 + 类型：（注：2026-09-12 源码核实该文件已不存在，IPC 契约现由 `src/**/ipcContract.test.ts` 守护，无独立 types 文件）
   ```ts
   export const CMD_PET_HUG = "spiritpal:pet_hug" as const
   export interface HugResult { mood_delta: number; new_total: number }
   ```
5. `src/stores/petStore.ts` 加 action `async hugPet(petId, strength)`，内部调用 `useTauriInvoke<HugResult>(CMD_PET_HUG, { pet_id: petId, strength })`
6. 单元测试：前端 Vitest mock tauri invoker 测 store action；Rust `cargo test cmd_pet_hug_*` 测参数校验和 DB 写入
7. **最后一步**（见 §7.1 Build After Code Changes）：`pnpm build` → 产物复制到 `artifacts/` → 手动点一下验证「撸猫」按钮真的加了好感度。

#### SOP-2: 新增一个 Zustand Store（如新增 achievementStore：成就系统）
1. 新建 `src/stores/achievementStore.ts`：
   ```ts
   import { create } from "zustand"
   import { persist, createJSONStorage } from "zustand/middleware"
   // 注意：如果是敏感数据（用户成就其实无所谓，示例示范加密）
   // import { encryptMiddleware } from "@/lib/encryption/storeMiddleware"

   interface AchievementState {
     unlocked: Record<string, { unlockedAt: number; count?: number }>
     unlock: (id: string) => void
     reset: () => void
   }

   export const useAchievementStore = create<AchievementState>()(
     persist(
       (set) => ({
         unlocked: {},
         unlock: (id) => set((s) => ({ unlocked: { ...s.unlocked, [id]: { unlockedAt: Date.now() } } })),
         reset: () => set({ unlocked: {} })
       }),
       {
         name: "spiritpal:achievements",  // persist 命名统一前缀 spiritpal:xxx
         storage: createJSONStorage(() => localStorage), // 敏感的话换成加密 storage
         partialize: (s) => ({ unlocked: s.unlocked })  // 只持久化需要的字段
       }
     )
   )
   ```
2. `src/lib/data/types.ts` 加 `AchievementDef` / `UnlockedAchievement` 类型定义（同步改 `src-tauri/src/types.rs` 如果 Rust 端也要读）
3. Vitest 测试：4 个最小用例（初始空、unlock 加、重复 unlock 幂等、reset 清空）
4. 如果 store 里字段要参与 Rust 端 backup/restore 流程 → 同步改 `commands/backup.rs` 的 schema。

#### SOP-3: 新增一个宠物角色（例如新增 Miko 小狐狸 Live2D 模型）

> ⚠️ 前置条件：本仓库不内置 Live2D 模型资产。需自行放置 `public/assets/live2d/<model>/<model>.model3.json`，否则本步骤无法执行。

1. 把新的 Live2D 模型文件（`.model3.json` + `.moc3` + 贴图 + 动作 motion3.json）放到 `public/assets/live2d/<model>/` 目录（例：`miko`）
2. `src/lib/data/types.ts` 的 `PetSpecies` enum 加 `miko: "fox"` 变体（同步 Rust `types.rs`）
3. `src/stores/petStore.ts` 初始化 `availablePets` 数组里加一条 `{ id: "miko-001", species: "fox", name: "Miko", modelPath: "/assets/live2d/<model>/<model>.model3.json" }`（路径与步骤 1 实际放置的模型目录一致）
4. `src/lib/petBehaviorEngine.ts` 的 FSM 表里加一条 fox 物种的专属动作映射（注：2026-09-12 源码核实该文件名已不存在，行为引擎现位于 `src/lib/ai/behaviorEngine.ts`）（fox 兴奋时触发 `motion("jump")` 而不是 `motion("wag_tail")`，dog 才 wag tail）
5. **测试**：pnpm dev → 启动后设置里选 Miko → 手动验证：Idle 动画循环正常、点她触发 tap motion、表情切换正常（happy/sad）
6. 性能验证：打开「性能统计面板」(devtools)，确保 Miko FPS 稳定 30 且 30 分钟不泄漏内存（`pnpm test:perf` 单独跑）
7. 翻译补充：每种语言的 `pet_window.default_name_miko` key 补上（「Miko / 美子 / ミコ」等）→ 跑 `pnpm i18n:check`

#### SOP-4: 新增一项设置
1. `src/lib/data/types.ts` 的 `Settings` interface 加字段（例：`pet_autostart_on_login: boolean` = 开机自启开关）
2. Rust 端 `src-tauri/src/types.rs` 的 Settings struct 同步加
3. `src/stores/settingsStore.ts` 的 default 初始值 + 加 `setPetAutostartOnLogin(v: boolean)` action
4. 前端 `components/settings/GeneralSettings.tsx` 加 UI（Switch / Dropdown），UI 必须走 SpiritPal UI Kit（`BrandSwitch` 组件，不许原生 `<input type=checkbox>`）
5. **如果涉及 OS 能力**（如开机自启 = 写 Windows Registry / macOS LaunchAgents）→ 同步写一个 Rust command `cmd_settings_set_autostart(enabled: bool)`，action 内部调这个 command 而不是直接 localStorage
6. 备份/恢复：`commands/backup.rs` 的 settings 字段加新字段名，不然用户导出 JSON 再导入新字段就丢了
7. 翻译：每种语言 `settings.autostart_label` + `settings.autostart_hint` 补上 → `pnpm i18n:check`

#### SOP-5: 增量更新发布链（updates.json + 签名密钥 + 配置，缺一即漏更新）
**适用条件**：每次发版（tag v* 触发 release.yml）或首次启用 Tauri 增量更新

**步骤**：
1. 密钥：`src-tauri/keys/` 存放 updater 签名密钥对（.key 私钥 / .key.pub 公钥，均 .gitignore）；`tauri.conf.json → plugins.updater.pubkey` 必须与 .key.pub 一致（核验：`tauri signer sign --private-key-path=keys/x.key --password= <文件>` 实测签名成功即配套）
2. Secret：`TAURI_SIGNING_PRIVATE_KEY` = 私钥全文（`gh secret set`）；私钥无密码时无需设 PASSWORD（GitHub Actions 未设置 secret 解析为空串，与空密码签名一致）
3. 配置：`plugins.updater.active=true / dialog=true`；`bundle.createUpdaterArtifacts=true`；`endpoints` 的 owner/repo 必须等于 `git remote -v` 实际值（坑 #65）
4. 发版后 updates.json 自动生成并提交（release.yml `publish-updates` job：回读验证资产 + `scripts/generate-updates-json.mjs` + 提交 main）；本地手动：`node scripts/generate-updates-json.mjs --repo <owner/repo> --tag vX.Y.Z`
5. 前端入口：托盘「检查更新」/ 设置-关于「检查更新」→ UpdateNotification 弹窗状态机（checking→available/error→downloading→verifying→installing→restarting）；关于页版本号用 `getVersion()` 动态读取，禁止硬编码

**验证**：`curl -sI https://raw.githubusercontent.com/<owner>/<repo>/main/updates.json` 200；`node scripts/lint-capabilities.mjs` 通过；release 资产含 `.sig` 文件

**关联文件**：
- src-tauri/tauri.conf.json
- scripts/generate-updates-json.mjs
- .github/workflows/release.yml
- src/lib/system/updater.ts / src/components/UpdateNotification.tsx

#### SOP-6: 依赖生态与安全跟踪（受上游阻塞项的持续跟踪 + 发版预检）
**适用条件**：① 存在「上游阻塞、无法在本仓修复」的依赖问题（如 glib/alert#14、pixi8/#29）需要持续跟踪；② 每次发版（打 tag v*）前。

**步骤**：
1. 生态跟踪是自动的：`.github/workflows/deps-watch.yml` 每周一 04:23 UTC 跑 `scripts/track-deps-ecosystem.mjs`；发现可行动变化（官方 live2d 支持 pixi 8 / tauri 允许 gtk 0.20+）自动开 `[deps-watch]` issue，workflow 保持绿（变化以 issue 承载，不红主页）。收到 issue 后按《docs/execution/依赖与安全跟踪机制》§三/§六处置。
2. 新跟踪对象登记：npm 包加进脚本 `PIXI_ECOSYSTEM`；RUSTSEC 修复线变化更新 `GLIB_FIXED_MINOR`/`GTK_FIXED_MINOR` 常量；新增执行文档同步登记 `scripts/check-exec-docs-tracked.mjs` 的清单。
3. 新依赖漏洞：CI `dependency-vuln-scan`（push/PR + 每周一 03:00 UTC）的 security_gate 棘轮超标即红 = 唯一允许的信号红；按机制文档 §三分级 SOP 处置（CRITICAL/HIGH 48h，动棘轮基线必须留痕）。
4. 发版前必跑：`node scripts/pre-release-check.mjs --local-artifacts`（版本三处一致/工作区干净/包<30MB/updates.json 可达/签名非空）；本机加速器 MITM 环境远程项失败用 `--skip-remote` 留痕，发布后以 publish-updates 回读为准。
5. 全部通过后打 tag v*；发版观察按 RELEASE_VERIFICATION §1。

**验证**：`node scripts/track-deps-ecosystem.mjs` exit 0/1 语义正确；`node scripts/check-exec-docs-tracked.mjs` exit 0；`node scripts/pre-release-check.mjs` 全绿后才打 tag。

**关联文件**：
- scripts/track-deps-ecosystem.mjs / scripts/pre-release-check.mjs / scripts/check-exec-docs-tracked.mjs
- .github/workflows/deps-watch.yml / .github/workflows/structure-guard.yml
- docs/execution/依赖与安全跟踪机制-20260911.md

#### SOP-7: 社区宠物批量接入（manifest 自动发现，2026-09-11）
**适用条件**：把外部宠物仓库（OC-Claw / OpenPets / WindowPet / dsh-pet / DyberPet 等）的素材批量接入 SpiritPal，接入后宠物自动出现在首启选择器 / 设置页外观 / PetWindow 切换列表。

**步骤**：
1. **改素材源协议 → `CharacterPackConfig` 格式**（字段：id/name/version/author/license/description/**spritePath**/spriteType/atlasLayout/licenseMeta）。`loadPack()`（src/lib/render/characterResourceLoader.ts L200）已自带模板人设（systemPrompt/bubbleMessages/personality），**无需改它**。
2. **落盘**：`public/pets/<id>/pet.json` + 素材（atlas 用 `spritesheet.webp|png`，video 按 `stateToVideoFile` 命名 idle/walk/rest/eat/spin/dance/angry/headpat.webm）；非 MIT 许可（GPL/版权二创）写 `licenseMeta: { type, audited: true }` 放行，且按独立目录便于后续删除。
3. **manifest**：`public/pets/manifest.json` = `{ "packs": ["<id>", ...] }`（由 `scripts/import-community-pets.mjs` 的 writeManifest 扫描生成，排除内置 doro/feibi/gugugaga）。
4. **运行时接线**：`src/lib/render/communityLoader.ts`（仿 shimejiLoader 的"启动异步加载→模块级缓存→同步合并"）→ `App.tsx` 启动 useEffect 预热 → `getAllCharacters()/getCharacter()` 末尾合并（内置优先去重）。loadPack 已被 `licenseMeta.audited` 放行。
5. **素材下载走 git blobs API**（GitHub contents API 限 1MB、raw 常被本机加速器 MITM、gh 不接受 octet-stream）：
   `GET /repos/<repo>/git/trees/main?recursive=1` 拿 blob sha → `GET /repos/<repo>/git/blobs/<sha>` 取 base64 content。
6. **视频转换**：ffmpeg 便携版放 `scripts/tools/ffmpeg/`（gitignore）；`-c:v libvpx-vp9 -pix_fmt yuva420p -auto-alt-ref 0 -b:v 0 -crf 32`；黑底无 alpha 源先 `colorkey=0x000000:0.06:0.06`（**colorkey 只有 color:similarity:blend 三参数**）；内置 gugugaga 同款是 yuv420p 黑底 + 运行时色度键兜底（GOTCHAS #27）。
7. **帧 PNG 拼 spritesheet**（DyberPet 类）：多个输入 concat 前**每个输入加 `setsar=1`**（源 PNG SAR 元数据不一致会导致 concat 失败）；输出单帧加 `-update` 或接受 image2 警告；tile 是行优先填充，按目标行分批 `tile=8x1` 再 `vstack`。
8. **id 规范化**：kebab-case；点号转连字符；撞内置追加来源后缀（doro.codex-pet→doro-codex）。纯函数集中在 `scripts/community-pet-maps.mjs`（含单测 scripts/__tests__/community-pet-maps.test.mjs，已并入 vitest include）。

**验证**：
- `node scripts/import-community-pets.mjs --source=<src>` 幂等重跑全 skip；
- `pnpm vitest run scripts/__tests__/ src/lib/__tests__/communityLoader.test.ts` 全绿（manifest 发现 / 模板人设 / GPL audited 放行 / 内置优先）；
- `pnpm tauri dev` 首启/设置页/切换列表出现新宠物，atlas（doro-codex）/ video（xiang-qie）/ shimeji（hu-tao）三类各切一只确认渲染与喂食。

**关联文件**：
- scripts/import-community-pets.mjs / scripts/community-pet-maps.mjs / scripts/__tests__/
- src/lib/render/communityLoader.ts / src/lib/render/characterResourceLoader.ts / src/lib/data/characters.ts
- src/App.tsx / src/components/PetWindow.tsx / src/components/SettingsWindow.tsx
- public/pets/manifest.json

#### SOP-8: 学习报告仓库系统性排查（5 阶段独立复查，2026-09-12）
**适用条件**：对一批历史学习报告（实现率/EvidenceScore/A-D 分类/落地数据）做系统性复核，产出可信赖的修正版数据。**预期工时**：32 项任务约 1 个完整工作日（按报告数量与跨语言项目占比浮动）。

**步骤**：

**阶段一：数据完整性检查**
- 输入：学习报告清单、EvidenceScore 计算脚本、分类规则。
- 检查项：① 报告数量/分类/EvidenceScore 是否齐全无缺漏；② 评分正则覆盖全部目标语言扩展名（.ts/.js/.gd/.cs/.py/.rs/.go/.cpp 等，见 Gotcha #81）；③ 每份报告证据条数与分数可复算。
- 通过标准：无缺漏报告；抽 3 个跨语言项目手算分数与脚本输出一致。
- 常见问题：正则只覆盖 JS/TS → Godot/C#/Python 项目被系统性低估（#81）。
- 输出物：完整报告台账 + 修正后的 EvidenceScore 清单。

**阶段二：EvidenceScore 准确性验证**
- 输入：阶段一台账中得分最高/最低各 3 份报告。
- 检查项：① 报告引用的源码路径/符号真实存在（先 `Get-ChildItem -Recurse` 定位，防扁平旧路径误判 #79）；② 评分标准跨报告一致（同类证据同权重）。
- 通过标准：抽查报告 100% 的源码引用能在当前仓库找到真实实现。
- 常见问题：文档路径已随 src/lib 子目录化重构失效（#79）。
- 输出物：抽查核对记录 + 分数修正表。

**阶段三：分类正确性复核**
- 输入：全部报告的 A/B/C/D 初分结果。
- 检查项：按统一分类标准逐份复核；重点人工核对边界分数（40 分上下升档、100 分上下降档）的报告。
- 通过标准：边界报告 100% 人工复核；分类与修正后分数一致。
- 常见问题：扩展名漏算导致跨语言项目压档（Dororo 72→129，B→A）。
- 输出物：修正版分类清单。

**阶段四：落地数据验证**
- 输入：报告中声称的"已实现/待实现"技术清单。
- 检查项：逐项源码级 grep 验证；i18n 文案/窗口参数/菜单项不算功能实现（#80）；MCP Server 等 P0 级"待办"重点复核。
- 通过标准：所有"已实现"标记均有真实运行链路证据（importer/调用方/函数体），"待实现"清单收敛到真实硬缺口。
- 常见问题：历史报告实现率严重过时（80% → 95.3%，#78）；按名称推断技术栈（#82）。
- 输出物：修正版实现率 + 真实待实现缺口清单。

**阶段五：交叉验证**
- 输入：前四阶段全部输出物。
- 检查项：① 多份报告间同名项目/同名技术的数据一致性；② 报告数据与实际源码的最终核对；③ 修正后结论留痕（旧值→新值→依据）。
- 通过标准：无自相矛盾条目；所有修正均附源码证据。
- 常见问题：不同批次报告对同一项目结论打架，以当前源码为准。
- 输出物：终版修正报告 + 差异对照表（旧数据/新数据/源码证据路径）。

**验证**：① 抽 5 项修正结论重新独立 grep 源码复核；② 修正后实现率、分类分布与终版报告一致；③ 新发现的坑按铁律 #2 追加 GOTCHAS（#78-#82 即本 SOP 首批产物）。

**关联文件**：
- docs/project/KNOWN_GOTCHAS.md（#78-#82）
- 历史学习报告目录（实现率/EvidenceScore/分类台账）

#### SOP-9: 记忆实体关系图谱（力导向可视化）落地，2026-09-12
**适用条件**：需要在记忆面板新增「实体关系图谱」可视化，且受「不改 Rust」约束。**预期工时**：约半天。

**步骤**：
1. **先定数据源（最易踩坑，见 Gotcha #85）**：读 `src/lib/data/db.ts` 确认可用 Tauri 命令。本仓 `memory_entities` 无 list-all 命令，改走 `getEntityNodes(characterId)`（= `sp_entity_list`，实体_nodes 表，活跃填充）；边用 `buildCooccurrenceEdges` 从共享记忆共现派生，不要假设有边表。
2. **数据层纯函数化**：布局算法独立成 `src/lib/memory/forceLayout.ts`（纯计算，无 DOM），返回每轮 energies 便于断言收敛；实体映射/边派生放 `entityGraph.ts`，均可单测。
3. **组件**：纯 Canvas 自绘（不引 d3）。逻辑坐标固定（如 1000×700）与 canvas 像素解耦；view transform `{scale,tx,ty}` 用 ref；事件驱动重绘（不挂常驻 rAF，便于 jsdom）；`ctx=getContext('2d')` 返回 null 必须早退（jsdom 无 canvas）。
4. **交互**：mousedown 命中节点→拖拽/否则平移；位移<4px 视为点击选中；wheel 以光标为中心缩放（先算光标下世界点 `wx=(kpx-tx)/scale`，再 `tx=kpx-wx*newScale`）；hover tooltip 用绝对定位 HTML div。
5. **接入面板**：在 MemoryPanel 的 viewMode 联合类型加 `'graph'`，新增按钮与三元渲染分支；MemoryPanel.test.tsx 已被 coverage 排除但仍跑，新 tab 另建 `MemoryPanelGraphTab.test.tsx` mock 替身。
6. **测试**：力导向收敛（tailAvg energy < headAvg）+ 无连接节点不重叠；查询函数 mock `@/lib/data/db`；组件测试走 props 注入数据避开 DB。
**常见问题**：CRLF 文件 Edit 多行 old_string 必失败（#83）；两套实体 type 联合类型不同需归一化；全量 vitest 并行时 perf 基准/LLM 用例会因机器负载偶发超时，隔离重跑即绿，勿误改断言。


#### SOP-10: 大规模并行子代理开发协调（8+ 代理同仓），2026-09-12
**适用条件**：需要在同一仓库内并行派发 5+ 个子代理执行独立功能模块，且受并发上限（通常 5）约束。**预期工时**：协调 overhead 约 15-30 分钟。

**步骤**：
1. **前置核查**：组织者先跑 `npx tsc --noEmit` / `npx vitest run` 确认基线绿，记录测试数（如 2473 passed）。
2. **文件所有权边界**：每个子代理的 subtask 中明确列出"禁止触碰"的文件/目录清单（其他代理的在途文件），避免交叉修改。共享文件（如 MemoryPanel.tsx）只允许一个代理修改。
3. **版本号治理**：AGENTS.md 版本号由最终治理代理统一递增，子代理不得自行递增；如子代理已递增，最终治理时核对 REVISION_LOG 无重复后顺延。
4. **并发槽位管理**：受 5 代理上限约束时，先派发高优先级/长耗时任务，完成一个补位一个；用 `wait_agent` 阻塞等待，不要 busy-poll。
5. **完成验收**：每个子代理返回后检查：① tsc/eslint 退出码；② 新增测试数；③ 是否触碰了禁止文件；④ 是否修复了他代理在途文件（需标注）。
6. **最终治理（串行）**：全部代码任务完成后，组织者统一执行：① `npx tsc --noEmit`；② `npx eslint src/`（0 error 即可，warning 为存量）；③ `npx vitest run`（0 failed）；④ `python scripts/check_spec_refs.py`（0 幻影）；⑤ 追加 GOTCHAS/SOP；⑥ 递增 AGENTS.md 版本 + REVISION_LOG。
7. **冲突复核**：重点核查被多个代理触碰的文件（git diff），确认合并无遗漏；复核被他代理修复过的在途文件最终状态正确。

**常见问题**：① 子代理自行递增版本号导致重复——最终治理核对 REVISION_LOG；② 全量测试偶发超时（communityLoader/multimodalLLM）——隔离重跑确认非回归；③ CRLF 文件 Edit 多行 old_string 必失败（#83）——子代理用单行锚点或 PowerShell 替换。
