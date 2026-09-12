/**
 * 轻量力导向布局（纯计算，无 DOM / Canvas 依赖，便于单测）。
 *
 * 力模型：
 *  - 节点间库仑斥力：F = repulsion / d^2（重叠时加倍推离）
 *  - 边弹簧引力：F = springStrength * (d - restLength) * 权重系数
 *  - 向心重力：把节点拉向布局中心
 *  - 半隐式欧拉积分 + 速度阻尼，迭代收敛
 *
 * @module forceLayout
 */

export interface ForceNodeInput {
  id: string
  /** 节点半径（决定最小间距） */
  radius: number
}

export interface ForceLinkInput {
  source: string
  target: string
  weight: number
}

/** 布局后的节点（世界坐标） */
export interface LaidOutNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
}

export interface ForceLayoutOptions {
  width?: number
  height?: number
  iterations?: number
  /** 库仑斥力强度 */
  repulsion?: number
  /** 弹簧自然长度（px） */
  springLength?: number
  /** 弹簧劲度系数 */
  springStrength?: number
  /** 向心重力强度 */
  gravity?: number
  /** 速度阻尼（0-1，越小越快收敛但越易震荡） */
  damping?: number
}

const DEFAULTS = {
  iterations: 300,
  repulsion: 6000,
  springLength: 120,
  springStrength: 0.04,
  gravity: 0.02,
  damping: 0.9,
} as const

/** 圆形初始排布（确定性，便于测试复现） */
function initialLayout(nodes: ForceNodeInput[], cx: number, cy: number): LaidOutNode[] {
  const n = nodes.length
  const radius = Math.min(cx, cy) * 0.5
  return nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(n, 1)
    return {
      id: node.id,
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
      radius: node.radius,
    }
  })
}

/**
 * 运行力导向模拟，返回收敛后的节点位置与每轮总动能（便于断言收敛性）。
 *
 * @param nodes 节点（含半径）
 * @param links 边（source/target 为节点 id）
 * @param options 布局参数
 */
export function simulateForceLayout(
  nodes: ForceNodeInput[],
  links: ForceLinkInput[],
  options: ForceLayoutOptions = {},
): { nodes: LaidOutNode[]; energies: number[] } {
  const width = options.width ?? 600
  const height = options.height ?? 400
  const iterations = options.iterations ?? DEFAULTS.iterations
  const repulsion = options.repulsion ?? DEFAULTS.repulsion
  const springLength = options.springLength ?? DEFAULTS.springLength
  const springStrength = options.springStrength ?? DEFAULTS.springStrength
  const gravity = options.gravity ?? DEFAULTS.gravity
  const damping = options.damping ?? DEFAULTS.damping

  const cx = width / 2
  const cy = height / 2
  const laid = initialLayout(nodes, cx, cy)
  const byId = new Map(laid.map((n) => [n.id, n]))

  const energies: number[] = []

  for (let it = 0; it < iterations; it++) {
    // 清零本轮速度
    for (const n of laid) {
      n.vx = 0
      n.vy = 0
    }

    // 斥力（O(n^2)，实体规模小可接受）
    for (let i = 0; i < laid.length; i++) {
      for (let j = i + 1; j < laid.length; j++) {
        const a = laid[i]
        const b = laid[j]
        if (!a || !b) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        let distSq = dx * dx + dy * dy
        if (distSq < 1) distSq = 1
        const dist = Math.sqrt(distSq)
        const minDist = a.radius + b.radius
        // 重叠时加倍推离，保证节点不重叠
        const overlapFactor = dist < minDist ? 2.5 : 1
        const force = (repulsion / distSq) * overlapFactor
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx -= fx
        a.vy -= fy
        b.vx += fx
        b.vy += fy
      }
    }

    // 弹簧引力
    for (const link of links) {
      const a = byId.get(link.source)
      const b = byId.get(link.target)
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const force = springStrength * (dist - springLength) * (0.5 + link.weight)
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    // 向心重力
    for (const n of laid) {
      n.vx += (cx - n.x) * gravity
      n.vy += (cy - n.y) * gravity
    }

    // 积分 + 阻尼
    let energy = 0
    for (const n of laid) {
      n.x += n.vx * damping
      n.y += n.vy * damping
      energy += n.vx * n.vx + n.vy * n.vy
    }
    energies.push(energy)
  }

  return { nodes: laid, energies }
}

/**
 * 节点半径 → 画布半径映射（关联记忆越多越大）。
 */
export function memoryCountToRadius(memoryCount: number, base = 9, step = 3.5, max = 30): number {
  const r = base + Math.sqrt(Math.max(0, memoryCount)) * step
  return Math.min(max, Math.max(base, r))
}
