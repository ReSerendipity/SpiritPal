//! D-1: Rust 语义 SQL 命令层
//!
//! 将原前端 `plugin-sql` 直接执 SQL 的收口为 Rust 语义化命令（`sp_*` 前缀）：
//! - 所有语句为 Rust 侧**静态 SQL + 参数绑定**，杜绝字符串拼接注入；
//! - 前端只调命令不碰 SQL → capability 中可整体移除 `sql:*`；
//! - 表结构/迁移与 `src/lib/data/db.ts::initDB` 保持一致（幂等，兼容旧库）。
//!
//! # 连接管理
//! - 全局 `OnceLock<Mutex<Option<Connection>>>` 懒打开 `app_data_dir()/spiritpal.db`
//!   （与 `encrypted_db.rs` 同一路径锚点）；
//! - 打开时施加 WAL/性能 PRAGMA（等价 db.ts initDB:209-223）；
//! - `close()` 供 `encrypt_db_at_rest` / `restore_db_backup` 等文件级操作前释放锁。

use base64::Engine;
use rusqlite::types::Value as SqValue;
use rusqlite::{params_from_iter, Connection, OptionalExtension};
use serde_json::{json, Map, Value as JsonValue};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Manager};

/// 数据库文件名（与 encrypted_db.rs 同锚点：app_data_dir/spiritpal.db）
pub fn db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("获取数据目录失败: {e}"))?;
    Ok(dir.join("spiritpal.db"))
}

static DB: OnceLock<Mutex<Option<Connection>>> = OnceLock::new();

fn global() -> &'static Mutex<Option<Connection>> {
    DB.get_or_init(|| Mutex::new(None))
}

/// 打开连接并施加 PRAGMA + 幂等 schema（与 db.ts initDB 对齐）
fn open_conn(path: &std::path::Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| format!("打开数据库失败: {e}"))?;
    // ---- WAL / 性能 PRAGMA（db.ts initDB:209-223）----
    let _ = conn.pragma_update(None, "journal_mode", "WAL");
    let _ = conn.pragma_update(None, "synchronous", "NORMAL");
    let _ = conn.pragma_update(None, "busy_timeout", 5000i64);
    let _ = conn.pragma_update(None, "temp_store", "MEMORY");
    let _ = conn.pragma_update(None, "foreign_keys", "ON");
    let _ = conn.pragma_update(None, "wal_autocheckpoint", 2000i64);
    let _ = conn.pragma_update(None, "cache_size", -8000i64);
    let _ = conn.pragma_update(None, "mmap_size", 268_435_456_i64);
    ensure_schema(&conn)?;
    Ok(conn)
}

/// 在异步上下文内串行访问连接（懒打开 + 参数化执行）
pub async fn with_conn<R>(
    app: AppHandle,
    f: impl FnOnce(&mut Connection) -> Result<R, String> + Send + 'static,
) -> Result<R, String>
where
    R: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = global().lock().map_err(|_| "数据库锁被占用".to_string())?;
        if slot.is_none() {
            let path = db_path(&app)?;
            *slot = Some(open_conn(&path)?);
        }
        let conn = slot.as_mut().expect("connection slot not initialized");
        f(conn)
    })
    .await
    .map_err(|e| format!("数据库任务失败: {e}"))?
}

/// 关闭数据库连接（文件级操作前调用：加密/恢复），静默容错
pub fn close() {
    if let Ok(mut slot) = global().lock() {
        *slot = None;
        log::debug!("[sqlite] connection closed (file-level op)");
    }
}

// ============ 基础工具 ============

fn sq(s: &str) -> SqValue {
    SqValue::Text(s.to_string())
}
fn sqi(i: i64) -> SqValue {
    SqValue::Integer(i)
}
fn sqf(f: f64) -> SqValue {
    SqValue::Real(f)
}
fn sqn() -> SqValue {
    SqValue::Null
}

/// 文档助手：从 serde_json 取值（缺省返回 None）
fn gs(v: &JsonValue, k: &str) -> Option<String> {
    v.get(k).and_then(|x| x.as_str()).map(String::from)
}
fn gi(v: &JsonValue, k: &str) -> Option<i64> {
    v.get(k).and_then(|x| x.as_i64())
}
fn gf(v: &JsonValue, k: &str) -> Option<f64> {
    v.get(k).and_then(|x| x.as_f64())
}
fn gbool(v: &JsonValue, k: &str) -> Option<bool> {
    v.get(k).and_then(|x| x.as_bool())
}
fn json_or<T>(opt: Option<T>, default: T) -> T {
    opt.unwrap_or(default)
}

/// ValueRef → JsonValue（避免克隆 Value）
fn vref_to_json(v: &rusqlite::types::ValueRef) -> JsonValue {
    use rusqlite::types::ValueRef;
    match v {
        ValueRef::Null => JsonValue::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(r) => json!(r),
        ValueRef::Text(t) => JsonValue::String(String::from_utf8_lossy(t).into_owned()),
        // 兼容历史可能写入 BLOB 的 embedding 等列
        ValueRef::Blob(b) => JsonValue::String(base64::engine::general_purpose::STANDARD.encode(b)),
    }
}

/// 查询 → Vec<JsonValue>（按列名映射）
fn json_rows(conn: &Connection, sql: &str, params: &[SqValue]) -> Result<Vec<JsonValue>, String> {
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| format!("SQL 预编译失败: {e}"))?;
    let cols: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let rows = stmt
        .query_map(params_from_iter(params.iter().cloned()), |row| {
            let mut map = Map::new();
            for (i, c) in cols.iter().enumerate() {
                let j = match row.get_ref(i) {
                    Ok(vref) => vref_to_json(&vref),
                    Err(_) => JsonValue::Null,
                };
                map.insert(c.clone(), j);
            }
            Ok(JsonValue::Object(map))
        })
        .map_err(|e| format!("查询执行失败: {e}"))?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r.map_err(|e| format!("查询行读取失败: {e}"))?);
    }
    Ok(out)
}

fn exec(conn: &Connection, sql: &str, params: &[SqValue]) -> Result<usize, String> {
    conn.execute(sql, params_from_iter(params.iter().cloned()))
        .map_err(|e| format!("SQL 执行失败: {e}"))
}

/// 单值查询（可选）
fn scalar<T: rusqlite::types::FromSql>(
    conn: &Connection,
    sql: &str,
    params: &[SqValue],
) -> Result<Option<T>, String> {
    conn.query_row(sql, params_from_iter(params.iter().cloned()), |r| r.get(0))
        .optional()
        .map_err(|e| format!("标量查询失败: {e}"))
}

/// 列存在性（幂等迁移用；table 名为编译期常量，无注入面）
fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, String> {
    let sql = "SELECT 1 FROM pragma_table_info(?1) WHERE name = ?2";
    let exists: Option<i64> = scalar(conn, sql, &[sq(table), sq(column)])?;
    Ok(exists.is_some())
}

/// 幂等加列（列已存在则跳过）
fn ensure_column(conn: &Connection, table: &str, column: &str, ddl: &str) -> Result<(), String> {
    if column_exists(conn, table, column)? {
        return Ok(());
    }
    exec(conn, ddl, &[])?;
    log::debug!("[sqlite] migrated column {table}.{column}");
    Ok(())
}

// ============ Schema（幂等，与 db.ts initDB:229-553 对齐）============

fn ensure_schema(conn: &Connection) -> Result<(), String> {
    // 6 张核心表
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS characters (
          id TEXT PRIMARY KEY,
          stats TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )",
        &[],
    )?;
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL DEFAULT 0
        )",
        &[],
    )?;
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id TEXT NOT NULL,
          type TEXT NOT NULL,
          content TEXT NOT NULL,
          importance INTEGER DEFAULT 50,
          created_at INTEGER NOT NULL,
          last_accessed INTEGER NOT NULL,
          embedding BLOB
        )",
        &[],
    )?;
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS mods (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          version TEXT,
          config TEXT NOT NULL,
          enabled INTEGER DEFAULT 1,
          installed_at INTEGER NOT NULL
        )",
        &[],
    )?;
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS inventory (
          id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          quantity INTEGER NOT NULL,
          character_id TEXT REFERENCES characters(id) ON DELETE SET NULL
        )",
        &[],
    )?;
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS schedules (
          id TEXT PRIMARY KEY,
          title TEXT NOT NULL,
          time INTEGER NOT NULL,
          repeat TEXT,
          completed INTEGER DEFAULT 0
        )",
        &[],
    )?;

    // settings 兼容列
    ensure_column(
        conn,
        "settings",
        "updated_at",
        "ALTER TABLE settings ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0",
    )?;

    // memories 扩列（幂等）
    ensure_column(
        conn,
        "memories",
        "embedding",
        "ALTER TABLE memories ADD COLUMN embedding BLOB",
    )?;
    ensure_column(
        conn,
        "memories",
        "memory_id",
        "ALTER TABLE memories ADD COLUMN memory_id TEXT",
    )?;
    ensure_column(
        conn,
        "memories",
        "assistant",
        "ALTER TABLE memories ADD COLUMN assistant TEXT DEFAULT ''",
    )?;
    ensure_column(
        conn,
        "memories",
        "category",
        "ALTER TABLE memories ADD COLUMN category TEXT DEFAULT '日常'",
    )?;
    ensure_column(
        conn,
        "memories",
        "tags",
        "ALTER TABLE memories ADD COLUMN tags TEXT DEFAULT '[]'",
    )?;
    ensure_column(
        conn,
        "memories",
        "emotional_intensity",
        "ALTER TABLE memories ADD COLUMN emotional_intensity REAL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "memories",
        "emotional_valence",
        "ALTER TABLE memories ADD COLUMN emotional_valence REAL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "memories",
        "emotional_arousal",
        "ALTER TABLE memories ADD COLUMN emotional_arousal REAL DEFAULT 0.3",
    )?;
    ensure_column(
        conn,
        "memories",
        "strength",
        "ALTER TABLE memories ADD COLUMN strength REAL DEFAULT 1.0",
    )?;
    ensure_column(
        conn,
        "memories",
        "decay_factor",
        "ALTER TABLE memories ADD COLUMN decay_factor REAL DEFAULT 1.0",
    )?;
    ensure_column(
        conn,
        "memories",
        "access_count",
        "ALTER TABLE memories ADD COLUMN access_count INTEGER DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "memories",
        "source_kind",
        "ALTER TABLE memories ADD COLUMN source_kind TEXT DEFAULT 'exchange'",
    )?;
    ensure_column(
        conn,
        "memories",
        "fact_text",
        "ALTER TABLE memories ADD COLUMN fact_text TEXT",
    )?;
    ensure_column(
        conn,
        "memories",
        "is_autobiographical",
        "ALTER TABLE memories ADD COLUMN is_autobiographical INTEGER DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "memories",
        "tier",
        "ALTER TABLE memories ADD COLUMN tier TEXT DEFAULT 'episodic'",
    )?;
    ensure_column(
        conn,
        "memories",
        "superseded_by",
        "ALTER TABLE memories ADD COLUMN superseded_by INTEGER",
    )?;

    // 备注：created_at 列新建表已含（v2 建表即带）；极端旧库缺列则兜底
    ensure_column(
        conn,
        "memories",
        "created_at",
        "ALTER TABLE memories ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(
        conn,
        "memories",
        "last_accessed",
        "ALTER TABLE memories ADD COLUMN last_accessed INTEGER NOT NULL DEFAULT 0",
    )?;

    // 记忆索引
    for idx in [
        "CREATE INDEX IF NOT EXISTS idx_memories_memory_id ON memories(memory_id)",
        "CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier)",
        "CREATE INDEX IF NOT EXISTS idx_memories_character ON memories(character_id)",
        "CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)",
        "CREATE INDEX IF NOT EXISTS idx_memories_last_accessed ON memories(last_accessed)",
        "CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)",
        "CREATE INDEX IF NOT EXISTS idx_memories_char_type ON memories(character_id, type)",
        "CREATE INDEX IF NOT EXISTS idx_memories_char_type_acc ON memories(character_id, type, last_accessed)",
    ] {
        exec(conn, idx, &[])?;
    }

    // 语义记忆表
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS memory_summaries (
          character_id TEXT PRIMARY KEY,
          summary TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )",
        &[],
    )?;
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS memory_state (
          character_id TEXT PRIMARY KEY,
          last_chat_date TEXT,
          trigger_log TEXT DEFAULT '[]',
          ignore_count TEXT DEFAULT '{}',
          last_periodic_fire_date TEXT DEFAULT '{}',
          injected_at TEXT DEFAULT '{}',
          llm_reassessed_ids TEXT DEFAULT '[]'
        )",
        &[],
    )?;
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS memory_semantic_facts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id TEXT NOT NULL,
          fact_key TEXT NOT NULL,
          fact_value TEXT NOT NULL,
          source_memory_ids TEXT DEFAULT '[]',
          importance INTEGER DEFAULT 50,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          is_autobiographical INTEGER DEFAULT 0
        )",
        &[],
    )?;
    for idx in [
        // P3-7 修复：sp_sem_facts_upsert 的 ON CONFLICT(character_id, fact_key) 需要唯一约束支撑，
        // 否则语句编译期即失败——语义事实此前在生产环境一条都写不进去
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_facts_char_key ON memory_semantic_facts(character_id, fact_key)",
        "CREATE INDEX IF NOT EXISTS idx_semantic_facts_char ON memory_semantic_facts(character_id)",
        "CREATE INDEX IF NOT EXISTS idx_semantic_facts_key ON memory_semantic_facts(character_id, fact_key)",
        "CREATE INDEX IF NOT EXISTS idx_semantic_facts_importance ON memory_semantic_facts(character_id, importance DESC)",
    ] {
        exec(conn, idx, &[])?;
    }

    // 二期行级化表（owner_facts / pet_experiences / visual_memories / entity_nodes）
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS owner_facts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id TEXT NOT NULL,
          fact_id TEXT NOT NULL,
          fact_key TEXT NOT NULL,
          fact_value TEXT NOT NULL,
          source_memory_id TEXT,
          confidence REAL DEFAULT 0.5,
          updated_at INTEGER NOT NULL,
          user_provided INTEGER DEFAULT 0,
          valid_at INTEGER,
          invalid_at INTEGER,
          superseded_by INTEGER
        )",
        &[],
    )?;
    for idx in [
        "CREATE INDEX IF NOT EXISTS idx_owner_facts_char ON owner_facts(character_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_facts_char_key ON owner_facts(character_id, fact_key)",
        "CREATE INDEX IF NOT EXISTS idx_owner_facts_valid ON owner_facts(valid_at)",
        "CREATE INDEX IF NOT EXISTS idx_owner_facts_invalid ON owner_facts(invalid_at)",
    ] {
        exec(conn, idx, &[])?;
    }
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS pet_experiences (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL,
          type TEXT NOT NULL,
          description TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          sentiment TEXT NOT NULL DEFAULT 'neutral',
          intensity REAL NOT NULL DEFAULT 0.5
        )",
        &[],
    )?;
    for idx in [
        "CREATE INDEX IF NOT EXISTS idx_pet_experiences_char ON pet_experiences(character_id)",
        "CREATE INDEX IF NOT EXISTS idx_pet_experiences_ts ON pet_experiences(character_id, timestamp)",
    ] {
        exec(conn, idx, &[])?;
    }
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS visual_memories (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL,
          type TEXT NOT NULL,
          description TEXT NOT NULL,
          image_path TEXT,
          timestamp INTEGER NOT NULL,
          sentiment TEXT NOT NULL DEFAULT 'neutral',
          related_memory_id TEXT
        )",
        &[],
    )?;
    for idx in [
        "CREATE INDEX IF NOT EXISTS idx_visual_memories_char ON visual_memories(character_id)",
        "CREATE INDEX IF NOT EXISTS idx_visual_memories_ts ON visual_memories(character_id, timestamp)",
    ] {
        exec(conn, idx, &[])?;
    }
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS entity_nodes (
          id TEXT PRIMARY KEY,
          character_id TEXT NOT NULL,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          linked_memory_ids TEXT NOT NULL DEFAULT '[]',
          mention_count INTEGER NOT NULL DEFAULT 0,
          first_seen INTEGER NOT NULL,
          last_seen INTEGER NOT NULL
        )",
        &[],
    )?;
    for idx in [
        "CREATE INDEX IF NOT EXISTS idx_entity_nodes_char ON entity_nodes(character_id)",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_nodes_char_name ON entity_nodes(character_id, name)",
    ] {
        exec(conn, idx, &[])?;
    }

    // R2 约定与计划追踪 + R1 上下文快照
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS commitments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id TEXT NOT NULL,
          content TEXT NOT NULL,
          actor TEXT NOT NULL,
          due_at INTEGER,
          status TEXT DEFAULT 'open',
          source_memory_id INTEGER,
          created_at INTEGER NOT NULL,
          follow_up_count INTEGER DEFAULT 0,
          repeat TEXT
        )",
        &[],
    )?;
    ensure_column(
        conn,
        "commitments",
        "repeat",
        "ALTER TABLE commitments ADD COLUMN repeat TEXT",
    )?;
    for idx in [
        "CREATE INDEX IF NOT EXISTS idx_commitments_char ON commitments(character_id)",
        "CREATE INDEX IF NOT EXISTS idx_commitments_status ON commitments(status)",
        "CREATE INDEX IF NOT EXISTS idx_commitments_due ON commitments(due_at)",
    ] {
        exec(conn, idx, &[])?;
    }
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS context_episodes (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          character_id TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          ended_at INTEGER,
          work_state TEXT,
          weather TEXT,
          idle_minutes INTEGER,
          music TEXT,
          summary TEXT
        )",
        &[],
    )?;
    exec(
        conn,
        "CREATE INDEX IF NOT EXISTS idx_context_episodes_char ON context_episodes(character_id)",
        &[],
    )?;

    // dirty_data_registry —— 若旧库已有同语义表则兼容（v003 迁移由前端 schemaRunner 创建过）
    let _ = exec(
        conn,
        "CREATE TABLE IF NOT EXISTS dirty_data_registry (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL,
          target_id TEXT,
          payload TEXT,
          detected_at INTEGER NOT NULL,
          resolved_at INTEGER
        )",
        &[],
    );
    for idx in [
        "CREATE INDEX IF NOT EXISTS idx_dirty_kind ON dirty_data_registry(kind)",
        "CREATE INDEX IF NOT EXISTS idx_dirty_target ON dirty_data_registry(target_id)",
        "CREATE INDEX IF NOT EXISTS idx_dirty_resolved ON dirty_data_registry(resolved_at)",
    ] {
        let _ = exec(conn, idx, &[]);
    }

    // schema_versions / schema_migration_log —— schemaRunner（前端迁移标记 + 只读校验）用
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS schema_versions (
          version INTEGER PRIMARY KEY,
          description TEXT NOT NULL,
          applied_at INTEGER NOT NULL,
          sql_checksum TEXT NOT NULL
        )",
        &[],
    )?;
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS schema_migration_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version INTEGER NOT NULL,
          attempted_at INTEGER NOT NULL,
          error_message TEXT NOT NULL,
          sql_statement TEXT,
          resolved INTEGER DEFAULT 0,
          resolved_at INTEGER
        )",
        &[],
    )?;
    for idx in [
        "CREATE INDEX IF NOT EXISTS idx_migration_log_version ON schema_migration_log(version)",
        "CREATE INDEX IF NOT EXISTS idx_migration_log_resolved ON schema_migration_log(resolved)",
    ] {
        exec(conn, idx, &[])?;
    }

    // entityGraph（P1-4）两表：memory_entities / memory_entity_edges
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS memory_entities (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          memory_ids TEXT NOT NULL,
          embedding BLOB,
          created_at INTEGER NOT NULL
        )",
        &[],
    )?;
    for idx in [
        "CREATE INDEX IF NOT EXISTS idx_entities_name ON memory_entities(name)",
        "CREATE INDEX IF NOT EXISTS idx_entities_type ON memory_entities(type)",
    ] {
        exec(conn, idx, &[])?;
    }
    exec(
        conn,
        "CREATE TABLE IF NOT EXISTS memory_entity_edges (
          id TEXT PRIMARY KEY,
          entity_a TEXT NOT NULL,
          entity_b TEXT NOT NULL,
          weight REAL DEFAULT 1.0,
          cooccur_count INTEGER DEFAULT 1,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (entity_a) REFERENCES memory_entities(id),
          FOREIGN KEY (entity_b) REFERENCES memory_entities(id)
        )",
        &[],
    )?;
    for idx in [
        "CREATE INDEX IF NOT EXISTS idx_edges_a ON memory_entity_edges(entity_a)",
        "CREATE INDEX IF NOT EXISTS idx_edges_b ON memory_entity_edges(entity_b)",
    ] {
        exec(conn, idx, &[])?;
    }

    Ok(())
}

