# SpiritPal Android 真机全量测试报告（2026-10-01）

**被测对象**

| 包 | 路径 | 体积 | 签名 | 装机 |
|---|---|---|---|---|
| debug arm64 | `src-tauri/gen/android/app/build/outputs/apk/arm64/debug/app-arm64-debug.apk` | 653,056,695 B | `C=US, O=Android, CN=Android Debug`（SHA-256 `187d4242…55624`） | 已装（`lastUpdateTime=2026-09-30 22:36:43`） |
| release arm64 | `…/apk/arm64/release/app-arm64-release.apk` | 25,854,215 B | `CN=SpiritPal Test Build, OU=Dev, O=SpiritPal`（SHA-256 `1e152014…0071`） | **未装机**（见 §6 阻塞） |

两包同源：前端为本次重建的 `dist/`（`tsc -b` → `vite build` 23.15s → `obfuscate-and-sri` 36 项一致），Rust 侧 `custom-protocol` 编译期内嵌。

**设备**：realme RMX5010 / Android 16 / 1264×2780 @560dpi / arm64-v8a。

---

## 1. 方法（以及为什么不是 Mobile Use）

`Mobile Use (Beta)` 在本次会话开始时未启用（系统提示该能力不可用），因此**没有**使用它的语义级"看界面→点元素"通道。替代方案是四层断言，按证据强度从高到低：

1. **CDP（仅 debug 包可用）**：`adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`，读 DOM 文本/节点几何/`console`/`Log`/`Network.loadingFailed`。这是本仓 Android 测试里最强的断言层——`uiautomator` 对本应用**只能看到 1 个 `NAF=true` 的 WebView 节点**，任何"按控件"式断言都是假的。
2. **真实输入**：`adb shell input tap/swipe/keyevent/text`（不是 `adb shell uiautomator`，也不是 JS 合成事件）。
3. **像素真值**：`screencap` + PIL/numpy（唯一色彩数、亮度熵、帧间差异率）判"非白屏/画面确实变了"。
4. **系统侧指标**：`dumpsys meminfo`（PSS/RSS/Views/Activities）、`gfxinfo`（jank%）、`/proc/<pid>/{fd,task}`、`logcat -b crash` 按 pid 归因、`dumpsys dropbox` 增量。

坐标换算：CSS px × devicePixelRatio(3.5) + WebView 顶部偏移(140px)，由 `uiautomator` 的 WebView bounds 实测得出，非假设。

**release 包不可调试**（非 debuggable → 无 CDP、无 `run-as`），只能走第 2–4 层，属方法学降级。

---

## 2. 确认缺陷（1 项）

### D-IME｜软键盘弹出后聊天输入栏与发送按钮被完全遮挡 — P1

**现象**（可复现，多次）：在聊天页点输入框聚焦后，键盘占据屏幕下方约 1360 设备像素，输入行（textarea + 发送按钮）落在键盘之下，用户**看不见自己输入的内容、也点不到发送**。

**量化证据**：

| 量 | 键盘关闭 | 键盘打开 |
|---|---|---|
| `window.visualViewport.height` | 754.2857 | **754.2857（未变）** |
| `innerHeight` | 754 | 754 |
| textarea `bottom`（CSS） | 690 | 690 |
| 发送按钮设备坐标 | (1151, 2485) | 同，**落在键盘区内** |
| `dumpsys input_method mInputShown` | false | true |

截图证据：`artifacts/android-test-20260930/shot_ime_open.png`（可见键盘盖住输入行）。

**根因**：`src-tauri/gen/android/app/src/main/java/com/spiritpal/desktop_pet/MainActivity.kt`

- `:14` `enableEdgeToEdge()`
- `:20-25` insets 监听只把 `Type.systemBars()` 转成 padding 并只消费 `systemBars`，其注释断言：*"仅消费 systemBars，IME 等 insets 继续下发给 WebView，键盘行为不受影响。"*

该断言在本机（Android 16 / ColorOS）不成立：edge-to-edge 下窗口不再随 IME resize，WebView 也拿不到 IME 可视区变化，故 `visualViewport` 不动。前端全仓**无任何 `visualViewport` 处理**（`grep visualViewport src/` 为空），因此也没有 JS 侧兜底。

**引入点**：`git log -S"setOnApplyWindowInsetsListener"` → `436e188`（2026-09-28，`feat(mobile): … 状态栏遮挡修复 …`）。即该回归是"状态栏遮挡修复"的副作用。

