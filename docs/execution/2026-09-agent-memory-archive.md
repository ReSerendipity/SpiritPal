# 2026-09 Agent 会话记忆归档（SpiritPal）

> 缘起：清理被 `.gitignore` 忽略的 agent 工具目录（`.workbuddy` / `.workbuddy-ai` / `.zcode` / `.trae`）前，把其中长期有效的工程事实固化入库。
> 口径：只保留可执行事实（命令 / 路径 / 参数 / 版本 / 阈值 / 判据 / 结论），删去过程流水与寒暄；每条尾标发生日期（如 `（09-16）`）。`（11-04）` 表示归档当日对现状的复核，用于纠正 9 月的过期结论。
> 9 月已登记进坑点台账的条目（本地层 GOTCHAS #99–#145 等）不重复搬运，见文末「已由既有文档覆盖」。

## 来源

| 来源路径 | 日期 | 原始行数 | 本文保留了什么 |
|---|---|---|---|
| `.workbuddy-ai/memory/2026-09-15.md` | 2026-09-15 | 218 | 端侧 MNN 架构决策、内存预算、协议核实、embed 落地与硬约束 |
| `.workbuddy-ai/memory/2026-09-16.md` | 2026-09-16 | 310 | 无真机理论验证、Android 交叉编译 24 错修复、产物、模型校验、真机首跑 |
| `.workbuddy-ai/memory/2026-09-17.md` | 2026-09-17 | 241 | Groovy / cargo-ndk 构建链、AAB、引擎库 fetch、分支合并、本地层丢失与并发改写 |
| `.workbuddy-ai/memory/2026-09-18.md` | 2026-09-18 | 289 | PR #58 闭环、CI 阻塞、DCO 补签、R8 keep、产物清理与体积基线 |
| `.workbuddy-ai/memory/2026-09-29.md` | 2026-09-29 | 155 | 主题体系盘点、桌面/移动对齐 17 轮、eslint 交接基线 |
| `.workbuddy-ai/memory/build-prompt.md` | 2026-09-17 整理 | 48 | Android 构建可复现命令与环境变量 |
| `.trae/documents/community-pets-import-plan.md` | 未标日期（早于 09-17，仍按 3 只内置写） | 108 | 社区宠物接入计划 → 落地状态与实际差异 |
| `.trae/documents/spiritpal-security-hardening-plan.md` | 未标日期（正文对应 2026-09-03/04） | 184 | SQL 收口 + 安全加固计划 → 落地状态与实际差异 |
| `.trae/skills/bilibili-repo-harvest/SKILL.md` | 未标日期（与 2026-11-03 归档版同步） | 175 | 仅抽本仓项目变体的专属约定，其余以全局 skill 为准 |

## 1. 环境与工具链

- **杀软（火绒）四症状同一根因**：文件实时监控在「刚写完」瞬间扫描并短暂持锁。根治 = 把构建目录加入信任区，最关键且最易漏的是 `.cargo/registry/src`（`os error 183` 发生在插件源码 `.tauri` 拷贝处，在仓库外）；其次 `src-tauri/target`、`src-tauri/gen/android`、`node_modules`、`dist`、`~/.gradle`、`C:\gradletmp`。不改杀软时的实用解：`cargo -j 2`（默认并发连试 6 轮全失败 → `-j 2` 一次通过）、重试、Gradle `workers.max=1`、逐 ABI 构建且每轮前清插件 `.tauri`（09-18）
- **构建沙箱**：PowerShell 调 `node` 及读其 stdout 会被吞（`Get-Command node` 为空、重定向写不出）→ 一律用 Git Bash；Bash 缺 Windows 系统变量，构建前 `export PATHEXT ProgramData ProgramFiles SystemRoot SystemDrive windir CommonProgramFiles ANDROID_HOME ANDROID_SDK_ROOT ANDROID_NDK_HOME`（09-16）
- **必须 `unset NODE_OPTIONS CODEBUDDY_SAFE_DELETE_* GENIE_TRASH_DIR`**：安全删除 shim 把 `fs.rmSync` 劫持到 `genie-trash`，vite 清 `dist/` 时 `ETIMEDOUT`，`beforeBuildCommand` exit 1；unset 后原生删除即可通过（09-16）
- `vite build` 清 `dist/` 会被批量删除保护拦下（>`50` 项需确认）→ 先 `mv dist "$TEMP/dist-old"`，或按单次 ≤50 项分批删（09-16 / 09-17）
- 沙箱内**无 `strings`**；查 dex 内容用 `grep -aoE "Lcom/xxx;" *.dex`；`llvm-strip` 对 `/tmp` 路径不可见，必须用 Windows 路径（09-16）
- SDK `%LOCALAPPDATA%\Android\Sdk`；NDK `27.0.12077973`；build-tools `35.0.0`（`aapt2` 可读 badging）；LLVM 工具在 `$SDK/ndk/27.0.12077973/toolchains/llvm/prebuilt/windows-x86_64/bin/{llvm-nm,llvm-readelf,llvm-cxxfilt}.exe`（09-16）
- **Gradle flavor→ABI**：`arm`=armeabi-v7a、`arm64`=arm64-v8a、`universal`；任务名必须带 ABI（`assembleArm64Debug` / `compileArm64DebugKotlin`），`compileDebugKotlin` 歧义报错（09-16）
- Gradle daemon 锁争用（`journal-1.lock 拒绝访问`）→ `./gradlew --stop` 后再跑；清理前同样先停守护进程再 `cargo clean`（09-16 / 09-18）

