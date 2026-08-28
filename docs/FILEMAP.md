# FILEMAP.md — SpiritPal 文件结构清单

> 本文件由 `scripts/update_docs.py` 维护末尾 AUTO-SYNC 标记；
> 目录结构描述以实际仓库树为准（自动生成，噪声/构建/资产大文件已过滤）。

## 顶层

| 类型 | 条目 |
|---|---|
| 目录 | `android-sdk/` |
| 目录 | `artifacts/` |
| 目录 | `demo/` |
| 目录 | `dist/` |
| 目录 | `docs/` |
| 目录 | `e2e/` |
| 目录 | `perf/` |
| 目录 | `playwright-report/` |
| 目录 | `public/` |
| 目录 | `scripts/` |
| 目录 | `src/` |
| 目录 | `src-tauri/` |
| 目录 | `test-results/` |
| 目录 | `tests/` |
| 文件 | `AGENTS.md` |
| 文件 | `CHANGELOG.md` |
| 文件 | `PRIVACY_POLICY.md` |
| 文件 | `README.md` |
| 文件 | `SECURITY.md` |
| 文件 | `eslint.config.js` |
| 文件 | `index.html` |
| 文件 | `install.bat` |
| 文件 | `package.json` |
| 文件 | `playwright.config.ts` |
| 文件 | `playwright.tauri.config.ts` |
| 文件 | `pnpm-lock.yaml` |
| 文件 | `pnpm-workspace.yaml` |
| 文件 | `start.bat` |
| 文件 | `stryker.config.json` |
| 文件 | `tsconfig.json` |
| 文件 | `tsconfig.node.json` |
| 文件 | `tsconfig.tsbuildinfo` |
| 文件 | `vite.config.ts` |
| 文件 | `vitest.config.ts` |
| 文件 | `剩余任务交接报告.md` |
| 文件 | `学习成果落地分析报告.md` |

## `android-sdk/`

子目录：`build-tools`、`cmdline-tools`、`licenses`、`ndk`、`platform-tools`、`platforms`

## `android-sdk\build-tools/`

子目录：`35.0.0`、`36.0.0`

## `android-sdk\build-tools\35.0.0/`

子目录：`lib`、`lib64`、`lld-bin`、`renderscript`

- `NOTICE.txt`
- `apksigner.bat`
- `d8.bat`
- `package.xml`
- `runtime.properties`
- `source.properties`

## `android-sdk\build-tools\36.0.0/`

子目录：`lib`、`lib64`、`lld-bin`、`renderscript`

- `NOTICE.txt`
- `apksigner.bat`
- `d8.bat`
- `package.xml`
- `runtime.properties`
- `source.properties`

## `android-sdk\cmdline-tools/`

子目录：`latest`

## `android-sdk\cmdline-tools\latest/`

子目录：`bin`、`lib`

- `NOTICE.txt`
- `source.properties`

## `android-sdk\licenses/`

- `android-googletv-license`
- `android-sdk-license`
- `android-sdk-preview-license`
- `google-gdk-license`
- `intel-android-extra-license`

## `android-sdk\ndk/`

子目录：`27.0.12077973`

## `android-sdk\ndk\27.0.12077973/`

子目录：`build`、`meta`、`prebuilt`、`python-packages`、`shader-tools`、`simpleperf`、`sources`、`toolchains`、`wrap.sh`

- `CHANGELOG.md`
- `NOTICE`
- `NOTICE.toolchain`
- `README.md`
- `ndk-build.cmd`
- `ndk-gdb.cmd`
- `ndk-lldb.cmd`
- `ndk-stack.cmd`
- `ndk-which.cmd`
- `package.xml`
- `source.properties`

## `android-sdk\platform-tools/`

- `NOTICE.txt`
- `mke2fs.conf`
- `package.xml`
- `source.properties`

## `android-sdk\platforms/`

子目录：`android-36`

## `android-sdk\platforms\android-36/`

子目录：`data`、`optional`、`skins`、`templates`

- `build.prop`
- `framework.aidl`
- `package.xml`
- `sdk.properties`
- `source.properties`

## `artifacts/`

子目录：`android`

## `artifacts\android/`

## `demo/`

子目录：`assets`

- `spiritpal_preview.html`
- `spiritpal_proposal.html`

## `demo\assets/`

子目录：`doro`、`feibi`、`gugu`

## `demo\assets\doro/`

## `demo\assets\feibi/`

## `demo\assets\gugu/`

## `dist/`

子目录：`assets`、`characters`、`pets`

- `index.html`
- `live2dcubismcore.js`

## `dist\assets/`