**当前规避**：用户需先手动收起键盘（BACK / 键盘收起键）才能看到并点击发送。实测 `mInputShown` 由 true→false 后，同坐标点击即命中，消息成功上屏并收到回复。

**建议修法**（择一，未改代码）：insets 监听里并入 `Type.ime()` 的 bottom 作为 padding（或加 `WindowInsetsAnimationCompat` 跟随动画）；或对内容根设置 `decorFitsSystemWindows=true` / 显式 `adjustResize`。

---

## 3. 判为"设计取舍"而非缺陷（我一度误判，已收回）

**系统返回键在应用内子页不做逐级回退，而是把应用退到后台。** 3/3 复现：BACK 后 `mCurrentFocus=com.android.launcher`，**pid 不变**（非崩溃）。

源码依据：`MainActivity.kt:28-39` 注释明示——返回键若走系统默认会 finish Activity，WebView 销毁后仍有事件投递触发 wry 断言崩溃（`"no available activity"` / SIGABRT），故刻意改为 `moveTaskToBack(true)`；`TauriActivity.kt:35 override val handleBackNavigation: Boolean = false`；且前端为纯 state 路由，**没有 `window.history` 栈**（`pushState/popstate/react-router` 全仓无命中，`.history.push` 命中的都是引擎内存数组），因此也无历史可退。对照组：键盘弹出时 BACK 正确先收键盘并留在应用内。

**代价如实记录**：用户无法用系统键逐级回退，必须用页面内「返回」按钮。

---

## 4. 通过项（摘要，完整台账见 §7）

| 维度 | 结论 | 关键数字 |
|---|---|---|
| D1 冷启动 | 通过 | `TotalTime` 225/241/254ms（中位 241），DOM 就绪 ~116–132ms，首屏唯一色彩 21259、亮度熵 3.04 |
| D2 宠物手势 | 通过 | 双击喂食 饱食度 80→94（金币 -8）；长按出菜单（摸头/喂食/玩耍/洗澡/切换角色/关闭）；宠物大小滑杆真实拖动 3.0x→2.4x |
| D3 页面遍历 | 通过 | 5 Tab + 子页 外观主题/AI 服务商/端侧模型/数据同步/记忆/性格/关于 全部可达，前端错误 0 |
| D4 聊天链路 | 通过 | 发送后 5s 用户气泡上屏，AI 真实回复；Markdown 新气泡 `strong:1 li:2` |
| D5 生命周期 | 通过 | Home→回前台 pid 不变；重复启动单实例 pid 不变；锁屏→解锁存活；后台 5min 未被回收（PSS 228→142MB 属正常回收） |
| D5b 持久化 | 通过 | 锚点法：金币/等级、宠物大小倍率 1.9、唯一消息标记，跨 `force-stop`+重启全部一致；Δfed/Δmood=0 |
| D6 稳定性 | 通过 | 10min 挂机 PSS 251,807→246,916KB（**Δ-4.9MB，不升反降**）；线程 66→61、fd 471→476；jank 峰值 0.07%；fatal 0 |
| D7 权限/系统 | 通过 | 撤销通知权限后点击"推送通知"不崩且留在应用内；系统深色模式下应用跟随（截图平均亮度 228→49.1）；字体 130% 无横向溢出（`scrollWidth==innerWidth==361`） |
| D9 端侧模型页 | 通过（推理未测） | 页面内容完整（469 字，"端侧模型（MNN 内嵌）/刷新/进程内推…"）；`files/` 目录仅 7.5K，**无模型权重** → 推理实测 BLOCKED |
| D10 数据持久化 | 通过 | 重启前后养成数值完全一致 `{96,76,68,1}`；聊天历史 len 3902 跨重启保留；数据目录 9.2M |
| D11 输入鲁棒性 | 通过 | 1505 字超长输入可接受、发送可用；40 次快速切页 pid 不变、前端错误 0；**monkey 1500 事件（`--pct-syskeys 0`）后 pid 不变、dropbox 增量 0、fatal 0** |
| 包级门禁 | 通过 | release DEX **26/26 JNI keep**；`.so` 318MB→13.95MB（strip 生效）；`libMNN.so`/`libmnnllmapp.so` 在包内；`apksigner verify` rc=0；静态守卫 `check_android_proguard_keeps` 通过（wry 0.55.1 / tauri 2.11.5 未漂移） |