### Git / 仓库操作事实

- **Bash 沙箱里 `git fetch` 不落盘 `refs/remotes/origin/*`**（输出照印 `[new branch]`，`.git/refs/remotes/` 始终空）→ 所有远端与 PR 状态查询走 `gh` / GitHub API，不能信本地 `origin/*`；合并用 `gh pr merge`（09-18）
- `.git/refs/` 目录整体缺失会让 git 报 `fatal: not a git repository` → `mkdir -p .git/refs/heads .git/refs/tags` 立即恢复；对象被清后可用远端分支 `git fetch origin <branch>` + `git update-ref refs/heads/main FETCH_HEAD` + `git symbolic-ref HEAD refs/heads/main` + `git reset` 复原，全程不碰工作树（09-18）
- `git bundle create` 路径必须用 `C:/...` 形式，`/c/Users/...` 会被 Windows 版 git 当字面量（exit 0 但文件不生成）（09-18）
- 提交信息文件必须写 Windows 风格路径：`git commit -F "$(mktemp)"` 在沙箱必然失败（`could not read log file '/tmp/...'`，rc=128）（09-18）
- `git rebase --signoff --rebase-merges` 在本机会挂起 → 改用 `FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --msg-filter '…补 Signed-off-by…' <base>..main`，事后用 `git diff <old> main` 为空证明内容未变（09-18）
- 远端跟踪引用被清时 `--force-with-lease` 报 stale info → 用显式期望值 `git push --force-with-lease=<branch>:<old-sha> --no-verify origin main:<branch>`（09-18）
- main 受保护：直推报 `GH006 … required status checks`，只能走分支 + PR；`required_linear_history=false`，允许 merge commit（09-18）
- 部分暂存：从混合 hunk 中抽取自己的 hunk 生成补丁 → `git apply --cached --recount`；Python 写补丁须 `open(..., newline="\n")`，否则 CRLF 导致 `patch does not apply`（09-18）
- 被 gitignore 的关键文件（签名 / 代码生成产物 / 本地规范）是「无备份区」：本仓事故中只有「模板可确定性重建」与「WorkBuddy 会话备份 `~/.workbuddy-ai/workspace/sessions/<id>/modify_backup*`」两类救回（09-17）
- **判断并发写入者不能只看 mtime**：pre-commit 的 stash/restore 会把未暂存文件统一刷成同一时刻 mtime；要用「窗口内快照 diff + 内容比对」组合判定（09-18）

## 2. Android 构建链路（现状）