- `App-Db00t8rm.js`
- `ChatWindow-C0vXcM4y.js`
- `MobileApp-DUIn6ysR.js`
- `PersonalityEditor-BfS2W3il.js`
- `SettingsWindow-B-OisrW-.js`
- `WindowControls-DTz5bLcA.js`
- `chatStore-C7jHnoN_.js`
- `contextAwareness-CrwuxNSC.js`
- `enhancedMemory-CTrlzvVh.js`
- `index-ByY2LG2Y.css`
- `index-CC-Y49-b.js`
- `mcpAppBridge-Bi-g-jPp.js`
- `mcpPermissions-DGxVof6X.js`
- `memoryBackground-BYjG9ZiY.js`
- `ownerFacts-BVT-oDN8.js`
- `pushNotificationManager-DENEoee2.js`
- `secureStorage-4AC0xM3b.js`
- `types-BVTBwV9C.js`
- `vectorWorker-CACP4QYD.js`
- `vendor-i18n-BFIpCDRt.js`
- `vendor-live2d-Bb_HplUO.js`
- `vendor-pixi-CXOpwj-p.js`
- `vendor-react-C5-h3bRg.js`
- `vendor-tauri-BrlgtntN.js`
- `vendor-ui-BE2zl6X7.js`
- `visualMemoryManager-i_w2LRx8.js`
- `webdavClient-DTZDwG9n.js`
- `windowManager-DalIrPpT.js`
- `windowPositionMemory-CMUklNve.js`

## `dist\characters/`

子目录：`doro`、`feibi`、`gugugaga`

## `dist\characters\doro/`

- `pet_conf.json`

## `dist\characters\feibi/`

- `pet_conf.json`

## `dist\characters\gugugaga/`

- `pet_conf.json`

## `dist\pets/`

子目录：`doro`、`feibi`、`gugugaga`、`laocha`

## `dist\pets\doro/`

## `dist\pets\feibi/`

## `dist\pets\gugugaga/`

- `angry.webm`
- `dance.webm`
- `eat.webm`
- `farewell.webm`
- `grasp.webm`
- `headpat.webm`
- `hungry.webm`
- `idle.webm`
- `milktea.webm`
- `music.webm`
- `peek.webm`
- `question.webm`
- `rest.webm`
- `spin.webm`
- `study.webm`
- `walk.webm`
- `walkout.webm`
- `watch.webm`
- `work.webm`

## `dist\pets\laocha/`

## `docs/`

子目录：`adr`、`analysis`、`android-check`、`gh-research`、`plans`、`project`、`repo-analysis`、`repo_research`、`reports`

- `COMPLIANCE_CHECKLIST.md`
- `LIVE2D_LICENSE_REMINDER.md`
- `README.md`
- `RELEASE_NOTES.md`
- `SECURITY.md`
- `spiritpal-animation-tech-selection.html`
- `spiritpal-animation-tech-selection.md`
- `整理记录_20260823.md`

## `docs\adr/`

- `0001-tauri-v2-capabilities.md`
- `0002-upload-magic-check.md`
- `README.md`

## `docs\analysis/`

- `Final_Implementation_Report.md`
- `Reusable_Best_Practices.md`

## `docs\android-check/`

- `verify_tokens.py`

## `docs\gh-research/`

子目录：`pages`

- `fetch_repo.py`
- `memos2.html`

## `docs\gh-research\pages/`

- `MemTensor_MemOS.html`
- `agentscope-ai_agentscope.html`
- `facebookresearch_NeuralMemory.html`
- `facebookresearch_SaliMory.html`
- `getzep_graphiti.html`
- `letta-ai_letta.html`
- `mem0ai_mem0.html`
- `memodb-io_memobase.html`
- `microsoft_agent-framework.html`
- `microsoft_autogen.html`
- `microsoft_graphrag.html`
- `microsoft_semantic-kernel.html`
- `qhjqhj00_MemoRAG.html`
- `topoteretes_cognee.html`
- `wangyu-ustc_Mem-alpha.html`

## `docs\plans/`

- `AI_Integration_Optimization_Plan.md`
- `DEPLOYMENT.md`
- `E2E 测试 CI 集成指南.md`
- `GH_UPLOAD_GUIDE.md`
- `GITHUB_UPLOAD_INFO.md`
- `Iteration_Roadmap.md`
- `MCP 命令桥使用说明.md`
- `MEMORY_SYSTEM_FUTURE_TASKS.md`
- `MEMORY_UPGRADE_IMPLEMENTATION_PLAN.md`
- `Mod_System_Community_Plan.md`
- `Sentry 集成指南.md`
- `SpiritPal-S2-记忆存储架构重构方案.md`
- `SpiritPal-下一步任务清单-20260826.md`
- `SpiritPal-任务2.6-自定义角色导入优化-20260826.md`
- `SpiritPal-未完成任务清单.md`
- `SpiritPal-未实现与待办清单.md`
- `SpiritPal_Optimization_Plan.md`
- `android-emulator-debug-guide.md`
- `test-godtest-split-plan.md`
- `test-roadmap-p3.md`
- `全功能实施指南.md`
- `漏洞响应流程SLA_v1.0_20260826.md`

## `docs\project/`

