# SpiritPal 数据字典

> **版本**：v1.0  
> **创建日期**：2026-08-27  
> **维护者**：数据治理改进项目  
> **数据来源**：src/lib/db.ts 内嵌 DDL + src/lib/types.ts 类型定义  
> **同步状态**：与 v0.1.0 数据库 Schema 一致

---

## 1. 概述

本文档定义 SpiritPal 应用所有持久化数据的**字段语义、类型约束、默认值和业务规则**。数据字典是数据治理体系的核心参考文档，用于：

- 统一团队对字段语义的理解，消除同名不同义问题
- 为数据质量校验提供约束基准
- 为 Schema 变更评审提供影响分析依据
- 为新开发者提供数据模型参考

### 1.1 存储引擎

| 项目 | 说明 |
|------|------|
| 数据库 | SQLite 3.x (via tauri-plugin-sql) |
| 文件路径 | `$APPDATA/spiritpal.db` |
| 加密方式 | 文件级 AES-256-GCM (encrypted_db.rs) |
| WAL 模式 | 已启用 (journal_mode=WAL) |
| 外键约束 | PRAGMA foreign_keys=ON（但表定义中显式 FK 声明较少） |

### 1.2 Schema 版本管理

| 版本 | 日期 | 变更说明 |
|------|------|---------|
| v0.1 | 2026-08-10 | 初始 13 张表（characters/settings/memories/mods/inventory/schedules 等） |
| v0.2 | 2026-08-15 | memories 表扩列（16 列→21+ 列，行级化迁移）；新增 memory_sums/memory_state/memory_semantic_facts |
| v0.3 | 2026-08-20 | 新增 owner_facts/pet_experiences/visual_memories/entity_nodes 表（行级化迁移） |
| v0.4 | 2026-08-24 | 新增 commitments/context_episodes 表（第四面墙 + 现实感知） |

---

## 2. 表结构详解

### 2.1 characters — 角色养成数据

**业务含义**：存储每个宠物角色的养成数值（饱食度/心情/健康/亲密度等），以 JSON blob 整体存取。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| id | TEXT | PRIMARY KEY | — | 角色唯一标识（如 "miko-001"） |
| stats | TEXT | NOT NULL | — | JSON 字符串，包含 NurturingStats 结构 |
| updated_at | INTEGER | NOT NULL | — | 最后更新时间戳（毫秒） |

**stats JSON 结构参考**（详见 types.ts → NurturingStats）：
```json
{
  "hunger": 80,        // 饱食度 0-100
  "mood": 70,          // 心情 0-100
  "health": 90,        // 健康 0-100
  "affection": 500,    // 亲密度 0-9999
  "level": 5,          // 等级 1-256
  "experience": 1200,  // 经验值
  "coins": 350         // 金币
}
```

---

### 2.2 settings — 全局设置

**业务含义**：Key-Value 形式存储全局配置和 Zustand store 持久化 blob。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| key | TEXT | PRIMARY KEY | — | 设置项键名（如 "spiritpal-settings-store"、"spiritpal-enhanced-memory-miko-001"） |
| value | TEXT | NOT NULL | — | JSON 序列化的值 |

**常见 key 模式**：
- `spiritpal-settings-store`：主设置 Store 的持久化数据（已加密）
- `spiritpal-enhanced-memory-<charId>`：记忆系统 JSON blob（遗留，含 `.legacy` 后缀）
- `spiritpal-memory-migrated-v2`：迁移标记（布尔字符串）
- `spiritpal-owner-facts-migrated-v2`：迁移标记

---

### 2.3 memories — 记忆数据（核心）