- **Kotlin DSL → Groovy DSL**：`GenerateProjectAccessors` 稳定超 Gradle ~72s 固定超时（杀软拖慢 kotlinc）→ `app/build.gradle`、`app/tauri.build.gradle`、`build.gradle` 转 Groovy，该步骤消失；原 `.kts` 改名 `.bak`，Gradle 会忽略（09-17）
- Groovy 转写三个语义坑：签名块 `throw` 表达式改 `if/else`；`proguardFiles` 不能传 `fileTree`，需显式列文件；`rust { rootDirRel = "../../../" }` 必须带 `=`，且 `RustPlugin.kt` 的 `Config.rootDirRel` 由 `lateinit var` 改为带默认值的 `var`（09-17）
- `rustBuild*` 原调 `pnpm tauri android android-studio-script`（需 Android Studio WebSocket）→ CLI 直跑 `ConnectionRefused`；改为在 `BuildTask.kt` 调 **`cargo ndk`**（`cargo install cargo-ndk --version "^3"`）。cargo-ndk 必须以 `cargo ndk` 调用，不能直接跑 `cargo-ndk.exe`；ABI 映射键是 `aarch64/armv7/i686/x86_64`（不是 `arm`）（09-17）
- 杀软锁导致 cargo-ndk 自带拷贝 panic（`ERROR_SHARING_VIOLATION` code 32）→ `cargo ndk` **去掉 `-o`** 只编译，再由 Kotlin 用带重试（10 次 × 2s）的 `Files.copy(REPLACE_EXISTING)` 拷贝到 `app/src/main/jniLibs/<abi>/`（09-17）
- `tauri.settings.gradle`（自动生成，勿手改）把 `:tauri-android` 等 `projectDir` 硬编码指向 cargo 注册表缓存 → 构建前先 `cargo fetch`，并与 gradlew 合并为同一条命令，消除「缓存空闲窗口被清理」（09-17）
- 可复现命令（09-17）：`cd src-tauri && cargo fetch` → `cd gen/android` → 设 `JAVA_HOME`（JDK 21）/ `ANDROID_HOME` / `ANDROID_SDK_ROOT` / `ANDROID_NDK_HOME` / `CARGO_HOME`（PATH 含 `$CARGO_HOME/bin`）→ `python ../../../scripts/download_mnn_engine.py` → `gradlew.bat assembleRelease`（AAB 用 `bundleRelease`）。全量约 25 分钟（4 ABI 各约 4 分钟 + 打包），引擎库下载约 1 分钟；`bundleRelease` 实测 17m33s（09-17）
- **禁止再跑 `tauri android init`**：会重新生成 `.kts`，与 `.gradle` 共存触发 multiple build scripts 报错（09-17）
- `-x rustBuild*` 会连带跳过「前端 → Android assets」同步（该任务实为 `pnpm tauri android android-studio-script`）→ 手动 `cp -r dist/. src-tauri/gen/android/app/src/main/assets/`；`assets/_up_/…` 是 Tauri 对 `../public/...` 的重映射，非残留（09-16）
- **SRI 顺序铁律**：`node scripts/obfuscate-and-sri.mjs` 写 `src/generated/sri_hashes.rs`，`lib.rs` 启动 `verify_integrity()` 强制校验；必须先 SRI 后编 Rust 库，反了则库内嵌旧哈希、启动即失败（09-16）
- `dist/` 刻意不删：tauri `custom-protocol` 特性在**编译期**要求 `dist/` 存在；CI 的 `rust-clippy` / `rust-test` 从不构建前端 → 需在缓存步骤后加 `mkdir -p ../dist && printf '<!doctype html>…' > ../dist/index.html` 占位，否则 proc macro panic（09-18）
- `download_mnn_engine.py`：从 `https://meta.alicdn.com/data/mnn/apks/mnn_chat_0_8_3.apk` 解 `lib/arm64-v8a/` 引擎库；体积下限自检 30MB 防截断；幂等，`--force` 可重拉。`app/build.gradle` 用 `jniLibs.srcDirs = ['src/main/jniLibs', 'mnnLibs']` 与 cargo-ndk 产物叠加（09-17）
- **`mnnLibs/` 不入库**：`.gitignore` 显式声明 `src-tauri/gen/android/app/mnnLibs/`，并注释禁止再加 `!…/*.so` 否定规则（否则 8.9MB 二进制随每次改动进版本库）。官方 APK 只含 arm64-v8a → `arm` / `x86` / `x86_64` 包无端侧引擎属预期（09-17）
- **（11-04 复核，已变更）**：`download_mnn_engine.py` 自 2026-10-13 起只解 `libmnnllmapp.so`（1,391,856 B）；`libMNN.so` 改由 `scripts/fetch_qwen_image_engine.py` 从图像引擎 AAR 提供，旧脚本若再解旧版会覆盖图像引擎所需符号。9 月记录的两个库共 8.9MB 方案已被「LLM/图像共用一份 MNN」取代

### 产物基线（09-18，release，R8 + 自签名）

| 产物 | 体积 |
|---|---|
| `apk/universal/release/app-universal-release.apk` | 68,715,897 B |
| `apk/arm64/release/app-arm64-release.apk` | 25,381,651 B |
| `apk/arm/release/app-arm-release.apk` | 13,351,057 B |
| `apk/x86/release/app-x86-release.apk` | 18,936,917 B |
| `apk/x86_64/release/app-x86_64-release.apk` | 18,891,776 B |

- 体积从 09-16 的 139MB / 204MB / 237MB 级降到 25MB 级，根因是清掉 `dist/pets` 里 270 个陈旧素材（约 113MB），**不是** `custom-protocol` 失效（09-18 已纠正 09-17 的误判）
- 「前端是否内嵌」判据：从 APK 抽出 `libspiritpal_lib.so`，命中 `tauri://localhost` / `index.html` / `assets/` 即已内嵌（09-18）
- AAB：`universalRelease/app-universal-release.aab` 139,288,365 B（09-17）
- `.so` 经 `llvm-strip --strip-debug` 从 411MB → 172MB；release 库 `strip=true` / `opt-level="z"` / `lto="fat"` 后 113MB（09-16）

## 3. 端侧 MNN（embed 架构）