- `ARCHITECTURE.md`
- `Borrowable_Code_Patterns.md`
- `PRD_桌面宠物应用_v0.1.md`
- `PRD_桌面宠物应用_v0.2.md`
- `change-management.md`
- `data-dictionary.md`
- `data-lifecycle-policy.md`
- `definition-of-done.md`
- `priority-justification.md`
- `requirements-index.md`
- `requirements-traceability.md`
- `桌面宠物开源仓库清单.md`
- `比赛Demo开发与技术栈分析.md`
- `生成桌面宠物项目技术分析报告.md`
- `跨平台技术栈选型分析.md`

## `docs\repo-analysis/`

- `7仓库对SpiritPal项目的持续价值分析.md`
- `AI-Desktop-Pet-Extended_技术学习报告.md`
- `AI-Desktop-Pet_技术学习报告.md`
- `Agentic-Desktop-Pet_技术学习报告.md`
- `Ameath_技术学习报告.md`
- `BongoCat_技术学习报告.md`
- `CodeWalkers_技术学习报告.md`
- `DeepSeek-Balance-Whale-Widget_技术学习报告.md`
- `Dororo_技术学习报告.md`
- `DyberPet_技术学习报告.md`
- `DyberPet_技术学习报告_补充.md`
- `EchoBot_技术学习报告.md`
- `Feibi_技术学习报告.md`
- `Live2DPet_技术学习报告.md`
- `MurasamePet_技术学习报告.md`
- `MyFlowingFireflyWife_技术学习报告.md`
- `New_Reference_Repos_2026Q3_Analysis.md`
- `New_Reference_Repos_Analysis.md`
- `NyaDeskPetAPP_技术学习报告.md`
- `OC-Claw_技术学习报告.md`
- `OpenLLMVTuber_技术学习报告.md`
- `OpenMemory_技术学习报告.md`
- `OpenPets_技术学习报告.md`
- `Petra_技术学习报告.md`
- `RunCat365_技术学习报告.md`
- `SpiritPal_Reference_Repos_Learning_Report.md`
- `Star-Office-UI_技术学习报告.md`
- `SuperAgentParty_技术学习报告.md`
- `VPet_技术学习报告.md`
- `WindowPet_技术学习报告.md`
- `ai-bubu_技术学习报告.md`
- `ai-live2d-go_技术学习报告.md`
- `airi_技术学习报告.md`
- `bongo-cat-next_技术学习报告.md`
- `clawd-on-desk_技术学习报告.md`
- `deepseek-harness-pet_技术学习报告.md`
- `douyin-code_技术学习报告.md`
- `dsh-niulai-pet_技术学习报告.md`
- `dsh-pet_技术学习报告.md`
- `remielle-codex-pet_技术学习报告.md`
- `supermemory_技术学习报告.md`
- `五项目功能实现总表.md`
- `新仓库对SpiritPal项目的持续价值分析.md`

## `docs\repo_research/`

子目录：`1_Petra`、`2_dsh-pet`、`3_deepseek-harness-pet`、`4_DS-Balance-Whale`、`5_dsh-niulai-pet`、`6_remielle-codex-pet`、`7_douyin-code`、`8_MyFlowingFireflyWife`

## `docs\repo_research\1_Petra/`

子目录：`docs`、`public`、`release`、`scripts`、`src`、`src-tauri`

- `CHANGELOG.md`
- `LICENSE`
- `README.md`
- `index.html`
- `package-lock.json`
- `package.json`
- `tsconfig.json`
- `vite.config.ts`
- `启动桌宠.dev.bat`

## `docs\repo_research\2_dsh-pet/`

子目录：`assets`、`dsh-pet`、`prompts`、`scripts`、`tools`、`video`

- `DESIGN.md`
- `LICENSE`
- `README.en.md`
- `README.md`

## `docs\repo_research\3_deepseek-harness-pet/`

子目录：`assets`

- `ASSET_PLAN.md`
- `BUILD_PLAN.md`
- `Install-DeepSeekHarnessPet.ps1`
- `LICENSE`
- `README.md`
- `harness_status.py`
- `pet.py`
- `requirements.txt`
- `启动桌宠.cmd`

## `docs\repo_research\4_DS-Balance-Whale/`

子目录：`assets`、`lib`

- `README.md`
- `cordis.patch.yml`
- `package.json`
- `whale-widget-prompt.md`

## `docs\repo_research\5_dsh-niulai-pet/`

子目录：`assets`、`demo`、`docs`、`kws`、`lib`、`src`、`test`、`tools`

- `AGENTS.md`
- `LICENSE`
- `README.md`
- `README_EN.md`
- `build.mjs`
- `cordis.patch.yml`
- `index.js`
- `package-lock.json`
- `package.json`
- `tsconfig.json`

## `docs\repo_research\6_remielle-codex-pet/`

子目录：`assets`、`gif`、`output`、`表情包单张预览`

- `ASSET-USAGE.md`
- `NOTICE.md`
- `README.md`

## `docs\repo_research\7_douyin-code/`

子目录：`ai writing assistant`、`desktop-pet`

- `LICENSE`
- `README.md`

## `docs\repo_research\8_MyFlowingFireflyWife/`

子目录：`data`、`src`

- `LICENSE`
- `MyFlowingFireflyWife.py`
- `README.md`
- `build-pyinstaller.bat`
- `requirement.txt`

