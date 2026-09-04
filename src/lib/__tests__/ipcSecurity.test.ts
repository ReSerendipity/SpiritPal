// ipcSecurity 单元测试 — IPC 消息校验、Token 认证与安全管理器
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  IpcSecurityManager,
  validateIpcMessage,
  MAX_MESSAGE_SIZE,
  type IpcEnvelope,
} from '@/lib/system/ipcSecurity'

function makeEnvelope(overrides: Partial<IpcEnvelope> = {}): IpcEnvelope {
  return {
    id: 'msg-1',
    token: 'test-token',
    type: 'request',
    payload: { action: 'get_state' },
    timestamp: Date.now(),
    ...overrides,
  }
}

describe('validateIpcMessage（消息校验）', () => {
  it('合法消息应通过', () => {
    const result = validateIpcMessage(makeEnvelope())
    expect(result.valid).toBe(true)
  })

  it('缺失 id / token / type 应拒绝', () => {
    expect(validateIpcMessage(makeEnvelope({ id: '' })).valid).toBe(false)
    expect(validateIpcMessage(makeEnvelope({ token: '' })).valid).toBe(false)
    expect(validateIpcMessage(makeEnvelope({ type: '' })).valid).toBe(false)
    expect(validateIpcMessage(makeEnvelope({ id: undefined as unknown as string })).valid).toBe(false)
  })

  it('超过最大消息大小应拒绝', () => {
    const big = makeEnvelope({ payload: { data: 'x'.repeat(MAX_MESSAGE_SIZE) } })
    const result = validateIpcMessage(big)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/大小超限/)
  })

  it('时间戳超出 30 秒窗口应拒绝', () => {
    const stale = makeEnvelope({ timestamp: Date.now() - 60_000 })
    const result = validateIpcMessage(stale)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/时间戳/)
  })

  it('可指定更小 maxSize 生效', () => {
    const result = validateIpcMessage(makeEnvelope(), { maxSize: 10 })
    expect(result.valid).toBe(false)
  })
})

describe('IpcSecurityManager（安全管理器）', () => {
  let manager: IpcSecurityManager
  beforeEach(() => {
    manager = new IpcSecurityManager()
  })

  it('正确 Token 的消息被接受', () => {
    const envelope = makeEnvelope({ token: manager.getCurrentToken() })
    const result = manager.processMessage(envelope, 'conn-1')
    expect(result.accepted).toBe(true)
  })

  it('错误 Token 被拒绝并触发 auth-failed 事件', () => {
    const onAuthFailed = vi.fn()
    manager.on('auth-failed', onAuthFailed)
    const result = manager.processMessage(makeEnvelope({ token: 'wrong-token' }), 'conn-1')
    expect(result.accepted).toBe(false)
    expect(result.error).toBeTruthy()
    expect(onAuthFailed).toHaveBeenCalledOnce()
  })

  it('无效消息被拒绝并触发 validation-failed 事件', () => {
    const onValidationFailed = vi.fn()
    manager.on('validation-failed', onValidationFailed)
    const envelope = makeEnvelope({
      token: manager.getCurrentToken(),
      id: '', // 缺 id 触发校验失败
    })
    const result = manager.processMessage(envelope, 'conn-1')
    expect(result.accepted).toBe(false)
    expect(onValidationFailed).toHaveBeenCalledOnce()
  })

  it('Token 指纹为固定长度摘要', () => {
    expect(manager.getTokenFingerprint().length).toBe(8)
  })

  it('连续超频请求应被速率限制拒绝', () => {
    const envelope = makeEnvelope({ token: manager.getCurrentToken() })
    // 默认 10 次/秒：前 10 次应通过，第 11 次被限流
    let acceptedCount = 0
    for (let i = 0; i < 11; i++) {
      const r = manager.processMessage(envelope, 'conn-2')
      if (r.accepted) acceptedCount++
    }
    expect(acceptedCount).toBeLessThanOrEqual(10)
  })
})