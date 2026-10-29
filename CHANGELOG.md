# Changelog

本项目所有重要变更记录均在此文件中追踪。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

***

## [0.2.3] - 2026-10-29

> 本版为 v0.1.0（2026-09-10）之后的首个 minor 版本，`main` 累计约 700 个提交。
> v0.2.0 的 tag 在发布链 `Install pnpm` 步骤失败；v0.2.1 在 `tauri build` 因 Rust crate 与 npm 包 minor 版本不一致失败；v0.2.2 构建与资产上传成功、但收尾 `gh release upload` 缺 `--repo` 未转公开。三次均未产出公开版本，故以 v0.2.3 重发。
> 下方各分类先给面向用户的变更摘要，其后保留逐条细节（含内部工具/门禁类条目）。

### Added

- **Android 移动端从实验性走向可分发**：端侧 MNN LLM 内嵌（Rust 桥 + JNI）、云端与本地模型供应商可选、多会话聊天抽屉与跨会话搜索、消息发送状态机与消息级徽标、思维链折叠、记忆页新增「实体图谱 / 语义事实 / 上下文片段」子页、承诺到期提醒、番茄钟、数据管理面板（备份/恢复/删除/完整性检查/重置）、诊断导出、关键控件触控命中区 ≥48dp；移动端各页面 i18n 补齐（此前切语言对移动端界面无效）。
- **端侧图像（Qwen-Image-2.1）**：设备分档 + 模型完整性校验 + 设置页入口与最小可用生成界面；模型权重由用户自行获取，不随包分发（非商用许可限制见 `docs/COMPLIANCE_CHECKLIST.md` §8）。
- **桌面端体验**：深色模式首次真正生效（主题管理器接线）、设置页分组重构与设计令牌/UI Kit、性格编辑器雷达↔滑块联动、日程持久化升级到 SQLite 并支持 `.ics` 外部日历导入、更新链路每步可见（托盘/设置页入口 + 完整状态机）、崩溃自动重启（60s 冷却 + 上限 3 次）。
- **角色与合规**：角色包导入向导（桌面 + 移动端单文件入口）、社区角色包工具；应用内首启协议门 + 法务文本同步 + 角色/Live2D 授权材料；用户反馈渠道（设置页入口 + GitHub issue 模板）。
- `scripts/spec_audit_local.py` —— **仓内 spec-reference 审计器**（2026-10-14），仅依赖 Python 标准库，输出与仓外家族审计器同形的 JSON 报告，因此 `scripts/check_spec_refs.py` 在干净 CI 检出里也能真正执行。两层判据：① **调用层**——被门禁实际执行的脚本路径（`.github/workflows/*.yml` 的 `run:`、`package.json` scripts、`.pre-commit-config.yaml` 的 `repo: local` `entry:`、`.githooks/*`）必须存在；② **治理文档层**——入口文档与治理 README（`AGENTS.md`（若在）/ `README.md` / `.github/SECURITY.md` / `.github/PULL_REQUEST_TEMPLATE.md` / `.githooks/README.md`）内联代码里的仓内路径与相对 Markdown 链接必须解得开。保守护栏：只判版本化顶层前缀、跳过围栏代码块与 `（计划，未实现）` 行、剔除被 `.gitignore` 命中的路径（历史叙述文档不在仓内硬门禁范围内，仍由家族审计器覆盖）。配套 `scripts/__tests__/spec-audit-local.test.mjs`（6 用例，随 `pnpm test`）做**门禁自证**：正向（真实仓 rc=0 且判定读数超下限）+ 负向（注入缺失脚本 / 幽灵文档路径 → rc=1 且点名），防止审计器被改哑后变成新的装饰性门禁。