## `docs\reports/`

- `DEVELOPMENT_LESSONS.md`
- `Git-Fork依赖评估_20260826.md`
- `LOGGING_AUDIT_REPORT.md`
- `MEMORY_UPGRADE_FINAL_REPORT.md`
- `STRIDE-威胁建模_v0.1.0_20260826.md`
- `SpiritPal-APP全面安全性评估报告_v0.1.0_20260807.md`
- `SpiritPal-安全加固_v2.0-任务执行指示报告_20260807.md`
- `SpiritPal-测试体系完整性评估报告.md`
- `SpiritPal-记忆系统二次评估报告.md`
- `SpiritPal-记忆系统第三轮评估报告.md`
- `SpiritPal-记忆系统第五轮深度评估报告.md`
- `SpiritPal-记忆系统第四轮评估报告.md`
- `TEST_AUDIT_REPORT.md`
- `test-data-management.md`
- `功能实现状态分析报告.md`
- `学习成果落地分析报告.md`
- `项目健康度评估报告.md`

## `e2e/`

子目录：`fixtures`、`tauri-driver`

- `accessibility.spec.ts`
- `chaos.spec.ts`
- `chat-window.spec.ts`
- `error-paths.spec.ts`
- `functional-assertions.spec.ts`
- `mobile-views.spec.ts`
- `multi-window.spec.ts`
- `nurturing.spec.ts`
- `pet-window.spec.ts`
- `settings-window.spec.ts`
- `smoke.spec.ts`

## `e2e\fixtures/`

- `base.ts`
- `tauri-mock.ts`

## `e2e\tauri-driver/`

- `tauri-driver.spec.ts`

## `perf/`

子目录：`results`

- `_helpers.mjs`
- `baseline-trend.mjs`
- `benchmark-report.mjs`
- `cold-start.mjs`
- `fps-test.html`
- `fps-test.mjs`
- `memory-leak-test.mjs`
- `memory-usage.mjs`
- `model-switch-latency.mjs`
- `monitoring_plan.md`
- `package-size.mjs`
- `penetration-test.mjs`
- `run-all.mjs`
- `stress-test.mjs`

## `perf\results/`

- `metrics-dashboard.html`
- `metrics-dashboard.json`
- `package-size.json`

## `playwright-report/`

子目录：`data`

- `index.html`

## `playwright-report\data/`

- `440dbb463d22ad336b54a978aeaf1479904ea9a9.md`

## `public/`

子目录：`characters`、`pets`

- `live2dcubismcore.js`

## `public\characters/`

子目录：`doro`、`feibi`、`gugugaga`

## `public\characters\doro/`

- `pet_conf.json`

## `public\characters\feibi/`

- `pet_conf.json`

## `public\characters\gugugaga/`

- `pet_conf.json`

## `public\pets/`

子目录：`doro`、`feibi`、`gugugaga`、`laocha`

## `public\pets\doro/`

## `public\pets\feibi/`

## `public\pets\gugugaga/`

- `angry.webm`
- `dance.webm`
- `eat.webm`
- `farewell.webm`
- `grasp.webm`
- `headpat.webm`
- `hungry.webm`
- `idle.webm`
- `milktea.webm`
- `music.webm`
- `peek.webm`
- `question.webm`
- `rest.webm`
- `spin.webm`
- `study.webm`
- `walk.webm`
- `walkout.webm`
- `watch.webm`
- `work.webm`

## `public\pets\laocha/`

## `scripts/`

子目录：`asset-pipeline`

- `_fetch_bili_comments_github.py`
- `_fetch_bili_desc_github.py`
- `build-release.bat`
- `check_spec_refs.py`
- `convert-windowpet.ts`
- `flaky-detect.mjs`
- `generate-icons.bat`
- `generate-metrics-dashboard.mjs`
- `modPackager.ts`
- `obfuscate-and-sri.mjs`
- `perf_monitor.py`
- `run-all-tests.bat`
- `test-impact.mjs`
- `update-artifacts.ps1`

## `scripts\asset-pipeline/`

- `README.md`
- `chroma_key.py`
- `normalize.py`
- `psd_to_pet.py`

## `src/`

子目录：`components`、`hooks`、`lib`、`mobile`、`stores`、`test`

- `App.tsx`
- `fix_route_persistence.ps1`
- `index.css`
- `main.tsx`
- `mini-mode.html`
- `vite-env.d.ts`

## `src-tauri/`

子目录：`binaries`、`capabilities`、`gen`、`icons`、`keys`、`mcp-server`、`src`、`target`、`tests`

- `Cargo.toml`
- `build.rs`
- `tauri.conf.json`

## `src-tauri\binaries/`

- `spiritpal-mcp-aarch64-linux-android`
- `spiritpal-mcp-armv7-linux-androideabi`
- `spiritpal-mcp-i686-linux-android`
- `spiritpal-mcp-x86_64-linux-android`

## `src-tauri\capabilities/`

- `chat-window.json`
- `default.json`
- `settings-window.json`

