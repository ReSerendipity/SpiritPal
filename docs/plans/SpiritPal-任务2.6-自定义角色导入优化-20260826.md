# SpiritPal 任务 2.6：自定义角色导入优化 — 实施任务报告

> **生成日期**：2026-08-26
> **项目版本**：v0.1.0（AGENTS.md 自进化协议 v2.18）
> **交接对象**：执行 AI / 开发者
> **预估**：P1 统一导入链路 3 天 + P2 素材管线对接 2 天 + P3 打磨 1 天（总计约 5~6 天，可按阶段独立交付）
> **现状调研基准**：2026-08-26 代码复核（含行号引用，开工前若代码变动需重新核对）

---

## 1. 目标

把「做新宠物」的成本从美术门槛降到「拖入即用」：用户拖入角色卡（JSON/PNG）、资源包（zip/目录）、帧序列目录甚至 PSD，应用内即可生成一只可用的新宠物（atlas / 视频 / SVG 三种形态都支持，视频素材自动走色度键兜底）。同时清理现状中半截的导入代码，避免「看起来支持、实际坏」的假功能。

**非目标**（明确不做，避免范围膨胀）：
- PSD 自动骨骼 rig（Petra Anime2.5DRig 是独立引擎，另立里程碑）；
- 社区/排行后端（任务 2.7，另行决策）；
- 重做角色卡片系统本身（CharacterCardSystem 已可用）。

---

## 2. 现状调研（事实依据）

### 2.1 现有导入路径（3 条可用 + 3 条未接线）

| # | 路径 | 入口 | 调用链 | 支持格式 | 状态 |
|---|------|------|--------|---------|------|
| A | 创建新角色 | SettingsWindow.tsx:647 → CharacterCreator.tsx | handleImport L332 → petStore.addCustomCharacter (petStore.ts:898) → saveCustomCharacter (characters.ts:262) | 仅 CharacterProfile 形态 JSON | ✅ 可用，但 JSON 浅合并不校验 |
| B | AI 创建 | SettingsWindow.tsx:653 → CharacterCreationWizard.tsx | LLM 生成 profile | — | ✅ 可用，无导入 |
| C | .petmod 导入 | ModPanel.tsx:211 handleImportPetmod | modManager.importPetmodFile (modManager.ts:559) → Tauri `import_petmod`（lib.rs:916 已注册） | petmod zip | ✅ 可用 |
| D | 角色卡导入 | **无 UI 调用点** | characterCardImporter.importCharacterCard (L371) / extractCharCardFromPNG (L102) | SillyTavern JSON / PNG 嵌卡 | ❌ 未接线，且只返回 Partial、从不持久化 |
| E | 资源包/目录导入 | **无 UI 调用点** | characterResourceImporter.registerCharacter (L467) / importFromDirectory (L555) | 资源包目录 | ❌ 未接线，且依赖的 Rust 命令未注册（见 2.3） |
| F | 资源包加载 | **无 UI 调用点** | characterResourceLoader.loadPack (L194) / importPetmod (L346) | zip | ❌ 未接线 |

### 2.2 角色定义与清单格式（⚠️ 3 套互不兼容）

| 格式 | 位置 | 说明 |
|------|------|------|
| `CharacterProfile` | types.ts:192-246 | 应用内角色模型。spriteType 仅 `atlas|svg|gif|video`（L218）；spriteAsset L216、atlasLayout L237、chromaKey L240、type builtin|community|mod L243 |
| `PetMetadata` | petMetadata.ts:36-91 | formatVersion `'1.0'`，含 sprite/atlas/animations/reactions/sounds。**asset-pipeline 的 psd_to_pet.py 输出对齐这套** |
| `CharacterPackConfig` | characterResourceLoader.ts:33-69 | spritePath 单字段 |
| `CharacterResourcePackage` | characterResourceImporter.ts:105-133 | sprites[] 数组 |

**结论**：同一份「角色包」有 3 种清单结构，必须先统一，否则任何导入器接 UI 都会各说各话。

### 2.3 关键缺口（本次必须修）

