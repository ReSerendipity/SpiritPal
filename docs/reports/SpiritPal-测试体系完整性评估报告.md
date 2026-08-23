# SpiritPal 测试体系完整性评估报告

**评估日期**: 2026-08-09  
**评估版本**: v0.1.0  
**评估范围**: 全项目测试体系（CI/CD 流水线 + 单元测试 + 集成测试 + E2E 测试 + 专项测试）  
**评估方法**: 代码审查 + 配置分析 + 测试用例审计 + 架构评估

---

## 执行摘要

| 维度 | 评分 | 等级 | 关键发现 |
|------|------|------|---------|
| **CI/CD 流水线** | 82/100 | ✅ 良好 | 5 个 Job 覆盖前端测试/E2E/Rust 测试/漏洞扫描/多平台构建，覆盖率报告已集成 |
| **单元测试框架与覆盖率** | 85/100 | ✅ 优秀 | 53 个测试文件，MockContext/FakeClock/TestHarness 三件套基础设施完善，覆盖率阈值 80/80/75/80 |
| **集成与 API 测试** | 55/100 | ⚠️ 中等 | IPC 契约测试设计亮点突出，但前后端实际交互全 Mock，缺少真实集成测试 |
| **E2E 端到端测试** | 48/100 | ⚠️ 中等偏下 | 仅 Web 冒烟模式，5 个 spec 文件覆盖基础场景，但断言深度不足，无真实 Tauri 后端验证 |
| **其他专项测试** | 78/100 | ✅ 良好 | 4 项性能验收脚本 + 安全评估报告体系完善，但缺少内存泄漏/压力/模糊测试 |
| **综合评分** | **70/100** | **中等偏上** | 框架搭建完善，深度与广度需进一步提升 |

> **总体评价**: 项目已建立涵盖 CI/CD 自动化、单元测试、IPC 契约测试、E2E 冒烟测试、性能验收、安全评估的多维度测试体系。测试基础设施（MockContext、FakeClock、TestHarness）设计精良，CI 流水线自动化程度高。但在**集成测试深度、E2E 真实性、非功能性测试覆盖面**方面存在明显短板。

---

## 一、CI/CD 流水线评估

### 1.1 流水线架构概览

项目配置了两套 GitHub Actions 工作流：

**CI 流水线** (`ci.yml`) — 触发于 push 到 main/develop 和 PR 到 main：

| Job | 运行环境 | 核心步骤 | 产物上传 |
|-----|---------|---------|---------|
| `lint-and-test` | ubuntu-latest | pnpm install → `tsc --noEmit && eslint src/` → `vitest run --coverage` | ✅ coverage-report (14d) |
| `e2e` | ubuntu-latest | pnpm install → playwright install chromium → `playwright test` | ✅ e2e-report (14d) |
| `rust-test` | ubuntu-latest | Rust toolchain → `cargo test` → `cargo clippy -D warnings` → `cargo fmt --check` | 无 |
| `dependency-vuln-scan` | ubuntu-22.04 | `pnpm audit` (观察期) → `cargo audit` (观察期) → `osv-scanner` (阻断) | ✅ osv-scanner-report (14d) |
| `build` | 矩阵(Ubuntu/Win/Mac) | tauri-action 多平台构建 | ✅ 构建产物 (14d) |

**Release 流水线** (`release.yml`) — 触发于 `v*` tag push：

| Job | 运行环境 | 核心步骤 |
|-----|---------|---------|
| `release` | 矩阵(Ubuntu/Win/Mac) | 三平台 Tauri 构建 → GitHub Release (Draft) |
| `performance-test-windows` | windows-latest | 冷启动测试 + 内存占用测试 |
| `performance-test-cross-platform` | ubuntu-22.04 | FPS 测试 + 包大小验证 (xvfb 环境) |

### 1.2 优点

1. **✅ 自动化测试触发**: push 和 PR 均自动触发完整测试流水线，无需人工干预
2. **✅ 覆盖率收集**: `vitest run --coverage` 生成覆盖率报告并上传为 artifact (14 天保留)
3. **✅ 多环境测试执行**: 前端 (Ubuntu) + Rust (Ubuntu) + E2E (Ubuntu) + 构建 (三平台矩阵) 并行运行
4. **✅ 测试报告生成**: 覆盖率 HTML 报告 + E2E HTML 报告 + osv-scanner 报告均通过 `upload-artifact` 持久化
5. **✅ 漏洞扫描三重体系**: `pnpm audit` + `cargo audit` + `osv-scanner` 覆盖 npm/Cargo/OS 三个维度，渐进收紧策略（osv 已阻断，cargo/pnpm 观察期后收紧）
6. **✅ Release 流水线集成性能验收**: 构建产物自动下载并运行性能测试，冷启动/内存/FPS/包大小四项指标对照 PRD 阈值
7. **✅ Rust 质量门禁**: `cargo clippy -D warnings` 将 lint 警告提升为错误，`cargo fmt --check` 强制代码格式

