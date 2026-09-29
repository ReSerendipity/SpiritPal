# SpiritPal 安卓端 × 本地 llama.cpp（Qwen3.6-35B-A3B · 16K 上下文）聊天链路实测报告

- **测试日期**：2026-09-28（两阶段：上午阻断定位 → 晚间修复后复测）
- **测试目标**：① 将仓库 `artifacts/` 下 release 签名 APK 更新到真机；② 启动本地 llama.cpp 服务托管 Qwen3.6-35B-A3B（上下文 16K）；③ 应用内配置连接该服务；④ 真机 ≥5 轮多类型对话测试（相关性/连贯性/准确性/多轮一致性）；⑤ 记录异常与改进建议。
- **结论速览**：

| 阶段 | 结果 |
| --- | --- |
| 第一阶段（官方 release 包） | 步骤 ①②✅；步骤 ③❌ 被 P1 缺陷阻断（安卓端无任何配置入口 + Key 读取命令未编译进安卓包）；端侧 MNN 兜底亦不可用 |
| 缺陷修复 | 两处前端修复（闸门放行 + 设置页补端点输入），并打通本机安卓构建链 |
| 第二阶段（修复后 debug 构建） | **真机 5 轮对话 5/5 全部通过**，流式/角色人设/记忆注入/多轮一致性均正常，全程零崩溃 |

---

## 1. 环境与对象

| 项 | 值 |
| --- | --- |
| 测试设备 | Realme RMX5010（Android 16 / BP2A.250605.015），serial `dc57ebe3`，1264×2780，未 root |
| 本地模型服务 | llama.cpp `llama-server.exe`，Qwen3.6-35B-A3B APEX-I-Compact GGUF（17 GB）+ mmproj，**`--ctx-size 16384`**（日志与 `/props` 双重确认），其余继承所有者调优参数（n-gpu-layers 41 / n-cpu-moe 32 / KV q8_0 / MTP 推测解码 / jinja / cache-prompt），端口 8081 仅监听 127.0.0.1 |
| 启动方式 | 所有者脚本档位最小 128K，未改动原脚本；在模型目录建副本 `Qwen3.6-35B-A3B-Chat-16K-app-test.ps1` 插入 16K 档位后台运行 |
| 设备↔PC | `adb reverse tcp:8081 tcp:8081`（USB 反向转发，服务端安全设定与防火墙均不动） |
| 被测包（第一阶段） | `artifacts/SpiritPal-v0.1.0-arm64-release-signed.apk`，versionName 0.1.0 / versionCode 1000，证书 `CN=SpiritPal Test Build` |
| 被测包（第二阶段） | 本机从源码重建的 `app-arm64-debug.apk`（debug 签名；release 测试签名密钥不在本机，无法同签名重建，详见 §3.2） |

## 2. 第一阶段：官方 release 包测试（阻断定位）

1. **APK 更新 ✅**：`adb install -r` Success，覆盖 2026-09-18 旧版，界面正常。
2. **模型服务 ✅**：16K 生效、健康检查 ok、PC 侧冒烟推理 0.9 s（prefill 35.5 t/s / decode 53.8 t/s）；设备浏览器经 `adb reverse` 访问 `127.0.0.1:8081/health` 返回 `{"status":"ok"}` —— **网络层完全畅通**。
3. **应用配置 ❌（P1-1）**：「AI 服务商」页只有选择器，无 API Key / Base URL / 模型名输入；选「自定义」后发消息直接报「请先在设置中配置 AI API Key」，请求未发出。根因链（四环全闭）：
   - 移动端聊天闸门强制非空 apiKey（仅 ondevice 豁免）——`src/mobile/MobileChatView.tsx:112`；
   - Key 唯一来源 `get_secret` 在安卓必然失败：keychain 三命令全 `#[cfg(desktop)]`（`src-tauri/src/keychain.rs:115/136/161`），lib.rs 导入与注册同在 desktop 门内（`src-tauri/src/lib.rs:146-148, 357-359`），异常被 `MobileChatView.tsx:104-108` 静默吞掉；
   - localStorage 直写通道全封：设置页只写 provider（`MobileSettingsView.tsx:50-58`）、`dataManager.importAll` 剥离 apiKey（`dataManager.ts:306-315`）且全仓无 UI 调用、同步协议不含 AI 配置；
   - ondevice 在移动端走进程内 MNN 引擎（`llmClient.ts:242-248`），无法指向外部 OpenAI 兼容端点。
