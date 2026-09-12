/**
 * P1-4: 实体图 + PPR 多跳联想模块
 *
 * 实现 HippoRAG 简化版：
 * - SQLite 两表：memory_entities / memory_entity_edges
 * - PPR 幂迭代：从种子节点扩散激活分数
 *
 * @module entityGraph
 */

import {
  upsertEntityGraphNode,
  upsertEntityGraphEdge,
  findEntityNodesByName,
  getEntityGraphNeighbors,
  getEntityNodes,
  getMemories,
} from '@/lib/data/db'
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

/** Float32Array → base64（与 db.ts 存 memory_entities.embedding 一致） */
function embeddingToBase64(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
    binary += String.fromCharCode.apply(null, chunk as unknown as number[])
  }
  return btoa(binary)
}

/**
 * 初始化实体图表（幂等）。
 * 表结构已由 Rust 端 ensure_schema 创建，此处为兼容保留的无操作。
 */
export async function initEntityGraphTables(): Promise<void> {
  return
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
  const now = Date.now()
  const candidateId = `ent-${now}-${Math.random().toString(36).slice(2, 9)}`
  return upsertEntityGraphNode({
    name,
    nodeType: type,
    memoryId,
    candidateId,
    createdAt: now,
    embeddingB64: embedding ? embeddingToBase64(embedding) : null,
  })
}

/**
 * 添加或更新实体关系边
 */
export async function upsertEntityEdge(
  entityA: string,
  entityB: string,
  weightIncrement: number = 1.0
): Promise<void> {
  const [a, b] = entityA < entityB ? [entityA, entityB] : [entityB, entityA]  // 保证顺序一致
  await upsertEntityGraphEdge({ entityA: a, entityB: b, weightIncrement, createdAt: Date.now() })
}

/**
 * 从查询中提取实体名（简单分词后查表）
 */
export async function findEntitiesByName(names: string[]): Promise<MemoryEntity[]> {
  if (names.length === 0) return []

  const rows = await findEntityNodesByName(names)

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
  return getEntityGraphNeighbors(entityName)
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

// ============ 图谱视图查询（EntityGraphView 数据层） ============

/**
 * 图谱视图实体类型（与 entity_nodes 表 / entityLinking EntityType 对齐）。
 * 注意：这是 entity_nodes 存储的类型，与上面 MemoryEntity['type']（P1-4 memory_entities 表）
 * 是两套独立存储，不要混用。
 */
export type GraphEntityType = 'person' | 'place' | 'thing' | 'time' | 'concept' | 'event'

/** 图谱视图节点（力导向图渲染单元） */
export interface GraphEntity {
  id: string
  name: string
  type: GraphEntityType
  /** 关联记忆数量（节点大小映射） */
  memoryCount: number
  /** 关联的记忆 ID 列表 */
  memoryIds: string[]
  /** 提及次数 */
  mentionCount: number
  createdAt: number
}

/** 图谱视图边 */
export interface GraphEdge {
  source: string
  target: string
  /** 权重（共享记忆数） */
  weight: number
  /** 共现次数（= weight，冗余便于调试） */
  cooccurCount: number
}

/** entity_nodes.type → GraphEntityType 归一化（未知类型归入 concept） */
function normalizeGraphType(t: string): GraphEntityType {
  switch (t) {
    case 'person':
    case 'place':
    case 'thing':
    case 'time':
    case 'concept':
    case 'event':
      return t
    default:
      return 'concept'
  }
}

/**
 * 查询角色的全部实体（真实数据：entity_nodes 表 via sp_entity_list）。
 *
 * 背景：P1-4 的 memory_entities 表当前没有「列出全部」的 Rust 命令（本任务不改 Rust），
 * 而 entity_nodes 表（entityLinking 写入）已有 sp_entity_list 且是活跃填充的实体存储，
 * 故图谱视图直接以它为数据源。
 */
export async function getAllEntities(characterId: string): Promise<GraphEntity[]> {
  const rows = await getEntityNodes(characterId)
  return rows.map((r) => {
    let memoryIds: string[] = []
    try {
      const parsed = JSON.parse(r.linked_memory_ids) as unknown
      if (Array.isArray(parsed)) memoryIds = parsed.filter((x): x is string => typeof x === 'string')
    } catch {
      memoryIds = []
    }
    return {
      id: r.id,
      name: r.name,
      type: normalizeGraphType(r.type),
      memoryCount: memoryIds.length,
      memoryIds,
      mentionCount: r.mention_count,
      createdAt: r.first_seen,
    }
  })
}

/**
 * 从实体的共享记忆共现派生关系边（纯函数，便于单测）。
 * 两个实体出现在同一条记忆中 → 一条边，权重 = 共享记忆数。
 */
export function buildCooccurrenceEdges(entities: GraphEntity[]): GraphEdge[] {
  // memoryId -> 实体 id 列表
  const memoryToEntities = new Map<string, string[]>()
  for (const e of entities) {
    for (const mid of e.memoryIds) {
      const arr = memoryToEntities.get(mid)
      if (arr) arr.push(e.id)
      else memoryToEntities.set(mid, [e.id])
    }
  }

  const pairKey = (a: string, b: string) => (a < b ? `${a}||${b}` : `${b}||${a}`)
  const weights = new Map<string, number>()
  for (const ids of memoryToEntities.values()) {
    if (ids.length < 2) continue
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i]
        const b = ids[j]
        if (a === undefined || b === undefined) continue
        const k = pairKey(a, b)
        weights.set(k, (weights.get(k) ?? 0) + 1)
      }
    }
  }

  const edges: GraphEdge[] = []
  for (const [k, weight] of weights) {
    const [source, target] = k.split('||')
    if (source && target) edges.push({ source, target, weight, cooccurCount: weight })
  }
  return edges
}

/** 查询角色实体关系边（= getAllEntities + 共现派生） */
export async function getAllEdges(characterId: string): Promise<GraphEdge[]> {
  const entities = await getAllEntities(characterId)
  return buildCooccurrenceEdges(entities)
}

/**
 * 查询某实体关联的记忆行（真实数据：memories 表 via sp_mem_list）。
 * 按实体的 linked_memory_ids 过滤。
 */
export async function getEntityMemories(
  characterId: string,
  entityId: string,
): Promise<Array<Record<string, unknown>>> {
  const entities = await getAllEntities(characterId)
  const entity = entities.find((e) => e.id === entityId)
  if (!entity || entity.memoryIds.length === 0) return []
  const rows = await getMemories(characterId)
  const idSet = new Set(entity.memoryIds)
  return rows.filter((r) => {
    const mid = (r as { memory_id?: string | null }).memory_id
    return mid != null && idSet.has(mid)
  })
}
