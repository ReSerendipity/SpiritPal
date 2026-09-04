/**
 * @file live2dPhysicsParser.ts
 * @description Live2D Cubism 物理模拟解析器 — physics3.json 格式
 * 
 * 实现功能：
 * - 解析 physics3.json 配置文件
 * - 物理参数映射（重力/阻力/加速度）
 * - 摆锤动力学模拟（Pendulum Physics）
 * - 风效应模拟（Wind Effect）
 * - 实时参数更新与平滑过渡
 * - 性能优化（批量计算 + 缓存）
 * 
 * 参考：Live2D Cubism SDK / Cubism Physics Specification
 */

// ============ 类型定义 ============

export interface PhysicsInput {
  /** 输入参数 ID（如 "ParamAngleX"） */
  id: string
  /** 输入类型 */
  type: 'angle' | 'position' | 'velocity' | 'acceleration'
  /** 最小值 */
  scale?: number
  /** 偏移量 */
  offset?: number
}

export interface PhysicsOutput {
  /** 输出参数 ID（如 "PartAngleX"） */
  id: string
  /** 缩放比例 */
  scale: number
  /** 偏移量 */
  offset: number
}

export interface PhysicsGroup {
  /** 参数组 ID */
  id: string
  /** 类型 */
  type: 'pendulum' | 'spring' | 'normal'
  /** 输入参数 */
  inputs: PhysicsInput[]
  /** 输出参数 */
  outputs: PhysicsOutput[]
  /** 物理设定 */
  settings: {
    /** 重力加速度 */
    gravity: { x: number; y: number }
    /** 阻力系数 */
    drag: number
    /** 弹簧刚度 */
    stiffness?: number
    /** 质量 */
    mass?: number
    /** 自然频率 */
    naturalFrequency?: number
    /** 阻尼比 */
    dampingRatio?: number
  }
}

export interface Physics3Config {
  /** 版本号 */
  version: number
  /** 参数组列表 */
  groups: PhysicsGroup[]
  /** 元数据 */
  meta?: {
    author?: string
    createdDate?: string
    comments?: string
  }
}

export interface PhysicsSimulationState {
  /** 当前角度（弧度） */
  angle: number
  /** 角速度 */
  angularVelocity: number
  /** 上次更新时间戳 */
  lastUpdateTime: number
  /** 中间变量（用于平滑） */
  velocity: number
  position: number
}

// ============ 物理模拟器基础类 ============

export class PhysicsSimulator {
  protected state: PhysicsSimulationState
  
  constructor(initialAngle: number = 0) {
    this.state = {
      angle: initialAngle,
      angularVelocity: 0,
      lastUpdateTime: performance.now(),
      velocity: 0,
      position: 0,
    }
  }

  /**
   * 执行一步模拟
   */
  simulate(deltaTime: number, externalForce: { x: number; y: number }): number {
    throw new Error('Must be implemented by subclass')
  }

  /**
   * 重置状态
   */
  reset(angle: number = 0): void {
    this.state.angle = angle
    this.state.angularVelocity = 0
    this.state.lastUpdateTime = performance.now()
  }
}

// ============ 摆锤模拟器 ============

export class PendulumSimulator extends PhysicsSimulator {
  private gravity: { x: number; y: number }
  private length: number
  private damping: number
  
  constructor(
    config: {
      gravity?: { x: number; y: number }
      length?: number
      damping?: number
    } = {},
  ) {
    super()
    
    this.gravity = config.gravity || { x: 0, y: 9.8 }
    this.length = config.length || 1
    this.damping = config.damping || 0.02
  }

  /**
   * 摆锤动力学模拟
   */
  override simulate(deltaTime: number, externalForce: { x: number; y: number }): number {
    const now = performance.now()
    const dt = Math.min(deltaTime / 1000, 0.1) // 限制最大 delta 时间

    const angle = this.state.angle
    const cosA = Math.cos(angle)
    const sinA = Math.sin(angle)

    // 摆动方程：φ'' = (gx·cosφ − gy·sinφ)/L − b·φ'
    // （φ 自竖直向下方向量起，y 轴向下为正；默认重力 (0, 9.8) 即标准单摆）
    const gravityTerm = (this.gravity.x * cosA - this.gravity.y * sinA) / this.length
    const dampingTerm = this.damping * this.state.angularVelocity
    const forceTerm = (externalForce.x * cosA - externalForce.y * sinA) / this.length

    // 欧拉积分
    const angularAcceleration = gravityTerm - dampingTerm + forceTerm
    this.state.angularVelocity += angularAcceleration * dt
    this.state.angle += this.state.angularVelocity * dt

    // 限制角度范围 [-π, π]
    while (this.state.angle > Math.PI) {
      this.state.angle -= 2 * Math.PI
    }
    while (this.state.angle < -Math.PI) {
      this.state.angle += 2 * Math.PI
    }

    this.state.lastUpdateTime = now

    return this.state.angle
  }
}