- `scripts/check_android_proguard_keeps.py` —— Android release 的 **R8 keep 规则静态守卫**，并接入 CI 必需检查（`.github/workflows/structure-guard.yml` 的 `layout` job）。release 开 `minifyEnabled` 后 R8 会**静默**删掉「Kotlin/Java 侧无调用者、只能被 Rust 侧经 JNI 反射调用」的方法（编译期零告警、真机启动才 `NoSuchMethodError`，已踩 3 次）。守卫校验三件事：① `app/proguard-rules.pro` 是否覆盖全部 26 项「仅 JNI 可达」方法（ProGuard 语义感知：`native <methods>` 只算覆盖 native 方法、`pkg.*` 不跨包）；② `app/build.gradle` 的 release `proguardFiles` 是否仍引用该规则文件；③ `Cargo.lock` 里 `wry`/`tauri` 是否仍是已审计版本（依赖升级会改变 JNI 面，升级即报红要求重新审计）。纯静态、秒级、无需 Android 工具链。DEX 级证明仍需 `scripts/verify_android_jni_keeps.py`（需 APK，release 包出完必跑，SOP-4）。

- `install.bat` — Windows 一键安装脚本（自动检查 Node.js / pnpm / Rust）

- `start.bat` — Windows 一键启动开发环境脚本

- `scripts/build-release.bat` — 一键构建安装包脚本

- `scripts/run-all-tests.bat` — 一键运行全部测试脚本（lint + vitest + e2e + cargo test）

- `scripts/generate-icons.bat` — 应用图标重新生成脚本

- `.env.example` — 环境变量模板

- `docs/plans/DEPLOYMENT.md` — 部署与发布文档

- `src-tauri/tests/` — Rust 集成测试目录

  - `crypto.rs` — AES-256-GCM 加密/解密、密钥派生、SHA-256 哈希测试

  - `validation.rs` — 输入校验（命令注入防护、路径遍历防护）测试

  - `encrypted_db.rs` — 数据库加密 Base64 往返测试

### Changed

- **数据与记忆层**：记忆改为 SQLite 行级存储（取代整块 blob，附带语义事实/摘要/状态表与一次性迁移）、检索打分真实化 + RRF 归一化 + 时间线索引与时间范围过滤、`chatStore` 持久化切 SQLite（`settingsStore` 保持加密例外）。
- **界面一致性**：设计令牌统一（颜色/徽章/状态色全面令牌化）、移动端 emoji 图标改为单色线性 lucide、桌面端面板状态色令牌化；记忆列表控件去重为单一视图选择器。
- **内置角色收敛**：移除 `feibi` / `gugugaga` 资源与对应配置（改为 `character-packs/` 模板 + 用户自备素材）。
- **依赖与工程链**：依赖批量升级并持续清零漏洞（含 Tauri 生态、Vite、Vitest 4 迁移）；前端 `src/lib` 六群分层 + 依赖环拆除；Rust `lib.rs` 巨石拆分（1993 → ~900 行）；`.githooks` 随仓库分发（DCO 自动签名/校验）。
- **发布链完整性**：新增 `docs/release-governance.md` 本仓发布/回滚规范、移除已裁决撤掉的 GPG 签名 workflow、`publish-updates` 挂载 `SHA256SUMS.txt`、把 `updates.json` 的生成与内容校验前置到「draft 转公开」之前，失败即退回 draft。
- `crypto.rs` 新增内联单元测试模块（加密解密往返、数据损坏检测、密钥派生一致性）
- 依赖批量升级（2026-09-11，dependabot #30-38）：Playwright 1.62.1→1.63.0（#30/#32）、@testing-library/react 16.3.3（#31）、@tauri-apps/plugin-updater 2.10.1→2.11.0（#33，含 Rust crate 对齐）、GitHub Actions（#34 osv-scanner 2.5.1 / #35 codecov 7 / #36 download-artifact 8 / #37 action-gh-release 3 / #38 setup-python 7）
- N 卡性能实测记录（2026-09-11，RTX 5070）：冷启动 1071ms / 内存 51.0MB / Live2D FPS 59.4 / 模型切换 301ms（模拟值）——均达 PRD v0.2 门槛；基线无回归
- 干净机器验收（2026-09-11，命令行部分）：安装→启动（48.8MB/10s 稳定）→卸载无残留全通过；更新链路签名校验通过（minisign）

***

### Fixed

