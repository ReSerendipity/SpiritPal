/**
 * @file auditLogger.test.ts
 * @description 安全审计日志前端封装单测（H-4）
 *
 * 测什么：
 * - isTauri()=false 时静默返回，不调用 invoke
 * - isTauri()=true 时调用 invoke('audit_log', { eventType, actor, message })（actor 默认 'user'）
 * - invoke 抛错时 catch 后 console.warn，不向外抛出
 * - AuditEventType 全部 9 个常量断言
 *
 * 注意：src/test/setup.ts 对 @tauri-apps/api/core 的 mock 只有 invoke/convertFileSrc，
 * 没有 isTauri，因此本文件重新 mock 该模块补充 isTauri。
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ============ Mock @tauri-apps/api/core（补充 isTauri）============
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: vi.fn((p: string) => p),
  isTauri: mocks.isTauri,
}))

import { auditLog, AuditEventType } from '@/lib/system/auditLogger'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.invoke.mockResolvedValue(undefined)
  mocks.isTauri.mockReturnValue(false)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('auditLog', () => {
  it('isTauri()=false 时静默返回，不调用 invoke', async () => {
    mocks.isTauri.mockReturnValue(false)

    await expect(auditLog('settings_change', '修改语言')).resolves.toBeUndefined()

    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('isTauri()=true 时调用 invoke audit_log（默认 actor=user）', async () => {
    mocks.isTauri.mockReturnValue(true)

    await auditLog('settings_change', '用户修改了语言设置为 en')

    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.invoke).toHaveBeenCalledWith('audit_log', {
      eventType: 'settings_change',
      actor: 'user',
      message: '用户修改了语言设置为 en',
    })
  })

  it('可自定义 actor', async () => {
    mocks.isTauri.mockReturnValue(true)

    await auditLog('mod_import', '导入了模组 cool-pet.petmod', 'system')

    expect(mocks.invoke).toHaveBeenCalledWith('audit_log', {
      eventType: 'mod_import',
      actor: 'system',
      message: '导入了模组 cool-pet.petmod',
    })
  })

  it('invoke 抛错时 catch 后 console.warn，不向外抛出', async () => {
    mocks.isTauri.mockReturnValue(true)
    mocks.invoke.mockRejectedValue(new Error('audit write failed'))

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(auditLog('security_event', '检测到异常')).resolves.toBeUndefined()

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to write audit log'),
      expect.any(Error),
    )
    warnSpy.mockRestore()
  })
})

describe('AuditEventType 常量', () => {
  it('包含全部 9 种审计事件类型', () => {
    expect(AuditEventType.SETTINGS_CHANGE).toBe('settings_change')
    expect(AuditEventType.MOD_IMPORT).toBe('mod_import')
    expect(AuditEventType.CHARACTER_IMPORT).toBe('character_import')
    expect(AuditEventType.ENCRYPTION).toBe('encryption')
    expect(AuditEventType.DATA_EXPORT).toBe('data_export')
    expect(AuditEventType.DATA_IMPORT).toBe('data_import')
    expect(AuditEventType.PERMISSION_CHANGE).toBe('permission_change')
    expect(AuditEventType.LLM_PROVIDER_CHANGE).toBe('llm_provider_change')
    expect(AuditEventType.SECURITY_EVENT).toBe('security_event')
  })

  it('值不可变（as const）', () => {
    expect(Object.keys(AuditEventType)).toHaveLength(9)
    expect(Object.values(AuditEventType).every((v) => typeof v === 'string')).toBe(true)
  })
})
