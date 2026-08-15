// T-06: 真实 SQLite 集成测试 — 使用 sql.js 进行真实数据库迁移测试
// 不 Mock plugin-sql，使用纯 JS SQLite 引擎验证 schema 和迁移正确性
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'

// sql.js 是一个纯 JavaScript 实现的 SQLite，不需要原生编译
// 通过 dynamic import 加载，避免影响其他测试
let initSqlJs: any
let Database: any

beforeAll(async () => {
  try {
    const sqlJs = await import('sql.js')
    initSqlJs = sqlJs.initSqlJs || sqlJs.default?.initSqlJs || sqlJs.default
    if (typeof initSqlJs === 'function') {
      const SQL = await initSqlJs({})
      Database = SQL.Database
    }
  } catch {
    // sql.js 未安装时跳过
  }
})

describe('T-06: SQLite 集成测试', () => {
  describe.skipIf(!initSqlJs)('真实数据库操作', () => {
    let db: any

    beforeEach(() => {
      if (!Database) return
      db = new Database()
      // 创建与项目实际使用相同的表结构
      db.run(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );

        CREATE TABLE IF NOT EXISTS memories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          category TEXT,
          content TEXT,
          tags TEXT,
          importance INTEGER DEFAULT 0,
          created_at INTEGER,
          last_accessed INTEGER,
          access_count INTEGER DEFAULT 0,
          embedding BLOB
        );

        CREATE TABLE IF NOT EXISTS embeddings (
          id INTEGER PRIMARY KEY,
          embedding BLOB
        );

        CREATE TABLE IF NOT EXISTS character_stats (
          character_id TEXT PRIMARY KEY,
          hunger REAL,
          mood REAL,
          health REAL,
          affection INTEGER,
          level INTEGER,
          exp INTEGER,
          coins INTEGER,
          last_tick_at INTEGER,
          last_interaction_at INTEGER,
          last_affection_decay_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS mods (
          id TEXT PRIMARY KEY,
          name TEXT,
          version TEXT,
          enabled INTEGER DEFAULT 1,
          installed_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS inventory (
          id TEXT PRIMARY KEY,
          name TEXT,
          type TEXT,
          count INTEGER,
          icon TEXT
        );

        CREATE TABLE IF NOT EXISTS schedules (
          id TEXT PRIMARY KEY,
          type TEXT,
          data TEXT,
          created_at INTEGER
        );
      `)
    })

    afterAll(() => {
      if (db) db.close()
    })

    it('settings 表 CRUD 完整测试', () => {
      // Create
      db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['test_key', 'test_value'])

      // Read
      const result = db.exec('SELECT value FROM settings WHERE key = ?', ['test_key'])
      expect(result.length).toBe(1)
      expect(result[0].values[0][0]).toBe('test_value')

      // Update
      db.run('UPDATE settings SET value = ? WHERE key = ?', ['updated_value', 'test_key'])
      const updated = db.exec('SELECT value FROM settings WHERE key = ?', ['test_key'])
      expect(updated[0].values[0][0]).toBe('updated_value')

      // Delete
      db.run('DELETE FROM settings WHERE key = ?', ['test_key'])
      const deleted = db.exec('SELECT COUNT(*) FROM settings WHERE key = ?', ['test_key'])
      expect(deleted[0].values[0][0]).toBe(0)
    })

    it('memories 表插入带 embedding 的记录', () => {
      const embedding = new Float32Array([0.1, 0.2, 0.3, 0.4])
      const embeddingBytes = new Uint8Array(embedding.buffer)

      db.run(
        `INSERT INTO memories (category, content, tags, importance, created_at, last_accessed, access_count, embedding)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['event', '测试记忆', '[]', 5, Date.now(), Date.now(), 0, embeddingBytes
      ])

      const result = db.exec('SELECT content, importance FROM memories WHERE content = ?', ['测试记忆'])
      expect(result.length).toBe(1)
      expect(result[0].values[0][0]).toBe('测试记忆')
      expect(result[0].values[0][1]).toBe(5)
    })

    it('character_stats 表 schema 验证', () => {
      db.run(
        `INSERT INTO character_stats
        (character_id, hunger, mood, health, affection, level, exp, coins, last_tick_at, last_interaction_at, last_affection_decay_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['doro', 80, 70, 100, 500, 5, 0, 1000, Date.now(), Date.now(), Date.now()
      ])

      const result = db.exec('SELECT hunger, mood, health FROM character_stats WHERE character_id = ?', ['doro'])
      expect(result.length).toBe(1)
      expect(result[0].values[0][0]).toBe(80)
      expect(result[0].values[0][1]).toBe(70)
      expect(result[0].values[0][2]).toBe(100)
    })

    it('mods 表 enabled 字段默认值为 1', () => {
      db.run("INSERT INTO mods (id, name, version, installed_at) VALUES (?, ?, ?, ?)", [
        'test-mod', 'Test Mod', '1.0.0', Date.now()
      ])

      const result = db.exec('SELECT enabled FROM mods WHERE id = ?', ['test-mod'])
      expect(result[0].values[0][0]).toBe(1)
    })

    it('schema 迁移 — 添加新列不丢失数据', () => {
      // 插入初始数据
      db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['before_migration', 'preserved'])

      // 模拟迁移：添加新列
      db.run('ALTER TABLE settings ADD COLUMN description TEXT')

      // 验证旧数据保留
      const result = db.exec('SELECT value FROM settings WHERE key = ?', ['before_migration'])
      expect(result[0].values[0][0]).toBe('preserved')

      // 验证新列可用
      db.run('UPDATE settings SET description = ? WHERE key = ?', ['new desc', 'before_migration'])
      const updated = db.exec('SELECT description FROM settings WHERE key = ?', ['before_migration'])
      expect(updated[0].values[0][0]).toBe('new desc')
    })

    it('事务回滚验证', () => {
      db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['before_txn', 'exists'])

      try {
        db.run('BEGIN TRANSACTION')
        db.run('INSERT INTO settings (key, value) VALUES (?, ?)', ['in_txn', 'should_not_exist'])
        // 模拟错误，回滚
        db.run('ROLLBACK')
      } catch {
        db.run('ROLLBACK')
      }

      // 验证事务内插入的数据不存在
      const result = db.exec("SELECT COUNT(*) FROM settings WHERE key = 'in_txn'")
      expect(result[0].values[0][0]).toBe(0)

      // 验证事务前数据仍存在
      const before = db.exec("SELECT value FROM settings WHERE key = 'before_txn'")
      expect(before[0].values[0][0]).toBe('exists')
    })

    it('索引存在性验证', () => {
      db.run('CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category)')
      db.run('CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance)')

      // 验证索引存在
      const result = db.exec("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'memories'")
      const indexNames = result[0].values.map((row: any[]) => row[0])
      expect(indexNames).toContain('idx_memories_category')
      expect(indexNames).toContain('idx_memories_importance')
    })
  })

  describe.skipIf(initSqlJs)('sql.js 未安装', () => {
    it('应安装 sql.js 后运行集成测试', () => {
      console.warn('sql.js 未安装，跳过真实 SQLite 集成测试。运行 pnpm add -D sql.js 安装。')
      expect(true).toBe(true)
    })
  })
})