**金币对照实验（针对我提出的疑点）**：纯重启 3 次、零交互 → coins 44/44/44、fed 100/100、mood 100/100 **均不变** ⇒ 重启本身不扣币。此前观察到的两次 -24 中，至少一次发生在 monkey 1500 随机点击之后（可能触发喂食/商店消费）；隔夜那次**未归因**，需"静置 8 小时零交互"对照才能定论，暂列开放项，不作缺陷。

---

## 5. 我这一轮的假阳性（全部收回，列出以免复用）

| 我一度判定 | 真相 | 教训 |
|---|---|---|
| D4 流式回复 FAIL | 断言读的是页面**开头**文本，机内留着上一会话同类探针 → 被历史污染 | 有状态的会话页必须"唯一标记 + 只看尾部气泡" |
| D5 杀进程持久化 FAIL | 把 `petStore.ts:82-85` 的活体 tick 衰减（饥饿 -2、心情 -1.5/tick）当成丢档；离线衰减另有 `OFFLINE_MIN_HOURS=0.1` 门槛 | 数值断言要先读衰减常量，或用不衰减量做锚点 |
| "流式未接线" P2 | **收回**。`llmClient.ts:342` 明确 `stream: true`，`:372-390` 按 SSE 逐 delta 回调，`MobileChatView.tsx:206-209` 每块 `appendAssistantChunk`。实测 899 字符一次性出现（89.4s）是**所配 custom 端点未分块返回**，且期间有占位气泡 → provider 行为 | 先确认移动端组件（`src/mobile/MobileChatView.tsx`），我一开始查的是桌面端 `ChatWindow.tsx` |
| BACK 键 P1 缺陷 | 设计取舍（见 §3） | 行为异常先查 Kotlin/源码意图，再定性 |
| D2 宠物命中区 FAIL / D3 三子页"没导航" / D5b 首轮 3 条 FAIL / D8b 多条 `no textarea` | 全是工装：坐标越界未滚动、页面态未复核、`SystemExit` 未被 `except Exception` 捕获、无键盘时按 BACK 反而把应用退到后台 | 工装缺陷必须与产品缺陷分开记账（已作废 4 条污染行） |

---

## 6. 未覆盖 / 阻塞

| 项 | 状态 | 原因 |
|---|---|---|
| D8 网络矩阵（断网/坏代理/恢复自愈） | **未完成** | 两轮均因工装页面态丢失而无效（`no textarea`）；修正版跑到"断网生效 PASS"后脚本被焦点守护中断 |
| D10 清数据后合规首启（未勾选禁用、勾选解禁、弹窗不可绕过） | **未完成** | `pm clear` 被 ColorOS 拒绝：`SecurityException: PID … does not have permission CLEAR_APP_USER_DATA`。需改用卸载+重装 |
| D12 i18n 五语言扫描 / 触控目标 ≥48dp / 无障碍命名 | **未完成** | monkey 之后设备进入异常态（见下） |
| release 包真机子集 | **未开始** | 需卸载 debug（签名不同）；机内数据已完整备份 `backups/device-data-com.spiritpal.desktop_pet-20260930.tgz`（217 项，含 `spiritpal.db`+wal、`secrets.json.enc`） |
| 端侧 MNN 推理实测 | BLOCKED | 设备 `files/` 无模型权重 |
| 多 ABI / universal | 未做 | 本轮按决策只出 arm64 |

**当前设备阻塞**：屏幕 `mState=ON / mScreenState=ON` 但截图像素全黑（亮度均值 0.0、标准差 0.0），`mCurrentFocus` 持续为 `NotificationShade`；已尝试 `cmd statusbar collapse`、`service call statusbar 1`、`KEYCODE_BACK/HOME/82`、上划手势、`wm dismiss-keyguard`、熄屏→唤醒，均无效。SystemUI 进程存活（pid 7908）且 crash buffer 无其记录；dropbox 唯一新增条目属 `com.google.android.gms`（`Unable to acquire periodic restart writer lock`），与本应用无关。**需人工解锁/必要时重启手机**；我不再向你的设备盲注入输入。

---

## 7. 证据与工装

