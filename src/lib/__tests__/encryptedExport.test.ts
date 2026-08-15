// 加密导出/导入单元测试 — AES-256-GCM 加密 + PBKDF2 密钥派生
// P1-9: 记忆导出/导入增强为加密导出
import { describe, it, expect } from 'vitest'
import {
  encryptExportData,
  decryptImportData,
  isEncryptedFormat,
  parseEncryptedPayload,
  type EncryptedPayload,
} from '../encryptedExport'

describe('encryptedExport', () => {
  const testData = JSON.stringify({
    workingMemory: [{ id: '1', user: '你好', assistant: '嗨～' }],
    episodicMemory: [],
    semanticMemory: '',
    autobiographicalMemory: [],
  })
  const testPassword = 'MySecurePassword123!'

  describe('encryptExportData', () => {
    it('加密后返回正确的 payload 格式', async () => {
      const result = await encryptExportData(testData, testPassword)
      expect(result.v).toBe(1)
      expect(result.alg).toBe('aes-256-gcm')
      expect(result.iterations).toBe(100000)
      expect(result.salt).toBeTruthy()
      expect(result.iv).toBeTruthy()
      expect(result.data).toBeTruthy()
    })

    it('每次加密生成不同的盐和 IV', async () => {
      const result1 = await encryptExportData(testData, testPassword)
      const result2 = await encryptExportData(testData, testPassword)
      // 由于随机盐和 IV，每次加密结果不同
      expect(result1.salt).not.toBe(result2.salt)
      expect(result1.iv).not.toBe(result2.iv)
      expect(result1.data).not.toBe(result2.data)
    })
  })

  describe('decryptImportData', () => {
    it('解密后还原原始数据', async () => {
      const encrypted = await encryptExportData(testData, testPassword)
      const decrypted = await decryptImportData(encrypted, testPassword)
      expect(decrypted).toBe(testData)
    })

    it('错误密码解密失败', async () => {
      const encrypted = await encryptExportData(testData, testPassword)
      await expect(decryptImportData(encrypted, 'WrongPassword')).rejects.toThrow()
    })

    it('篡改密文解密失败', async () => {
      const encrypted = await encryptExportData(testData, testPassword)
      // 篡改 data 字段
      const tampered: EncryptedPayload = { ...encrypted, data: encrypted.data.slice(0, -4) + 'XXXX' }
      await expect(decryptImportData(tampered, testPassword)).rejects.toThrow()
    })

    it('篡改 IV 解密失败', async () => {
      const encrypted = await encryptExportData(testData, testPassword)
      const tampered: EncryptedPayload = { ...encrypted, iv: btoa('tamperediv!') }
      await expect(decryptImportData(tampered, testPassword)).rejects.toThrow()
    })
  })

  describe('isEncryptedFormat', () => {
    it('加密格式返回 true', async () => {
      const encrypted = await encryptExportData(testData, testPassword)
      const content = JSON.stringify(encrypted)
      expect(isEncryptedFormat(content)).toBe(true)
    })

    it('明文 JSON 返回 false', () => {
      expect(isEncryptedFormat('{"key": "value"}')).toBe(false)
    })

    it('非 JSON 返回 false', () => {
      expect(isEncryptedFormat('not json')).toBe(false)
    })

    it('空字符串返回 false', () => {
      expect(isEncryptedFormat('')).toBe(false)
    })
  })

  describe('parseEncryptedPayload', () => {
    it('有效 payload 返回解析结果', async () => {
      const encrypted = await encryptExportData(testData, testPassword)
      const content = JSON.stringify(encrypted)
      const parsed = parseEncryptedPayload(content)
      expect(parsed).toBeTruthy()
      expect(parsed!.v).toBe(1)
      expect(parsed!.alg).toBe('aes-256-gcm')
      expect(parsed!.data).toBe(encrypted.data)
    })

    it('无效格式返回 null', () => {
      expect(parseEncryptedPayload('{"key": "value"}')).toBeNull()
      expect(parseEncryptedPayload('not json')).toBeNull()
    })
  })

  describe('端到端：加密 → 解密 → JSON 解析', () => {
    it('完整流程正确', async () => {
      const original = JSON.parse(testData)
      const encrypted = await encryptExportData(testData, testPassword)
      const content = JSON.stringify(encrypted)
      const parsed = parseEncryptedPayload(content)
      expect(parsed).toBeTruthy()
      const decrypted = await decryptImportData(parsed!, testPassword)
      const restored = JSON.parse(decrypted)
      expect(restored.workingMemory).toEqual(original.workingMemory)
      expect(restored.semanticMemory).toBe(original.semanticMemory)
    })
  })
})