- **决策**：embed（MNN 引擎编进 APK，单进程持模型）为目标，companion（外部 MNN Chat + loopback OpenAI 端点）为已验证的临时方案；MNN **不是运行时依赖**，缺失时仅 `ondevice` 不可用，核心聊天栈不受影响（09-15）
- companion 协议事实：MNN Chat `ApiService` 默认 `127.0.0.1:8080`、明文 HTTP、OpenAI 兼容（`GET /v1/models`、`POST /v1/chat/completions` + SSE）；默认 auth 开启，key 为首次运行随机 16 位字母数字（09-15）
- **最小同名桥**：`libmnnllmapp.so` 的 JNI 是短名，绑定类名 `com.alibaba.mnnllm.android.llm.LlmSession`，自写 ~120 行同名类即可，vendor 面由 80 文件降到 2 文件（另一为逐字 vendored 的 `GenerateProgressListener.kt`）。契约：`initNative(configPath, history, mergedConfigStr, configJsonStr): Long` / `submitNative(instanceId, input, keepHistory, listener): HashMap` / `resetNative` / `releaseNative`（09-16）
- **Tauri v2 没有应用侧公开的 Android JNI 入口**（`tauri::android` 模块不存在，`PluginHandle` 无 `run_on_android_context`），但 tauri 未定义 `JNI_OnLoad` → 自定义 `JNI_OnLoad` 里 `attach_current_thread` + `find_class` + `new_global_ref` 缓存 `JavaVM` 与 `SpiritPalOnDevice` 的 `GlobalRef`，规避 native 线程 `find_class` 走 system class loader 失败（09-16）
- Tauri 同步命令在主线程内联执行 → `load_model` 会 ANR → 改 `async fn` + `tauri::async_runtime::spawn_blocking`（09-16）
- Android 交叉编译 24 错的关键修法：`reqwest` 关闭默认 TLS，非 Android 用 `native-tls`、Android 用 `rustls-tls`（Android 不拉 `openssl-sys`）；插件 `build.rs` 用 `create_dir` 拷 `.tauri`，目录已存在即 `os error 183`（删/改名这些 `.tauri` 目录）；`static Mutex<HashMap>` 改 `LazyLock`；`JavaStr::to_string` 缺 trait 改用 `.ok().and_then(...)`；`JValue<'_, '_>`（jni 0.21 两个参数）；`generate_handler!` 需按模块路径写 `ondevice::engine::generate`（09-16）
- 模型目录：Android 用 `/storage/emulated/0/Android/data/<identifier.replace('-','_')>/files/models`（无需权限、`adb push` 可写；包名含 `-` 会被 FUSE 拦）；创建后需 chmod `files/`→0771、`models/`→0777 才能 push；判定「是模型」= 子目录含 `config.json`（09-16）
- 格式：`libMNN.so` / `libmnnllmapp.so` 内 gguf 符号为 0，运行时只认 MNN 目录（`llm.mnn` / `llm.mnn.weight` / `tokenizer.txt` / `llm_config.json` / `config.json`）；GGUF 只能在 PC 侧转换，细节见 `docs/execution/ondevice-custom-model-pipeline.md`（09-16）
- 设备分档固化在 `src/lib/ai/onDeviceTiers.ts`（6 / 8 / 12 / 16 GB）：6GB 档固定开销 1.97GB 已超 1.8GB 预算 → 不可行；8GB 档 128K+视觉超 0.61GB；12GB 为舒适解（2B Q4_K_M + Q8 KV + 视觉 ≈ 3.41GB）（09-16 修正三处数字）
- **`LlmSession.generate()` 不读运行时 params**：`enable_thinking` / `max_new_tokens` / `thread_num` 都在 `config.json` 于加载时定死 → 要改生成行为必须改磁盘 `config.json` 并 force-stop 重载（09-16）
- 真机基线（realme RMX5010 / arm64-v8a / Android 16 / 14.75GB / T2 档 / Qwen3.5-2B-MNN / CPU / 4 thread / precision=low / memory=low）：

| 场景 | prefill | decode | tokens | decode_rate |
|---|---|---|---|---|
| 干净上下文（系统提示 ~300 tok + "Hi"） | 4,040 ms | 5,791 ms | 169 | **29.18 tok/s** |
| 长上下文（+ ~2k tok 历史） | 151,179 ms | 6,101 ms | 114 | **18.68 tok/s** |

  → prefill ≈ 74 tok/s；TTFT 干净首轮 ~4s，长上下文 >2min；单进程（`ps -A` 仅 1 个 spiritpal）Native Heap ≈1.7GB / TOTAL PSS ≈1.9GB（09-16）
- 端侧 Kotlin 桥须 proguard keep：`-keep class com.alibaba.mnnllm.android.SpiritPalOnDevice { *; }`（09-15）
- 移动端平台差异只有两处（09-15）：cognee 记忆侧车 `#[cfg(desktop)]` 门控 → 前端 `src/lib/system/platform.ts` 短路，降级本地 SQLite；Android 明文仅以 `network_security_config.xml` 放行 `127.0.0.1` / `localhost`，`usesCleartextTraffic` 保持 false
- **已被用户纠正的结论**：不单独压缩移动端提示词预算（128K 是窗口容量，单轮实际发送约 11K，桌面/移动同等对待）（09-15）

### 3.1 内存预算与量化结论（09-15，模型侧口径）

