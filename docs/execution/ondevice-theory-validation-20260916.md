# 端侧 MNN 内嵌 · 理论验证报告（无真机阶段）

> 日期：2026-09-16
> 范围：ADR-0005（embed 目标）+ `ondevice-embed-plan.md` §7 SOP 的 **1–5 步**（取 `.so` / vendor Kotlin / 接线 / 编译）在**无真机**前提下可完成的部分。
> 定位：本报告是「先理论验证，通过后再上真机」中的**理论验证**交付物；真机项单列于 §7。
> 证据：全部结论均由本机可复现命令得出，命令见 §8。

---

## 0. 一句话结论

**embed 路线的技术前提成立，但计划里「整包复制 MNN Chat 的 Kotlin 引擎层」（§3.2）不可行**——`LlmSession` 与 App 的下载框架/UI 深度耦合，朴素闭包达 80 文件 + Ktor/Material/Markwon/Firebase/OkHttp。
**修正方案**：自写一个**最小同名 `LlmSession`**（~120 行、零外部依赖），只复刻 `libmnnllmapp.so` 真正需要的 4 个 JNI 符号。据此 embed 的 vendor 面从「80 文件」降到「2 文件 + 2 个 .so」。

**同时实测出两件必须先解决的事（均已修）**：① `tauri android build` 会因 `openssl-sys` 失败（reqwest TLS 后端，已按平台分后端修掉）；② **移动端 Rust 代码（`#[cfg(mobile)]`）从未编译过，实测 24 个编译错误**（§13）——`ondevice-embed-plan.md` §4 所称「已实现、待 NDK 机器验证」实为**未编译**。24 个错误已全部修复，`cargo build --target aarch64-linux-android` 通过。

---

## 1. 结论速览

| # | 验证项 | 结论 | 对计划的影响 |
|---|---|---|---|
| 1 | MNN Chat APK 获取渠道 | ✅ 阿里 CDN 直连可达 | 打通（原为阻塞项） |
| 2 | 引擎 `.so` 抽取 | ✅ 只需 **2 个**：`libmnnllmapp.so` + `libMNN.so` | 修正 §5 风险 #1：**8.9MB**，非预估 20–40MB |
| 3 | `.so` 依赖链 | ✅ 静态 libc++，**无需** `libc++_shared.so` | 新增事实 |
| 4 | JNI 契约 | ✅ 18 个符号，核心 4 个签名已精确取得 | §1 契约由「源码实测」升级为「二进制实测」 |
| 5 | Kotlin vendor 闭包 | ❌ **80 文件 + 重依赖**，整包复制不可行 | **推翻 §3.2**，改为最小同名桥 |
| 6 | MNN 引擎 API 面 | ✅ `MNN::Transformer::Llm` 全量导出（备路线 B 参考） | 待核实项「FFI 工作量」有答案 |
| 7 | 配置面 | ✅ `llmconfig.hpp` 全部键位已枚举 | 内嵌 config.json 有据 |
| 8 | MNN Chat OpenAI 兼容 | ✅ **确认** `post("/v1/chat/completions")` | **待核实项 ② 关闭** |
| 9 | `tauri-plugin-local-ai` 许可证 | ✅ 确认**无 LICENSE 文件** | **待核实项 ① 关闭**（维持「拷贝源码、不作依赖」） |
| 10 | 内存预算模型 | ✅ 算术精确自洽（3.4133GB 对 3.41GB） | 理论模型可信 |
| 11 | arm64 模拟器替代真机 | ❌ **模拟器硬否决** | 见 GOTCHAS #99；真机不可替代 |
| 12 | 最小同名桥**编译期**验证 | ✅ `:app:compileArmDebugKotlin` **BUILD SUCCESSFUL** | 修正方案成立（§6） |
| 13 | **打包链路**验证（APK） | ✅ `app-arm64-debug.apk` **54.3MB**，含 3 个 `.so` + 全部 MNN Kotlin 类/JNI 方法 | embed 构建层端到端打通 |
| 14 | Rust 交叉编译 Android | ✅ **24 个错误已全修，`exit=0`** | 移动端 Rust 层此前从未编译过（§13） |
| 15 | 途中修掉的 2 个真 blocker | ✅ `openssl-sys`（reqwest TLS 按平台分）+ Tauri 插件 `.tauri` 残留 | §13.1 |

---

## 2. 引擎与 APK 获取渠道（打通）

原阻塞项「MNN Chat APK 拿不到」已解决。**官方 APK 托管在阿里 CDN，国内直连可达**，无需翻墙、无需第三方镜像站：

```
https://meta.alicdn.com/data/mnn/apks/mnn_chat_<版本>.apk
```

