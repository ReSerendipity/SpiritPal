# 安全审计 — SpiritPal

> 只读审计 · 适配版（Tauri v2 Rust + React 19 桌面宠物，私有仓库）
> 审计日期：2026-09-01 · 审计对象：`src-tauri/`（Rust）+ `src/`（React/TS）

## 执行摘要（总体评级：中 / Medium）

整体安全水位较高：Rust 侧 `asset_pipeline` 做了白名单+字符黑名单+非 shell 执行，密钥走系统 Keychain，CSP 严格（`script-src 'self'`），`Cargo.lock` 已 pin。主要风险是 **Tauri capability 过度授权**（`sql:allow-execute`）与 **Android 签名默认口令**。共 5 项发现（1 中高 / 1 中 / 1 低中 / 2 信息级良性）。

## 按维度发现

### 1. 凭据 / 密钥
- **[S2-Medium] Android 签名默认口令**：`src-tauri/gen/android/app/build.gradle.kts:38-40` 中 `keyPassword = keystoreProps.getProperty("keyPassword", "spiritpal123")`、`storePassword = ... "spiritpal123"`——若 `keystore.properties` 缺失则回退到硬编码弱口令 `spiritpal123`（且仓库未提交 keystore，已验证 `git ls-files` 无 `.jks`，故暂未泄露）。建议：删除默认口令，缺失即 fail-closed 报错。
- **良性**：`src-tauri/src/keychain.rs:40-100` 的 `set_secret/get_secret` 走系统 Keychain（Win Credential Manager / macOS Keychain / Linux Secret Service），无硬编码密钥；`.env.example` 未提交真实 `.env`。✅

### 2. 依赖供应链
- **良性**：`src-tauri/Cargo.lock` 存在（179KB，全量 pin）；`pnpm-lock.yaml` 存在。`Cargo.toml:34` 注释表明 API Key 走系统 Keychain 加密存储。✅

### 3. 网络暴露
- **良性**：Rust 侧无 `0.0.0.0` 监听（桌面应用，本地 IPC）；`tauri.conf.json:15` CSP 严格：`script-src 'self'`（仅 `style-src` 用 `'unsafe-inline'`，故内联脚本无法执行）。✅

### 4. 命令注入 / 路径
- **良性（亮点）**：`src-tauri/src/asset_pipeline.rs:75-127` `run_asset_pipeline` 做了①脚本白名单 `ALLOWED_SCRIPTS`；②危险字符黑名单（`; & | > < \` $ !` 等，`asset_pipeline.rs:21-23`）；③ `..` 路径组件拒绝；④用 `Command::new("python").arg().args()`（**无 shell**）。并有完整单测覆盖（`:195-337`）。这是家族级范本。✅
- **良性**：`src-tauri/tests/test_system_runtime.rs:84-97` 对命令白名单与 shell 元字符拼接有回归测试。✅

### 5. 配置-实现一致性（capability 视角）
- **[S1-Medium/High] 过度授权的 IPC capability** ~~（chat-window.json:25 / settings-window.json:29 授予 `sql:allow-execute`）~~ **✅ 已修复（2026-09-04）**：capability 已移除全部 `sql:*`；SQL 全量收口到 Rust `sqlite.rs` 92 个 `sp_*` 语义命令（参数绑定、无字符串拼 SQL）；高敏自定义命令另经 `window_gate.rs` 窗口门禁。
- **良性**：`capabilities/default.json` 含 `core:default` + 窗口/事件权限 + `deep-link:default`，未授予 `shell:*` 等高危权限（已 grep 确认 capabilities 目录无 `shell`/`allow-execute` 之外的越权项，除 S1 的 sql）。

### 6. 前端 / 客户端（XSS / WebView / 深链接）
- **[S3-Low/Medium] DOM-XSS 经由 innerHTML** ~~（`src/main.tsx:96-101` 拼接 `title`/`detail` 进 innerHTML）~~ **✅ 已修复（2026-09-04）**：`renderFatalErrorToRoot` 改为 DOM 构造 + `textContent`，不可信错误串不再进入 HTML。
- **[S4-Low/Info] 深链接处理**：`tauri.conf.json:88-95` 注册 `spiritpal://` scheme；`src/lib/widgetState.ts:216-244` `handleWidgetDeepLink` 仅把 `item_id` 作为背包查找 key，不拼接 URL、不进 innerHTML、不导航 WebView——低风险。建议：保持 `item_id` 仅作标识符，勿进任何 HTML/命令路径。

## 门禁适用性说明

Python 版 `check_config_refs.py` **不适用**（Rust/TS 栈，无 pydantic/config.yaml）。但其核心思想——「**声明的安全控制必须被真实消费 / 不得过度**」——可映射到 Tauri：

- **最小改造点（Tauri 适配门禁）**：写脚本 lint `src-tauri/capabilities/*.json`：
  1. 拒绝 `sql:allow-execute`、`shell:allow-execute`、`*://*`、`core:default` 中不必要的宽泛项；
  2. 收集实际 `invoke('xxx')` 调用（`src/**`），校验每个被授予的 permission 标识符都对应一个真实命令/插件调用（类比 `check_security_keys_consumed` 的「未消费即失败」）；
  3. 对 `asset_pipeline` 类的高危 Rust 命令，CI 跑其注入单测（已有，建议设为必过）。
- 该门禁可直接捕获 S1（`sql:allow-execute` 过度授权）与 S2（构建配置默认口令可用正则 `getProperty(..., ".*")` 扫描并失败）。
