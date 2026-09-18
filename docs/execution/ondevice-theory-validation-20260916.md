# 端侧 MNN LLM 引擎内嵌 — 实测验证报告（2026-09-16）

> 配套： [`../agents/ondevice-embed-plan.md`](../agents/ondevice-embed-plan.md) · ADR [`../agents/ADR-0005-ondevice-llm.md`](../agents/ADR-0005-ondevice-llm.md)
> 本文件为 AGENTS.md v2.62 标记的「对外公开版 ondevice-* 报告（待补）」落盘；记录 2026-09-16 在本机（Windows + 火绒 + NDK 27）的实测结果。
> 诚实声明：Rust 侧交叉编译与构建链路为**本机实测**；Kotlin/JNI 桥与真机推理**已于 2026-09-16 真机验证**（见 §7，GOTCHAS #104/#105），本环境仅未做 NDK 本地编译。

---

## 0. 目标与范围

把 MNN 的 Android LLM 引擎（`libmnnllmapp.so` + `LlmSession` Kotlin/JNI 包装层）**编译进 SpiritPal 的 APK**，前端 `ondevice` provider 由 companion loopback 改为**进程内 Tauri 命令**（单进程持模型，无第二个 App、无 loopback 明文、无生命周期耦合）。

路线（见 embed-plan §2 Route A）：Tauri Rust 命令经 JNI 调 `SpiritPalOnDevice` 桥 → MNN `LlmSession` → token 经 JNI 回灌 → `app.emit("ondevice://token")` 流式。

---

## 1. 本机环境

- Windows + 火绒杀毒（扫描所有本地盘，拖慢 kotlinc、对新生成 `.so` 持锁）
- JDK 21（Eclipse Adoptium）；Android SDK/NDK 27（`%LOCALAPPDATA%/Android/Sdk`，NDK `27.0.12077973`）
- cargo/rustup 在 `C:/Users/Doro/.cargo`，4 个 android target 已装
- `cargo install cargo-ndk --version "^3"`（装到 `~/.cargo/bin/cargo-ndk.exe`）

---

## 2. 构建门禁结果（已实测通过）

| 步骤 | 命令 | 结果 |
|---|---|---|
| Rust lib 类型检查 | `cargo check --lib`（含 `#[cfg(mobile)]` `engine.rs`） | exit 0 |
| Rust 移动端交叉编译 | `cargo build --release --target aarch64-linux-android --lib` | 通过（`CARGO_BUILD_JOBS=1` 绕沙箱并行 clang 被拦；本机可省） |
| arm64 release APK | `gradlew :app:assembleArm64Release -x rustBuildArm64Release` | 产出可装机 APK（~139MB），`apksigner verify` 通过 `CN=SpiritPal Test Build` |
| universal release APK | `gradlew assembleRelease`（含 rustBuild 全 ABI） | BUILD SUCCESSFUL，~152MB |

> 24 个 Rust 移动端编译错误（原 `engine.rs` 从未被编译）已全部修复，见 §3。

---

## 3. Rust 移动端 24 个编译错误与修复（根因归类）

`engine.rs`（`#[cfg(mobile)]`）此前从未进入编译，实测 **24 个错误**，按根因归为 4 类：

### 3.1 Tauri v2 无 `tauri::android::context`
- **现象**：原代码取 Android `Context` 用 `tauri::android::context()` → 编译错误（该路径在 Tauri v2 不存在）。
- **修复**：自定 `JNI_OnLoad` 缓存 `JavaVM` + `SpiritPalOnDevice` 的 `GlobalRef`；所有 JNI 调用走缓存的 `JavaVM`/`GlobalRef`，同时规避 native 线程 `find_class` 走 system class loader 失败。

