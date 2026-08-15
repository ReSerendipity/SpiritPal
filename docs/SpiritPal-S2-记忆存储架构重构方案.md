# SpiritPal 记忆存储架构重构（S2）立项方案

> 文档编号：S2-PLAN-001
> 版本：v0.1（待评审）
> 日期：2026-08-14
> 来源：SpiritPal 记忆系统第五轮评估报告 · 附录「遗留说明」——S2（消灭双轨存储、行级写入、库级加密替代每值加密）
> 状态：**方案待评审，未开工**（按最小改动原则，先出方案、确认范围后再实施）

---

## 一、背景与目标

### 1.1 现状问题（量化）

记忆数据当前是"双轨制"，同一份数据存在两处：

| 轨道 | 位置 | 内容 | 写入成本 |
|------|------|------|---------|
| A：整包 JSON blob | `settings` 表 `spiritpal-enhanced-memory-<char>` | working/episodic/semantic/autobiographical 四层全量 | 任何一条记忆变动 → 全量 `JSON.stringify` → PBKDF2(100k 次) → AES-GCM → 整行覆写 |
| B：行级镜像 | `memories` 表 | 仅 `content`(=user 文本) + embedding + importance | 行级 INSERT（快），但仅用于向量检索 |

由此产生三个硬伤：

1. **写放大**：每轮对话后 1 条新记忆 + N 处状态变动（accessCount/lastAccessed/strength/decayFactor），全部触发轨道 A 的全量重加密。记忆量 1000 条时，一次保存序列化约 200-400KB 文本并做一次 PBKDF2+AES，性能随总量线性恶化。
2. **双写不一致风险**：轨道 A 与 B 各自落盘，`memories` 行只有 user 文本，assistant 回复、情感字段、strength 等**全部只存在于 blob**；任何一处漏同步（如崩溃于两次写之间）都会造成两侧数据分叉。
3. **结构性限制**：由于运行时状态是一坨 blob，无法做 SQL 级查询/筛选/统计；`semanticMemory` 摘要、触发状态（triggerLog/ignoreCount/lastChatDate/injectedAt）也全挤在 blob 里，粒度不可控。

### 1.2 目标

- **消灭双轨**：`settings` 中的记忆 blob 退役为纯导出/备份格式，运行时状态全部落表。
- **行级写入**：记忆增删改走 SQLite 行级操作，O(1) 更新，不再全量重加密。
- **加密策略重构**：每值加密（per-value PBKDF2）退役，改由**加固后的库级 at-rest 加密**兜底（运行时明文、退出加密，与 SQLCipher 思路一致但实现更轻）。
- **对外 API 零破坏**：`EnhancedMemoryManager` 的公开方法签名（getAllMemories / getContextForChat / export / import / retrieve 等）全部不变，UI 层无感知。

### 1.3 非目标（明确不做）

- 不引入 SQLCipher / 页面级加密（需替换整个 SQLite 插件链，风险过大，另立项目评估）。
- 不做记忆可视化时间线、SQL 全文检索等新功能（属 Phase 3 功能项）。
- 不做多设备云同步（WebDAV 已有独立方案）。

---

## 二、目标架构

```
┌────────────────────────────────────────────────────────────┐
│  运行时（内存）                                             │
│  EnhancedMemoryManager 四层数组（现有逻辑全部保留）           │
│  working / episodic / autobiographical / semanticSummary     │
└──────────────┬─────────────────────────────────────────────┘
               │ 行级 CRUD（新增/更新/删除/晋升/巩固/合并）
               ▼
┌────────────────────────────────────────────────────────────┐
│  SQLite（spiritpal.db）                                     │
│  memories 表（扩列后）← 四层记忆行                          │
│  memory_summaries 表（新）← semantic 摘要                   │
│  memory_state 表（新）← 触发状态/冷却/lastChatDate（明文）   │
│  commitments / context_episodes（已存在，不动）             │
└──────────────┬─────────────────────────────────────────────┘
               │ 运行时明文，退出时整体加密
               ▼
┌────────────────────────────────────────────────────────────┐
│  库级 at-rest 加密（加固版，见 §5）                          │
│  spiritpal.db → WAL checkpoint → 原子加密 → spiritpal.db.enc │
└────────────────────────────────────────────────────────────┘
```

### 2.1 为什么运行时明文可接受