- **发布链收尾 `Generate SHA256SUMS.txt` 步骤失败**——`gh release upload` 在 `cd /tmp` 后无 git 上下文可推断仓库，报 `not a git repository`；补显式 `--repo`。v0.2.2 的 Release 因此停在 draft。
- **包大小门禁对 AppImage 必红**——PRD §10 的 <30MB 口径指安装包（NSIS/DEB 实测 6.8/10.8MB 通过），AppImage 为自带运行时的免安装格式（实测 87.4MB）；改按 120MB 独立阈值回归监控，基线趋势闸在 CI 加 `--allow-partial`（GPU 三项指标已按 T-08 移出 CI，本地人工验证）。
- **Tauri Rust crate 与 npm 包版本不一致导致 `tauri build` 拒绝构建**——`Cargo.toml` 的宽松 `"2"` 使 lock 停在旧 minor（tauri 2.11.5 / 各插件 2.3~2.5），而 npm 已到 2.12/2.4~2.8。现将 Rust 侧对齐到 npm 所在 minor（tauri 2.12.5、autostart 2.7.0、store 2.5.0、process 2.4.0、fs 2.7.1、notification 2.5.1、dialog 2.8.4、deep-link 2.6.3、global-shortcut 2.4.1、updater 2.13.3），npm `@tauri-apps/plugin-fs` 同步升至 2.7.1。
- **发布链在 `Install pnpm` 即失败**——`release.yml` 两处 `pnpm/action-setup` 仍传 `version: 11`，与 `package.json` 的 `packageManager: pnpm@11.26.0` 双源冲突；改为不传 `version`、由 `packageManager` 驱动（与 `ci.yml` 同口径）。
- **应用内「检查更新」在宠物/聊天窗口报 `not allowed by ACL`**（v0.1.0 用户在主窗口必触发）——capability 补齐 updater/process/store 授权。
- **Android release 包真机启动即崩**——R8 删除「仅 JNI 可达」方法导致 `NoSuchMethodError`；补齐 keep 规则并新增静态 + DEX 级双守卫。
- **记忆与数据落盘类缺陷**：全新安装启用行级存储（修「对话写进了表、记忆列表恒为 0」）、移动端宠物互动/聊天补记忆旁路、`get_machine_id` 补移动端分支、二次启动 `.enc` 无法解密。
- **移动端真机缺陷**：键盘遮挡聊天输入栏、退出 SIGABRT、用户中止后静默标成功、宠物透明度/装饰品不生效、同步配置不持久化。
- **大文件下载缺陷**：>2GiB 校验必败 + 206 续传错位 + `bytesWritten` 未处理（静默损坏）。
- **行为缺陷**：情绪标签正则误吞 Markdown 链接正文、日程自动提取误建「幽灵日程」、`ChatWindow.mkMsg()` 仍用 `Math.random()` 生成消息 ID。
- **`open_application` 的 URL scheme 白名单可被无 `://` 协议绕过（GAP-R01，2026-10-25，复查「Rust 侧防线完整」结论时发现）**：`validate_app_name` 的 scheme 校验条件是 `contains("://")`——`file:C:/Windows/System32/calc.exe`、`vbscript:...` 等**不含 `://` 的协议**不触发校验，直达 `open::that`（Windows 上走 ShellExecute，可打开/执行任意目标）；既有测试 `test_validate_app_name_ms_settings` 的注释（"ms-settings: 不包含 :// 所以不做 URL scheme 校验"）恰好记录了这个口子。可达性：Agent 正常链路不可达（TS zod `SAFE_APP_NAME_PATTERN` 拒绝 `:` 与 `/`），缺口在 **webview 失陷后直接 invoke** 的路径上——彼时 Rust 校验是最后一道防线。修法：校验条件收紧为 `contains(':')`，白名单补 `ms-settings:`（`APP_NAME_MAP`「设置」项的合法协议，原本恰是借该口子放行）；本地绝对路径（`C:/app.exe`）随之被拒（fail-closed 取舍，`open_application` 语义为「按名打开应用」）。回归：`validation.rs` 新增 4 个收口测试（file:/脚本协议/绝对路径拒绝、ms-settings 大小写放行），`cargo test --lib validation` 25/25 通过。**CI 追修（同日）**：首推后 CI `Run cargo test with coverage` 转红——集成测试 `tests/test_validation.rs::test_valid_protocol_uris` 仍断言 `mailto:` 应通过（旧 `contains("://")` 契约下不做 scheme 校验），与新契约冲突；已更新该断言为 `is_err()` 并注释 GAP-R01 取舍（mailto: 非产品在用协议，TS zod 层本就拒绝 `:`/`@`）。教训留痕：本地只跑了 `cargo test --lib`，漏了 `tests/` 集成套件——修复后已按全量 `cargo test`（lib 350 + crypto 36 + encrypted_db 8 + system_runtime 5 + validation 11）验证再推。
- **AI 聊天提示词注入面集中加固（2026-10-25）**：五项缺口同批收口。① **单轮 Agent 路径缺工具模式权限校验（P0）**——`processAgentRequest` 此前只查 `AGENT_TOOLS` 注册表（全部 12 个工具），LLM 被越狱后返回 `read_file`（确认豁免名单内）即可在 agent 模式下越级执行 developer 权限工具且无需确认（ReAct 路径有 `isToolAllowed` 校验、单轮路径缺失）；现单轮路径补上 `isToolAvailableInMode` 强制（新增可选 `toolMode` 参数，默认 `'agent'`，与 ReAct 同口径），不变式钉进 `prompt.eval.test.ts` A 组。② **持久化上下文记忆投毒（P0）**——历史记忆/用户画像/共同经历/约定/视觉记忆/截断衔接摘要以 system 角色回灌给模型，其中沉淀的注入指令会跨会话存活；`inputInjectionScreen` 扩展 `scanContextForInjection`（注入前初筛告警，不阻断不篡改）+ `wrapSystemContext`/`CONTEXT_GUARD_NOTE`（统一可信边界声明包裹），ChatWindow 五段注入与 aiAgent 记忆拼接全部收口；另在 `promptRegistry` 新增版本化 `security.boundary`（v1）全局安全边界条款，拼接到主聊天与重新生成两条路径的 System Prompt 末尾（模型侧兜底，与逐块包裹互补）。③ **情绪标签正则误吞正文**——`extractEmotion`/`removeEmotionTags` 对任意 `[a-zA-Z_]+` 方括号文本一律清除，Markdown 链接 `[README](url)` 被剥成 `(url)`；收窄为「裸 `[word]` 仅命中 `EMOTION_MAP` 已知关键词才剥离，带 `emotion:`/`motion:` 显式前缀一律剥离」，回归钉进新增 `emotionTagStripping.test.ts`。④ **日程自动提取误建幽灵日程**——`parseScheduleFromText` 是纯时间解析（"明天"/"X分钟后"即命中）而聊天主流程对每条消息调用 `addFromChat`，"明天再说吧"也会被建成日程；`addFromChat` 新增 `requireIntent` 门槛（默认 true，需同时命中时间表达与 `hasReminderIntent()` 意图关键词），`set_reminder` 显式工具路径传 `requireIntent:false` 保持原能力，回归钉进新增 `scheduleIntent.test.ts`。⑤ **提示漂移门禁覆盖缺口**——`promptManifest` 此前只纳管 lib/ 六域，`usePetMemoryTriggers` / `usePetTimers` / `qualityMonitor` 里的 5 条 LLM 提示不受版本台账管；同日把 `usePetTimers` 两处重复的整理提示字面量收敛为 `MEMORY_ORGANIZE_PROMPT` 常量（锚点可唯一登记），5 条提示 + 3 个文件基线全部登记（hooks 域首次纳管）。新增评测：`prompt.eval.test.ts` D 组（上下文守卫）+ A 组模式边界不变式；`inputInjectionScreen.test.ts` 上下文守卫三用例。**复查追加（同日，"排除项"对抗性复查结论落地）**：⑥ **导入内容 systemPrompt 检测层**——角色卡/角色包/`.petmod` 模组是不可信第三方内容，其 systemPrompt 会进入主聊天 system 位置（恶意模组可借人格设定夹带指令）；`inputInjectionScreen` 新增 `scanImportedPrompt`（告警 + 返回 hits），`characterImportService` 三条导入路径（SillyTavern 卡 / 目录 / pet.json）命中并入用户可见 `warnings`，`modManager.toCharacterProfile` 转换点按 mod id 去重告警；不阻断导入（用户显式动作，运行时已有 `security.boundary` 拼接在 character.systemPrompt 之后兜底），回归钉进 `inputInjectionScreen.test.ts` 导入检测三用例。⑦ **`LegalDocument` 补显式 sanitize（防御纵深）**——此前仅靠 react-markdown 默认安全模型（无 rehype-raw 不渲染原始 HTML + defaultUrlTransform 清危险协议）与构建期静态内容兜底；现与 ChatWindow/MobileChatView 同口径挂 `rehypeSanitize`，防未来内容来源变化（如远程法务文本）时静默失去防线。**同环境事项**：本地 `dist/` 过期导致 `integrity::embedded_assets_match_sri_manifest` 报"内嵌资源缺失"（gitignored 构建产物落后于入库清单），已按 `tsc -b && vite build && obfuscate-and-sri.mjs` 全链路重建并重生成 `sri_hashes.rs`（35 个产物自校验一致，integrity 3/3 通过）。`open_path` 经审计维持现状：`Command::new("explorer").arg()` 为 argv 直传（无 shell 解释面）、唯一调用方传内部生成的应用数据目录、无执行语义。
- **spec-refs 门禁在 CI 里「未执行也算绿」（fail-open 收尾，2026-10-14）**：`structure-guard.yml` 与 `docs-consistency.yml` 均以 `python scripts/check_spec_refs.py --allow-unavailable` 调用，而家族审计器位于**仓库外**（6 个家族仓库共用），干净 CI 检出必然搜不到 → 该步骤永远只报 `status=UNAVAILABLE` + `::warning::` 后退出 0，**一条路径都没判过**（2026-09-18 的三态退出码只把「静默报绿」改成「诚实的零判定」，没有改变零判定本身）。修法：包装脚本新增仓内回落（见 Added 项）后，两个 workflow **去掉 `--allow-unavailable`**，状态行加 `auditor=family|repo-local` 明说本次跑了哪套，`--family-only` 保留复现旧态的能力，退出码 `2` 收紧为「两套审计器都不存在」。**取舍**：不收归家族审计器（会 fork 家族逻辑），也不造 mock 报告（mock 只会把「审计器说什么」换成「写 mock 的人说什么」）。**验收**（`git worktree` 模拟干净检出：无 `AGENTS.md` / 无仓外审计器 / 无 gitignore 产物）：旧写法 rc=0 但判定读数 0；新写法 rc=1 并点名幽灵引用（判定读数 73）；注入 `run: python scripts/does-not-exist.py` → rc=1 点名缺失脚本；修复后 rc=0。
- **`.github/SECURITY.md` 魔数校验一节的前端接线路径为幽灵引用（上述门禁首次运行拦下，2026-10-14）**：写作 `src/lib/uploadMagic.ts`，实际位于 `src/lib/system/uploadMagic.ts`（`git grep` 核实各调用方），已按铁律「证据绑定」修正。