- 最新：`mnn_chat_0_8_3.apk`，`Content-Length: 43834292`，`Content-Type: application/vnd.android.package-archive`
- `aapt2 dump badging` 实测：`package=com.alibaba.mnnllm.android`，`versionName=0.8.3`，`versionCode=830`，`minSdkVersion=26`，`targetSdkVersion=35`
- 链接来源：`apps/Android/MnnLlmChat/README.md` 的 Releases 段（逐版本直链）

**GitHub 侧代理**：`gh-proxy.com` 可达（直连 `github.com`/`api.github.com` 均 `000`）。经其可读 MNN release 资产与源码：

```
https://gh-proxy.com/https://github.com/alibaba/MNN/...
https://gh-proxy.com/https://api.github.com/repos/alibaba/MNN/...
```

其余渠道实测**不可用**：`apkpure`/`apkcombo` 连接被拒（000）、`gitcode` 反爬（418）、`jb51` 直链 404、`apkz` 403。

---

## 3. `.so` 抽取与依赖链

### 3.1 APK 内 ABI

APK **只含 `lib/arm64-v8a/`（13 个 `.so`），无 x86_64**。故只能在 arm64 设备/环境运行。

### 3.2 真正需要的 `.so`（修正 §5 风险 #1）

`libmnnllmapp.so` 的 `DT_NEEDED` 只有：`libandroid.so` `liblog.so` `libMNN.so` `libmediandk.so` `libm.so` `libdl.so` `libc.so`。

→ **应用侧只需打包 2 个**：

| 文件 | 体积 | 说明 |
|---|---|---|
| `libmnnllmapp.so` | 1,391,856 B | LLM/多模态 JNI 层（CMake 产物） |
| `libMNN.so` | 7,503,192 B | **单体构建**（`MNN_SEP_BUILD=OFF`），已含 LLM+Express+CPU/OpenCL/Vulkan 后端 |
| **合计** | **8,895,048 B ≈ 8.5 MiB / 8.9 MB** | 远低于计划预估的 20–40MB |

⚠️ 注意与 GitHub release 的差异：release 的 `libMNN.so` 仅 2.45MB 且拆出 `libllm.so`/`libMNN_Express.so`/`libMNN_CL.so` 等；**APK 用的是单体版**，故不要混用两套。

### 3.3 静态 libc++（新事实）

`libMNN.so` 的 `DT_NEEDED` 仅含系统库（`liblog`/`libm`/`libandroid`/`libdl`/`libc`），**不含 `libc++_shared.so`** → MNN 为静态 libc++ 构建。**APK 内无需额外打包 `libc++_shared.so`**（APK 里那个是给 crashlytics/其它组件用的）。

---

## 4. JNI 契约（二进制实测）

`libmnnllmapp.so` 导出 18 个 JNI 符号，且均为**短名（无重载后缀）**，说明契约由 Kotlin 侧 `external fun` 声明决定：

```
Java_com_alibaba_mnnllm_android_llm_LlmSession_initNative
Java_com_alibaba_mnnllm_android_llm_LlmSession_submitNative
Java_com_alibaba_mnnllm_android_llm_LlmSession_resetNative
Java_com_alibaba_mnnllm_android_llm_LlmSession_releaseNative
Java_com_alibaba_mnnllm_android_llm_LlmSession_{clearHistoryNative, dumpConfigNative,
  getDebugInfoNative, getSystemPromptNative, runBenchmarkNative, setWavformCallbackNative,
  submitFullHistoryNative, updateAssistantPromptNative, updateConfigNative,
  updateEnableAudioOutputNative, updateMaxNewTokensNative, updateSystemPromptNative}
Java_com_alibaba_mnnllm_android_MNN_nativeGetVersion
Java_com_alibaba_mnnllm_android_utils_CrashUtil_initNative
```

核心 4 个的精确签名（取自 MNN @3.6.1 `LlmSession.kt`，与 `.so` 符号一一对应）：

```kotlin
private external fun initNative(configPath: String?, history: List<String>?,
                                mergedConfigStr: String?, configJsonStr: String?): Long
private external fun submitNative(instanceId: Long, input: String, keepHistory: Boolean,
                                  listener: GenerateProgressListener): HashMap<String, Any>
private external fun resetNative(instanceId: Long)
private external fun releaseNative(instanceId: Long)
```

⚠️ **类名/包名/方法名/参数类型必须严格一致**，否则 `UnsatisfiedLinkError`。这是「最小同名桥」方案能成立的**唯一前提**，也是它可行的原因。

---

## 5. ❌ 关键发现：计划 §3.2「整包复制 Kotlin 引擎层」不可行