### 3.2 `RuntimeOrDispatch` / `ManagerBase` 在 `pub(crate) mod sealed` 内（外部不可用）
- **现象**：原代码直接引用 `RuntimeOrDispatch`、`ManagerBase` 等类型 → 编译错误（这些类型在 Tauri v2 的 `pub(crate) mod sealed` 中，外部 crate 不可访问）。
- **修复**：不再依赖这些内部类型；JNI 桥经缓存的 `GlobalRef` + `jni` crate 标准 API 实现，调度/Manager 相关逻辑改用可公开访问的接口或去除。

### 3.3 `load_model` 同步命令导致 ANR
- **现象**：原 `load_model` 为**同步** Tauri 命令 → 在主线程内联执行；加载 2B 模型会 ANR（Application Not Responding）。
- **修复**：改 `async fn` + `spawn_blocking`，把加载移到后台线程；流式生成经 `channel` + `app.emit` 回前端。

### 3.4 `generate_handler!` 命令路径必须写全模块路径
- **现象**：`generate_handler!` 按函数**所在模块路径**查 `__cmd__*` 宏；写 `ondevice_generate` 简名找不到对应宏。
- **修复**：`lib.rs` 命令注册写 `ondevice::engine::generate`（及 `load_model`/`unload_model`/`list_models`/`cancel`），与 `engine.rs` 中 `#[tauri::command]` 定义的模块路径一致。

> 上述 4 类覆盖实测 24 个错误；根因与正确 API 已落地并通过 `cargo check` / 交叉编译。逐条错误号未逐条保留，但修复已验证可复现。

---

## 4. 正确 API 速查（防回归）

- **`JNI_OnLoad` 缓存**：`JavaVM`（全局）+ `SpiritPalOnDevice` `GlobalRef`。
- **engine.rs 五命令**：`ondevice_generate` / `load_model` / `unload_model` / `list_models` / `cancel`；JNI 回拔 `nativeOnToken` / `nativeOnDone` / `nativeIsCancelled`。
- **`mobile_total_ram_gb()`**：读 `/proc/meminfo` 的 `MemTotal`（与 `ActivityManager.MemoryInfo.totalMem` 同源），免 JNI 管线。
- **`detect_device_tier`**：桌面返 `T2`；移动端由 `mobile_total_ram_gb` 分档（T0/T1/T2）。
- **proguard**：app proguard 规则须 `-keep class com.alibaba.mnnllm.android.SpiritPalOnDevice { *; }`，否则混淆破坏 JNI 链接（真机 release 必踩）。

---

## 5. 构建链路改造（与 APK 构建共用，见 build-prompt）

- **`buildSrc/BuildTask.kt`**：`rustBuild*` 任务由 `pnpm tauri android android-studio-script`（需 Android Studio 的 WebSocket）改为 `cargo ndk`（CLI 直跑）。⚠️ cargo-ndk **必须**以 `cargo ndk` 调用，不能直接跑 `cargo-ndk.exe`。
- **杀软文件锁**：cargo-ndk 自带拷贝 `.so` 撞火绒持锁（`ERROR_SHARING_VIOLATION` code 32）→ 改为 `cargo ndk ... build`（去掉 `-o`）只编译，再在 Kotlin 里用带重试（10 次×2s）的 `Files.copy(REPLACE_EXISTING)` 拷到 `jniLibs/<abi>/`。
- **注册表缓存**：`tauri.settings.gradle` 把 `:tauri-android` 等 `projectDir` 硬编码指向 `cargo/registry/src/<hash>/...`，缓存被清 → 构建前先 `cargo fetch` 并与其合并为同一条命令。
- **ABI 映射键**：插件 `target` 用 `aarch64`/`armv7`/`i686`/`x86_64`（**不是** `arm`）。
- **Groovy DSL**：`app/build.gradle`、`tauri.build.gradle`、`build.gradle` 由 `.kts` 转 `.gradle`，消除 kotlin-dsl `GenerateProjectAccessors` ~72s 超时。

