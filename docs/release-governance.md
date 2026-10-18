# SpiritPal 发布 / 回滚 规范

> **来源与权威**：公共条款见 `ReSerendipity/.github` 的 `REPOSITORY_GUIDELINES.md` §10（发布 / 分发统一规范，2026-10-18 新增）。
> 本文件是该模板在 **SpiritPal** 的本地化落地：只填本仓特有内容，**不重写、不抵触 §10 的公共条款**。
> 本仓技术栈：**Rust（Tauri v2 桌面壳）+ 前端（Node / pnpm / Vite）+ Android（Tauri 移动端）**，属**桌面分发**形态，`§10.3` 的容器镜像 / npm 条款不适用。

---

## 0. 远端优先（根原则，不可改写）

发布链的构建、打包、扫描、上传、推送**全部在 GitHub Actions 远端完成**；本地只做三件事：改版本位、落 CHANGELOG、`git tag` + `git push`。本地不执行打包 / 签名 / 镜像构建 / 发布上传。

- 本仓发布链由 `.github/workflows/release.yml` 承担，触发条件为 `push: tags: 'v*'`，构建矩阵为 `ubuntu-22.04` + `windows-latest`（**不构建 macOS**——2026-09-10 用户指示：模型必须 N 卡，不支持苹果电脑）。
- 签名密钥（`TAURI_SIGNING_PRIVATE_KEY` 及其口令）**不入库**，经 Actions Secrets 注入远端签名；本机不持有、不参与签名。

## 1. 版本号规范

- 遵循 **SemVer** `MAJOR.MINOR.PATCH`；预发布用 `-alpha.N` / `-beta.N` / `-rc.N`。
- **唯一权威版本位**：`package.json` 的 `version` 字段（当前 `0.1.0`）。
- **必须同步的其它版本位**（共 3 处代码位 + 2 处发布位）：
  - `src-tauri/Cargo.toml` 的 `[package]` 段顶层 `version`（当前 `0.1.0`）；
  - `src-tauri/tauri.conf.json` 的 `version` 字段（当前 `0.1.0`）；
  - `updates.json` 的 `version`（当前 `0.1.0`，由发布链 `publish-updates` job 生成/回写）；
  - 发布 tag `v<X.Y.Z>`（须与 `package.json` 版本逐字符相等，仅多一个 `v` 前缀）。
- **版本位漂移由以下入口钉住——漂一处即判红**：
  - `node scripts/sync-version.mjs --check`（比对 `package.json` / `Cargo.toml` / `tauri.conf.json` 三处；在 `.github/workflows/docs-consistency.yml` 的 `version-consistency` job 中执行）；
  - `.github/workflows/verify-release-version.yml`（独立门禁：校验三处一致 + tag 与 `package.json` 一致）；
  - `.github/workflows/release.yml` 首个步骤 `Verify release tag matches package version`（跨 workflow 无法 `needs` 阻断，故发布链自身在**任何 release 创建/上传动作之前**再判一次）。
- **自动化方式：手动 tag（人工）**。本仓**不使用 release-please**，无自动版本递增；版本号由人工在 `package.json` 改定后，`node scripts/sync-version.mjs` 回写到另外两处。

> 背景（本仓已踩过的坑）：协议检查点标签命名空间为 `v29-p1-1 … v29-p1-12` / `v29-wb-start`，与发布用的 `v*` 通配命名冲突。上述三道版本闸的共同作用是把「检查点标签误入远端触发完整发版」显式化为红。

## 2. CHANGELOG 管理

- **`CHANGELOG.md` 存在**，遵循 **Keep a Changelog**（`Added / Changed / Fixed / Deprecated / Removed / Security`），版本号遵循 SemVer。
- 每次合并 `main` 在 `[Unreleased]` 追加；type 映射 `feat→Added`、`fix→Fixed`、`refactor→Changed`。
- 发版时 `[Unreleased]` → `[VERSION] - YYYY-MM-DD`。
- 现状：`CHANGELOG.md` 当前 `[Unreleased]` 字段已长期累积（未按版本切分），发版时应按本流程定版。

## 3. 发布流程（远端）

