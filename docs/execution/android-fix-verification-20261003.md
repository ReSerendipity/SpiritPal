# SpiritPal Android 修复端上复测（2026-10-03）

**被测设备**：本机 Android 模拟器 `LawnchairApi35` — Android 15 / API 35 / google_apis / **x86_64**，1080×2400 @420dpi。
**为什么能用 arm64 包**：该镜像带 NDK 翻译层（`ro.dalvik.vm.native.bridge=libndk_translation.so`，v0.2.3，`ro.product.cpu.abilist=x86_64,arm64-v8a`），所以 arm64-only 的包可直接安装运行，无需为模拟器另造 x86_64 产物。

**结论：`1c7adce`（D-IME）与 `f518d57`（桌宠菜单跨 tab 泄漏）两处修复均已在端上验证生效。**

---

## 1. D-IME — 聊天输入栏被软键盘遮挡

测量方式：CDP 读 `window.innerHeight` / `visualViewport.height` / textarea 的 `getBoundingClientRect()`，同时用 `dumpsys input_method` 的 `mInputShown` 确认键盘真的弹起了。同一台设备、同一套工装，修复前后各测一次。

| | 键盘关闭 | 键盘开启 | mInputShown | 视口是否让位 | 输入行是否可见 |
|---|---|---|---|---|---|
| **修复前**（`app-arm64-release.apk`，2026-10-02 09:52） | `ih 842 / vv 842 / bottom 779` | `ih 842 / vv 842 / bottom 779` | true | **否，三个数纹丝不动** | 否（被键盘整个盖住） |
| **修复后**（`app-arm64-debug.apk`，含 1c7adce） | `ih 842 / vv 842 / bottom 779` | `ih 530 / vv 530 / bottom 467` | true | **是，842→530** | 是（467 < 530） |

截图对照：修复前 `artifacts/emulator-ui-20261002/raw/101_聊天_键盘弹起.png`（输入行不可见），修复后 `artifacts/emulator-ui-20261002/verify/verify_ime_open.png`（输入行与底部导航均完整可见）。

这条缺陷原先只在 realme RMX5010 / Android 16 / ColorOS 上记录过（`docs/execution/android-device-test-20261001.md` 的 D-IME 条目），当时无法排除"是不是 ColorOS 特有"。本次在 AOSP 系的 Android 15 模拟器上同样复现，**说明它是 edge-to-edge 下 insets 只消费 `systemBars` 的通用后果，不是 OEM 行为**。

## 2. 桌宠长按菜单跨 tab 泄漏

测量方式：在宠物页长按打开菜单，然后切到各 tab，统计 `document.querySelectorAll('button')` 中"有非零矩形"的数量与"`elementFromPoint` 命中自身"的数量，差额即不可见但仍可聚焦的按钮。

| tab | 修复前 DOM / 命中 | 修复后 DOM / 命中 | 菜单类残留 |
|---|---|---|---|
| 聊天 | 14 / 8 | **8 / 8** | 6 → **0** |
| 养成 | 16 / 10 | **10 / 10** | 6 → **0** |
| 设置 | 25 / 17 | **19 / 17** | 6 → **0** |

修复后设置页仍有 2 个不可见按钮（`性格 …`、`关于 SpiritPal v0.1.0`），那是**折叠在首屏之下**的正常情况，不是泄漏。

## 3. 顺带排除的两条"疑似缺陷"

- **"release 包暴露 WebView 调试 socket"** —— 归因错误。wry 0.55.1 的开关是 `#[cfg(any(debug_assertions, feature = "devtools"))]`，而 `cargo tree -e features -i wry` 显示本仓未启用 `devtools`；该 socket 存在是因为模拟器是 `ro.build.type=userdebug` / `ro.debuggable=1`。发到正式 user 设备上的 release 包不会暴露它，**不构成缺陷**。
- **"跟随系统主题不重算"** —— `src/lib/system/themeManager.ts` 确实注册了 `prefers-color-scheme` 的 change 监听，且切回 `system` 时会重算。当时观察到 `data-theme` 滞留 dark 而系统已是浅色，是**进程被系统冻结**（`ps` 状态 `do_freezer_trap`）导致事件未被处理，解冻后即正常。**不构成缺陷**。

## 4. 复现步骤与两个构建陷阱