## `src-tauri\gen/`

子目录：`android`、`schemas`

## `src-tauri\gen\android/`

子目录：`app`、`build`、`buildSrc`、`gradle`

- `build.gradle.kts`
- `gradle.properties`
- `gradlew`
- `gradlew.bat`
- `local.properties`
- `settings.gradle`
- `tauri.settings.gradle`

## `src-tauri\gen\schemas/`

- `acl-manifests.json`
- `android-schema.json`
- `capabilities.json`
- `desktop-schema.json`
- `mobile-schema.json`
- `windows-schema.json`

## `src-tauri\icons/`

- `icon.icns`

## `src-tauri\keys/`

- `petpal-updater.key`
- `petpal-updater.key.pub`

## `src-tauri\mcp-server/`

子目录：`src`、`target`

- `Cargo.toml`

## `src-tauri\mcp-server\src/`

- `lib.rs`
- `main.rs`

## `src-tauri\mcp-server\target/`

子目录：`aarch64-linux-android`、`armv7-linux-androideabi`、`debug`、`i686-linux-android`、`release`、`x86_64-linux-android`

- `CACHEDIR.TAG`

## `src-tauri\src/`

子目录：`generated`

- `antidebug.rs`
- `asset_pipeline.rs`
- `audit_log.rs`
- `character_import.rs`
- `crypto.rs`
- `device.rs`
- `encrypted_db.rs`
- `keychain.rs`
- `lib.rs`
- `macos.rs`
- `magic_check.rs`
- `main.rs`
- `mcp_bridge.rs`
- `petmod.rs`
- `system.rs`
- `tray.rs`
- `validation.rs`
- `win32.rs`

## `src-tauri\src\generated/`

- `sri_hashes.rs`

## `src-tauri\target/`

子目录：`aarch64-linux-android`、`armv7-linux-androideabi`、`debug`、`doc`、`i686-linux-android`、`release`、`tmp`、`x86_64-linux-android`

- `CACHEDIR.TAG`

## `src-tauri\target\aarch64-linux-android/`

子目录：`debug`、`release`

- `CACHEDIR.TAG`

## `src-tauri\target\armv7-linux-androideabi/`

子目录：`debug`、`release`

- `CACHEDIR.TAG`

## `src-tauri\target\debug/`

子目录：`_up_`、`build`、`deps`、`examples`、`incremental`

- `libspiritpal_lib.d`
- `libspiritpal_lib.rlib`
- `spiritpal-app.d`
- `spiritpal_app.pdb`
- `spiritpal_lib.d`
- `spiritpal_lib.dll.exp`
- `spiritpal_lib.dll.lib`
- `spiritpal_lib.lib`
- `spiritpal_lib.pdb`

## `src-tauri\target\doc/`

子目录：`search.index`、`spiritpal_app`、`spiritpal_lib`、`src`、`static.files`、`trait.impl`

- `crates.js`
- `help.html`
- `settings.html`
- `src-files.js`

## `src-tauri\target\i686-linux-android/`

子目录：`debug`、`release`

- `CACHEDIR.TAG`

## `src-tauri\target\release/`

子目录：`_up_`、`build`、`bundle`、`deps`、`examples`、`incremental`、`nsis`

- `libspiritpal_lib.d`
- `libspiritpal_lib.rlib`
- `spiritpal-app.d`
- `spiritpal_app.pdb`
- `spiritpal_lib.d`
- `spiritpal_lib.dll.exp`
- `spiritpal_lib.dll.lib`
- `spiritpal_lib.lib`
- `spiritpal_lib.pdb`

## `src-tauri\target\tmp/`

## `src-tauri\target\x86_64-linux-android/`

子目录：`debug`、`release`

- `CACHEDIR.TAG`

## `src-tauri\tests/`

- `test_crypto.rs`
- `test_encrypted_db.rs`
- `test_validation.rs`

## `src\components/`

子目录：`__tests__`、`ui`

- `AchievementPanel.tsx`
- `AlbumPanel.tsx`
- `CharacterCreationWizard.tsx`
- `CharacterCreator.tsx`
- `CharacterImportWizard.tsx`
- `CharacterSelector.tsx`
- `ChatWindow.tsx`
- `CoinDisplay.tsx`
- `CollectionTab.tsx`
- `CommunityPanel.tsx`
- `DataPanel.tsx`
- `DecorationEditor.tsx`
- `DecorationLayer.tsx`
- `DialoguePanel.tsx`
- `FeatureComingSoon.tsx`
- `FirstRunGreeting.tsx`
- `FramelessChrome.tsx`
- `GifToSpriteTool.tsx`
- `InventoryPanel.tsx`
- `LeaderboardPanel.tsx`
- `LegalDocument.tsx`
- `LevelUpOverlay.tsx`
- `Live2DRenderer.tsx`
- `McpSettingsPanel.tsx`
- `MemoryPanel.tsx`
- `MemoryVisualization.tsx`
- `MemoryVisualizer.tsx`
- `ModPanel.tsx`
- `NurturingPanel.tsx`
- `PersonalityEditor.tsx`
- `PersonalityPanel.tsx`
- `PetBubble.tsx`
- `PetWindow.tsx`
- `PomodoroOverlay.tsx`
- `PomodoroPanel.tsx`
- `QuickControlsPanel.tsx`
- `SchedulePanel.tsx`
- `SettingsWindow.tsx`
- `ShopPanel.tsx`
- `SpriteRenderer.tsx`
- `SpriteSheetPanel.tsx`
- `UpdateNotification.tsx`
- `WindowControls.tsx`
- `petPanelParts.tsx`