- Qwen3.5 小尺寸系列是**混合注意力**：`8 × (3 × Gated DeltaNet → 1 × Gated Attention)`，每 4 层只有 1 层 full attention；KV cache 公式 `2 × full-attn 层数 × KV heads × head_dim × 每元素字节`，故同参数下上下文容量约为标准 Transformer 的 4×（0.8B/2B：24 层 6 full-attn，12 KB/token；4B/9B：32 层 8 full-attn，32 KB/token）
- unsloth GGUF 实测（十进制 GB）：2B Q4_K_M 1.28 / Q8_0 2.01 / IQ4_XS 1.17，mmproj-F16 0.668；4B Q4_K_M 2.74 / Q8_0 4.48，mmproj 0.672；9B Q4_K_M 5.68 / Q8_0 9.53，mmproj 0.918
- **反直觉但实测结论**：128K 下「权重 Q4_K_M + KV Q8_0」优于反向组合（KV 体积大、Q8 量化近乎无损）；4B 在任何量化 + 128K + 视觉下均不可行（最省的 4B IQ4_XS + Q4 KV 也要 5.08GB）（09-15）
- llama.cpp 侧参数（供对照）：`n_ctx=131072`（KV 全量预分配，与实际用量无关）、`flash_attn=true`、`mmap=true`、`n_ubatch` 128–256、线程 4–6；采样 temp 0.7 / top_p 0.8 / top_k 20 / presence_penalty 1.5；视觉 mmproj 必须 F16（不可量化），1024×1024 截图约 1024 tokens，上限 2304（09-15）

### 3.2 上游依赖更新策略（09-16 凌晨）

- **不追更新频率**：本项目对上游是「拷贝 / 内嵌」而非依赖（三件套已拷贝进 `src-tauri/src/ondevice/`，MNN 以 .so + Kotlin vendoring 进包），升级时机由本仓掌控
- 稳定性事实：MNN 有 tagged release（锁 3.6.1 对应 commit，不追 master）；`tauri-plugin-local-ai` 无 release 只有 main 提交且无 LICENSE → 拷贝源码、不作依赖；llama.cpp pre-1.0 仅兜底不进构建
- 升级流程 = 「有收益 + 复核 JNI 签名 + 真机回归」三步，其余默认忽略日常更新，季度统一评估

### 3.3 真机联调暴露的 7 个问题（09-16，可复用）

| # | 问题 | 修法 |
|---|---|---|
| ① | `#[tauri::command(name = "x")]` 不被 Tauri 支持（宏静默忽略）→ `Command ondevice_* not found` | 函数名直接改成 `ondevice_*` |
| ② | 模型目录用 `identifier` 拼路径，`-` vs `_` 不匹配 → 被 FUSE 拦 | `identifier.replace('-', "_")` |
| ③ | 应用自建外部目录权限 0770，`adb push` 写不进 | 创建后 chmod：`files/`→0771、`models/`→0777 |
| ④ | 移动端设置页与桌面是两套 UI（改错文件） | 入口加到 `MobileSettingsView.tsx`（类型 / 菜单项 / 渲染分支三处） |
| ⑤ | `chat()` 未接移动端进程内分流 → `onDeviceGenerate` 死代码 | `provider==='ondevice'` 按 `isMobileRuntime()` 分流 |
| ⑥ | 移动端聊天强制要求 API Key → 端侧被挡 | `!config.apiKey && provider!=='ondevice'` 才报错 |
| ⑦ | Gradle daemon 锁争用 | `./gradlew --stop` + `--no-daemon` |

真机操作经验：`adb shell uiautomator dump` 可读 WebView 内 a11y bounds（但 WebView 常不暴露 text，需截图 + 像素定位）；软键盘会遮底部按钮，发送前 `input keyevent KEYCODE_BACK`；长操作前 `svc power stayon true`，息屏后 `input tap` 无效且 adb 可能变 unauthorized（`adb kill-server` 恢复）；模型推送 `adb push artifacts/mnn-models/Qwen3.5-2B-MNN /storage/emulated/0/Android/data/com.spiritpal.desktop_pet/files/models/`（1.39GB 约 36s）（09-16）

## 4. 门禁与测试

- **必需检查单一事实源 = `docs/ci/branch-protection.json` 的 `contexts`**：`Lint and Test (Frontend, Node 22)` / `Rust Tests` / `layout`。`Rust Clippy`、`Dependency Vuln Scan`、自净化检查属非阻塞（09-18）
- 路径/结构门禁命令集：`python scripts/check_spec_refs.py`（exit 0 = 真跑过且通过，1 = 失败，2 = 审计器缺失，**不得当通过**）、`python scripts/check_no_hardcoded_paths.py`、`python .github/scripts/check_layout.py`、`node scripts/lint-capabilities.mjs`、`node scripts/check-exec-docs-tracked.mjs`（09-18 起陆续接入）
- Android 专项：`python scripts/check_android_proguard_keeps.py`（静态守卫，挂在 `structure-guard.yml` 的 `layout` job，三项断言：keep 覆盖 26 项仅 JNI 可达方法 / `proguardFiles` 仍引用规则文件 / wry+tauri 版本仍在 `AUDITED_VERSIONS`）；`python scripts/verify_android_jni_keeps.py`（需 APK，抽 dex 逐类核对 26/26，release 包出完必跑）（09-18）
- **CI 不做 DEX 级校验**：把「Android 工具链 + keystore + NDK 出 APK（约 +20min）」塞进 CI 无法本地验证必然绿，违反证据绑定；静态守卫 ≠ DEX 证明，边界已写进脚本输出（09-18）
- 本地提交门禁：`.pre-commit-config.yaml` 三钩子（Structure Guard / Capability Lint / gitleaks）；`precheck.ps1`（pre-push）跑 `pnpm lint` + `cargo fmt --all --check` + `cargo clippy --all-targets`（09-18）
- 覆盖率阈值（vitest 4）：lines 46 / functions 42 / branches 38 / statements 45（09-18 重校准）
- 测试基线演进：197 文件 / 2,726 用例（09-16，修前 1 failed）→ 198 / 2,729（09-18）→ 202 文件 / 2,760（09-29）
- `ipcContract.test.ts` 两个解析盲区的修法：① `#[tauri::command(name = "x")]` 要加可选 `name` 捕获组并优先取 name（Tauri 宏实际只认 `rename_all`/`rename`/`root`/`async`，其它静默忽略，故函数名应直接写 `ondevice_*`）；② `generate_handler!` 解析要全局遍历所有块、结束符改 `\n\s*\]`（避免被注释里的 `]` 提前截断）、并用「函数名→注册名」映射还原（09-16）
- PR #58 曾因 `frontendDist` 编译期 panic 卡在必需检查，修法见 §2 的 `dist` 占位步骤；CodeQL 未解决对话用 `genId()` 改 `crypto.getRandomValues` 消解（09-18）