**业务含义**：四层记忆系统（Working/Episodic/Semantic/Autobiographical）的行级存储核心表。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| id | INTEGER | PK AUTOINCREMENT | — | 数据库自增主键 |
| character_id | TEXT | NOT NULL | — | 关联角色 ID |
| type | TEXT | NOT NULL | — | 记忆类型：`immediate`/`short_term`/`long_term`/`core`（⚠️ 注意与 types.ts 的 MemoryType 定义不同） |
| content | TEXT | NOT NULL | — | 记忆文本内容 |
| importance | INTEGER | — | 50 | 重要度 0-100 |
| created_at | INTEGER | NOT NULL | — | 创建时间戳（毫秒） |
| last_accessed | INTEGER | NOT NULL | — | 最后访问时间戳（毫秒，用于记忆衰减计算） |
| embedding | BLOB | — | NULL | 向量嵌入（用于语义检索，维度由模型决定） |
| memory_id | TEXT | — | NULL | 前端生成的 UUID（行级化后与 dbId 分离） |
| assistant | TEXT | — | '' | AI 回复文本（对话记忆时使用） |
| category | TEXT | — | '日常' | 记忆分类（如 "日常"/"工作"/"爱好"） |
| tags | TEXT | — | '[]' | JSON 数组字符串，记忆标签列表 |
| emotional_intensity | REAL | — | 0.0 | 情感强度 0-1 |
| emotional_valence | REAL | — | 0.0 | 情感效价 -1（负向）到 1（正向） |
| emotional_arousal | REAL | — | 0.3 | 情感唤醒度 0-1 |
| strength | REAL | — | 1.0 | 记忆强度（影响遗忘曲线） |
| decay_factor | REAL | — | 1.0 | 衰减因子（UI 展示用，不参与实际衰减计算） |
| access_count | INTEGER | — | 0 | 被检索命中次数 |
| source_kind | TEXT | — | 'exchange' | 记忆来源：`exchange`/`vision`/`journal`/`autonomous` |
| fact_text | TEXT | — | NULL | LLM 提取的事实文本 |
| is_autobiographical | INTEGER | — | 0 | 是否为自传记忆（布尔：0/1） |
| tier | TEXT | — | 'episodic' | 记忆层级：`working`/`episodic`/`autobiographical` |
| superseded_by | INTEGER | — | NULL | 被更新的记忆 ID（软删除/版本链指针） |

**索引**：
- `idx_memories_memory_id`：memory_id 查找
- `idx_memories_tier`：按层级筛选
- `idx_memories_character`：按角色筛选
- `idx_memories_type`：按类型筛选
- `idx_memories_last_accessed`：按访问时间排序
- `idx_memories_importance`：按重要度排序
- `idx_memories_char_type`：复合索引（角色+类型）
- `idx_memories_char_type_acc`：复合索引（角色+类型+访问时间）

---

### 2.4 memory_summaries — 语义摘要

**业务含义**：按角色存储语义层摘要（Semantic 层聚合结果），每个角色一行。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| character_id | TEXT | PK | — | 关联角色 ID |
| summary | TEXT | NOT NULL | — | LLM 生成的语义摘要文本 |
| updated_at | INTEGER | NOT NULL | — | 摘要最后更新时间 |

---

### 2.5 memory_state — 触发状态

**业务含义**：记忆触发系统的运行时状态（冷却计数、上次触发时间等），明文存储（非敏感）。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| character_id | TEXT | PK | — | 关联角色 ID |
| last_chat_date | TEXT | — | NULL | 最后聊天日期（ISO 格式字符串） |
| trigger_log | TEXT | — | '[]' | JSON 数组，触发历史记录 |
| ignore_count | TEXT | — | '{}' | JSON 对象，各类触发的忽略计数 |
| last_periodic_fire_date | TEXT | — | '{}' | JSON 对象，各周期触发类型的上次触发日期 |
| injected_at | TEXT | — | '{}' | JSON 对象，上次注入上下文的时间 |
| llm_reassessed_ids | TEXT | — | '[]' | JSON 数组，LLM 重新评估过的记忆 ID |

---

### 2.6 memory_semantic_facts — 结构化语义事实

**业务含义**：从对话中提取的结构化事实（如 "用户喜欢咖啡"、"用户在美团工作"），用于 RAG 检索增强。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| id | INTEGER | PK AUTOINCREMENT | — | 自增主键 |
| character_id | TEXT | NOT NULL | — | 关联角色 ID |
| fact_key | TEXT | NOT NULL | — | 事实键名（如 "user_occupation"） |
| fact_value | TEXT | NOT NULL | — | 事实值（如 "软件工程师"） |
| source_memory_ids | TEXT | — | '[]' | JSON 数组，来源记忆 ID 列表 |
| importance | INTEGER | — | 50 | 事实重要度 0-100 |
| created_at | INTEGER | NOT NULL | — | 创建时间戳 |
| updated_at | INTEGER | NOT NULL | — | 更新时间戳 |
| is_autobiographical | INTEGER | — | 0 | 是否来自自传记忆 |

**索引**：
- `idx_semantic_facts_char`：按角色筛选
- `idx_semantic_facts_key`：复合唯一索引（角色+键名）
- `idx_semantic_facts_importance`：按重要度排序

---

### 2.7 owner_facts — 用户画像事实（双时间轴）