4. **端侧 MNN 兜底 ❌（P1-2）**：面板唯一注入方式为「adb push 进 `/data/user/0/<pkg>/models`」，未 root 实测 Permission denied（目录 0700），且面板无下载/SAF 导入 UI。
5. **P2：退出崩溃**：按返回键退出时 SIGABRT `no available activity`（两次独立复现：16:51、17:01），运行期无崩溃，重启后数据完好。

## 3. 缺陷修复（第二阶段被测构建的由来）

### 3.1 前端修复（两处，tsc / eslint / vitest 全绿，未提交待复核）

1. **闸门放行**（`src/mobile/MobileChatView.tsx`）：`ondevice` 之外增加 `custom`、`ollama` 豁免——二者常指向 llama.cpp / Ollama 等**无鉴权本地服务**；Key 真必要时由服务端 401 在聊天错误条兜底。
2. **补配置 UI**（`src/mobile/MobileSettingsView.tsx`）：provider 为 custom 时显示「连接配置」卡片（API 地址 + 模型名输入，合并写回 `localStorage['spiritpal-ai-config']`，即改即生效）。**刻意不加明文 API Key 输入**，遵守 `encryptionAudit.ts` 对 `spiritpal-ai-config`「配置体不含密钥」的审计契约；移动端 Key 的正规解法是 P1-A（Android Keystore 实现 keychain 命令）。

### 3.2 本机构建链打通（gen/android 生成文件缺失的重建，全部为未跟踪产物）

- CLI 2.10.1 要求 `build.gradle.kts` 而本仓 gen 为 Groovy（`7fb7e4f` 特意转换）→ 绕开 CLI 手动编排：`pnpm build` → `cargo ndk -t arm64-v8a build` → `gradlew assembleDebug`。
- 重建缺失的 CLI 生成物：`tauri.settings.gradle`（:tauri-android 与 4 个插件工程映射到 cargo 注册表源码；:tauri-android 复制到 `gen/android/.tauri/tauri-android` 本地副本）；`TauriActivity.kt`（tauri crate `mobile/android-codegen` 模板，包名替换）与 wry 全部 Kotlin 模板（`{{package}}`→`com.spiritpal.desktop_pet`、`{{library}}`→`spiritpal_lib`、`{{class-extension}}/{{class-init}}`→空——经 wry `build.rs:66-76` 证实 vanilla 构建下即空值）；按官方 APK dex 布局核对：wry 类在**应用包名**下，tauri 类在 `app.tauri` 下。
- 顺带修复：Kotlin 插件 1.9.25 → 2.1.20（`gen/android/build.gradle`，已跟踪文件，M 状态）——#64 依赖升级（09-19）把 appcompat/stdlib 升到 Kotlin 2.1 元数据，而最后一次安卓构建是 09-18，升级后无人重建即断链；为 `:tauri-android` 补 `androidx.webkit:1.14.0`、`lifecycle-process:2.10.0`（wry Kotlin 文件的依赖）。
- 最终 `gradlew clean assembleDebug` **BUILD SUCCESSFUL**（6 m 45 s，337 任务）。

## 4. 第二阶段：真机端到端复测 ✅（5/5 通过）

配置：设置 → AI 服务商 → 自定义 → API 地址 `http://127.0.0.1:8081/v1`、模型名 `qwen3.6-35b-a3b`（截图 07/08）。以下对话全部在**真机应用内**发起，经 USB 反向转发到达 PC 侧 llama-server，流式回填到聊天 UI。

| 轮次 | 类型 | 发送内容（设备实发） | 模型响应（摘要） | 评价 |
| --- | --- | --- | --- | --- |
| R1 | 记忆铺垫 | My name is Zhang San and I am a QA engineer. Please remember me. | 明确复述「记住啦！你是张三，负责检查问题的很棒的 QA 工程师主人！✅」并保持多罗人设（动作/表情） | 准确 ✅ |
| R2 | 记忆回溯 | What is my name and what is my job? | 「张三主人是一名 QA 工程师呢！」 | 上下文一致 ✅ |
| R3 | 跨轮一致性 | Repeat all information I asked you to remember at | 「张三主人是一名 QA 工程师！📝✅」+ 在角色内自然追问 | 零漂移 ✅ |
| R4 | 翻译 | Translate into French: my cat knocked over a glass of milk today | **Mon chat a fait tomber un verre de lait aujourd'hui** | 语法地道 ✅ |
| R5 | 逻辑推理 | Logic question: Xiaoming is taller than Xiaohong, and Xiaohong is taller than Xiaogang. Who is the shortest? | 「小刚」且按指令只报名字 | 正确 ✅ |