### 1.3 问题与盲区

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| C-1 | **CI Job 间无依赖编排** | 🟡 P1 | `lint-and-test`、`e2e`、`rust-test`、`build` 四个 Job 并行运行，彼此无 `needs` 依赖。构建 Job 可能在测试失败时仍消耗资源编译。建议测试 Job 作为构建前置门禁 |
| C-2 | **无多 Node 版本测试矩阵** | 🟡 P2 | 仅在 Node 22 上运行，未测试 Node 20/18 向下兼容性 |
| C-3 | **E2E 在 Ubuntu 运行但应用为 Windows 优先** | 🟡 P2 | Tauri 桌面应用在 Linux 上 E2E 测试，Win32 特定功能（系统托盘、点击穿透、全局快捷键）无法覆盖 |
| C-4 | **无缓存命中率监控** | 🟢 P3 | pnpm cache 和 rust-cache 已配置，但无缓存命中率指标 |
| C-5 | **覆盖率报告未集成第三方平台** | 🟢 P3 | 仅上传为 artifact，未集成 Codecov/Coveralls 等可视化平台，PR 中无覆盖率 diff 评论 |
| C-6 | **Rust 测试无覆盖率收集** | 🟢 P3 | `cargo test` 未配置 `cargo-tarpaulin` 或 `cargo-llvm-cov` 收集 Rust 代码覆盖率 |

---

## 二、单元测试框架与覆盖率评估

### 2.1 Vitest 配置分析

**配置文件**: `vitest.config.ts`

| 配置项 | 值 | 评估 |
|--------|---|------|
| environment | `jsdom` | ✅ 适合 React 组件测试 |
| setupFiles | `./src/test/setup.ts` | ✅ 全局 mock 注入 |
| globals | `true` | ✅ 允许测试文件直接使用 `describe/it/expect` |
| include | `src/**/*.{test,spec}.{ts,tsx}` | ✅ 标准 glob 匹配 |
| exclude | `node_modules, dist, src/mobile/**, e2e/**` | ✅ 合理排除 |
| coverage.provider | `v8` | ✅ V8 原生插桩，性能优于 istanbul |
| coverage.reporter | `text, html, lcov` | ✅ 三种格式覆盖控制台/HTML/CI |
| coverage.include | `src/lib/**, src/components/**` | ✅ 聚焦核心逻辑层 |
| coverage.thresholds | `lines:80, functions:80, branches:75, statements:80` | ✅ 阈值合理 |

### 2.2 测试文件统计

| 分类 | 文件数 | 覆盖范围 |
|------|--------|---------|
| `src/lib/__tests__/` | 42 | 核心业务逻辑（AI/记忆/养成/同步/安全/行为引擎等） |
| `src/components/__tests__/` | 6 | 关键组件（ChatWindow/PetBubble/PetContextMenu/NurturingPanel 等） |
| `src/stores/__tests__/` | 3 | Zustand 状态管理（petStore/chatStore/settingsStore） |
| **合计** | **53** | — |

### 2.3 测试基础设施

项目构建了三层测试基础设施，设计水平在同类项目中属上乘：

#### MockContext (`src/test/mockContext.ts`)

提供完整的 SpiritPal 运行上下文模拟：

- **Tauri invoke 模拟**: 20+ 内置命令实现（encrypt/decrypt/get_idle_time/get_mouse_pos 等）
- **LLM 调用模拟**: 支持预设响应序列，按调用顺序依次返回
- **存储模拟**: Map-based 键值存储，模拟 Tauri plugin-store
- **事件系统模拟**: emit/listen 双向事件传播
- **语义断言**: `expectReacted()`, `expectSpoke()`, `expectCommandCalled()`, `expectLLMCalled()`, `expectEventEmitted()`
- **宠物状态操作**: `updateStats()`, `setPetState()`

#### FakeClock (`src/test/fakeClock.ts`)

提供确定性时间控制：