- 逐用例台账：`artifacts/android-test-20260930/results.jsonl`（139 行；PASS 88 / INFO 30 / FAIL 16 / BLOCKED 5 —— 其中 §5 所列 FAIL 多为已作废的工装假阳性，本报告结论以 §2–§4 为准）
- 汇总表：`artifacts/android-test-20260930/report_table.md`
- 截图：`artifacts/android-test-20260930/shot_*.png`（含 `shot_ime_open.png` 缺陷证据）
- 资源采样：`artifacts/android-test-20260930/d6_samples.json`
- 操作流水：`artifacts/android-test-20260930/events.log`（170 次输入注入，全部带时间戳与坐标）
- 工装：`droid.py`（adb 封装 + 像素断言 + 指标采样 + 焦点自愈）、`cdp.mjs`（CDP eval/dom/state/console/watch/find）、`run_d1_d3.py`、`run_d3c/d.py`、`run_d4b/c/d.py`、`run_d5b.py`、`run_d7_d9.py`、`run_d8b.py`、`run_d10_d12.py`、`run_followups.py`、`run_release.py`、`make_report.py`

工装均在 gitignore 的 `artifacts/` 下，未进版本库。

---

## 8. 顺带修掉的构建链地雷（已验，未提交）

`scripts/regenerate_android_kotlin.py` 的 `--check` 与本仓布局漂移：脚本仍按 stock 的 `<pkg>/generated/` 找胶水层，而仓库在 `436e188` 已把 9 个文件扁平化到 `<pkg>/` 并纳入 git 跟踪（两者 **package 行完全相同**）。后果：`scripts/build-android-release.bat` 第 3 步在 FAIL 分支会跑不带 `--check` 的写入，往 `generated/` 塞进**同包同名**的 9 个类 → Kotlin `Redeclaration`，release 构建必编不过。

改法：`--check` 同时接受两种布局，比较时归一化掉 `AUTO-GENERATED` 头与行尾空白；检测到两处同名共存时直接报 `Redeclaration` 并 rc=1；写入路径永不制造重复类。

验证（正例 + 三反例 + 复原复测）：正例 rc=0（`当前布局：flat`）；抽走 `Logger.kt` → `缺失 1：['Logger.kt']` rc=1；`generated/` 造同名副本 → `会触发 Redeclaration` rc=1；改坏内容 → 不一致 rc=1；复原后 rc=0。

工作树当前状态：`scripts/regenerate_android_kotlin.py` 与 `src-tauri/src/generated/sri_hashes.rs` 为 modified，另有未跟踪 `.zcodeignore`；`app/keystore.properties` + `spiritpal-test.jks` 已从备份恢复到 `src-tauri/gen/android/app/`（两者均被 `.gitignore` 忽略：根 `.gitignore:116 *.jks`、`gen/android/.gitignore:17`）。**均未提交、未推送。**

---

# 第二轮增补（同日，修复工装后）

> 本节**取代 §4/§6 中 D8、D12 的早期行**——早期那几轮是工装缺陷（坐标映射被旋转残留破坏、按简体文案找已被翻译的导航按钮），不作产品结论。

## 9. 新增确认缺陷（2 项）

### D-OFfline｜离线发消息静默成功 — P2

断网（`svc wifi disable` + `svc data disable`，`Active default network` 由 190 → None，2.3s 生效）后在聊天页发消息：

- 用户气泡 **1 秒内正常上屏**，界面**不出现任何**"离线/失败/待重发/重试"状态（提示词命中=无：`失败/网络/错误/重试/超时/不可用/无法/请检查/离线` 全不命中）
- 应用不崩（pid 30768 不变，crash buffer 无本应用记录）
- 网络恢复（2.3s 拿到 net=191）后再发一条：`sent=True 上屏=1s 提示=[]` 且收到真实回复 ⇒ **队列/自愈链路本身是好的，缺的是失败/待发的可见状态**

用户视角：断网时消息看起来"发出去了"，实际没有送达。

### D-Touch｜多个可点目标低于 48dp — P3（跨语言复现）

聊天页/设置页实测（CSS px ≈ dp）：

| 元素 | 尺寸 | 语言环境 |
|---|---|---|
| 切换主题 / `테마 전환` | **36×36** | 简体、韩语均复现 |
| 清空 | 58×**24** | 繁体 |
| 传送（发送，主操作） | **40×40** | 繁体 |
| 语言选择 chip `中文` | **43×44** | 韩语 |
| 语言选择 chip `繁體中文` | 62×**44** | 韩语 |
| `도로`（角色 chip） | 46×**28** | 韩语 |

另有无障碍命名：含 `placeholder` 计名后仍有 **2 个**可点元素无任何可访问名字。
（`textarea` 289×38 我单独豁免——它是文本域，高度小不构成命中区问题。）

## 10. 第二轮通过项