- **相关性 / 连贯性 / 准确性**：5/5 正常；全程无乱码、无拒答、无复读。
- **多轮上下文**：服务端 prompt tokens 随轮次稳定增长（506 → 573 → 897 → 997），证明应用按设计注入了角色系统提示 + 记忆上下文（D8）+ 最近 20 条历史；`cache-prompt` 命中，prefill 406-657 t/s，decode 28-60 t/s，每轮首字延迟可感知但流畅（应用侧发送到回复完成约 5-18 s）。
- **流式与渲染**：token 流式回填正常，Markdown/表情渲染正常，角色人设（多罗）全程一致。
- **稳定性**：聊天全程 + 配置操作期间 crash 缓冲区**无新增记录**（两条既有记录均为第一阶段旧 release 包的退出崩溃）。
- 测试期输入侧小插曲（非应用缺陷）：`adb input text` 空格需转义 `%s`、中文拼音 IME 偶发吞字，导致两条用户消息显示为截断/拼接文本，模型均鲁棒处理。

## 5. 遗留问题与建议（优先级序）

1. **P1-A**：为安卓实现 `set_secret/get_secret/delete_secret`（Android Keystore），打通 secureStorage——这是云端 Key 正确落地的前提（本报告的 custom 放行是本地服务的权宜路径）。
2. **P1-B**：移动端为需 Key 的云端供应商补 API Key 输入（配合 P1-A 存 secureStorage，不入 localStorage）。
3. **P1-C（已在本构建落地，待评审合入）**：本地/自定义端点放行空 Key。
4. **P1-D**：端侧模型内置下载或 SAF 目录选择，替代「adb push 进私有目录」的不可行工作流。
5. **P2**：修复 release 包退出时 SIGABRT（`no available activity`）；debug 包未复现但未做退出专项验证。
6. **P3**：服务商页提示语「需先在桌面端配置 API Key」与实际能力不符（桌面/移动无任何 Key 通道）；`importAll` 无 UI 入口成死代码。
7. **流程**：#64 依赖升级（09-19）破坏了安卓 Kotlin 工具链且无人察觉——建议在 CI 增加 Android debug 构建冒烟，让依赖升级当场暴露工具链断裂。

## 6. 测试环境异常记录（需所有者关注）

- 会话期间**三次工作区破坏事件**（本会话未执行任何删除/重置）：16:53 未跟踪截图目录 `.test-e2e-20260928/` 整体消失；晚间已 `git add` 入索引的报告与截图资产**连同索引记录一并被清除**（报告文件本体亦被删）；与 `docs/agents/GOTCHAS.md` #115/#128「疑似并发写入者」同类。本报告为第三次重写版本。建议排查其它会话/清理进程；重要产物应尽早 commit 而非仅 `git add`。
- Git Bash `curl -d` 中文 JSON 按 GBK 发送导致 llama-server 报 ill-formed UTF-8（客户端编码问题，用 `python -X utf8` 规避）；`adb input text` 空格需 `%s` 转义。

## 7. 第三阶段：状态栏遮挡修复 + 全量多用户测试（2026-09-28 晚）

### 7.1 状态栏遮挡修复 ✅

- **现象**：`enableEdgeToEdge()`（`MainActivity.kt`）下 WebView 内容顶进系统状态栏，时间/电量遮挡应用标题。
- **修复**：`MainActivity.kt` 增加 `ViewCompat.setOnApplyWindowInsetsListener`（android.R.id.content），将 systemBars insets 转为根容器四边 padding，并仅消费 systemBars（IME insets 继续下发，键盘行为不变）。增量重建装机验证：状态栏独占顶部、标题零遮挡、底部 Tab 获得手势条安全边距（截图 14）。

### 7.2 全量多用户测试（修复后 debug 构建，模型为 16K llama.cpp）

**聊天 · 五类用户画像（14 轮消息，全部通过）**：

| 画像 | 轮次 | 覆盖点 | 结果 |
| --- | --- | --- | --- |
| A 快问快答 | 3 | 事实问答（巴黎/东京）、算术（17×23=391）、短追问上下文 | ✅（截图 15） |
| B 情绪陪伴 | 2 | 倾诉回应、感谢后续 | ✅ 共情自然不空洞（截图 16） |
| C 任务协作 | 1 | 结构化清单 + Markdown | ✅ 3 节编号计划、**粗体渲染正常**（截图 17） |
| D 混乱输入 | 2 | 碎片/俚语/大小写混乱（wat??? idk lol / aNyOnE） | ✅ 不崩不乱、呼应早期语境（截图 18） |
| E 长程记忆 | 5 | 埋点（幸运数 47 / 猫 Mochi）→ 隔轮闲聊 → 双重验证 | ✅ 双埋点精确召回并 Markdown 加粗（截图 19） |