// ============ Tauri 命令（sp_* 语义化） ============

/// 确保 schema 就绪（前端 initDB 调用；等价原建表+迁移）
#[tauri::command]
pub async fn sp_db_migrate(app: AppHandle) -> Result<bool, String> {
    with_conn(app, |_| Ok(true)).await
}

// ---- settings ----

// 命令层与逻辑层的分层约定（D-1 可测化）：
// `sp_*` 只负责「拿到连接」（`with_conn` 需要 `AppHandle`，而 Tauri 把命令签名钉死为
// `AppHandle<Wry>`，测试里构造不出来），真正的 SQL 逻辑放在 `*_impl(conn, …)` 里，
// 由单元测试用内存库直接调用。改逻辑只改 impl，wrapper 保持一行转发。

#[tauri::command]
pub async fn sp_settings_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    with_conn(app, move |conn| sp_settings_get_impl(conn, &key)).await
}

fn sp_settings_get_impl(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    scalar(
        conn,
        "SELECT value FROM settings WHERE key = ?1",
        &[sq(key)],
    )
}

#[tauri::command]
pub async fn sp_settings_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    with_conn(app, move |conn| sp_settings_set_impl(conn, &key, &value)).await
}

fn sp_settings_set_impl(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    exec(
        conn,
        "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
        &[sq(key), sq(value), sqi(now)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_settings_remove(app: AppHandle, key: String) -> Result<(), String> {
    with_conn(app, move |conn| sp_settings_remove_impl(conn, &key)).await
}

fn sp_settings_remove_impl(conn: &Connection, key: &str) -> Result<(), String> {
    exec(conn, "DELETE FROM settings WHERE key = ?1", &[sq(key)])?;
    Ok(())
}

// ---- characters ----

#[tauri::command]
pub async fn sp_char_get_stats(
    app: AppHandle,
    character_id: String,
) -> Result<Option<String>, String> {
    with_conn(app, move |conn| sp_char_get_stats_impl(conn, &character_id)).await
}

fn sp_char_get_stats_impl(conn: &Connection, character_id: &str) -> Result<Option<String>, String> {
    scalar(
        conn,
        "SELECT stats FROM characters WHERE id = ?1",
        &[sq(character_id)],
    )
}

#[tauri::command]
pub async fn sp_char_save_stats(
    app: AppHandle,
    character_id: String,
    stats: String,
) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_char_save_stats_impl(conn, &character_id, &stats)
    })
    .await
}

fn sp_char_save_stats_impl(
    conn: &Connection,
    character_id: &str,
    stats: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    exec(
        conn,
        "INSERT INTO characters (id, stats, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(id) DO UPDATE SET stats = ?2, updated_at = ?3",
        &[sq(character_id), sq(stats), sqi(now)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_char_list(app: AppHandle) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| sp_char_list_impl(conn)).await
}

fn sp_char_list_impl(conn: &Connection) -> Result<Vec<JsonValue>, String> {
    json_rows(conn, "SELECT id, stats, updated_at FROM characters", &[])
}

// ---- memories ----

#[tauri::command]
pub async fn sp_mem_add(
    app: AppHandle,
    character_id: String,
    memory_type: String,
    content: String,
    importance: Option<i64>,
) -> Result<i64, String> {
    with_conn(app, move |conn| {
        sp_mem_add_impl(conn, &character_id, &memory_type, &content, importance)
    })
    .await
}

fn sp_mem_add_impl(
    conn: &Connection,
    character_id: &str,
    memory_type: &str,
    content: &str,
    importance: Option<i64>,
) -> Result<i64, String> {
    let now = chrono::Utc::now().timestamp_millis();
    let imp = json_or(importance, 50);
    exec(
        conn,
        "INSERT INTO memories (character_id, type, content, importance, created_at, last_accessed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        &[
            sq(character_id),
            sq(memory_type),
            sq(content),
            sqi(imp),
            sqi(now),
        ],
    )?;
    Ok(scalar(conn, "SELECT last_insert_rowid()", &[])?.unwrap_or(0))
}

#[tauri::command]
pub async fn sp_mem_save_embedding(
    app: AppHandle,
    memory_id: i64,
    embedding_b64: String,
) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_mem_save_embedding_impl(conn, memory_id, &embedding_b64)
    })
    .await
}

fn sp_mem_save_embedding_impl(
    conn: &Connection,
    memory_id: i64,
    embedding_b64: &str,
) -> Result<(), String> {
    exec(
        conn,
        "UPDATE memories SET embedding = ?1 WHERE id = ?2",
        &[sq(embedding_b64), sqi(memory_id)],
    )?;
    Ok(())
}

/// 批量保存嵌入（单事务）
#[tauri::command]
pub async fn sp_mem_save_embeddings_batch(
    app: AppHandle,
    items: Vec<EmbedItem>,
) -> Result<(), String> {
    if items.is_empty() {
        return Ok(());
    }
    with_conn(app, move |conn| {
        sp_mem_save_embeddings_batch_impl(conn, &items)
    })
    .await
}

fn sp_mem_save_embeddings_batch_impl(
    conn: &mut Connection,
    items: &[EmbedItem],
) -> Result<(), String> {
    let tx = conn
        .transaction()
        .map_err(|e| format!("开启事务失败: {e}"))?;
    for it in items {
        tx.execute(
            "UPDATE memories SET embedding = ?1 WHERE id = ?2",
            params_from_iter([
                SqValue::Text(it.embedding_b64.clone()),
                SqValue::Integer(it.memory_id),
            ]),
        )
        .map_err(|e| format!("批量嵌入写入失败: {e}"))?;
    }
    tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn sp_mem_touch(app: AppHandle, memory_id: i64) -> Result<(), String> {
    with_conn(app, move |conn| sp_mem_touch_impl(conn, memory_id)).await
}

fn sp_mem_touch_impl(conn: &Connection, memory_id: i64) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    exec(
        conn,
        "UPDATE memories SET last_accessed = ?1 WHERE id = ?2",
        &[sqi(now), sqi(memory_id)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_mem_get_embeddings(
    app: AppHandle,
    character_id: Option<String>,
    limit: Option<i64>,
    memory_type: Option<String>,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_mem_get_embeddings_impl(conn, character_id.as_deref(), limit, memory_type.as_deref())
    })
    .await
}

fn sp_mem_get_embeddings_impl(
    conn: &Connection,
    character_id: Option<&str>,
    limit: Option<i64>,
    memory_type: Option<&str>,
) -> Result<Vec<JsonValue>, String> {
    let lim = json_or(limit, 1000);
    json_rows(
        conn,
        "SELECT id, embedding FROM memories
         WHERE embedding IS NOT NULL
           AND (?1 IS NULL OR character_id = ?1)
           AND (?2 IS NULL OR type = ?2)
         ORDER BY created_at DESC LIMIT ?3",
        &[
            character_id.map(sq).unwrap_or(sqn()),
            memory_type.map(sq).unwrap_or(sqn()),
            sqi(lim),
        ],
    )
}

#[tauri::command]
pub async fn sp_mem_list(
    app: AppHandle,
    character_id: String,
    memory_type: Option<String>,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_mem_list_impl(conn, &character_id, memory_type.as_deref())
    })
    .await
}

fn sp_mem_list_impl(
    conn: &Connection,
    character_id: &str,
    memory_type: Option<&str>,
) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT * FROM memories
         WHERE character_id = ?1 AND (?2 IS NULL OR type = ?2)
         ORDER BY created_at DESC",
        &[sq(character_id), memory_type.map(sq).unwrap_or(sqn())],
    )
}

#[tauri::command]
pub async fn sp_mem_delete(app: AppHandle, memory_id: i64) -> Result<(), String> {
    with_conn(app, move |conn| sp_mem_delete_impl(conn, memory_id)).await
}

fn sp_mem_delete_impl(conn: &Connection, memory_id: i64) -> Result<(), String> {
    exec(
        conn,
        "DELETE FROM memories WHERE id = ?1",
        &[sqi(memory_id)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_mem_clear(app: AppHandle, character_id: String) -> Result<(), String> {
    with_conn(app, move |conn| sp_mem_clear_impl(conn, &character_id)).await
}

fn sp_mem_clear_impl(conn: &Connection, character_id: &str) -> Result<(), String> {
    exec(
        conn,
        "DELETE FROM memories WHERE character_id = ?1",
        &[sq(character_id)],
    )?;
    Ok(())
}

/// 插入完整记忆行，返回 rowid（字段白名单，无字符串拼 SQL）
#[tauri::command]
pub async fn sp_mem_insert_row(app: AppHandle, row: JsonValue) -> Result<i64, String> {
    with_conn(app, move |conn| {
        let character_id = gs(&row, "character_id").ok_or("缺少 character_id")?;
        let memory_type = gs(&row, "type").ok_or("缺少 type")?;
        let content = gs(&row, "content").ok_or("缺少 content")?;
        let importance = gi(&row, "importance").unwrap_or(50);
        let created_at =
            gi(&row, "created_at").unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
        let last_accessed = gi(&row, "last_accessed").unwrap_or(created_at);
        let memory_id = gs(&row, "memory_id").unwrap_or_default();
        let assistant = gs(&row, "assistant").unwrap_or_default();
        let category = gs(&row, "category").unwrap_or_else(|| "日常".to_string());
        let tags = gs(&row, "tags").unwrap_or_else(|| "[]".to_string());
        let emotional_intensity = gf(&row, "emotional_intensity").unwrap_or(0.0);
        let emotional_valence = gf(&row, "emotional_valence").unwrap_or(0.0);
        let emotional_arousal = gf(&row, "emotional_arousal").unwrap_or(0.3);
        let strength = gf(&row, "strength").unwrap_or(1.0);
        let decay_factor = gf(&row, "decay_factor").unwrap_or(1.0);
        let access_count = gi(&row, "access_count").unwrap_or(0);
        let source_kind = gs(&row, "source_kind").unwrap_or_else(|| "exchange".to_string());
        let fact_text = gs(&row, "fact_text").unwrap_or_default();
        let is_autobiographical = gi(&row, "is_autobiographical").unwrap_or(0);
        let tier = gs(&row, "tier").unwrap_or_else(|| "episodic".to_string());
        exec(
            conn,
            "INSERT INTO memories (
               character_id, type, content, importance, created_at, last_accessed,
               memory_id, assistant, category, tags,
               emotional_intensity, emotional_valence, emotional_arousal,
               strength, decay_factor, access_count,
               source_kind, fact_text, is_autobiographical, tier
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
                       ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
            &[
                sq(&character_id),
                sq(&memory_type),
                sq(&content),
                sqi(importance),
                sqi(created_at),
                sqi(last_accessed),
                sq(&memory_id),
                sq(&assistant),
                sq(&category),
                sq(&tags),
                sqf(emotional_intensity),
                sqf(emotional_valence),
                sqf(emotional_arousal),
                sqf(strength),
                sqf(decay_factor),
                sqi(access_count),
                sq(&source_kind),
                sq(&fact_text),
                sqi(is_autobiographical),
                sq(&tier),
            ],
        )?;
        Ok(scalar(conn, "SELECT last_insert_rowid()", &[])?.unwrap_or(0))
    })
    .await
}

/// 可更新列白名单（防字段名注入）
const MEMORY_UPDATABLE: &[&str] = &[
    "type",
    "content",
    "importance",
    "last_accessed",
    "memory_id",
    "assistant",
    "category",
    "tags",
    "emotional_intensity",
    "emotional_valence",
    "emotional_arousal",
    "strength",
    "decay_factor",
    "access_count",
    "source_kind",
    "fact_text",
    "is_autobiographical",
    "tier",
    "superseded_by",
    "embedding",
];

#[tauri::command]
pub async fn sp_mem_update_row(
    app: AppHandle,
    memory_id: i64,
    fields: JsonValue,
) -> Result<(), String> {
    with_conn(app, move |conn| {
        let obj = fields.as_object().ok_or("fields 应为对象")?;
        let mut sets: Vec<String> = Vec::new();
        let mut params: Vec<SqValue> = Vec::new();
        for (k, v) in obj {
            if !MEMORY_UPDATABLE.contains(&k.as_str()) {
                continue; // 非白名单字段忽略（不允许更新 id/character_id）
            }
            let val = match v {
                JsonValue::Null => sqn(),
                JsonValue::String(s) => sq(s),
                JsonValue::Number(n) => n
                    .as_i64()
                    .map(sqi)
                    .unwrap_or_else(|| sqf(n.as_f64().unwrap_or(0.0))),
                JsonValue::Bool(b) => sqi(if *b { 1 } else { 0 }),
                _ => continue,
            };
            sets.push(format!("{k} = ?{}", sets.len() + 1));
            params.push(val);
        }
        if sets.is_empty() {
            return Ok(());
        }
        params.push(sqi(memory_id));
        let sql = format!(
            "UPDATE memories SET {} WHERE id = ?{}",
            sets.join(", "),
            sets.len() + 1
        );
        // sets 全部来自编译期白名单，{k} 恒为常量 → 无注入
        exec(conn, &sql, &params)?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn sp_mem_by_tier(
    app: AppHandle,
    character_id: String,
    tiers: Option<Vec<String>>,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        match tiers {
            Some(tiers) if !tiers.is_empty() => {
                let n = tiers.len();
                let ph: Vec<String> = (2..=n + 1).map(|i| format!("?{i}")).collect();
                let sql = format!(
                    "SELECT * FROM memories WHERE character_id = ?1 AND tier IN ({}) ORDER BY created_at ASC",
                    ph.join(",")
                );
                let mut params: Vec<SqValue> = vec![sq(&character_id)];
                params.extend(tiers.into_iter().map(|t| sq(&t)));
                json_rows(conn, &sql, &params)
            }
            _ => json_rows(
                conn,
                "SELECT * FROM memories WHERE character_id = ?1 ORDER BY created_at ASC",
                &[sq(&character_id)],
            ),
        }
    })
    .await
}

#[tauri::command]
pub async fn sp_mem_by_character(
    app: AppHandle,
    character_id: String,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        json_rows(
            conn,
            "SELECT * FROM memories WHERE character_id = ?1 ORDER BY created_at ASC",
            &[sq(&character_id)],
        )
    })
    .await
}

// ---- memory_summaries / memory_state ----

#[tauri::command]
pub async fn sp_mem_summary_get(
    app: AppHandle,
    character_id: String,
) -> Result<Option<String>, String> {
    with_conn(app, move |conn| {
        scalar(
            conn,
            "SELECT summary FROM memory_summaries WHERE character_id = ?1",
            &[sq(&character_id)],
        )
    })
    .await
}

#[tauri::command]
pub async fn sp_mem_summary_upsert(
    app: AppHandle,
    character_id: String,
    summary: String,
) -> Result<(), String> {
    with_conn(app, move |conn| {
        let now = chrono::Utc::now().timestamp_millis();
        exec(
            conn,
            "INSERT INTO memory_summaries (character_id, summary, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(character_id) DO UPDATE SET summary = ?2, updated_at = ?3",
            &[sq(&character_id), sq(&summary), sqi(now)],
        )?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn sp_mem_summary_delete(app: AppHandle, character_id: String) -> Result<(), String> {
    with_conn(app, move |conn| {
        exec(
            conn,
            "DELETE FROM memory_summaries WHERE character_id = ?1",
            &[sq(&character_id)],
        )?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn sp_mem_state_get(
    app: AppHandle,
    character_id: String,
) -> Result<Option<JsonValue>, String> {
    with_conn(app, move |conn| {
        Ok(json_rows(
            conn,
            "SELECT * FROM memory_state WHERE character_id = ?1",
            &[sq(&character_id)],
        )?
        .into_iter()
        .next())
    })
    .await
}

#[tauri::command]
pub async fn sp_mem_state_upsert(app: AppHandle, state: JsonValue) -> Result<(), String> {
    with_conn(app, move |conn| {
        let character_id = gs(&state, "character_id").ok_or("缺少 character_id")?;
        let last_chat_date = state.get("last_chat_date").and_then(|v| v.as_str()).map(String::from);
        let trigger_log = gs(&state, "trigger_log").unwrap_or_else(|| "[]".to_string());
        let ignore_count = gs(&state, "ignore_count").unwrap_or_else(|| "{}".to_string());
        let last_periodic_fire_date = gs(&state, "last_periodic_fire_date").unwrap_or_else(|| "{}".to_string());
        let injected_at = gs(&state, "injected_at").unwrap_or_else(|| "{}".to_string());
        let llm_reassessed_ids = gs(&state, "llm_reassessed_ids").unwrap_or_else(|| "[]".to_string());
        exec(
            conn,
            "INSERT INTO memory_state (character_id, last_chat_date, trigger_log, ignore_count, last_periodic_fire_date, injected_at, llm_reassessed_ids)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(character_id) DO UPDATE SET
               last_chat_date = ?2, trigger_log = ?3, ignore_count = ?4,
               last_periodic_fire_date = ?5, injected_at = ?6, llm_reassessed_ids = ?7",
            &[
                sq(&character_id),
                last_chat_date.map(|s| sq(&s)).unwrap_or(sqn()),
                sq(&trigger_log),
                sq(&ignore_count),
                sq(&last_periodic_fire_date),
                sq(&injected_at),
                sq(&llm_reassessed_ids),
            ],
        )?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn sp_mem_state_delete(app: AppHandle, character_id: String) -> Result<(), String> {
    with_conn(app, move |conn| {
        exec(
            conn,
            "DELETE FROM memory_state WHERE character_id = ?1",
            &[sq(&character_id)],
        )?;
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn sp_mem_clear_all(app: AppHandle, character_id: String) -> Result<(), String> {
    with_conn(app, move |conn| {
        let tx = conn
            .transaction()
            .map_err(|e| format!("开启事务失败: {e}"))?;
        for sql in [
            "DELETE FROM memories WHERE character_id = ?1",
            "DELETE FROM memory_summaries WHERE character_id = ?1",
            "DELETE FROM memory_state WHERE character_id = ?1",
            "DELETE FROM memory_semantic_facts WHERE character_id = ?1",
        ] {
            tx.execute(sql, params_from_iter([SqValue::Text(character_id.clone())]))
                .map_err(|e| format!("清空记忆失败: {e}"))?;
        }
        tx.commit().map_err(|e| format!("提交事务失败: {e}"))?;
        Ok(())
    })
    .await
}

// ---- owner_facts ----

#[tauri::command]
pub async fn sp_owner_facts_list(
    app: AppHandle,
    character_id: String,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_owner_facts_list_impl(conn, &character_id)
    })
    .await
}

fn sp_owner_facts_list_impl(
    conn: &Connection,
    character_id: &str,
) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT * FROM owner_facts WHERE character_id = ?1 ORDER BY confidence DESC, updated_at DESC",
        &[sq(character_id)],
    )
}

#[tauri::command]
pub async fn sp_owner_facts_as_of(
    app: AppHandle,
    character_id: String,
    as_of_time: i64,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_owner_facts_as_of_impl(conn, &character_id, as_of_time)
    })
    .await
}

fn sp_owner_facts_as_of_impl(
    conn: &Connection,
    character_id: &str,
    as_of_time: i64,
) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT * FROM owner_facts
         WHERE character_id = ?1
           AND (valid_at IS NULL OR valid_at <= ?2)
           AND (invalid_at IS NULL OR invalid_at > ?2)
         ORDER BY confidence DESC, updated_at DESC",
        &[sq(character_id), sqi(as_of_time)],
    )
}

#[tauri::command]
pub async fn sp_owner_facts_history(
    app: AppHandle,
    character_id: String,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_owner_facts_history_impl(conn, &character_id)
    })
    .await
}

fn sp_owner_facts_history_impl(
    conn: &Connection,
    character_id: &str,
) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT * FROM owner_facts
         WHERE character_id = ?1 AND invalid_at IS NOT NULL
         ORDER BY invalid_at DESC",
        &[sq(character_id)],
    )
}

#[tauri::command]
pub async fn sp_owner_facts_upsert(app: AppHandle, row: JsonValue) -> Result<(), String> {
    with_conn(app, move |conn| sp_owner_facts_upsert_impl(conn, &row)).await
}

fn sp_owner_facts_upsert_impl(conn: &Connection, row: &JsonValue) -> Result<(), String> {
    let character_id = gs(row, "character_id").ok_or("缺少 character_id")?;
    let fact_key = gs(row, "fact_key").ok_or("缺少 fact_key")?;
    let now = chrono::Utc::now().timestamp_millis();
    // P1-5: 同 key 有效旧值先标记失效（被取代）
    let old_id: Option<i64> = scalar(
        conn,
        "SELECT id FROM owner_facts
         WHERE character_id = ?1 AND fact_key = ?2 AND (invalid_at IS NULL OR invalid_at > ?3)
         LIMIT 1",
        &[sq(&character_id), sq(&fact_key), sqi(now)],
    )?;
    if let Some(old_id) = old_id {
        exec(
            conn,
            "UPDATE owner_facts SET invalid_at = ?1, superseded_by = ?2 WHERE id = ?3",
            &[sqi(now), sqi(gi(row, "id").unwrap_or(0)), sqi(old_id)],
        )?;
    }
    exec(
        conn,
        "INSERT INTO owner_facts (character_id, fact_id, fact_key, fact_value, source_memory_id, confidence, updated_at, user_provided, valid_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(character_id, fact_key) DO UPDATE SET
           fact_value = ?4, source_memory_id = ?5, confidence = ?6, updated_at = ?7, user_provided = ?8, valid_at = ?9",
        &[
            sq(&character_id),
            sq(&gs(row, "fact_id").unwrap_or_default()),
            sq(&fact_key),
            sq(&gs(row, "fact_value").unwrap_or_default()),
            gs(row, "source_memory_id").map(|s| sq(&s)).unwrap_or(sqn()),
            sqf(gf(row, "confidence").unwrap_or(0.5)),
            sqi(gi(row, "updated_at").unwrap_or(now)),
            sqi(gi(row, "user_provided").unwrap_or(0)),
            sqi(now),
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_owner_facts_delete(
    app: AppHandle,
    character_id: String,
    fact_key: String,
) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_owner_facts_delete_impl(conn, &character_id, &fact_key)
    })
    .await
}

fn sp_owner_facts_delete_impl(
    conn: &Connection,
    character_id: &str,
    fact_key: &str,
) -> Result<(), String> {
    exec(
        conn,
        "DELETE FROM owner_facts WHERE character_id = ?1 AND fact_key = ?2",
        &[sq(character_id), sq(fact_key)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_owner_facts_clear(app: AppHandle, character_id: String) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_owner_facts_clear_impl(conn, &character_id)
    })
    .await
}

fn sp_owner_facts_clear_impl(conn: &Connection, character_id: &str) -> Result<(), String> {
    exec(
        conn,
        "DELETE FROM owner_facts WHERE character_id = ?1",
        &[sq(character_id)],
    )?;
    Ok(())
}

// ---- memory_semantic_facts ----

#[tauri::command]
pub async fn sp_sem_facts_list(
    app: AppHandle,
    character_id: String,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| sp_sem_facts_list_impl(conn, &character_id)).await
}

fn sp_sem_facts_list_impl(conn: &Connection, character_id: &str) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT * FROM memory_semantic_facts WHERE character_id = ?1 ORDER BY importance DESC, updated_at DESC",
        &[sq(character_id)],
    )
}

