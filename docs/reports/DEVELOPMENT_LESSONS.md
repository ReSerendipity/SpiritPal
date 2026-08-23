# SpiritPal 开发踩坑与经验教训（DEVELOPMENT_LESSONS）

> 本文档沉淀自 2026-08-13 ~ 08-14 的构建与问题修复全过程（debug/release 构建、跨平台打包、窗口交互系列问题：点击无反应、拖不动、重叠闪烁、启动瞬现弹窗等）。每条教训都对应一次真实的踩坑，标注了根因与修复方式，供后续开发避坑。
>
> 配套文档：[可复用最佳实践](analysis/Reusable_Best_Practices.md)（正向模式）· [架构说明](ARCHITECTURE.md)（系统结构）

---

## 1. 构建与工程流程

| 教训 | 说明 |
|------|------|
| **构建前清理占用 exe 的进程** | Windows 上 exe 被占用时 cargo 报 `failed to remove file (os error 5)`，构建中断。进程名**按文件名派生**（`SpiritPal_0.1.0_portable-win64.exe` → 进程名 `SpiritPal_0.1.0_portable-win64`），不能只按内部名 `spiritpal-app` 杀进程——按 `Name -match "spiritpal|SpiritPal"` 匹配清理 |
| **不要并发跑多个 tauri/cargo 构建** | 并行构建竞争 build 目录文件锁（`Blocking waiting for file lock`），后启动的构建阻塞或失败；一次只跑一个构建 |
| **`tauri android build` 默认就是 release** | `--release` 不是有效参数（报 usage 错误）；`--debug` 才是 debug 模式；`--apk` 输出 APK |
| **前端产物与 SRI 必须同步** | `dist/` 由 beforeBuildCommand（tsc → vite build → obfuscate）生成，`sri_hashes.rs` 由混淆脚本同步生成并嵌入 Rust；两者必须同一构建产出，否则资源加载校验失败 |
| **提交前检查产物泄漏** | `.gitignore` 必须覆盖 node_modules / dist / src-tauri/target / artifacts（含 *.apk、*.exe） |

## 2. Tauri v2 权限（capability / ACL）——最容易踩、最难查的一类

**核心认知**：Tauri v2 中前端调用**插件命令**（`@tauri-apps/api/*`）受 capability 权限控制；**应用自定义命令**（`#[tauri::command]`）不受 ACL 限制。权限缺失时**前端 Promise 被拒，而项目代码普遍用 `catch {}` 静默吞掉——表现为"点击无反应"，第一手证据在日志**（`not allowed by ACL`）。

| 前端 API | 所需权限 | 踩坑备注 |
|----------|---------|---------|
| `new WebviewWindow()` | `core:webview:allow-create-webview-window` | `core:window:allow-create` 不够！两者是不同插件 |
| `getAllWindows()` | `core:window:allow-get-all-windows` | `allow-list` 是错误权限名，构建时直接报错 |
| `win.outerSize()` | `core:window:allow-outer-size` | 缺失时窗口 S/M/L 自适应档位永远不更新 |
| `win.outerPosition()` / `scaleFactor()` / `setPosition()` | 对应 `allow-outer-position` / `allow-scale-factor` / `allow-set-position` | 手动拖拽链路依赖 |
| `data-tauri-drag-region` 拖拽条 | `core:window:allow-start-dragging` | 缺失时拖拽条无响应（日志 `start_dragging not allowed by ACL`） |
| 无边框窗口边缘缩放手柄 | `core:window:allow-start-resize-dragging` | 缺失时窗口无法缩放 |
| `win.onResized`（事件监听） | `core:event:allow-listen`（在 core:default 内） | 默认可用 |

**其他要点**：
- **每个窗口独立 capability**：chat-window / settings-window / pet-window 各配一个文件，按窗口 label 匹配；子窗口的标题栏拖拽条需要自己的 `allow-start-dragging`
- 权限名写错会在构建期暴露（`Permission xxx not found`），**正确性以 Tauri 源码 permissions 目录为准**（如 `core:window:allow-get-all-windows`）
- 排查 ACL 问题：看 `%LOCALAPPDATA%/<identifier>/logs/spiritpal.log` 里的 `[ERROR] Command plugin:... not allowed by ACL`

## 3. 多窗口与路由

- **多窗口共用同一前端 bundle**：子窗口 URL 用 hash 路由（`index.html#/chat`），但 `getRoute()` 若优先从 localStorage 恢复 `last_route`（宠物窗口持续写入 `/pet`），**子窗口一打开就被渲染成宠物窗口**（现象：点"聊天"出现"又一个宠物"）。
  **教训：URL hash 必须优先于 localStorage 恢复**；localStorage 只在无 hash 时兜底。