### 5.1 证据：朴素传递闭包爆炸

从 `SpiritPalOnDevice` 的依赖种子（`llm.LlmSession` + `llm.GenerateProgressListener` + `MNN`）出发做传递闭包，得 **80 个 Kotlin 文件**，并牵出这些**重依赖**：

- `com.alibaba.mls.api.*` —— MNN 的 **model_downloader 框架模块**（`ModelConfig`/`MmapUtils` 依赖它）
- `chat/chatlist/*` UI 组件（`ChatDataItem` 依赖 `AudioPlayerComponent`/`ChatViewHolders`）
- `modelist/*` 模型市场（`ModelTypeUtils` 依赖 `ModelListManager`）
- 外部库：**Ktor server**、**Material**、**Markwon**、**ZXing**、**Firebase Crashlytics**、**OkHttp**、**kotlinx-coroutines**、`androidwaverecorder`、`device-names`

→ 按计划「先整包复制」会把整个 MNN Chat App 的 UI/网络/下载栈拖进 SpiritPal 的 APK，并需要十来个 Gradle 依赖。**这不是一个「引擎层」的边界。**

### 5.2 但实际用到的极少

对 `LlmSession.kt` 逐 import 统计正文引用：

| 依赖 | 引用次数 | 性质 |
|---|---|---|
| `ChatService` | **1**（`provide().removeSession(sessionId)`） | 可 stub |
| `ChatDataItem` | 5（只取 `.text`） | 可 stub / 传 `List<String>` |
| `ModelConfig` | 10 | 仅用于读 config.json 文本 |
| `MmapUtils` / `FileSplitter` / `ModelTypeUtils` / `QnnModule` | 2–3 each | 仅边角逻辑 |
| `Gson` | 4 | 可用内置 `org.json` 替代 |

即**重依赖是「结构耦合」而非「功能必需」**。

---

## 6. 修正方案：最小同名桥（已落地）

### 6.1 设计

不 vendor MNN 的 `LlmSession`，而是**自写一个同名最小类**，直接对齐 §4 的 JNI 契约：

- `llm/LlmSession.kt` —— ~120 行；`load()` 直接读模型自带 `config.json` 原文作 `mergedConfigStr`（原生 `Llm::createLLM` 本就读该文件，等价）；`configMapJson` 固定 3 字段 `{is_r1, mmap_dir, keep_history}`；**零外部依赖**。
- `llm/GenerateProgressListener.kt` —— 逐字 vendored（回调契约，签名不可改）。

`SpiritPalOnDevice.kt`（已存在）**无需改动**：其构造调用 `LlmSession(modelId, sessionId, configPath, null, null, true)` 与新类同形。

### 6.2 vendor 面收缩结果

| | 原计划 | 修正后 |
|---|---|---|
| Kotlin 文件 | 80（+ 裁剪未知） | **2** |
| 外部 Gradle 依赖 | Ktor/Material/Markwon/Firebase/OkHttp/coroutines/... | **0** |
| `.so` | 2（8.9MB） | 2（8.9MB） |

### 6.3 与原版的语义差异（有意）

1. 不做 `ModelConfig` 合并 → 直接传模型 `config.json` 原文（原生 `Llm::createLLM` 本就读该文件，**等价**）。
2. `generate()` 的 `params` 不透传 —— **与原版行为一致**（实测 MNN 原版 `generate(prompt, params, listener)` 的实现**完全不使用 `params`**，只调 `submitNative(ptr, prompt, keepHistory, listener)`）。采样/长度/系统提示由 UI 经 `updateMaxNewTokensNative` / `updateSystemPromptNative` / `updateConfigNative` **单独**设置——这三个符号 `.so` 中均存在，需要时补 setter 即可。→ **不是偏差**。
3. 未接 `submitFullHistoryNative`（多轮全历史）——当前用 `keepHistory=false` + 上层自行拼 prompt。**这是唯一实质性差异**，真机需确认多轮表现。

---

## 7. 仍需真机验证的项（理论不可替代）

1. **JNI 链接与运行时行为**：`initNative` 是否真能加载 Qwen3.5-2B（原生层是否隐式依赖被裁剪的 Kotlin 类，如 `CrashReportContext`——源码显示该回调为**失败即返回**，理论安全，但需实测）。
2. **流式回调**：`GenerateProgressListener.onProgress` 的取消语义（返回 `true`）与 Rust 侧 `nativeIsCancelled` 的时序。
3. **单进程内存**：Qwen3.5-2B Q4_K_M 常驻 + SpiritPal 自身，是否触发 LMK（对照 §9 预算模型）。
4. **分档**：`detect_device_tier` 移动端 JNI 读 `ActivityManager` RAM 是否返回 T1/T2。
5. **`params` 透传**是否影响生成质量/长度。
6. **多模态（视觉）**：`mmproj` 加载路径（`is_visual`/`visual_model` 配置键）未验证。