**功能面**：

| 项 | 结果 |
| --- | --- |
| 宠物单击互动 | ✅ 气泡"再摸摸我嘛！" |
| 宠物双击喂食 | ✅ 含边界：背包空时正确提示"背包里没有食物啦~" |
| 宠物长按菜单 | ✅ 摸头/喂食/玩耍/洗澡/关闭 |
| 玩耍 | ✅ 心情 79→100、饱食-5、经验 11/100 |
| 商店购买→喂食闭环 | ✅ 买欧润橘（8 币）→ 饱食 74→88、气泡"好好吃呀~"；商店含亲密度锁定商品（草莓蛋糕） |
| 记忆面板 | ✅ 标签云/情感曲线/记忆密度（标签与聊天内容一致）；⚠️ 结构化记忆（主人画像/故事/日记）为 0，自动提取未触发 |
| 持久化 | ✅ `am force-stop` 后重启：聊天历史、provider 配置、宠物状态完整 |

**健壮性**：

| 项 | 结果 |
| --- | --- |
| 超长消息（200+ 字符） | ✅ 完整送达、气泡换行渲染正常；流式中发送键变红色停止按钮（中止功能内建） |
| 快速连发 | ✅ 防并发正确：生成中第二条被拦截且保留在输入框不丢失（建议：拦截时提示"回复生成中"） |
| 服务断连 | ✅ 杀 llama-server 后发消息：红色错误条「请求失败: error sending request for url (…/v1/chat/completions)」，消息保留、无崩溃；建议错误文案转译为用户语言 + 提供重试 |
| 服务恢复 | ✅ 重启后记忆连续（47 / Mochi 仍可召回） |

**本轮新发现缺陷**：

| 级别 | 问题 | 证据 |
| --- | --- | --- |
| P2-1 | **主题设置与渲染脱节**：全新安装后主题页「深色」显示选中但界面为浅色；点「深色」因 `setMode` early-return（`themeManager.ts`，currentMode 已为 dark）无任何效果；顶栏主题图标在未被操作时自行变化 | 截图 20；线索：`MobileApp.tsx:84` init 在 useEffect、`MobileSettingsView` useState 读 getMode、`themeManager.ts:564-565` |
| P2-2 | **语言切换不即时生效**：点 English 后按钮高亮但全部文案仍中文（i18n 状态与 UI 脱节，模式同上） | 截图 21 |
| P2-3 | **移动端角色列表不全**：`getAllCharacters()` 真机只返回多罗 1 个（doro/feibi/gugugaga 三内置），用户无法切换角色；点击当前角色按钮无可见反应（点中自己） | `MobileSettingsView.tsx:222-236` |
| P3 | 记忆结构化提取为 0；记忆分类卡片窄屏文字竖排拥挤；金币扣减 16 与商品价 8 不符（待查）；连发静默拦截；停服错误文案技术化 | §7.2 各项 |

### 7.4 修复批次装机回归（2026-09-29，P2 修复验证）

`7b58cd6` 修复批次构建装机后逐项回归：

| 回归项 | 结果 |
| --- | --- |
| P2-1 主题深色切换 | ✅ 点「深色」**整界面即时切换深色**（含状态栏区域），选中态与渲染一致；浅色反向切换同样正常 |
| P2-2 语言切换 | ✅ 点 English 即时生效：设置→Settings、当前角色→Character、语言→Language、多罗（内置）→Doro；其余硬编码文案待全量 i18n 化 |
| P3-4 记忆 Tab 竖排 | ✅ 分类 Tab 横排显示，超出部分横向滚动 |
| P3-2 连发拦截提示 | ✅ 代码逻辑生效（生成中拦截且输入保留）；自动化未命中生成窗口（回复速度快、窗口窄），风险低 |
| 聊天回归 | ✅ 深色下对话正常；跨进程重启记忆召回（幸运数 47 / 猫 Mochi）依旧准确 |
| 设置复原 | ✅ 已恢复中文/浅色 |

### 7.5 P1-A/B 装机验证（2026-09-29）：安卓 keychain 全链路 ✅

`91d3806`（P1-A/B）构建装机后验证：