1. **Rust 命令未注册**：`characterResourceImporter` 调用的 `scan_character_directory` / `read_text_file` 不在 src-tauri/src/lib.rs invoke_handler（L891-932）注册 → 运行时静默返回 `[]`（importer L277-281）。这是路径 E 看起来有代码但永远空结果的直接原因。
2. **校验无 UI 呈现**：`validateCharacterCard`（characterCardSystem.ts:214）失败仅 `console.warn`（L431），用户看不到任何提示。
3. **导入不持久化**：`importCharacterCard` 只返回 Partial profile，从不落库 → 导入「成功」但重启后消失。
4. **死代码**：`CustomPetForm.tsx`（364 行）全项目无引用；CharacterCreator 的「自定义动画行」编辑（L678-711）不写回 atlasLayout（死 UI）。
5. **shimejiLoader 路径不存在**：`../assets/shimeji-profiles/*.json` 与 `/pets/shimeji/profiles` 均不存在（public/pets 只有 doro/feibi/gugugaga/laocha）→ 实际加载为空（可留待后续，不在本次必修）。

### 2.4 素材管线（scripts/asset-pipeline/，已有，未对接）

| 脚本 | 能力 | 依赖 |
|------|------|------|
| `chroma_key.py` | 黑幕/绿幕 → 透明 WebM（VP9 alpha，阈值 12 与运行时 chromaKey.ts 一致） | ffmpeg；numpy 可选 |
| `normalize.py` | 统一尺寸/帧率/居中 → 透明 WebM 或 PNG 帧序列 | ffmpeg |
| `psd_to_pet.py` | 分层 PSD → 透明 PNG 帧 + pet.json 骨架（对齐 PetMetadata） | psd-tools / Pillow |

前端已有 `spriteSheetTool.ts`（extractFrames / generateSpriteSheet，L205）可把 PNG 帧序列合成 atlas——**这是前端无需 Python 就能合成图集的关键能力**。

---

## 3. 差距分析（现状 → 目标）

| 目标能力 | 现状 | 缺口 |
|---------|------|------|
| 拖入 JSON 角色卡 → 新宠物 | 路径 A 只支持 CharacterProfile 形态、不校验 | 需接入 D 的 importCharacterCard（SillyTavern 卡）并持久化 |
| 拖入 PNG 角色卡 → 新宠物 | D 的 extractCharCardFromPNG 未接线 | 接线 + 持久化 |
| 拖入资源包目录/zip → 新宠物 | E/F 未接线 + Rust 命令缺失 | 注册 Rust 命令 + 接线 + 统一格式 |
| 拖入 PSD / 黑幕视频 → 新宠物 | asset-pipeline 脚本存在但零对接 | P2 集成（本机 python 检测 + 调用） |
| 失败提示可见 | 校验失败仅 console.warn | 校验结果接入 UI |
| 导入后立即可用（含视频色度键） | 运行时 chromaKey 兜底已就绪 | 导入时正确写入 chromaKey 字段 |

---

## 4. 实施计划

> 通用约定见 AGENTS.md（自进化协议、回归命令、提交规范、i18n 5 语言、语义 Token）。每阶段独立交付 + 独立回归。

### 阶段 P1-1：统一清单格式与加载中枢（0.5~1 天）

**目标**：消除 3 套 pet.json 的混乱，导入器产出统一的 `CharacterProfile`。

1. 定义统一「角色包清单」结构（建议以 `PetMetadata` 为基底扩展，或直接复用 `CharacterProfile`）：字段映射表写清楚
   - `CharacterPackConfig` / `CharacterResourcePackage` / `PetMetadata` → `CharacterProfile` 的字段映射（sprite → spriteAsset / spriteType、atlas → atlasLayout、animations → 帧配置、reactions/sounds → bubbleMessages / 音效等）；
   - 在 `characterResourceLoader.ts` 或新 `lib/characterPack.ts` 提供 `parseCharacterPack()`：识别三种输入结构 → 统一输出 `CharacterProfile`（缺失字段走默认值 + 校验警告）；
   - 保留向后兼容：老格式照常解析（不破坏已有导入）。
2. 删除/归档：`CustomPetForm.tsx`（死代码，先确认无引用后移入回收站）；CharacterCreator 死 UI「自定义动画行」（L678-711）标注 TODO 或移除。
3. 单测：三种输入格式 → 统一 profile 的映射用例（≥6 例）。