- 替换全局 `Date.now` / `setTimeout` / `setInterval`
- 支持字符串格式时间推进（`"30s"`, `"90m"`, `"2h"`）
- 自动执行到期定时器回调
- `createFakeClock()` 工厂函数自动安装并在 `afterEach` 中卸载

#### TestHarness (`src/test/testHarness.ts`)

封装语义化测试操作和断言：

- 时间推进: `advanceTime()`, `waitForCooldown()`
- 交互模拟: `simulateFeed()`, `simulatePat()`
- 状态断言: `expectPetState()`, `expectHungerRange()`, `expectMoodRange()`
- 事件断言: `expectEventCount()`, `expectNoErrors()`, `expectBubbleContains()`, `expectAnimationTriggered()`
- 批量模拟: `simulateHeartbeat()`, `simulateOfflineDecay()`

#### 全局 Setup (`src/test/setup.ts`)

- Mock 全部 Tauri API（`@tauri-apps/api/core`, `event`, `window`, `path`）和插件（`plugin-sql`, `plugin-fs`, `plugin-dialog`, `plugin-store`, `plugin-notification`, `plugin-global-shortcut`, `plugin-autostart`, `plugin-process`, `plugin-updater`）
- jsdom 兼容补丁: `matchMedia`, `ResizeObserver`
- 全局状态注入: `__petStore_getState`
- 测试隔离: `beforeEach` 清空 localStorage, `afterAll` 执行 React cleanup

### 2.4 测试用例质量评估

**优点**:

1. **✅ 测试用例组织规范**: 统一使用 `describe → it` 嵌套结构，按函数/模块分组
2. **✅ 边界值测试充分**: 如 `behaviorEngine.test.ts` 覆盖了 HP tier 的 0/19/20/49/50/79/80/100 边界
3. **✅ 参数化测试**: `petStore.test.ts` 使用 `it.each` 进行等级/颜色阶梯的表驱动测试
4. **✅ Mock 隔离良好**: 各测试文件使用 `vi.hoisted()` 创建独立 mock 实例，`beforeEach` 中 `vi.clearAllMocks()` + `closeDatabase()` 重置状态
5. **✅ 安全相关测试覆盖**: `agentSandbox.test.ts` 测试权限控制，`secureStorage.test.ts` 测试 Keychain 调用

**问题**:

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| U-1 | **覆盖率排除列表过长** | 🟡 P1 | `vitest.config.ts` 排除了 20+ 组件和 5 个 lib 模块，大量 UI 组件以"依赖 Tauri 原生 API"为由跳过单元测试，实际覆盖率可能远低于报告值 |
| U-2 | **组件测试仅覆盖 6 个** | 🟡 P1 | 40+ 组件中仅 6 个有单元测试（ChatWindow/PetBubble/PetContextMenu/NurturingPanel/MemoryVisualization/PersonalityEditor），覆盖率约 15% |
| U-3 | **无快照测试** | 🟢 P2 | 未使用 Vitest 的 snapshot 功能对组件渲染输出做回归保护 |
| U-4 | **无 Mutation Testing** | 🟢 P3 | 未引入 Stryker 等变异测试工具验证测试用例的有效性 |

---

## 三、集成与 API 测试评估

### 3.1 现有集成测试

#### IPC 契约测试 (`src/lib/__tests__/ipcContract.test.ts`)

**设计亮点**: 这是项目中设计最为巧妙的测试之一。它采用源码静态分析方式：

1. **Rust 端扫描**: 递归扫描 `src-tauri/src/` 下所有 `.rs` 文件，用正则提取 `#[tauri::command]` 标注的函数名
2. **前端端扫描**: 递归扫描 `src/` 下所有 `.ts/.tsx` 文件，提取 `invoke('...')` 调用的命令名
3. **注册检查**: 从 `lib.rs` 的 `generate_handler!` 宏中提取已注册命令
4. **交叉校验**:
   - 前端调用的命令在 Rust 端必须有对应定义（排除已知插件命令）
   - Rust 定义的命令应在 `generate_handler` 中注册
   - 关键安全命令（encrypt/decrypt/sha256/secret）在两端都存在
   - 关键模组命令（import_petmod/scan_mods_directory）在两端都存在
   - 关键系统命令（get_idle_time/get_active_window/open_application）在两端都存在

#### 数据库层测试 (`src/lib/__tests__/db.test.ts`)

- Mock `@tauri-apps/plugin-sql` 的 `Database.load()` 方法
- 测试 SQLite 初始化、CRUD 操作、迁移逻辑
- 覆盖 settings/memories/embeddings/mods/inventory/schedules 等表操作