| 维度 | 结论 | 关键数字 |
|---|---|---|
| D7 横屏 | 通过 | 强制横屏后应用跟随旋转：viewport `794×321` @dpr3.5，底部导航 5 按钮各 `159×55` 均 `visibility=visible`，无遮罩，pid 不变 |
| D8 断网生效 | 通过 | `Active default network 190→None` 2.3s；`svc wifi enable` 后 2.3s 恢复 |
| D8 断网不崩 / 恢复自愈 | 通过 | 见 §9 第一条 |
| D8 坏代理不可达 | **INCONCLUSIVE** | `http_proxy=127.0.0.1:9` 下 `sent=False`（发送按钮未可点），用例不成立，不冒充结论 |
| D12 简体中文 | 通过 | 五页无 i18n 裸键、无横向溢出（`scrollWidth==innerWidth`） |
| D12 繁體中文 | 通过 | 同上 |
| D12 English | 通过 | 五页 len 149/1172/407/244/…，裸键 0、溢出 0 |
| D12 한국어 | 通过 | 五页 len 92/1171/251/178/…，裸键 0、溢出 0 |
| 金币对照实验 | 通过 | **纯重启 3 次、零交互：coins 44/44/44、fed 100/100、mood 100/100 全不变** ⇒ 重启不扣币。此前两次 -24 至少一次发生在 monkey 1500 随机点击之后（可能触发喂食/商店消费）；隔夜那次仍未归因，需"静置 8h 零交互"对照 |

## 11. 第二轮我踩的工装坑（同样列出，避免复用）

1. **旋转残留破坏坐标映射**：D7 把 `user_rotation` 设为 1 后应用停在横屏，而 `screen_geom()` 把 `W/H` 缓存成竖屏值 → 之后 13 条判定（D8b 全部、D12 全部）坐标全打偏。修法：`screen_geom()` 按 `user_rotation` 实时取宽高并支持横屏互换，批次前置 `ensure_portrait()` 断言 `innerWidth<innerHeight`。
2. **按简体文案找已被翻译的导航按钮**：切到繁體中文后导航变成「設置」，`tap_label("设置")` 必然落空 → 三个语言用例 BLOCKED。修法：导航改用**几何索引**（`y>innerHeight-100` 的按钮按 x 排序取第 n 个）。
3. `require_focus()` 抛 `SystemExit`，而批次脚本用 `except Exception` 兜异常 → 抓不住，整批静默中断（表现为"日志突然结束"）。已改抛 `RuntimeError` 并加系统窗口自愈（`CLOSE_SYSTEM_DIALOGS` + BACK + 上划）。
4. monkey 会把通知栏拉下来且不自动收回，导致后续所有用例焦点失败——`--pct-syskeys 0` 并不能完全避免。批次尾需显式收回。

## 13. release 包真机结果（同日第三轮，像素/系统指标层）

release 不可 debuggable → 无 CDP、无 `run-as`，因此断言层降为**像素差分 + 系统指标 + logcat**。坐标取自 debug 包 DOM 实测换算，但**合规页坐标不匹配**（见下），主界面/导航坐标有效。

| 用例 | 判定 | 实测 |
|---|---|---|
| D1r 冷启动 ×3 | ✅ | `TotalTime` 90/97/87ms，**中位 90ms**（debug 同机 241ms ⇒ release 快约 2.7 倍），uniq≈11.8k、熵 2.33 |
| D2r 单击互动 | ✅ | 画面差异 6.28% |
| D2r 双击喂食 | ✅ | 画面差异 5.13% |
| D2r 长按菜单 | ✅ | 画面差异 16.58% |
| D3r 五页遍历 | ✅ | 宠物/聊天/养成/记忆/设置 差异 17.38%/20.27%/11.32%/13.69%/12.44%，均非白屏 |
| D5r Home→回前台 | ✅ | pid 24925 不变 |
| D5r 重复启动单实例 | ✅ | pid 不变 |
| D5r 杀进程重启渲染 | ✅ | uniq 11173 |
| D6r 3.5min 资源 | ✅ | PSS 182,769→184,770KB（**Δ+2.0MB**），线程 64→58，jank ≤0.05%，fatal 0 |
| D6r fd 计数 | ⚪ 不可得 | `run-as` 对 release 无效 → fd 泄漏维度在 release 上**无法观测**（方法学缺口） |

### 本轮被我自己作废的判定（重要，避免误读）

