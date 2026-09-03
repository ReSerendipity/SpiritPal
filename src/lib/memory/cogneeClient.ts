/**
 * cognee 记忆 sidecar 客户端
 *
 * ADR-0003：调用隔离 cognee API server（默认 http://127.0.0.1:7531），
 * 提供实体抽取 / 图谱写入 / 混合检索；失败时调用方应回退到本地 keyframeMemory。
 *
 * 该模块不强制依赖 sidecar 在线：所有方法对网络错误做静默降级，
 * 由上层 useEnhancedMemory 决定是否回退到本地时序索引。
 */

const SIDECAR_BASE =
  (import.meta.env.VITE_MEMORY_SIDECAR_URL as string | undefined) ??
  'http://127.0.0.1:7531'

export interface CogneeSearchResult {
  text: string
  score: number | null
}

export interface CogneeHealth {
  status: string
  cogneeAvailable: boolean
}

/** 探测 sidecar 与 cognee 是否可用（超时 1.5s）。 */
export async function cogneeHealth(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 1500)
    const r = await fetch(`${SIDECAR_BASE}/health`, { signal: ctrl.signal })
    clearTimeout(t)
    if (!r.ok) return false
    const j = (await r.json()) as CogneeHealth
    return Boolean(j.cogneeAvailable)
  } catch {
    return false
  }
}

/** 写入一条记忆（抽取实体-关系并加入图谱）。失败静默，不阻断主流程。 */
export async function cogneeAdd(
  characterId: string,
  text: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    await fetch(`${SIDECAR_BASE}/memory/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_id: characterId, text, metadata }),
      signal: ctrl.signal,
    })
    clearTimeout(t)
  } catch {
    /* 记忆写入失败不阻断主流程 */
  }
}

/** 混合检索（关系型记忆）。失败/不可用返回空数组，由上层回退。 */
export async function cogneeSearch(
  characterId: string,
  query: string,
  topK = 5,
): Promise<CogneeSearchResult[]> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 5000)
    const r = await fetch(`${SIDECAR_BASE}/memory/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ character_id: characterId, query, top_k: topK }),
      signal: ctrl.signal,
    })
    clearTimeout(t)
    if (!r.ok) return []
    const j = (await r.json()) as { results?: CogneeSearchResult[] }
    return j.results ?? []
  } catch {
    return []
  }
}