#### 安全存储测试 (`src/lib/__tests__/secureStorage.test.ts`)

- Mock Tauri `invoke` 函数
- 验证 `set_secret`/`get_secret`/`delete_secret` 命令调用的参数和返回值
- 测试 API Key 专用封装（setApiKey/getApiKey/deleteApiKey）

#### WebDAV 客户端测试 (`src/lib/__tests__/webdavClient.test.ts`)

- Mock `secureStorage` 和 `ssrfProtection.safeFetch`
- 测试 WebDAV 配置、连接、同步逻辑

#### Rust 后端单元测试

4 个 Rust 源文件包含 `#[cfg(test)]` 模块，共约 50+ 个测试函数：

| 文件 | 测试覆盖 |
|------|---------|
| `lib.rs` | AES-256-GCM 加解密、SHA-256、validate_app_name、make_state_icon、get_pet_conf_field |
| `validation.rs` | 命令注入防护（`$`/空格/Tab/引号/`^`/`%`/`!`/`()`/`\r` 等元字符）、URL scheme 白名单 |
| `petmod.rs` | 模组目录定位、结构校验、配置读取、Zip 解压、petmod 字节读取 |
| `encrypted_db.rs` | Base64 编解码往返测试（二进制/空数据/SQLite 头/大文件） |

### 3.2 问题与盲区

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| I-1 | **无真实前后端集成测试** | 🔴 P0 | 所有前端测试均 Mock Tauri invoke，无任何测试验证真实 Rust↔Frontend IPC 通信。IPC 契约测试验证了"命令名存在"但未验证"参数类型/返回值格式/错误处理"的一致性 |
| I-2 | **Rust 测试未覆盖 Tauri Command 入参校验** | 🟡 P1 | Rust 测试测试了底层函数（如 `validate_app_name`），但未测试 `#[tauri::command]` 函数的完整调用链（参数反序列化 → 业务逻辑 → 返回值序列化） |
| I-3 | **无数据库迁移测试** | 🟡 P1 | `db.test.ts` Mock 了 SQLite 层，未测试真实 SQLite 迁移（schema 版本升级、数据迁移正确性） |
| I-4 | **无外部 API 集成测试** | 🟡 P1 | LLM API 调用（`llmClient.test.ts`）、WebDAV 同步（`webdavClient.test.ts`）均为 Mock 测试，无真实 API 连通性测试（即使是可跳过的 optional integration test） |
| I-5 | **无状态管理集成测试** | 🟢 P2 | `petStore.test.ts` 测试了 store 的 action，但未测试 store + 持久化层（DB） + UI 组件的联动 |

---

## 四、E2E 端到端测试评估

### 4.1 配置分析

**配置文件**: `playwright.config.ts`

| 配置项 | 值 | 评估 |
|--------|---|------|
| testDir | `./e2e` | ✅ 标准 |
| fullyParallel | `false` | ✅ 单 worker 串行执行避免窗口冲突 |
| retries | CI: 2, 本地: 0 | ✅ CI 重试提升稳定性 |
| workers | `1` | ✅ 单 worker 避免资源竞争 |
| reporter | `html` | ✅ HTML 报告 |
| baseURL | `http://127.0.0.1:5223` | ✅ Vite dev server |
| trace | `on-first-retry` | ✅ 失败时记录 trace |
| screenshot | `only-on-failure` | ✅ 失败截图 |
| projects | `chromium` 仅一个 | ⚠️ 仅 Chromium，无 Firefox/WebKit |
| webServer | `pnpm dev` → port 5223 | ⚠️ **Web 冒烟模式**，非真实 Tauri 应用 |

**关键限制**: 配置注释明确说明"由于 SpiritPal 是 Tauri 桌面应用，无法直接在 web 浏览器中启动完整应用"，默认采用 web 冒烟测试模式。这意味着所有 E2E 测试**不依赖 Tauri 后端**，通过注入 `__TAURI_INTERNALS__` mock 来模拟 IPC。

### 4.2 测试文件清单与覆盖率

| Spec 文件 | 测试数 | 覆盖场景 |
|-----------|--------|---------|
| `smoke.spec.ts` | 4 | 基础路由（pet/chat/settings 窗口加载、默认路由） |
| `pet-window.spec.ts` | 5 | 根容器渲染、状态栏、金币显示、精灵渲染区域、右键菜单、键盘导航 |
| `chat-window.spec.ts` | 7 | 页面加载、消息列表渲染、输入框、发送按钮、搜索功能、清空记录、输入发送、Enter 发送 |
| `nurturing.spec.ts` | 8 | 商店/背包/养成/外观/性格标签页渲染、宠物点击交互、喂食右键菜单、聊天消息发送 |
| `settings-window.spec.ts` | 7 | 侧边栏渲染、10 个标签页存在性、AI/外观/通用标签切换、关闭按钮、AI 保存按钮 |
| **合计** | **31** | — |