## 4. 透明窗口与像素级点击穿透

- **透明窗口的整个矩形都拦截鼠标**：`transparent: true` 的窗口看不见边界，但矩形内所有点击都被窗口吞掉——用户"点在窗口内部完全无法使用，遮蔽正常按键"。
  **解法**：像素级点击穿透（参考 CodeWalkers/BongoCat）：轮询鼠标位置（~100ms）+ `elementFromPoint` + 角色区域 alpha 检测，透明区域调用 `set_pet_click_through`（WS_EX_TRANSPARENT）直达下层。
- **穿透白名单的两个方向性陷阱**：
  - **绝不能**把覆盖全窗口的背景拖拽层（`.spiritpal-drag-surface`，absolute inset-0）加入白名单——它会导致**所有位置都被判定为交互区域，穿透永久失效**（表现为"穿透没生效"）
  - **必须**加入白名单：顶部原生拖拽条（`[data-tauri-drag-region]`）、边缘缩放手柄（`.spiritpal-resize-handle`）、状态卡片等面板（`[class*="panel"]`）——否则这些交互元素会被穿透吞掉
- **穿透后的交互约定**：空白区域点击直达桌面（不再可拖）；**拖动窗口靠宠物本体或顶部拖拽条**——这是桌宠的标准交互，不是缺陷。

## 5. 窗口置顶与 Z 序

- **置顶保活 `SetWindowPos(HWND_TOPMOST)` 必须带 `SWP_NOACTIVATE`**：不带时每次置顶都会**激活窗口抢焦点**——两个窗口重叠时焦点反复横跳（用户描述"一个在上一个在下反复串行"），拖拽时鼠标捕获被反复打断（"拖不动"）。
- **保活轮询频率**：16ms（60fps）会导致重叠时 60fps 抢占 Z 序（闪烁）；**1s 轮询足够**（防全屏/其他置顶应用遮挡，用户无感知）。
- **保活线程必须全局去重 + 只保活主窗口**：`main.tsx` 在**每个窗口**的 webview 中都会执行 `enableWindowsPinMode()`，若各自启动线程，打开 N 个子窗口就有 N 个线程互抢 Z 序。修复：Rust 命令强制获取 `pet-window` 的 HWND + `static AtomicBool` 去重。
- **去重标志要在窗口查找成功后再置位**：先 `swap(true)` 再查找窗口，查找失败会导致标志永久占位、保活永不启动（顺序缺陷）。

## 6. 拖拽交互

- **拖拽轮询"静止 200ms 判定拖拽结束"是 bug**：用户拖动中短暂停顿会被误判结束，窗口立即 40px 吸边跳离光标、后续移动不再跟随（"拖不动/拖飞"）。**鼠标仍按下（拖拽中）时不得结束拖拽/吸附**。
- **像素穿透后的鼠标事件丢失**：WS_EX_TRANSPARENT 后 WebView 收不到 mouseup/mouseleave，拖拽状态可能永久卡住。需要**超时兜底**（轮询中按下超过 3 秒且无鼠标事件 → 强制清理拖拽状态）+ mousemove 刷新按下时间戳（有事件 = 事件流正常）。

## 7. 单实例（tauri-plugin-single-instance）

- **tauri.conf.json 的 `app.windows` 在 Builder 初始化时创建（早于插件 setup 的互斥检测）**：每次重复启动/快速双击都会**先创建并显示主窗口，再被插件拦截退出**——"启动时弹出一大堆窗口瞬间消失"（日志证据：连续多次完整 `starting up` 记录）。
  **修复：主窗口创建移到 app setup**（`WebviewWindowBuilder` 全参数迁移：尺寸/透明/无边框/置顶/跳过任务栏等）。插件 setup 先于 app setup 完成互斥检测——只有第一个实例能创建窗口。
- 验证"无闪现"时，监控脚本必须枚举**所有可见窗口**（不能只按 SpiritPal 标题过滤，会漏掉子进程窗口——见第 8、11 节）。

## 8. 子进程与命令行窗口（本次"瞬现弹窗"的直接根因）

- **Rust 里 `Command::new("reg")` 不带 `CREATE_NO_WINDOW`（0x08000000）→ 每次调用闪现一个控制台窗口**。本次根因：`crypto.rs::get_machine_id()` 在启动时执行 `reg query` 读 `MachineGuid`（加密密钥派生），每次启动都弹出一个 reg.exe 控制台窗口（约 0.1~0.6 秒消失，用户录屏逐帧确认"中央深色标题栏空白窗口"）。
  **修复**：`cmd.creation_flags(CREATE_NO_WINDOW)`（`use std::os::windows::process::CommandExt`）。