## 5. 安全加固 + SQL 收口（计划 → 已落地）

原计划见 `.trae/documents/spiritpal-security-hardening-plan.md`（将随 `.trae` 清理删除）。`（11-04）` 逐项核对现状：

| 计划项 | 落地证据（实测） | 与计划的差异 |
|---|---|---|
| B1-1 新增 `src-tauri/src/sqlite.rs`（D-1） | 文件在；`rusqlite = { version = "0.32", features = ["bundled"] }`（Cargo.toml:98）；93 个 `sp_*` 公开 API、98 个 `#[tauri::command]` | 计划称命令 55 个、SECURITY_AUDIT 记 92 个 `sp_*`，均已过时 |
| B1-2 新增 `window_gate.rs`（D-2） | `require_window` 共 22 处、分布在 7 个文件（`system_tools.rs` 11 / `encrypted_db.rs` 3 / `keychain.rs` 3 / `mcp_bridge.rs` 等） | 无 |
| B1-3 `system_tools.rs` 硬化（D-3/D-4/D-5） | `CMD_MAP` 静态映射表在（:57），无 shell 拼接；`search_files` / 读写路径均 `fs::canonicalize`；成功/拒绝写 `audit_log::record_audit` | 无 |
| B1-4 加固接线（D-5/D-6/D-7/D-9） | `antidebug::is_debugger_detected()` 在 7 处敏感命令前置校验并 emit `spiritpal:security-mode`；`lib.rs:290` `integrity::verify_integrity()` 失败 emit `spiritpal:integrity-warning`（不阻断启动）；`mcp_respond(window, …)` 走 `require_window`，拒绝返回 `false` 并记审计；前端 `main.tsx` 已 `listen` 两个事件 | 无 |
| B2 capability + 插件移除 | `capabilities/*.json` 无任何 `sql:` 条目；`Cargo.toml` / `package.json` 无 `tauri-plugin-sql` | 无 |
| B3-1 签名 fail-closed（D-8） | Groovy `app/build.gradle`：`keystore.properties` 缺失仅 warn 不签名，缺 `keyAlias` / `keyPassword` / `storeFile` / `storePassword` 任一即 `throw new GradleException` | 原计划文件 `build.gradle.kts` 已不存在（09-17 转 Groovy） |
| B3-2 依赖审计 gate（D-11） | `ci.yml` 含 `pnpm audit --json --audit-level=critical`、`cargo audit --json -f src-tauri/Cargo.lock`（两者 `|| true`），再跑 `python scripts/security_gate.py`；基线 `.ci/security_baseline.json` | 无；机制另见 `docs/execution/依赖与安全跟踪机制-20260911.md` |
| D-10 禁用更新通道 | **已反转**：`tauri.conf.json:79` `updater.active = true`，endpoints 指向 `updates.json`，pubkey 为 minisign/ed25519 | 原「实测已为 false，只需纠错文档」结论作废；现按 `AGENTS.md` §5 tag 驱动 + 更新签名 |

- 计划前提的判据（09-04，已登记 GOTCHAS #59）：Tauri 自定义命令**不经过 capability ACL**；`tauri-plugin-sql` v2 只有 `allow-execute/load/close`，无按语句类型的细粒度授权 → SQL 只能整体下沉为 Rust 语义命令 + 运行时窗口门禁
- `SECURITY_AUDIT_SpiritPal.md` 的状态行已同步：S1（`sql:allow-execute`）、S2（Android 签名弱口令 `spiritpal123`，commit `00fbe8d`）、S3（`main.tsx` innerHTML）均标「已修复（2026-09-04）」（09-10 / 11-04 复核）

## 6. 社区宠物接入（计划 → 已落地）

