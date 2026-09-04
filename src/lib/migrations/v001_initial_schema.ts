/**
 * Schema 迁移 v001 — 初始建表
 *
 * 创建应用的核心表结构，包括：
 * - characters：角色养成数据
 * - settings：全局设置 / Zustand store blob
 * - memories：记忆数据（四层记忆系统）
 * - mods：模组数据
 * - inventory：背包物品
 * - schedules：日程
 *
 * @version 1
 * @since v0.1.0
 */

import type { Migration } from './types'

export const v001_initialSchema: Migration = {
  version: 1,
  description: '初始建表：characters/settings/memories/mods/inventory/schedules',
  sql: [
    // 角色养成数据
    `CREATE TABLE IF NOT EXISTS characters (
      id TEXT PRIMARY KEY,
      stats TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,

    // 全局设置
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,

    // 记忆数据（初始版本，后续 v003+ 扩列）
    `CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance INTEGER DEFAULT 50,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER NOT NULL,
      embedding BLOB
    )`,

    // 模组数据
    `CREATE TABLE IF NOT EXISTS mods (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT,
      config TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      installed_at INTEGER NOT NULL
    )`,

    // 背包物品
    `CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      character_id TEXT
    )`,

    // 日程
    `CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      time INTEGER NOT NULL,
      repeat TEXT,
      completed INTEGER DEFAULT 0
    )`,

    // 初始索引
    'CREATE INDEX IF NOT EXISTS idx_memories_character ON memories(character_id)',
    'CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type)',
    'CREATE INDEX IF NOT EXISTS idx_inventory_char ON inventory(character_id)',
  ],
}