#[tauri::command]
pub async fn sp_sem_facts_by_key(
    app: AppHandle,
    character_id: String,
    fact_key: String,
) -> Result<Option<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_sem_facts_by_key_impl(conn, &character_id, &fact_key)
    })
    .await
}

fn sp_sem_facts_by_key_impl(
    conn: &Connection,
    character_id: &str,
    fact_key: &str,
) -> Result<Option<JsonValue>, String> {
    Ok(json_rows(
        conn,
        "SELECT * FROM memory_semantic_facts
         WHERE character_id = ?1 AND fact_key = ?2 ORDER BY importance DESC LIMIT 1",
        &[sq(character_id), sq(fact_key)],
    )?
    .into_iter()
    .next())
}

#[tauri::command]
pub async fn sp_sem_facts_upsert(app: AppHandle, row: JsonValue) -> Result<(), String> {
    with_conn(app, move |conn| sp_sem_facts_upsert_impl(conn, &row)).await
}

fn sp_sem_facts_upsert_impl(conn: &Connection, row: &JsonValue) -> Result<(), String> {
    let character_id = gs(row, "character_id").ok_or("缺少 character_id")?;
    let fact_key = gs(row, "fact_key").ok_or("缺少 fact_key")?;
    let fact_value = gs(row, "fact_value").unwrap_or_default();
    let source_ids = match row.get("source_memory_ids") {
        Some(JsonValue::Array(arr)) => json!(arr).to_string(),
        Some(JsonValue::String(s)) => s.clone(),
        _ => "[]".to_string(),
    };
    let now = chrono::Utc::now().timestamp_millis();
    exec(
        conn,
        "INSERT INTO memory_semantic_facts (character_id, fact_key, fact_value, source_memory_ids, importance, created_at, updated_at, is_autobiographical)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(character_id, fact_key) DO UPDATE SET
           fact_value = ?3, source_memory_ids = ?4, importance = ?5, updated_at = ?7, is_autobiographical = ?8",
        &[
            sq(&character_id),
            sq(&fact_key),
            sq(&fact_value),
            sq(&source_ids),
            sqi(gi(row, "importance").unwrap_or(50)),
            sqi(gi(row, "created_at").unwrap_or(now)),
            sqi(gi(row, "updated_at").unwrap_or(now)),
            sqi(gi(row, "is_autobiographical").unwrap_or(0)),
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_sem_facts_delete(
    app: AppHandle,
    character_id: String,
    fact_key: String,
) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_sem_facts_delete_impl(conn, &character_id, &fact_key)
    })
    .await
}

fn sp_sem_facts_delete_impl(
    conn: &Connection,
    character_id: &str,
    fact_key: &str,
) -> Result<(), String> {
    exec(
        conn,
        "DELETE FROM memory_semantic_facts WHERE character_id = ?1 AND fact_key = ?2",
        &[sq(character_id), sq(fact_key)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_sem_facts_clear(app: AppHandle, character_id: String) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_sem_facts_clear_impl(conn, &character_id)
    })
    .await
}

fn sp_sem_facts_clear_impl(conn: &Connection, character_id: &str) -> Result<(), String> {
    exec(
        conn,
        "DELETE FROM memory_semantic_facts WHERE character_id = ?1",
        &[sq(character_id)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_sem_facts_count(app: AppHandle, character_id: String) -> Result<i64, String> {
    with_conn(app, move |conn| {
        sp_sem_facts_count_impl(conn, &character_id)
    })
    .await
}

fn sp_sem_facts_count_impl(conn: &Connection, character_id: &str) -> Result<i64, String> {
    Ok(scalar(
        conn,
        "SELECT COUNT(*) FROM memory_semantic_facts WHERE character_id = ?1",
        &[sq(character_id)],
    )?
    .unwrap_or(0))
}

// ---- pet_experiences / visual_memories / entity_nodes ----

#[tauri::command]
pub async fn sp_pet_exp_list(
    app: AppHandle,
    character_id: String,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| sp_pet_exp_list_impl(conn, &character_id)).await
}

fn sp_pet_exp_list_impl(conn: &Connection, character_id: &str) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT * FROM pet_experiences WHERE character_id = ?1 ORDER BY timestamp ASC",
        &[sq(character_id)],
    )
}

#[tauri::command]
pub async fn sp_pet_exp_insert(app: AppHandle, row: JsonValue) -> Result<(), String> {
    with_conn(app, move |conn| sp_pet_exp_insert_impl(conn, &row)).await
}

fn sp_pet_exp_insert_impl(conn: &Connection, row: &JsonValue) -> Result<(), String> {
    exec(
        conn,
        "INSERT INTO pet_experiences (id, character_id, type, description, timestamp, sentiment, intensity)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        &[
            sq(&gs(row, "id").ok_or("缺少 id")?),
            sq(&gs(row, "character_id").ok_or("缺少 character_id")?),
            sq(&gs(row, "type").unwrap_or_default()),
            sq(&gs(row, "description").unwrap_or_default()),
            sqi(gi(row, "timestamp").unwrap_or(0)),
            sq(&gs(row, "sentiment").unwrap_or_else(|| "neutral".to_string())),
            sqf(gf(row, "intensity").unwrap_or(0.5)),
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_pet_exp_clear(app: AppHandle, character_id: String) -> Result<(), String> {
    with_conn(app, move |conn| sp_pet_exp_clear_impl(conn, &character_id)).await
}

fn sp_pet_exp_clear_impl(conn: &Connection, character_id: &str) -> Result<(), String> {
    exec(
        conn,
        "DELETE FROM pet_experiences WHERE character_id = ?1",
        &[sq(character_id)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_visual_list(
    app: AppHandle,
    character_id: String,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| sp_visual_list_impl(conn, &character_id)).await
}

fn sp_visual_list_impl(conn: &Connection, character_id: &str) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT * FROM visual_memories WHERE character_id = ?1 ORDER BY timestamp ASC",
        &[sq(character_id)],
    )
}

#[tauri::command]
pub async fn sp_visual_insert(app: AppHandle, row: JsonValue) -> Result<(), String> {
    with_conn(app, move |conn| sp_visual_insert_impl(conn, &row)).await
}

fn sp_visual_insert_impl(conn: &Connection, row: &JsonValue) -> Result<(), String> {
    exec(
        conn,
        "INSERT INTO visual_memories (id, character_id, type, description, image_path, timestamp, sentiment, related_memory_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        &[
            sq(&gs(row, "id").ok_or("缺少 id")?),
            sq(&gs(row, "character_id").ok_or("缺少 character_id")?),
            sq(&gs(row, "type").unwrap_or_default()),
            sq(&gs(row, "description").unwrap_or_default()),
            gs(row, "image_path").map(|s| sq(&s)).unwrap_or(sqn()),
            sqi(gi(row, "timestamp").unwrap_or(0)),
            sq(&gs(row, "sentiment").unwrap_or_else(|| "neutral".to_string())),
            gs(row, "related_memory_id").map(|s| sq(&s)).unwrap_or(sqn()),
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_visual_clear(app: AppHandle, character_id: String) -> Result<(), String> {
    with_conn(app, move |conn| sp_visual_clear_impl(conn, &character_id)).await
}

fn sp_visual_clear_impl(conn: &Connection, character_id: &str) -> Result<(), String> {
    exec(
        conn,
        "DELETE FROM visual_memories WHERE character_id = ?1",
        &[sq(character_id)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_entity_list(
    app: AppHandle,
    character_id: String,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| sp_entity_list_impl(conn, &character_id)).await
}

fn sp_entity_list_impl(conn: &Connection, character_id: &str) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT * FROM entity_nodes WHERE character_id = ?1 ORDER BY mention_count DESC",
        &[sq(character_id)],
    )
}

#[tauri::command]
pub async fn sp_entity_upsert(app: AppHandle, row: JsonValue) -> Result<(), String> {
    with_conn(app, move |conn| sp_entity_upsert_impl(conn, &row)).await
}

fn sp_entity_upsert_impl(conn: &Connection, row: &JsonValue) -> Result<(), String> {
    exec(
        conn,
        "INSERT INTO entity_nodes (id, character_id, name, type, linked_memory_ids, mention_count, first_seen, last_seen)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(character_id, name) DO UPDATE SET
           linked_memory_ids = ?5, mention_count = ?6, last_seen = ?8",
        &[
            sq(&gs(row, "id").ok_or("缺少 id")?),
            sq(&gs(row, "character_id").ok_or("缺少 character_id")?),
            sq(&gs(row, "name").ok_or("缺少 name")?),
            sq(&gs(row, "type").unwrap_or_default()),
            sq(&gs(row, "linked_memory_ids").unwrap_or_else(|| "[]".to_string())),
            sqi(gi(row, "mention_count").unwrap_or(0)),
            sqi(gi(row, "first_seen").unwrap_or(0)),
            sqi(gi(row, "last_seen").unwrap_or(0)),
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_entity_clear(app: AppHandle, character_id: String) -> Result<(), String> {
    with_conn(app, move |conn| sp_entity_clear_impl(conn, &character_id)).await
}

fn sp_entity_clear_impl(conn: &Connection, character_id: &str) -> Result<(), String> {
    exec(
        conn,
        "DELETE FROM entity_nodes WHERE character_id = ?1",
        &[sq(character_id)],
    )?;
    Ok(())
}

// ---- mods / inventory / schedules ----

#[tauri::command]
pub async fn sp_mods_save(app: AppHandle, row: JsonValue) -> Result<(), String> {
    with_conn(app, move |conn| sp_mods_save_impl(conn, &row)).await
}

fn sp_mods_save_impl(conn: &Connection, row: &JsonValue) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    exec(
        conn,
        "INSERT INTO mods (id, name, version, config, enabled, installed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET name = ?2, version = ?3, config = ?4, enabled = ?5",
        &[
            sq(&gs(row, "id").ok_or("缺少 id")?),
            sq(&gs(row, "name").ok_or("缺少 name")?),
            gs(row, "version").map(|s| sq(&s)).unwrap_or(sqn()),
            sq(&gs(row, "config").unwrap_or_else(|| "{}".to_string())),
            sqi(if gbool(row, "enabled").unwrap_or(true) {
                1
            } else {
                0
            }),
            sqi(gi(row, "installed_at").unwrap_or(now)),
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_mods_list(app: AppHandle) -> Result<Vec<JsonValue>, String> {
    with_conn(app, |conn| sp_mods_list_impl(conn)).await
}

fn sp_mods_list_impl(conn: &Connection) -> Result<Vec<JsonValue>, String> {
    json_rows(conn, "SELECT * FROM mods", &[])
}

#[tauri::command]
pub async fn sp_mods_delete(app: AppHandle, id: String) -> Result<(), String> {
    with_conn(app, move |conn| sp_mods_delete_impl(conn, &id)).await
}

fn sp_mods_delete_impl(conn: &Connection, id: &str) -> Result<(), String> {
    exec(conn, "DELETE FROM mods WHERE id = ?1", &[sq(id)])?;
    Ok(())
}

#[tauri::command]
pub async fn sp_mods_set_enabled(app: AppHandle, id: String, enabled: bool) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_mods_set_enabled_impl(conn, &id, enabled)
    })
    .await
}

fn sp_mods_set_enabled_impl(conn: &Connection, id: &str, enabled: bool) -> Result<(), String> {
    exec(
        conn,
        "UPDATE mods SET enabled = ?1 WHERE id = ?2",
        &[sqi(if enabled { 1 } else { 0 }), sq(id)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_inventory_save(app: AppHandle, item: JsonValue) -> Result<(), String> {
    with_conn(app, move |conn| sp_inventory_save_impl(conn, &item)).await
}

fn sp_inventory_save_impl(conn: &Connection, item: &JsonValue) -> Result<(), String> {
    exec(
        conn,
        "INSERT INTO inventory (id, item_id, quantity, character_id)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET item_id = ?2, quantity = ?3, character_id = ?4",
        &[
            sq(&gs(item, "id").ok_or("缺少 id")?),
            sq(&gs(item, "item_id").ok_or("缺少 item_id")?),
            sqi(gi(item, "quantity").unwrap_or(1)),
            gs(item, "character_id").map(|s| sq(&s)).unwrap_or(sqn()),
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_inventory_list(
    app: AppHandle,
    character_id: Option<String>,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_inventory_list_impl(conn, character_id.as_deref())
    })
    .await
}

fn sp_inventory_list_impl(
    conn: &Connection,
    character_id: Option<&str>,
) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT * FROM inventory WHERE (?1 IS NULL OR character_id = ?1 OR character_id IS NULL)",
        &[character_id.map(sq).unwrap_or(sqn())],
    )
}

#[tauri::command]
pub async fn sp_schedules_save(app: AppHandle, schedule: JsonValue) -> Result<(), String> {
    with_conn(app, move |conn| sp_schedules_save_impl(conn, &schedule)).await
}

fn sp_schedules_save_impl(conn: &Connection, schedule: &JsonValue) -> Result<(), String> {
    exec(
        conn,
        "INSERT INTO schedules (id, title, time, repeat, completed)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id) DO UPDATE SET title = ?2, time = ?3, repeat = ?4, completed = ?5",
        &[
            sq(&gs(schedule, "id").ok_or("缺少 id")?),
            sq(&gs(schedule, "title").ok_or("缺少 title")?),
            sqi(gi(schedule, "time").unwrap_or(0)),
            gs(schedule, "repeat").map(|s| sq(&s)).unwrap_or(sqn()),
            sqi(if gbool(schedule, "completed").unwrap_or(false) {
                1
            } else {
                0
            }),
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_schedules_list(app: AppHandle) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| sp_schedules_list_impl(conn)).await
}

fn sp_schedules_list_impl(conn: &Connection) -> Result<Vec<JsonValue>, String> {
    json_rows(conn, "SELECT * FROM schedules ORDER BY time ASC", &[])
}

/// 删除指定日程（P3-1 收尾：scheduleManager.removeEvent 镜像删除，避免 DB 残留行复活）
#[tauri::command]
pub async fn sp_schedules_delete(app: AppHandle, id: String) -> Result<(), String> {
    with_conn(app, move |conn| sp_schedules_delete_impl(conn, &id)).await
}

fn sp_schedules_delete_impl(conn: &Connection, id: &str) -> Result<(), String> {
    exec(conn, "DELETE FROM schedules WHERE id = ?1", &[sq(id)])?;
    Ok(())
}

// ============ 健康检查 / 完整性 / 快照（healthCheck / dbBackup） ============

/// PRAGMA integrity_check 全量行（健康检查 / 启动完整性探针）
#[tauri::command]
pub async fn sp_db_integrity(app: AppHandle) -> Result<Vec<String>, String> {
    with_conn(app, move |conn| sp_db_integrity_impl(conn)).await
}

fn sp_db_integrity_impl(conn: &Connection) -> Result<Vec<String>, String> {
    let rows = json_rows(
        conn,
        "SELECT integrity_check FROM pragma_integrity_check",
        &[],
    )?;
    Ok(rows
        .iter()
        .filter_map(|r| {
            r.get("integrity_check")
                .and_then(JsonValue::as_str)
                .map(String::from)
        })
        .collect())
}

/// 表级全量快照（dbBackup.exportDatabaseSnapshot；表名来自编译期白名单）
const SNAPSHOT_TABLES: &[&str] = &[
    "characters",
    "settings",
    "memories",
    "mods",
    "inventory",
    "schedules",
    "memory_summaries",
    "memory_state",
    "memory_semantic_facts",
    "owner_facts",
    "pet_experiences",
    "visual_memories",
    "entity_nodes",
    "commitments",
    "context_episodes",
];

#[tauri::command]
pub async fn sp_db_snapshot(app: AppHandle) -> Result<Map<String, JsonValue>, String> {
    with_conn(app, move |conn| sp_db_snapshot_impl(conn)).await
}

fn sp_db_snapshot_impl(conn: &Connection) -> Result<Map<String, JsonValue>, String> {
    let mut out = Map::new();
    for t in SNAPSHOT_TABLES {
        // t 来自编译期常量白名单 → 无注入
        let sql = format!("SELECT * FROM \"{t}\"");
        match json_rows(conn, &sql, &[]) {
            Ok(rows) => {
                out.insert(t.to_string(), JsonValue::Array(rows));
            }
            Err(_) => {
                out.insert(t.to_string(), JsonValue::Array(vec![]));
            }
        }
    }
    Ok(out)
}

// ============ settings 通用（memoryMigrator / zombieDataCleanup） ============

/// 按 LIKE 模式返回 settings 键列表（pattern 为参数，非拼接）
#[tauri::command]
pub async fn sp_settings_keys(app: AppHandle, pattern: String) -> Result<Vec<String>, String> {
    with_conn(app, move |conn| sp_settings_keys_impl(conn, &pattern)).await
}

fn sp_settings_keys_impl(conn: &Connection, pattern: &str) -> Result<Vec<String>, String> {
    let rows = json_rows(
        conn,
        "SELECT key FROM settings WHERE key LIKE ?1 ORDER BY key ASC",
        &[sq(pattern)],
    )?;
    Ok(rows
        .iter()
        .filter_map(|r| r.get("key").and_then(JsonValue::as_str).map(String::from))
        .collect())
}

// ============ 全量清空（dataManager.resetAll，GDPR） ============

#[tauri::command]
pub async fn sp_db_purge(app: AppHandle) -> Result<(), String> {
    with_conn(app, move |conn| sp_db_purge_impl(conn)).await
}

fn sp_db_purge_impl(conn: &Connection) -> Result<(), String> {
    let _ = exec(conn, "DELETE FROM memories", &[]);
    let _ = exec(conn, "DELETE FROM commitments", &[]);
    let _ = exec(conn, "DELETE FROM context_episodes", &[]);
    let _ = exec(
        conn,
        "DELETE FROM settings WHERE key LIKE 'spiritpal:%'",
        &[],
    );
    let _ = exec(conn, "DELETE FROM schedules", &[]);
    let _ = exec(conn, "DELETE FROM memory_entity_edges", &[]);
    let _ = exec(conn, "DELETE FROM memory_entities", &[]);
    Ok(())
}

// ============ commitments（commitmentTracker） ============

#[tauri::command]
pub async fn sp_commitments_insert(
    app: AppHandle,
    character_id: String,
    content: String,
    actor: String,
    due_at: Option<i64>,
    source_memory_id: Option<i64>,
    repeat: Option<String>,
) -> Result<i64, String> {
    with_conn(app, move |conn| {
        sp_commitments_insert_impl(
            conn,
            &character_id,
            &content,
            &actor,
            due_at,
            source_memory_id,
            repeat.as_deref(),
        )
    })
    .await
}

fn sp_commitments_insert_impl(
    conn: &Connection,
    character_id: &str,
    content: &str,
    actor: &str,
    due_at: Option<i64>,
    source_memory_id: Option<i64>,
    repeat: Option<&str>,
) -> Result<i64, String> {
    let now = chrono::Utc::now().timestamp_millis();
    exec(
        conn,
        "INSERT INTO commitments (character_id, content, actor, due_at, status, source_memory_id, created_at, follow_up_count, repeat)
         VALUES (?1, ?2, ?3, ?4, 'open', ?5, ?6, 0, ?7)",
        &[
            sq(character_id),
            sq(content),
            sq(actor),
            due_at.map(sqi).unwrap_or_else(sqn),
            source_memory_id.map(sqi).unwrap_or_else(sqn),
            sqi(now),
            repeat.map(sq).unwrap_or_else(sqn),
        ],
    )?;
    Ok(scalar(conn, "SELECT last_insert_rowid()", &[])?.unwrap_or(0))
}

#[tauri::command]
pub async fn sp_commitments_list(
    app: AppHandle,
    character_id: String,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_commitments_list_impl(conn, &character_id)
    })
    .await
}

fn sp_commitments_list_impl(
    conn: &Connection,
    character_id: &str,
) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT * FROM commitments WHERE character_id = ?1 AND status = 'open' ORDER BY due_at ASC",
        &[sq(character_id)],
    )
}

#[tauri::command]
pub async fn sp_commitments_due(
    app: AppHandle,
    character_id: String,
    start: i64,
    end: i64,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_commitments_due_impl(conn, &character_id, start, end)
    })
    .await
}

fn sp_commitments_due_impl(
    conn: &Connection,
    character_id: &str,
    start: i64,
    end: i64,
) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT * FROM commitments WHERE character_id = ?1 AND status = 'open' AND due_at >= ?2 AND due_at < ?3 ORDER BY due_at ASC",
        &[sq(character_id), sqi(start), sqi(end)],
    )
}

#[tauri::command]
pub async fn sp_commitments_overdue(
    app: AppHandle,
    character_id: String,
    now: i64,
    before: i64,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_commitments_overdue_impl(conn, &character_id, now, before)
    })
    .await
}