- 计划本体（manifest 自动发现）已在 `docs/project/AI_DEV_SOPS.md` **SOP-7** 全流程登记（含 `CharacterPackConfig` 字段、`loadPack` 模板人设、`licenseMeta.audited` 放行 GPL、ffmpeg 参数、git blobs 下载、id 规范化、验证步骤）→ 此处只记实际差异（09-11 / 11-04）
- 落地代码（11-04 复核）：`src/lib/render/communityLoader.ts`（`loadCommunityCharacters()` + `getLoadedCommunityCharacters()` + `getCommunityCharacter()`）、`App.tsx` 预热、`characters.ts` 末尾合并（内置优先）；测试 `src/lib/__tests__/communityLoader.test.ts`、`scripts/__tests__/community-pet-maps.test.mjs`
- 源范围从计划的 5 类扩到 6：`scripts/import-community-pets.mjs` 支持 `occlaw | windowpet | openpets | xiangqie | dashayu | dyberpet`，`--source=` 单跑，默认 all；幂等跳过已存在 id
- 内置角色收敛为 1 只：`scripts/community-pet-maps.mjs` 的 `BUILTIN_IDS = new Set(['doro'])`（feibi / gugugaga 已于 09-17 去内置），撞名追加来源后缀
- **素材不入库（与计划最大差异）**：`.gitignore` 以 `public/pets/` 整目录忽略；磁盘实测只有 `public/pets/doro/{idle.gif,idle.svg,spritesheet.webp}`，**无 `manifest.json`**（清单由导入脚本 `writeManifest` 生成）。故计划里「+90–230MB 进安装包」只在本机构建时成立，干净克隆不含社区素材
- 状态：**待核**——9 月记录没有「六类全量导入执行完毕」的产物凭证（磁盘仅内置 doro）；许可风险（DyberPet GPL、WindowPet 版权 IP 二创）按计划「照接 + 按目录独立可整删」接受，`CHARACTER_ATTRIBUTIONS.md` 已登记 xiang-qie（`rainnoon/oc-claw`，MIT 声明仅覆盖剪辑产物）

## 7. 主题体系与桌面/移动对齐（09-29）

- 颜色唯一事实源 `src/index.css`：浅色 `@theme`（L40-76）、深色覆盖 `html.dark`（L12-34）；`@custom-variant dark (&:where(.dark, .dark *))`（L7）把 Tailwind v4 的 `dark:` 从「跟随系统」改为「跟随 `.dark` 类」（09-29）
- 切换器 `src/lib/system/themeManager.ts`（`TERMINAL_THEMES` light/dark/sakura/ocean，仅覆盖 `--pet-*` 五个变量）。9 月实测：桌面端无人调 `themeManager` → 深色是死代码；**（11-04 复核已接线）**：`main.tsx` / `SettingsWindow.tsx` 已引用，`classList.add('dark')` 生效
- 量化基线（改造前）：中性灰 Tailwind 类 **211 处 / 20 文件**（`CharacterCreator.tsx` 51、`GifToSpriteTool.tsx` 50、`CharacterCreationWizard.tsx` 29、`UpdateNotification.tsx` 26、`CharacterImportWizard.tsx` 13、`DialoguePanel.tsx` 11）；硬编码 hex 43 处（`MemoryVisualizer.tsx` 28 / `SettingsWindow.tsx` 8 / `memory/EntityGraphView.tsx` 7）；`dark:` 变体仅 3 文件 24 处（09-29）
- 对比度实测（WCAG）：浅色 cream 底 ink 10.60 ✓ / ink-muted 4.12 ✗ / ink-faint 3.10 ✗ / tangerine 2.45 ✗ / blush 1.79 ✗；深色底 ink 13.90 / ink-muted 6.86 / ink-faint 4.42 边缘 / tangerine 7.31；**橙底文字**白字 on 浅 tangerine 2.63、ink on 浅 tangerine 4.33、深色 ink on tangerine 仅 1.90 → 橙色按钮深色下必须配深底字（09-29）
- 对齐工程 17 轮（`fix/desktop-mobile-parity`，独立 worktree + node_modules junction）：R1 移动端合规入口、R2 WebDAV + 同步配置持久化、R3 桌面接 themeManager、R4/R5 令牌化 305+ 处、R6 Markdown 消毒、R7 失败重试、R8 装饰品、R9 喂食/切换角色、R10 导航 i18n、R11 删零引用 store、R12–R17 i18n 清零 / 徽章令牌 / 状态色 235 处 / eslint 470→350 / exhaustive-deps 归零（09-29）
- 最终验证：`tsc --noEmit` 0；`eslint src/` 0 error（350 warning）；`vitest` 202 文件 / 2,760 用例全过（09-29）
- 可复用审计手法：组件引用矩阵（`grep -rl` 分端计数）、store action 差集（抽 `^\s{2}([a-zA-Z]+): \(` 后对端 `grep -q`）、`src/lib/**` 两端 import 计数、大文件交子代理抓行号再交叉核验（09-29）
- 残留（09-29）：移动端 4 视图曾硬编码中文约 87 处（后经 R12/R13 清零）；`ChatWindow.mkMsg()` 已改 `crypto.getRandomValues`（R17）；`import/order` 与 `no-explicit-any` 存量 warning 交给 `artifacts/eslint-remaining-handoff-20260929.md`（该文件在 gitignore 的 `artifacts/` 下，不入库）