1. 确认 `CHANGELOG.md` 的 `[Unreleased]` 条目完整。
2. 同步版本位：改 `package.json` 的 `version` → 执行 `node scripts/sync-version.mjs` 回写 `Cargo.toml` / `tauri.conf.json`（见 §1 清单）。
3. 本地打 tag 并推送：`git tag v<X.Y.Z>` → `git push origin v<X.Y.Z>`。
4. 远端凭 tag 触发 `.github/workflows/release.yml`：
   - **闸 1**：`Verify release tag matches package version`——tag 与 `package.json` 不一致即终止（不进入任何创建动作）；
   - **闸 2**：`gh release create`（`GITHUB_TOKEN`）**预创建 draft Release**（本仓 `tauri-action` 直接创建 Release 曾持续 403；预创建后 tauri-action 仅负责上传资产）；
   - **闸 3**：`tauri-action` 远端构建 Tauri 安装包并写入 ed25519 更新器签名；
   - **闸 4**：`Verify SRI manifest matches dist`——回读 `dist` 产物与 `sri_hashes.rs` 逐条一致，不一致即阻断发版；
   - **闸 5**：`performance-test-cross-platform` job 跑**包大小门禁**（`perf/package-size.mjs`）+ **基线回归只读门禁**（`perf/baseline-trend.mjs --read-only`），阻断发布。
5. `publish-updates` job 收尾：校验 Release 资产（必含 Windows NSIS `setup.exe` + 更新器 `.sig`，且 `.sig` 为 minisign 格式）→ 生成 `updates.json` → 校验其 `version` / `url` / `signature` 齐全 → **draft 转正式发布**（`--draft=false`）→ 提交并推送 `updates.json` 回 `main`。任一步失败则把该 Release **退回 draft**（不留「用户可下载但更新清单未跟上」的半完成态）。
6. 盯到终态：`gh run list` 确认绿；红了当场修或按 §5 revert 止损。

> 注：Tauri 增量更新依赖 `updates.json`（客户端经 `plugin-updater` 校验内嵌 ed25519 签名）。漏更新 `updates.json` = 用户永远检查不到新版本，故其生成/校验被强制前置于公开发布之前。

## 4. 分发产物与完整性

| 产物 | 构建位置 | 标签 / 命名 | 完整性手段 |
|---|---|---|---|
| Windows NSIS 安装包 `SpiritPal_<ver>_x64-setup.exe` | **远端**（`windows-latest`） | 不可变：Release URL 固定为 `releases/download/v<ver>/…` | Tauri ed25519 更新器签名（`*.sig`，minisign 格式） |
| Linux 产物 `SpiritPal_<ver>_amd64.AppImage` 等（AppImage / deb） | **远端**（`ubuntu-22.04`） | 不可变：同上，绑定 `v<ver>` | 对应 `*.sig` |
| `updates.json`（更新清单） | **远端**（`publish-updates` job） | 版本号绑定 `<ver>` | 内嵌 `platforms.*.signature`，与 Release `.sig` 逐字符一致 |
| SBOM（CycloneDX，`sbom-npm.json` / `sbom-npm.xml` / `src-tauri/*.cdx.json`） | **远端**（`.github/workflows/sbom.yml`，同样 `push: tags: 'v*'` 触发） | 随 draft Release 附带 | 依赖清单，供供应链核对 |

- **标签不可变性**：产物由 tag `v<X.Y.Z>` 驱动，URL 固定到 `v<ver>`，**不以 floating `latest` 作发布基线**（本仓无 `latest` 引用，`updates.json` 中的下载 URL 均为版本化固定路径）。
- **完整性口径**：防伪造由**桌面壳的 Tauri ed25519 更新器签名承担**（`*.sig`，minisign 格式；发布链已硬性校验其存在与格式）。
- **GPG 分离签名已撤**：本仓原 `gpg-signed-release.yml` **已删除，符合 2026-10-18 裁决**（PR #146 已合并，删除该 workflow）。当前工作流清单中不再存在该文件。
- **现状差异（与 §10 公共条款的偏差，待收敛）**：本仓 Release 资产**未产出 `SHA256SUMS.txt`**（§10.1 要求 Release 资产须附之）。当前拼图完整性依赖 Tauri ed25519 签名 + 本地哈希复核（见 `docs/execution/RELEASE_VERIFICATION.md`，其中明确记录本仓 NSIS 属非可复现构建、本地与 CI 哈希必然不同，故以验签为准）。
- **容器镜像条款不适用**：本仓无 `Dockerfile`、无 ghcr 推送，`.trivyignore.yaml` 不存在，`.github/workflows/` 中无任何 Trivy 扫描步骤——§10.3 / §10.4 的镜像 tag、Trivy 阻断、`provenance: true` / `sbom: true` 条款**对本仓不适用**。
- 签名私钥按 §3 走私有 `<项目名>-KeyBackup` 模式保管，不入库。

## 5. 回滚