fn sp_commitments_overdue_impl(
    conn: &Connection,
    character_id: &str,
    now: i64,
    before: i64,
) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT * FROM commitments WHERE character_id = ?1 AND status = 'open' AND due_at < ?2 AND due_at > ?3 ORDER BY due_at ASC",
        &[sq(character_id), sqi(now), sqi(before)],
    )
}

/// 约定状态白名单（防字段/状态注入）
const COMMITMENT_STATUS_UPDATABLE: &[&str] = &["open", "fulfilled", "lapsed", "cancelled"];

#[tauri::command]
pub async fn sp_commitments_set_status(
    app: AppHandle,
    id: i64,
    status: String,
) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_commitments_set_status_impl(conn, id, &status)
    })
    .await
}

fn sp_commitments_set_status_impl(conn: &Connection, id: i64, status: &str) -> Result<(), String> {
    if !COMMITMENT_STATUS_UPDATABLE.contains(&status) {
        return Err(format!("非法约定状态: {status}"));
    }
    exec(
        conn,
        "UPDATE commitments SET status = ?1 WHERE id = ?2",
        &[sq(status), sqi(id)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_commitments_increment_follow_up(app: AppHandle, id: i64) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_commitments_increment_follow_up_impl(conn, id)
    })
    .await
}

fn sp_commitments_increment_follow_up_impl(conn: &Connection, id: i64) -> Result<(), String> {
    exec(
        conn,
        "UPDATE commitments SET follow_up_count = follow_up_count + 1 WHERE id = ?1",
        &[sqi(id)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_commitments_auto_lapse(
    app: AppHandle,
    character_id: String,
    threshold: i64,
) -> Result<usize, String> {
    with_conn(app, move |conn| {
        sp_commitments_auto_lapse_impl(conn, &character_id, threshold)
    })
    .await
}

fn sp_commitments_auto_lapse_impl(
    conn: &Connection,
    character_id: &str,
    threshold: i64,
) -> Result<usize, String> {
    exec(
        conn,
        "UPDATE commitments SET status = 'lapsed' WHERE character_id = ?1 AND status = 'open' AND due_at < ?2",
        &[sq(character_id), sqi(threshold)],
    )
}

#[tauri::command]
pub async fn sp_commitments_recurring_done(
    app: AppHandle,
    character_id: String,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_commitments_recurring_done_impl(conn, &character_id)
    })
    .await
}

fn sp_commitments_recurring_done_impl(
    conn: &Connection,
    character_id: &str,
) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT * FROM commitments WHERE character_id = ?1 AND status IN ('fulfilled','lapsed') AND repeat IS NOT NULL AND repeat != 'null'",
        &[sq(character_id)],
    )
}

#[tauri::command]
pub async fn sp_commitments_open_recent(
    app: AppHandle,
    character_id: String,
    content: String,
    since: i64,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_commitments_open_recent_impl(conn, &character_id, &content, since)
    })
    .await
}

fn sp_commitments_open_recent_impl(
    conn: &Connection,
    character_id: &str,
    content: &str,
    since: i64,
) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT id FROM commitments WHERE character_id = ?1 AND content = ?2 AND status = 'open' AND created_at > ?3",
        &[sq(character_id), sq(content), sqi(since)],
    )
}

// ============ context_episodes（contextEpisodeManager） ============

#[tauri::command]
pub async fn sp_ctx_insert(
    app: AppHandle,
    character_id: String,
    started_at: i64,
    work_state: Option<String>,
    weather: Option<String>,
    idle_minutes: Option<i64>,
    music: Option<String>,
) -> Result<i64, String> {
    with_conn(app, move |conn| {
        sp_ctx_insert_impl(
            conn,
            &character_id,
            started_at,
            work_state.as_deref(),
            weather.as_deref(),
            idle_minutes,
            music.as_deref(),
        )
    })
    .await
}

fn sp_ctx_insert_impl(
    conn: &Connection,
    character_id: &str,
    started_at: i64,
    work_state: Option<&str>,
    weather: Option<&str>,
    idle_minutes: Option<i64>,
    music: Option<&str>,
) -> Result<i64, String> {
    exec(
        conn,
        "INSERT INTO context_episodes (character_id, started_at, work_state, weather, idle_minutes, music)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        &[
            sq(character_id),
            sqi(started_at),
            work_state.map(sq).unwrap_or_else(sqn),
            weather.map(sq).unwrap_or_else(sqn),
            idle_minutes.map(sqi).unwrap_or_else(sqn),
            music.map(sq).unwrap_or_else(sqn),
        ],
    )?;
    Ok(scalar(conn, "SELECT last_insert_rowid()", &[])?.unwrap_or(0))
}

#[tauri::command]
pub async fn sp_ctx_close(app: AppHandle, id: i64, ended_at: i64) -> Result<(), String> {
    with_conn(app, move |conn| sp_ctx_close_impl(conn, id, ended_at)).await
}

fn sp_ctx_close_impl(conn: &Connection, id: i64, ended_at: i64) -> Result<(), String> {
    exec(
        conn,
        "UPDATE context_episodes SET ended_at = ?1 WHERE id = ?2",
        &[sqi(ended_at), sqi(id)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_ctx_list(
    app: AppHandle,
    character_id: String,
    start: i64,
    end: Option<i64>,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_ctx_list_impl(conn, &character_id, start, end)
    })
    .await
}

fn sp_ctx_list_impl(
    conn: &Connection,
    character_id: &str,
    start: i64,
    end: Option<i64>,
) -> Result<Vec<JsonValue>, String> {
    match end {
        Some(e) => json_rows(
            conn,
            "SELECT * FROM context_episodes WHERE character_id = ?1 AND started_at >= ?2 AND started_at < ?3 ORDER BY started_at ASC",
            &[sq(character_id), sqi(start), sqi(e)],
        ),
        None => json_rows(
            conn,
            "SELECT * FROM context_episodes WHERE character_id = ?1 AND started_at >= ?2 ORDER BY started_at ASC",
            &[sq(character_id), sqi(start)],
        ),
    }
}

// ============ entityGraph（memory_entities / memory_entity_edges） ============

#[tauri::command]
pub async fn sp_entitygraph_upsert_node(
    app: AppHandle,
    name: String,
    node_type: String,
    memory_id: String,
    candidate_id: String,
    created_at: i64,
    embedding_b64: Option<String>,
) -> Result<String, String> {
    with_conn(app, move |conn| {
        sp_entitygraph_upsert_node_impl(
            conn,
            &name,
            &node_type,
            &memory_id,
            &candidate_id,
            created_at,
            embedding_b64.as_deref(),
        )
    })
    .await
}

fn sp_entitygraph_upsert_node_impl(
    conn: &Connection,
    name: &str,
    node_type: &str,
    memory_id: &str,
    candidate_id: &str,
    created_at: i64,
    embedding_b64: Option<&str>,
) -> Result<String, String> {
    let existing = json_rows(
        conn,
        "SELECT id, memory_ids FROM memory_entities WHERE name = ?1 AND type = ?2",
        &[sq(name), sq(node_type)],
    )?;
    if let Some(row) = existing.first() {
        let id = row
            .get("id")
            .and_then(JsonValue::as_str)
            .map(String::from)
            .ok_or("缺 id")?;
        let memory_ids: Vec<String> = row
            .get("memory_ids")
            .and_then(JsonValue::as_str)
            .and_then(|s| serde_json::from_str::<Vec<String>>(s).ok())
            .unwrap_or_default();
        if !memory_ids.iter().any(|m| m == memory_id) {
            let mut ids = memory_ids;
            ids.push(memory_id.to_string());
            let payload = serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_string());
            match embedding_b64 {
                Some(eb) => {
                    exec(
                        conn,
                        "UPDATE memory_entities SET memory_ids = ?1, embedding = ?2 WHERE id = ?3",
                        &[sq(&payload), sq(eb), sq(&id)],
                    )?;
                }
                None => {
                    exec(
                        conn,
                        "UPDATE memory_entities SET memory_ids = ?1 WHERE id = ?2",
                        &[sq(&payload), sq(&id)],
                    )?;
                }
            }
        }
        Ok(id)
    } else {
        let payload = serde_json::to_string(&vec![memory_id.to_string()])
            .unwrap_or_else(|_| "[]".to_string());
        match embedding_b64 {
            Some(eb) => {
                exec(
                    conn,
                    "INSERT INTO memory_entities (id, name, type, memory_ids, embedding, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    &[sq(candidate_id), sq(name), sq(node_type), sq(&payload), sq(eb), sqi(created_at)],
                )?;
            }
            None => {
                exec(
                    conn,
                    "INSERT INTO memory_entities (id, name, type, memory_ids, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                    &[sq(candidate_id), sq(name), sq(node_type), sq(&payload), sqi(created_at)],
                )?;
            }
        }
        Ok(candidate_id.to_string())
    }
}

#[tauri::command]
pub async fn sp_entitygraph_upsert_edge(
    app: AppHandle,
    entity_a: String,
    entity_b: String,
    weight_increment: f64,
    created_at: i64,
) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_entitygraph_upsert_edge_impl(conn, &entity_a, &entity_b, weight_increment, created_at)
    })
    .await
}

fn sp_entitygraph_upsert_edge_impl(
    conn: &Connection,
    entity_a: &str,
    entity_b: &str,
    weight_increment: f64,
    created_at: i64,
) -> Result<(), String> {
    let existing = json_rows(
        conn,
        "SELECT id FROM memory_entity_edges WHERE entity_a = ?1 AND entity_b = ?2",
        &[sq(entity_a), sq(entity_b)],
    )?;
    if let Some(row) = existing.first() {
        let id = row
            .get("id")
            .and_then(JsonValue::as_str)
            .map(String::from)
            .ok_or("缺 id")?;
        exec(
            conn,
            "UPDATE memory_entity_edges SET cooccur_count = cooccur_count + 1, weight = weight + ?1 WHERE id = ?2",
            &[sqf(weight_increment), sq(&id)],
        )?;
    } else {
        let id = format!("edge-{created_at}");
        exec(
            conn,
            "INSERT INTO memory_entity_edges (id, entity_a, entity_b, weight, cooccur_count, created_at) VALUES (?1, ?2, ?3, ?4, 1, ?5)",
            &[sq(&id), sq(entity_a), sq(entity_b), sqf(weight_increment), sqi(created_at)],
        )?;
    }
    Ok(())
}

#[tauri::command]
pub async fn sp_entitygraph_find_by_names(
    app: AppHandle,
    names: Vec<String>,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_entitygraph_find_by_names_impl(conn, &names)
    })
    .await
}

fn sp_entitygraph_find_by_names_impl(
    conn: &Connection,
    names: &[String],
) -> Result<Vec<JsonValue>, String> {
    if names.is_empty() {
        return Ok(vec![]);
    }
    let n = names.len();
    let ph: Vec<String> = (1..=n).map(|i| format!("?{i}")).collect();
    let sql = format!(
        "SELECT id, name, type, memory_ids FROM memory_entities WHERE name IN ({})",
        ph.join(",")
    );
    let params: Vec<SqValue> = names.iter().map(|t| sq(t)).collect();
    json_rows(conn, &sql, &params)
}

#[tauri::command]
pub async fn sp_entitygraph_neighbors(
    app: AppHandle,
    entity_name: String,
) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| {
        sp_entitygraph_neighbors_impl(conn, &entity_name)
    })
    .await
}

fn sp_entitygraph_neighbors_impl(
    conn: &Connection,
    entity_name: &str,
) -> Result<Vec<JsonValue>, String> {
    let entity_id: Option<String> = scalar(
        conn,
        "SELECT id FROM memory_entities WHERE name = ?1",
        &[sq(entity_name)],
    )?;
    let Some(entity_id) = entity_id else {
        return Ok(vec![]);
    };
    let edge_rows = json_rows(
        conn,
        "SELECT entity_a, entity_b, weight FROM memory_entity_edges WHERE entity_a = ?1 OR entity_b = ?1",
        &[sq(&entity_id)],
    )?;
    let mut out = Vec::new();
    for e in edge_rows {
        let a = e.get("entity_a").and_then(JsonValue::as_str).unwrap_or("");
        let b = e.get("entity_b").and_then(JsonValue::as_str).unwrap_or("");
        let neighbor_id = if a == entity_id.as_str() {
            b.to_string()
        } else {
            a.to_string()
        };
        let name: Option<String> = scalar(
            conn,
            "SELECT name FROM memory_entities WHERE id = ?1",
            &[sq(&neighbor_id)],
        )?;
        if let Some(nm) = name {
            out.push(
                json!({ "neighbor": nm, "weight": e.get("weight").cloned().unwrap_or(json!(1.0)) }),
            );
        }
    }
    Ok(out)
}

// ============ zombie 数据清理（zombieDataCleanup） ============

#[tauri::command]
pub async fn sp_zombie_report(
    app: AppHandle,
    context_threshold: i64,
    entity_threshold: i64,
) -> Result<JsonValue, String> {
    with_conn(app, move |conn| {
        sp_zombie_report_impl(conn, context_threshold, entity_threshold)
    })
    .await
}