- 本应用是**本地单用户**桌面/移动应用，威胁模型是"磁盘被离线读取/备份文件泄露"，不是"运行中的多租户隔离"。运行时明文与 SQLCipher 的做法一致（SQLCipher 解密后也是运行时明文）。
- 敏感数据（对话/画像）在**内存**中本来就必须明文供 LLM 使用；at-rest 加密解决的是"关机后磁盘上的字节"这一层。
- 移动端（iOS 沙箱 / Android 私有目录）系统本身提供文件级隔离，at-rest 加密优先级低（见 §10 开放决策 D3）。

---

## 三、数据模型设计

### 3.1 `memories` 表扩列（幂等迁移）

```sql
-- M1 迁移（db.ts initDB 中追加，沿用 memories.embedding 的 ALTER 先例）
ALTER TABLE memories ADD COLUMN memory_id TEXT;          -- 前端 generateId 的 id（行级化后不再依赖 dbId 隐式关联）
ALTER TABLE memories ADD COLUMN assistant TEXT DEFAULT '';
ALTER TABLE memories ADD COLUMN category TEXT DEFAULT '日常';
ALTER TABLE memories ADD COLUMN tags TEXT DEFAULT '[]';              -- JSON 数组
ALTER TABLE memories ADD COLUMN emotional_intensity REAL DEFAULT 0;
ALTER TABLE memories ADD COLUMN emotional_valence REAL DEFAULT 0;
ALTER TABLE memories ADD COLUMN emotional_arousal REAL DEFAULT 0.3;
ALTER TABLE memories ADD COLUMN strength REAL DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN decay_factor REAL DEFAULT 1.0;
ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN source_kind TEXT DEFAULT 'exchange'; -- exchange/observation/consolidation/user_teach/fact
ALTER TABLE memories ADD COLUMN fact_text TEXT;
ALTER TABLE memories ADD COLUMN is_autobiographical INTEGER DEFAULT 0;
ALTER TABLE memories ADD COLUMN tier TEXT DEFAULT 'episodic';        -- working/episodic/autobiographical
ALTER TABLE memories ADD COLUMN superseded_by INTEGER;               -- 软删除/被更新指针（冲突解决预留）

CREATE INDEX IF NOT EXISTS idx_memories_memory_id ON memories(memory_id);
CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier);
```

### 3.2 新增表

```sql
CREATE TABLE IF NOT EXISTS memory_summaries (   -- semantic 层：按角色一行，多摘要追加
  character_id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_state (       -- 触发状态/冷却等轻量状态（非敏感，明文）
  character_id TEXT PRIMARY KEY,
  last_chat_date TEXT,
  trigger_log TEXT DEFAULT '[]',
  ignore_count TEXT DEFAULT '{}',
  last_periodic_fire_date TEXT DEFAULT '{}',
  injected_at TEXT DEFAULT '{}',                -- Map<id, timestamp> 序列化
  llm_reassessed_ids TEXT DEFAULT '[]'
);
```

### 3.3 层 ↔ 行映射规则

| 内存层 | 行存储 | 说明 |
|--------|--------|------|
| working（最近 5 条） | `tier='working'` | 溢出到 episodic 时 UPDATE tier |
| episodic | `tier='episodic'` | 压缩/遗忘/巩固/合并删除时 DELETE 行 |
| autobiographical | `tier='autobiographical'`（+ is_autobiographical=1） | 晋升/降级时 UPDATE tier |
| semantic（摘要字符串） | `memory_summaries.summary` 追加 | 2000/5000 字符截断逻辑保留，作用于 summary 文本 |
| 触发状态 | `memory_state` | 与加密无关的明文 |

---

## 四、迁移策略（存量数据）

### 4.1 迁移流程（M1，幂等 + 可回滚）

```
启动时检测 settings 中迁移标记 spiritpal-memory-migrated-v2 == '1'？
 ├─ 否：执行迁移
 │   1. 读取旧 blob（兼容 ENC1:/ENC2: 解密，复用现有 load 逻辑）
 │   2. BEGIN TRANSACTION
 │   3. 逐条 INSERT memories（写 memory_id=旧 id，保留 dbId 关联旧 embedding 行 → 用 memory_id 重挂 embedding）
 │   4. INSERT memory_summaries（semanticMemory）
 │   5. INSERT memory_state（触发状态）
 │   6. 旧 blob 副本写入 settings.spiritpal-enhanced-memory-<char>.legacy（保留，不删除）
 │   7. COMMIT；写迁移标记
 │   失败 → ROLLBACK，旧 blob 原样保留，回退旧路径（双模式兼容窗口见 §4.2）
 ├─ 是：正常运行（行级路径）
```

