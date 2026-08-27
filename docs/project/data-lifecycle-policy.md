# SpiritPal 数据生命周期策略

> **版本**：v1.0  
> **创建日期**：2026-08-27  
> **维护者**：数据治理改进项目  
> **配套文档**：[data-dictionary.md](./data-dictionary.md)、[migrations/](../src/lib/migrations/)

---

## 1. 概述

本文档定义 SpiritPal 应用所有持久化数据的 **数据生命周期策略**，包括：

- **归档规则**：何时将活跃数据迁移到归档存储
- **清理规则**：何时安全删除数据以回收空间
- **销毁规则**：用户主动删除或应用卸载时的数据处理
- **合规约束**：GDPR / 个人信息保护法 要求的用户权利响应

### 1.1 数据生命周期阶段

```
   创建 ──→ 活跃 ──→ 冷存储 ──→ 归档 ──→ 销毁
           ↑          ↑          ↑
           │          │          │
      常规读写    90天未访问   180天未  用户删除/
                             访问      过期策略
```

### 1.2 治理原则

| 原则 | 说明 |
|------|------|
| **最小化收集** | 只收集功能必需的数据 |
| **目的限定** | 数据用于明确声明的用途，不作他用 |
| **有限保留** | 达到保留期限的数据必须清理 |
| **用户主权** | 用户可随时导出和删除自己的数据 |
| **透明可审计** | 数据操作留有审计日志 |

---

## 2. 数据分类与保留策略

### 2.1 活跃数据（Active Data）

| 数据类别 | 表/存储 | 保留策略 | 触发条件 |
|---------|---------|---------|---------|
| 角色养成数据 | `characters` | 永久（直到用户主动删除角色） | — |
| 用户偏好设置 | `settings` | 永久 | — |
| 当前对话摘要 | `memory_sums` | 永久 | — |
| 实时上下文 | `context_episodes` | 7 天滑动窗口 | `started_at < now - 7d` |
| 审计日志 | `audit_log` | 365 天 | `created_at < now - 365d` |

### 2.2 冷数据（Cold Data）

| 数据类别 | 表/存储 | 冷存储阈值 | 冷存储后处理 |
|---------|---------|-----------|------------|
| 记忆条目 | `memories` | 90 天未访问（`last_accessed`） | 仅保留，不主动清理（用户可能回溯） |
| 事件日志 | `spiritpal_events` | 90 天 | 压缩归档（不删除，但迁移到外部存储） |
| 实体节点 | `entity_nodes` | 90 天未提及（`last_seen`） + 提及 < 3 | 自动删除（`zombieDataCleanup`） |

### 2.3 归档/压缩策略

| 数据类别 | 归档阈值 | 归档方式 |
|---------|---------|---------|
| 历史对话 | 永不归档 | 随用户保留（对话是核心资产） |
| 记忆嵌入 | 永不归档 | `embedding` 字段可能很大，但删除会破坏语义搜索 |
| 截图/视觉记忆 | 180 天未访问 | 压缩为低分辨率缩略图 |
| 临时上下文 | 立即清理 | context_episodes 按 TTL 删除 |

---

## 3. 清理实施细则

### 3.1 自动清理任务

通过 `zombieDataCleanup.ts` 和数据库级 TTL 约束自动执行：

| 清理目标 | 清理策略 | 执行频率 | 实现位置 |
|---------|---------|---------|---------|
| `.legacy` JSON blob | 迁移成功后 7 天自动删除 | 每天 | `cleanupLegacyBlobs` |
| `context_episodes` | 7 天滑动窗口外 | 每天 | `cleanupExpiredEpisodes` |
| `entity_nodes` | 90 天未访问 + 提及 < 3 | 每天 | `cleanupExpiredEntities` |
| `dirty_data_registry` 已解决记录 | 已解决 + 30 天 | 每周 | `cleanupResolvedDirtyData` |
| `audit_log` | 365 天前 | 每周 | 待实现（Rust 端任务） |

### 3.2 手动触发清理入口

- **设置页「数据管理」面板**：提供「清理过期数据」按钮
- **右键菜单**：「数据清理（高级）」子菜单
- **命令行**：开发者工具执行 `window.__dirtyDataTracker.runDirtyDataChecks()`

### 3.3 安全约束

清理操作必须遵守：
1. 每次清理上限 100 条（防阻塞）
2. 失败后不清零（宁可多留不可误删）
3. 记录审计日志（`AuditEventType.SECURITY_EVENT`）
4. 批量清理前提供用户预览（可选配置）

---

## 4. 用户删除（被遗忘权）

### 4.1 删除场景

| 场景 | 入口 | 影响范围 |
|------|------|---------|
| 删除单个角色 | 角色管理 → 删除 | 该角色及其关联的记忆、背包、日程 |
| 清除所有对话 | 设置 → 数据 → 清除聊天记录 | 当前角色的所有 `memory_sums`+对话历史 |
| 重置应用 | 设置 → 数据 → 重置应用 | 整库清空（但保留加密密钥） |
| 卸载应用 | OS 卸载流程 | 整库文件删除（文件级 AES 加密保护） |

