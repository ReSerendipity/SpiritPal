/**
 * @file EntityGraphView.tsx
 * @description 实体关系图谱 — 纯 Canvas 力导向可视化。
 *
 * 数据来源：entityGraph.getAllEntities / getAllEdges（真实 entity_nodes 表）。
 * 交互：点击节点 → 侧边记忆列表 / hover → 详情 tooltip / 拖拽重定位 / 滚轮缩放 + 平移。
 *
 * 不引入 d3 等新依赖；力导向布局在 forceLayout.ts（纯计算，可单测）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Network } from 'lucide-react'
import {
  getAllEntities,
  getAllEdges,
  getEntityMemories,
  type GraphEntity,
  type GraphEdge,
  type GraphEntityType,
} from '@/lib/memory/entityGraph'
import {
  simulateForceLayout,
  memoryCountToRadius,
  type LaidOutNode,
} from '@/lib/memory/forceLayout'
import { usePetStore } from '@/stores/petStore'

/** 逻辑坐标系尺寸（与力导向布局一致，与 canvas 像素解耦） */
const LOGICAL_W = 1000
const LOGICAL_H = 700

/** 实体类型 → 节点颜色 */
const TYPE_COLORS: Record<GraphEntityType, string> = {
  person: '#e8874a',
  place: '#4caf50',
  thing: '#2196f3',
  time: '#9e9e9e',
  concept: '#9c27b0',
  event: '#f44336',
}

const TYPE_LABELS: Record<GraphEntityType, string> = {
  person: '人物',
  place: '地点',
  thing: '物品',
  time: '时间',
  concept: '概念',
  event: '事件',
}

export interface EntityGraphViewProps {
  /** 可选：注入数据（用于测试）。缺省时按 characterId 从真实 DB 拉取。 */
  entities?: GraphEntity[]
  edges?: GraphEdge[]
}

interface ViewTransform {
  scale: number
  tx: number
  ty: number
}

interface HoverInfo {
  entity: GraphEntity
  /** 屏幕坐标（用于 tooltip 定位） */
  x: number
  y: number
}

