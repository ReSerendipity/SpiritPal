// secureStorage 模块测试 — Keychain 封装的 invoke 调用验证
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import {
  setSecret,
  getSecret,
  deleteSecret,
  setApiKey,
  getApiKey,
  deleteApiKey,
} from '../secureStorage'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

describe('secureStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ============ 底层 Keychain 封装 ============

  describe('setSecret', () => {
    it('调用 set_secret 命令并传递 key/value', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined)
      await setSecret('my-key', 'my-value')
      expect(invoke).toHaveBeenCalledWith('set_secret', { key: 'my-key', value: 'my-value' })
    })

    it('invoke 返回错误时抛出', async () => {
      vi.mocked(invoke).mockRejectedValue(new Error('Keychain 不可用'))
      await expect(setSecret('k', 'v')).rejects.toThrow('Keychain 不可用')
    })
  })

  describe('getSecret', () => {
    it('调用 get_secret 命令并返回值', async () => {
      vi.mocked(invoke).mockResolvedValue('secret-value')
      const result = await getSecret('my-key')
      expect(result).toBe('secret-value')
      expect(invoke).toHaveBeenCalledWith('get_secret', { key: 'my-key' })
    })

    it('不存在时返回 null', async () => {
      vi.mocked(invoke).mockResolvedValue(null)
      const result = await getSecret('missing-key')
      expect(result).toBeNull()
    })
  })

  describe('deleteSecret', () => {
    it('调用 delete_secret 命令', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined)
      await deleteSecret('my-key')
      expect(invoke).toHaveBeenCalledWith('delete_secret', { key: 'my-key' })
    })
  })

  // ============ API Key 专用封装 ============

  describe('setApiKey', () => {
    it('使用 api-key- 前缀存储', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined)
      await setApiKey('openai', 'sk-xxxx')
      expect(invoke).toHaveBeenCalledWith('set_secret', {
        key: 'api-key-openai',
        value: 'sk-xxxx',
      })
    })

    it('支持不同 providerId', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined)
      await setApiKey('anthropic', 'sk-ant-yyyy')
      expect(invoke).toHaveBeenCalledWith('set_secret', {
        key: 'api-key-anthropic',
        value: 'sk-ant-yyyy',
      })
    })
  })

  describe('getApiKey', () => {
    it('使用 api-key- 前缀读取', async () => {
      vi.mocked(invoke).mockResolvedValue('sk-xxxx')
      const result = await getApiKey('openai')
      expect(result).toBe('sk-xxxx')
      expect(invoke).toHaveBeenCalledWith('get_secret', { key: 'api-key-openai' })
    })

    it('不存在时返回 null', async () => {
      vi.mocked(invoke).mockResolvedValue(null)
      const result = await getApiKey('missing')
      expect(result).toBeNull()
    })
  })

  describe('deleteApiKey', () => {
    it('使用 api-key- 前缀删除', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined)
      await deleteApiKey('openai')
      expect(invoke).toHaveBeenCalledWith('delete_secret', { key: 'api-key-openai' })
    })
  })

  // ============ 完整流程 ============

  describe('完整存取流程', () => {
    it('set → get → delete 流程', async () => {
      vi.mocked(invoke).mockResolvedValue(undefined)
      await setApiKey('gemini', 'AIza-test')
      expect(invoke).toHaveBeenLastCalledWith('set_secret', {
        key: 'api-key-gemini',
        value: 'AIza-test',
      })

      vi.mocked(invoke).mockResolvedValue('AIza-test')
      const val = await getApiKey('gemini')
      expect(val).toBe('AIza-test')

      vi.mocked(invoke).mockResolvedValue(undefined)
      await deleteApiKey('gemini')
      expect(invoke).toHaveBeenLastCalledWith('delete_secret', { key: 'api-key-gemini' })
    })
  })
})