## `src\components\__tests__/`

子目录：`__snapshots__`

- `CharacterImportWizard.test.tsx`
- `ChatWindow.test.tsx`
- `FramelessResizeHandles.test.tsx`
- `MemoryVisualization.test.tsx`
- `NurturingPanel.test.tsx`
- `PersonalityEditor.test.tsx`
- `PetBubble.test.tsx`
- `WindowControls.test.tsx`
- `snapshot.test.tsx`

## `src\components\ui/`

- `BrandButton.tsx`
- `BrandInput.tsx`
- `BrandSelect.tsx`
- `BrandSlider.tsx`
- `BrandSwitch.tsx`
- `index.ts`

## `src\hooks/`

子目录：`pet`

- `index.ts`
- `useCollections.test.tsx`
- `useCollections.ts`
- `useDisposable.test.tsx`
- `useDisposable.ts`
- `useEnhancedMemory.ts`
- `usePetGaze.test.tsx`
- `usePetGaze.ts`
- `usePetTTS.ts`
- `useSafeTimeout.test.tsx`
- `useSafeTimeout.ts`

## `src\hooks\pet/`

- `index.ts`
- `useDockVisualFeedback.ts`
- `usePetBehavior.test.tsx`
- `usePetBehavior.ts`
- `usePetDragging.test.tsx`
- `usePetDragging.ts`
- `usePetLive2D.test.tsx`
- `usePetLive2D.ts`
- `usePetMemoryTriggers.test.tsx`
- `usePetMemoryTriggers.ts`
- `usePetSensors.test.tsx`
- `usePetSensors.ts`
- `usePetTimers.test.tsx`
- `usePetTimers.ts`
- `usePetWalk.test.tsx`
- `usePetWalk.ts`
- `usePetWindows.test.tsx`
- `usePetWindows.ts`
- `useRoamWalk.ts`

## `src\lib/`

子目录：`__tests__`、`migrations`