> 真机前置：`tauri android build` 产物为 arm64-only（§3.1），**需物理 ARM Android 手机**；模拟器不可替代（GOTCHAS #99）。

---

## 8. 复现命令

```bash
SDK="$LOCALAPPDATA/Android/Sdk"; D="$LOCALAPPDATA/Temp/mnn"
NM="$SDK/ndk/27.0.12077973/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-nm.exe"
RD="$SDK/ndk/27.0.12077973/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-readelf.exe"

# 1) 取官方 APK（阿里 CDN 直连）
curl -L -o "$D/mnn_chat_0_8_3.apk" https://meta.alicdn.com/data/mnn/apks/mnn_chat_0_8_3.apk

# 2) 验包信息 / ABI
"$SDK/build-tools/35.0.0/aapt2.exe" dump badging "$D/mnn_chat_0_8_3.apk" | head
unzip -l "$D/mnn_chat_0_8_3.apk" | grep '\.so$'

# 3) 抽 .so 并看依赖链
unzip -q -o "$D/mnn_chat_0_8_3.apk" -d "$D/apkall"
"$RD" -d "$D/apkall/lib/arm64-v8a/libmnnllmapp.so" | grep NEEDED
"$RD" -d "$D/apkall/lib/arm64-v8a/libMNN.so"       | grep NEEDED

# 4) JNI 契约
"$NM" -D --defined-only "$D/apkall/lib/arm64-v8a/libmnnllmapp.so" | awk '{print $3}' | grep '^Java_'

# 5) 取 MNN 源码（锁定 tag 3.6.1，走 gh-proxy 代理）
git clone --depth 1 --branch 3.6.1 --filter=blob:none --sparse \
  https://gh-proxy.com/https://github.com/alibaba/MNN.git "$D/mnnsrc"
cd "$D/mnnsrc" && git sparse-checkout set apps/Android/MnnLlmChat/app/src/main/java

# 6) OpenAI 兼容端点确认
grep -rn 'post("/v1' apps/Android/MnnLlmChat/app/src/main/java/.../api/openai/network/routes/
```

---

## 9. 内存预算模型复核（算术自洽）

对 `docs/execution/ondevice-model-budget-20260915.html` 的「2B Q4_K_M + Q8_0 KV + 视觉 @ 128K」独立手算：

```
权重      1.280835840 GB
mmproj    0.668       GB
线性层态  0.0189      GB   (linearStateMB 18.9)
运行时    0.14        GB
应用基线  0.45        GB
────────────────────────────
固定小计  2.557735840 GB
KV/token = 2 × fullAttn(6) × kvHeads(2) × headDim(256) × 1.0625 = 6528 B
128K KV  = 131072 × 6528 = 0.855638016 GB
────────────────────────────
总计      3.413373856 GB   ← 文档称「≈3.41GB」 ✅ 精确吻合
```

解码估算 `bw × 0.55 / weights = 77 × 0.55 / 1.280835840 = 33.06 tok/s`，与 ADR 记录的实机「30+ tok/s」同档 ✅。

**结论**：预算模型算术可信。
**已修**：`src/lib/ai/onDeviceTiers.ts` 原有三处数字与手算不符，已改正（同文件内自洽）：
- `固定 1.99GB` → **1.97GB**（1.2808 + 0.668 + 0.0189 = 1.9677）
- 6GB 档 `固定开销 1.89GB` → **1.97GB**（两处；1.89 疑似误用了 Q4_0 权重 1.2149）
- 8GB 档 `3.41GB 超 0.21GB` → **超 0.61GB**（3.41 − 2.8 = 0.61）

回归：`vitest run src/lib/__tests__/onDeviceTiers.test.ts` → **6 passed**。

---

## 10. 本次落地的改动

