/**
 * healthCheck.ts 单元测试
 *
 * 验证：
 * 1. 全量健康检查返回正确结构
 * 2. 数据库检查通过/失败场景
 * 3. 加密往返检查通过/失败场景
 * 4. MCP 桥检查 warn 场景
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock getDb
vi.mock('../db', () => ({
  getDb: vi.fn(),
}))

// Mock tauriInvoker
vi.mock('../tauriInvoker', () => ({
  tauriInvokeNoRetry: vi.fn(),
}))

// Mock constants
vi.mock('../constants', () => ({
  IPC_DEFAULT_TIMEOUT_MS: 30000,
}))

// Mock @tauri-apps/api/core (被 tauriInvoker 内部使用)
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

// Mock @tauri-apps/api/event (被 db.ts 导入)
vi.mock('@tauri-apps/api/event', () => ({
  emit: vi.fn(() => Promise.resolve()),
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

// Mock @tauri-apps/plugin-sql (被 db.ts 导入)
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn(() => Promise.resolve({ execute: vi.fn(), select: vi.fn(), close: vi.fn() })),
  },
}))

import { getDb } from '../db'
import { tauriInvokeNoRetry } from '../tauriInvoker'
import { runHealthCheck } from '../healthCheck'

const mockGetDb = vi.mocked(getDb)
const mockInvoke = vi.mocked(tauriInvokeNoRetry)

describe('healthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('全量检查返回正确结构', async () => {
    // 数据库通过
    mockGetDb.mockResolvedValueOnce({
      select: vi.fn().mockResolvedValue([{ '1': 1 }]),
    } as any)
    // 加密往返通过
    mockInvoke
      .mockResolvedValueOnce('encrypted-data') // encrypt
      .mockResolvedValueOnce('health-check-test') // decrypt
    // MCP 通过
    mockInvoke.mockResolvedValueOnce(false)

    const result = await runHealthCheck()

    expect(result.status).toBe('healthy')
    expect(result.timestamp).toBeTruthy()
    expect(result.checks).toHaveLength(3)
    expect(result.checks.map((c) => c.name)).toEqual([
      'database',
      'encryption',
      'mcp-bridge',
    ])
  })

  it('数据库检查失败应返回 unhealthy', async () => {
    mockGetDb.mockRejectedValueOnce(new Error('DB connection refused'))
    // 加密和 MCP 不会被调用因为数据库失败了... 但实际上每个检查独立运行
    // 所以加密和 MCP 仍会执行

    const result = await runHealthCheck()

    expect(result.status).toBe('unhealthy')
    const dbCheck = result.checks.find((c) => c.name === 'database')
    expect(dbCheck?.status).toBe('fail')
    expect(dbCheck?.message).toContain('DB connection refused')
  })

  it('加密往返不一致应返回 unhealthy', async () => {
    // 数据库通过
    mockGetDb.mockResolvedValueOnce({
      select: vi.fn().mockResolvedValue([{ '1': 1 }]),
    } as any)
    // 加密返回不匹配
    mockInvoke
      .mockResolvedValueOnce('encrypted-data') // encrypt
      .mockResolvedValueOnce('wrong-data') // decrypt
    // MCP 通过
    mockInvoke.mockResolvedValueOnce(false)

    const result = await runHealthCheck()

    expect(result.status).toBe('unhealthy')
    const encCheck = result.checks.find((c) => c.name === 'encryption')
    expect(encCheck?.status).toBe('fail')
    expect(encCheck?.message).toContain('mismatch')
  })

  it('MCP 桥失败应返回 degraded 而非 unhealthy', async () => {
    // 数据库通过
    mockGetDb.mockResolvedValueOnce({
      select: vi.fn().mockResolvedValue([{ '1': 1 }]),
    } as any)
    // 加密通过
    mockInvoke
      .mockResolvedValueOnce('encrypted-data')
      .mockResolvedValueOnce('health-check-test')
    // MCP 失败
    mockInvoke.mockRejectedValueOnce(new Error('MCP timeout'))

    const result = await runHealthCheck()

    expect(result.status).toBe('degraded')
    const mcpCheck = result.checks.find((c) => c.name === 'mcp-bridge')
    expect(mcpCheck?.status).toBe('warn')
  })
})