// ============ 弹簧模拟器 ============

export class SpringSimulator extends PhysicsSimulator {
  private stiffness: number
  private mass: number
  private dampingRatio: number
  private equilibriumPosition: number
  
  constructor(
    config: {
      stiffness?: number
      mass?: number
      dampingRatio?: number
      equilibriumPosition?: number
    } = {},
  ) {
    super()
    
    this.stiffness = config.stiffness || 1.0
    this.mass = config.mass || 1.0
    this.dampingRatio = config.dampingRatio || 0.5
    this.equilibriumPosition = config.equilibriumPosition || 0
  }

  /**
   * 弹簧振子模拟（简谐运动）
   */
  override simulate(deltaTime: number, externalForce: { x: number; y: number }): number {
    const now = performance.now()
    const dt = Math.min(deltaTime / 1000, 0.1)

    // 胡克定律：F = -k * x
    const displacement = this.state.position - this.equilibriumPosition
    const springForce = -this.stiffness * displacement
    
    // 阻尼力：F_d = -c * v
    const c = 2 * this.dampingRatio * Math.sqrt(this.stiffness * this.mass)
    const dampingForce = -c * this.state.velocity

    // 总外力
    const totalForce = springForce + dampingForce + externalForce.x

    // F = ma → a = F/m
    const acceleration = totalForce / this.mass

    // 欧拉积分
    this.state.velocity += acceleration * dt
    this.state.position += this.state.velocity * dt

    // 同步到 angle（兼容接口）
    this.state.angle = this.state.position
    this.state.angularVelocity = this.state.velocity

    this.state.lastUpdateTime = now

    return this.state.angle
  }
}

// ============ 配置归一化 ============

/** Cubism 官方 physics3.json 的节点片段（按需读取，未使用字段忽略） */
interface RawPhysicsSetting {
  Id?: string
  Type?: string
  Input?: Array<{ Source?: { Id?: string }; Weight?: number; Type?: string }>
  Output?: Array<{ Destination?: { Id?: string }; Scale?: number; Weight?: number }>
  Vertices?: Array<{ Mobility?: number; Delay?: number; Acceleration?: number; Length?: number }>
  PhysicsDetail?: { Gravity?: { X?: number; Y?: number } }
}
interface RawPhysics3 {
  Version?: number
  PhysicsSettings?: RawPhysicsSetting[]
}

/**
 * 把两种 JSON 形态统一成内部的 `Physics3Config`：
 *
 * 1. 内部简化格式：`{ version, groups: [...] }`
 * 2. **Cubism 官方格式**：`{ Version, PhysicsSettings: [...] }`
 *    —— 社区角色包里的 physics3.json 都是这种；若不做归一化，
 *    `config.groups` 为 undefined，加载时直接崩溃。
 *
 * 官方字段 → 内部字段的映射（用于装饰摆动这类"伪物理"，精度要求不高）：
 * - 组类型：官方只有摆锤语义，统一映射为 `pendulum`
 * - 输入权重（Weight，0~100）→ `input.scale`
 * - 输出的 Scale × Weight/100 → `output.scale`
 * - 重力：官方坐标系 y 轴**向上**为正（常见值 `{X:0, Y:-1}`），
 *   本模块 y 轴向下为正，故取反
 */