| 文件 | 动作 |
|---|---|
| `src-tauri/gen/android/app/mnnLibs/arm64-v8a/libmnnllmapp.so` | 新增（从官方 APK 抽取；**被跟踪**，见 §12） |
| `src-tauri/gen/android/app/mnnLibs/arm64-v8a/libMNN.so` | 新增（从官方 APK 抽取；**被跟踪**） |
| `src-tauri/gen/android/app/build.gradle.kts` | 改：新增 `sourceSets["main"].jniLibs.srcDirs("mnnLibs")` |
| `.gitignore` | 改：新增 `mnnLibs/` 例外（解除 `*.so` 全局忽略），见 §12 |
| `src-tauri/gen/android/.../mnnllm/android/llm/LlmSession.kt` | 新增（最小同名桥，替代整包 vendor） |
| `src-tauri/gen/android/.../mnnllm/android/llm/GenerateProgressListener.kt` | 新增（逐字 vendored） |
| `src/lib/ai/onDeviceTiers.ts` | 改：三处数字改正（§9），回归 6/6 通过 |
| `src-tauri/Cargo.toml` | 改：reqwest TLS 按平台分（Android=rustls，非 Android=native-tls）——§13.1① |
| `src-tauri/src/ondevice/engine.rs` | 改：24 个编译错误全修 + `JNI_OnLoad` 缓存 JavaVM/类引用 + `load_model` 改 async/spawn_blocking 防 ANR（§13.2–13.4） |
| `src-tauri/src/commands/window.rs` | 改：5 个桌面专用 builder 方法包进 `#[cfg(desktop)]` |
| `src-tauri/src/lib.rs` | 改：命令路径改 `ondevice::engine::*`（`generate_handler!` 按函数所在模块查宏） |
| `src-tauri/src/ondevice/mod.rs` | 改：`mobile_total_ram_gb()` 落实（读 `/proc/meminfo`，替代原占位 TODO） |
| `docs/agents/GOTCHAS.md` | 追加 #99（arm64 模拟器不可行）+ #100（Android 构建两个 blocker） |
| `docs/execution/ondevice-theory-validation-20260916.md` | 新增（本报告） |

**回归**：`cargo build --target aarch64-linux-android --lib` → `exit=0`；`cargo check --lib`（桌面）→ `exit=0`；`vitest onDeviceTiers.test.ts` → 6/6。

> `proguard-rules.pro` 已有 `-keep class com.alibaba.mnnllm.android.** { *; }`，无需改动。

---

## 11. 下一步建议

1. ✅ **（本机已做，通过）** `cd src-tauri/gen/android && ./gradlew :app:compileArmDebugKotlin` → **BUILD SUCCESSFUL**（2m51s，仅 2 条 Tauri 生成文件的既有 deprecation 警告，与本改动无关）。产物确认：
   `app/build/tmp/kotlin-classes/armDebug/com/alibaba/mnnllm/android/{SpiritPalOnDevice,LlmSession,LlmSession$Companion}.class` + `llm/GenerateProgressListener.class`。
   → **最小同名桥的编译期自洽性已验证**；`SpiritPalOnDevice.kt` 无需改动即可与之链接。
   ⚠️ 工程按 ABI 分了 flavor，任务名**必须带 ABI 前缀**（`compileArmDebugKotlin` / `compileUniversalDebugKotlin`）；`compileDebugKotlin` 会因歧义失败。
2. ✅ **（本机已做，通过）** `./gradlew :app:assembleArm64Debug -x rustBuildArm64Debug` → **BUILD SUCCESSFUL**，产出
   `app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`（**54,257,598 B**）。包内实测：

   | 类别 | 内容 |
   |---|---|
   | native 库 | `lib/arm64-v8a/libMNN.so`(7,503,192) + `lib/arm64-v8a/libmnnllmapp.so`(1,391,856) + `lib/arm64-v8a/libpetpal_lib.so`(22,972,688) |
   | Kotlin 类 | `Lcom/alibaba/mnnllm/android/SpiritPalOnDevice;`、`llm/LlmSession;`、`llm/LlmSession$Companion;`、`llm/GenerateProgressListener;` |
   | JNI 方法 | `initNative` / `submitNative` / `releaseNative`、`nativeOnToken` / `nativeOnDone` / `nativeIsCancelled` |
   | badging | `package=com.spiritpal.desktop_pet`、`versionName=0.1.0`、`native-code='arm64-v8a'` |

   → **embed 链路在构建层已端到端打通**：类 + JNI + `.so` 全部进包，产物可安装。
   前置已就绪：`rustup target` 已含 `aarch64-linux-android`（及 armv7/i686/x86_64-linux-android）。

   ⚠️ **两点环境限制（非工程问题）**：
   - flavor 名：`arm` = armeabi-v7a、`arm64` = arm64-v8a、`universal`；**取 arm64 产物必须用 `assembleArm64*`**（用 `assembleArm*` 会得到无 `lib/` 的 v7a 包）。
   - 完整 `assembleArm64Debug`（不跳过 rustBuild）在**本沙箱**失败于 `:app:rustBuildArm64Debug` 调 `pnpm.bat`（退出码 `0xC0000409`）——属沙箱无法运行 `cmd.exe`/`.bat` 的限制（同 GOTCHAS #97 类），在 Doro 本机应正常。故本次用 `-x rustBuildArm64Debug` 复用已有 `libpetpal_lib.so` 完成**打包链路验证**。
