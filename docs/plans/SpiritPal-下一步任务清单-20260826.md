# SpiritPal 下一步任务清单（交接给 AI 执行）

> **生成日期**：2026-08-26
> **项目版本**：v0.1.0（AGENTS.md 自进化协议 v2.17）
> **交接对象**：其他 AI 会话 / 开发者
> **仓库位置**：C:\Users\Doro\SpiritPal（本地 main 分支，工作区干净，最新提交 9a58db3）

---

## 0. 给执行 AI 的通用约定（必须遵守）

1. **AGENTS.md 是最高权威**：开工前先读 `AGENTS.md` 并执行「自进化自检清单」。改代码必须同步更新 AGENTS.md（新坑追加到第 14 节 Known Gotchas，完成后版本号 +0.1 并追加修订记录表）。
2. **全量回归命令**（根目录执行，pnpm 是唯一包管理器，用 `corepack pnpm`）：
   - `corepack pnpm lint`（tsc --noEmit + eslint，要求 0 error）
   - `corepack pnpm test`（vitest 全量，当前基线 1853 passed / 10 skipped）
   - `cd src-tauri && cargo check --all-targets`
3. **Rust 改动后必须出包**：`corepack pnpm tauri build` → 产物复制到 `artifacts/`（portable 用 `scripts/update-artifacts.ps1` 处理进程锁），否则 E2E/真实验证跑的是旧二进制（AGENTS.md §7.1 / Gotcha 1）。
4. **提交规范**：Conventional Commits，只 `git add` 具体文件，禁止 `git add -A` 一次全加。Python 目录必须确保 `__pycache__/`、`*.py[cod]` 被 .gitignore 覆盖（已补）。
5. **i18n 多语言**：任何新 UI 文案需 5 语言（zh-CN/zh-TW/en-US/ja-JP/ko-KR）同步 + `pnpm i18n:check`。
6. **UI 规范**：颜色必须用语义 Token（bg-pet-primary 等），禁硬编码 hex/`bg-blue-500`；禁 eslint-disable 注释批量加（Gotcha 21）。
7. **用户偏好**：最小化改动、不引入新问题；新功能优先复用现有组件，不做并行实现；未完善的功能宁可标「尚未完善」也不展示假数据；涉及大改动先确认范围。

---

## 1. P0 验收类（先做，多为运行时验收）

### 1.1 V-1：数据加密落盘验收（⚠️ 实测未通过，优先级最高）

