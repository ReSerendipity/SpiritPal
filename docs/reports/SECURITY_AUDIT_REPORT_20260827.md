# SpiritPal 安全状况评估报告

> 日期：2026-08-27 · 基于家族规范治理 Phase C/D 实施后实测。本仓 `docs/` 已随仓库发布。

## 一、执行摘要

SpiritPal 为 Tauri v2 桌面应用。既有安全基础良好：最小权限 Capability（43/13/41，fs 无 scope 默认全拒）、Rust 魔数校验纵深防御、加密数据库。本次治理聚焦文档现实一致性（更正 Electron 误述、SECURITY.md 单一位置）与治理层补全，总体风险「低」。

## 二、归属权篡改风险评估

- 提交链路：`main`；workflows 5 个（ci / codeql / docs-consistency / release / sbom）。
- 已知事实更正：上一轮报告曾误述为 Electron（含 electron-forge.yml）——**实测为 Tauri**（`@tauri-apps/*`、`src-tauri/src/` 18 个 `.rs`），已由 ADR-0001 固化。
- 本次补强：ISSUE_TEMPLATE / PULL_REQUEST_TEMPLATE / CODE_OF_CONDUCT 补齐。

## 三、安全风险评估

| 攻击面 | 现状 | 状态 |
|---|---|---|
| Tauri 权限 | 3 个 capability 全 allow、无 deny 条目、无 scope（fs 默认全拒） | 已核对 |
| 伪装文件上传 | Rust 19 扩展名 21 签名魔数表 + `validate_upload_magic` + 前端 4 处接线 | 已核对 |
| petmod 导入 | zip 魔数 → SHA-256 → 路径三层校验 → zip-slip 防护 → 结构验证 | 已核对 |
| shell 注入 | 三个 capability 均无 shell 权限 | 已核对 |
| 密钥/数据 | SQLite 加密库（`src-tauri/src/encrypted_db.rs`） | 已核对 |

## 四、技术风险评估

- 文档体量最大（AGENTS.md 101.3KB）但已 0 幻影（Phase A/B 归零并由审计器回归）。
- SECURITY.md 由根级 + docs 双份合并为根级单一实体（docs 侧为跳转）。

## 五、风险汇总矩阵

| 编号 | 风险 | 可能性 | 影响 | 综合 | 状态 |
|---|---|---|---|---|---|
| R-01 | 文档误述技术栈（Electron） | 已消除 | 中 | 已修复 | 已修复（Tauri 事实固化） |
| R-02 | SECURITY 文档双份漂移 | 已消除 | 低 | 已修复 | 已修复（C1 合并） |
| R-03 | 未来权限放宽引入越权 | 低 | 高 | 中 | 已设 ADR 审查门槛 |
| R-04 | `detect_file_kind` 暴露为命令 | — | 低 | 已识别 | 待办（预留 API，未暴露） |

## 六、已落地修复项（本次实施）

- SECURITY.md 单一位置：根级 8.1KB 实体 + `docs/SECURITY.md` 跳转文件。
- ADR：`docs/adr/0001-tauri-v2-capabilities.md`、`0002-upload-magic-check.md`。
- 治理文件：`.github/ISSUE_TEMPLATE/bug_report.md`、`.github/PULL_REQUEST_TEMPLATE.md`、`.github/CODE_OF_CONDUCT.md`。
- LOCAL_RULES.md 新建（变更隔离 + 语言约定 + 单一事实来源）。
- 合规文档：`docs/COMPLIANCE_NOTES.md` → `docs/COMPLIANCE_CHECKLIST.md` 重命名并全链引用更新。

## 七、修复验证记录

```powershell
python scripts/check_spec_refs.py          # phantom=0 dead_links=0 → 退出码 0
python C:\Users\Doro\.spec_audit\audit_spec_refs.py   # [high-confidence findings] 0
Get-ChildItem src-tauri\src -Filter "*.rs" | Measure-Object   # 18 个 Rust 源文件（实测确认技术栈）
```

## 八、中长期修复路线图

| 优先级 | 事项 | 状态 |
|---|---|---|
| P2 | `detect_file_kind` 暴露为 Tauri 命令前补测试 | 待办 |
| P2 | 权限项未来新增必须过 ADR 审查 | 已设机制 |

## 九、结论与建议

安全现状良好，本次治理重点是「让文档不再说谎」：技术栈、权限数字、魔数机制均已与代码逐一核对并固化。后续新增 capability 权限与文件处理命令，一律先写 ADR 与 SECURITY.md 再实现。