### 4.2 双模式兼容窗口（迁移后保留 1 个版本）

- 迁移完成后，`load()` 改为：**优先读行**；若 `memories` 表为空且存在旧 blob → 回退旧路径（兼容"迁移标记丢失但 blob 还在"的极端情况）。
- `export()/import()`：导出从行组装（不读 blob）；导入时同时写行与 `.legacy` blob（保持备份文件与旧版本兼容）。
- 回滚开关：`settings.spiritpal-memory-use-legacy = '1'` 可强制回旧路径（紧急逃生口，正常不使用）。

### 4.3 embedding 迁移要点

现状 embedding 挂在 `memories.rowid`（dbId）。行级化后：
- 新写入：`INSERT` 拿到 rowid 后 `UPDATE memories SET embedding`（沿用现有 `saveEmbedding`）。
- 迁移：旧 blob 中每条记忆的 `memory.dbId` 与旧行 rowid 一一对应 → 迁移时**按原 rowid 更新 `memory_id` 列**，embedding 天然保留，无需重算（避免一次性重算 1000 条 embedding 的启动卡顿）。

---

## 五、加密策略改造（前置项，M0）

现状 at-rest 加密存在 4 个问题，S2 必须先修（否则"per-value 退役 + 依赖 at-rest"不成立）：

| # | 问题 | 位置 | 修法 |
|---|------|------|------|
| E1 | **WAL 不处理**：只加密 `spiritpal.db`，WAL 里的最新数据被漏掉；删除明文后残留 `-wal/-shm` 明文文件 | `encrypted_db.rs` | 加密前 `PRAGMA wal_checkpoint(TRUNCATE)` 合并 WAL → 删除 `-wal/-shm` → 再加密主库 |
| E2 | **非原子**：先写 `.enc` 再删 `.db`，中途崩溃会留下双份/半份 | `encrypted_db.rs` | 先写临时文件 `spiritpal.db.enc.tmp` → `rename` 原子替换 → 再删明文；解密同理 |
| E3 | **退出时机不可靠**：`beforeunload` 异步 best-effort | `db.ts:122-128` | 改由 Rust 侧 `RunEvent::ExitRequested` 同步执行 `encrypt_db_at_rest`（先 `db.close()` 再加密），前端 beforeunload 仅作兜底 |
| E4 | **大文件全量内存加密**：读全文件 → base64 → 加密，100MB DB 峰值内存约 400MB | `encrypted_db.rs` | 分块流式 AES-GCM（aes-gcm crate 的 `Encryptor` 支持增量）；本轮可先接受（DB 预估 <50MB），列为优化项 |

完成 E1-E3 后，per-value 加密即可安全退役：

```
现状：每条记忆写盘 = JSON.stringify(全量) → encrypt_data(PBKDF2+AES) → 写 settings 行
目标：每条记忆写盘 = INSERT/UPDATE memories 行（明文）→ 退出时统一 encrypt_db_at_rest
```

> 说明：`memory_state`（触发状态/冷却）非敏感，明文存储；`memory_summaries` 含对话摘要，属敏感，受库级 at-rest 加密保护（与旧 blob 的加密等级一致——旧 blob 也是退出后由同一套 at-rest 机制加密）。

---

## 六、代码改造清单（按文件）

| 文件 | 改动 | 里程碑 |
|------|------|:------:|
| `src-tauri/src/encrypted_db.rs` | E1 WAL checkpoint + E2 原子写 + 流式加密（可选） | M0 |
| `src-tauri/src/lib.rs` | `RunEvent::ExitRequested` 注册退出加密；关闭时先 `db.close()` | M0 |
| `src/lib/db.ts` | initDB 追加 3.1/3.2 的 DDL 与幂等迁移；新增 `updateMemoryRow`/`upsertSummary`/`memoryState` CRUD；`addMemory` 扩展字段 | M1 |
| `src/lib/memoryMigrator.ts`（新） | §4.1 迁移任务（解密旧 blob → 事务插行 → 标记 → 回滚） | M1 |
| `src/lib/enhancedMemory.ts` | `load()` 改读行（优先）+ 旧 blob 回退；`doSave` 退役为仅写 `memory_state`；`addExchange/applyForgetting/applyPromotion/applyConsolidation/mergeSimilarMemories/deleteMemory/clear` 落库点改行级 | M2 |
| `src/lib/enhancedMemory.ts` | `export()/import()` 改为行组装/解析（签名不变） | M3 |
| `src/lib/ownerFacts.ts` / `petExperience.ts` / `visualMemoryManager.ts` / `entityLinking.ts` | **二期**（见 §10 决策 D1），本期不动 | 二期 |
| `src/lib/__tests__/*` | 新增：迁移往返、行级 CRUD、加密退役后无 per-value 残留、导出/导入兼容 | M4 |