- **目标**：正式安装包安装 → 对话 → 正常退出 → `%APPDATA%\com.spiritpal.desktop-pet\` 下应生成 `spiritpal.db.enc`，且无明文 `spiritpal.db` / `-wal` / `-shm` 残留。
- **现状证据（2026-08-26 实测）**：`C:\Users\Doro\AppData\Roaming\com.spiritpal.desktop-pet\` 下只有明文 `spiritpal.db` + `spiritpal.db-wal` + `spiritpal.db-shm`，**无 `spiritpal.db.enc`** → 加密链路疑似未生效（或退出时未触发落盘加密）。
- **实施要点**：
  1. 用 `artifacts/SpiritPal_0.1.0_x64-setup.exe` 做一次完整「安装→选宠物→对话→托盘退出」验收；
  2. 若未生成 .enc：查 `src-tauri/src/lib.rs` 的 RunEvent 退出分支（`Exit` / `ExitRequested` 事件里是否有调用加密落盘），以及 `encrypted_db.rs` 的调用时机；
  3. 检查明文 DB 是否因 dev 模式强退（DB 未刷新）或加密函数未接线的双路径问题。
- **验收标准**：正常退出后磁盘上只有 `spiritpal.db.enc`（或等价加密文件），无明文残留；重启后记忆完整保留。
- **参考**：`docs/plans/SpiritPal-未完成任务清单.md` V-1 项；`src-tauri/src/encrypted_db.rs`、`src-tauri/src/crypto.rs`（ENC2: 前缀，见记忆坑：前端各 load() 须同时识别 ENC1:/ENC2:）。

---

## 2. P0 功能类（学习成果落地分析报告 2026-08-25 未落地项）

> 来源：`docs/reports/学习成果落地分析报告.md` §6/§7。已完成的排除项：MCP Server 集成（`src-tauri/src/mcp_bridge.rs` 已存在）、记忆可视化面板（`src/components/MemoryVisualization.tsx` 已存在）、吸附交互视觉反馈（v1.7+ 已做磁吸/藏身/探头/贴边气泡）。

### 2.1 视觉感知增强「看看」（预估 3 天）

- **目标**：宠物能调用视觉能力描述屏幕/摄像头内容，提升 AI 场景理解。
- **现状**：仅 `bubbleManager.ts:376` 注释提及 visualPerception 供外部模块使用，无实际实现。
- **实施要点**：
  1. 设计触发入口（对话指令「看看」/ 右键动作）；
  2. 截图通道：Tauri 端截屏（Rust 命令）→ 前端传图给 LLM（现有 `aiConfig.ts` 的 provider 配置，deepseek 是否有 vision 需核实，否则接 vision 模型）；
  3. 结果回填对话/气泡。
- **验收**：对屏幕内容提问能获得合理描述；失败（无 vision 模型）有降级提示。

### 2.2 记忆时间线索引（预估 4 天）

- **目标**：记忆按时间线索引，提升长期检索精度。
- **现状**：无 timeline 实现（`src/lib/` 下无相关模块，i18n 有「时间线」翻译）。
- **实施要点**：
  1. `enhancedMemory.ts` 的记忆行增加时间索引（已有 created_at）→ 提供按日/周聚合的查询接口；
  2. 在 `MemoryVisualization.tsx` 增加时间线视图（组件已存在，扩展即可）；
  3. 检索侧 `searchEpisodic` 支持时间范围过滤。
- **验收**：可视化面板可查看记忆时间分布；检索可按时间段过滤。

### 2.3 动画多级回退策略（预估 2 天）

- **目标**：动画缺失时逐级回退（video → gif → atlas → svg），提升 MOD 兼容性。
- **现状**：`SpriteRenderer.tsx` 按 `spriteType` 分三支渲染，无跨类型回退；视频加载失败静默（`onFailed: () => {}`）。
- **实施要点**：`SpriteRenderer.tsx` 的 `loadWithFallback` onFailed 分支接入回退链（如 `characterResourceLoader.ts` 的资源解析），缺 walk.webm 时回退 idle 或图集。
- **验收**：删除某个角色的 walk.webm → 不白屏，回退到可用动画。

### 2.4 隐藏互动状态（爬墙/躲藏，预估 2 天）

- **目标**：宠物在窗口边缘触发爬墙/躲藏动画，丰富交互维度。
- **现状**：无（FSM 有 idle/happy/sad/sleeping/eating，`petBehaviorEngine` 无隐藏态）。
- **实施要点**：petState 增 `hide` 状态 + 窗口贴边时（`dockDir` 非空）触发概率性隐藏动作；视频型宠物需对应 webm（素材缺失时跳过）。
- **验收**：贴边时偶发隐藏动画，移开鼠标恢复。

### 2.5 编码反应行扩展（预估 2 天）

- **目标**：对齐 OpenPets 的编码场景反应（宠物感知用户敲代码/IDE 状态并给出反应）。
- **现状**：`codingReactionRows.ts` 已存在（表驱动），`contextAwareness` 有工作状态信号（coding/meeting/idle）。
- **实施要点**：核实 `codingReactionRows` 是否已接入触发（可能只定义了数据），接入工作状态 → 气泡/动作。
- **验收**：检测到 coding 状态时宠物周期性给出编码相关反应。

### 2.6 自定义角色导入优化（预估 5 天，大项）

- **目标**：降低创作门槛，「拖入即用」。
- **现状**：`characterResourceImporter.ts` / `characterCardImporter.ts` / `shimejiLoader.ts` 已有多条导入路径；`scripts/asset-pipeline/`（psd_to_pet.py / normalize.py / chroma_key.py）已提供素材加工工具。
- **实施要点**：
  1. 把 asset-pipeline 三个脚本能力接入导入向导（拖入 PSD → 自动出帧 + pet.json）；
  2. 统一/合并现有多个 importer 的入口与校验（`characterCardSystem.ts` 的 validateCharacterCard）；
  3. 导入失败提示链完善。
- **验收**：拖入一个 PSD 或角色包 → 生成可用的新宠物（含视频型色度键兜底）。

### 2.7 社区/排行/模组市场真实后端（待用户决策，勿擅自开工）

- **现状**：`FeatureComingSoon`「尚未完善」占位（用户认可的状态，反感假数据）。
- **决策点**：是否立项接真实后端（需服务器/账号体系），或保持占位。**开工前必须与用户确认**。

---

## 3. P1 记忆系统收尾（未完成任务清单 2026-08-15 未完成项）

> 来源：`docs/plans/SpiritPal-未完成任务清单.md`。已完成：T-3/T-4/T-7/T-8/T-9/T-10/T-14/T-1(ownerFacts)。

### 3.1 T-5：visualMemory 参与检索召回（预估 1 天）

- **现状**：`ChatWindow.tsx` 固定注入 `buildContext(200)`（"最近感知"），视觉观察类记忆未进入 `searchEpisodic` 检索索引。
- **实施**：观察类记忆以 `source_kind='observation'` 落 `memories` 行，参与 RAG/实体检索。

### 3.2 T-6：emotionExtractor ↔ 记忆情感打通（预估 1 天）

- **现状**：`emotionExtractor`（LLM `[emotion:xxx]` 标签）只驱动动画/好感度；记忆侧 valence/arousal 靠规则词表 `assessEmotion3D`。
- **实施**：对话结束后将 LLM 情绪标签回写为当轮记忆的 valence/arousal（覆盖或融合规则值）。

### 3.3 T-1 剩余三模块行级化迁移（每模块约 0.5 天）

- **现状**：`petExperience` / `visualMemoryManager` / `entityLinking` 各保留 1 处 per-value `encrypt_data`。
- **实施**：复用 ownerFacts 模式（`db.ts` 的 `loadFromRows/migrateToRows` + `.legacy` 备份 + 双模式回退）。

### 3.4 T-12：统一 memoryConfig（预估 1~2 天）

- **现状**：触发上限/间隔/忽略阈值、注入冷却 24h、向量阈值 0.45、proactive 节奏、维护定时等仍散落硬编码。
- **实施**：迁入单一配置模块（T-4 已完成 semantic 部分）。

### 3.5 T-11 GDPR 导出清单 + PII 掩码（可选，0.5~1 天）

- **现状**：`dataManager.exportAll()` 无导出内容清单/PII 掩码。

### 3.6 T-13 at-rest 流式加密（优化项，可暂缓）

- **现状**：`encrypted_db.rs` 全量 `fs::read` + base64（100MB DB 峰值内存约 400MB）。DB 实际 <50MB，可暂缓。

### 3.7 T-15：docs 归档评估系列文档（0.5 天）

- **现状**：第五轮报告 / S2 方案 / 本清单未按编号体系归档进 docs/。

---

## 4. P1 工程卫生（核实类）

### 4.1 eslint T-2 遗留项（核实是否已解决）

- 2026-08-15 记录：`usePetDragging.ts:251` 有 1 条 react-hooks/immutability error。**2026-08-26 全量 lint 已 0 error**（76 warning 均为记忆系统既有未使用变量）→ 大概率已解决，开工前 `corepack pnpm lint` 确认即可，无需处理。

### 4.2 移动端同步（android / MobileApp，核实类）

- **现状**：仓库含 `android-sdk/`、`src/mobile/MobileApp.tsx` / `MobileMemoryView.tsx` / `MobileSettingsView.tsx`、`docs/plans/android-emulator-debug-guide.md`。
- **任务**：核实移动端与桌面端功能/依赖是否同步（AGENTS.md Gotcha 11：功能性改动后必须 `pnpm tauri android build --apk` 编译验证）。

### 4.3 E2E 测试 CI 集成（核实类）

- **现状**：`docs/plans/E2E 测试 CI 集成指南.md`、`playwright.tauri.config.ts`、`tests/e2e/main-path.spec.ts`、`.github/workflows/e2e.yml` 已存在。
- **任务**：核实 e2e.yml 是否已在 GitHub 生效、主路径用例是否随 v2.14~v2.17 改动仍可跑通（漫游重构后旧 E2E 可能引用已删除的 roam-window）。

### 4.4 Sentry 集成落地（核实类）

- **现状**：`docs/plans/Sentry 集成指南.md` 存在；AGENTS.md §3.2 提及 errorBoundary 线上要开 SourceMaps upload。
- **任务**：核实 Sentry DSN 是否已配置、SourceMap 上传链路是否接通。

---

## 5. 待用户决策项（勿擅自决定）

| # | 决策 | 现状 | 选项 |
|---|------|------|------|
| D-1 | 记忆三模块二期迁移范围 | 未迁移 | 全迁 / 只迁 petExperience / 暂缓 |
| D-2 | 移动端 at-rest 加密 | 未定 | 跳过（依赖沙箱）/ 与桌面一致 |
| D-3 | `.legacy` 备份清理入口 | 未实施 | 永久保留 / 设置页清理入口 |
| D-4 | 社区/模组市场真实后端 | 「尚未完善」占位 | 立项接后端 / 保持占位 |

---

## 6. 建议执行顺序

1. **V-1 加密落盘验收**（1.1）——最高优先，若加密链路真的没生效，所有记忆数据处于明文风险中；
2. **快速核实类**（4.1/4.2/4.3/4.4）——每项半天内出结论，决定是否需要投入；
3. **记忆系统收尾**（第 3 节）——每项独立小步、独立回归；
4. **P0 功能**（第 2 节）——按用户选定顺序推进，每项完成后全量回归 + 出包 + AGENTS.md 更新。

---

## 7. 交付物规范（每完成一个任务）

1. 全量回归通过（lint / vitest / cargo check）；
2. 功能性改动后出包并替换 `artifacts/`（含旧版备份）；
3. AGENTS.md 自进化协议更新（Gotcha 如有 + 修订记录表 + 版本号递增）；
4. 按 Conventional Commits 分批提交，只 add 具体文件。