- `achievementSystem.ts`
- `affectionNumeric.ts`
- `affectionQuantifier.ts`
- `agentSandbox.ts`
- `agentScheduler.ts`
- `agentStateLayer.ts`
- `agentTools.ts`
- `aiAgent.ts`
- `aiAssistantDetector.ts`
- `aiConfig.ts`
- `analytics.ts`
- `animationConfig.ts`
- `animationFallback.ts`
- `antiRepetition.ts`
- `appWindows.ts`
- `auditLogger.ts`
- `batchOperationManager.ts`
- `batchRenderer.ts`
- `behaviorEngine.ts`
- `bubbleConfig.ts`
- `bubbleManager.ts`
- `buffManager.ts`
- `calendarIntegration.ts`
- `characterCardImporter.ts`
- `characterCardSystem.ts`
- `characterConsistency.ts`
- `characterImportService.ts`
- `characterPack.ts`
- `characterResourceImporter.ts`
- `characterResourceLoader.ts`
- `characters.ts`
- `chatStages.ts`
- `chromaKey.ts`
- `clipboardManager.ts`
- `codingReactionRows.ts`
- `collectionManager.ts`
- `collectionSystem.ts`
- `commitmentTracker.ts`
- `commonUtils.ts`
- `constants.ts`
- `contextAwareness.ts`
- `contextEpisodeManager.ts`
- `contextManager.ts`
- `dailyJournal.ts`
- `dataManager.ts`
- `db.ts`
- `declarativeTheme.ts`
- `deviceInput.ts`
- `dialogueConfig.ts`
- `dialogueManager.ts`
- `dialogueSystem.ts`
- `diarySystem.ts`
- `dirtyDataTracker.ts`
- `dragInteraction.ts`
- `dreamingConsolidation.ts`
- `dualBrain.ts`
- `embeddingCache.ts`
- `emojiCultureData.ts`
- `emotionEngine.ts`
- `emotionExtractor.ts`
- `emotionManager.ts`
- `encryptedExport.ts`
- `encryptedStorage.ts`
- `enhancedMemory.ts`
- `entityGraph.ts`
- `entityLinking.ts`
- `eventSystem.ts`
- `foodContract.ts`
- `foodEffectContract.ts`
- `frameCache.ts`
- `generatorPipeline.ts`
- `gpuParticleSystem.ts`
- `gradualRollout.ts`
- `healthCheck.ts`
- `hiddenStateManager.ts`
- `i18n.ts`
- `i18nManager.ts`
- `i18nTranslations.ts`
- `interactionCounter.ts`
- `ipcErrorCode.ts`
- `ipcSecurity.ts`
- `itemSchema.ts`
- `items.ts`
- `jsonUtils.ts`
- `keyframeMemory.ts`
- `latencySLO.ts`
- `legalDocuments.ts`
- `live2dPhysicsParser.ts`
- `llmClient.ts`
- `llmProviders.ts`
- `localEmbedding.ts`
- `logger.ts`
- `macosPanel.ts`
- `mcpAppBridge.ts`
- `mcpBridge.ts`
- `mcpClient.ts`
- `mcpHooks.ts`
- `mcpInputValidator.ts`
- `mcpLease.ts`
- `mcpPermissions.ts`
- `mcpServer.ts`
- `memoryBackground.ts`
- `memoryConfig.ts`
- `memoryEditor.ts`
- `memoryExporter.ts`
- `memoryMigrator.ts`
- `memoryQualityCheck.ts`
- `memoryRecommendation.ts`
- `memorySummarizer.ts`
- `memoryTrace.ts`
- `memoryTypes.ts`
- `miniMode.ts`
- `miniModeManager.ts`
- `modCreatorIncentive.ts`
- `modDistribution.ts`
- `modLoader.ts`
- `modManager.ts`
- `modPackager.ts`
- `modTestFramework.ts`
- `movementEngine.ts`
- `multiMonitor.ts`
- `multimodalLLM.ts`
- `multimodalMemory.ts`
- `musicAwareness.ts`
- `ownerFacts.ts`
- `paramAutoMapper.ts`
- `pathConvention.ts`
- `pathSecurity.ts`
- `pathTraversalGuard.ts`
- `permissionBubble.ts`
- `personalityEngine.ts`
- `personalityTemplates.ts`
- `petExperience.ts`
- `petForm.ts`
- `petMetadata.ts`
- `petWindowSizing.ts`
- `piiMasking.ts`
- `pixelClickThrough.ts`
- `pluginManager.ts`
- `pluginPermissions.ts`
- `pluginSdk.ts`
- `proactiveSpeak.ts`
- `promptRegistry.ts`
- `pushNotificationManager.ts`
- `qualityMonitor.ts`
- `ragRetrieval.ts`
- `recallEngine.ts`
- `renderAdapter.ts`
- `runtimeMonitor.ts`
- `saveRecovery.ts`
- `saveRestore.ts`
- `scheduleManager.ts`
- `screenshotManager.ts`
- `secureStorage.ts`
- `securityUtils.ts`
- `sentenceDivider.ts`
- `sentry.ts`
- `shimejiLoader.ts`
- `shopManager.ts`
- `silentModeManager.ts`
- `spriteAtlasBuilder.ts`
- `spriteLayout.ts`
- `spriteLayoutConfig.ts`
- `spriteMemoryManager.ts`
- `spriteSheetTool.ts`
- `sseUtils.ts`
- `ssrfProtection.ts`
- `streamPipeline.ts`
- `stringSimilarity.ts`
- `svgAnimationAnalyzer.ts`
- `swallowedCatch.ts`
- `syncManager.ts`
- `systemControls.ts`
- `taskManager.ts`
- `tauriInvoker.ts`
- `themeManager.ts`
- `thinkBubble.ts`
- `thinkTagParser.ts`
- `timezoneSync.ts`
- `toolParamValidator.ts`
- `toxicityFilter.ts`
- `trayIconRenderer.ts`
- `ttsEngine.ts`
- `ttsTaskManager.ts`
- `types.ts`
- `updater.ts`
- `uploadMagic.ts`
- `vectorSearch.ts`
- `vectorWorker.ts`
- `visionPerception.ts`
- `visualMemory.ts`
- `visualMemoryManager.ts`
- `visualPerception.ts`
- `weatherAwareness.ts`
- `webdavClient.ts`
- `webgl.worker.ts`
- `webglWorker.ts`
- `widgetState.ts`
- `windowEventBus.ts`
- `windowManager.ts`

## `src\lib\__tests__/`

