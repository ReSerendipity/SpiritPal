# SpiritPal Android 修复端上复测（2026-10-03）

**被测设备**：本机 Android 模拟器 `LawnchairApi35` — Android 15 / API 35 / google_apis / **x86_64**，1080×2400 @420dpi。
**为什么能用 arm64 包**：该镜像带 NDK 翻译层（`ro.dalvik.vm.native.bridge=libndk_translation.so`，v0.2.3，`ro.product.cpu.abilist=x86_64,arm64-v8a`），所以 arm64-only 的包可直接安装运行，无需为模拟器另造 x86_64 产物。

**结论：`1c7adce`（D-IME）、`f518d57`（桌宠菜单跨 tab 泄漏）、`ba04696`（S2 行级存储）、以及本轮追加的移动端加密（`get_machine_id` 缺移动分支）与移动端记忆旁路接线，五处修复均已在端上验证生效。** 另有两项（日记无生成入口、实体图谱无生产写入点）查明后只登记未改，见 §7。

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

## 5. S2 行级存储（`ba04696`）— 全新安装上记忆池恒空

判别实验（同一台设备、同一条链路，只看新写入的 `memories` 行有没有行级分支独有的列）：

| | `tags` | `emotional_intensity` | `memory_id` | `tier` | `category` | 判定 |
|---|---|---|---|---|---|---|
| 修复前形态（10-02 的 2 行） | `[]` | `0.0` | `''` | `episodic`（列默认值） | `日常` | 走 `addMemory()` 旧分支 |
| 修复后（17:44 发的一条） | `["doro","park","cat","happy"]` | `0.6` | `mem_0b43ff61-…` | `autobiographical` | `情感` | 只有 `insertMemoryRow()` 会写这些列 |

读路径单独复核：用 dynamic import 命中应用自己已加载的 `enhancedMemory-*.js`，拿到的是界面在用的**同一个单例** —— `useRowLevelStorage=true`，三层池 `0/2/1`，`getAllMemories().length=3`；再复跑组件里那一次 `searchMemories()` → `success:true, affected:3`。可视化三块当场生效（标签云 4 个标签 + 情感曲线 + 记忆密度），截图 `raw/m_记忆_可视化_标签云与情感曲线.png`。

> **一个差点让我误判的界面细节**：`全部记忆` 这个 Tab 在 CSS 宽 412 的窄屏上被 `overflow-x-auto` 裁掉了（Tab 条 `scrollWidth 504 > clientWidth 380`），命中测试取不到它；而它左边默认的 `主人画像 (0)` 是**另一个 Tab 的空态**。角标 `allCount` 只在 `EnhancedMemoryList` 首次挂载后由 `onCountChange` 回填 —— 所以"没点开就显示 (0)"不代表读路径坏了。先前我把「全部记忆 (0)」读成读路径也坏，就是踩在这里。

## 6. 移动端加密从未生效（本轮发现并修复）

`crypto::get_machine_id()` 只有 `target_os = "linux" / "windows" / "macos"` 三条 `#[cfg]` 路径。Android 的 `target_os` 是 `"android"`（不是 `"linux"`），三条都不编译进来 ⇒ 该函数在移动端恒返回 `Err("无法获取机器 ID，加密功能不可用")`。

| | `invoke('encrypt_data')` | `invoke('encrypt_data_chunked')` | 同页正控 `sp_mem_by_tier` |
|---|---|---|---|
| 修复前（17:32 包） | `FAIL: 无法获取机器 ID，加密功能不可用` | 同左 | **OK，返回 13 行**（证明不是 IPC 通道问题） |
| 修复后（18:47 包） | `ENC2:` 105 字符，`decrypt_data` 往返 `true`（9.7 s） | `ENC3:` 往返 `true`（9.6 s） | OK |

同一根因的连锁后果：

1. `ownerFacts` / `petExperience` / `entityLinking` / `visualMemoryManager` 的 `load()` 判据是 `useRowLevelStorage = await isXMigrated()`，全新安装没有旧 blob ⇒ 迁移不跑 ⇒ 停在 blob 模式；而 blob 写要过 `encryptBlob` ⇒ catch 之后只 `console.error` 就放弃写入 ⇒ **真机上这几张表永远为空**。
2. `encrypted_db::encrypt_db_at_rest_internal` 用 `crypto::encrypt_data(b64, "")` 并以 `?` 上抛 ⇒ **R-14 的数据库静态加密在 Android 上从未发生**（实测设备上就是明文 `spiritpal.db` + `-wal`）。
3. 修法：移动端复用 `keychain` 里已有的每安装随机设备密钥（`secrets-device.key`，应用私有目录、SELinux per-app 隔离），保持 D3 的 Fail Fast 不退化；helper 提到不带 `cfg` 的区域，宿主 `cargo test` 才能覆盖「随机 + 稳定 + 复用 + 并发只留一把」这条性质（4 条新单测）。
4. 修复后实测：`settings` 里出现 5 个 `*-migrated-v2` 标记，四个 store 进入行级模式，`owner_facts` 开始有行。