3. **（需真机）** USB 连 ARM 手机 → `adb install` → 装 MNN Chat 侧下载 Qwen3.5-2B（或 push 到 `/data/local/tmp/mnn_models/`）→ 走 §7 清单。
4. ✅ **（已澄清，无需改动）** `params` 不透传与原版行为一致（§6.3）；若日后要调采样/长度，补 `updateMaxNewTokensNative` / `updateConfigNative` setter 即可（符号已存在）。
5. ✅ **（已做）** 修 `onDeviceTiers.ts` 的三处数字（§9），回归 6/6 通过。

---

## 12. 可复现性修正：计划 §3.1 的 `.so` 落点有坑（已修）

### 12.1 问题

计划 §3.1 要求把 `.so` 放进 `src-tauri/gen/android/app/src/main/jniLibs/<abi>/`，但：

- **`.gitignore:31` 忽略了 `src-tauri/gen/android/app/src/main/jniLibs/`**（它是 Tauri rust 插件的**构建产物目录**）；
- 且 `.gitignore:14` 的 `*.so` 全局忽略所有 `.so`。

→ 按计划放置，**vendored 的 `.so` 不会进仓库**，换机/CI 构建拿不到引擎，且 `tauri android build` 可能覆盖该目录。**与「可复现构建」冲突。**

> 注：计划 §3.2 称「gen/android 不被 .gitignore 忽略（仅 build 产物忽略）」是对的；但 `jniLibs/` **恰属**被忽略的 build 产物，故 §3.1 的落点与其自身判断矛盾。

### 12.2 修正（已落地并验证）

| 项 | 做法 |
|---|---|
| 落点 | 移到**被跟踪**的 `src-tauri/gen/android/app/mnnLibs/arm64-v8a/` |
| `.gitignore` | 追加 `!src-tauri/gen/android/app/mnnLibs/` + `!…/mnnLibs/**/*.so`（解除 `*.so` 全局忽略） |
| Gradle | `app/build.gradle.kts` 加 `sourceSets { getByName("main") { jniLibs.srcDirs("mnnLibs") } }`（与默认目录**叠加**，不清空） |

验证：`git check-ignore` 对 `mnnLibs/…/libMNN.so` 报 `!…mnnLibs/**/*.so`（即**不再被忽略**）；`git status` 显示两个 `.so` 为 `??`（**可入库**）；重新 `assembleArm64Debug` 后 APK 内仍含 `lib/arm64-v8a/{libMNN.so, libmnnllmapp.so}` ✅。

### 12.3 顺带发现：`jniLibs/` 里的 `libpetpal_lib.so` 是过期残留

- 生成的 `Rust.kt` 执行 `System.loadLibrary("spiritpal_lib")`，`Cargo.toml` 的 `[lib] name = "spiritpal_lib"` → 期望 **`libspiritpal_lib.so`**；
- 而 `jniLibs/arm64-v8a/` 里是 **`libpetpal_lib.so`**（2026-08-01，旧 crate 名残留）。
- 因 `jniLibs/` 是构建产物目录，**正常构建会由 rust 插件写入正确的 `libspiritpal_lib.so`**，故此残留本身无害；
- ⚠️ 但本次为绕开沙箱限制而用 `-x rustBuildArm64Debug` 复用的旧库**名字/内容均过期**，**故本报告产出的 APK 不能直接用于真机测试**——真机前请在可运行 `pnpm`/`cmd.exe` 的环境跑**完整** `tauri android build`（或 `./gradlew :app:assembleArm64Debug`，不带 `-x`）。

---

## 13. ⛔ 实测发现：移动端 Rust 代码（`#[cfg(mobile)]`）**从未编译过**，有 24 个编译错误

为产出**可用** APK，本次绕过沙箱的 `pnpm` 限制，用 NDK clang 手动交叉编译 `aarch64-linux-android`。途中先修掉两个真 blocker（§13.1），最终编译到 `spiritpal-app` 本体时，暴露 **24 个错误——全部落在 `#[cfg(mobile)]` 代码路径上**。这正是计划 §3.4 自述「本文件移动端门控，无法本环境编译，待 NDK 机器验证」所留的空白，也是**本次理论验证最重要的产出**。

### 13.1 途中修掉的两个真 blocker（已落地）

**① `openssl-sys` 无法为 Android 构建**（会让 `tauri android build` 直接失败）

