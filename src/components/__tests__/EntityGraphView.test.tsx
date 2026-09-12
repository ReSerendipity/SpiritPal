/**
 * EntityGraphView 组件渲染单测。
 * 数据通过 props 注入（组件内置该测试入口），不触达真实 DB。
 * jsdom 无 canvas 2d 上下文，组件需在 getContext 返回 null 时安全降级。
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { EntityGraphView } from '@/components/memory/EntityGraphView'
import type { GraphEntity, GraphEdge } from '@/lib/memory/entityGraph'

vi.mock('@/stores/petStore', () => ({
  usePetStore: (selector: (s: unknown) => unknown) => selector({ currentCharacterId: 'doro' }),
}))

const sampleEntities: GraphEntity[] = [
  { id: 'e1', name: '主人', type: 'person', memoryCount: 4, memoryIds: ['m1', 'm2', 'm3', 'm4'], mentionCount: 4, createdAt: 1 },
  { id: 'e2', name: '公司', type: 'place', memoryCount: 2, memoryIds: ['m2', 'm3'], mentionCount: 2, createdAt: 2 },
  { id: 'e3', name: '项目会议', type: 'event', memoryCount: 1, memoryIds: ['m3'], mentionCount: 1, createdAt: 3 },
]

const sampleEdges: GraphEdge[] = [
  { source: 'e1', target: 'e2', weight: 2, cooccurCount: 2 },
  { source: 'e2', target: 'e3', weight: 1, cooccurCount: 1 },
]

describe('EntityGraphView', () => {
  it('注入数据时渲染 canvas 且不崩溃', () => {
    render(<EntityGraphView entities={sampleEntities} edges={sampleEdges} />)
    expect(screen.getByTestId('entity-graph-canvas')).toBeInTheDocument()
  })

  it('无实体数据时显示空状态提示', () => {
    render(<EntityGraphView entities={[]} edges={[]} />)
    expect(screen.getByText('暂无实体数据')).toBeInTheDocument()
  })

  it('有数据时不显示空状态', () => {
    render(<EntityGraphView entities={sampleEntities} edges={sampleEdges} />)
    expect(screen.queryByText('暂无实体数据')).toBeNull()
  })
})