**没有一并改的**：`vite.config.ts` 的 `esbuild.drop: ['console','debugger']`（R-08 防元信息泄露）意味着上面所有 `catch { console.error }` 在打出来的包里根本不发日志 —— 这正是"静默"的成因，CDP 抓到 0 条日志不等于没出错（正控：自己 `console.log` 一条，事件确实回得来）。改成"日志走 Rust 侧"是独立决策，本轮只登记。

## 7. 移动端记忆旁路接线（本轮发现并修复）

| Tab | 修复前 | 修复后 | 端上触发方式 |
|---|---|---|---|
| 主人画像 | (0) | **(5)**：`name=小林 / location=杭州 / birthday=是3月12日 / pet=猫叫Momo / preference=喝coffee` | 聊天发一句含多条规则事实的话 |
| 我们的故事 | (0) | **(4)**：`play / pet / bathe / feed` | 宠物页长按菜单四个动作各一次 |
| 日记 | (0) | (0) | 移动端没有生成入口，见下 |
| 图谱 | 暂无实体数据 | 暂无实体数据 | 见下（桌面端同样为空） |

根因：移动端组件各自重写了一份交互处理，只接了成就、没接记忆旁路 —— `MobilePetView.trigger*` 少了 `getPetExperienceManager(id).record(...)`（桌面 `PetWindow` 四处都有，且紧挨着已有的 `getAchievementManager().recordX()`），`MobileChatView.runCompletion` 只调 `addExchange`，少了桌面 `ChatWindow` 的 `ownerFactsMgr.extractAndSave(text)`。本轮只补**规则层**（纯正则 + 一次 upsert，不新增网络请求）；LLM 提取（`autoExtractWithLLM`）与 6 小时维护窗口会引入流量/配额代价，属产品决策，未接。回归测试 4 条（`mobilepetview.experience.test.tsx` / `mobilechatview.ownerfacts.test.tsx`），反证：把两处接线还原后恰好 3 条转红、断言"失败时不提取"的那条仍绿。

**两项只登记、未修**：

- `日记` 恒空：`diaryMgr.generateDiary()` 的唯一调用点在 `usePetTimers`（23:30 定时器），而该 hook 只被桌面 `PetWindow` 挂载 ⇒ 手机上没有任何生成入口。
- `图谱` 恒空（**桌面端一样空**）：`entity_nodes` 的唯一写入者是 `EntityManager.extractAndLink()`，全仓除单测外**没有生产调用点**；而 `EntityGraphView` 的空态文案写着"对话中提取的人物/地点/事件会自动出现在这里"。`buildEntityGraphFromMemories()` 写的是另一套表（`memory_entities`），文件里也注明两者"不要混用"。

## 8. 现场状态

- 本轮新增的两道门禁：`scripts/build-android-release.bat` 的构建前 3b、`buildSrc/RustPlugin.kt` 的 `verifyFrontendSri`（挂在所有 `rustBuild*` 之前，覆盖手搓 gradle 的绕行路径）。
- 工作树：`src-tauri/src/generated/sri_hashes.rs` 的构建改动**已回退不提交**（沿用 v2.79 的既有定论：刷新入库清单对开发态门禁无收益，只产生哈希噪声）。注意这意味着**干净检出后直接跑 `gradlew assemble*` 会被新门禁判失败**——这是预期行为，先按 §4 重建 dist 与清单配对即可。
- 设备：当前装的是 18:47 的 `app-arm64-debug.apk`（含 §1/§2/§5/§6/§7 全部修复），应用内是本轮演示数据；主题已切回浅色。要重装：`adb -s emulator-5554 install -r src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk`。
- 截图用的记忆行 `created_at` 由 `artifacts/emulator-ui-20261002/seed_dates.mjs` 在**应用 force-stop 期间**直接 UPDATE 铺到近 12 个月，只为让情感曲线（近 30 天）与记忆密度（近 12 个月）在截图里可见；对话正文、标签、情感强度全部来自与测试 AI 服务商的真实对话。铺日期前确认过 `min(importance)=79`，而 `shouldForget` 要求 `importance < 20`、`applyConsolidation` 要求 `age ≥ 7 天且 importance < 30` ⇒ 播种不会触发清理。
- **增量重打包的体积异常**：非 clean 的 `:app:assembleArm64Debug` 会产出约 655 MB 的 APK（实测 1023 个条目压缩后合计 335,925,701 B，而文件 654,993,631 B ⇒ 约 319 MB 不在中央目录可达范围内），`:app:clean` 后回到 336 MB。出包后要校验体积，或把 clean 步写进脚本。
- 工装与原始日志：`artifacts/emulator-ui-20261002/`（`baseline_prefix.log` 修复前基线、`verify/verify.log` 修复后、`verify_fix.mjs` / `baseline_prefix.mjs` 可重跑；本轮另加 `_s2probe.mjs` 行级签名判别、`_mod.mjs` / `_ed.mjs` dynamic import 取活单例、`_enc3.mjs` 加密 A/B、`batch3.mjs` 16 轮真实对话造数据、`_parity.mjs` / `_exp.mjs` 旁路接线端上复测、`capture_mem.mjs` 记忆模块采集、`seed_dates.mjs` 日期播种）。

> 说明：上文所有 `artifacts/` 下的截图、日志与工装脚本都在 **gitignore 范围内、仅存在于本机**，不随仓库分发；本文只保留可独立复核的数值结论。若要复跑，按 §4 的命令重建即可。