fn sp_zombie_report_impl(
    conn: &Connection,
    context_threshold: i64,
    entity_threshold: i64,
) -> Result<JsonValue, String> {
    let legacy = json_rows(
        conn,
        "SELECT COUNT(*) AS count, MIN(CASE WHEN updated_at > 0 THEN updated_at END) AS oldest FROM settings WHERE key LIKE '%.legacy'",
        &[],
    )?;
    let legacy_count: i64 = legacy
        .first()
        .and_then(|r| r.get("count").and_then(JsonValue::as_i64))
        .unwrap_or(0);
    let legacy_oldest: Option<i64> = legacy
        .first()
        .and_then(|r| r.get("oldest").and_then(JsonValue::as_i64))
        .filter(|v| *v > 0);
    let episode_count: i64 = scalar(
        conn,
        "SELECT COUNT(*) FROM context_episodes WHERE started_at < ?1",
        &[sqi(context_threshold)],
    )?
    .unwrap_or(0);
    let entity_count: i64 = scalar(
        conn,
        "SELECT COUNT(*) FROM entity_nodes WHERE last_seen < ?1 AND mention_count < 3",
        &[sqi(entity_threshold)],
    )?
    .unwrap_or(0);
    let bytes_rows = json_rows(
        conn,
        "SELECT value FROM settings WHERE key LIKE '%.legacy'",
        &[],
    )?;
    let bytes: usize = bytes_rows
        .iter()
        .map(|r| {
            r.get("value")
                .and_then(JsonValue::as_str)
                .map(|s| s.len())
                .unwrap_or(0)
        })
        .sum();
    Ok(json!({
        "legacyCount": legacy_count,
        "legacyOldest": legacy_oldest,
        "episodeCount": episode_count,
        "entityCount": entity_count,
        "bytes": bytes,
    }))
}

#[tauri::command]
pub async fn sp_zombie_cleanup_legacy(
    app: AppHandle,
    threshold: i64,
    force: bool,
    limit: i64,
) -> Result<usize, String> {
    with_conn(app, move |conn| {
        sp_zombie_cleanup_legacy_impl(conn, threshold, force, limit)
    })
    .await
}

fn sp_zombie_cleanup_legacy_impl(
    conn: &Connection,
    threshold: i64,
    force: bool,
    limit: i64,
) -> Result<usize, String> {
    if force {
        exec(
            conn,
            "DELETE FROM settings WHERE key LIKE '%.legacy' AND key IN (SELECT key FROM settings WHERE key LIKE '%.legacy' LIMIT ?1)",
            &[sqi(limit)],
        )
    } else {
        exec(
            conn,
            "DELETE FROM settings WHERE key LIKE '%.legacy' AND updated_at > 0 AND updated_at < ?1 AND key IN (SELECT key FROM settings WHERE key LIKE '%.legacy' AND updated_at > 0 AND updated_at < ?1 LIMIT ?2)",
            &[sqi(threshold), sqi(limit)],
        )
    }
}

#[tauri::command]
pub async fn sp_zombie_cleanup_episodes(
    app: AppHandle,
    threshold: i64,
    limit: i64,
) -> Result<usize, String> {
    with_conn(app, move |conn| {
        sp_zombie_cleanup_episodes_impl(conn, threshold, limit)
    })
    .await
}

fn sp_zombie_cleanup_episodes_impl(
    conn: &Connection,
    threshold: i64,
    limit: i64,
) -> Result<usize, String> {
    exec(
        conn,
        "DELETE FROM context_episodes WHERE id IN (SELECT id FROM context_episodes WHERE started_at < ?1 LIMIT ?2)",
        &[sqi(threshold), sqi(limit)],
    )
}

#[tauri::command]
pub async fn sp_zombie_cleanup_entities(
    app: AppHandle,
    threshold: i64,
    limit: i64,
) -> Result<usize, String> {
    with_conn(app, move |conn| {
        sp_zombie_cleanup_entities_impl(conn, threshold, limit)
    })
    .await
}

fn sp_zombie_cleanup_entities_impl(
    conn: &Connection,
    threshold: i64,
    limit: i64,
) -> Result<usize, String> {
    exec(
        conn,
        "DELETE FROM entity_nodes WHERE id IN (SELECT id FROM entity_nodes WHERE last_seen < ?1 AND mention_count < 3 LIMIT ?2)",
        &[sqi(threshold), sqi(limit)],
    )
}

// ============ schemaRunner（迁移标记 + 只读校验） ============

#[tauri::command]
pub async fn sp_schema_version_current(app: AppHandle) -> Result<i64, String> {
    with_conn(app, |conn| sp_schema_version_current_impl(conn)).await
}

fn sp_schema_version_current_impl(conn: &Connection) -> Result<i64, String> {
    // ⚠️ 必须 COALESCE：空表时 `MAX(version)` 返回的是 **NULL 值**（一行一列），
    // 而不是「没有行」——`scalar::<i64>` 会在 NULL 上 FromSql 失败并报
    // 「Invalid column type Null」，`.unwrap_or(0)` 兜不住。全新库上会直接报错。
    Ok(scalar::<i64>(
        conn,
        "SELECT COALESCE(MAX(version), 0) FROM schema_versions",
        &[],
    )?
    .unwrap_or(0))
}

#[tauri::command]
pub async fn sp_schema_version_applied(app: AppHandle, version: i64) -> Result<bool, String> {
    with_conn(app, move |conn| {
        sp_schema_version_applied_impl(conn, version)
    })
    .await
}

fn sp_schema_version_applied_impl(conn: &Connection, version: i64) -> Result<bool, String> {
    Ok(scalar::<i64>(
        conn,
        "SELECT COUNT(*) FROM schema_versions WHERE version = ?1",
        &[sqi(version)],
    )?
    .unwrap_or(0)
        > 0)
}

#[tauri::command]
pub async fn sp_schema_version_record(
    app: AppHandle,
    version: i64,
    description: String,
    sql_checksum: String,
) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_schema_version_record_impl(conn, version, &description, &sql_checksum)
    })
    .await
}

fn sp_schema_version_record_impl(
    conn: &Connection,
    version: i64,
    description: &str,
    sql_checksum: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    exec(
        conn,
        "INSERT INTO schema_versions (version, description, applied_at, sql_checksum) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(version) DO NOTHING",
        &[sqi(version), sq(description), sqi(now), sq(sql_checksum)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_schema_version_history(app: AppHandle) -> Result<Vec<JsonValue>, String> {
    with_conn(app, |conn| sp_schema_version_history_impl(conn)).await
}

fn sp_schema_version_history_impl(conn: &Connection) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT version, description, applied_at, sql_checksum FROM schema_versions ORDER BY version ASC",
        &[],
    )
}

#[tauri::command]
pub async fn sp_schema_log_failure(
    app: AppHandle,
    version: i64,
    error_message: String,
    sql_statement: Option<String>,
) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_schema_log_failure_impl(conn, version, &error_message, sql_statement.as_deref())
    })
    .await
}

fn sp_schema_log_failure_impl(
    conn: &Connection,
    version: i64,
    error_message: &str,
    sql_statement: Option<&str>,
) -> Result<(), String> {
    let now = chrono::Utc::now().timestamp_millis();
    exec(
        conn,
        "INSERT INTO schema_migration_log (version, attempted_at, error_message, sql_statement) VALUES (?1, ?2, ?3, ?4)",
        &[
            sqi(version),
            sqi(now),
            sq(error_message),
            sql_statement.map(sq).unwrap_or_else(sqn),
        ],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_schema_resolve_failure(
    app: AppHandle,
    log_id: i64,
    resolved_at: i64,
) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_schema_resolve_failure_impl(conn, log_id, resolved_at)
    })
    .await
}

fn sp_schema_resolve_failure_impl(
    conn: &Connection,
    log_id: i64,
    resolved_at: i64,
) -> Result<(), String> {
    exec(
        conn,
        "UPDATE schema_migration_log SET resolved = 1, resolved_at = ?1 WHERE id = ?2",
        &[sqi(resolved_at), sqi(log_id)],
    )?;
    Ok(())
}

#[tauri::command]
pub async fn sp_schema_unresolved(app: AppHandle) -> Result<Vec<JsonValue>, String> {
    with_conn(app, |conn| sp_schema_unresolved_impl(conn)).await
}

fn sp_schema_unresolved_impl(conn: &Connection) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT * FROM schema_migration_log WHERE resolved = 0 ORDER BY attempted_at DESC",
        &[],
    )
}

// ============ dirty_data_registry（dirtyDataTracker） ============

/// 运行全部脏数据检测并返回归一化 issues（检测逻辑集中在 Rust，静态 SQL）
#[tauri::command]
pub async fn sp_dirty_scan(app: AppHandle) -> Result<Vec<JsonValue>, String> {
    with_conn(app, move |conn| sp_dirty_scan_impl(conn)).await
}

fn sp_dirty_scan_impl(conn: &Connection) -> Result<Vec<JsonValue>, String> {
    let now = chrono::Utc::now().timestamp_millis();
    let mut issues: Vec<JsonValue> = Vec::new();

    // 1. inventory 孤引用
    for r in json_rows(
            conn,
            "SELECT i.id, i.character_id FROM inventory i LEFT JOIN characters c ON i.character_id = c.id WHERE i.character_id IS NOT NULL AND c.id IS NULL",
            &[],
        )? {
            let id = r.get("id").cloned().unwrap_or(JsonValue::Null);
            let cid = r.get("character_id").and_then(JsonValue::as_str).unwrap_or("");
            issues.push(json!({"table": "inventory", "column": "character_id", "rowId": id, "dataType": "ORPHAN_REFERENCE", "severity": "medium", "description": format!("背包物品引用的角色 {cid} 不存在"), "detectedAt": now}));
        }

    // 2. memories 孤引用
    for r in json_rows(
            conn,
            "SELECT m.id, m.character_id FROM memories m LEFT JOIN characters c ON m.character_id = c.id WHERE c.id IS NULL",
            &[],
        )? {
            let id = r.get("id").cloned().unwrap_or(JsonValue::Null);
            let cid = r.get("character_id").and_then(JsonValue::as_str).unwrap_or("");
            issues.push(json!({"table": "memories", "column": "character_id", "rowId": id, "dataType": "ORPHAN_REFERENCE", "severity": "medium", "description": format!("记忆引用角色 {cid} 不存在"), "detectedAt": now}));
        }

    // 3. characters.stats 非 JSON
    for r in json_rows(conn, "SELECT id, stats FROM characters", &[])? {
        let id = r.get("id").cloned().unwrap_or(JsonValue::Null);
        let stats = r.get("stats").and_then(JsonValue::as_str).unwrap_or("");
        if serde_json::from_str::<JsonValue>(stats).is_err() {
            let detail = stats.chars().take(100).collect::<String>();
            issues.push(json!({"table": "characters", "column": "stats", "rowId": id, "dataType": "DATA_TYPE_MISMATCH", "severity": "high", "description": format!("角色 {id} 的 stats 字段不是有效 JSON"), "details": detail, "detectedAt": now}));
        }
    }

    // 4. inventory.quantity 负数
    for r in json_rows(
        conn,
        "SELECT id, item_id, quantity FROM inventory WHERE quantity < 0",
        &[],
    )? {
        let id = r.get("id").cloned().unwrap_or(JsonValue::Null);
        let item = r.get("item_id").and_then(JsonValue::as_str).unwrap_or("");
        let qty = r.get("quantity").and_then(JsonValue::as_i64).unwrap_or(0);
        issues.push(json!({"table": "inventory", "column": "quantity", "rowId": id, "dataType": "BUSINESS_RULE_VIOLATION", "severity": "medium", "description": format!("背包物品 {item} 数量为负数 ({qty})"), "detectedAt": now}));
    }

    // 5. memories.importance 超界
    for r in json_rows(
        conn,
        "SELECT id, importance FROM memories WHERE importance < 0 OR importance > 100",
        &[],
    )? {
        let id = r.get("id").cloned().unwrap_or(JsonValue::Null);
        let imp = r.get("importance").and_then(JsonValue::as_i64).unwrap_or(0);
        issues.push(json!({"table": "memories", "column": "importance", "rowId": id, "dataType": "BUSINESS_RULE_VIOLATION", "severity": "low", "description": format!("记忆 {id} 的重要性值为 {imp}（有效范围 0-100）"), "detectedAt": now}));
    }

    // 6. memories.type 非法枚举
    let allowed_types: &[&str] = &[
        "episodic",
        "semantic",
        "procedural",
        "emotional",
        "preference",
        "fear",
        "dream",
        "event",
        "skill",
    ];
    {
        let ph: Vec<String> = (1..=allowed_types.len()).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "SELECT id, type FROM memories WHERE type NOT IN ({})",
            ph.join(",")
        );
        let params: Vec<SqValue> = allowed_types.iter().map(|t| sq(t)).collect();
        for r in json_rows(conn, &sql, &params)? {
            let id = r.get("id").cloned().unwrap_or(JsonValue::Null);
            let t = r.get("type").and_then(JsonValue::as_str).unwrap_or("");
            issues.push(json!({"table": "memories", "column": "type", "rowId": id, "dataType": "BUSINESS_RULE_VIOLATION", "severity": "low", "description": format!("记忆 {id} 的类型 \"{t}\" 不在允许范围内"), "detectedAt": now}));
        }
    }

    // 7. characters.stats NULL（NOT NULL 违反）
    for r in json_rows(conn, "SELECT id FROM characters WHERE stats IS NULL", &[])? {
        let id = r.get("id").cloned().unwrap_or(JsonValue::Null);
        issues.push(json!({"table": "characters", "column": "stats", "rowId": id, "dataType": "CONSTRAINT_VIOLATION", "severity": "high", "description": format!("角色 {id} 的 stats 字段违反 NOT NULL 约束"), "detectedAt": now}));
    }

    // 8. memory_id 重复
    for r in json_rows(
            conn,
            "SELECT character_id, memory_id, COUNT(*) AS cnt FROM memories WHERE memory_id IS NOT NULL GROUP BY character_id, memory_id HAVING COUNT(*) > 1 LIMIT 50",
            &[],
        )? {
            let cid = r.get("character_id").and_then(JsonValue::as_str).unwrap_or("");
            let mid = r.get("memory_id").and_then(JsonValue::as_str).unwrap_or("");
            let cnt = r.get("cnt").and_then(JsonValue::as_i64).unwrap_or(0);
            issues.push(json!({"table": "memories", "column": "memory_id", "rowId": mid, "dataType": "DUPLICATE_ENTRY", "severity": "medium", "description": format!("角色 {cid} 的记忆 memory_id={mid} 重复出现 {cnt} 次"), "detectedAt": now}));
        }

    // 9. 级联删除残留（表名来自编译期常量白名单）
    let remnant_tables: &[&str] = &[
        "memory_summaries",
        "memory_state",
        "commitments",
        "context_episodes",
        "owner_facts",
        "entity_nodes",
    ];
    for t in remnant_tables {
        let sql = format!(
                "SELECT t.rowid AS id FROM \"{t}\" t LEFT JOIN characters c ON t.character_id = c.id WHERE t.character_id IS NOT NULL AND c.id IS NULL LIMIT 50"
            );
        for r in json_rows(conn, &sql, &[])? {
            let id = r.get("id").cloned().unwrap_or(JsonValue::Null);
            issues.push(json!({"table": *t, "column": "character_id", "rowId": id, "dataType": "INCONSISTENT_STATE", "severity": "medium", "description": format!("表 {t} 残留引用已删除角色（行 id={id}）"), "detectedAt": now}));
        }
    }

    Ok(issues)
}

/// 写入脏数据问题（幂等：同 kind+target_id 的未解决记录更新时间戳）
#[tauri::command]
pub async fn sp_dirty_upsert(
    app: AppHandle,
    kind: String,
    target_id: String,
    payload: String,
    detected_at: i64,
) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_dirty_upsert_impl(conn, &kind, &target_id, &payload, detected_at)
    })
    .await
}