### 4.3 自定义 Fixture

项目实现了 `e2e/fixtures/base.ts` 自定义 fixture：

- **`tauriPage`**: 扩展 Playwright `Page`，在页面加载前通过 `page.addInitScript()` 注入 Tauri API mock 脚本
- Mock 内容: `__TAURI_INTERNALS__.invoke`（20+ 命令默认返回值）、`__TAURI_PLUGIN_SQL__`（mock DB）
- 设置 60 秒默认超时（适配懒加载组件 + Vite 冷启动）
- 拦截 `console.error` 捕获未处理的 Tauri 错误

### 4.4 优点

1. **✅ 核心 UI 场景覆盖**: 覆盖了三大窗口（pet/chat/settings）的基础渲染和交互
2. **✅ ARIA 标签驱动**: 测试大量使用 `[aria-label="..."]` 选择器，语义化程度高
3. **✅ Tauri Mock 注入**: 通过 `addInitScript` 在页面加载前注入 mock，避免应用启动后 API 缺失
4. **✅ 失败诊断**: trace + screenshot + console error 捕获提供失败诊断信息

### 4.5 问题与盲区

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| E-1 | **仅 Web 冒烟模式，无真实 Tauri E2E** | 🔴 P0 | 所有 E2E 测试运行在 Vite dev server 上，Tauri 后端被完全 Mock。真正的桌面应用行为（窗口管理、系统托盘、全局快捷键、点击穿透、Live2D 渲染、Win32 API 调用）完全未被测试 |
| E-2 | **断言深度不足** | 🟡 P1 | 大量测试仅验证"元素可见"或"无错误页面"，缺少功能正确性断言。例如 `nurturing.spec.ts` 中喂食测试仅检查右键菜单出现，未验证饱食度数值变化 |
| E-3 | **仅 Chromium 浏览器** | 🟡 P1 | Tauri 在 Windows 使用 WebView2 (Chromium 内核)、macOS 使用 WKWebView (WebKit 内核)，仅测 Chromium 无法覆盖 macOS 场景 |
| E-4 | **无数据持久化验证** | 🟡 P1 | 未测试刷新后数据是否持久（localStorage/SQLite mock 返回空数据） |
| E-5 | **无多窗口交互测试** | 🟡 P2 | 未测试从宠物窗口打开设置窗口、从设置窗口跳转聊天窗口等多窗口协同场景 |
| E-6 | **无异常路径测试** | 🟡 P2 | 仅测试 happy path，未测试网络断开、LLM 超时、数据库损坏等异常场景 |
| E-7 | **无移动端 E2E** | 🟢 P3 | `src/mobile/` 有完整移动端视图但无对应 E2E 测试 |

---

## 五、其他专项测试评估

### 5.1 性能测试

**目录**: `perf/`

| 脚本 | 指标 | PRD 阈值 | 实现方式 | CI 集成 |
|------|------|---------|---------|---------|
| `cold-start.mjs` | 冷启动时间 | < 2000ms | 启动 exe → 轮询检测窗口出现 → 计算耗时 | ✅ release.yml (Windows) |
| `memory-usage.mjs` | 运行时内存 | < 80MB | 启动应用 → 等待稳定 → 多次采样 WorkingSet64 → 取平均 | ✅ release.yml (Windows) |
| `fps-test.mjs` | Live2D 帧率 | ≥ 30fps | Playwright + Chromium → 加载 Pixi.js → requestAnimationFrame 测量 5 秒 | ✅ release.yml (Ubuntu + xvfb) |
| `package-size.mjs` | 安装包大小 | < 30MB | 扫描 bundle 目录 → 测量文件大小 → JSON 报告 | ✅ release.yml (Ubuntu) |
| `run-all.mjs` | 汇总 | — | 依次执行四项脚本 → 汇总报告 → 退出码 | ✅ `pnpm perf` |
| `_helpers.mjs` | 共享工具 | — | 跨平台进程管理、exe 探测、结果格式化 | — |

**实测数据** (`perf/results/package-size.json`):
- NSIS 安装包: 29.18MB ✅ (< 30MB)
- 二进制文件: 38.57MB (参考值，不限制)