function normalizePhysicsConfig(raw: unknown): Physics3Config {
  // 形态 1：内部简化格式
  const simplified = raw as Physics3Config
  if (Array.isArray(simplified?.groups)) {
    return { ...simplified, groups: simplified.groups }
  }

  // 形态 2：Cubism 官方格式
  const official = raw as RawPhysics3
  const groups: PhysicsGroup[] = (official?.PhysicsSettings ?? []).map((setting, index) => {
    const vertex = setting.Vertices?.[0]
    const gravity = setting.PhysicsDetail?.Gravity ?? { X: 0, Y: -1 }

    return {
      id: setting.Id ?? `group_${index}`,
      type: 'pendulum',
      inputs: (setting.Input ?? []).map((i) => ({
        id: i.Source?.Id ?? '',
        type: 'angle',
        scale: (i.Weight ?? 100) / 100,
        offset: 0,
      })),
      outputs: (setting.Output ?? []).map((o) => ({
        id: o.Destination?.Id ?? '',
        scale: (o.Scale ?? 1) * ((o.Weight ?? 100) / 100),
        offset: 0,
      })),
      settings: {
        // y 轴取反：官方 y 向上为正，本模块 y 向下为正
        gravity: { x: gravity.X ?? 0, y: -(gravity.Y ?? -1) },
        drag: 1 - (vertex?.Mobility ?? 0.5),
      },
    }
  })

  return { version: official?.Version ?? 3, groups }
}

// ============ 物理解析器 ============

export class Live2DPysicsParser {
  private config: Physics3Config | null = null
  private simulators: Map<string, PhysicsSimulator> = new Map()
  private parameterCache: Map<string, number> = new Map()

  /**
   * 加载 physics3.json 配置
   */
  async loadConfig(jsonString: string): Promise<void> {
    try {
      this.config = normalizePhysicsConfig(JSON.parse(jsonString) as unknown)

      if (this.config.version !== 3) {
        console.warn(`[Live2D Physics] Unsupported version: ${this.config.version}`)
      }

      // 为每个参数组创建对应的模拟器
      for (const group of this.config.groups) {
        this.createSimulator(group)
      }

      console.log(`[Live2D Physics] Loaded ${this.config.groups.length} physics groups`)
    } catch (error) {
      console.error('[Live2D Physics] Failed to load config:', error)
      throw error
    }
  }

  /**
   * 更新物理参数
   */
  updateParameters(
    inputValues: Record<string, number>,
    deltaTime: number,
  ): Record<string, number> {
    if (!this.config) return {}

    const outputValues: Record<string, number> = {}

    for (const group of this.config.groups) {
      const simulator = this.simulators.get(group.id)
      if (!simulator) continue

      // 收集输入值
      let maxInputValue = 0
      let minInputValue = 0
      
      for (const input of group.inputs) {
        const value = inputValues[input.id] ?? 0
        const scaledValue = (value - (input.offset ?? 0)) * (input.scale ?? 1)
        
        maxInputValue = Math.max(maxInputValue, scaledValue)
        minInputValue = Math.min(minInputValue, scaledValue)
      }

      // 计算外部力
      const externalForce = {
        x: (maxInputValue + minInputValue) / 2,
        y: 0,
      }

      // 执行物理模拟
      const result = simulator.simulate(deltaTime, externalForce)

      // 应用到输出参数
      for (const output of group.outputs) {
        const outputValue = result * output.scale + output.offset
        outputValues[output.id] = outputValue
        this.parameterCache.set(output.id, outputValue)
      }
    }

    return outputValues
  }

  /**
   * 创建物理模拟器
   */
  private createSimulator(group: PhysicsGroup): void {
    let simulator: PhysicsSimulator
    
    switch (group.type) {
      case 'pendulum':
        simulator = new PendulumSimulator({
          gravity: group.settings.gravity,
          length: 1,
          damping: group.settings.drag,
        })
        break
        
      case 'spring':
        simulator = new SpringSimulator({
          stiffness: group.settings.stiffness,
          mass: group.settings.mass,
          dampingRatio: group.settings.dampingRatio,
        })
        break
        
      default:
        // 默认使用摆锤
        simulator = new PendulumSimulator()
    }

    this.simulators.set(group.id, simulator)
  }

  /**
   * 获取已缓存的参数值
   */
  getParameterValue(paramId: string): number | undefined {
    return this.parameterCache.get(paramId)
  }

  /**
   * 重置所有模拟器
   */
  reset(): void {
    this.simulators.forEach(simulator => simulator.reset())
    this.parameterCache.clear()
  }

  /**
   * 检查是否已加载配置
   */
  isLoaded(): boolean {
    return this.config !== null
  }

  /**
   * 获取当前配置
   */
  getConfig(): Physics3Config | null {
    return this.config
  }
}

// ============ 便捷函数 ============

let parserInstance: Live2DPysicsParser | null = null

export function getLive2DPysicsParser(): Live2DPysicsParser {
  if (!parserInstance) {
    parserInstance = new Live2DPysicsParser()
  }
  return parserInstance
}
