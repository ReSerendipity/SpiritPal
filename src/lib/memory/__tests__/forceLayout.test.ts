/**
 * forceLayout 力导向布局单测。
 * 覆盖：收敛性（总动能下降）、无连接节点不重叠、半径映射单调性。
 */
import { describe, it, expect } from 'vitest'
import {
  simulateForceLayout,
  memoryCountToRadius,
  type ForceNodeInput,
  type ForceLinkInput,
} from '@/lib/memory/forceLayout'

function makeNodes(n: number, radius = 10): ForceNodeInput[] {
  return Array.from({ length: n }, (_, i) => ({ id: `n-${i}`, radius }))
}

describe('simulateForceLayout', () => {
  it('无连接节点时，节点相互推开且最终不重叠', () => {
    const nodes = makeNodes(6, 10)
    const { nodes: laid } = simulateForceLayout(nodes, [], {
      width: 800,
      height: 600,
      iterations: 400,
    })

    // 找最小两两中心距离
    let minDist = Infinity
    for (let i = 0; i < laid.length; i++) {
      for (let j = i + 1; j < laid.length; j++) {
        const a = laid[i]!
        const b = laid[j]!
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (d < minDist) minDist = d
      }
    }
    // 两半径和 = 20，重叠时斥力加倍 → 应明显大于半径和
    expect(minDist).toBeGreaterThan(18)
  })

  it('迭代过程总动能下降（收敛性）', () => {
    const nodes = makeNodes(8, 10)
    const links: ForceLinkInput[] = [
      { source: 'n-0', target: 'n-1', weight: 1 },
      { source: 'n-1', target: 'n-2', weight: 1 },
      { source: 'n-2', target: 'n-3', weight: 1 },
      { source: 'n-3', target: 'n-4', weight: 1 },
      { source: 'n-4', target: 'n-5', weight: 1 },
      { source: 'n-5', target: 'n-6', weight: 1 },
      { source: 'n-6', target: 'n-7', weight: 1 },
      { source: 'n-7', target: 'n-0', weight: 1 },
    ]
    const { energies } = simulateForceLayout(nodes, links, {
      width: 800,
      height: 600,
      iterations: 300,
    })

    expect(energies.length).toBe(300)
    // 末尾平均动能应显著小于开头（收敛）
    const headAvg = energies.slice(0, 10).reduce((a, b) => a + b, 0) / 10
    const tailAvg = energies.slice(-20).reduce((a, b) => a + b, 0) / 20
    expect(tailAvg).toBeLessThan(headAvg)
  })

  it('返回的节点数与输入一致，且都落在布局范围内', () => {
    const nodes = makeNodes(5, 8)
    const { nodes: laid } = simulateForceLayout(nodes, [], {
      width: 500,
      height: 400,
      iterations: 100,
    })
    expect(laid.length).toBe(5)
    for (const n of laid) {
      expect(n.x).toBeGreaterThan(-100)
      expect(n.x).toBeLessThan(600)
      expect(n.y).toBeGreaterThan(-100)
      expect(n.y).toBeLessThan(500)
    }
  })

  it('空节点输入不报错', () => {
    const { nodes, energies } = simulateForceLayout([], [], { iterations: 10 })
    expect(nodes).toEqual([])
    expect(energies.length).toBe(10)
  })
})

describe('memoryCountToRadius', () => {
  it('记忆越多半径越大（单调不减）', () => {
    const r0 = memoryCountToRadius(0)
    const r5 = memoryCountToRadius(5)
    const r50 = memoryCountToRadius(50)
    expect(r5).toBeGreaterThan(r0)
    expect(r50).toBeGreaterThan(r5)
  })

  it('半径被限制在 [base, max] 区间', () => {
    const small = memoryCountToRadius(0)
    const huge = memoryCountToRadius(100000)
    expect(small).toBeGreaterThanOrEqual(9)
    expect(huge).toBeLessThanOrEqual(30)
  })
})