**优点**:
1. ✅ 四项 PRD 性能指标全部覆盖
2. ✅ 跨平台支持（Windows PowerShell + Linux /proc + macOS ps）
3. ✅ CI 自动化执行，`continue-on-error: true` 不阻断发布
4. ✅ 阈值明确定义在 `_helpers.mjs` 的 `THRESHOLDS` 常量中
5. ✅ 环境变量可配置（`SPIRITPAL_EXE`, `SPIRITPAL_DEV`, `SPIRITPAL_PERF_TIMEOUT` 等）

**问题**:

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| P-1 | **性能测试 `continue-on-error`** | 🟡 P1 | release.yml 中两个性能测试 Job 均设置 `continue-on-error: true`，即使性能不达标也不阻断发布。建议正式发布前改为阻断 |
| P-2 | **无性能基线回归** | 🟡 P2 | 仅与 PRD 静态阈值比较，无历史基线趋势对比（如本次冷启动比上次慢 20% 则告警） |
| P-3 | **FPS 测试使用回退动画** | 🟡 P2 | FPS 测试页面加载 Live2D 模型可能失败，回退到纯 Pixi 动画，此时测量的 FPS 不代表真实 Live2D 性能 |
| P-4 | **无 CPU 占用测试** | 🟢 P3 | 仅测内存，未测 CPU 占用率（宠物动画持续渲染可能消耗 CPU） |

### 5.2 安全评估

**文档**: `docs/analysis/SpiritPal-APP全面安全性评估报告_v0.1.0_20260807.md`

该报告是一份高质量的安全评估文档：

- **评估范围**: APP 分发安全 + 恶意行为风险 + 安全防护措施
- **综合评分**: 62/100，19 个发现（3 高危 / 9 中危 / 7 低危）
- **漏洞矩阵**: 包含 Source → Sink 数据流追踪、严重度、置信度、代码位置
- **加固建议**: 按 P0/P1/P2/P3 四级优先级分类，含预期收益、实施复杂度、验证方法
- **可量化 KPI**: CSP 严格度评分、高危漏洞数、过度权限数、签名覆盖率、console 日志残留数、SSRF 覆盖率
- **渗透测试清单**: 8 项 Post-Fix 验证清单（XSS / SSRF / 权限 / 重打包 / 密钥 / Zip Slip / 命令注入）

**安全测试相关的 CI 集成**:

- ✅ `osv-scanner` 已在 CI 中阻断合并
- ✅ `cargo audit` 在观察期（`continue-on-error: true`）
- ✅ `pnpm audit --audit-level=high` 在观察期（`continue-on-error: true`）
- ✅ Rust 测试覆盖命令注入防护（`validation.rs` 15 个测试用例覆盖各种 shell 元字符）
- ✅ Rust 测试覆盖 AES-256-GCM 加解密正确性
- ✅ Rust 测试覆盖 Zip Slip 防护（`petmod.rs` extract_zip_to 测试）
- ✅ 前端测试覆盖 IPC 安全框架（`agentSandbox.test.ts` 权限控制测试）

**问题**:

| # | 问题 | 严重度 | 说明 |
|---|------|--------|------|
| S-1 | **无自动化渗透测试** | 🟡 P1 | 安全评估报告中的 8 项渗透测试清单仅作为手工验证清单，未自动化为 CI 步骤 |
| S-2 | **无 SAST/DAST 工具集成** | 🟡 P1 | 未集成 CodeQL / Semgrep 等 SAST 工具或 OWASP ZAP 等 DAST 工具 |
| S-3 | **cargo/pnpm audit 仍为观察期** | 🟡 P2 | 两个漏洞扫描工具仍为 `continue-on-error: true`，不阻断合并 |

### 5.3 非功能性测试缺失项

| 测试类型 | 现状 | 建议 |
|---------|------|------|
| **内存泄漏检测** | ❌ 缺失 | 长时间运行（24h+）内存趋势监控，检测 Live2D/事件监听器/定时器泄漏 |
| **压力测试** | ❌ 缺失 | 大量聊天消息（10k+）、大量记忆条目（1k+）、大量模组安装时的响应时间和内存表现 |
| **模糊测试 (Fuzz)** | ❌ 缺失 | 对 IPC 命令入参、.petmod 包结构、LLM 返回内容进行模糊测试 |
| **可访问性测试** | ❌ 缺失 | 未使用 axe-core 等工具验证 WCAG 合规性 |
| **国际化测试** | ❌ 缺失 | 未测试多语言切换、RTL 布局、日期/数字格式化 |
| **兼容性测试** | ❌ 缺失 | 未测试不同 Windows 版本（10/11）、不同 WebView2 版本 |