fn sp_dirty_upsert_impl(
    conn: &Connection,
    kind: &str,
    target_id: &str,
    payload: &str,
    detected_at: i64,
) -> Result<(), String> {
    let existing: Option<i64> = scalar(
        conn,
        "SELECT id FROM dirty_data_registry WHERE kind = ?1 AND target_id = ?2 AND resolved_at IS NULL LIMIT 1",
        &[sq(kind), sq(target_id)],
    )?;
    match existing {
        Some(id) => {
            exec(
                conn,
                "UPDATE dirty_data_registry SET detected_at = ?1, payload = ?2 WHERE id = ?3",
                &[sqi(detected_at), sq(payload), sqi(id)],
            )?;
        }
        None => {
            exec(
                conn,
                "INSERT INTO dirty_data_registry (kind, target_id, payload, detected_at) VALUES (?1, ?2, ?3, ?4)",
                &[sq(kind), sq(target_id), sq(payload), sqi(detected_at)],
            )?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn sp_dirty_resolve(app: AppHandle, id: i64, resolved_at: i64) -> Result<(), String> {
    with_conn(app, move |conn| {
        sp_dirty_resolve_impl(conn, id, resolved_at)
    })
    .await
}

fn sp_dirty_resolve_impl(conn: &Connection, id: i64, resolved_at: i64) -> Result<(), String> {
    exec(
        conn,
        "UPDATE dirty_data_registry SET resolved_at = ?1 WHERE id = ?2",
        &[sqi(resolved_at), sqi(id)],
    )?;
    Ok(())
}

/// 按表批量解决（target_id 前缀 `${table}::%`；pattern 为参数绑定）
#[tauri::command]
pub async fn sp_dirty_resolve_table(
    app: AppHandle,
    table: String,
    resolved_at: i64,
) -> Result<usize, String> {
    with_conn(app, move |conn| {
        sp_dirty_resolve_table_impl(conn, &table, resolved_at)
    })
    .await
}

fn sp_dirty_resolve_table_impl(
    conn: &Connection,
    table: &str,
    resolved_at: i64,
) -> Result<usize, String> {
    let prefix = format!("{table}::%");
    exec(
        conn,
        "UPDATE dirty_data_registry SET resolved_at = ?1 WHERE resolved_at IS NULL AND target_id LIKE ?2",
        &[sqi(resolved_at), sq(&prefix)],
    )
}

#[tauri::command]
pub async fn sp_dirty_list(app: AppHandle) -> Result<Vec<JsonValue>, String> {
    with_conn(app, |conn| sp_dirty_list_impl(conn)).await
}

fn sp_dirty_list_impl(conn: &Connection) -> Result<Vec<JsonValue>, String> {
    json_rows(
        conn,
        "SELECT id, kind, target_id, payload, detected_at, resolved_at FROM dirty_data_registry ORDER BY detected_at DESC",
        &[],
    )
}

#[tauri::command]
pub async fn sp_dirty_cleanup(app: AppHandle, threshold: i64) -> Result<usize, String> {
    with_conn(app, move |conn| sp_dirty_cleanup_impl(conn, threshold)).await
}

fn sp_dirty_cleanup_impl(conn: &Connection, threshold: i64) -> Result<usize, String> {
    exec(
        conn,
        "DELETE FROM dirty_data_registry WHERE resolved_at IS NOT NULL AND resolved_at < ?1",
        &[sqi(threshold)],
    )
}

/// 批量嵌入项（serde camelCase 与前端参数对齐）
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmbedItem {
    pub memory_id: i64,
    pub embedding_b64: String,
}

// ============ 单元测试（内存库，不依赖 Tauri） ============

#[cfg(test)]
mod tests {
    use super::*;

    fn mem_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        ensure_schema(&conn).unwrap();
        conn
    }

    // ===== 辅助函数纯逻辑测试（第二轮 P1-3 补强：SqValue 构造与 JSON 取值） =====

    #[test]
    fn test_sq_value_constructors() {
        assert_eq!(sq("abc"), rusqlite::types::Value::Text("abc".into()));
        assert_eq!(sqi(42), rusqlite::types::Value::Integer(42));
        assert_eq!(sqf(3.5), rusqlite::types::Value::Real(3.5));
        assert_eq!(sqn(), rusqlite::types::Value::Null);
    }

    #[test]
    fn test_json_getters_present_and_missing() {
        let v = json!({ "a": "x", "n": 7, "f": 1.5, "b": true });
        assert_eq!(gs(&v, "a").as_deref(), Some("x"));
        assert_eq!(gi(&v, "n"), Some(7));
        assert_eq!(gf(&v, "f"), Some(1.5));
        assert_eq!(gbool(&v, "b"), Some(true));
        assert_eq!(gs(&v, "missing"), None);
        assert_eq!(gi(&v, "missing"), None);
        assert_eq!(gf(&v, "missing"), None);
        assert_eq!(gbool(&v, "missing"), None);
    }

    #[test]
    fn test_json_getters_type_mismatch_returns_none() {
        let v = json!({ "s": "x", "i": 7 });
        assert_eq!(gi(&v, "s"), None);
        assert_eq!(gs(&v, "i"), None);
        assert_eq!(gbool(&v, "i"), None);
    }

    #[test]
    fn test_json_or_uses_default_when_none() {
        assert_eq!(json_or(None, 5), 5);
        assert_eq!(json_or(Some(3), 5), 3);
    }

    #[test]
    fn test_schema_idempotent() {
        let conn = mem_conn();
        // 二次执行不报错（幂等）
        ensure_schema(&conn).unwrap();
        assert!(column_exists(&conn, "memories", "tier").unwrap());
        assert!(column_exists(&conn, "settings", "updated_at").unwrap());
        assert!(column_exists(&conn, "commitments", "repeat").unwrap());
    }

    #[test]
    fn test_settings_roundtrip() {
        let conn = mem_conn();
        exec(
            &conn,
            "INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)",
            &[sq("k1"), sq("v1"), sqi(1)],
        )
        .unwrap();
        let v: Option<String> = scalar(
            &conn,
            "SELECT value FROM settings WHERE key = ?1",
            &[sq("k1")],
        )
        .unwrap();
        assert_eq!(v.as_deref(), Some("v1"));
        let missing: Option<String> = scalar(
            &conn,
            "SELECT value FROM settings WHERE key = ?1",
            &[sq("nope")],
        )
        .unwrap();
        assert!(missing.is_none());
    }

    #[test]
    fn test_memory_row_and_embedding_roundtrip() {
        let conn = mem_conn();
        // 模拟 sp_mem_add
        let now = 1_700_000_000_000i64;
        exec(
            &conn,
            "INSERT INTO memories (character_id, type, content, importance, created_at, last_accessed)
             VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
            &[sq("charA"), sq("long_term"), sq("记得喂食"), sqi(80), sqi(now)],
        )
        .unwrap();
        let row_id: i64 = scalar(&conn, "SELECT last_insert_rowid()", &[])
            .unwrap()
            .unwrap();
        // 嵌入 base64 写入（与原前端格式一致：TEXT 存 base64）
        exec(
            &conn,
            "UPDATE memories SET embedding = ?1 WHERE id = ?2",
            &[sq("QUJDRA=="), sqi(row_id)],
        )
        .unwrap();
        let rows = json_rows(
            &conn,
            "SELECT id, embedding FROM memories WHERE character_id = ?1",
            &[sq("charA")],
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], json!(row_id));
        assert_eq!(rows[0]["embedding"], json!("QUJDRA=="));
    }

    #[test]
    fn test_mem_by_tier_in_clause() {
        let conn = mem_conn();
        exec(
            &conn,
            "INSERT INTO memories (character_id, type, content, created_at, last_accessed, tier)
             VALUES (?1, ?2, ?3, ?4, ?4, ?5)",
            &[sq("c"), sq("long_term"), sq("a"), sqi(1), sq("episodic")],
        )
        .unwrap();
        exec(
            &conn,
            "INSERT INTO memories (character_id, type, content, created_at, last_accessed, tier)
             VALUES (?1, ?2, ?3, ?4, ?4, ?5)",
            &[
                sq("c"),
                sq("long_term"),
                sq("b"),
                sqi(2),
                sq("autobiographical"),
            ],
        )
        .unwrap();
        // 白名单字段名 + 参数绑定（模拟 sp_mem_update_row 的语义）
        let tiers = vec!["episodic".to_string()];
        let n = tiers.len();
        let ph: Vec<String> = (2..=n + 1).map(|i| format!("?{i}")).collect();
        let sql = format!(
            "SELECT content FROM memories WHERE character_id = ?1 AND tier IN ({}) ORDER BY created_at ASC",
            ph.join(",")
        );
        let mut params: Vec<SqValue> = vec![sq("c")];
        params.extend(tiers.into_iter().map(|t| sq(&t)));
        let rows = json_rows(&conn, &sql, &params).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["content"], json!("a"));
    }

    #[test]
    fn test_owner_facts_upsert_invalidates_old() {
        let conn = mem_conn();
        let row1 = json!({"character_id": "c", "fact_id": "f1", "fact_key": "name", "fact_value": "旧", "confidence": 0.5});
        let character_id = "c".to_string();
        let fact_key = "name".to_string();
        let now = 5i64;
        exec(
            &conn,
            "INSERT INTO owner_facts (character_id, fact_id, fact_key, fact_value, confidence, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            &[sq(&character_id), sq("f1"), sq(&fact_key), sq("旧"), sqf(0.5), sqi(now)],
        )
        .unwrap();
        // 模拟 upsert：先标记旧值失效
        let old_id: Option<i64> = scalar(
            &conn,
            "SELECT id FROM owner_facts WHERE character_id = ?1 AND fact_key = ?2 AND (invalid_at IS NULL OR invalid_at > ?3) LIMIT 1",
            &[sq(&character_id), sq(&fact_key), sqi(now)],
        )
        .unwrap();
        assert!(old_id.is_some());
        exec(
            &conn,
            "UPDATE owner_facts SET invalid_at = ?1, superseded_by = ?2 WHERE id = ?3",
            &[
                sqi(now),
                sqi(gi(&row1, "id").unwrap_or(0)),
                sqi(old_id.unwrap()),
            ],
        )
        .unwrap();
        let stale: Option<i64> = scalar(
            &conn,
            "SELECT COUNT(*) FROM owner_facts WHERE character_id = ?1 AND invalid_at IS NOT NULL",
            &[sq("c")],
        )
        .unwrap();
        assert_eq!(stale, Some(1));
    }

    #[test]
    fn test_update_row_field_allowlist_ignores_unknown() {
        let conn = mem_conn();
        exec(
            &conn,
            "INSERT INTO memories (character_id, type, content, created_at, last_accessed)
             VALUES ('c','long_term','x',1,1)",
            &[],
        )
        .unwrap();
        let id: i64 = scalar(&conn, "SELECT last_insert_rowid()", &[])
            .unwrap()
            .unwrap();
        // clone sp_mem_update_row 的白名单过滤逻辑
        let fields =
            json!({"character_id": "evil", "content": "new-content", "DROP TABLE memories": 1});
        let obj = fields.as_object().unwrap();
        let mut sets: Vec<String> = Vec::new();
        let mut params: Vec<SqValue> = Vec::new();
        for (k, v) in obj {
            if !MEMORY_UPDATABLE.contains(&k.as_str()) {
                continue;
            }
            let val = match v {
                JsonValue::String(s) => sq(s),
                _ => continue,
            };
            sets.push(format!("{k} = ?{}", sets.len() + 1));
            params.push(val);
        }
        params.push(sqi(id));
        let sql = format!(
            "UPDATE memories SET {} WHERE id = ?{}",
            sets.join(", "),
            sets.len() + 1
        );
        exec(&conn, &sql, &params).unwrap();
        let content: Option<String> = scalar(
            &conn,
            "SELECT content FROM memories WHERE id = ?1",
            &[sqi(id)],
        )
        .unwrap();
        assert_eq!(content.as_deref(), Some("new-content"));
        // character_id 未被篡改
        let cid: Option<String> = scalar(
            &conn,
            "SELECT character_id FROM memories WHERE id = ?1",
            &[sqi(id)],
        )
        .unwrap();
        assert_eq!(cid.as_deref(), Some("c"));
    }

    // ===== 第三轮补强：数据访问辅助函数（json_rows / exec / scalar / column_exists / ensure_column） =====

    #[test]
    fn test_json_rows_maps_columns_and_all_types() {
        let conn = mem_conn();
        // 覆盖 vref_to_json 的四个分支：Null / Integer / Real / Text
        let rows = json_rows(&conn, "SELECT NULL AS n, 7 AS i, 1.5 AS f, 'x' AS t", &[]).unwrap();
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!(r["n"], JsonValue::Null);
        assert_eq!(r["i"], json!(7));
        assert_eq!(r["f"], json!(1.5));
        assert_eq!(r["t"], json!("x"));
    }

    #[test]
    fn test_json_rows_blob_becomes_base64() {
        let conn = mem_conn();
        // 历史 embedding 列可能写 BLOB → vref_to_json 应转 base64 字符串而非报错
        let rows = json_rows(
            &conn,
            "SELECT ?1 AS b",
            &[rusqlite::types::Value::Blob(vec![0xDE, 0xAD, 0xBE, 0xEF])],
        )
        .unwrap();
        assert_eq!(rows[0]["b"], json!("3q2+7w=="));
    }

    #[test]
    fn test_json_rows_multiple_rows_and_params() {
        let conn = mem_conn();
        exec(&conn, "CREATE TABLE t (id INTEGER, name TEXT)", &[]).unwrap();
        for i in 0..3 {
            exec(
                &conn,
                "INSERT INTO t (id, name) VALUES (?1, ?2)",
                &[sqi(i), sq(&format!("n{i}"))],
            )
            .unwrap();
        }
        let rows = json_rows(
            &conn,
            "SELECT id, name FROM t WHERE id >= ?1 ORDER BY id",
            &[sqi(1)],
        )
        .unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["id"], json!(1));
        assert_eq!(rows[0]["name"], json!("n1"));
        assert_eq!(rows[1]["name"], json!("n2"));
    }

    #[test]
    fn test_json_rows_sql_error_is_reported() {
        let conn = mem_conn();
        // 预编译失败路径（表不存在）
        let e = json_rows(&conn, "SELECT * FROM __no_such_table__", &[]).unwrap_err();
        assert!(e.contains("SQL 预编译失败"), "实际报错: {e}");
    }

    #[test]
    fn test_exec_returns_affected_rows() {
        let conn = mem_conn();
        exec(&conn, "CREATE TABLE t (id INTEGER)", &[]).unwrap();
        let n = exec(
            &conn,
            "INSERT INTO t (id) VALUES (?1), (?2)",
            &[sqi(1), sqi(2)],
        )
        .unwrap();
        assert_eq!(n, 2);
        let n = exec(&conn, "UPDATE t SET id = id + 10 WHERE id = 1", &[]).unwrap();
        assert_eq!(n, 1);
    }

    #[test]
    fn test_exec_sql_error_is_reported() {
        let conn = mem_conn();
        let e = exec(&conn, "INSERT INTO __no_such_table__ (id) VALUES (1)", &[]).unwrap_err();
        assert!(e.contains("SQL 执行失败"), "实际报错: {e}");
    }

    #[test]
    fn test_scalar_some_none_and_error() {
        let conn = mem_conn();
        // None（无行）
        let v: Option<i64> = scalar(&conn, "SELECT 1 WHERE 0", &[]).unwrap();
        assert_eq!(v, None);
        // Some
        let v: Option<i64> = scalar(&conn, "SELECT 41 + 1", &[]).unwrap();
        assert_eq!(v, Some(42));
        // 参数化
        let v: Option<String> = scalar(&conn, "SELECT ?1", &[sq("hi")]).unwrap();
        assert_eq!(v.as_deref(), Some("hi"));
        // 错误路径
        let e = scalar::<i64>(&conn, "SELECT * FROM __no_such_table__", &[]).unwrap_err();
        assert!(e.contains("标量查询失败"), "实际报错: {e}");
    }

    #[test]
    fn test_column_exists_false_for_unknown() {
        let conn = mem_conn();
        assert!(!column_exists(&conn, "memories", "__no_such_column__").unwrap());
        // 表名也不存在时同样为 false（而非报错）
        assert!(!column_exists(&conn, "__no_such_table__", "x").unwrap());
    }

    #[test]
    fn test_ensure_column_adds_then_is_idempotent() {
        let conn = mem_conn();
        assert!(!column_exists(&conn, "memories", "probe_col").unwrap());
        ensure_column(
            &conn,
            "memories",
            "probe_col",
            "ALTER TABLE memories ADD COLUMN probe_col TEXT NOT NULL DEFAULT ''",
        )
        .unwrap();
        assert!(column_exists(&conn, "memories", "probe_col").unwrap());
        // 二次调用直接跳过（幂等，不因重复加列报错）
        ensure_column(
            &conn,
            "memories",
            "probe_col",
            "ALTER TABLE memories ADD COLUMN probe_col TEXT NOT NULL DEFAULT ''",
        )
        .unwrap();
        assert!(column_exists(&conn, "memories", "probe_col").unwrap());
    }

    #[test]
    fn test_scalar_type_mismatch_is_error() {
        let conn = mem_conn();
        // 取 Text 列但声明 i64 → FromSql 失败，应走错误路径而非 panic
        let e = scalar::<i64>(&conn, "SELECT 'not-a-number'", &[]).unwrap_err();
        assert!(e.contains("标量查询失败"), "实际报错: {e}");
    }

    // ===== 命令层 impl（D-1 可测化：`sp_*` 只转发，逻辑在 `*_impl`）=====

    #[test]
    fn test_settings_impl_upsert_and_remove() {
        let conn = mem_conn();
        assert_eq!(sp_settings_get_impl(&conn, "k").unwrap(), None);
        sp_settings_set_impl(&conn, "k", "v1").unwrap();
        assert_eq!(
            sp_settings_get_impl(&conn, "k").unwrap().as_deref(),
            Some("v1")
        );
        // 同键二次写入走 ON CONFLICT(key) DO UPDATE 分支
        sp_settings_set_impl(&conn, "k", "v2").unwrap();
        assert_eq!(
            sp_settings_get_impl(&conn, "k").unwrap().as_deref(),
            Some("v2")
        );
        sp_settings_remove_impl(&conn, "k").unwrap();
        assert_eq!(sp_settings_get_impl(&conn, "k").unwrap(), None);
        // 删除不存在的键应静默成功（幂等）
        sp_settings_remove_impl(&conn, "k").unwrap();
    }

    #[test]
    fn test_char_stats_impl_roundtrip() {
        let conn = mem_conn();
        assert_eq!(sp_char_get_stats_impl(&conn, "c1").unwrap(), None);
        sp_char_save_stats_impl(&conn, "c1", r#"{"hp":10}"#).unwrap();
        assert_eq!(
            sp_char_get_stats_impl(&conn, "c1").unwrap().as_deref(),
            Some(r#"{"hp":10}"#)
        );
        // 同 id 二次写入走 upsert
        sp_char_save_stats_impl(&conn, "c1", r#"{"hp":20}"#).unwrap();
        let rows = sp_char_list_impl(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["id"], json!("c1"));
        assert_eq!(rows[0]["stats"], json!(r#"{"hp":20}"#));
        assert!(rows[0]["updated_at"].as_i64().unwrap() > 0);
    }

    #[test]
    fn test_mem_add_impl_default_and_explicit_importance() {
        let conn = mem_conn();
        let a = sp_mem_add_impl(&conn, "c1", "episodic", "记得喂食", None).unwrap();
        let b = sp_mem_add_impl(&conn, "c1", "long_term", "生日是三月", Some(90)).unwrap();
        assert!(a > 0 && b > a, "rowid 应递增: {a} / {b}");

        let rows = sp_mem_list_impl(&conn, "c1", None).unwrap();
        assert_eq!(rows.len(), 2);
        let importance: std::collections::HashMap<i64, i64> = rows
            .iter()
            .map(|r| (r["id"].as_i64().unwrap(), r["importance"].as_i64().unwrap()))
            .collect();
        assert_eq!(importance[&a], 50, "缺省 importance 应为 50");
        assert_eq!(importance[&b], 90);
    }

    #[test]
    fn test_mem_list_impl_type_filter_and_isolation() {
        let conn = mem_conn();
        sp_mem_add_impl(&conn, "c1", "episodic", "a", None).unwrap();
        sp_mem_add_impl(&conn, "c1", "long_term", "b", None).unwrap();
        sp_mem_add_impl(&conn, "c2", "episodic", "c", None).unwrap();

        assert_eq!(sp_mem_list_impl(&conn, "c1", None).unwrap().len(), 2);
        let only_long = sp_mem_list_impl(&conn, "c1", Some("long_term")).unwrap();
        assert_eq!(only_long.len(), 1);
        assert_eq!(only_long[0]["content"], json!("b"));
        // 类型不存在 → 空集（不是报错）
        assert!(sp_mem_list_impl(&conn, "c1", Some("nope"))
            .unwrap()
            .is_empty());
        // 角色隔离
        assert_eq!(sp_mem_list_impl(&conn, "c2", None).unwrap().len(), 1);
    }

    #[test]
    fn test_mem_embeddings_impl_filters_and_limit() {
        let conn = mem_conn();
        let a = sp_mem_add_impl(&conn, "c1", "episodic", "a", None).unwrap();
        let _b = sp_mem_add_impl(&conn, "c1", "long_term", "b", None).unwrap();
        let c = sp_mem_add_impl(&conn, "c2", "episodic", "c", None).unwrap();

        // 全部无嵌入 → 空集
        assert!(sp_mem_get_embeddings_impl(&conn, None, None, None)
            .unwrap()
            .is_empty());

        sp_mem_save_embedding_impl(&conn, a, "AAA=").unwrap();
        sp_mem_save_embedding_impl(&conn, c, "CCC=").unwrap();

        assert_eq!(
            sp_mem_get_embeddings_impl(&conn, None, None, None)
                .unwrap()
                .len(),
            2
        );
        let c1 = sp_mem_get_embeddings_impl(&conn, Some("c1"), None, None).unwrap();
        assert_eq!(c1.len(), 1);
        assert_eq!(c1[0]["embedding"], json!("AAA="));
        // c1 的 long_term 行没有嵌入 → 空集
        assert!(
            sp_mem_get_embeddings_impl(&conn, Some("c1"), None, Some("long_term"))
                .unwrap()
                .is_empty()
        );
        // limit 生效
        assert_eq!(
            sp_mem_get_embeddings_impl(&conn, None, Some(1), None)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn test_mem_save_embeddings_batch_impl() {
        let mut conn = mem_conn();
        let a = sp_mem_add_impl(&conn, "c1", "episodic", "a", None).unwrap();
        let b = sp_mem_add_impl(&conn, "c1", "episodic", "b", None).unwrap();

        // 空批次：不开启事务、直接返回
        sp_mem_save_embeddings_batch_impl(&mut conn, &[]).unwrap();
        assert!(sp_mem_get_embeddings_impl(&conn, Some("c1"), None, None)
            .unwrap()
            .is_empty());

        let items = vec![
            EmbedItem {
                memory_id: a,
                embedding_b64: "QQ==".to_string(),
            },
            EmbedItem {
                memory_id: b,
                embedding_b64: "Qg==".to_string(),
            },
        ];
        sp_mem_save_embeddings_batch_impl(&mut conn, &items).unwrap();
        assert_eq!(
            sp_mem_get_embeddings_impl(&conn, Some("c1"), None, None)
                .unwrap()
                .len(),
            2
        );
    }

    #[test]
    fn test_mem_touch_delete_clear_impl() {
        let conn = mem_conn();
        let a = sp_mem_add_impl(&conn, "c1", "episodic", "a", None).unwrap();
        let b = sp_mem_add_impl(&conn, "c1", "episodic", "b", None).unwrap();

        let read_accessed = |id: i64| -> i64 {
            scalar(
                &conn,
                "SELECT last_accessed FROM memories WHERE id = ?1",
                &[sqi(id)],
            )
            .unwrap()
            .unwrap()
        };
        let before = read_accessed(a);
        std::thread::sleep(std::time::Duration::from_millis(2));
        sp_mem_touch_impl(&conn, a).unwrap();
        assert!(
            read_accessed(a) >= before,
            "touch 后 last_accessed 不应回退"
        );

        sp_mem_delete_impl(&conn, b).unwrap();
        assert_eq!(sp_mem_list_impl(&conn, "c1", None).unwrap().len(), 1);

        sp_mem_clear_impl(&conn, "c1").unwrap();
        assert!(sp_mem_list_impl(&conn, "c1", None).unwrap().is_empty());
        // 清空不存在的角色同样幂等
        sp_mem_clear_impl(&conn, "c1").unwrap();
    }

    // ===== 第二批：commitments / context_episodes / entityGraph =====

    #[test]
    fn test_commitments_insert_list_and_status() {
        let conn = mem_conn();
        let id = sp_commitments_insert_impl(
            &conn,
            "c1",
            "给主人买猫粮",
            "assistant",
            Some(1000),
            None,
            None,
        )
        .unwrap();
        assert!(id > 0);

        let open = sp_commitments_list_impl(&conn, "c1").unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0]["status"], json!("open"));
        assert_eq!(open[0]["follow_up_count"], json!(0));

        // 状态白名单：非法值拒绝，合法值生效
        assert!(sp_commitments_set_status_impl(&conn, id, "bogus").is_err());
        sp_commitments_set_status_impl(&conn, id, "fulfilled").unwrap();
        assert!(sp_commitments_list_impl(&conn, "c1").unwrap().is_empty());
    }

    #[test]
    fn test_commitments_due_and_overdue_windows() {
        let conn = mem_conn();
        let _early =
            sp_commitments_insert_impl(&conn, "c1", "a", "assistant", Some(500), None, None)
                .unwrap();
        let mid = sp_commitments_insert_impl(&conn, "c1", "b", "assistant", Some(1500), None, None)
            .unwrap();
        let _late =
            sp_commitments_insert_impl(&conn, "c1", "c", "assistant", Some(2500), None, None)
                .unwrap();

        // due 是半开区间 [start, end)
        let due = sp_commitments_due_impl(&conn, "c1", 1000, 2000).unwrap();
        assert_eq!(due.len(), 1);
        assert_eq!(due[0]["id"], json!(mid));

        // overdue 是 (before, now)
        let overdue = sp_commitments_overdue_impl(&conn, "c1", 2000, 100).unwrap();
        assert_eq!(overdue.len(), 2);
    }

    #[test]
    fn test_commitments_follow_up_and_auto_lapse() {
        let conn = mem_conn();
        let id = sp_commitments_insert_impl(&conn, "c1", "x", "assistant", Some(100), None, None)
            .unwrap();
        sp_commitments_increment_follow_up_impl(&conn, id).unwrap();
        sp_commitments_increment_follow_up_impl(&conn, id).unwrap();
        let rows = sp_commitments_list_impl(&conn, "c1").unwrap();
        assert_eq!(rows[0]["follow_up_count"], json!(2));

        // 过期自动失效，返回受影响行数
        assert_eq!(sp_commitments_auto_lapse_impl(&conn, "c1", 200).unwrap(), 1);
        assert!(sp_commitments_list_impl(&conn, "c1").unwrap().is_empty());
        // 已 lapsed 的不再被重复计入
        assert_eq!(sp_commitments_auto_lapse_impl(&conn, "c1", 200).unwrap(), 0);
    }

    #[test]
    fn test_commitments_recurring_done_and_open_recent() {
        let conn = mem_conn();
        let recurring = sp_commitments_insert_impl(
            &conn,
            "c1",
            "每天喂猫",
            "assistant",
            Some(10),
            None,
            Some("daily"),
        )
        .unwrap();
        let plain =
            sp_commitments_insert_impl(&conn, "c1", "一次性", "assistant", Some(10), None, None)
                .unwrap();

        // open 状态下不算「已完成」
        assert!(sp_commitments_recurring_done_impl(&conn, "c1")
            .unwrap()
            .is_empty());
        sp_commitments_set_status_impl(&conn, recurring, "fulfilled").unwrap();
        sp_commitments_set_status_impl(&conn, plain, "fulfilled").unwrap();
        let done = sp_commitments_recurring_done_impl(&conn, "c1").unwrap();
        assert_eq!(done.len(), 1, "只有带 repeat 的约定才算 recurring");
        assert_eq!(done[0]["id"], json!(recurring));

        // open_recent：只返回 open 且 created_at > since 的同名约定
        assert!(sp_commitments_open_recent_impl(&conn, "c1", "每天喂猫", 0)
            .unwrap()
            .is_empty());
        let new_id = sp_commitments_insert_impl(
            &conn,
            "c1",
            "每天喂猫",
            "assistant",
            None,
            None,
            Some("daily"),
        )
        .unwrap();
        let recent = sp_commitments_open_recent_impl(&conn, "c1", "每天喂猫", 0).unwrap();
        assert_eq!(recent.len(), 1);
        assert_eq!(recent[0]["id"], json!(new_id));
    }

    #[test]
    fn test_ctx_insert_close_and_list() {
        let conn = mem_conn();
        let a = sp_ctx_insert_impl(
            &conn,
            "c1",
            100,
            Some("coding"),
            Some("sunny"),
            Some(5),
            Some("lofi"),
        )
        .unwrap();
        let _b = sp_ctx_insert_impl(&conn, "c1", 300, None, None, None, None).unwrap();
        let _other = sp_ctx_insert_impl(&conn, "c2", 200, None, None, None, None).unwrap();

        // 无 end：只按起点过滤
        assert_eq!(sp_ctx_list_impl(&conn, "c1", 0, None).unwrap().len(), 2);
        // 有 end：半开区间，且角色隔离
        let window = sp_ctx_list_impl(&conn, "c1", 0, Some(200)).unwrap();
        assert_eq!(window.len(), 1);
        assert_eq!(window[0]["id"], json!(a));
        assert_eq!(window[0]["work_state"], json!("coding"));

        sp_ctx_close_impl(&conn, a, 150).unwrap();
        let closed = sp_ctx_list_impl(&conn, "c1", 0, Some(200)).unwrap();
        assert_eq!(closed[0]["ended_at"], json!(150));
    }

    #[test]
    fn test_entitygraph_node_upsert_and_find() {
        let conn = mem_conn();
        let id1 = sp_entitygraph_upsert_node_impl(&conn, "小橘", "cat", "m1", "ent-1", 100, None)
            .unwrap();
        assert_eq!(id1, "ent-1");

        // 同 name+type 复用节点 id，追加 memory_ids
        let id2 =
            sp_entitygraph_upsert_node_impl(&conn, "小橘", "cat", "m2", "ent-2", 100, Some("EMB="))
                .unwrap();
        assert_eq!(id2, "ent-1");
        // 重复 memory_id 不重复追加
        let id3 = sp_entitygraph_upsert_node_impl(&conn, "小橘", "cat", "m2", "ent-3", 100, None)
            .unwrap();
        assert_eq!(id3, "ent-1");

        let rows = sp_entitygraph_find_by_names_impl(&conn, &["小橘".to_string()]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["memory_ids"], json!("[\"m1\",\"m2\"]"));

        // 空名单直接返回空集（不拼 SQL）；未命中同样空集
        assert!(sp_entitygraph_find_by_names_impl(&conn, &[])
            .unwrap()
            .is_empty());
        assert!(
            sp_entitygraph_find_by_names_impl(&conn, &["不存在".to_string()])
                .unwrap()
                .is_empty()
        );
    }

    #[test]
    fn test_entitygraph_edges_and_neighbors() {
        let conn = mem_conn();
        let a = sp_entitygraph_upsert_node_impl(&conn, "小橘", "cat", "m1", "ent-a", 100, None)
            .unwrap();
        let b = sp_entitygraph_upsert_node_impl(&conn, "猫粮", "object", "m1", "ent-b", 100, None)
            .unwrap();

        // 首条边 INSERT，重复边 UPDATE（权重累加 + 共现次数 +1）
        sp_entitygraph_upsert_edge_impl(&conn, &a, &b, 1.5, 500).unwrap();
        sp_entitygraph_upsert_edge_impl(&conn, &a, &b, 0.5, 600).unwrap();

        let nbrs = sp_entitygraph_neighbors_impl(&conn, "小橘").unwrap();
        assert_eq!(nbrs.len(), 1);
        assert_eq!(nbrs[0]["neighbor"], json!("猫粮"));
        assert_eq!(nbrs[0]["weight"], json!(2.0));

        // 反向同样可达（entity_a / entity_b 都参与匹配）
        let rev = sp_entitygraph_neighbors_impl(&conn, "猫粮").unwrap();
        assert_eq!(rev[0]["neighbor"], json!("小橘"));

        assert!(sp_entitygraph_neighbors_impl(&conn, "不存在")
            .unwrap()
            .is_empty());
    }

    // ===== 第三批：owner_facts / memory_semantic_facts / pet_exp / visual / entity_nodes =====

    #[test]
    fn test_owner_facts_as_of_window_and_history() {
        let conn = mem_conn();
        for (key, val, id) in [("a", "A", 1), ("b", "B", 2), ("c", "C", 3)] {
            sp_owner_facts_upsert_impl(
                &conn,
                &json!({"character_id":"c1","fact_key":key,"fact_value":val,"id":id}),
            )
            .unwrap();
        }
        // 手工构造时间窗：b 在 [100,200) 内有效；c 在 [10,50) 内有效；a 保持 valid_at=now 且无失效
        exec(
            &conn,
            "UPDATE owner_facts SET valid_at = 100, invalid_at = 200 WHERE fact_key = 'b'",
            &[],
        )
        .unwrap();
        exec(
            &conn,
            "UPDATE owner_facts SET valid_at = 10, invalid_at = 50 WHERE fact_key = 'c'",
            &[],
        )
        .unwrap();

        let keys_at = |t: i64| -> Vec<String> {
            sp_owner_facts_as_of_impl(&conn, "c1", t)
                .unwrap()
                .iter()
                .filter_map(|r| r["fact_key"].as_str().map(String::from))
                .collect()
        };
        assert!(keys_at(150).contains(&"b".to_string()), "150 落在 b 的窗内");
        assert!(
            !keys_at(150).contains(&"c".to_string()),
            "150 已超出 c 的窗"
        );
        assert!(keys_at(20).contains(&"c".to_string()), "20 落在 c 的窗内");
        assert!(
            !keys_at(20).contains(&"b".to_string()),
            "20 早于 b 的 valid_at"
        );
        // a 的 valid_at = now（毫秒时间戳），两个查询点都早于它 → 均不可见
        assert!(!keys_at(150).contains(&"a".to_string()));

        // history 只收 invalid_at 非空的（b、c）
        let hist = sp_owner_facts_history_impl(&conn, "c1").unwrap();
        assert_eq!(hist.len(), 2);
        // 全量 list 不筛时间窗
        assert_eq!(sp_owner_facts_list_impl(&conn, "c1").unwrap().len(), 3);

        // delete / clear
        sp_owner_facts_delete_impl(&conn, "c1", "a").unwrap();
        assert_eq!(sp_owner_facts_list_impl(&conn, "c1").unwrap().len(), 2);
        sp_owner_facts_clear_impl(&conn, "c1").unwrap();
        assert!(sp_owner_facts_list_impl(&conn, "c1").unwrap().is_empty());
    }

    /// ⚠️ 该用例记录的是**当前实现的真实行为**，不是期望行为。
    ///
    /// 表上有 `CREATE UNIQUE INDEX idx_owner_facts_char_key ON owner_facts(character_id, fact_key)`，
    /// 于是 `sp_owner_facts_upsert_impl` 里「同 key 有效旧值先标记失效」的 UPDATE 与随后的
    /// `ON CONFLICT(character_id, fact_key) DO UPDATE` 作用在**同一行**：
    /// 结果是该行被写上 invalid_at，新值覆盖旧值 —— 版本化设计（invalid_at / superseded_by /
    /// history 查询）与唯一索引互相矛盾，同 key 二次 upsert 后该事实在 `as_of(now)` 里不可见。
    /// 这里只断言「分支确实执行了」，不把该行为固化成期望值；修复需单开 issue。
    #[test]
    fn test_owner_facts_impl_supersede_marks_row_invalid() {
        let conn = mem_conn();
        sp_owner_facts_upsert_impl(
            &conn,
            &json!({"character_id":"c1","fact_key":"city","fact_value":"杭州","id":1}),
        )
        .unwrap();
        sp_owner_facts_upsert_impl(
            &conn,
            &json!({"character_id":"c1","fact_key":"city","fact_value":"上海","id":2}),
        )
        .unwrap();

        let rows = sp_owner_facts_list_impl(&conn, "c1").unwrap();
        assert_eq!(rows.len(), 1, "唯一索引决定同 key 只有一行");
        assert_eq!(
            rows[0]["fact_value"],
            json!("上海"),
            "ON CONFLICT 覆盖为新值"
        );
        assert!(
            rows[0]["invalid_at"].is_number(),
            "supersede 分支确实把该行标记为失效"
        );
        assert_eq!(rows[0]["superseded_by"], json!(2));
    }

    #[test]
    fn test_sem_facts_impl_upsert_count_and_source_ids() {
        let conn = mem_conn();
        assert_eq!(sp_sem_facts_count_impl(&conn, "c1").unwrap(), 0);

        // source_memory_ids 三种形态：数组 / 字符串 / 缺失
        sp_sem_facts_upsert_impl(
            &conn,
            &json!({"character_id":"c1","fact_key":"likes","fact_value":"猫",
                    "importance":80,"source_memory_ids":["m1","m2"]}),
        )
        .unwrap();
        sp_sem_facts_upsert_impl(
            &conn,
            &json!({"character_id":"c1","fact_key":"dislikes","fact_value":"雨",
                    "source_memory_ids":"[\"m9\"]"}),
        )
        .unwrap();
        sp_sem_facts_upsert_impl(
            &conn,
            &json!({"character_id":"c1","fact_key":"x","fact_value":"y"}),
        )
        .unwrap();
        assert_eq!(sp_sem_facts_count_impl(&conn, "c1").unwrap(), 3);

        let by_key = |k: &str| sp_sem_facts_by_key_impl(&conn, "c1", k).unwrap();
        assert_eq!(
            by_key("likes").unwrap()["source_memory_ids"],
            json!("[\"m1\",\"m2\"]")
        );
        assert_eq!(
            by_key("dislikes").unwrap()["source_memory_ids"],
            json!("[\"m9\"]")
        );
        assert_eq!(by_key("x").unwrap()["source_memory_ids"], json!("[]"));
        assert_eq!(by_key("x").unwrap()["importance"], json!(50), "缺省 50");

        // 同 key 二次 upsert → ON CONFLICT 更新，不新增行
        sp_sem_facts_upsert_impl(
            &conn,
            &json!({"character_id":"c1","fact_key":"likes","fact_value":"狗","importance":90}),
        )
        .unwrap();
        assert_eq!(sp_sem_facts_count_impl(&conn, "c1").unwrap(), 3);
        assert_eq!(by_key("likes").unwrap()["fact_value"], json!("狗"));
        // 未命中 → None
        assert!(by_key("nope").is_none());
        // list 按 importance DESC，likes(90) 居首
        let list = sp_sem_facts_list_impl(&conn, "c1").unwrap();
        assert_eq!(list.len(), 3);
        assert_eq!(list[0]["fact_key"], json!("likes"));

        sp_sem_facts_delete_impl(&conn, "c1", "likes").unwrap();
        assert_eq!(sp_sem_facts_count_impl(&conn, "c1").unwrap(), 2);
        sp_sem_facts_clear_impl(&conn, "c1").unwrap();
        assert_eq!(sp_sem_facts_count_impl(&conn, "c1").unwrap(), 0);
    }

    #[test]
    fn test_pet_exp_impl_insert_defaults_and_clear() {
        let conn = mem_conn();
        sp_pet_exp_insert_impl(
            &conn,
            &json!({"id":"e1","character_id":"c1","type":"play","description":"玩球",
                    "timestamp":100,"sentiment":"happy","intensity":0.9}),
        )
        .unwrap();
        // 只给必填 → 其余走缺省
        sp_pet_exp_insert_impl(
            &conn,
            &json!({"id":"e2","character_id":"c1","type":"eat","timestamp":50}),
        )
        .unwrap();

        let rows = sp_pet_exp_list_impl(&conn, "c1").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["id"], json!("e2"), "按 timestamp ASC");
        assert_eq!(rows[0]["sentiment"], json!("neutral"));
        assert_eq!(rows[0]["intensity"], json!(0.5));
        assert_eq!(rows[1]["sentiment"], json!("happy"));

        // 缺 id → Err（必填校验）
        assert!(sp_pet_exp_insert_impl(&conn, &json!({"character_id":"c1"})).is_err());

        sp_pet_exp_clear_impl(&conn, "c1").unwrap();
        assert!(sp_pet_exp_list_impl(&conn, "c1").unwrap().is_empty());
    }

    #[test]
    fn test_visual_impl_insert_nullable_fields() {
        let conn = mem_conn();
        sp_visual_insert_impl(
            &conn,
            &json!({"id":"v1","character_id":"c1","type":"scene","description":"夕阳",
                    "image_path":"/tmp/a.png","timestamp":10,"related_memory_id":"m1"}),
        )
        .unwrap();
        // image_path / related_memory_id 缺失 → NULL
        sp_visual_insert_impl(
            &conn,
            &json!({"id":"v2","character_id":"c1","type":"scene","timestamp":20}),
        )
        .unwrap();

        let rows = sp_visual_list_impl(&conn, "c1").unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["image_path"], json!("/tmp/a.png"));
        assert_eq!(rows[0]["related_memory_id"], json!("m1"));
        assert_eq!(rows[1]["image_path"], json!(null));
        assert_eq!(rows[1]["sentiment"], json!("neutral"));

        assert!(sp_visual_insert_impl(&conn, &json!({"character_id":"c1"})).is_err());

        sp_visual_clear_impl(&conn, "c1").unwrap();
        assert!(sp_visual_list_impl(&conn, "c1").unwrap().is_empty());
    }

    #[test]
    fn test_entity_nodes_impl_upsert_conflict_and_clear() {
        let conn = mem_conn();
        sp_entity_upsert_impl(
            &conn,
            &json!({"id":"n1","character_id":"c1","name":"小橘","type":"cat",
                    "linked_memory_ids":"[\"m1\"]","mention_count":3,"first_seen":10,"last_seen":20}),
        )
        .unwrap();
        // 同 (character_id, name) → ON CONFLICT 只更新 linked/mention/last_seen
        sp_entity_upsert_impl(
            &conn,
            &json!({"id":"n2","character_id":"c1","name":"小橘","type":"cat",
                    "linked_memory_ids":"[\"m1\",\"m2\"]","mention_count":5,"first_seen":10,"last_seen":30}),
        )
        .unwrap();

        let rows = sp_entity_list_impl(&conn, "c1").unwrap();
        assert_eq!(rows.len(), 1, "同角色同名只保留一行");
        assert_eq!(rows[0]["id"], json!("n1"), "id 不被 ON CONFLICT 覆盖");
        assert_eq!(rows[0]["mention_count"], json!(5));
        assert_eq!(rows[0]["last_seen"], json!(30));
        assert_eq!(rows[0]["linked_memory_ids"], json!("[\"m1\",\"m2\"]"));

        // 缺 name → Err
        assert!(sp_entity_upsert_impl(&conn, &json!({"id":"n3","character_id":"c1"})).is_err());

        sp_entity_clear_impl(&conn, "c1").unwrap();
        assert!(sp_entity_list_impl(&conn, "c1").unwrap().is_empty());
    }

    // ===== 第四批：mods / inventory / schedules / 完整性 / 快照 / purge =====

    fn row_by_id<'a>(rows: &'a [JsonValue], id: &str) -> &'a JsonValue {
        rows.iter()
            .find(|r| r["id"] == json!(id))
            .unwrap_or_else(|| panic!("未找到 id={id} 的行"))
    }

    #[test]
    fn test_mods_impl_save_upsert_enable_delete() {
        let conn = mem_conn();
        sp_mods_save_impl(&conn, &json!({"id":"m1","name":"猫咪语音包"})).unwrap();
        sp_mods_save_impl(
            &conn,
            &json!({"id":"m2","name":"天气插件","version":"1.2","enabled":false}),
        )
        .unwrap();

        let rows = sp_mods_list_impl(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        // 缺省：config="{}"、enabled=1、version=NULL
        assert_eq!(row_by_id(&rows, "m1")["config"], json!("{}"));
        assert_eq!(row_by_id(&rows, "m1")["enabled"], json!(1));
        assert_eq!(row_by_id(&rows, "m1")["version"], json!(null));
        assert_eq!(row_by_id(&rows, "m2")["enabled"], json!(0));

        // upsert：覆盖 name/version/config/enabled，但 installed_at 不在更新列里
        let installed_at = row_by_id(&rows, "m1")["installed_at"].clone();
        sp_mods_save_impl(
            &conn,
            &json!({"id":"m1","name":"改名","config":"{\"k\":1}","enabled":false}),
        )
        .unwrap();
        let rows = sp_mods_list_impl(&conn).unwrap();
        assert_eq!(rows.len(), 2, "同 id 不新增行");
        assert_eq!(row_by_id(&rows, "m1")["name"], json!("改名"));
        assert_eq!(row_by_id(&rows, "m1")["config"], json!("{\"k\":1}"));
        assert_eq!(row_by_id(&rows, "m1")["enabled"], json!(0));
        assert_eq!(
            row_by_id(&rows, "m1")["installed_at"],
            installed_at,
            "installed_at 不在 ON CONFLICT 更新列里"
        );

        sp_mods_set_enabled_impl(&conn, "m1", true).unwrap();
        let rows = sp_mods_list_impl(&conn).unwrap();
        assert_eq!(row_by_id(&rows, "m1")["enabled"], json!(1));

        // 必填校验
        assert!(sp_mods_save_impl(&conn, &json!({"name":"缺 id"})).is_err());
        assert!(sp_mods_save_impl(&conn, &json!({"id":"x"})).is_err());

        sp_mods_delete_impl(&conn, "m2").unwrap();
        assert_eq!(sp_mods_list_impl(&conn).unwrap().len(), 1);
    }

    #[test]
    fn test_inventory_impl_save_and_scope_filter() {
        let conn = mem_conn();
        // inventory.character_id 有 FK → characters(id)，先建角色
        sp_char_save_stats_impl(&conn, "c1", "{}").unwrap();
        sp_char_save_stats_impl(&conn, "c2", "{}").unwrap();
        sp_inventory_save_impl(
            &conn,
            &json!({"id":"i1","item_id":"fish","quantity":3,"character_id":"c1"}),
        )
        .unwrap();
        // quantity 缺省 1、character_id 缺省 NULL（全局物品）
        sp_inventory_save_impl(&conn, &json!({"id":"i2","item_id":"ball"})).unwrap();
        sp_inventory_save_impl(
            &conn,
            &json!({"id":"i3","item_id":"milk","character_id":"c2"}),
        )
        .unwrap();

        assert_eq!(sp_inventory_list_impl(&conn, None).unwrap().len(), 3);
        // 按角色：自己的 + 全局（character_id IS NULL）
        let c1 = sp_inventory_list_impl(&conn, Some("c1")).unwrap();
        assert_eq!(c1.len(), 2, "应含本角色物品与全局物品");
        assert!(c1.iter().any(|r| r["id"] == json!("i2")));
        assert!(!c1.iter().any(|r| r["id"] == json!("i3")));

        // upsert 覆盖数量
        sp_inventory_save_impl(
            &conn,
            &json!({"id":"i1","item_id":"fish","quantity":9,"character_id":"c1"}),
        )
        .unwrap();
        let all = sp_inventory_list_impl(&conn, None).unwrap();
        assert_eq!(all.len(), 3, "同 id 不新增行");
        assert_eq!(row_by_id(&all, "i1")["quantity"], json!(9));
        assert_eq!(row_by_id(&all, "i2")["quantity"], json!(1), "缺省 1");

        assert!(sp_inventory_save_impl(&conn, &json!({"id":"i4"})).is_err());
    }

    #[test]
    fn test_schedules_impl_save_list_delete() {
        let conn = mem_conn();
        sp_schedules_save_impl(&conn, &json!({"id":"s1","title":"喂猫","time":200})).unwrap();
        sp_schedules_save_impl(
            &conn,
            &json!({"id":"s2","title":"铲屎","time":100,"repeat":"daily"}),
        )
        .unwrap();

        let rows = sp_schedules_list_impl(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0]["id"], json!("s2"), "按 time ASC");
        assert_eq!(rows[0]["repeat"], json!("daily"));
        assert_eq!(rows[1]["repeat"], json!(null));
        assert_eq!(rows[1]["completed"], json!(0), "缺省 false");

        sp_schedules_save_impl(
            &conn,
            &json!({"id":"s1","title":"喂猫(改)","time":300,"completed":true}),
        )
        .unwrap();
        let rows = sp_schedules_list_impl(&conn).unwrap();
        assert_eq!(rows.len(), 2, "同 id 不新增行");
        assert_eq!(row_by_id(&rows, "s1")["title"], json!("喂猫(改)"));
        assert_eq!(row_by_id(&rows, "s1")["completed"], json!(1));

        assert!(sp_schedules_save_impl(&conn, &json!({"id":"s3"})).is_err());

        sp_schedules_delete_impl(&conn, "s1").unwrap();
        assert_eq!(sp_schedules_list_impl(&conn).unwrap().len(), 1);
    }

    #[test]
    fn test_db_integrity_and_snapshot_impl() {
        let conn = mem_conn();
        assert_eq!(
            sp_db_integrity_impl(&conn).unwrap(),
            vec!["ok".to_string()],
            "内存库 integrity_check 应为 ok"
        );

        let snap = sp_db_snapshot_impl(&conn).unwrap();
        assert_eq!(snap.len(), SNAPSHOT_TABLES.len(), "快照应覆盖全部白名单表");
        for t in SNAPSHOT_TABLES {
            assert!(snap.contains_key(*t), "快照缺表: {t}");
            assert!(snap[*t].is_array(), "表 {t} 的快照应为数组");
        }

        // 有数据时快照带行
        sp_settings_set_impl(&conn, "k", "v").unwrap();
        let snap = sp_db_snapshot_impl(&conn).unwrap();
        assert_eq!(snap["settings"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_settings_keys_impl_like_pattern() {
        let conn = mem_conn();
        for k in ["spiritpal:a", "spiritpal:b", "other:c"] {
            sp_settings_set_impl(&conn, k, "v").unwrap();
        }
        assert_eq!(
            sp_settings_keys_impl(&conn, "spiritpal:%").unwrap(),
            vec!["spiritpal:a".to_string(), "spiritpal:b".to_string()],
            "应按 key ASC 且只命中前缀"
        );
        assert!(sp_settings_keys_impl(&conn, "none:%").unwrap().is_empty());
    }

    #[test]
    fn test_db_purge_impl_clears_selected_tables_only() {
        let conn = mem_conn();
        sp_mem_add_impl(&conn, "c1", "episodic", "a", None).unwrap();
        sp_commitments_insert_impl(&conn, "c1", "x", "assistant", None, None, None).unwrap();
        sp_ctx_insert_impl(&conn, "c1", 1, None, None, None, None).unwrap();
        sp_schedules_save_impl(&conn, &json!({"id":"s1","title":"t"})).unwrap();
        sp_settings_set_impl(&conn, "spiritpal:a", "1").unwrap();
        sp_settings_set_impl(&conn, "other:b", "2").unwrap();
        sp_entitygraph_upsert_node_impl(&conn, "小橘", "cat", "m1", "ent-1", 100, None).unwrap();

        sp_db_purge_impl(&conn).unwrap();

        assert!(sp_mem_list_impl(&conn, "c1", None).unwrap().is_empty());
        assert!(sp_commitments_list_impl(&conn, "c1").unwrap().is_empty());
        assert!(sp_ctx_list_impl(&conn, "c1", 0, None).unwrap().is_empty());
        assert!(sp_schedules_list_impl(&conn).unwrap().is_empty());
        assert!(
            sp_entitygraph_find_by_names_impl(&conn, &["小橘".to_string()])
                .unwrap()
                .is_empty()
        );
        // settings 只清 spiritpal: 前缀，别的前缀必须保留
        assert_eq!(sp_settings_get_impl(&conn, "spiritpal:a").unwrap(), None);
        assert_eq!(
            sp_settings_get_impl(&conn, "other:b").unwrap().as_deref(),
            Some("2")
        );
    }

    // ===== 第五批：zombie / schemaRunner / dirty_data_registry =====

    #[test]
    fn test_zombie_report_and_cleanup_impl() {
        let conn = mem_conn();
        // 两条 legacy 设置：一条 updated_at 有效、一条为 0
        exec(
            &conn,
            "INSERT INTO settings (key, value, updated_at) VALUES ('a.legacy','xx',10)",
            &[],
        )
        .unwrap();
        exec(
            &conn,
            "INSERT INTO settings (key, value, updated_at) VALUES ('b.legacy','yyy',0)",
            &[],
        )
        .unwrap();
        // 上下文：一条早于阈值、一条不早
        sp_ctx_insert_impl(&conn, "c1", 50, None, None, None, None).unwrap();
        sp_ctx_insert_impl(&conn, "c1", 500, None, None, None, None).unwrap();
        // 实体：低提及且久未出现 vs 高提及
        sp_entity_upsert_impl(
            &conn,
            &json!({"id":"n1","character_id":"c1","name":"旧","mention_count":1,"last_seen":10}),
        )
        .unwrap();
        sp_entity_upsert_impl(
            &conn,
            &json!({"id":"n2","character_id":"c1","name":"热","mention_count":9,"last_seen":10}),
        )
        .unwrap();

        let rep = sp_zombie_report_impl(&conn, 100, 100).unwrap();
        assert_eq!(rep["legacyCount"], json!(2));
        assert_eq!(
            rep["legacyOldest"],
            json!(10),
            "只统计 updated_at > 0 的最小值"
        );
        assert_eq!(rep["episodeCount"], json!(1), "started_at < 100 的只有一条");
        assert_eq!(
            rep["entityCount"],
            json!(1),
            "last_seen < 100 且 mention_count < 3 的只有一条"
        );
        assert_eq!(rep["bytes"], json!(5), "\"xx\"(2) + \"yyy\"(3)");

        // 非 force：只删 updated_at ∈ (0, threshold)
        assert_eq!(
            sp_zombie_cleanup_legacy_impl(&conn, 20, false, 10).unwrap(),
            1
        );
        assert_eq!(sp_settings_get_impl(&conn, "a.legacy").unwrap(), None);
        assert_eq!(
            sp_settings_get_impl(&conn, "b.legacy").unwrap().as_deref(),
            Some("yyy"),
            "updated_at = 0 的记录不该被非 force 删除"
        );
        // force：无条件删（受 limit 约束）
        assert_eq!(
            sp_zombie_cleanup_legacy_impl(&conn, 20, true, 10).unwrap(),
            1
        );
        assert_eq!(sp_settings_get_impl(&conn, "b.legacy").unwrap(), None);

        assert_eq!(sp_zombie_cleanup_episodes_impl(&conn, 100, 10).unwrap(), 1);
        assert_eq!(sp_ctx_list_impl(&conn, "c1", 0, None).unwrap().len(), 1);
        assert_eq!(sp_zombie_cleanup_entities_impl(&conn, 100, 10).unwrap(), 1);
        assert_eq!(sp_entity_list_impl(&conn, "c1").unwrap().len(), 1);
    }

    #[test]
    fn test_schema_version_impl_record_applied_history() {
        let conn = mem_conn();
        assert_eq!(sp_schema_version_current_impl(&conn).unwrap(), 0);
        assert!(!sp_schema_version_applied_impl(&conn, 1).unwrap());

        sp_schema_version_record_impl(&conn, 1, "建表", "abc123").unwrap();
        sp_schema_version_record_impl(&conn, 3, "加列", "def456").unwrap();
        // ON CONFLICT(version) DO NOTHING：重复记录既不报错也不覆盖
        sp_schema_version_record_impl(&conn, 1, "重复", "zzz").unwrap();

        assert_eq!(
            sp_schema_version_current_impl(&conn).unwrap(),
            3,
            "取 MAX(version)"
        );
        assert!(sp_schema_version_applied_impl(&conn, 1).unwrap());
        assert!(!sp_schema_version_applied_impl(&conn, 2).unwrap());

        let hist = sp_schema_version_history_impl(&conn).unwrap();
        assert_eq!(hist.len(), 2);
        assert_eq!(hist[0]["version"], json!(1));
        assert_eq!(
            hist[0]["description"],
            json!("建表"),
            "DO NOTHING 不该覆盖已有记录"
        );
        assert_eq!(hist[1]["version"], json!(3));
    }

    #[test]
    fn test_schema_failure_log_impl() {
        let conn = mem_conn();
        assert!(sp_schema_unresolved_impl(&conn).unwrap().is_empty());

        sp_schema_log_failure_impl(&conn, 7, "语法错误", Some("ALTER TABLE x ADD y")).unwrap();
        sp_schema_log_failure_impl(&conn, 8, "无 SQL", None).unwrap();

        let open = sp_schema_unresolved_impl(&conn).unwrap();
        assert_eq!(open.len(), 2);
        let id7 = open.iter().find(|r| r["version"] == json!(7)).unwrap()["id"]
            .as_i64()
            .unwrap();
        assert_eq!(
            open.iter().find(|r| r["version"] == json!(8)).unwrap()["sql_statement"],
            json!(null),
            "sql_statement 为 None 时应落 NULL"
        );

        sp_schema_resolve_failure_impl(&conn, id7, 999).unwrap();
        let open = sp_schema_unresolved_impl(&conn).unwrap();
        assert_eq!(open.len(), 1, "已解决的不再出现在 unresolved 里");
        assert_eq!(open[0]["version"], json!(8));
    }

    #[test]
    fn test_dirty_upsert_idempotent_and_resolve() {
        let conn = mem_conn();
        sp_dirty_upsert_impl(&conn, "orphan", "inventory::i1", "{}", 100).unwrap();
        assert_eq!(sp_dirty_list_impl(&conn).unwrap().len(), 1);

        // 同 kind+target_id 且未解决 → 更新时间戳与 payload，不新增
        sp_dirty_upsert_impl(&conn, "orphan", "inventory::i1", "{\"v\":2}", 200).unwrap();
        let rows = sp_dirty_list_impl(&conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["detected_at"], json!(200));
        assert_eq!(rows[0]["payload"], json!("{\"v\":2}"));
        let id = rows[0]["id"].as_i64().unwrap();

        sp_dirty_resolve_impl(&conn, id, 300).unwrap();
        assert_eq!(
            sp_dirty_list_impl(&conn).unwrap()[0]["resolved_at"],
            json!(300)
        );
        // 已解决的记录不再被 upsert 命中 → 新增一条
        sp_dirty_upsert_impl(&conn, "orphan", "inventory::i1", "{}", 400).unwrap();
        assert_eq!(sp_dirty_list_impl(&conn).unwrap().len(), 2);
    }

    #[test]
    fn test_dirty_resolve_table_and_cleanup() {
        let conn = mem_conn();
        sp_dirty_upsert_impl(&conn, "k", "inventory::a", "{}", 10).unwrap();
        sp_dirty_upsert_impl(&conn, "k", "inventory::b", "{}", 20).unwrap();
        sp_dirty_upsert_impl(&conn, "k", "memories::c", "{}", 30).unwrap();

        // 按 `${table}::%` 前缀批量解决
        assert_eq!(
            sp_dirty_resolve_table_impl(&conn, "inventory", 500).unwrap(),
            2
        );
        let rows = sp_dirty_list_impl(&conn).unwrap();
        assert_eq!(
            rows.iter()
                .filter(|r| r["resolved_at"] == json!(500))
                .count(),
            2
        );
        assert_eq!(
            rows.iter()
                .filter(|r| r["resolved_at"] == json!(null))
                .count(),
            1,
            "别的表不受影响"
        );

        // 清理「已解决且 resolved_at < threshold」
        assert_eq!(sp_dirty_cleanup_impl(&conn, 600).unwrap(), 2);
        assert_eq!(sp_dirty_list_impl(&conn).unwrap().len(), 1);
        assert_eq!(
            sp_dirty_cleanup_impl(&conn, 100).unwrap(),
            0,
            "阈值早于 resolved_at 不删"
        );
    }

    #[test]
    fn test_dirty_scan_impl_detects_multiple_kinds() {
        let conn = mem_conn();
        // 干净库不该报任何 issue
        assert!(sp_dirty_scan_impl(&conn).unwrap().is_empty());

        sp_char_save_stats_impl(&conn, "c_ok", "{}").unwrap();
        sp_char_save_stats_impl(&conn, "c_bad", "not-json").unwrap();

        sp_mem_add_impl(&conn, "c_ok", "episodic", "正常", Some(50)).unwrap();
        sp_mem_add_impl(&conn, "c_ok", "episodic", "越界", Some(150)).unwrap();
        sp_mem_add_impl(&conn, "c_ok", "bogus_type", "非法类型", Some(50)).unwrap();
        sp_mem_add_impl(&conn, "c_ok", "episodic", "孤儿角色", Some(50)).unwrap();
        // 造孤儿记忆（memories 无外键）+ 重复 memory_id
        exec(
            &conn,
            "UPDATE memories SET character_id = 'ghost' WHERE content = '孤儿角色'",
            &[],
        )
        .unwrap();
        exec(
            &conn,
            "UPDATE memories SET memory_id = 'dup' WHERE content IN ('正常','越界')",
            &[],
        )
        .unwrap();

        // 负数库存（inventory 有外键，角色必须真实存在）
        sp_inventory_save_impl(
            &conn,
            &json!({"id":"i1","item_id":"fish","quantity":-5,"character_id":"c_ok"}),
        )
        .unwrap();

        // 级联删除残留：commitments 引用不存在的角色
        sp_commitments_insert_impl(&conn, "ghost", "残留", "assistant", None, None, None).unwrap();

        let issues = sp_dirty_scan_impl(&conn).unwrap();
        let has = |table: &str, data_type: &str| {
            issues
                .iter()
                .any(|i| i["table"] == json!(table) && i["dataType"] == json!(data_type))
        };
        assert!(
            has("characters", "DATA_TYPE_MISMATCH"),
            "stats 非 JSON 未检出"
        );
        assert!(has("memories", "ORPHAN_REFERENCE"), "孤儿记忆未检出");
        assert!(
            has("inventory", "BUSINESS_RULE_VIOLATION"),
            "负数库存未检出"
        );
        assert!(
            has("memories", "BUSINESS_RULE_VIOLATION"),
            "importance 超界 / type 非法未检出"
        );
        assert!(has("memories", "DUPLICATE_ENTRY"), "memory_id 重复未检出");
        assert!(
            has("commitments", "INCONSISTENT_STATE"),
            "级联删除残留未检出"
        );
        // 每条 issue 都必须带 detectedAt 时间戳
        assert!(issues
            .iter()
            .all(|i| i["detectedAt"].as_i64().unwrap_or(0) > 0));
    }
}