---

## 七、性能收益（预期）

| 指标 | 现状 | 目标 |
|------|------|------|
| 单条记忆写入耗时（记忆量 1000+） | 全量序列化 + PBKDF2 100k + AES ≈ 数十~数百 ms | 行级 INSERT/UPDATE < 5ms |
| 保存开销随记忆量增长 | 线性恶化 | 恒定（O(1)） |
| 退出加密耗时 | 全文件 base64+AES（含 WAL 遗漏风险） | checkpoint 后分块加密，数据完整性有保障 |
| 启动加载 | 全量 blob 解密 + JSON.parse | 全量行 SELECT（量级相当，语义更清晰） |

---

## 八、风险清单与缓解

| 风险 | 等级 | 缓解 |
|------|:----:|------|
| WAL 残留导致加密后丢最新数据 | P0 | M0 强制 `wal_checkpoint(TRUNCATE)` + 删除 -wal/-shm，加密前后校验文件哈希 |
| 迁移中断造成数据双写不一致 | P0 | 单事务迁移 + 迁移标记 + `.legacy` blob 保留 + 双模式回退开关 |
| 迁移后 embedding 关联丢失（重算卡启动） | P1 | 按旧 rowid 原地挂 memory_id，不重算；迁移标记内记录 embedding 行数对账 |
| 退出加密在移动端/异常退出不可靠 | P1 | 移动端依赖系统沙箱（D3 决策）；桌面端 RunEvent 兜底 + 启动时检测残留明文并补加密 |
| 行级化后 `semanticMemory` 截断逻辑（2000/5000）回归 | P2 | 迁移时逐字符验证摘要长度；既有单测覆盖截断路径 |
| 公开 API 行为漂移（UI 无感要求） | P1 | export/import/getAllMemories 等签名不变 + 既有 239 例记忆测试全量回归 |

---

## 九、测试计划

| 层 | 用例 | 里程碑 |
|----|------|:------:|
| Rust 单测 | at-rest 加密往返（含 WAL 文件不存在/存在两种）、原子替换失败注入、损坏 .enc 解密报错 | M0 |
| 前端单测 | 迁移：空库/ENC1 旧库/ENC2 旧库/已有部分行四种场景；行级 CRUD 往返；双模式回退；export/import 兼容旧备份文件 | M1-M3 |
| 集成 | 迁移后 memory_id ↔ embedding 对账；`*.corrupt` 保留逻辑在新路径下仍生效 | M2 |
| 性能 | 1000 条记忆下写入耗时基准（对比改造前）；退出加密耗时 | M5 |
| 全量回归 | `vitest` 全量 + `tsc --noEmit` + `eslint` + `cargo test` | M5 |
| 手工验收 | 跑真实构建（`npx tauri build`），连续对话 → 重启 → 记忆完整；检查磁盘无 `*.db-wal` 明文残留 | M5 |

---

## 十、开放决策点（需确认）

| # | 决策 | 选项 | 推荐 |
|---|------|------|:----:|
| D1 | 迁移范围 | A. 仅 `enhancedMemory` 四层（ownerFacts 等二期）<br>B. 一期全部（含画像/经历/视觉/实体 4 个 blob） | **A**（先主链路，二期各模块独立小步迁移，风险最小） |
| D2 | 每值加密退役方式 | A. 直接删除 encrypt_data 调用（运行时明文，依赖 at-rest）<br>B. 保留加密开关（设置项"加强加密"），默认关 | **A**（E1-E3 加固完成后可安全退役；保留 B 作为企业需求预留，代码上留一行开关位） |
| D3 | 移动端 at-rest | A. 移动端跳过加密（依赖系统沙箱）<br>B. 与桌面一致 | **A**（移动端退出时机不可靠，且沙箱已隔离） |
| D4 | 迁移完成后的旧 blob | A. 保留 `.legacy` 一份（可回滚）<br>B. 一个版本后自动清理 | **A**（静默保留，占用可忽略；清理动作由用户在设置页手动触发） |