**D10c 合规首启全部作废并标 BLOCKED**：`(632,1810)` 这个"同意按钮"坐标在四张不同阶段的截图里取色**恒为 (251,233,234)**，说明它根本不在按钮上；而 `shot_relr_consent.png` 人眼看是**主界面**（饱食度 79/心情 79/金币 100/导航栏），并非合规弹窗——consent 在上一轮已被通过，本轮不是首启状态。因此"未勾选禁用""勾选解禁""不可绕过""同意后进入主界面"等 6 条判定**全部不计入结论**，release 的首启合规行为**仍未验证**。

要补测需要一次干净的卸载重装，且会再次触发 ColorOS 的安装确认与通知权限框（都需要你在手机上点）。


## 15. D9 端侧 MNN 推理 —— 已实测通过（结案）

完整链路在 debug 包上跑通，每一环都有独立读数：

| 环节 | 结果 | 证据 |
|---|---|---|
| 模型投放 | ✅ | `scripts/fetch-mnn-model.mjs` 下载并**逐文件 SHA-256 校验**（523MB，`llm.mnn.weight` 470,382,614B）；`adb push` 15.27s 到 `Android/data/.../files/models/Qwen3.5-0.8B-MNN/` |
| 应用识别 | ✅ | 端侧模型页出现条目 **`Qwen3.5-0.8B-MNN / 522 MB`** + 「加载」按钮 |
| 模型加载 | ✅ | RSS **513,092 → 1,136,860KB（Δ +610MB）**，符合 0.8B Q4 权重量级；pid 不变 |
| 服务商切换 | ✅ | `AI 服务商` 页出现并可选中 **`端侧 (MNN Chat 本地)`** |
| 本地生成 | ✅ | 发送后**首次增长 2.2s**；文本 11,405 → 19,426+ 持续增长；回复为模型真实生成的中文 |
| 逐字流式 | ✅ | **增长步 55/60**（轨迹 11452→12014→13474→14397→15299→16167→17014→17833→18643→19426）⇒ 端侧路径确为逐 token 渲染 |
| 生成期内存 | ✅ | RSS 1,137,856 → **1,365,396KB（Δ +227MB）** |
| 稳定性 | ✅ | 全程 `fatal=0`、pid 29173 未变、无 ANR |

### 本节推翻的两个先前判断（都记着，别复用）

1. **"权限假设"被 A/B 证伪**：我曾据 `adb push` 子目录为 `drwxrwx--- shell shell`（应用 uid 拿不到 other 位）推断"应用文档化的投放路径自身走不通"。A/B 结果是**仅按 UI 指示 push、完全不改权限，刷新即识别**（`识别=True`）——Android 的 FUSE 视图不按裸 unix 位判定，我的推断链错了。
2. **更早几次"未发现模型"全是我的选择器问题**：当时界面被我自己在 D12 里切成了**韩语**，而脚本仍按中文 `tap_label("刷新")` 找元素 ⇒ 刷新从未触发。复原语言为中文后一次成功。

### 顺带得到的正面结论

云端 custom 端点"回复一次性出现"（§5 那条）与端侧"55/60 步逐字增长"形成对照 ⇒ **应用的流式管线是通的**，云端不分块属服务商行为。这条对照实验把 §5 的收回从"读代码判断"升级为"两条路径实测对照"。

### 收尾

测试后已把 `AI 服务商` 还原为 **`自定义 (Custom)`**（设置页回显确认），并 `am force-stop` 释放那 1.36GB 常驻权重。手机上的 523MB 模型副本与本机 `artifacts/mnn-models/` **未删除**，等你决定。

## 16. 当前未覆盖清单（最新，取代已并入 §13/§15 的旧 §12）

| 项 | 状态 | 说明 |
|---|---|---|
| **D10 release 首启合规**（弹窗必现、未勾选不可绕过、勾选解禁、协议入口） | **未测** | consent 已在此前被通过；`pm clear` 被 ColorOS 拒（`SecurityException: CLEAR_APP_USER_DATA`）→ 必须再走一次卸载重装，且需你在手机上点掉安装确认与通知权限框 |
| ~~D9 端侧 MNN 推理~~ | **已实测通过**（见 §15，结案） | 已在 debug 包结案：push→识别→加载(+610MB)→选端侧→逐字生成(55/60 步,+227MB)→无崩溃 |
| D12 日本語 | 待补 | 工装时序问题（切语言后导航文案变化 + 页面未落到设置页），重跑即可，无代价 |
| release 的 fd 泄漏维度 | 不可观测 | 非 debuggable → `run-as` 被拒，`/proc/<pid>/fd` 读不到 |
| 多 ABI / universal | 未做 | 本轮按决策只出 arm64 |
| D8 坏代理不可达 | 不成立 | `sent=False`（发送按钮未可点），用例本身没跑起来，非应用结论 |