**业务含义**：结构化存储关于用户的认知事实（P1-5 双时间轴设计：valid_at/invalid_at）。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| id | INTEGER | PK AUTOINCREMENT | — | 自增主键 |
| character_id | TEXT | NOT NULL | — | 关联角色 ID（事实属于哪个角色的认知） |
| fact_id | TEXT | NOT NULL | — | 事实唯一 ID（UUID） |
| fact_key | TEXT | NOT NULL | — | 事实键名 |
| fact_value | TEXT | NOT NULL | — | 事实值 |
| source_memory_id | TEXT | — | NULL | 来源记忆 ID |
| confidence | REAL | — | 0.5 | 置信度 0-1 |
| updated_at | INTEGER | NOT NULL | — | 更新时间戳 |
| user_provided | INTEGER | — | 0 | 是否用户主动提供（布尔：0/1） |
| valid_at | INTEGER | — | NULL | 事实生效时间（毫秒时间戳，NULL=立即生效） |
| invalid_at | INTEGER | — | NULL | 事实失效时间（毫秒时间戳，NULL=当前有效） |
| superseded_by | INTEGER | — | NULL | 被哪个新事实取代（自引用外键） |

---

### 2.8 pet_experiences — 宠物共同经历

**业务含义**：记录宠物与用户共同经历的事件（如 "一起去公园"、"第一次对话"）。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| id | TEXT | PK | — | UUID 主键 |
| character_id | TEXT | NOT NULL | — | 关联角色 ID |
| type | TEXT | NOT NULL | — | 事件类型（如 "milestone"/"daily"/"adventure"） |
| description | TEXT | NOT NULL | — | 事件描述文本 |
| timestamp | INTEGER | NOT NULL | — | 事件发生时间 |
| sentiment | TEXT | NOT NULL | 'neutral' | 情感倾向：`positive`/`negative`/`neutral` |
| intensity | REAL | NOT NULL | 0.5 | 强度 0-1 |

---

### 2.9 visual_memories — 视觉记忆

**业务含义**：通过"看看"功能截屏分析生成的视觉感知记忆。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| id | TEXT | PK | — | UUID 主键 |
| character_id | TEXT | NOT NULL | — | 关联角色 ID |
| type | TEXT | NOT NULL | — | 视觉记忆类型：`screenshot`/`analysis`/`observation` |
| description | TEXT | NOT NULL | — | LLM 生成的视觉描述 |
| image_path | TEXT | — | NULL | 截图文件路径（相对 app_data_dir） |
| timestamp | INTEGER | NOT NULL | — | 截屏时间 |
| sentiment | TEXT | NOT NULL | 'neutral' | 情感倾向 |
| related_memory_id | TEXT | — | NULL | 关联文本记忆 ID |

---

### 2.10 entity_nodes — 实体链接

**业务含义**：知识图谱中的实体节点（人、地点、物品、概念），用于实体关系检索。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| id | TEXT | PK | — | UUID 主键 |
| character_id | TEXT | NOT NULL | — | 关联角色 ID |
| name | TEXT | NOT NULL | — | 实体名称（如 "咖啡"/"北京"/"Doro"） |
| type | TEXT | NOT NULL | — | 实体类型：`person`/`place`/`item`/`concept`/`organization` |
| linked_memory_ids | TEXT | NOT NULL | '[]' | JSON 数组，关联记忆 ID 列表 |
| mention_count | INTEGER | NOT NULL | 0 | 被提及次数 |
| first_seen | INTEGER | NOT NULL | — | 首次出现时间 |
| last_seen | INTEGER | NOT NULL | — | 最后出现时间 |

---

### 2.11 mods — 模组数据

**业务含义**：已安装的第三方模组配置和元数据。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| id | TEXT | PK | — | 模组唯一 ID |
| name | TEXT | NOT NULL | — | 模组显示名 |
| version | TEXT | — | NULL | 模组版本号 |
| config | TEXT | NOT NULL | — | JSON 序列化的模组配置 |
| enabled | INTEGER | — | 1 | 是否启用（布尔：0/1） |
| installed_at | INTEGER | NOT NULL | — | 安装时间戳 |

---

### 2.12 inventory — 背包物品

**业务含义**：角色拥有的物品（食物、道具、装饰等）。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| id | TEXT | PK | — | 物品实例 UUID |
| item_id | TEXT | NOT NULL | — | 物品类型 ID（关联物品定义表） |
| quantity | INTEGER | NOT NULL | — | 物品数量 |
| character_id | TEXT | — | NULL | 所属角色（NULL=全局共享） |

---

### 2.13 schedules — 日程

**业务含义**：用户设置的定时提醒/任务。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| id | TEXT | PK | — | UUID 主键 |
| title | TEXT | NOT NULL | — | 日程标题 |
| time | INTEGER | NOT NULL | — | 提醒时间（毫秒时间戳） |
| repeat | TEXT | — | NULL | 重复规则：`daily`/`weekly`/`monthly`/`once`/`NULL` |
| completed | INTEGER | — | 0 | 是否已完成（布尔：0/1） |

