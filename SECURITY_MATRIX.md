# SpiritPal 安全矩阵

> 本文档列出项目的安全控制措施，供安全审计和合规检查参考。

## 身份与访问控制

| 控制项 | 实现方式 | 状态 |
|---|---|---|
| 分支保护 | GitHub Branch Protection（main 受保护，需 PR + required checks） | ✅ |
| DCO 签名 | .githooks/commit-msg 强制 Signed-off-by | ✅ |
| 代码审查 | PR 需 review | ⚠️ 待配置 CODEOWNERS |

## 代码安全

| 控制项 | 实现方式 | 状态 |
|---|---|---|
| 密钥扫描 | gitleaks（pre-commit + CI） | ✅ |
| 依赖漏洞扫描 | Dependabot（GitHub 告警）+ CI `dependency-vuln-scan` job：`pnpm audit` / `cargo audit` 产 JSON、`osv-scanner` 出报告 | ✅ |
| 依赖漏洞**门禁** | `scripts/security_gate.py` 棘轮基线（`.ci/security_baseline.json`，只降不升；基线缺失或报告结构异常即失败，绝不"首次自动放行"）。注：`pnpm audit`/`cargo audit` 自身退出码**不作为门禁**，判定权在棘轮基线 | ✅ |
| 传递依赖漏洞收口 | `pnpm-workspace.yaml` 的 `overrides` 下界，现有 11 项：`gh-pages` `protobufjs` `sharp` `js-yaml` `fast-uri` `ini` `nanoid` `semver` `hono` `qs` `ip-address`；锁文件与 overrides **必须同提交**，否则 `pnpm install --frozen-lockfile` 报 `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` | ✅ |
| 前端资源完整性（SRI） | `scripts/obfuscate-and-sri.mjs` 生成 `src-tauri/src/generated/sri_hashes.rs`；构建期 `--verify` 双向核对 dist ↔ 清单，release 启动时 `integrity::verify_integrity` 重算**内嵌字节**比对（清单是生成物，由 `beforeBuildCommand` 随构建重生成） | ✅ |
| SAST | CodeQL / Semgrep | ✅ |
| 静态分析 | ruff / flake8 / eslint | ✅ |
| 完整性校验 | Ed25519 签名清单 | ✅ |

## 数据安全

| 控制项 | 实现方式 | 状态 |
|---|---|---|
| 敏感配置不入库 | .env.example 模板，真实配置 gitignore | ✅ |
| 路径遍历防护 | path_guard / CSRF middleware | ✅ |
| 输入校验 | 参数验证 / schema 校验 | ✅ |

## 发布安全

| 控制项 | 实现方式 | 状态 |
|---|---|---|
| 签名发布 | gpg-signed-release（仅 SeedVR2） | ⚠️ 待推广 |
| 制品不可变 | Immutable Release Artifacts | ✅ |

---
*最后更新：2026-09-20*