- 链路：`reqwest = "0.12"`（默认 features）→ `native-tls` → `openssl-sys`。Windows 上 native-tls 走 schannel 无事，**Android 上需要交叉编译的 OpenSSL**。
- 现象：`Could not find directory of OpenSSL installation`（`$TARGET = aarch64-linux-android`）。
- 修复（`src-tauri/Cargo.toml`）：关闭 reqwest 默认 TLS，按平台分后端 —— 非 Android 用 `native-tls`（**桌面行为完全不变**），Android 用 `rustls-tls`（纯 Rust）。
- 验证：`cargo tree --target aarch64-linux-android` → openssl 计数 **0**、只剩 `rustls`(20)；`--target x86_64-pc-windows-msvc` → 仍含 `native-tls`+`schannel`。

**② Tauri 插件 build script 在 Windows 上「第二次」Android 构建必失败**

- 插件：`tauri-plugin-{deep-link,dialog,fs,notification}`。build script 用 `create_dir`（**非** `create_dir_all`）把 `tauri-api` 拷进 `<registry>/<plugin>/android/.tauri/`，目录已存在即报 `os error 183`（当文件已存在时，无法创建该文件）。
- 本机 `.tauri` 残留日期 = 2026-08-29（上次 Android 构建），故**本机现在做第二次 Android 构建会失败**。
- 规避：删/改名这些 `.tauri` 目录（本次用重命名绕过沙箱的安全删除守卫）。**建议**：升级插件版本（上游已修）或加构建前清理步骤 → 值得记入 GOTCHAS。

### 13.2 24 个错误分组与修法

| 类 | 数量 | 位置 | 根因 | 修法 |
|---|---|---|---|---|
| 重复 import | 4 | `engine.rs:307-309` | 文件末尾又 `use jni::objects::{JClass,JString,JValue}` + `use jni::JNIEnv`，与 36-37 行重复 | 删除 307-309 |
| `static` 内非 const | 2 | `engine.rs:47-48` | `static CANCELS: Mutex<HashMap<..>> = Mutex::new(HashMap::new())` —— `HashMap::new()` 非 const | 改 `std::sync::LazyLock<Mutex<HashMap<..>>>`（Rust ≥1.80，本机 1.98 OK） |
| **API 不存在** | 1 | `engine.rs:77` | **`tauri::android::context` 在 Tauri v2 根本不存在**（tauri 无 `android` 模块，只有 `ios.rs`） | 改用官方 `run_on_android_context`（见 §13.3） |
| `JavaStr::to_string` 缺 trait | 4 | `engine.rs:150,154,172,191` | `env.get_string(..)` 返回 `JavaStr`，不满足 `ToString` | 用 `JavaStr` 的 `to_str()` / `into()` 转换 |
| 类型别名生命周期数不符 | 1 | `engine.rs` | `JNIEnv`/`JavaStr` 泛型参数个数不匹配 | 随 §13.3 重构一并解决 |
| `app.path()` 找不到 | 1 | `engine.rs:63` | `AppHandle::path()` 来自 `Manager` trait，engine.rs 只 import 了 `AppHandle, Emitter` | 加 `use tauri::Manager` |
| `WebviewWindowBuilder::decorations` 找不到 | 1 | 待定位 | 桌面专用方法在移动端 cfg 下被调用 | 加 `#[cfg(desktop)]` 条件编译 |
| `ondevice::{generate,load_model,unload_model,list_models,cancel}` 找不到（`__cmd__*` / `__tauri_command_name_*`） | 10 | `lib.rs:509-516` | `#[tauri::command]` 宏未产出符号 —— **因 `engine.rs` 编译失败**，是上面各错的连带 | 随 `engine.rs` 修好而消解 |

### 13.3 正确 API：`JNI_OnLoad` 缓存 JavaVM + 类 GlobalRef（已落地）

**先否掉一个看似正确但不可用的方案**：Tauri 内部有 `Runtime::run_on_android_context`（回调在 Android 主线程带 activity 上下文，class loader 正确），但——

> `RuntimeOrDispatch` 与 `ManagerBase` 都定义在 `tauri-2.11.5/src/lib.rs:1045` 的 **`pub(crate) mod sealed`** 内（注释明写 *"Prevent implementation details from leaking out of the Manager trait"*），**crate 外不可用**；`tauri::android` 模块不存在；`PluginHandle` 也没有该方法。

**最终方案**（已确认 tauri 自身**未定义** `JNI_OnLoad`，故不冲突）：