## 17. 终局：debug 包 DOM 断言（第四轮）

### D10c 首启合规 —— 全部通过（DOM 硬断言，非像素）

| 用例 | 判定 | 实测 |
|---|---|---|
| 首启出现合规弹窗 | ✅ | DOM 含『使用前须知』，len=139 |
| 含协议与隐私链接 | ✅ | 用户协议=True 隐私政策=True |
| 未勾选时按钮禁用 | ✅ | `button.disabled === true`，rect=[45,457,271,40] |
| 未勾选点按钮不可绕过 | ✅ | 点击后 DOM 仍含『使用前须知』 |
| 勾选控件 | ✅ | 原生 `INPUT[type=checkbox]`，`checked=false`，rect **16×16** |
| 勾选后按钮解禁 | ✅ | `disabled === false` |
| 同意后进入主界面 | ✅ | 弹窗消失，主页渲染（饱食度 80/心情 80/金币 100） |

⇒ **合规门禁本身实现正确**（此前在 release 上用像素猜坐标得到的判定已作废，见 §13 末）。

### D-COMPLIANCE 升级为两次独立复现

| 复现 | 观察 |
|---|---|
| ① release 全新首启（uid u0_a1295） | 启动 7s 内 `mCurrentFocus=permissioncontroller/GrantPermissionsActivity` |
| ② debug 全新首启（uid u0_a1296） | 首条观测即权限框抢占焦点；**紧随其后 DOM 仍含『使用前须知』且 `button.disabled=true`** |

⇒ 通知权限请求发生在用户同意隐私政策**之前**，跨两个构建、两个 uid 复现。修复：把 `POST_NOTIFICATIONS` 请求推迟到合规弹窗通过之后（或首次真要发通知时再请求）。

### D9 端侧模型：仍未验证，但根因已缩小到一处

- 模型 523MB 已按应用 UI 自己给出的路径 push 到位：`/sdcard/Android/data/com.spiritpal.desktop_pet/files/models/Qwen3.5-0.8B-MNN/`（10 文件，含 `config.json` + `llm.mnn`，正是页面要求的 MNN 目录标志）
- 页面原文承诺"→ 刷新后即可加载"，实际显示"**未发现模型**"
- **静态根因证据**：父目录 `models/` = `drwxrwxrwx u0_a1296`（应用自建并刻意放宽，见 `engine.rs:112-132`），而 `adb push` 创建的子目录 = **`drwxrwx--- shell shell`** → 应用 uid 既非属主也不在属组，other 位为 `---`，**无法遍历**（里面的文件虽 666 也到不了）
- **未做最终确认**：`chmod 777 子目录 → 再刷新`的 A/B 判别被中止；随后两次只读复测又都被系统权限框挡住（焦点守护按设计拦停，未注入点击）
- ⇒ **D9 记为未验证**。若上述权限推断成立，则属真实缺陷：应用文档化的投放路径自身走不通（普通用户不会 chmod）

### 新增触控目标缺陷实例（同族累计 4 处）

`切换主题 36×36`、`发送 40×40`、`清空 58×24`、**首启合规勾选框 16×16** —— 均低于 Android 48dp 建议值；其中勾选框在合规门禁上，影响所有首次用户。

## 18. 设备状态复原记录（我造成的破坏与还原结果）

测试过程中我卸载过 3 次应用（release→debug 往返），每次都会清掉机内数据。卸载前做了两份备份，并在测试结束后**把数据还原回 debug 包**。