---

### 2.14 commitments — 约定追踪

**业务含义**：第四面墙功能——宠物与用户之间的约定（"明天提醒我写周报"）。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| id | INTEGER | PK AUTOINCREMENT | — | 自增主键 |
| character_id | TEXT | NOT NULL | — | 关联角色 ID |
| content | TEXT | NOT NULL | — | 约定内容文本 |
| actor | TEXT | NOT NULL | — | 约定发起者：`pet`/`user`/`system` |
| due_at | INTEGER | — | NULL | 截止时间（毫秒时间戳，NULL=无截止） |
| status | TEXT | — | 'open' | 状态：`open`/`fulfilled`/`expired`/`cancelled` |
| source_memory_id | INTEGER | — | NULL | 来源记忆 ID |
| created_at | INTEGER | NOT NULL | — | 创建时间 |
| follow_up_count | INTEGER | — | 0 | 催办次数 |
| repeat | TEXT | — | NULL | 重复规则（如 "weekly"） |

---

### 2.15 context_episodes — 上下文快照

**业务含义**：现实感知功能——记录用户当前的活动状态（工作中/听音乐/空闲等）。

| 字段名 | 类型 | 约束 | 默认值 | 语义说明 |
|--------|------|------|--------|---------|
| id | INTEGER | PK AUTOINCREMENT | — | 自增主键 |
| character_id | TEXT | NOT NULL | — | 关联角色 ID |
| started_at | INTEGER | NOT NULL | — | 片段开始时间 |
| ended_at | INTEGER | — | NULL | 片段结束时间（NULL=进行中） |
| work_state | TEXT | — | NULL | 工作状态：`focused`/`meeting`/`idle`/`gaming`/`coding` |
| weather | TEXT | — | NULL | 天气（如 "sunny"/"rainy"） |
| idle_minutes | INTEGER | — | NULL | 空闲分钟数 |
| music | TEXT | — | NULL | 当前播放的音乐/歌曲名 |
| summary | TEXT | — | NULL | LLM 生成的片段摘要 |

---

## 3. 类型对照表

### 3.1 TypeScript ↔ SQLite 类型映射

| TypeScript 类型 | SQLite 类型 | 说明 |
|----------------|-------------|------|
| `string` | TEXT | 直接存储 |
| `number` | INTEGER / REAL | 整数/浮点数 |
| `boolean` | INTEGER | 0/1 存储 |
| `Date` | INTEGER | 时间戳（毫秒） |
| `Array<T>` | TEXT | JSON.stringify 后存储 |
| `object` | TEXT | JSON.stringify 后存储 |
| `Uint8Array` | BLOB | 二进制数据（如 embedding） |

### 3.2 同名异义字段警示 ⚠️

| 字段名 | 所在表 | 语义 A | 语义 B | 风险 |
|--------|--------|--------|--------|------|
| `type` | memories | `immediate`/`short_term`/`long_term`/`core`（记忆层级） | types.ts 的 `MemoryType`：`text`/`voice`/`image`/`mixed`（多模态类型） | 命名重叠，理解歧义 |
| `type` | entity_nodes | person/place/item/concept | — | 不同枚举值，需上下文区分 |
| `type` | pet_experiences | milestone/daily/adventure | — | 不同枚举值，需上下文区分 |
| `type` | visual_memories | screenshot/analysis/observation | — | 不同枚举值，需上下文区分 |

**建议**：后续 Schema 演进时，将 memories.type 重命名为 `tier` 或 `memory_tier`，消除歧义。

---

## 4. 索引清单