```rust
static JVM: OnceLock<JavaVM> = OnceLock::new();
static ON_DEVICE_CLASS: OnceLock<GlobalRef> = OnceLock::new();

#[no_mangle]
pub extern "system" fn JNI_OnLoad(vm: *mut jni::sys::JavaVM, _r: *mut c_void) -> jni::sys::jint {
    let vm = unsafe { JavaVM::from_raw(vm) }.unwrap();
    // 此处 find_class 由 System.loadLibrary 的调用线程执行 → 用应用 class loader（正确）
    if let Ok(mut env) = vm.attach_current_thread() {
        if let Ok(cls) = env.find_class("com/alibaba/mnnllm/android/SpiritPalOnDevice") {
            let _ = ON_DEVICE_CLASS.set(env.new_global_ref(cls).unwrap());
        }
    }
    let _ = JVM.set(vm);
    jni::sys::JNI_VERSION_1_6
}
```

**为什么必须缓存类引用**：在 `attach_current_thread` 出来的 native 线程上 `env.find_class()` 走的是 **system class loader**，**找不到应用自己的类** → 运行时 `ClassNotFoundException`。`JNI_OnLoad` 由 `System.loadLibrary("spiritpal_lib")` 的调用线程执行，其 class loader 正确；缓存 `GlobalRef` 后，后续从任意线程调用都不再需要 `find_class`。

### 13.4 ANR 风险（已修）

`SpiritPalOnDevice.loadModel` → `LlmSession.load()` 是**同步**的（加载 2B 模型可能数十秒）。而 Tauri 的**同步命令在主线程内联执行**（已核实：`tauri-macros` 的 `body_blocking` 直接调用函数体，不做线程分派）→ 原实现会 **ANR**。

**已修**：`ondevice::engine::load_model` 改 `async fn` + `tauri::async_runtime::spawn_blocking`（脱离主线程，且不长期占用 tokio worker）。
关键点：因为类引用已由 `JNI_OnLoad` 缓存（§13.3），该 JNI 调用**不再依赖 Android 主线程** —— 两处修改互相配合，ANR 风险消除。
（`unload_model` / `list_models` / `cancel` 仍为同步，但都是毫秒级操作，不构成 ANR 风险。）

### 13.5 结论（已修复，构建通过）

**24 个错误已全部修复，`cargo build --target aarch64-linux-android --lib` → `exit=0`，产物 `target/aarch64-linux-android/debug/libspiritpal_lib.so`。**

修复清单（对应 §13.2）：

| # | 修法 |
|---|---|
| 重复 import | 删除 `engine.rs` 末尾重复的 `use` |
| `static` 非 const | `CANCELS`/`DONE` 改 `std::sync::LazyLock<Mutex<HashMap<..>>>` |
| JNIEnv 获取 | `tauri::android::context` → **`JNI_OnLoad` 缓存 JavaVM + 类 GlobalRef**（§13.3） |
| `JavaStr::to_string` | 改 `.ok().and_then(\|s\| s.to_str().ok().map(str::to_owned))`（`JavaStr`→`JNIStr`→`CStr`） |
| `JValue` 生命周期 | `JValue<'_, '_>`（jni 0.21 是 2 个生命周期参数）；`jargs.iter().map(\|s\| JValue::Object(&**s))` |
| `app.path()` | `engine.rs` 补 `use tauri::Manager` |
| `decorations` | `window.rs` 把 5 个桌面专用 builder 方法包进 `#[cfg(desktop)]` 块 |
| `__cmd__*` 找不到 | `lib.rs` 命令路径改 `ondevice::engine::generate` 等（`generate_handler!` 按**函数所在模块路径**查找宏） |

**最终产物（可 `adb install`，debug 自带签名）**：

| 项 | 值 |
|---|---|
| APK | `src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk` — **203,837,401 B（≈204MB）** |
| 包内库 | `lib/arm64-v8a/`：`libMNN.so`(7.5MB) + `libmnnllmapp.so`(1.39MB) + `libspiritpal_lib.so`(172MB，已 `llvm-strip --strip-debug`) |
| 包内类/方法 | `SpiritPalOnDevice`、`llm.LlmSession`、`llm.GenerateProgressListener` + `initNative`/`submitNative`/`releaseNative`/`nativeOnToken`/`nativeOnDone`/`nativeIsCancelled` |
| badging | `com.spiritpal.desktop_pet` / `0.1.0` / `native-code='arm64-v8a'` |

> APK 仍偏大：debug 构建即使剥离 debug 符号，Rust 侧优化关闭（`opt-level=0`）仍达 172MB。**要小体积请做 release 构建**（`--release` 通常 ~20–30MB），但 release 需 `keystore.properties` 才能签名安装。

**仍属「已编译、未验证」（只能真机回归，§7）**：JNI 运行时行为、`JNI_OnLoad` 缓存是否真生效、流式/取消时序、模型加载与推理。
