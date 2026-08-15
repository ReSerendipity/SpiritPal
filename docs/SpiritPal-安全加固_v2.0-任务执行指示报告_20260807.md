# SpiritPal APP 安全加固 v2.0 — 任务执行指示报告

> **报告定位**: 本文档是 [v1.0 安全评估报告](SpiritPal-APP全面安全性评估报告_v0.1.0_20260807.md) 的**执行层续篇**。
> **版本**: v2.0 (2026-08-07)  
> **适用对象**: 开发者 / 发布负责人 / 采购方  
> **状态**: 🔵 **可按 Phase 顺序立即执行**

---

## §0 执行总览（TL;DR）

### v1.0 → 当前 修复进度总结

| 优先级 | v1.0 总数 | 已完成 | 部分完成 | 未完成 | 完成率 |
|--------|----------|--------|---------|--------|-------|
| 🔴 **P0** (阻断高危) | 3 | 3 | 0 | 0 | **100%** ✅ |
| 🟠 **P1** (阻断分发) | 3 | 2 | 0 | 1 | 67% |
| 🟡 **P2** (纵深防御) | 4 | 4 | 0 | 0 | **100%** ✅ |
| 🟢 **P3** (锦上添花) | 5 | 1 | 3 | 1 | 50% (含部分=70%) |
| **合计** | **15** | **10** | **3** | **2** | **加权 73%** |

### 3 项 HIGH 级漏洞全部清零 ✅
CSP 收紧、Markdown XSS 防护、窗口权限精简 — 已全部落地，SpiritPal 核心安全防线已达行业中上水平。

### 剩余 5 条缺口清单（按执行先后排序）

| # | 原编号 | 项目 | 现状 | 阻塞类型 | 本报告分配到的阶段 |
|---|--------|------|------|---------|------------------|
| G-1 | R-13 | 国内 LLM 厂商密钥脱敏正则补齐（DeepSeek / 通义百炼 / 月之暗面 / 智谱） | ⚠️ 部分（缺 4 家格式） | **纯编码** | Phase 1-A |
| G-2 | R-15 | CI 集成 `osv-scanner`（跨生态依赖漏洞扫描） | ⚠️ 部分（缺 osv，仅有 pnpm+cargo audit） | **纯编码** | Phase 1-B |
| G-3 | R-12 | Rust 侧反调试 + 字符串字面量混淆（前端已混淆） | ⚠️ 部分（仅前端） | **纯编码** | Phase 1-C |
| G-4 | R-04 | Windows/macOS 双端代码签名证书采购与配置 | ❌ 未开始 | **外部采购** + 编码 | Phase 2-A（并行启动）+ Phase 3-B 落地 |
| G-5 | R-14 | 本地存储加密：① analytics localStorage 密文化（lite版）② SQLCipher 全库加密（完整版） | ❌ 未开始 | **纯编码 + 架构决策** | ① Phase 3-A；② **延期到 v0.2.0** |

---

## §1 Phase 路线图总览

```
今天 ───────────────────────────────────────── 4周后 ──────────────────── v0.2.0
  │                                                                           │
  ├─ Phase 0  回归验证     (1h, 今天)       ← 无编码, 跑测试三件套
  │
  ├─ Phase 1  本周编码     (~8h, 本周内)    ← 纯编码可独立完成
  │    ├─ 1-A  R-13 补齐 (1h)
  │    ├─ 1-B  R-15 osv-scanner (1.5h)
  │    └─ 1-C  R-12 Rust反调试+obfstr (5h)
  │
  ├─ Phase 2  并行外部采购  (启动后1~2周到货)
  │    └─ 2-A  R-04 双端证书下单（今天就下单）
  │
  ├─ Phase 3  v0.1.1 发版前收尾  (证书到货后 3天)
  │    ├─ 3-A  R-14-lite analytics 加密 (1h)
  │    └─ 3-B  R-04 证书落地+Notarization (2天)
  │
  └─ Phase 4  v0.2.0 架构升级 (长期分支, 不阻塞v0.1.x)
       └─ R-14-full SQLCipher 集成 + 旧数据迁移 + Rust重度混淆
```

### 每阶段退出标准（Gate）

