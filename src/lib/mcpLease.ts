/**
 * MCP 短期租约管理模块
 *
 * @fileoverview 实现MCP代理短期租约机制，支持心跳续期、过期清理与状态隔离
 *
 * 主要模块：
 * - LeaseState/Lease: 租约状态与数据结构
 * - LeaseEvents: 租约事件接口
 * - LeaseManager: 租约管理器主类
 *
 * 依赖关系：
 * - events: EventEmitter 事件机制
 *
 * 核心接口：
 * - createLease(): 创建新租约
 * - heartbeat(): 心跳续期
 * - revokeLease(): 撤销租约
 * - getLease(): 获取租约信息
 *
 * 功能特性：
 * - 短期租约：默认15秒TTL
 * - 心跳续期：每5秒心跳，活跃时自动续期
 * - 过期清理：定期扫描并清理过期租约
 * - 多代理并发：支持多个并发代理，状态隔离
 * - 窗口自动关闭：租约过期时自动关闭关联窗口
 *
 * 参考：OpenPets packages/mcp/
 */

import { EventEmitter } from 'events'

// ============ 配置常量 ============

/** 默认租约 TTL（毫秒） */
const DEFAULT_LEASE_TTL_MS = 15_000

/** 租约过期清理间隔（毫秒） */
const CLEANUP_INTERVAL_MS = 5_000

// ============ 类型定义 ============

/** 租约状态 */
export type LeaseState = 'active' | 'expired' | 'revoked'

/** 租约信息 */
export interface Lease {
  /** 租约 ID */
  id: string
  /** 客户端标识 */
  clientId: string
  /** 创建时间 */
  createdAt: number
  /** 过期时间 */
  expiresAt: number
  /** 最后心跳时间 */
  lastHeartbeat: number
  /** 租约状态 */
  state: LeaseState
  /** 客户端元数据 */
  metadata?: Record<string, unknown>
  /** Chapter 7 新增：隔离的代理状态 */
  isolatedState: Record<string, unknown>
  /** Chapter 7 新增：关联的窗口标签（过期时自动关闭） */
  windowLabel?: string
  /** Chapter 7 新增：心跳计数 */
  heartbeatCount: number
}

/** 租约事件 */
export interface LeaseEvents {
  /** 租约创建 */
  'lease:created': (lease: Lease) => void
  /** 租约续期 */
  'lease:renewed': (lease: Lease) => void
  /** 租约过期 */
  'lease:expired': (lease: Lease) => void
  /** 租约撤销 */
  'lease:revoked': (lease: Lease) => void
  /** 所有租约过期（无活跃客户端） */
  'lease:all-expired': () => void
  /** Chapter 7 新增：租约过期触发窗口关闭 */
  'lease:window-close': (windowLabel: string, leaseId: string) => void
  /** Chapter 7 新增：隔离状态更新 */
  'lease:state-updated': (leaseId: string, state: Record<string, unknown>) => void
}

// ============ Lease Manager ============

export class LeaseManager extends EventEmitter {
  private leases = new Map<string, Lease>()
  private ttlMs: number
  private cleanupTimer: ReturnType<typeof setInterval> | null = null
  private nextId = 1

  constructor(ttlMs: number = DEFAULT_LEASE_TTL_MS) {
    super()
    this.ttlMs = ttlMs
  }

  // ============ 生命周期 ============