- `achievementSystem.test.ts`
- `agentSandbox.test.ts`
- `aiAgent-intent.test.ts`
- `aiAgent-llm.test.ts`
- `aiAgent-rule-fallback.test.ts`
- `aiAgent-tools.test.ts`
- `animationConfig.test.ts`
- `behaviorEngine.test.ts`
- `bubbleManager.test.ts`
- `buffManager.test.ts`
- `characterCardSystem.test.ts`
- `characterConsistency.test.ts`
- `characterImportService.test.ts`
- `characterPack.test.ts`
- `characters.test.ts`
- `chatStages.test.ts`
- `chromaKey.test.ts`
- `commitmentTracker.test.ts`
- `commonUtils.test.ts`
- `constants.test.ts`
- `contextAwareness.test.ts`
- `contextEpisodeManager.test.ts`
- `contextManager.test.ts`
- `dataManager.test.ts`
- `db.test.ts`
- `diarySystem.test.ts`
- `dirtyDataTracker.test.ts`
- `dreamingConsolidation.test.ts`
- `encryptedExport.test.ts`
- `encryptedStorage.test.ts`
- `enhancedMemory-classify.test.ts`
- `enhancedMemory-context.test.ts`
- `enhancedMemory-manager-basic.test.ts`
- `enhancedMemory-misc.test.ts`
- `enhancedMemory-persistence.test.ts`
- `enhancedMemory-pure.test.ts`
- `enhancedMemory-tiering.test.ts`
- `enhancedMemory-timeline.test.ts`
- `enhancedMemory-triggers.test.ts`
- `entityLinking.test.ts`
- `eventSystem.test.ts`
- `gradualRollout.test.ts`
- `healthCheck.test.ts`
- `i18n.test.ts`
- `interactionCounter.test.ts`
- `ipcContract.test.ts`
- `ipcErrorCode.test.ts`
- `items.test.ts`
- `latencySLO.test.ts`
- `llmClient.test.ts`
- `llmProviders.test.ts`
- `mcpBridge.test.ts`
- `mcpClient.test.ts`
- `memoryBackground.test.ts`
- `memoryEditor.test.ts`
- `memoryQualityCheck.test.ts`
- `modLoader.test.ts`
- `modManager-complement.test.ts`
- `modManager.test.ts`
- `musicAwareness.test.ts`
- `personalityEngine.test.ts`
- `personalityTemplates.test.ts`
- `petForm.test.ts`
- `petWindowSizing.test.ts`
- `piiMasking.test.ts`
- `pluginManager.test.ts`
- `proactiveSpeak.test.ts`
- `promptRegistry.test.ts`
- `qualityMonitor.test.ts`
- `ragRetrieval.test.ts`
- `recallEngine.test.ts`
- `redactErrorText.test.ts`
- `runtimeMonitor.test.ts`
- `s2-migration-flags.test.ts`
- `s2-migration-lifecycle.test.ts`
- `s2-migration-rows.test.ts`
- `s2-migration-scenarios.test.ts`
- `scheduleManager-complement.test.ts`
- `scheduleManager.test.ts`
- `secureStorage.test.ts`
- `sentry.test.ts`
- `sqlite-integration.test.ts`
- `sseUtils.test.ts`
- `streamPipeline.test.ts`
- `syncManager.test.ts`
- `taskManager.test.ts`
- `tauriInvoker.test.ts`
- `themeManager.test.ts`
- `toolParamValidator.test.ts`
- `toxicityFilter.test.ts`
- `ttsEngine.test.ts`
- `vectorSearch.test.ts`
- `visualMemoryManager.test.ts`
- `weatherAwareness.test.ts`
- `webdavClient.test.ts`

## `src\lib\migrations/`

- `index.ts`
- `schemaRunner.ts`
- `v001_initial_schema.ts`
- `v002_add_schema_tracking.ts`
- `v003_add_dirty_data_registry.ts`

## `src\mobile/`

- `MobileAchievementView.tsx`
- `MobileApp.tsx`
- `MobileChatView.tsx`
- `MobileCollectionView.tsx`
- `MobileInventoryView.tsx`
- `MobileMemoryView.tsx`
- `MobileNurturingView.tsx`
- `MobilePersonalityView.tsx`
- `MobilePetView.tsx`
- `MobileSettingsView.tsx`
- `MobileShopView.tsx`
- `mobileachievementview.test.tsx`
- `mobileapp.test.tsx`
- `mobilechatview.test.tsx`
- `mobilecollectionview.test.tsx`
- `mobileinventoryview.test.tsx`
- `mobilememoryview.test.tsx`
- `mobilenurturingview.test.tsx`
- `mobilepersonalityview.test.tsx`
- `mobilepetview.test.tsx`
- `mobilesettingsview.test.tsx`
- `mobileshopview.test.tsx`

## `src\stores/`

子目录：`__tests__`

- `chatStore.ts`
- `petStore.ts`
- `settingsStore.ts`
- `tabStore.ts`
- `uiStore.ts`

## `src\stores\__tests__/`

- `chatStore.test.ts`
- `petStore.test.ts`
- `settingsStore.test.ts`

## `src\test/`

- `fakeClock.ts`
- `mockContext.ts`
- `setup.ts`
- `sql.js.d.ts`
- `testDataFactory.ts`
- `testHarness.ts`

## `test-results/`

子目录：`tauri-driver-Tauri-Driver-真实-E2E-测试-应用启动后宠物窗口可见-tauri-driver`

## `test-results\tauri-driver-Tauri-Driver-真实-E2E-测试-应用启动后宠物窗口可见-tauri-driver/`

- `error-context.md`

## `tests/`

子目录：`e2e`

## `tests\e2e/`

子目录：`setup`

- `README.md`
- `accessibility.spec.ts`
- `app-loading.spec.ts`
- `inventory-system.spec.ts`
- `memory-system.spec.ts`
- `pet-interaction.spec.ts`

## `tests\e2e\setup/`

- `tauri-helper.ts`

<!-- AUTO-SYNC 2026-08-27 15:16 : +7 ~10 -0 -->