- **传递依赖 `ip-address` 落到漏洞版本（Dependabot 告警 #15 / GHSA-2vr4-cq9g-pvrc / CVE-2026-101910，2026-09-29 修复）**：`ip-address` 的分类器不识别 NAT64 本地用段 `64:ff9b:1::/48`，可用于绕 SSRF / 信任边界判定。引入链为纯传递依赖 `@modelcontextprotocol/sdk → express-rate-limit → ip-address@10.4.0`，落在漏洞区间 `>=10.2.0 <=10.5.0`；父包声明的是 `^10.2.0`，**本就允许修复版**，所以根因是锁文件解析陈旧而非范围受限。修法沿用本仓既有惯例（`pnpm-workspace.yaml` 的 `overrides` 已用于 hono/qs/js-yaml/fast-uri/semver 等历次收口），加下界 `ip-address: ">=10.5.1"` → 解析到 10.7.2；同包其余 5 条公告的漏洞上限均为 `<=10.5.0`，故一条下界一并清零。**未选** `pnpm update ip-address`：实测它会连带重解析 `@types/node` 的可选 peer（22.20.1 → 26.6.1），安全修复不该夹带面外漂移。可达性评估：本仓只 import SDK 的 `mcp.js`/`stdio.js`/`sse.js` 与 client 侧，均不引用该依赖（仅 SDK 的 OAuth auth handler 使用，而应用走 stdio 传输），运行时不加载漏洞路径——但仍真修而非豁免。锁与配置必须同提交，否则 `pnpm install --frozen-lockfile` 报 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`。
- **发布前预检的 SRI 项在开发态必然报红、且不带解释（易被误读为完整性事故，2026-09-30 修复）**：`scripts/pre-release-check.mjs` 第 7 项直接跑 `obfuscate-and-sri.mjs --verify`，而清单 `src-tauri/src/generated/sri_hashes.rs` 是**生成物**（默认模式脚本会先就地混淆 `dist/assets/*.js` 再按混淆后字节算哈希），且 SOP-3 把总预检排在「构建 + 混淆」之前 —— 于是本地会拿到一串无解释的哈希差异。**发版链路本身不受影响**（此前有一版误判称"发版会红"，已证伪）：`tauri.conf.json` 的 `beforeBuildCommand` 已含该生成步骤，CI 的 build job 与 `release.yml` 都是先跑 `tauri-action` 再 `--verify`，比对同一次构建的产物，故按构造自洽（实测链后 `--verify` rc=0、36 个产物逐条一致）。同时排除一个看起来合理的错修法：把清单重生成到与 HEAD 一致后，再跑不含混淆的 `pnpm build` → 仍 30 项不一致，说明"刷新入库清单"对开发态门禁毫无收益。修法按该脚本自己已有的惯用语（第 3/6 项的「本地无 release 构建产物（先跑 pnpm tauri build）」）：先判 `dist/assets` 是否存在，不一致时报出数量并点名前置命令序列与不受影响的说明。**门禁判定语义未削弱**——不一致仍判失败、仍 exit 1。
- **`ChatWindow.mkMsg()` 的消息 ID 从 `Math.random()` 改为 CSPRNG（CodeQL "Insecure randomness" 收口）**：PR #58 时只修了 `chatStore.genId()`，`src/components/ChatWindow.tsx` 的 `mkMsg()` 仍在用 `Math.random().toString(36).slice(2, 9)` 生成消息 ID（当轮 CodeQL 未告警，属漏网）。本次把随机 ID 实现抽成独立模块 `src/lib/system/randomId.ts`（`genId()`：`<毫秒时间戳>-<12 位 hex>`，48 bit 熵），`chatStore` 与 `ChatWindow` 共用一份，避免两处各写一份再漂移；并补单测 `src/lib/system/__tests__/randomId.test.ts`（格式 / 时间戳前缀 / 同毫秒 1000 个不重复 / **断言走 `crypto.getRandomValues` 且不调 `Math.random`** 防回归）。注意实现位置：**不能**从 `chatStore` 导出给 `ChatWindow` 复用——组件测试用 `vi.mock('@/stores/chatStore', ...)` 整体替换模块，额外导出会让被测组件拿到 `undefined`（且只在 stderr 报错，测试仍显示全绿）。
- **Android release 包真机启动即崩：R8 把「仅 JNI 可达」的方法当 unused 删掉（2026-09-18 修复）**：release 开启 `minifyEnabled=true` 后，R8 会删除「只能被 Rust 侧经 JNI 反射调用、Kotlin/Java 侧没有任何调用者」的方法，**编译期无任何告警**，真机启动瞬间抛 `java.lang.NoSuchMethodError` + SIGABRT。共修 3 处：① `WryActivity.getId()` 等 wry keep 集合（wry 自带的 `proguard-wry.pro` 从未接入本构建）；② `TauriActivity.getPluginManager()`（`app/build.gradle` 的 release `proguardFiles` 引用了 tauri CLI 自动生成的 `proguard-tauri.pro`，而该文件在本仓缺失——Gradle 对缺失的 proguard 文件**不报错也不警告**，静默少应用一份规则；该文件被 `gen/android/app/.gitignore` 忽略，故同一份 keep 规则同时写入被跟踪的 `app/proguard-rules.pro` 防复发）；③ `RustWebView.clearAllBrowsingData()` / `getCookies(String)`（wry 官方规则自身漏列，实测在 release DEX 中确已被删除，属定时炸弹）。同时新增门禁 `scripts/verify_android_jni_keeps.py`：抽 release APK 的 `classes*.dex`、按 `Class descriptor` 边界核对 **26 项 JNI 方法**是否保留，rc=0 才算过（release 包出完必跑）。验证：`assembleArm64Release` BUILD SUCCESSFUL；校验脚本 26/26 OK（对修复前的包报 15 项缺失）；真机（Realme RMX5010 / Android 16）安装启动后 `pidof` 存活、`logcat -b crash` 为空、截图见宠物主界面（状态面板 + 底部导航齐全）。
- **检查更新在宠物/聊天窗口报 not allowed by ACL（2026-09-11 第五轮修复）**：UpdateNotification 挂在全部桌面窗口，但 updater/process 权限只授给 settings-window，主窗口 30s 自动检查必弹「更新失败：Command plugin:updater|check not allowed by ACL」（v0.1.0 受影响）；default.json(pet/main)/chat-window.json 补 updater:default、allow-check、allow-download-and-install、process:allow-restart；default.json 另补 store:allow-load/get/set（消除 windowPositionMemory 降级告警）。修复后真机 GUI 实测设置→关于→检查更新「正在检查更新」→「已是最新版本」正常。
- **CI 前端门禁转红（vitest 4 覆盖率口径变化）**：`cc0885a` 将 vitest 3.2.7 → 4.1.11（安全修复，无 3.x 修复版）后，vitest 4 的 v8 provider 改为 AST 感知重映射，同一份代码实测覆盖率由 lines 50.6/funcs 66.8/branches 78.8 降到 46.68/43/38.66，跌破 48/60/50/48 阈值。判据：转红区间（`cb0c3498`→`969f786`）内 **src/ 生产代码零改动**、163 个测试文件全通过 → 属度量口径变化而非质量退化。按新口径重校准阈值（lines 46 / functions 42 / branches 38 / statements 45，留 ~0.5pp 余量）并同步 `docs/agents/QUALITY_CONTRACT.md`。