### 4.2 级联删除规则

删除角色时的级联影响：
```
characters (id)
  ├─ memories (character_id)
  ├─ memory_sums (character_id)
  ├─ memory_state (character_id)
  ├─ owner_facts (character_id)
  ├─ inventory (character_id)
  ├─ pet_experiences (character_id)
  ├─ visual_memories (character_id)
  └─ schedules (character_id) ── 注意：待验证 FK 是否存在
```

### 4.3 软删除策略（推荐实现）

当前为硬删除，建议未来实现软删除：
- 删除操作标记 `deleted_at` 时间戳
- 30 天后由后台任务真正清除
- 期间用户可恢复（回收站机制）

---

## 5. 数据导出（携带权）

### 5.1 支持范围

| 数据类别 | 导出格式 | 说明 |
|---------|---------|------|
| 角色养成数据 | JSON 文件 | `characters`+`stats` 完整结构 |
| 记忆全文 | JSON 文件 | `memories`+关联嵌入（可选） |
| 用户偏好 | JSON 文件 | `settings` 表所有记录 |
| 对话历史 | JSON/Markdown | 逐条导出，支持格式化 |
| 完整备份 | 加密 XML/ZIP | 整库 AES-256-GCM 加密打包 |

### 5.2 安全约束

- 导出操作必须经过 Tauri 确认对话框
- 加密导出需设置密码（.Argon2 派生）
- 导出操作记录审计日志
- 大于 10MB 的导出提醒用户存储空间

---

## 6. 异常数据处理

### 6.1 脏数据检测

通过 `dirtyDataTracker.ts` 检测的异常类型：

| 类型 | 严重度 | 处理方式 |
|------|-------|---------|
| ORPHAN_REFERENCE | medium | 提示用户修复或自动删除 |
| CONSTRAINT_VIOLATION | high | 立即修复或重建记录 |
| DATA_TYPE_MISMATCH | high | 自动修复（JSON parse → null → 默认值） |
| BUSINESS_RULE_VIOLATION | low | 自动修正（如 clamp 到有效范围） |
| DUPLICATE_ENTRY | critical | 数据库级冲突，需人工介入 |
| INCONSISTENT_STATE | medium | 标记并日志记录 |

### 6.2 迁移失败处理

`schema_migration_log` 记录的迁移失败处理流程：

1. 应用启动时检查 `getUnresolvedFailures()`
2. 有未解决失败 → 显示 Toast 提示「数据库迁移遇到问题」
3. 用户可点击查看详情或一键重试
4. 超过 3 次重试失败 → 提示用户联系开发者或重置数据库

---

## 7. 监控与告警

### 7.1 监控指标

| 指标 | 数据来源 | 告警阈值 | 处理方式 |
|------|---------|---------|---------|
| 僵尸数据占比 | `zombieDataReport()` | > 10% 总条目 | 自动触发清理 |
| 脏数据新增 | `dirtyDataTracker` | 任何 `high`/`critical` | Toast + 审计日志 |
| 迁移失败 | `schemaRunner` | 任何未解决 | 启动弹窗 |
| 数据库大小 | SQLite `pragma_page_count` | > 500MB | 提示用户清理 |
| 审计日志增长 | `audit_log` 表 | > 10MB | 自动归档压缩 |

### 7.2 健康检查入口

```typescript
// 应用启动时的健康检查流程
async function dataHealthCheck() {
  const [zombieReport, migrationFailures, dirtyDataSummary] = await Promise.all([
    getZombieDataReport(),
    getUnresolvedFailures(),
    getDirtyDataSummary(),
  ])
  
  // 高优先级问题弹窗提醒
  if (migrationFailures.length > 0 || dirtyDataSummary.highestSeverity === 'critical') {
    showDataQualityWarning(...)
  }
}
```

---

## 8. 变更记录

| 版本 | 日期 | 变更内容 |
|------|------|---------|
| v1.0 | 2026-08-27 | 初始版本，涵盖核心数据生命周期策略 |

---

## 附录：相关模块索引

| 模块 | 职责 | 是否已实现 |
|------|------|:---------:|
| `src/lib/migrations/schemaRunner.ts` | Schema 版本迁移（含失败持久化） | ✅ |
| `src/lib/migrations/v002_add_schema_tracking.ts` | 迁移追踪基础设施 | ✅ |
| `src/lib/migrations/v003_add_dirty_data_registry.ts` | 脏数据注册表 | ✅ |
| `src/lib/dirtyDataTracker.ts` | 脏数据检测与告警 | ✅ |
| `src/lib/zombieDataCleanup.ts` | 僵尸数据自动清理 | ✅ |
| `src/lib/auditLogger.ts` | 审计日志记录 | ✅ |
| `src/lib/dataManager.ts` | 数据导入导出 | ✅ |
| Rust `clean_audit_logs` | 审计日志清理（后端） | ⏳ 待实现 |

---

> **注意**：本策略文档定义了数据治理的**意图和规范**，具体实现需保持同步。任何 Data Schema 的变更都应同时更新本文档。