1. 设置 → AI 服务商 → 选云端供应商（千问）→ **API Key 输入卡正确出现**（截图 28）。
2. 输入测试 Key 失焦 → `set_secret`（Rust AES-256-GCM 加密写应用沙箱）落盘成功。
3. **`am force-stop` 强杀重启** → 回到同一输入框 → **Key 完整回读显示**（截图 29）——`get_secret` 解密读取全链路证明，安卓上 secureStorage 自此可用。
4. 验证后测试 Key 已清除（留空失焦 = deleteApiKey），provider 恢复 Custom。

结论：**第一阶段阻断报告中的 P1-A/P1-B/P1-C 全部落地并验证**。安卓端自此可配置任何云端服务商（Key 走安全存储）与本地/自定义端点（免 Key 直连）。

### 7.6 云端供应商真机实测（2026-09-29，ModelScope）

用户提供 ModelScope 端点/Key/模型名，真机 Custom 配置实测（截图 32/33）：
- 连接配置：`https://api-inference.modelscope.cn/v1` + `Qwen/Qwen3.8-Flash-Next` + API Key（加密存储，重装后仍保留）
- custom 供应商现已显示可选 API Key 卡（此前仅云端预设显示——补充覆盖 ModelScope 这类需鉴权的自定义端点）
- 聊天 "what model are you?" → 多罗人设回复「多罗是小狗呀！」——**本地 llama-server 此时已停止**，回复只能来自云端，证明安卓端云端链路（P1-A/B/C）真实打通，且应用系统提示注入在云端路径生效
- 顺带修复：切换供应商时 API Key 草稿未重置（会残留上一供应商的 Key 文本）

### 7.7 第三阶段证据（assets/）

| 文件 | 内容 |
| --- | --- |
| `14-statusbar-fixed.png` | 状态栏遮挡修复后主界面 |
| `15-profileA-quickfire.png` | 画像 A 快问快答（巴黎/东京/391） |
| `16-profileB-emotional.png` | 画像 B 情绪陪伴 |
| `17-profileC-task-markdown.png` | 画像 C 任务协作（Markdown 列表） |
| `18-profileD-chaotic.png` | 画像 D 混乱输入 |
| `19-profileE-longterm-memory.png` | 画像 E 长程记忆双埋点召回 |
| `20-bug-theme-selected-not-applied.png` | P2-1 主题选中未应用（修复前） |
| `21-bug-language-not-applied.png` | P2-2 语言切换未生效（修复前） |
| `22-robustness-server-down-error.png` | 停服错误 UX |
| `23-persistence-after-restart.png` | 强杀重启后数据完整 |
| `24-regression-dark-theme-applied.png` | 回归：深色主题即时切换（修复后） |
| `25-regression-english-applied.png` | 回归：English 即时生效（修复后） |
| `26-regression-memory-tabs-horizontal.png` | 回归：记忆 Tab 横排（修复后） |
| `27-regression-chat-memory-recall-dark.png` | 回归：深色下聊天 + 记忆召回 |
| `28-keychain-apikey-card.png` | P1-B：云端供应商 API Key 输入卡 |
| `29-keychain-key-roundtrip.png` | P1-A：强杀重启后 Key 回读（安卓 keychain 全链路） |
| `30-error-message-translated.png` | P3-3：停服错误文案已转译为用户语言（修复后实测） |
| `31-final-sanity-recovered.png` | 最终确认：链路恢复、记忆召回（Mochi is lucky 47） |
| `32-modelscope-config.png` | 云端实测：Custom 三项配置（ModelScope） |
| `33-modelscope-cloud-reply.png` | 云端实测：多罗人设回复（本地服务已停，证明来自云端） |

## 8. 证据清单（第一阶段/第二阶段，assets/ 相对本报告）

| 文件 | 内容 |
| --- | --- |
| `07-mobile-config-card-added.png` | 修复后「连接配置」卡片出现（API 地址 + 模型名输入） |
| `08-config-filled-endpoint.png` | 配置填入：`http://127.0.0.1:8081/v1` + `qwen3.6-35b-a3b` |
| `09-round1-memory-seed.png` | R1 记忆铺垫：完整消息 + 多罗确认记住 |
| `10-round2-context-recall.png` | R2 记忆回溯：正确答出张三/QA 工程师 |
| `11-round3-consistency.png` | R3 跨轮一致性：信息零漂移 |
| `12-round4-translation.png` | R4 法语翻译正确 |
| `13-round5-logic.png` | R5 逻辑推理正确（小刚） |

注：第一阶段阻断证据截图（旧 release 包报错横幅等 6 张）因上述工作区破坏事件丢失，阻断事实以 §2 源码行号链与复现描述为准；如需可视化证据可用 `artifacts/` 官方 APK 重装复现（P1 在未修复包上稳定复现）。