### 阶段 P1-2：接线现有导入器 + 修 Rust 命令（1~1.5 天）

**目标**：D/E/F 三条未接线路径可用。

1. **注册 Rust 命令**（src-tauri）：在 lib.rs invoke_handler 注册 `scan_character_directory` / `read_text_file`（实现若在 commands 文件缺失则新建，返回 `Vec<String>` 文件列表 / 文本内容；注意路径校验防目录穿越，参考 AGENTS.md 安全章节）；`cargo check` + 对应 Rust 单测。
2. **接线 characterResourceImporter.importFromDirectory**：支持「资源包目录」（含 pet.json 清单 + sprite 资源）→ 解析（P1-1 的 parseCharacterPack）→ 校验（validateCharacterCard 或新 validateProfile）→ `saveCustomCharacter` 持久化 → 返回新宠物 id。
3. **接线 characterCardImporter**：
   - `importCharacterCard(json)` → profile → 持久化（补上缺失的落库，D 路径目前不持久化）；
   - `extractCharCardFromPNG(file)` → 同上；
   - 校验失败信息结构化返回（错误码/消息数组），供 UI 呈现。
4. 统一入口函数（新 `lib/characterImportService.ts` 或并入上述模块）：`importCharacter(source: File | Dir): Promise<ImportResult>`，ImportResult = `{ ok, characterId?, profile?, errors: string[], warnings: string[] }`——**所有 UI 都调这一个入口**，不再各写各的。
5. 单测：导入成功/校验失败/重复导入/空目录等（≥8 例）。

### 阶段 P1-3：导入向导 UI（1~1.5 天）

**目标**：设置页出现统一「导入角色」向导，拖入即用。

1. 在 SettingsWindow 角色页新增「导入角色」入口（或改造 CharacterCreator 的导入区）：
   - 支持拖拽/选择：`.json`（角色卡）、`.png`（嵌卡）、`.zip` / 目录（资源包）、帧序列目录（PNG 集）；
   - 前端识别文件类型 → 调 P1-2 的统一入口；
   - **导入中状态**（zip 解压、资源复制可能有耗时）+ **结果页**：成功 → 显示新宠物预览（头像/精灵）+ 「立即使用」按钮（调 `petStore.switchCharacter`）；失败 → 逐条显示 errors（红色）/ warnings（黄色，如「缺 walk 动画，将回退 idle」）；
   - 预览复用现有宠物渲染组件（SpriteRenderer）——新功能必须复用，禁止另写渲染。
2. 资源落盘方式：自定义角色资源目前走 public/ 或 localStorage？**核实后确定**（建议：small 资源（SVG/JSON）存 localStorage `spiritpal-custom-characters`（沿用 characters.ts:245），atlas/video 等大资源复制到 `app_data_dir/characters/<id>/` 并由 Rust 命令提供读取，避免 localStorage 爆容量——需要新增 1~2 个 Rust 命令：`copy_character_assets` / `read_character_asset`，同样做路径校验）。
3. 视频/图集素材自动带 `chromaKey: 'auto'`（视频型默认 auto，与内置 gugugaga 一致）；帧序列目录导入时用 `spriteSheetTool.generateSpriteSheet` 合成 atlas 并写 atlasLayout。
4. i18n：5 语言同步所有新文案 + `pnpm i18n:check`。
5. 组件测试：向导文件选择/错误展示/成功跳转（≥6 例，参考现有 CharacterCreator 测试写法）。

### 阶段 P2：素材管线对接（2 天，可独立交付）

**目标**：PSD / 黑幕视频素材在应用内完成加工。

> 依赖现实：asset-pipeline 是 Python 脚本，需要本机 Python + ffmpeg + psd-tools。桌面应用不应强制捆绑 Python，因此采用「检测 → 引导 → 调用」三步。

