/**
 * P1-4: 实体图 + PPR 多跳联想模块
 *
 * 实现 HippoRAG 简化版：
 * - SQLite 两表：memory_entities / memory_entity_edges
 * - PPR 幂迭代：从种子节点扩散激活分数
 *
 * @module entityGraph
 */

import { getDb } from './db'
import type { EnhancedMemory } from './memoryTypes'

// ============ 类型定义 ============

/** 记忆实体节点 */
export interface MemoryEntity {
  id: string
  name: string
  type: 'person' | 'location' | 'time' | 'event' | 'object' | 'concept'
  memoryIds: string[]  // 关联的记忆 ID 列表
  embedding?: Float32Array
  createdAt: number
}

/** 实体关系边 */
export interface MemoryEntityEdge {
  id: string
  entityA: string
  entityB: string
  weight: number
  cooccurCount: number  // 共现次数
  createdAt: number
}

/** PPR 结果 */
export interface PPRResult {
  entityName: string
  score: number
  relatedMemoryIds: string[]
}

// ============ 数据库操作 ============

/**
 * 初始化实体图表（幂等）
 */
export async function initEntityGraphTables(): Promise<void> {
  const db = await getDb()
  
  // 实体节点表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memory_entities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      memory_ids TEXT NOT NULL,  -- JSON array of memory IDs
      embedding BLOB,            -- optional embedding for semantic matching
      created_at INTEGER NOT NULL
    )
  `)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_entities_name ON memory_entities(name)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_entities_type ON memory_entities(type)`)
  
  // 实体关系边表
  await db.execute(`
    CREATE TABLE IF NOT EXISTS memory_entity_edges (
      id TEXT PRIMARY KEY,
      entity_a TEXT NOT NULL,
      entity_b TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      cooccur_count INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (entity_a) REFERENCES memory_entities(id),
      FOREIGN KEY (entity_b) REFERENCES memory_entities(id)
    )
  `)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_edges_a ON memory_entity_edges(entity_a)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_edges_b ON memory_entity_edges(entity_b)`)
}

/**
 * 添加或更新实体节点
 */
export async function upsertEntity(
  name: string,
  type: MemoryEntity['type'],
  memoryId: string,
  embedding?: Float32Array
): Promise<string> {
  const db = await getDb()
  const rows = await db.select<{ id: string; memory_ids: string }[]>(
    'SELECT id, memory_ids FROM memory_entities WHERE name = ? AND type = ?',
    [name, type]
  )
  
  const now = Date.now()
  
  if (rows && rows.length > 0) {
    // 更新：追加 memoryId
    const record = rows[0]
    const memoryIds = JSON.parse(record.memory_ids)
    if (!memoryIds.includes(memoryId)) {
      memoryIds.push(memoryId)
      await db.execute(
        'UPDATE memory_entities SET memory_ids = ? WHERE id = ?',
        [JSON.stringify(memoryIds), record.id]
      )
    }
    return record.id
  } else {
    // 新建
    const id = `ent-${now}-${Math.random().toString(36).slice(2, 9)}`
    await db.execute(
      'INSERT INTO memory_entities (id, name, type, memory_ids, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, type, JSON.stringify([memoryId]), embedding, now]
    )
    return id
  }
}

/**
 * 添加或更新实体关系边
 */
export async function upsertEntityEdge(
  entityA: string,
  entityB: string,
  weightIncrement: number = 1.0
): Promise<void> {
  const db = await getDb()
  const [a, b] = entityA < entityB ? [entityA, entityB] : [entityB, entityA]  // 保证顺序一致
  
  const rows = await db.select<{ id: string; cooccur_count: number; weight: number }[]>(
    'SELECT id, cooccur_count, weight FROM memory_entity_edges WHERE entity_a = ? AND entity_b = ?',
    [a, b]
  )
  
  const now = Date.now()
  
  if (rows && rows.length > 0) {
    const record = rows[0]
    const newCount = record.cooccur_count + 1
    const newWeight = record.weight + weightIncrement
    await db.execute(
      'UPDATE memory_entity_edges SET cooccur_count = ?, weight = ? WHERE id = ?',
      [newCount, newWeight, record.id]
    )
  } else {
    const id = `edge-${now}-${Math.random().toString(36).slice(2, 9)}`
    await db.execute(
      'INSERT INTO memory_entity_edges (id, entity_a, entity_b, weight, cooccur_count, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, a, b, weightIncrement, 1, now]
    )
  }
}

/**
 * 从查询中提取实体名（简单分词后查表）
 */
export async function findEntitiesByName(names: string[]): Promise<MemoryEntity[]> {
  const db = await getDb()
  if (names.length === 0) return []
  
  const placeholders = names.map(() => '?').join(',')
  const rows = await db.select<{
    id: string
    name: string
    type: string
    memory_ids: string
  }[]>(
    `SELECT id, name, type, memory_ids FROM memory_entities WHERE name IN (${placeholders})`,
    names
  )
  
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    type: r.type as MemoryEntity['type'],
    memoryIds: JSON.parse(r.memory_ids),
    createdAt: Date.now(),
  }))
}

/**
 * 获取实体的邻居节点
 */
export async function getEntityNeighbors(
  entityName: string
): Promise<{ neighbor: string; weight: number }[]> {
  const db = await getDb()
  const entityRows = await db.select<{ id: string }[]>(
    'SELECT id FROM memory_entities WHERE name = ?',
    [entityName]
  )
  if (!entityRows || entityRows.length === 0) return []
  
  const entityId = entityRows[0].id
  const edgeRows = await db.select<{
    entity_a: string
    entity_b: string
    weight: number
  }[]>(
    `SELECT entity_a, entity_b, weight FROM memory_entity_edges 
     WHERE entity_a = ? OR entity_b = ?`,
    [entityId, entityId]
  )
  
  const neighbors: { neighbor: string; weight: number }[] = []
  for (const edge of edgeRows) {
    const neighborId = edge.entity_a === entityId ? edge.entity_b : edge.entity_a
    const neighborRows = await db.select<{ name: string }[]>(
      'SELECT name FROM memory_entities WHERE id = ?',
      [neighborId]
    )
    if (neighborRows && neighborRows.length > 0) {
      neighbors.push({ neighbor: neighborRows[0].name, weight: edge.weight })
    }
  }
  return neighbors
}

// ============ PPR 算法 ============

/**
 * Personalized PageRank 幂迭代
 * 从种子节点扩散激活分数（HippoRAG 简化版）
 *
 * @param seeds 种子实体名列表（来自查询中的实体）
 * @param damping 阻尼因子（默认 0.15）
 * @param iterations 迭代次数（默认 20）
 * @returns 实体名 → PPR 分数的映射
 */
export async function personalizedPageRank(
  seeds: string[],
  damping: number = 0.15,
  iterations: number = 20
): Promise<Map<string, number>> {
  const scores = new Map<string, number>()
  if (seeds.length === 0) return scores
  
  // 初始化种子节点分数
  const seedSet = new Set(seeds)
  seeds.forEach(s => scores.set(s, 1 / seeds.length))
  
  // 幂迭代
  for (let i = 0; i < iterations; i++) {
    const newScores = new Map<string, number>()
    
    // 阻尼因子：随机跳转回种子
    seeds.forEach(s => {
      newScores.set(s, (newScores.get(s) || 0) + damping / seeds.length)
    })
    
    // 扩散：沿边传播分数
    for (const [node, score] of Array.from(scores.entries())) {
      if (score < 0.001) continue  // 剪枝：忽略极小分数
      const neighbors = await getEntityNeighbors(node)
      const totalWeight = neighbors.reduce((sum, n) => sum + n.weight, 0)
      if (totalWeight === 0) continue
      
      for (const { neighbor, weight } of neighbors) {
        const contribution = (1 - damping) * score * (weight / totalWeight)
        newScores.set(neighbor, (newScores.get(neighbor) || 0) + contribution)
      }
    }
    
    // 更新分数
    scores.clear()
    for (const [k, v] of Array.from(newScores.entries())) {
      if (v > 0.001) scores.set(k, v)  // 剪枝
    }
  }
  
  return scores
}

/**
 * PPR 多跳联想检索
 * 输入查询 → 提取实体 → PPR 扩散 → 返回相关记忆 ID
 */
export async function pprMultiHopRetrieval(
  queryEntities: string[],
  topK: number = 10
): Promise<{ memoryId: string; pprScore: number; entityPath: string[] }[]> {
  const pprScores = await personalizedPageRank(queryEntities)
  const results: { memoryId: string; pprScore: number; entityPath: string[] }[] = []
  
  // 获取高分实体的关联记忆
  const sortedEntities = Array.from(pprScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK * 2)  // 取 2x 作为候选
  
  for (const [entityName, score] of sortedEntities) {
    const entities = await findEntitiesByName([entityName])
    for (const ent of entities) {
      for (const memoryId of ent.memoryIds) {
        results.push({ memoryId, pprScore: score, entityPath: [...queryEntities, entityName] })
      }
    }
  }
  
  // 去重并按分数排序
  const seen = new Set<string>()
  return results
    .filter(r => {
      if (seen.has(r.memoryId)) return false
      seen.add(r.memoryId)
      return true
    })
    .sort((a, b) => b.pprScore - a.pprScore)
    .slice(0, topK)
}

// ============ 实体提取与建图 ============

/**
 * 简单实体提取（规则 + 词典）
 * P1-4 简化版：使用关键词匹配，未来可接入 NER 模型
 */
export function extractEntitiesSimple(text: string): { name: string; type: MemoryEntity['type'] }[] {
  const entities: { name: string; type: MemoryEntity['type'] }[] = []
  
  // 时间实体
  const timePatterns = [
    /(\d{4}年\d{1,2}月\d{1,2}日)/,
    /(今天|昨天|明天|上周|下周|上个月|下个月)/,
    /(早上|上午|中午|下午|晚上|凌晨)/,
  ]
  for (const pattern of timePatterns) {
    const match = text.match(pattern)
    if (match) entities.push({ name: match[1], type: 'time' })
  }
  
  // 地点实体（简单关键词）
  const locationKeywords = ['家', '公司', '学校', '医院', '公园', '餐厅', '北京', '上海']
  for (const loc of locationKeywords) {
    if (text.includes(loc)) entities.push({ name: loc, type: 'location' })
  }
  
  // 人物实体（称呼）
  const personPatterns = /(我|你|他|她|爸爸|妈妈|朋友|同事|老板)/g
  let personMatch
  while ((personMatch = personPatterns.exec(text)) !== null) {
    entities.push({ name: personMatch[1], type: 'person' })
  }
  
  // 去重
  const seen = new Set<string>()
  return entities.filter(e => {
    const key = `${e.name}:${e.type}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * 从记忆构建实体图（批量）
 * 用于初始化或重建实体图
 */
export async function buildEntityGraphFromMemories(
  memories: EnhancedMemory[]
): Promise<void> {
  await initEntityGraphTables()
  
  for (const memory of memories) {
    const entities = extractEntitiesSimple(memory.user + ' ' + memory.assistant)
    const entityIds: string[] = []
    
    // 添加实体节点
    for (const ent of entities) {
      const id = await upsertEntity(ent.name, ent.type, memory.id)
      entityIds.push(id)
    }
    
    // 添加实体间边（共现）
    for (let i = 0; i < entityIds.length; i++) {
      for (let j = i + 1; j < entityIds.length; j++) {
        await upsertEntityEdge(entityIds[i], entityIds[j], 1.0)
      }
    }
  }
}