| 步骤 | 结果 |
|---|---|
| 备份 | `backups/device-data-com.spiritpal.desktop_pet-20261001-pre-uninstall.tgz`（728,951B / 239 项，`adb exec-out run-as … tar -c`） |
| 传输 | `adb push` 到 `/data/local/tmp` 并 `chmod 644`（`run-as` 看不到 `/sdcard` 的 FUSE 命名空间；直接 `adb shell -T` 喂 stdin 会**截断到 337B**） |
| 校验 | 设备侧 `run-as … sha256sum` = 本地 `e06a58199e56d852ea1c65a1f482ea1de39b1e9da90bc6bcbf4218f3c90e8d2c` **逐位一致**后才解包 |
| 解包 | `run-as P tar -xz -C /data/data/P` OK；属主自动落到当前 uid `u0_a1296`，权限 `-rw-------` |
| 应用侧验证 | 启动后**不再要求同意**（consent 状态已还原）；状态栏读出 **coins=244 / Lv.2**（全新安装是 100 / Lv.1）⇒ 数据库确被读取；`crash` buffer 无本应用记录 |
| 未能验证 | 聊天历史是否完整回显——验证时用户接管手机（焦点转到 Winlator），WebView 渲染器冻结导致 CDP 超时，**未继续打扰** |
| 中转文件清理 | `/data/local/tmp/r.tgz`、`/sdcard/Android/data/.../files/r.tgz` 均已删除 |

### 应用内设置的复原（同样是我改过、必须还原的）

D12 语言扫描与 D9 测试期间，我把若干应用内设置改掉了；备份还原后又因备份时点问题带回了我改过的值。终局逐项复原并回显验证：

| 设置 | 我造成的值 | 复原后（回显确认） |
|---|---|---|
| 语言 | 한국어 | **中文** |
| 外观主题 | 다크（深色） | **浅色** |
| 宠物大小 | 0.9x | **1.7x**（你测试前的原值） |
| AI 服务商 | 端侧 (MNN Chat 本地) | **自定义 (Custom)** |
| 常驻权重内存 | RSS 1.36GB | `am force-stop` 已释放 |

**仍留在设备上的、我改过的状态**：手机装的是 **debug** 包（非 release）；`Android/data/.../files/models/Qwen3.5-0.8B-MNN/`（523MB）未删；通知权限为授予态（你自己在弹窗上点的允许）。

**教训（写给下一次的我）**：`adb shell <cmd>` 喂二进制 stdin 在 ColorOS 上会静默截断——任何"往设备灌数据再解包"的动作，**必须先做端到端 sha256 比对再解包**，否则截断的 tar 会静默毁掉目标目录。

## 19. 交付归档与构建产物清理（v2.67 铁律）

**先归档再清理**（否则清理会把交付物一起删掉）：release APK 已复制为 `artifacts/app-arm64-release.apk`，复制后 **sha256 与源文件逐位一致**（`730249ab0024a5fa5a65af79774e89aa…`，25,854,215 B）。

| 动作 | 结果 |
|---|---|
| 删除 `src-tauri/gen/android/app/build` | **24 GB**（含 09-29 遗留的 5 个 debug 包 3.77 GB：arm/arm64/universal/x86/x86_64） |
| 删除 4 个交叉编译 target 目录 | `aarch64` 4.5G + `armv7` 2.8G + `i686` 2.8G + `x86_64` 3.3G = **13.4 GB** |
| 删除本机模型副本 `artifacts/mnn-models/` | **523 MB**（D9 已结案，SHA-256 校验记录保留在 §15） |
| 删除设备上模型副本 | 随 debug 包卸载一并清除 |
| **C 盘** | 清理前 76 GB 可用 → **113 GB 可用**（回收约 37 GB） |

**刻意保留**：`dist/`（45 文件，`custom-protocol` 编译期依赖，删了 Gradle 直调链会编不过）、`artifacts/app-arm64-release.apk`、`backups/` 下 2 份设备数据快照（`…20260930.tgz` 217 项、`…20261001-pre-uninstall.tgz` 239 项，均含 `spiritpal.db`+wal 与加密 secrets）。

**debug 包已随清理删除**，需要时按 SOP-4 重跑 `gradlew assembleArm64Debug` 即可（debug 依赖缓存此前已存在，重建成本低）。

## 20. 设备终态

| 项 | 状态 |
|---|---|
| 已装包 | **release arm64 25.85MB**（`flags=[HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP]`，无 DEBUGGABLE；versionName 0.1.0 / versionCode 1000 / minSdk 24） |
| 数据 | 全新空档（换机需卸载 debug，release 非 debuggable ⇒ 无法用 `run-as` 回写；快照保留在 `backups/`） |
| 待你处理 | 手机上正挂着**通知权限确认框**与《使用前须知》合规弹窗——这是 §9/§17 那条 D-COMPLIANCE 的第 3 次复现现场，我没有代点 |
| 应用内设置 | 语言 中文 / 主题 浅色 / 宠物大小 1.7x / 服务商 自定义 (Custom)（见 §18 复原表） |