| 索引名 | 表 | 字段 | 用途 |
|--------|-----|------|------|
| idx_memories_character | memories | character_id | 按角色筛选记忆 |
| idx_memories_type | memories | type | 按类型筛选记忆 |
| idx_memories_last_accessed | memories | last_accessed | 时间衰减排序 |
| idx_memories_importance | memories | importance | 重要度排序 |
| idx_memories_char_type | memories | character_id, type | 复合条件查询 |
| idx_memories_char_type_acc | memories | character_id, type, last_accessed | 常见多条件查询 |
| idx_memories_memory_id | memories | memory_id | 前端 ID 查找 |
| idx_memories_tier | memories | tier | 按层级筛选 |
| idx_semantic_facts_char | memory_semantic_facts | character_id | 按角色筛选 |
| idx_semantic_facts_key | memory_semantic_facts | character_id, fact_key | 唯一键查找 |
| idx_semantic_facts_importance | memory_semantic_facts | character_id, importance DESC | 重要度排序 |
| idx_owner_facts_char | owner_facts | character_id | 按角色筛选 |
| idx_owner_facts_char_key | owner_facts | character_id, fact_key | 唯一键 |
| idx_owner_facts_valid | owner_facts | valid_at | 生效时间范围查询 |
| idx_owner_facts_invalid | owner_facts | invalid_at | 失效时间范围查询 |
| idx_pet_experiences_char | pet_experiences | character_id | 按角色筛选 |
| idx_pet_experiences_ts | pet_experiences | character_id, timestamp | 时间排序 |
| idx_visual_memories_char | visual_memories | character_id | 按角色筛选 |
| idx_visual_memories_ts | visual_memories | character_id, timestamp | 时间排序 |
| idx_entity_nodes_char | entity_nodes | character_id | 按角色筛选 |
| idx_entity_nodes_char_name | entity_nodes | character_id, name | 实体名称唯一 |
| idx_inventory_char | inventory | character_id | 按角色筛选背包 |
| idx_commitments_char | commitments | character_id | 按角色筛选约定 |
| idx_commitments_status | commitments | status | 按状态筛选 |
| idx_commitments_due | commitments | due_at | 到期时间排序 |
| idx_context_episodes_char | context_episodes | character_id | 按角色筛选 |

---

## 5. 数据安全分类

| 安全级别 | 表 | 字段 | 存储方式 |
|---------|-----|------|---------|
| 🔴 高敏感 | memories | content, assistant | 文件级加密（AES-256-GCM） |
| 🔴 高敏感 | owner_facts | fact_value（如身份信息） | 文件级加密 |
| 🟡 中敏感 | settings | value（store blobs） | 已加密（ENC2 前缀） |
| 🟡 中敏感 | visual_memories | image_path | 文件级加密 |
| 🟢 低敏感 | memory_state | trigger_log, ignore_count | 明文（显式设计） |
| 🟢 低敏感 | context_episodes | work_state, music | 文件级加密（不敏感但统一加密） |
| 🟢 低敏感 | analytics（localStorage） | events | 已加密（R-14-lite v3.0） |

---

## 6. 数据生命周期策略

| 表 | 保留策略 | 清理触发条件 | 归档方式 |
|----|---------|-------------|---------|
| memories | 永久（受 access_count/strength 衰减影响） | 手动清理 / 应用重置 | 备份导出 |
| memory_summaries | 按角色永久 | 角色删除时级联清理 | 备份导出 |
| owner_facts | 永久（双时间轴，不删除仅标记 invalid_at） | 永不物理删除 | 备份导出 |
| pet_experiences | 永久 | 手动清理 | 备份导出 |
| visual_memories | 永久（image_path 指向的文件单独管理） | 手动清理 + 图片缓存上限 | 备份导出 |
| context_episodes | 滑动窗口（隐式，大量写入后旧数据被覆盖） | 无自动清理，依赖表大小 | 无 |
| analytics | 1000 条上限滑动窗口 | FIFO 自动淘汰 | 导出事件 |
| settings | 永久 | 永不过期 | 备份导出 |

---

## 7. 变更记录

| 版本 | 日期 | 变更内容 | 影响范围 |
|------|------|---------|---------|
| v1.0 | 2026-08-27 | 初始数据字典创建，覆盖 15 张表 | 全量 |

---

## 8. 后续改进项

| # | 改进项 | 优先级 | 目标状态 |
|---|--------|--------|---------|
| 1 | 将 memories.type 重命名为 memories.tier | 高 | 消除与 types.ts MemoryType 的歧义 |
| 2 | 添加显式 FOREIGN KEY 声明 | 中 | 启用 SQLite 级联完整性 |
| 3 | 僵尸 .legacy blob 自动清理 TTL | 中 | settings 表 .legacy 后缀数据 30 天后自动清除 |
| 4 | 上下文快照自动清理 | 低 | context_episodes 保留最近 7 天 |
| 5 | Schema 变更自动化校验 | 中 | 每次 DDL 变更对比数据字典，不一致则 CI 失败 |

---

## 附录：快速参考卡

```sql
-- 查看所有表
SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;

-- 查看表结构
PRAGMA table_info(memories);

-- 查看索引
SELECT name, tbl_name FROM sqlite_master WHERE type='index' ORDER BY tbl_name;

-- 查看表行数（近似）
SELECT 'tbl', COUNT(*) FROM tbl UNION ALL ...;

-- 手动清理过期上下文快照（未实现，参考用）
-- DELETE FROM context_episodes WHERE started_at < (strftime('%s','now','-7 days') * 1000);
```