- **CI 前端矩阵移除 Node 20**：仓库使用 pnpm 11（lockfile 与 `pnpm/action-setup` 均锁 11），pnpm 11 要求 Node >= 22.13，Node 20 上直接报 `This version of pnpm requires at least Node.js v22.13` 并退出 —— 该矩阵项结构性不可能通过（Node 20 亦已 EOL）；矩阵改为 `[22]`。

### Security

- **AI 提示词注入面集中加固**（细节见 Fixed 段 2026-10-25 条目）：单轮 Agent 路径补工具模式权限校验、持久化上下文注入可信边界包裹 + 版本化 `security.boundary` 全局安全条款、导入的角色卡/角色包/`.petmod` systemPrompt 增加检测告警、`LegalDocument` 补显式 `rehypeSanitize`。
- **`open_application` scheme 白名单收紧（GAP-R01）**：无 `://` 协议（`file:` / `vbscript:` 等）此前绕过校验，现按 `contains(':')` fail-closed，白名单仅保留 `ms-settings:`。
- **本地凭据与存储**：`settingsStore` 改为 AES-256-GCM 加密持久化、PBKDF2 随机 salt、审计日志哈希链、SRI 运行时校验；Sentry 改为真实 SDK 动态加载并修复静默 catch。
- **导入面与供应链**：上传魔数校验接入 4 条文件导入路径、密钥扫描门禁强制化、CodeQL 覆盖 Rust + Dependabot + SBOM + CSP 收紧、依赖审计棘轮基线门禁。
- **依赖漏洞清零**：`ip-address`（GHSA-2vr4-cq9g-pvrc / CVE-2026-101910，见 Fixed 段）、11 条 npm 公告（brace-expansion 三版本线 + fast-uri 底座）、MCP SDK → 1.32.1 与 sharp → 0.35.5 清零剩余 high、vitest 4.1.12 消除 `@vitest/mocker` 公告、`zip` 0.6.6 → 9.0.4（RustSec 基线 7 → 4）；RustSec 上游无补丁且本仓不可达的公告登记为显式基线。