| 阶段 | 退出前必须通过 | 验证方式 |
|------|--------------|---------|
| Phase 0 → 1 | TypeScript lint + Vitest 覆盖率 ≥80% + Rust clippy `0 warnings` | §6 验证脚本1 |
| Phase 1 → 3 | R-13 单测、R-15 CI Green、R-12 Release 构建通过 + 无 IsDebuggerPresent 崩溃 | §6 验证脚本2 |
| Phase 3 → Release | 代码签名验证通过 (EXE/DMG 数字签名有效) + analytics 密文读写正常 + §7 渗透测试清单 8/8 通过 | §6 验证脚本3 + §7 人工验证 |
| Phase 4 (v0.2.0) | SQLCipher 打开 spiritpal.db 需要密码、旧数据迁移脚本成功、全库加密性能基准 <10ms/查询 | 另开文档 |

---

## §2 Phase 0 — 回归验证（1 小时，立即执行）

> **目标**：确认 P0/P2 的大规模改动（权限精简、CSP 收紧、PBKDF2、IPC、SSRF 等）没有引入回归。

### 任务 0-1：运行三件套验证

```bash
cd C:\Users\Doro\SpiritPal

# ① TypeScript 类型检查（CI lint 步骤）
pnpm lint
# 期望: 0 errors, 0 warnings

# ② Vitest 单测 + 覆盖率
pnpm test:coverage
# 期望阈值: lines ≥80%, functions ≥80%, branches ≥75%, statements ≥80%
# 若失败: 最可能与 R-03 权限移除有关，查看 invoke('process:*') / invoke('fs:remove') 的相关测试是否需要改写

# ③ Rust 三件套
cd src-tauri
cargo test          # 37+ unit tests 全过
cargo fmt --check   # 0 diff
cargo clippy -- -D warnings  # 0 warnings
```

### 🚩 决策点
- **三件套全绿** → 进入 Phase 1
- **TypeScript 报错**（最可能）：chat-window/settings-window 中调用了 pet-window 已移除的 permission → 把对应 invoke 调用改到 settings/chat 窗口，或在 Rust 侧新建一条 Tauri command 作为 proxy（优先改调用端）
- **Rust 报错**：PBKDF2 新代码的 clippy warning → 按 clippy 建议修，一般是 unused variable / needless borrow

---

## §3 Phase 1 — 本周编码（~8 小时，本周内完成）