---

## 六、改进建议（分优先级）

### 🔴 P0 — 立即实施（阻断关键测试盲区）

| 编号 | 建议 | 预期收益 | 实施复杂度 | 验证方法 |
|------|------|---------|-----------|---------|
| T-01 | **引入 Tauri Driver 真实 E2E 测试**: 在 CI 中集成 `tauri-driver` + WebDriverIO/Playwright，对构建后的 Tauri 应用运行真实 E2E 测试（至少覆盖冷启动→窗口渲染→基础交互→退出） | 消除 E-1，E2E 测试从"Web 冒烟"升级为"真实应用验证" | ⭐⭐⭐ | CI 中 Tauri E2E Job 成功运行，覆盖 Win32 系统托盘/窗口管理等桌面特性 |
| T-02 | **建立 IPC 参数类型契约测试**: 扩展现有 `ipcContract.test.ts`，不仅校验命令名存在，还校验参数类型签名（从 Rust 端解析函数签名，从前端解析 invoke 调用参数类型，交叉对比） | 消除 I-1，在编译时和测试时双重保障前后端 IPC 类型安全 | ⭐⭐ | 前端调用 `invoke('encrypt_data', { data: 123 })`（类型不匹配）时测试失败 |
| T-03 | **CI Job 依赖编排**: 在 `ci.yml` 中设置 `build` Job `needs: [lint-and-test, rust-test]`，测试失败时不执行构建 | 消除 C-1，节省 CI 资源 30%+ | ⭐ | 推送含测试失败的 PR 时，build Job 不执行 |

### 🟠 P1 — 近期实施（2~4 周内，提升测试深度）

| 编号 | 建议 | 预期收益 | 实施复杂度 |
|------|------|---------|-----------|
| T-04 | **增加组件单元测试覆盖**: 为排除列表中的核心组件（PetWindow/SettingsWindow/ShopPanel 等）编写测试，使用 MockContext 模拟 Tauri 依赖 | 消除 U-1/U-2，组件覆盖率从 15% 提升至 50%+ | ⭐⭐ |
| T-05 | **E2E 断言增强**: 在现有 E2E 测试中加入功能正确性断言（如喂食后饱食度数值变化、购买后金币减少、发送消息后消息出现在列表） | 消除 E-2，E2E 从"页面不崩溃"升级为"功能正确" | ⭐⭐ |
| T-06 | **引入真实 SQLite 集成测试**: 使用 `sql.js` 或内存 SQLite 进行真实数据库迁移测试（不 Mock plugin-sql） | 消除 I-3，保障 schema 变更不破坏数据 | ⭐⭐ |
| T-07 | **集成 SAST 工具**: 在 CI 中添加 CodeQL 或 Semgrep 静态安全分析 Job | 消除 S-2，自动化发现安全漏洞 | ⭐⭐ |
| T-08 | **性能测试阻断发布**: 将 release.yml 中性能测试的 `continue-on-error` 改为 `false`（或设置预发布门禁） | 消除 P-1，性能不达标不发布 | ⭐ |
| T-09 | **多浏览器 E2E**: 在 `playwright.config.ts` 中添加 Firefox 和 WebKit project | 消除 E-3，覆盖 macOS WebView 兼容性 | ⭐ |
| T-10 | **cargo/pnpm audit 收紧**: 将 `continue-on-error: true` 改为 `false`，漏洞扫描阻断合并 | 消除 S-3，依赖漏洞零容忍 | ⭐ |

### 🟡 P2 — 中期实施（1~2 月内，提升测试体系成熟度）