## [0.1.0] - 2026-09-10

### Added — 项目初始发布

#### 核心功能

- 跨平台 AI 桌面宠物应用（Tauri v2 + React 19 + TypeScript + Rust）
  核心理念："简单却温暖" — 情感陪伴、轻量交互、温和生产力辅助

- 三窗口架构：宠物窗口（300×400）、设置窗口（720×540）、聊天窗口（420×600）

- 全部窗口无边框、透明、可拖拽、可缩放，关闭时隐藏到系统托盘

#### 宠物系统

- Live2D 模型渲染（Pixi.js 7 + pixi-live2d-display）

- 多角色支持（角色配置、动画系统、对话管理）

- 宠物行为状态机（行为引擎、定时器、传感器上下文感知）

- 宠物行走动画、拖拽交互、光标注视效果

- 气泡对话系统与主动交互

#### AI 与记忆系统

- 多 Provider LLM 集成（OpenAI / Anthropic / Google / 本地模型）

- MCP 协议服务器（@modelcontextprotocol/sdk）

- 增强记忆系统 — AES-256-GCM 加密存储 + 语义向量搜索

- 本地嵌入模型（@xenova/transformers）

- 记忆触发器（纪念日、节日）

#### 游戏化系统

- 养成系统（商店管理、Buff 管理、任务管理）