export function EntityGraphView({ entities, edges }: EntityGraphViewProps) {
  const currentCharacterId = usePetStore((s) => s.currentCharacterId)

  const [entitiesList, setEntitiesList] = useState<GraphEntity[]>(entities ?? [])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<GraphEntity | null>(null)
  const [selectedMemories, setSelectedMemories] = useState<Array<Record<string, unknown>>>([])
  const [hover, setHover] = useState<HoverInfo | null>(null)

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const positionsRef = useRef<Map<string, LaidOutNode>>(new Map())
  const transformRef = useRef<ViewTransform>({ scale: 1, tx: 0, ty: 0 })
  const entityByIdRef = useRef<Map<string, GraphEntity>>(new Map())
  const edgesRef = useRef<GraphEdge[]>([])
  const selectedIdRef = useRef<string | null>(null)
  const dragRef = useRef<{
    kind: 'node' | 'pan' | null
    nodeId: string | null
    offX: number
    offY: number
    startX: number
    startY: number
    moved: number
  }>({ kind: null, nodeId: null, offX: 0, offY: 0, startX: 0, startY: 0, moved: 0 })

  // ---------- 渲染 ----------
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const { scale, tx, ty } = transformRef.current

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(scale, 0, 0, scale, tx, ty)

    // 边
    for (const e of edgesRef.current) {
      const a = positionsRef.current.get(e.source)
      const b = positionsRef.current.get(e.target)
      if (!a || !b) continue
      ctx.strokeStyle = 'rgba(120,120,140,0.35)'
      ctx.lineWidth = Math.min(3, 0.5 + e.weight * 0.5)
      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)
      ctx.stroke()
    }

    // 节点 + 标签
    for (const [id, p] of positionsRef.current) {
      const ent = entityByIdRef.current.get(id)
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2)
      ctx.fillStyle = ent ? TYPE_COLORS[ent.type] : '#999'
      ctx.fill()
      if (id === selectedIdRef.current) {
        ctx.strokeStyle = '#e8874a'
        ctx.lineWidth = 2.5
        ctx.stroke()
      }
      ctx.fillStyle = '#444'
      ctx.font = '11px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(ent ? ent.name : id, p.x, p.y + p.radius + 12)
    }
  }, [])

  // ---------- 数据加载 + 初始布局 ----------
  useEffect(() => {
    let cancelled = false

    const applyData = (ents: GraphEntity[], eds: GraphEdge[]) => {
      setEntitiesList(ents)
      entityByIdRef.current = new Map(ents.map((e) => [e.id, e]))
      edgesRef.current = eds
      const simNodes = ents.map((e) => ({
        id: e.id,
        radius: memoryCountToRadius(e.memoryCount),
      }))
      const simLinks = eds.map((e) => ({
        source: e.source,
        target: e.target,
        weight: e.weight,
      }))
      const { nodes } = simulateForceLayout(simNodes, simLinks, {
        width: LOGICAL_W,
        height: LOGICAL_H,
      })
      positionsRef.current = new Map(nodes.map((n) => [n.id, n]))
      transformRef.current = { scale: 1, tx: 0, ty: 0 }
      draw()
    }

    // 注入数据优先（测试）；否则拉真实数据
    if (entities && edges) {
      applyData(entities, edges)
      return
    }

    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const ents = await getAllEntities(currentCharacterId)
        const eds = await getAllEdges(currentCharacterId)
        if (cancelled) return
        applyData(ents, eds)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [currentCharacterId, entities, edges, draw])

  // ---------- 坐标换算 ----------
  const toLogical = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    const px = (clientX - rect.left) * (canvas.width / Math.max(1, rect.width))
    const py = (clientY - rect.top) * (canvas.height / Math.max(1, rect.height))
    const { scale, tx, ty } = transformRef.current
    return { x: (px - tx) / scale, y: (py - ty) / scale }
  }, [])

  const pickNode = useCallback((wx: number, wy: number): string | null => {
    let best: string | null = null
    let bestDist = Infinity
    for (const [id, p] of positionsRef.current) {
      const d = Math.hypot(p.x - wx, p.y - wy)
      if (d <= p.radius && d < bestDist) {
        best = id
        bestDist = d
      }
    }
    return best
  }, [])

  // ---------- 选中实体 → 加载关联记忆 ----------
  const selectEntity = useCallback(
    async (ent: GraphEntity) => {
      setSelected(ent)
      selectedIdRef.current = ent.id
      setSelectedMemories([])
      draw()
      try {
        const mems = await getEntityMemories(currentCharacterId, ent.id)
        setSelectedMemories(mems)
      } catch (e) {
        console.warn('[EntityGraphView] 加载实体记忆失败:', e)
      }
    },
    [currentCharacterId, draw],
  )

  // ---------- 鼠标事件 ----------
  const onMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { x, y } = toLogical(e.clientX, e.clientY)
      const hit = pickNode(x, y)
      dragRef.current = {
        kind: hit ? 'node' : 'pan',
        nodeId: hit,
        offX: x,
        offY: y,
        startX: e.clientX,
        startY: e.clientY,
        moved: 0,
      }
    },
    [toLogical, pickNode],
  )

  const onMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current
      const { x, y } = toLogical(e.clientX, e.clientY)

      if (drag.kind === 'node' && drag.nodeId) {
        const node = positionsRef.current.get(drag.nodeId)
        if (node) {
          node.x = x
          node.y = y
          drag.moved = Math.max(
            drag.moved,
            Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY),
          )
          draw()
        }
        return
      }
      if (drag.kind === 'pan') {
        const rect = canvasRef.current?.getBoundingClientRect()
        const kx = rect ? canvasRef.current!.width / Math.max(1, rect.width) : 1
        const ky = rect ? canvasRef.current!.height / Math.max(1, rect.height) : 1
        transformRef.current.tx += (e.clientX - drag.offX) * kx
        transformRef.current.ty += (e.clientY - drag.offY) * ky
        drag.offX = e.clientX
        drag.offY = e.clientY
        drag.moved = Math.max(
          drag.moved,
          Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY),
        )
        draw()
        return
      }

      // 无拖拽：hover 检测
      const hitId = pickNode(x, y)
      const ent = hitId ? entityByIdRef.current.get(hitId) : undefined
      if (ent) {
        setHover({ entity: ent, x: e.clientX, y: e.clientY })
      } else {
        setHover(null)
      }
    },
    [toLogical, pickNode, draw],
  )

  const onMouseUp = useCallback(() => {
    const drag = dragRef.current
    // 视为点击（位移很小）：选中节点
    if (drag.kind === 'node' && drag.nodeId && drag.moved < 4) {
      const ent = entityByIdRef.current.get(drag.nodeId)
      if (ent) void selectEntity(ent)
    }
    dragRef.current = {
      kind: null,
      nodeId: null,
      offX: 0,
      offY: 0,
      startX: 0,
      startY: 0,
      moved: 0,
    }
  }, [selectEntity])

  const onMouseLeave = useCallback(() => {
    setHover(null)
    dragRef.current = {
      kind: null,
      nodeId: null,
      offX: 0,
      offY: 0,
      startX: 0,
      startY: 0,
      moved: 0,
    }
  }, [])

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      const kx = canvas.width / Math.max(1, rect.width)
      const ky = canvas.height / Math.max(1, rect.height)
      const kpx = (e.clientX - rect.left) * kx
      const kpy = (e.clientY - rect.top) * ky

      const v = transformRef.current
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const newScale = Math.min(3, Math.max(0.3, v.scale * factor))

      // 以光标下的世界点为中心缩放：保持该点屏幕坐标不变
      const wx = (kpx - v.tx) / v.scale
      const wy = (kpy - v.ty) / v.scale
      v.scale = newScale
      v.tx = kpx - wx * newScale
      v.ty = kpy - wy * newScale
      draw()
    },
    [draw],
  )

  // ---------- 渲染 UI ----------
  return (
    <div className="relative flex h-full w-full overflow-hidden rounded-lg border border-ink/10 bg-surface">
      <div className="relative flex-1">
        <canvas
          ref={canvasRef}
          width={LOGICAL_W}
          height={LOGICAL_H}
          className="h-full w-full cursor-grab active:cursor-grabbing"
          data-testid="entity-graph-canvas"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onWheel={onWheel}
        />

        {/* 空 / 加载 / 错误状态 */}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-muted">
            正在加载实体图谱…
          </div>
        )}
        {!loading && !error && entitiesList.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-ink-muted">
            <Network size={32} className="opacity-30" />
            <p>暂无实体数据</p>
            <p className="text-xs text-ink-faint">对话中提取的人物/地点/事件会自动出现在这里</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-red-500">
            图谱加载失败：{error}
          </div>
        )}

        {/* hover tooltip */}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 rounded border border-ink/10 bg-white/95 px-2 py-1 text-xs shadow-md"
            style={{ left: hover.x + 12, top: hover.y + 12 }}
            data-testid="entity-tooltip"
          >
            <div className="font-medium text-ink">{hover.entity.name}</div>
            <div className="text-ink-muted">
              {TYPE_LABELS[hover.entity.type]} · {hover.entity.memoryCount} 条记忆
            </div>
          </div>
        )}
      </div>

      {/* 侧边：选中实体的记忆列表 */}
      {selected && (
        <div className="flex w-64 shrink-0 flex-col border-l border-ink/10 bg-surface">
          <div className="flex items-center justify-between border-b border-ink/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: TYPE_COLORS[selected.type] }}
              />
              <span className="text-sm font-medium text-ink">{selected.name}</span>
            </div>
            <button
              onClick={() => {
                setSelected(null)
                selectedIdRef.current = null
                setSelectedMemories([])
                draw()
              }}
              className="rounded p-1 text-ink-faint hover:bg-ink/5 hover:text-ink"
              aria-label="关闭"
            >
              <X size={14} />
            </button>
          </div>
          <div className="px-3 py-1.5 text-[11px] text-ink-faint">
            {TYPE_LABELS[selected.type]} · {selectedMemories.length} 条关联记忆
          </div>
          <div className="flex-1 overflow-y-auto px-3 pb-3">
            {selectedMemories.length === 0 ? (
              <p className="py-4 text-center text-xs text-ink-faint">暂无关联记忆</p>
            ) : (
              selectedMemories.map((m, i) => (
                <div key={i} className="mb-2 rounded border border-ink/10 p-2 text-xs text-ink">
                  {typeof m.content === 'string' ? m.content : JSON.stringify(m)}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default EntityGraphView