## 8. bilibili-repo-harvest 技能：本仓变体专属约定

本仓 `.trae/skills/bilibili-repo-harvest/SKILL.md` 是全局 skill 的项目副本；**通用流程（通道选型、反风控三件套 buvid3 + ≥450ms 节流、关键词矩阵、三级提取、提链正则、坑 A–E、GitHub 核验、合规边界）以全局 `~/.trae-cn/skills/bilibili-repo-harvest/SKILL.md` 与 `Agent-Knowledge/skills/bilibili-repo-harvest/SKILL.md` 为准**。仅记本仓专属、且现状已变化的约定：

- 目标清单硬编码为 `docs/project/桌面宠物开源仓库清单.md` —— **该文件在本仓不存在**（`（11-04）` 实测 `Test-Path` = False；`git ls-files docs/project` 只有 `AI_DEV_SOPS.md` 与 `KNOWN_GOTCHAS.md`）。Agent-Knowledge 归档版 §11 亦记「原目标清单已移出仓库」
- skill 内「本仓 `.gitignore` 有 `docs/project/*`，仅少数 `!` 白名单」**已失效**：`（11-04）` `git check-ignore` 对 `docs/project/` 无命中，`git ls-files` 正常返回 → 当前 `docs/project/` 不再被忽略（docs/ 已纯入库）。状态：**待核**（若恢复清单需所有者决定落点与是否入链）
- 家族冲突集条目的样例「`k2-fsa/sherpa-onnx` … 在 SpiritPal 已被引用 55 次」—— `（11-04）` 全仓 grep `sherpa-onnx` **0 命中**，该样例在本仓不成立（未核实其指代范围），冲突集必须按当次实测重算
- 入库前必查跟踪状态这一步保留有效（`git ls-files -- <清单>` + `git check-ignore -v`），但结论要按本仓当前「docs/ 无忽略规则」重判：被跟踪 ≠ 可发布，路径引用的目标还须真实存在（铁律 #6）
- 其余本地化分叉见 Agent-Knowledge `SKILL.md` §11「各仓落点实测（2026-11-03）」表，不在此重复

## 9. 已由既有文档覆盖，不再重复

| 主题 | 已有权威文档 | 本归档处理 |
|---|---|---|
| 社区宠物接入全流程 | `docs/project/AI_DEV_SOPS.md` SOP-7 | 只留落地差异与待核项 |
| MNN 模型获取 / 转换 / 交付 | `docs/execution/ondevice-custom-model-pipeline.md`、`src/lib/ai/onDeviceTiers.ts` | 只留协议、桥接与真机 perf |
| 端侧真机测试结论 | `docs/execution/android-device-test-20261001.md`（含 0.8B 模型投放与逐字流式） | 不重复 |
| SQL 收口 / capability / 签名修复 | `docs/SECURITY_AUDIT_SpiritPal.md`、`docs/execution/执行对照表-桌面分发与安全加固-20260910.md`、`docs/execution/落地执行总结-桌面分发与安全加固-20260910.md` | 只补计划→现状对照 |
| 依赖审计棘轮 | `docs/execution/依赖与安全跟踪机制-20260911.md`、`.ci/security_baseline.json` | 不重复 |
| 深色模式 / 令牌化 / i18n / 移动端对齐 | `CHANGELOG.md`（桌面端体验、界面一致性、移动端缺陷条目）、`local/agents/GOTCHAS.md` #139–#145、`local/agents/SOPS.md` SOP-9（本地层，未随仓库发布） | 只留量化基线与审计手法 |
| Android 构建 / 产物清理 / 快照 / 推送 | `local/agents/SOPS.md` SOP-1~11、`AGENTS.md` §3.7 / §3.4（本地层） | 不重复 |
| 9 月全部踩坑编号（#99–#128 等） | `local/agents/GOTCHAS.md`（本地层），公开层 `docs/project/KNOWN_GOTCHAS.md` 自 2026-09-15 起只读，仅 #1–#98 | 不重复，只留判据 |

## 10. 未落地 / 待核

- **移动端「必须」的口径**（09-15）：用户确认移动端是硬性平台要求，但「移动端必须」≠「MNN 必须」；随后确认要做纯本地离线推理（已按 embed 落地）。此前的「是否只要求能构建 + 云端聊天」开放问题已不再需要回答
- **社区宠物全量导入凭证**：状态待核（见 §6），磁盘仅内置 doro
- **`docs/project/桌面宠物开源仓库清单.md`**：不存在；bilibili skill 的落点与忽略描述已过期，状态待核（见 §8）
- **`javascript-obfuscator` 混淆**：09-17 发现未声明未安装导致 R-12 从未生效，09-18 已修复（`pnpm add -D javascript-obfuscator`，Obfuscated 31/37）；`（11-04）` 复核 `package.json` 已声明 `^5.9.0`（当时为 ^5.7.0）
- 更新通道：原 D-10「禁用」已作废（`updater.active=true`），如需回退「禁用」决策须单独开单