  /** 启动清理定时器 */
  start(): void {
    if (this.cleanupTimer) return
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS)
  }

  /** 停止清理定时器 */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  /** 销毁管理器 */
  destroy(): void {
    this.stop()
    this.revokeAll()
    this.removeAllListeners()
  }

  // ============ 租约操作 ============

  /**
   * 创建新租约
   * @param clientId 客户端标识
   * @param metadata 可选的客户端元数据
   * @param windowLabel 关联的窗口标签（过期时自动关闭）
   * @returns 新创建的租约
   */
  create(clientId: string, metadata?: Record<string, unknown>, windowLabel?: string): Lease {
    const now = Date.now()
    const lease: Lease = {
      id: `lease-${this.nextId++}`,
      clientId,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      lastHeartbeat: now,
      state: 'active',
      metadata,
      isolatedState: {},
      windowLabel,
      heartbeatCount: 0,
    }

    this.leases.set(lease.id, lease)
    this.emit('lease:created', lease)
    return lease
  }

  /**
   * 续期租约（心跳）
   * @param leaseId 租约 ID
   * @returns 续期后的租约，或 null（租约不存在或已过期）
   */
  renew(leaseId: string): Lease | null {
    const lease = this.leases.get(leaseId)
    if (!lease || lease.state !== 'active') return null

    const now = Date.now()
    lease.lastHeartbeat = now
    lease.expiresAt = now + this.ttlMs
    lease.heartbeatCount++

    this.emit('lease:renewed', lease)
    return lease
  }

  /**
   * 验证租约是否有效
   * @param leaseId 租约 ID
   * @returns 租约是否有效
   */
  isValid(leaseId: string): boolean {
    const lease = this.leases.get(leaseId)
    if (!lease) return false
    if (lease.state !== 'active') return false
    if (Date.now() > lease.expiresAt) {
      this.expireLease(lease)
      return false
    }
    return true
  }

  /**
   * 撤销租约（主动断开）
   * @param leaseId 租约 ID
   */
  revoke(leaseId: string): void {
    const lease = this.leases.get(leaseId)
    if (!lease) return

    lease.state = 'revoked'
    this.emit('lease:revoked', lease)
    this.leases.delete(leaseId)
    this.checkAllExpired()
  }

  /**
   * 撤销指定客户端的所有租约
   * @param clientId 客户端标识
   */
  revokeByClient(clientId: string): void {
    for (const [id, lease] of this.leases) {
      if (lease.clientId === clientId && lease.state === 'active') {
        lease.state = 'revoked'
        this.emit('lease:revoked', lease)
        this.closeWindowIfNeeded(lease)
        this.leases.delete(id)
      }
    }
    this.checkAllExpired()
  }

  // ============ Chapter 7 新增：隔离状态管理 ============

  /**
   * 更新租约的隔离状态
   * 每个代理的隔离状态互不影响
   * @param leaseId 租约 ID
   * @param stateUpdate 要合并的状态更新
   */
  updateIsolatedState(leaseId: string, stateUpdate: Record<string, unknown>): Lease | null {
    const lease = this.leases.get(leaseId)
    if (!lease || lease.state !== 'active') return null

    lease.isolatedState = { ...lease.isolatedState, ...stateUpdate }
    this.emit('lease:state-updated', leaseId, lease.isolatedState)

    // 活跃时自动续期
    this.renew(leaseId)
    return lease
  }

  /**
   * 获取租约的隔离状态
   * @param leaseId 租约 ID
   */
  getIsolatedState(leaseId: string): Record<string, unknown> | null {
    const lease = this.leases.get(leaseId)
    if (!lease) return null
    return { ...lease.isolatedState }
  }

  /**
   * 获取指定客户端的所有活跃租约
   * @param clientId 客户端标识
   */
  getLeasesByClient(clientId: string): Lease[] {
    return Array.from(this.leases.values()).filter(
      (l) => l.clientId === clientId && l.state === 'active',
    )
  }

  // ============ Chapter 7 新增：窗口自动关闭 ============

  /**
   * 租约过期时触发窗口关闭事件
   * 外部监听者负责实际的窗口关闭操作
   */
  private closeWindowIfNeeded(lease: Lease): void {
    if (lease.windowLabel) {
      this.emit('lease:window-close', lease.windowLabel, lease.id)
    }
  }

  /** 撤销所有租约 */
  revokeAll(): void {
    for (const [, lease] of this.leases) {
      lease.state = 'revoked'
      this.emit('lease:revoked', lease)
    }
    this.leases.clear()
    this.emit('lease:all-expired')
  }

  // ============ 查询 ============

  /** 获取所有活跃租约 */
  getActiveLeases(): Lease[] {
    return Array.from(this.leases.values()).filter(l => l.state === 'active')
  }

  /** 获取指定租约 */
  getLease(leaseId: string): Lease | undefined {
    return this.leases.get(leaseId)
  }

  /** 获取活跃租约数量 */
  get activeCount(): number {
    return this.getActiveLeases().length
  }

  /** 检查是否有活跃客户端 */
  hasActiveClients(): boolean {
    return this.activeCount > 0
  }

  // ============ 内部方法 ============

  /** 过期处理 */
  private expireLease(lease: Lease): void {
    lease.state = 'expired'
    this.emit('lease:expired', lease)
    this.closeWindowIfNeeded(lease)
    this.leases.delete(lease.id)
    this.checkAllExpired()
  }

  /** 清理过期租约 */
  private cleanup(): void {
    const now = Date.now()
    for (const [, lease] of this.leases) {
      if (lease.state === 'active' && now > lease.expiresAt) {
        this.expireLease(lease)
      }
    }
  }

  /** 检查是否所有租约都已过期 */
  private checkAllExpired(): void {
    if (this.activeCount === 0) {
      this.emit('lease:all-expired')
    }
  }
}

// ============ 单例 ============

let instance: LeaseManager | null = null

export function getLeaseManager(ttlMs?: number): LeaseManager {
  if (!instance) {
    instance = new LeaseManager(ttlMs)
  }
  return instance
}

export function resetLeaseManager(): void {
  if (instance) {
    instance.destroy()
    instance = null
  }
}