---

## 十一、实施路线图（里程碑 + 工作量）

| 里程碑 | 内容 | 工作量 | 验收 |
|:------:|------|:------:|------|
| M0 | at-rest 加固：WAL checkpoint + 原子写 + RunEvent 退出时机 | 1-2 人天 | 加密后磁盘无 -wal/-shm；异常退出不丢数据 |
| M1 | DDL 扩列 + 新表 + 迁移任务 + 双模式回退开关 | 1 人天 | 三种存量库场景迁移往返通过 |
| M2 | 写入路径行级化（addExchange/遗忘/晋升/巩固/合并/删除/清空） | 1-2 人天 | 单条写入不再触发全量重加密；对账无孤儿行 |
| M3 | 读取路径改造 + export/import 兼容 | 1 人天 | UI 无感，备份文件可被旧版本导入 |
| M4 | per-value 加密退役 + 测试补全（迁移/CRUD/兼容/对账） | 1 人天 | 239 例记忆测试全绿 + 新增 ≥15 例 |
| M5 | 全量回归 + 性能基准 + 真实构建手工验收 | 1 人天 | 见 §9 |

**合计约 6-8 人天**，每里程碑独立可验收、可回滚（双模式开关兜底）。

---

*本方案待评审。确认 D1-D4 决策后按里程碑推进；任何里程碑改动超出范围时暂停并重新评审。*

---

## 附：S2 实施完成核对（2026-08-14 晚）

方案评审通过后已按里程碑全部落地，逐项核对结果：

| 里程碑 | 核对结论 | 关键证据 |
|:------:|:--------:|---------|
| M0 at-rest 加固 | ✅ 完成 | `encrypted_db.rs`：`cleanup_wal_files`（删 -wal/-shm）+ `atomic_write`（.tmp→rename）；前端 `encryptDatabaseAtRest` 先 `PRAGMA wal_checkpoint(TRUNCATE)` 再关闭连接；`lib.rs` `RunEvent::ExitRequested` 同步加密，`beforeunload` 兜底；新增 Rust 测试 8 例 |
| M1 表结构 + 迁移器 | ✅ 完成 | `db.ts` 幂等扩列 13 列（memory_id/assistant/category/tags/emotional_*/strength/tier/source_kind 等）+ 索引；新增 `memory_summaries`/`memory_state` 表；`memoryMigrator.ts`（事务迁移、.legacy 备份、迁移标记、legacy 逃生口） |
| M2 行级写入 | ✅ 完成 | `addExchange→insertMemoryRow` 全字段；溢出 `updateMemoryRow({tier})`；strength 行更新；`doSave` 行级路径仅写 state+summary |
| M3 读取 + 兼容 | ✅ 完成 | `loadFromRows`（三层+摘要+状态）+ 失败回退 blob；`export/import` 保持签名兼容 |
| M4 每值加密退役 | ✅ 完成（按 D1-A） | 主路径不再 `encrypt_data`，仅 legacy 回退路径保留；ownerFacts/petExperience/visualMemoryManager/entityLinking 留二期（各仍 1 处 encrypt_data） |
| M5 回归 | ✅ 完成（第二轮补全） | vitest 61 文件 / 1494 通过 / 7 跳过 / 0 失败；cargo 55 通过 / 0 失败；`tsc --noEmit` 0 错误；eslint 0 错误（2 warning，均为预先存在） |

**第二轮补全（2026-08-15）**：
- ✅ 清理 `enhancedMemory.ts` 未使用导入（`deleteMemorySummary`/`deleteMemoryState`/`FESTIVALS`）
- ✅ 补全测试计划 §9 全部用例：迁移 4 场景（空库/ENC1/ENC2/已有部分行）、双模式回退、export/import 兼容、memory_id↔embedding 对账、corrupt 保留逻辑、行级 load/save 路径、applyForgetting/applyPromotion 行级化验证 — 共 32 例全绿
- ✅ 全量回归：vitest 1494 通过 / tsc 0 错误 / eslint 0 错误 / cargo test 55 通过

**剩余待办**：真实构建手工验收（`npx tauri build` → 连续对话 → 重启验证记忆完整；检查 `app_data_dir` 无 `*.db-wal` 明文残留、仅有 `spiritpal.db.enc`）；二期迁移（ownerFacts 等四模块）。