- **通用规则**：任何 spawn 子进程都要考虑窗口可见性——Windows 上 CLI 程序（reg / cmd / powershell / xdotool 等）都会弹控制台窗口；优先用 API 替代子进程（如读注册表用 winreg crate），必须用子进程时加 `CREATE_NO_WINDOW`。
- 排查技巧：30ms 高频窗口枚举能抓到 0.1 秒级的瞬现窗口（标题 + 窗口类名 + 尺寸）。

## 9. 前端混淆（javascript-obfuscator）

- **高危选项在 ESM 动态 import 场景生成运行时损坏代码**：`controlFlowFlattening` + `selfDefending` + `splitStrings` + `transformObjectKeys` 组合可能导致字符串数组解码失败 → `TypeError: xxx is not a function` → 窗口加载崩溃闪现（"弹出一大堆窗口瞬间消失"）。日志表现为 `GlobalError` / `UnhandledRejection`。
- **每次构建混淆结果不同 → bug 只在部分构建出现**（排查时对比构建时间线与日志）。
- **保守配置**：`controlFlowFlattening: false` / `selfDefending: false` / `splitStrings: false` / `transformObjectKeys: false`，保留 `stringArray` 基础混淆 + SRI 完整性校验；vendor 与 rolldown-runtime chunk 跳过混淆（CJS 互操作语义）。

## 10. 数据与启动

- **不要启动时删除整个 EBWebView 目录**：WebView2 正常退出时锁文件也常残留，误删会导致 localStorage 全部丢失（首次引导反复出现）+ 每次冷启动初始化（启动闪窗/白屏）。WebView2 自身能处理锁与损坏恢复。
- **WebView2 内容视口与窗口物理尺寸可能不一致**（DPI 缩放、SetWindowPos 模拟 resize 不触发 Tauri resize 事件）——验证窗口自适应逻辑时用真实缩放手柄而非 SetWindowPos。

## 11. 调试方法论（本轮最值得沉淀的部分）

1. **日志是第一手证据**：`tauri_plugin_log` 写入 `%LOCALAPPDATA%/<identifier>/logs/spiritpal.log`；前端运行时错误通过 `log_frontend_error` 命令写入；排查"点击无反应/弹窗/崩溃"先看日志（ACL 拒绝、GlobalError、启动次数、保活线程数都有记录）。
2. **监控过滤条件要覆盖所有可见窗口**：按标题过滤会漏掉子进程窗口（reg.exe 窗口标题是命令路径）；瞬现窗口用 30ms 高频枚举（窗口标题 + 类名 + 尺寸 + 首次出现时间）。
3. **PrintWindow / ImageGrab 对 WebView2 GPU 合成层（文本、半透明浮层）捕获不可靠**：截不到 ≠ 没渲染。**DOM 级验证才是可靠依据**（ref callback + `getBoundingClientRect()` + 按钮点击行为）。像素统计（非黑占比）可辅助。
4. **图像模型 OCR 会误读小字**（"多罗"→"多梦"、"就你了"→"签到"）：重要文字用**原始分辨率帧**逐字核对 + 像素统计交叉验证。
5. **模拟点击受多因素干扰**（firstRun 引导、窗口焦点、像素穿透、透明合成），"点击落空"不等于功能坏；先确认界面状态再判定。
6. **临时诊断日志必须清理**：用 `log_frontend_error` 打 `[diag]` 标记，定位后 `git grep '\[diag\]'` 确认清零。
7. **进程退出 ≠ 崩溃**：single-instance 拦截、正常退出都会让监控中的进程消失；结合日志启动次数判断。
8. **多轮修复后的回归**：每个修复都要有"修复前必现 / 修复后零出现"的对照验证（本次 reg.exe 窗口：修复前 t=0.62s 必现，修复后 12 秒监控零出现）。

## 12. 移动端构建

- `tauri android build` 无需 `--release`（默认 release），`--debug` 为 debug；`--apk` 生成 APK（4 个 ABI 的 universal 包）
- release APK 签名验证：`apksigner verify --print-certs xxx.apk`
- Android debug 包很大（4 ABI 未压缩，1GB+ 正常）；release 经 R8 + 签名后大幅缩小

---

## 变更记录

| 日期 | 内容 |
|------|------|
| 2026-08-14 | 初稿：沉淀 2026-08-13~14 构建与窗口交互问题修复全过程（capability 权限、像素穿透、置顶保活、单实例、reg.exe 控制台窗口、混淆器、调试方法论） |