> **本节两个陷阱已于同日堵住**：`scripts/build-android-release.bat` 加了构建前门禁 3b（dist/SRI 一致性），
> `buildSrc` 的 `RustPlugin.kt` 加了 `verifyFrontendSri` 任务并挂在所有 `rustBuild*` 之前，
> 因此**手搓 `gradlew assemble*` 也会被拦**，不再只有走 .bat 才安全。确需绕过：`-PskipFrontendSriCheck`
> （降级为警告，不静默放行）。
>
> 门禁自身四条分支都实跑过：正例（配对 → `SRI 校验通过：36 个产物逐条一致`）、反例（清单回退成 HEAD
> 占位 → BUILD FAILED 并给出重建命令）、逃生口（加 `-PskipFrontendSriCheck` → 警告后放行，不静默）、
> 以及**诊断分流**（故意把 `rootDirRel` 改错一层 → 报"这是工装接线问题，不代表 dist 与清单不一致"）。
> 最后一条是刻意加的：开发这个门禁时它一度因 `File(projectDir, "../../../").parentFile` **不做 `..`
> 归一化**而拼错脚本路径，node 抛 `MODULE_NOT_FOUND`，却被门禁报成"哈希不一致"——假诊断会把人推向
> 完全错误的方向。现在先判脚本存在、再判退出码。另两个实现坑：`Exec` 任务的 `exitValue` 在 Gradle 8
> 的 Kotlin 编译期不可见，改用 `project.exec { }.exitValue`（与同目录 `BuildTask.kt` 同款）；
> `kotlin-dsl` 的 `doLast { }` 是无参闭包，闭包内只能引用外面捕获的 `val`。

```bash
# 前端必须走完整的 beforeBuildCommand，不能只 npm run build
node node_modules/typescript/bin/tsc -b \
  && node node_modules/vite/bin/vite.js build \
  && node scripts/obfuscate-and-sri.mjs

# 模拟器是 64 位镜像，flavor 要选 arm64（选 arm 会出 armeabi-v7a → INSTALL_FAILED_NO_MATCHING_ABIS）
cd src-tauri/gen/android && ./gradlew :app:assembleArm64Debug
```

1. **只跑 `npm run build` 会卡死在启动页。** `package.json` 的 `build` 只含 `tsc -b && vite build`，而 `tauri.conf.json` 的 `beforeBuildCommand` 还要跑 `scripts/obfuscate-and-sri.mjs` 重生成 `src-tauri/src/generated/sri_hashes.rs`。漏掉这一步，CSP（`script-src 'self'`）下资源哈希对不上，WebView 加载不到脚本，应用永久停在"正在启动，请稍候…"且**不报任何错误**。
2. **`arm` flavor 是 32 位。** `RustPlugin.kt` 按 `arm64 / arm / x86 / x86_64` 建 flavor，`arm` 对应 `armeabi-v7a`；本机镜像 abilist 是 `x86_64,arm64-v8a`（64 位 only），装 v7a 包直接 `INSTALL_FAILED_NO_MATCHING_ABIS`。

另外：debug 包与 release 包签名不同，换装必须先 `adb uninstall`（会清应用数据）；重装后 WebView 的 devtools socket 名随 pid 改变，`adb forward` 必须重指，否则表现为"连得上但 `/json` 永不响应"。

## 5. 现场状态

- 本轮新增的两道门禁：`scripts/build-android-release.bat` 的构建前 3b、`buildSrc/RustPlugin.kt` 的 `verifyFrontendSri`（挂在所有 `rustBuild*` 之前，覆盖手搓 gradle 的绕行路径）。
- 工作树：`src-tauri/src/generated/sri_hashes.rs` 的构建改动**已回退不提交**（沿用 v2.79 的既有定论：刷新入库清单对开发态门禁无收益，只产生哈希噪声）。注意这意味着**干净检出后直接跑 `gradlew assemble*` 会被新门禁判失败**——这是预期行为，先按 §4 重建 dist 与清单配对即可。
- 设备：已还原为修复前的 `artifacts/app-arm64-release.apk`（as-found）。要装回带修复的包：`adb -s emulator-5554 install -r src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`（debug 产物，336 MB，未 strip）。
- 工装与原始日志：`artifacts/emulator-ui-20261002/`（`baseline_prefix.log` 修复前基线、`verify/verify.log` 修复后、`verify_fix.mjs` / `baseline_prefix.mjs` 可重跑）。

> 说明：上文所有 `artifacts/` 下的截图、日志与工装脚本都在 **gitignore 范围内、仅存在于本机**，不随仓库分发；本文只保留可独立复核的数值结论。若要复跑，按 §4 的命令重建即可。