1. 新增 Rust 命令 `detect_asset_tools()`：检测本机 `python` / `ffmpeg` 是否在 PATH（`where python` / `where ffmpeg`），返回 `{ python: bool, ffmpeg: bool, versions }`。
2. 向导「从素材加工」入口：
   - 选择 PSD 或黑幕视频 → 前端调检测命令：
     - 工具齐全 → 调新 Rust 命令 `run_asset_pipeline(script, args)`（白名单仅允许 `scripts/asset-pipeline/` 下三个脚本，参数强校验，禁止任意命令执行——安全关键，参考 AGENTS.md §11）→ 进度事件（`spiritpal:asset-progress`）→ 产物（透明 webm / PNG 帧 + pet.json）→ 自动走 P1 的导入流程；
     - 缺工具 → 展示引导页：给出 `winget install ffmpeg` / `pip install psd-tools` 命令 + 「手动加工后导入目录」的替代路径（外部跑脚本 → 拖入产出目录，仍走 P1-3 的目录导入）。
3. 黑幕视频自动带 `chromaKey: 'auto'`；归一化参数（512×512 / 30fps 等）作为向导可选项，默认值对齐 README。
4. 安全单测：`run_asset_pipeline` 参数注入（`;`、`&&`、路径穿越）全部拒绝（Rust 侧，≥6 例）。

### 阶段 P3：打磨与收尾（1 天）

1. 清理：确认 `CustomPetForm` 删除后无引用；CharacterCreator 与向导的职责边界注释（或轻量合并入口，避免两个"导入"按钮并存）。
2. 全量回归：`corepack pnpm lint` / `corepack pnpm test`（基线 1866 passed）/ `cd src-tauri && cargo check --all-targets`。
3. 出包：`corepack pnpm tauri build` → artifacts 替换（旧版备份 `artifacts/backup-<日期>/`）。
4. AGENTS.md 自进化协议：新坑进 Gotcha、版本 +0.1、修订记录表追加。
5. 运行时验证：真实 exe 拖入一个 PSD（或目录）→ 生成宠物 → 切换 → 行走/喂食动画正常；视频宠物确认无黑底（色度键兜底生效）。

---

## 5. 验收标准（总）

1. 设置页可拖入 JSON 角色卡 / PNG 嵌卡 / 资源包 zip / 帧序列目录，三种素材类型都能生成可用新宠物并立即切换；
2. 无效输入（缺字段/格式错）有逐条中文错误提示，不产生半成品角色；
3. PSD / 黑幕视频经素材加工路径产出视频型宠物，Windows 上无黑底（chromaKey 兜底生效）；
4. 导入的角色重启后仍在（持久化验证）；
5. 无死代码残留（`grep CustomPetForm` 无命中），lint 0 error / vitest 全过 / cargo check 0；
6. 所有新文案 5 语言覆盖（`pnpm i18n:check` 通过）。

---

## 6. 风险与注意事项

| 风险 | 说明与对策 |
|------|-----------|
| Python/ffmpeg 依赖 | 不捆绑、不强制；缺工具时走「引导 + 手动加工后目录导入」降级路径（P2 步骤 2） |
| `run_asset_pipeline` 命令执行安全 | 脚本白名单 + 参数强校验 + Rust 单测防注入；命令默认关闭或需设置页显式开启（能力最小化） |
| 大资源持久化 | atlas/video 资源不建议塞 localStorage；用 `app_data_dir/characters/` + Rust 命令读写（新增命令必须加 capabilities scope） |
| 3 套格式迁移 | 统一解析层向后兼容，老格式不破坏；不要直接改已持久化的老数据 |
| 导入器「看起来支持实际坏」 | 本次必须把校验结果/持久化补齐，否则维持「尚未完善」提示也不展示假功能（用户偏好） |
| 与 Mod 系统（.petmod）并存 | 保留 ModPanel 的 C 路径，新向导聚焦「自制角色」；两套导入都汇聚到 `saveCustomCharacter` 持久化 |

---

## 7. 交付物规范（每阶段完成）

1. 全量回归通过（lint / vitest / cargo check）；
2. 功能性改动后出包并替换 `artifacts/`（含旧版备份）；
3. AGENTS.md 自进化协议更新（Gotcha 如有 + 修订记录 + 版本递增）；
4. Conventional Commits 分批提交，只 `git add` 具体文件；
5. 新 UI 文案 5 语言覆盖。