- Mod 系统（.petmod 包导入、Shimeji 加载器）

#### 安全加固

- AES-256-GCM + PBKDF2 密钥派生（100,000 次迭代）

- SQLite 数据库文件级加密（运行时明文、关闭后加密）

- API Key 系统钥匙链存储（Windows Credential Manager / macOS Keychain）

- 代码混淆 + SRI 完整性校验

- 输入校验（命令注入防护、路径遍历防护）

- 反调试检测

#### 系统集成

- 系统托盘管理（菜单、图标切换）

- Win32 API：鼠标穿透、系统空闲检测、前台窗口信息

- 全局热键（Ctrl+Shift+P）

- 单实例插件（防止多开）

- 全局键鼠监听（宠物注视光标效果）

- 系统空闲检测

#### 移动端

- 移动端适配视图（MobilePetView / MobileChatView / MobileNurturingView / MobileSettingsView）

#### 测试体系

- Vitest 单元测试（组件 + 库函数 + 状态管理三层全覆盖）

- Playwright E2E 测试（12 个 spec 文件，涵盖多窗口、聊天、设置、养成等场景）

- 性能测试脚本（冷启动、内存、FPS、泄漏、压力、渗透、基线趋势、包体积）

- Rust 单元测试（32 个核心逻辑测试）

#### 国际化

- i18next + react-i18next 集成

#### CI/CD

- CI 工作流：TypeScript 类型检查 + Vitest 覆盖率 + Rust 测试 + Clippy + Fmt + 三平台构建

- CodeQL 安全扫描工作流

- 自动发布工作流（tag 触发，三平台构建 → GitHub Release）

#### 开发工具

- AGENTS.md — AI 辅助开发规范

- 辅助脚本：WindowPet 资源转换器、代码混淆 + SRI 生成

- ESLint + Prettier + TypeScript 严格模式
