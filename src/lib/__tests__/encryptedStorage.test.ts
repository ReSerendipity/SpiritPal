/**
 * @file encryptedStorage.test.ts
 * @description encryptedStorage 加密存储适配器单元测试
 *
 * 测试场景：
 * 1. Tauri 不可用时（测试环境）降级为明文 localStorage
 * 2. Tauri 可用时加密写入 → 解密读取往返
 * 3. 旧版明文数据兼容读取
 * 4. 解密失败时返回 null（安全降级）
 * 5. removeItem 正常删除
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用 vi.hoisted 避免 mock 提升 TDZ 问题（Gotcha 26）
const mockTauri = vi.hoisted(() => ({
  isTauri: false,
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => mockTauri.isTauri,
  invoke: mockTauri.invoke,
}))

import { encryptedStorage, _resetTauriCache, _setTauriAvailable } from '../encryptedStorage'

describe('encryptedStorage', () => {
  beforeEach(() => {
    localStorage.clear()
    _resetTauriCache()
    mockTauri.isTauri = false
    mockTauri.invoke.mockReset()
  })

  describe('Tauri 不可用（降级模式）', () => {
    it('setItem/getItem 降级为明文 localStorage', async () => {
      _setTauriAvailable(false)

      await encryptedStorage.setItem('test-key', '{"language":"zh"}')
      const result = await encryptedStorage.getItem('test-key')

      expect(result).toBe('{"language":"zh"}')
      // localStorage 存储的是明文（无 ENC2: 前缀）
      expect(localStorage.getItem('test-key')).toBe('{"language":"zh"}')
    })

    it('removeItem 正常删除', async () => {
      _setTauriAvailable(false)
      localStorage.setItem('test-key', 'some-data')

      await encryptedStorage.removeItem('test-key')

      expect(localStorage.getItem('test-key')).toBeNull()
    })
  })

  describe('Tauri 可用（加密模式）', () => {
    beforeEach(() => {
      _setTauriAvailable(true)
      // mock encrypt_data 返回 ENC2: 前缀密文
      mockTauri.invoke.mockImplementation(async (cmd: string, _args: Record<string, unknown>) => {
        if (cmd === 'encrypt_data') {
          return 'ENC2:base64encodedciphertext'
        }
        if (cmd === 'decrypt_data') {
          return '{"language":"zh"}'
        }
        throw new Error(`Unexpected command: ${cmd}`)
      })
    })

    it('setItem 调用 encrypt_data 加密后存储', async () => {
      await encryptedStorage.setItem('test-key', '{"language":"zh"}')

      // localStorage 中存储的是加密数据（有 ENC2: 前缀）
      const stored = localStorage.getItem('test-key')
      expect(stored).toBe('ENC2:base64encodedciphertext')
      // invoke 被调用
      expect(mockTauri.invoke).toHaveBeenCalledWith('encrypt_data', {
        data: '{"language":"zh"}',
        password: '',
      })
    })

    it('getItem 调用 decrypt_data 解密', async () => {
      // 先存入加密数据
      localStorage.setItem('test-key', 'ENC2:base64encodedciphertext')

      const result = await encryptedStorage.getItem('test-key')

      expect(result).toBe('{"language":"zh"}')
      expect(mockTauri.invoke).toHaveBeenCalledWith('decrypt_data', {
        encrypted: 'ENC2:base64encodedciphertext',
        password: '',
      })
    })

    it('加密 → 解密完整往返', async () => {
      // mock encrypt/decrypt 做真实往返：encrypt 返回 base64(original)，decrypt 还原
      mockTauri.invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === 'encrypt_data') {
          const data = args.data as string
          return `ENC2:${btoa(unescape(encodeURIComponent(data)))}`
        }
        if (cmd === 'decrypt_data') {
          const encrypted = args.encrypted as string
          const b64 = encrypted.replace('ENC2:', '')
          return decodeURIComponent(escape(atob(b64)))
        }
        throw new Error(`Unexpected command: ${cmd}`)
      })

      const original = '{"petSize":1.5,"language":"en"}'

      // 写入
      await encryptedStorage.setItem('roundtrip-key', original)

      // localStorage 中为密文（有 ENC2: 前缀）
      const stored = localStorage.getItem('roundtrip-key')
      expect(stored).not.toBe(original)
      expect(stored).toMatch(/^ENC2:/)

      // 读取
      const result = await encryptedStorage.getItem('roundtrip-key')
      expect(result).toBe(original)
    })
  })

  describe('兼容性', () => {
    it('旧版明文数据（无 ENC2: 前缀）直接返回', async () => {
      _setTauriAvailable(true)
      // 存入明文（模拟旧版数据）
      localStorage.setItem('legacy-key', '{"old":"data"}')

      const result = await encryptedStorage.getItem('legacy-key')

      // 直接返回明文，不调用 decrypt_data
      expect(result).toBe('{"old":"data"}')
      expect(mockTauri.invoke).not.toHaveBeenCalled()
    })

    it('Tauri 可用但有 ENC2: 加密数据时正常解密', async () => {
      _setTauriAvailable(true)
      mockTauri.invoke.mockResolvedValue('{"decrypted":true}')

      localStorage.setItem('enc-key', 'ENC2:someciphertext')

      const result = await encryptedStorage.getItem('enc-key')

      expect(result).toBe('{"decrypted":true}')
    })

    it('解密失败时返回 null（安全降级）', async () => {
      _setTauriAvailable(true)
      mockTauri.invoke.mockRejectedValue(new Error('Decryption failed'))

      localStorage.setItem('broken-key', 'ENC2:brokenciphertext')

      const result = await encryptedStorage.getItem('broken-key')

      expect(result).toBeNull()
    })

    it('null key 返回 null', async () => {
      const result = await encryptedStorage.getItem('nonexistent')
      expect(result).toBeNull()
    })

    it('加密失败时降级为明文', async () => {
      _setTauriAvailable(true)
      mockTauri.invoke.mockRejectedValue(new Error('Encryption failed'))

      // 不应抛出异常，而是降级为明文存储
      await encryptedStorage.setItem('fallback-key', '{"data":"test"}')

      // localStorage 中存储的是明文（降级）
      expect(localStorage.getItem('fallback-key')).toBe('{"data":"test"}')
    })
  })
})