### 🔹 1-A：R-13 补齐国内厂商密钥脱敏正则（1 小时）
**文件**：[src/lib/llmClient.ts](file:///c:/Users/Doro/SpiritPal/src/lib/llmClient.ts)  
**位置**：`redactErrorText()` 函数，当前 L63-L72

**新增格式**（在已有 4 条 replace 后面追加）：

```
┌─────────────────────┬─────────────────────────────────────┐
│ 厂商                 │ 正则（示例，具体请核对官方文档）       │
├─────────────────────┼─────────────────────────────────────┤
│ DeepSeek            │ 与 OpenAI 同前缀 sk-（已覆盖）         │
│ 通义百炼 DashScope   │ sk-xxxx (同 sk-)  + Authorization: Bearer sk-xxx │
│ 月之暗面 Moonshot    │ sk-（同上）                          │
│ 智谱 AI GLM         │ sk-（同上）                          │
│ 百度千帆 ERNIE      │ Bearer xxx_access_token (长度 64+)   │
│ 腾讯云 Hunyuan       │ 格式: Bearer <40+ hex>              │
│ Anthropic (补充)    │ 已覆盖 sk-ant-                        │
│ x-api-key header    │ 已覆盖（长度截断）                    │
└─────────────────────┴─────────────────────────────────────┘
```

**编码动作**：
1. 新增一条统一的长 Bearer token 脱敏：`/(Bearer\s+[A-Za-z0-9\-_.]{12})[A-Za-z0-9\-_.]*/g → '$1***'`（覆盖千帆、混元、OIDC 等通用 token 格式）
2. 新增 `x-api-key:` / `api-key:` / `api_key=` 前缀捕获
3. 末尾加兜底：任何长度 >40 的连续十六进制 / base64 串，抹除前 8 位后的全部字符
4. 写 Vitest 用例：构造一个包含 `Authorization: Bearer eyJhbGciOi... (200 字符)` 的错误响应，断言脱敏后只剩 `eyJhbGci***`

**验收**: `redactErrorText.test.ts` 新 + 旧 8 条用例全通过（覆盖率 100%）

---

### 🔹 1-B：R-15 CI 集成 osv-scanner（1.5 小时）
**文件**：[.github/workflows/ci.yml](file:///c:/Users/Doro/SpiritPal/.github/workflows/ci.yml)

**新增 job**（放在 rust-test 之后，build 之前，失败标记 warning 不阻断合并）：

```yaml
  dependency-vuln-scan:
    name: Dependency Vuln Scan (pnpm audit + cargo audit + osv-scanner)
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: pnpm install --frozen-lockfile

      # 1) pnpm audit（已有，搬过来集中放）
      - name: pnpm audit
        run: pnpm audit --audit-level=high
        continue-on-error: true   # ← 关键：先不阻断，收集 1~2 周数据后改成 fail

      # 2) cargo audit（已有，搬）
      - uses: dtolnay/rust-toolchain@stable
      - name: Install cargo-audit
        run: cargo install cargo-audit --locked
      - name: cargo audit
        working-directory: src-tauri
        run: cargo audit
        continue-on-error: true

      # 3) ★ osv-scanner（新增，跨生态统一扫描）
      - name: Run osv-scanner
        uses: google/osv-scanner-action/osv-scanner-action@v1.9.0
        with:
          scan-args: |-
            --recursive
            --skip-git
            ./
        continue-on-error: true   # ← 收集期不阻断
```

**验收**: Push 一个分支触发 CI，`dependency-vuln-scan` job 执行成功，osv-scanner 输出 JSON/HTML 报告；下载 artifacts 查看扫描到的 CVE 列表（若无高危则 Phase 1-B 完成）。

---

### 🔹 1-C：R-12 Rust 侧反调试 + 字符串加密（约 5 小时，分 3 个子步骤）

#### Step 1-C-1：新建反调试模块（参考 AGENTS.md 已列出的 `antidebug.rs`）
**文件**: `src-tauri/src/antidebug.rs`（如已存在则检查下面内容是否齐全）

**内容要点**：
```rust
//! 反调试与最低限度防篡改。
//! 注意: 桌面端防逆向是"提高成本"而非"绝对防住"，此处采用 3 层低成本检测，
//! 命中后仅触发"安全模式"(加密功能不可用) + 日志上报，不 panic(避免误报崩溃)。

use std::sync::atomic::{AtomicBool, Ordering};

static DEBUGGER_DETECTED: AtomicBool = AtomicBool::new(false);

/// 启动时调用 1 次 (main.rs 的 #[cfg_attr(not(debug_assertions), ...)] 下)
pub fn perform_anti_debug_checks() {
    #[cfg(target_os = "windows")]
    {
        // Win32: IsDebuggerPresent + CheckRemoteDebuggerPresent + NtQueryInformationProcess(ProcessDebugPort)
        // 三选二命中即标记
        // ★ 请用 winapi crate 或 windows-sys::Win32::System::Diagnostics::Debug 实现
        // （此处只写接口约定，编码时请用 windows-sys，不要用弃用的 winapi）
    }

    #[cfg(target_os = "macos")]
    {
        // macOS: sysctl(KERN_PROC, KERN_PROC_PID) + P_TRACED flag
        // + ptrace(PTRACE_DENY_ATTACH, ...)
    }

    #[cfg(target_os = "linux")]
    {
        // Linux: 读取 /proc/self/status TracerPid != 0
    }
}

pub fn is_debugger_detected() -> bool {
    DEBUGGER_DETECTED.load(Ordering::Relaxed)
}
```

**依赖**：`Cargo.toml` 里加 `windows-sys = { version = "0.59", features = ["Win32_System_Diagnostics_Debug", "Win32_System_Threading"] }`（仅 Windows cfg 下启用可选依赖）

#### Step 1-C-2：敏感字符串用 `obfstr` 宏包裹
**Cargo.toml**: `obfstr = "0.4"`（dev-dependencies 之外也加）

**替换点**（grep 搜硬编码的固定错误消息 / API 端点 / 固定前缀）：
- `crypto.rs` 中 "无法获取机器 ID" → 改成 `obfstr::obfstr!("无法获取机器 ID")`（Release 构建时字符串在 .rodata 中不可直接搜出明文）
- `keychain.rs` 中 "SpiritPal" service 名、"api_key" account 名 → obfstr
- `lib.rs` 中 "enc1:" / "enc2:" 前缀常量 → obfstr
- `validation.rs` 中 SHELL_METACHARS 数组描述 → obfstr

> 注意：**不要包** format! 的格式化字符串参数、log message 格式串（会破坏 log! 宏展开）。包固定字面量即可。约 15~25 处。

#### Step 1-C-3：Release profile 加强（Cargo.toml [profile.release]）
**当前状态**：`opt-level=s`、`lto=thin`、`strip=true`  
**目标**：
```toml
[profile.release]
opt-level      = "z"    # ← 体积优先，"s" 改 "z" 减 ~5%
lto            = "fat"  # ← thin 改 fat，跨 crate 内联（链接慢 ~30s）
codegen-units  = 1      # ← 1 = 最积极优化，编译时间 +50%
panic          = "abort"# ← 移除 unwinding 栈符号表
strip          = true
```
> **重要**: panic = abort 后如果依赖中有 catch_unwind，必须确认不被使用；否则退回到 `panic = "unwind"`。先本地 `cargo build --release` 确认能成功链接。

**验收 Step 1-C-3**：Release 构建后 `spiritpal-app.exe` 大小变化 <±10%；启动后 `IsDebuggerPresent`（用 x64dbg/OllyDbg 挂一下）触发安全模式标记（加密功能返回 Err 但不崩）。

---

## §4 Phase 2 — 并行外部采购（今天就启动，不阻塞编码）

### 🔹 2-A：R-04 代码签名双端证书 + Apple Developer 账号（阻塞周期 1~2 周）

#### Windows 端
- **证书类型**：**OV 代码签名证书**（Sectigo / DigiCert / GlobalSign，三选一）。EV 更佳但贵 ~3×。
  - 推荐：**Sectigo OV Code Signing**（~$100 USD / 1 年，Azure 验证企业/个人身份最快 1~3 工作日）
  - 必须支持 **Microsoft SmartScreen 信誉积累**（所有主流 CA 均支持）
  - 存储硬件：**必须用硬件 token (HSM/USB eToken)**（2023-06 后 CA/B Forum 强制，不能再存在本地文件）
- **采购后配置**（证书到手后做，分配到 Phase 3-B）：
  1. 插上 eToken，用 signtool 导出 thumbprint → 填入 `tauri.conf.json` 的 `windows.certificateThumbprint`（替换当前 `null`）
  2. `digestAlgorithm = "sha256"` 已正确，`timestampUrl = "http://timestamp.digicert.com"` 也正确（RFC 3161 时间戳，防止证书过期后签名失效）

#### macOS 端
- **账号**：Apple Developer Program（$99 USD / 年，2FA 授权，个人或组织均可。个人身份审核约 1~2 天）
- **证书类型**：2 个证书都要
  - `Developer ID Application`：.app / .dmg 签名（分发包用）
  - `Developer ID Installer`：pkg 安装包（本项目暂用 dmg，先只买前者也行）
- **Notarization（必须，否则 Gatekeeper 直接拦截）**：
  - 用 Xcode → Preferences → Accounts 登录 Apple ID → 生成 App Store Connect API Key（`.p8` 文件 + Issuer ID + Key ID）
  - 在 CI 中配置为 Secrets：`APPLE_API_KEY_BASE64` + `APPLE_API_ISSUER_ID` + `APPLE_API_KEY_ID`
  - Tauri 2.x 的 `macOS.notarize` = true + 配置上述字段后，构建会自动上传 notarytool + 出结果

**验收（Phase 3-B 后做）**：
- Windows: `signtool verify /pa /all artifacts\SpiritPal_0.1.0_x64-setup.exe` → 显示 "Successfully verified" + 发布者名 = 你的姓名/公司
- macOS: `spctl -a -v SpiritPal.app` → "accepted" + `source=Developer ID / Notarized Developer ID`
- macOS: `codesign -dvvvv SpiritPal.app` → "Authority=Developer ID Application: <your name>" 出现，且有 "Ticket=1"（已 stapled 公证票据）

---

## §5 Phase 3 — v0.1.1 发版前收尾（证书到手后 3 天）

### 🔹 3-A：R-14-lite analytics 本地存储加密（1 小时）
**不引入 SQLCipher**（那个是 Phase 4 架构升级），只给 analytics 写入 localStorage 的值套一层 AES。

**文件**：[src/lib/analytics.ts](file:///c:/Users/Doro/SpiritPal/src/lib/analytics.ts)  
**修改**：
```ts
// 当前: localStorage.setItem(key, JSON.stringify(payload))
// 改为:
const ciphertext = await encryptData(JSON.stringify(payload))   // 复用 secureStorage.encryptData
localStorage.setItem(key, ciphertext)

// 读取处:
const ciphertext = localStorage.getItem(key)
if (!ciphertext) return null
try {
  const json = await decryptData(ciphertext)
  return JSON.parse(json) as AnalyticsSnapshot
} catch {
  // 旧数据(明文)兼容尝试
  return tryParseLegacyPlaintext(ciphertext)
}
```
> `encryptData` / `decryptData` 用现有的 [secureStorage.ts](file:///c:/Users/Doro/SpiritPal/src/lib/secureStorage.ts) 封装。

**验收**: 安装新版后，写一条 analytics 事件 → DevTools → Application → Local Storage → 对应 key 值为 `ENC2:XXXXXXXX` 密文前缀；刷新页面读出来仍能还原成事件对象。

---

### 🔹 3-B：R-04 证书落地 + tauri.conf.json 配置（2 天）
（参见 §2-A 后半段）主要工作：
1. Windows 端 thumbprint 填入 + 本地 `signtool` 手动签一次 EXE 验证 OK
2. macOS 端钥匙串导入 `Developer ID Application` 证书 + 私钥 → 钥匙串访问 → "允许 codesign 访问"
3. Apple notarytool 凭证配置到 CI Secrets（release.yml）
4. 在 release.yml 构建步骤里开启签名（Tauri 2.x 会自动读取 tauri.conf.json + 环境变量，无需改构建命令）
5. 运行一次 `npx tauri build`（本地和 CI 都试），产物签名 + 公证通过

---

## §6 Phase 4 — v0.2.0 架构升级（长期，不阻塞 v0.1.x 发布）

- **R-14-full SQLCipher 集成**：替换 `tauri-plugin-sql` 的 SQLite 后端为 SQLCipher，所有 DB 打开调用注入 PRAGMA key = `<machine_id 派生的 key>`；写一个 `migrate_plain_to_encrypted()` 启动时首次自动迁移旧 spiritpal.db（一次性，迁移完删掉明文副本）
- **R-12-full Rust 重度混淆**：引入 `cargo-obfuscate`（`cargo install cargo-obfuscate`）或 `llvm-obfuscator`（OLLVM）。注意这个会让编译时间膨胀 5~10×，放 v0.2.0 RC 阶段再启用
- **R-11 扩展**: 除了当前的 dist/assets/*.js，也给 pets/ 默认 Live2D 模型 JSON 做签名（防止本地模组被替换后注入恶意表达式脚本）

---

## §7 KPI 里程碑 & 量化验收

| KPI 指标 | v1.0 基线 | Phase 0 退出 | Phase 1 退出 | Phase 3 退出 (v0.1.1) | v0.2.0 目标 |
|----------|----------|-------------|-------------|----------------------|------------|
| HIGH 级漏洞数 | 3 | 0 | 0 | **0** | 0 |
| 代码签名覆盖率 (Win+mac) | 0% | 0% | 0% | **100%** | 125% (+Android v2) |
| 依赖漏洞扫描通道数 | 2 (pnpm+cargo) | 2 | **3 (+osv)** | 3 | 4 (+trivy 容器) |
| 密钥脱敏正则覆盖厂商数 | 3 (OpenAI/Anthropic/Google) | 3 | **8+ (含国内 5 家)** | 8 | 12 |
| 本地敏感明文存储 (P-4/P-5) | 2项 | 2项 | 2项 | **1项 (仅剩向量)** | 0项 (全库加密) |
| CSP 评分 (Google Evaluator) | ~30/100 | **≥70** | ≥70 | ≥70 | ≥85 |
| 测试覆盖率 (Vitest) | 待量 | ≥80% | ≥80% | ≥80% | ≥85% |
| Rust panic 路径数 (.expect/.unwrap) | 20+ | 待量 | <10 | <5 | <3 |

---

## §8 验证脚本（每阶段退出时 copy-paste 运行）

### ✅ 验证脚本 1 — Phase 0 退出
```bash
cd C:\Users\Doro\SpiritPal
pnpm lint 2>&1 | Select-String "error" | Measure-Object -Line          # 期望 0
pnpm vitest run --coverage 2>&1 | Select-String "Threshold check"      # 期望 All files PASS
cd src-tauri; cargo test 2>&1 | Select-Object -Last 2                  # 期望 test result: ok. N passed
cargo clippy -- -D warnings 2>&1 | Select-String "warning" | Measure-Object -Line  # 期望 0
```

### ✅ 验证脚本 2 — Phase 1 退出
```bash
# R-13 单元测试
pnpm vitest run redactErrorText 2>&1 | Select-Object -Last 5            # test result: ok

# R-15 CI：打开 Actions → 看 dependency-vuln-scan job 绿色 ✔
# 手动本地跑一次 osv:
# (下载 osv-scanner.exe 放 PATH)
osv-scanner.exe -r . 2>&1 | Select-String "SCAN COMPLETE"

# R-12 构建成功
cd src-tauri; cargo build --release 2>&1 | Select-Object -Last 3        # Finished release [optimized]
# 二进制存在
Test-Path "target\release\spiritpal-app.exe"                                # True
```

### ✅ 验证脚本 3 — Phase 3 退出 (发版前最终)
```bash
# 签名
signtool verify /pa /all "artifacts\SpiritPal_0.1.0_x64-setup.exe" 2>&1    # Successfully verified
# macOS (需 mac 机器)
# spctl -a -v SpiritPal.app 2>&1                                            # accepted
# codesign -dvvvv SpiritPal.app 2>&1 | Select-String "Notarized"            # 出现 Notarized Developer ID

# 存储加密 (手动)
# 启动 app → 打开 pet-window → 聊 1 句 → 关闭 →
# DevTools Application → localStorage → analytics_* key 值不以 "{" 开头 → ✅
# 重新打开 → 历史记录可正常显示 → ✅
```

---

## §9 渗透测试验收清单（Phase 3 后必过，8/8 = Release Candidate 合格）

沿用 v1.0 报告 §5.2，更新为**必须通过**版本：

```
□ [CRITICAL] XSS: AI 聊天注入 <img src=x onerror=alert(1)> → 无弹窗，CSP report-uri 有违规记录
□ [CRITICAL] XSS: Markdown payload `[click](javascript:alert(1))` → 净化为纯文本 / 锚点无脚本执行
□ [HIGH] SSRF: 设置 LLM baseUrl=http://169.254.169.254/latest/meta-data → safeFetch 请求被拒，返回 SSRF_PROTECTED error
□ [HIGH] 权限: pet-window DevTools 调 invoke('process:exit') → PermissionDenied，进程存活
□ [HIGH] 权限: pet-window DevTools 调 invoke('fs:allow-read-file', { filePath: 'C:\Windows\System32\config\SAM' }) → PermissionDenied
□ [MEDIUM] 重打包篡改: 修改 dist/assets/*.js 1 字节 → 启动时 SRI 校验失败，弹出"资源完整性校验失败，请重装"并拒绝加载主界面
□ [MEDIUM] 命令注入: invoke('open_application', { app_name: 'calc$IFS$9whoami' }) → validate_app_name Err: "包含非法字符"
□ [MEDIUM] 密钥绑定: 把 %AppData%\SpiritPal\spiritpal.db 拷到另一台机器 → decrypt_memory 返回 Err:"密钥不匹配"，无法读出记忆明文
```

> 建议：测试结果逐条截图 + 记录，存档 `docs/analysis/penetration-test-log-202608XX.md`，正式发布 v0.1.1 时附到 Release Notes 的 "Security" 章节。

---

## §10 任务追踪看板（每日更新）

```
┌── Phase 0 回归验证 ─────────────────────────────────────────┐
│  0-1 三件套 lint+test+clippy      [ ] 待跑   [ ] PASS   [ ] FAIL   → 负责人: ___   备注: ___
└──────────────────────────────────────────────────────────────┘

┌── Phase 1 本周编码 ──────────────────────────────────────────┐
│  1-A R-13 脱敏正则补齐 + 单测   [ ] 待开   [ ] 中     [ ] 已合入 → 负责人: ___   单测: __/__
│  1-B R-15 osv-scanner CI 集成   [ ] 待开   [ ] 中     [ ] 已合入 → 负责人: ___   CI: [ ] Green
│  1-C-1 antidebug.rs 反调试      [ ] 待开   [ ] 中     [ ] 已合入 → 负责人: ___
│  1-C-2 obfstr 字符串加密        [ ] 待开   [ ] 中     [ ] 已合入 → 负责人: ___   替换处: __/25
│  1-C-3 profile.release 加强     [ ] 待开   [ ] 中     [ ] 已合入 → 负责人: ___   构建: [ ] PASS
└──────────────────────────────────────────────────────────────┘

┌── Phase 2 外部采购 ───────────────────────────────────────────┐
│  2-A Windows Sectigo OV 证书    [ ] 未下单 [ ] 已下单 [ ] 已到手 → 采购方: ___   预计到货: ______
│  2-A Apple Developer 账号       [ ] 未申请 [ ] 审核中 [ ] 已激活 →  Apple ID: ___   预计: ______
└──────────────────────────────────────────────────────────────┘

┌── Phase 3 v0.1.1 收尾 ───────────────────────────────────────┐
│  3-A R-14-lite analytics 加密  [ ] 待开   [ ] 中     [ ] 已合入 → 负责人: ___
│  3-B R-04 签名+Notarization    [ ] 阻塞(等证书)  [ ] 中   [ ] OK → 负责人: ___
│  §8 渗透测试清单 8/8            [ ] 未开始           [ ] 8/8 PASS → 测试员: ___
└──────────────────────────────────────────────────────────────┘

┌── Phase 4 v0.2.0 架构 ───────────────────────────────────────┐
│  R-14 SQLCipher 全库加密        [ ] 未规划                      →  Milestone: v0.2.0-M3
│  R-12-full Rust 重度混淆        [ ] 未规划                      →  Milestone: v0.2.0-M2
└──────────────────────────────────────────────────────────────┘
```

---

## §11 风险提示

| # | 风险 | 概率 | 影响 | 缓解方案 |
|---|------|------|------|---------|
| RISK-1 | **Apple 审核被拒 / 耗时过长** | 中 | 高 | 提前 2 周申请 Developer ID；先同时准备好 Windows 签名发布 macOS dmg "未签名 beta" 通道，给老用户先用 |
| RISK-2 | **证书 USB Token 丢失/损坏** | 低 | 极高（需重新申请，1~2 周） | 申请时同时下单 2 张（主 + 备）；平时存放保险柜；CI 构建用 Cloud HSM (Azure Key Vault / AWS CloudHSM) 替代本地 token |
| RISK-3 | **obfstr 字符串展开导致编译错误** | 中 | 中 | 先包裹非关键字符串测试；每次 CI 跑 Release 构建关，失败立即回滚对应提交 |
| RISK-4 | **panic=abort + catch_unwind 冲突** | 低 | 高 | `cargo build --release` 后看 release build 日志有 warning；若有就回到 `panic=unwind` |
| RISK-5 | **osv-scanner 噪声过多误报干扰** | 高 | 低 | 先 `continue-on-error: true` 观察 2 周；建立 `osv-ignorelist.toml` 仅屏蔽确定无影响的 CVE |

---

> **下一份报告衔接点**：
> - Phase 3 全部完成后 → 生成 **SpiritPal APP 安全加固 v2.1 — 发版认证报告**，含签名截图、渗透测试通过截图、KPI 数据表，作为 v0.1.1 正式发布的安全附件。
> - Phase 4 SQLCipher 完成后 → 生成 **SpiritPal APP 安全加固 v3.0 — 深度加密架构设计与验证报告**。
