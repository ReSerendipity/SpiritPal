# 变更管理流程

> **文档编号**：CM-001  
> **创建日期**：2026-08-27  
> **适用范围**：SpiritPal 全项目

---

## 1. 目的

为需求变更建立可追溯的闭环流程，确保每次变更都有：
- 书面记录（变更申请）
- 影响评估（受影响模块/测试/发布计划）
- 审批痕迹（决策人和理由）

---

## 2. 变更类型与流程

| 变更类型 | 触发条件 | 审批人 | 影响评估要求 |
|---------|---------|--------|-------------|
| **A 类：范围变更** | 新增/删除功能模块、MoSCoW 优先级调整 | 产品负责人 | 必须：PRD §3 范围定义 + §7 功能需求 + 测试覆盖 |
| **B 类：技术变更** | 技术栈替换、架构调整、数据迁移 | 技术负责人 | 必须：AGENTS.md 技术栈表 + 迁移方案 + 回退方案 |
| **C 类：配置变更** | 算法参数、窗口尺寸、超时阈值等常量修改 | 开发者自查 | 可选：变更日志 + 回归测试 |

---

## 3. 影响评估模板

每次 A/B 类变更必须填写以下评估表（复制到 `docs/project/changelog/<变更ID>-impact-assessment.md`）：

```markdown
# 变更影响评估：<变更标题>

| 字段 | 内容 |
|------|------|
| **变更 ID** | CHG-YYYY-NNN |
| **变更类型** | A 类 / B 类 |
| **申请人** | |
| **申请日期** | YYYY-MM-DD |
| **变更描述** | （简述变更内容和原因） |

## 受影响范围

| 模块 | 影响文件 | 影响说明 |
|------|---------|---------|
| PRD | docs/project/PRD_桌面宠物应用_v0.2.md §x.x | |
| 架构 | docs/project/ARCHITECTURE.md | |
| 代码 | src/lib/xxx.ts, src/components/xxx.tsx | |
| Rust | src-tauri/src/xxx.rs | |
| 测试 | src/lib/__tests__/xxx.test.ts, e2e/xxx.spec.ts | |
| CI/CD | .github/workflows/ci.yml | |
| i18n | public/locales/*/translation.json | |

## 回退方案

（变更失败时如何回退到变更前状态）

## 验收标准

- [ ] 代码变更完成
- [ ] 测试全部通过（vitest + cargo test + lint）
- [ ] 文档同步更新（AGENTS.md / PRD / CHANGELOG）
- [ ] 生产构建通过
```

---

## 4. 变更日志

所有变更记录在 `CHANGELOG.md` 的 `[Unreleased]` 区块中，格式：

```markdown
### Changed
- **CHG-2026-001**：[变更标题]（影响评估：docs/project/changelog/CHG-2026-001-impact-assessment.md）
```

---

## 5. 与现有流程的对接

| 现有流程 | 变更管理对接点 |
|---------|-------------|
| AGENTS.md 自进化协议 | 铁律 1「同步规则」→ 变更时同步更新 AGENTS.md |
| AGENTS.md §10.2 版本号同步 | A/B 类变更涉及版本号时必须 3 文件同步 |
| Conventional Commits | `scope` 字段对应受影响模块，`breaking` 标记 A 类变更 |
| CI/CD `ci.yml` | A 类变更必须在 PR 中附影响评估文件链接 |