| 编号 | 建议 | 预期收益 | 实施复杂度 |
|------|------|---------|-----------|
| T-11 | **添加内存泄漏检测测试**: 编写长时间运行（1h+）性能脚本，定期采样内存，检测线性增长趋势 | 填补非功能性测试空白 | ⭐⭐ |
| T-12 | **集成 Codecov/Coveralls**: 将覆盖率报告上传至第三方平台，在 PR 中展示覆盖率 diff 评论 | 消除 C-5，覆盖率变化可视化 | ⭐ |
| T-13 | **Rust 代码覆盖率收集**: 集成 `cargo-tarpaulin` 或 `cargo-llvm-cov`，在 CI 中收集 Rust 覆盖率 | 消除 C-6，Rust 测试覆盖率可量化 | ⭐⭐ |
| T-14 | **压力测试脚本**: 编写大消息量/大记忆量/多模组场景的性能测试 | 填补非功能性测试空白 | ⭐⭐ |
| T-15 | **E2E 异常路径测试**: 添加网络断开、LLM 超时、数据库损坏等异常场景 E2E | 消除 E-6，验证异常处理 | ⭐⭐ |
| T-16 | **自动化渗透测试**: 将安全评估报告中的 8 项渗透测试清单脚本化，集成到 CI | 消除 S-1，安全验证自动化 | ⭐⭐⭐ |
| T-17 | **E2E 多窗口交互测试**: 测试从宠物窗口打开设置、从设置跳转聊天等跨窗口场景 | 消除 E-5 | ⭐⭐ |

### 🟢 P3 — 长期优化（持续改进，锦上添花）

| 编号 | 建议 | 预期收益 | 实施复杂度 |
|------|------|---------|-----------|
| T-18 | **引入 Mutation Testing (Stryker)**: 验证测试用例有效性，发现"无效测试" | 测试质量可量化 | ⭐⭐⭐ |
| T-19 | **添加可访问性测试 (axe-core)**: E2E 中集成 axe 扫描，验证 WCAG 合规 | 提升无障碍体验 | ⭐⭐ |
| T-20 | **移动端 E2E 测试**: 为 `src/mobile/` 添加移动端视图 E2E | 消除 E-7 | ⭐⭐ |
| T-21 | **快照测试**: 为稳定组件添加 Vitest snapshot 测试 | 回归保护 | ⭐ |
| T-22 | **性能基线趋势监控**: 记录历次性能数据，设置回归告警（如冷启动比基线慢 20%） | 消除 P-2 | ⭐⭐ |
| T-23 | **多 Node 版本测试矩阵**: 在 CI 中添加 Node 20/18 兼容性测试 | 消除 C-2 | ⭐ |
| T-24 | **国际化测试**: 测试多语言切换、RTL 布局 | 填补空白 | ⭐⭐ |

---

## 七、各维度改进路径总结

```
当前状态 ──────────────────────────────────────── 目标状态

CI/CD (82) ═════════════════════════════════════ (90+)
  └─ T-03 Job 依赖编排 → T-12 Codecov 集成 → T-23 多 Node 版本

单元测试 (85) ══════════════════════════════════ (90+)
  └─ T-04 组件覆盖提升 → T-18 Mutation Testing → T-21 快照测试

集成测试 (55) ═══════════════════════════════════ (80+)
  └─ T-02 IPC 类型契约 → T-06 真实 SQLite 测试 → T-07 SAST 集成

E2E 测试 (48) ═══════════════════════════════════ (80+)
  └─ T-01 Tauri Driver → T-05 断言增强 → T-09 多浏览器 → T-15 异常路径 → T-17 多窗口

专项测试 (78) ═══════════════════════════════════ (90+)
  └─ T-08 性能门禁 → T-10 audit 收紧 → T-11 内存泄漏 → T-14 压力测试 → T-16 自动化渗透
```

---

## 八、结论

SpiritPal 项目的测试体系在**框架搭建和基础设施建设**方面已达到较高水平：

- **CI/CD 自动化程度高**: 5 个 Job 覆盖前端/Rust/E2E/漏洞扫描/多平台构建，Release 流水线集成性能验收
- **单元测试基础设施优秀**: MockContext + FakeClock + TestHarness 三件套为测试编写提供了强有力的工具支撑
- **IPC 契约测试设计巧妙**: 通过源码静态分析实现前后端命令一致性校验，是同类项目中少见的实践
- **性能测试体系完善**: 4 项 PRD 指标全部脚本化，跨平台支持，CI 自动执行
- **安全评估深度充分**: 19 项发现含 Source→Sink 追踪，4 级优先级建议

核心短板集中在**测试深度而非广度**：

1. **集成测试**: 前后端交互全 Mock，缺少真实 IPC 通信验证
2. **E2E 测试**: 仅 Web 冒烟模式，不测试真实桌面应用行为
3. **组件测试**: 40+ 组件仅 6 个有测试，大量组件以"依赖原生 API"为由排除
4. **非功能性测试**: 缺少内存泄漏、压力、模糊、可访问性等专项测试

建议按 P0→P1→P2→P3 优先级逐步实施改进建议，优先补齐"真实 Tauri E2E"和"IPC 类型契约"两大关键盲区。