> ⚠️ **前端 assets 同步缺口**：改造后 `rustBuild` 不再执行 `pnpm tauri android android-studio-script`，故 `dist → app/src/main/assets` 的前端同步**已不在该任务内**。出 release 包前须手动 `cp -r dist/. src-tauri/gen/android/app/src/main/assets/`（并先 `obfuscate-and-sri.mjs` 再编 Rust，保证 SRI 表与前端同版，见 GOTCHAS #101）。

---

## 6. 风险与待决（详见 embed-plan §5）

- **JNI 签名漂移**：锁定 MNN 引擎 **3.6.1** 对应 commit 快照（本机真机实测 decode 18–29 tok/s、prefill ~74 tok/s，非 master）。升级须满足：① 确有收益；② 复核 `LlmSession.initNative`/`submitNative` 签名无变化；③ 真机回归。
- **内存**：单进程持 2B Q4 ≈ 1.5GB + SpiritPal 自身；低内存机（T0）禁用，T1 加载后建议空闲卸载（`models.rs::evict_idle` 待落）。
- **ABI 仅 `arm64-v8a`**：官方 MNN Chat APK 不含 x86_64；要 v7a/x86_64 需自编引擎。
- **体积**：只需 2 个 `.so` 合计 8.9MB（`libmnnllmapp.so` 1.39MB + 单体 `libMNN.so` 7.5MB），静态 libc++，无需 `libc++_shared.so`。
- **许可证**：MNN Apache-2.0；vendored Kotlin 同许可；`tauri-plugin-local-ai` 许可证未声明 → 拷贝源码（已在 `mod.rs` 头部注明出处），不作 cargo 依赖。

---

## 7. 真机联调（✅ 已完成，2026-09-16，见 GOTCHAS #104 / #105）

设备：realme RMX5010 / arm64-v8a / Android 16（SDK 36）/ 14.75GB RAM。结论：**模型成功加载并流式生成**（单进程，Native Heap ≈1.7GB / PSS ≈1.9GB）。

1. **Kotlin 桥编译**：`SpiritPalOnDevice.kt` / 自写最小 `LlmSession.kt` 经 `tauri android build` 真机编译通过，JNI 链接正常（`engine.rs` 交叉编译 + 真机双保险）。
2. **真机推理链路**：`adb install -r app-arm64-release.apk` → 模型管理下载 `Qwen3.5-2B-MNN`（ModelScope）→ 加载 → 对话；验证单进程、流式可用、无双进程内存、T1/T2 分档、未加载优雅降级。
3. **真机发现并修复 6 个问题**（GOTCHAS #104）：① `#[tauri::command(name=)]` 被 Tauri 静默忽略 → 函数名须等于 invoke 名；② 模型目录按 `identifier` 拼路径包名 `-`/`_` 不一致；③ 应用自建目录 0770 致 `adb push` 写不进（需放宽到 0771/0777）；④ 移动端走 `MobileSettingsView` 而非桌面设置窗；⑤ `chat()` 未接移动端进程内分流（`onDeviceGenerate` 死代码）；⑥ 移动端聊天强要 API Key 挡住端侧。
4. **速度量化**（GOTCHAS #105）：Qwen3.5-2B-MNN @ CPU 4 thread / precision=low → prefill ≈74 tok/s、decode 18–29 tok/s（随上下文长度衰减；长上下文 +2k tok 历史 KV cache 时 prefill 飙到 151s）。
5. **构建侧**：Gradle daemon 锁争用 → `./gradlew --stop`（或 `--no-daemon`）后重试（GOTCHAS #104 ⑦）。
6. **仍须注意**：ModelScope 大文件下载静默截断（HTTP 200 少 ~19MB）→ 必须校验体积 + SHA-256（GOTCHAS #102），否则拿到跑不起来的模型。

---

*落盘：2026-09-16 实测；2026-09-17 由 AI 补写公开版（原 AGENTS.md 标记的待补缺口）。*
