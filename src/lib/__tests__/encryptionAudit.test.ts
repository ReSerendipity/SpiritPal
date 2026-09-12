/**
 * @file encryptionAudit.test.ts
 * @description 加密路径审计工具 + 安全值助手单测
 *
 * 契约：
 *  1. classifyStoredValue：识别 ENC1/2/3 前缀与 Web Crypto 载荷，其余为明文
 *  2. runEncryptionAudit：扫描 storage，统计加密/明文，标记「应加密却明文」的风险项
 *  3. encryptSensitiveValue / decryptSensitiveValue：经 blobCrypto 加解密，明文直通
 */

import { invoke } from '@tauri-apps/api/core'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  classifyStoredValue,
  runEncryptionAudit,
  encryptSensitiveValue,
  decryptSensitiveValue,
  KNOWN_DATA_PATHS,
} from '@/lib/data/encryptionAudit'

const mockInvoke = vi.mocked(invoke)

/** 最小内存 Storage 实现 */
function makeMemoryStorage(init: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(init))
  return {
    get length() { return map.size },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  } as Storage
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockResolvedValue('')
})

describe('classifyStoredValue', () => {
  it('null / 空串 → empty', () => {
    expect(classifyStoredValue(null)).toBe('empty')
    expect(classifyStoredValue('')).toBe('empty')
  })

  it('ENC1/2/3 前缀 → tauri-encrypted', () => {
    expect(classifyStoredValue('ENC2:abc')).toBe('tauri-encrypted')
    expect(classifyStoredValue('ENC3:abc')).toBe('tauri-encrypted')
    expect(classifyStoredValue('ENC1:abc')).toBe('tauri-encrypted')
  })

  it('Web Crypto 载荷 JSON → webcrypto-encrypted', () => {
    const payload = JSON.stringify({ v: 1, alg: 'aes-256-gcm', salt: 'x', iv: 'y', data: 'z' })
    expect(classifyStoredValue(payload)).toBe('webcrypto-encrypted')
  })

  it('普通 JSON → plaintext', () => {
    expect(classifyStoredValue('{"a":1}')).toBe('plaintext')
    expect(classifyStoredValue('hello')).toBe('plaintext')
  })
})

describe('runEncryptionAudit', () => {
  it('统计加密/明文并标记风险项', () => {
    const storage = makeMemoryStorage({
      'spiritpal-settings-store': 'ENC2:encrypted-settings',
      'spiritpal-enhanced-memory-doro': '{"memories":[...]}', // 应加密却明文 → 风险
      'spiritpal-tasks': '{"tasks":[]}', // 低敏明文，非风险
      'unknown-key': 'whatever',
    })
    const report = runEncryptionAudit(storage)

    expect(report.totalKeys).toBe(4)
    expect(report.encryptedCount).toBe(1)
    expect(report.plaintextCount).toBe(3)

    // enhanced-memory 登记为应加密却明文 → 风险
    const risky = report.findings.find((f) => f.key === 'spiritpal-enhanced-memory-doro')
    expect(risky?.risky).toBe(true)
    expect(risky?.sensitivity).toBe('high')

    // tasks 虽明文但低敏、不要求加密 → 非风险
    expect(report.findings.some((f) => f.key === 'spiritpal-tasks')).toBe(false)
  })

  it('空 storage 返回空报告不抛错', () => {
    expect(runEncryptionAudit(makeMemoryStorage({}))).toEqual(
      expect.objectContaining({ totalKeys: 0, findings: [] }),
    )
  })

  it('注册表覆盖全部声明的域', () => {
    expect(KNOWN_DATA_PATHS.length).toBeGreaterThan(0)
    for (const rec of KNOWN_DATA_PATHS) {
      expect(rec.keyPrefix.length).toBeGreaterThan(0)
    }
  })
})

describe('encryptSensitiveValue / decryptSensitiveValue', () => {
  it('加密空串直通', async () => {
    expect(await encryptSensitiveValue('')).toBe('')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('加密经 blobCrypto 走 encrypt_data', async () => {
    mockInvoke.mockResolvedValue('ENC2:cipher')
    const out = await encryptSensitiveValue('secret')
    expect(mockInvoke).toHaveBeenCalledWith('encrypt_data', { data: 'secret', password: '' })
    expect(out).toBe('ENC2:cipher')
  })

  it('解密明文直通（无 ENC 前缀）', async () => {
    expect(await decryptSensitiveValue('legacy-plain')).toBe('legacy-plain')
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('解密 ENC 前缀走 decryptBlob', async () => {
    mockInvoke.mockResolvedValue('plain')
    const out = await decryptSensitiveValue('ENC2:cipher')
    expect(mockInvoke).toHaveBeenCalledWith('decrypt_data', { encrypted: 'ENC2:cipher', password: '' })
    expect(out).toBe('plain')
  })

  it('加密失败时降级明文不抛错', async () => {
    mockInvoke.mockRejectedValue(new Error('boom'))
    const out = await encryptSensitiveValue('secret')
    expect(out).toBe('secret')
  })
})