- **判定**（本仓具体阈值）：**待定（负责人 + 触发条件）**——本仓尚未定义量化回滚阈值（如崩溃率 / 包大小回归上限 / 更新失败率），待负责人与运行手册补定后回填。
- **执行**：
  - 代码类：`git revert <bad-commit>`（保历史、可再 forward）；
  - 更新清单类：`git revert` 对 `updates.json` 的 `chore(ci): sync updates.json` 提交（客户端即回落到上一版清单）；
  - 发布态类：把出问题的 Release 退回 draft（`gh release edit <tag> --draft=true`），阻断新用户下载。
- **破坏性动作**：重指向 / 删除 tag、移动任何远端 ref → **须仓库所有者单独授权**。`release.yml` 由 `push: tags` 触发，移动已发布 tag 会当场重跑整条发布链。
- **回滚后验证**：`gh release view <tag> --json assets -q '.assets[].name'` 核验资产；按 `docs/execution/RELEASE_VERIFICATION.md` 清单复核 `updates.json` 可达性与内容（HTTP 200、`version` 与 tag 一致、`platforms` 均含 `signature`）。

## 6. SLA / 错误预算

- 目标可用性：**待定（负责人 + 触发条件）**——本仓为**本地运行的桌面应用**（Tauri / NSIS，见 §10.4「本地运行边界」），无在线服务端可用性指标；错误预算待负责人定义（例如：更新链路失败率、发布链红/绿时长）后回填。

## 7. 发布前检查清单

- [ ] 版本位全部同步（`package.json` / `src-tauri/Cargo.toml` / `src-tauri/tauri.conf.json`，见 §1；`node scripts/sync-version.mjs --check` 三处一致 ✓）
- [ ] `CHANGELOG.md` 的 `[Unreleased]` 已改为 `[VERSION] - YYYY-MM-DD`
- [ ] 测试 / 覆盖率门禁通过：`pnpm test:coverage`（vitest，阈值 lines 46 / functions 42 / branches 38 / statements 45）
- [ ] lint / format 全绿：`pnpm lint`（`tsc --noEmit` + `eslint src/`）、`pnpm format:check`
- [ ] SRI 清单一致：`pnpm verify:sri`（`node scripts/obfuscate-and-sri.mjs --verify`）
- [ ] tag 命名 `v<X.Y.Z>` 与 `package.json` 逐字符一致（发布链闸 1）
- [ ] **本地未产出任何发布交付物**（安装包 / 签名 / SBOM 全部远端构建）
- [ ] 镜像类仓条款：**本仓不适用**（无容器镜像，见 §4）

---

## 差异点采集清单（本仓取值）

| 占位符 | 采集来源 | 本仓取值 |
|---|---|---|
| 版本位文件与字段 | 仓内版本声明 | `package.json` 的 `version`（唯一权威，当前 `0.1.0`） |
| 其它需同步版本位 | 版本一致性工具 | `src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`updates.json`、发布 tag `v<ver>` |
| 版本一致性校验入口 | `scripts/`、`.github/workflows/` | `node scripts/sync-version.mjs --check`；`verify-release-version.yml`；`release.yml` 首发步骤 |
| 自动化方式 | `.github/workflows/` | **手动 tag（人工）**；无 release-please |
| 发布 workflow 文件名 | `.github/workflows/` | `release.yml`（`push: tags: 'v*'`）、`verify-release-version.yml`、`sbom.yml` |
| 产物形态与标签规则 | 构建 workflow | Tauri 桌面包：Windows NSIS `setup.exe`、Linux AppImage/deb；不可变，URL 绑定 `v<ver>`，无 `latest` |
| 完整性手段 | Release 资产清单 | Tauri ed25519 更新器签名（`*.sig`）；**未产出 `SHA256SUMS.txt`（现状差异）** |
| 回滚判定阈值 | 运行手册 / 监控 | 待定（负责人 + 触发条件） |
| 回滚后验证命令 | `docs/execution/RELEASE_VERIFICATION.md` | `gh release view` 资产核验 + `updates.json` 可达性复核 |
| 技术栈 | `package.json` / `Cargo.toml` | Rust（Tauri v2）+ 前端（pnpm / Vite）+ Android |
| 部署目标 | Pages / deploy | 桌面端安装（本地运行边界）；**无** Pages / 容器部署 |

## 禁止事项

- 不得重写 §10 的公共条款（远端优先、tag 驱动、版本位一致、不可变标签、扫描阻断、无 GPG）。
- 不得引入 `latest` 作发布基线；不得保留或新建 GPG 签名流程。
- 不得留空占位符，不得编造阈值（未定项一律写「待定（负责人 + 触发条件）」）。
