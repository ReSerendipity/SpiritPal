// webdavClient 单元测试 — WebDAV 客户端核心逻辑
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  WebDAVClient,
  getWebDAVClient,
  resetWebDAVClient,
  type WebDAVConfig,
} from '../webdavClient'

// Mock secureStorage
vi.mock('../secureStorage', () => ({
  setSecret: vi.fn().mockResolvedValue(undefined),
  getSecret: vi.fn().mockResolvedValue('test-password'),
  deleteSecret: vi.fn().mockResolvedValue(undefined),
}))

// Mock ssrfProtection safeFetch
vi.mock('../ssrfProtection', () => ({
  safeFetch: vi.fn(),
}))

import { safeFetch } from '../ssrfProtection'
import { setSecret, getSecret, deleteSecret } from '../secureStorage'

describe('WebDAVClient', () => {
  let client: WebDAVClient

  const testConfig: WebDAVConfig = {
    serverUrl: 'https://dav.example.com/dav/',
    username: 'testuser',
    autoSync: true,
    autoSyncInterval: 300000,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    resetWebDAVClient()
    client = new WebDAVClient()
  })

  describe('configure', () => {
    it('设置配置后 getConfig 返回配置副本', async () => {
      await client.configure(testConfig)
      const config = client.getConfig()
      expect(config).toEqual(testConfig)
      // 应该是副本而非引用
      expect(config).not.toBe(testConfig)
    })

    it('未配置时 getConfig 返回 null', () => {
      expect(client.getConfig()).toBeNull()
    })
  })

  describe('密码管理', () => {
    it('setPassword 调用 secureStorage 存储密码', async () => {
      await client.setPassword('mypassword')
      expect(setSecret).toHaveBeenCalledWith('webdav-password', 'mypassword')
    })

    it('loadPassword 从 secureStorage 读取密码', async () => {
      vi.mocked(getSecret).mockResolvedValue('stored-password')
      const pwd = await client.loadPassword()
      expect(pwd).toBe('stored-password')
      expect(getSecret).toHaveBeenCalledWith('webdav-password')
    })

    it('loadPassword 缓存密码避免重复读取', async () => {
      vi.mocked(getSecret).mockResolvedValue('cached-pwd')
      await client.loadPassword()
      await client.loadPassword()
      // 第二次应使用缓存，不调用 getSecret
      expect(getSecret).toHaveBeenCalledTimes(1)
    })

    it('clearPassword 清除缓存和 Keychain', async () => {
      await client.setPassword('temp')
      await client.clearPassword()
      expect(deleteSecret).toHaveBeenCalledWith('webdav-password')
      // 清除后应重新读取
      vi.mocked(getSecret).mockResolvedValue(null)
      const pwd = await client.loadPassword()
      expect(pwd).toBeNull()
    })
  })

  describe('testConnection', () => {
    it('未配置时返回错误', async () => {
      const result = await client.testConnection()
      expect(result.success).toBe(false)
      expect(result.error).toContain('未配置')
    })

    it('未设置密码时返回错误', async () => {
      await client.configure(testConfig)
      vi.mocked(getSecret).mockResolvedValue(null)
      const result = await client.testConnection()
      expect(result.success).toBe(false)
      expect(result.error).toContain('密码')
    })

    it('207 响应表示连接成功', async () => {
      await client.configure(testConfig)
      vi.mocked(getSecret).mockResolvedValue('test-password')
      vi.mocked(safeFetch).mockResolvedValue(new Response('', { status: 207 }))
      const result = await client.testConnection()
      expect(result.success).toBe(true)
      expect(result.serverInfo).toContain('成功')
    })

    it('401 响应表示认证失败', async () => {
      await client.configure(testConfig)
      vi.mocked(getSecret).mockResolvedValue('wrong-password')
      vi.mocked(safeFetch).mockResolvedValue(new Response('', { status: 401 }))
      const result = await client.testConnection()
      expect(result.success).toBe(false)
      expect(result.error).toContain('认证失败')
    })

    it('403 响应表示权限不足', async () => {
      await client.configure(testConfig)
      vi.mocked(getSecret).mockResolvedValue('test-password')
      vi.mocked(safeFetch).mockResolvedValue(new Response('', { status: 403 }))
      const result = await client.testConnection()
      expect(result.success).toBe(false)
      expect(result.error).toContain('权限')
    })

    it('404 响应仍视为连接成功', async () => {
      await client.configure(testConfig)
      vi.mocked(getSecret).mockResolvedValue('test-password')
      vi.mocked(safeFetch).mockResolvedValue(new Response('', { status: 404 }))
      const result = await client.testConnection()
      expect(result.success).toBe(true)
    })

    it('网络错误时返回连接失败', async () => {
      await client.configure(testConfig)
      vi.mocked(getSecret).mockResolvedValue('test-password')
      vi.mocked(safeFetch).mockRejectedValue(new Error('Network error'))
      const result = await client.testConnection()
      expect(result.success).toBe(false)
      expect(result.error).toContain('连接失败')
    })
  })

  describe('uploadSyncData', () => {
    it('未配置时抛出错误', async () => {
      await expect(
        client.uploadSyncData({ timestamp: Date.now(), deviceId: 'dev1' }),
      ).rejects.toThrow('未配置')
    })

    it('未设置密码时抛出错误', async () => {
      await client.configure(testConfig)
      vi.mocked(getSecret).mockResolvedValue(null)
      await expect(
        client.uploadSyncData({ timestamp: Date.now(), deviceId: 'dev1' }),
      ).rejects.toThrow('密码')
    })

    it('上传宠物数据时调用 PUT', async () => {
      await client.configure(testConfig)
      vi.mocked(getSecret).mockResolvedValue('test-password')
      // MKCOL + PUT 调用
      vi.mocked(safeFetch).mockResolvedValue(new Response('', { status: 201 }))

      await client.uploadSyncData({
        timestamp: Date.now(),
        deviceId: 'dev1',
        petData: { sharedCoins: 100 },
      })

      // 至少调用了 MKCOL（4次目录创建）+ PUT（pet-data + manifest）
      expect(safeFetch).toHaveBeenCalled()
      // 检查是否有 PUT 请求
      const putCalls = vi.mocked(safeFetch).mock.calls.filter(
        (call) => (call[1] as RequestInit)?.method === 'PUT',
      )
      expect(putCalls.length).toBeGreaterThan(0)
    })
  })

  describe('downloadSyncData', () => {
    it('未配置时抛出错误', async () => {
      await expect(client.downloadSyncData()).rejects.toThrow('未配置')
    })

    it('远程无数据时返回 null', async () => {
      await client.configure(testConfig)
      vi.mocked(getSecret).mockResolvedValue('test-password')
      // GET 返回 404
      vi.mocked(safeFetch).mockResolvedValue(new Response('', { status: 404 }))

      const result = await client.downloadSyncData()
      expect(result).toBeNull()
    })

    it('下载成功时返回解析后的数据', async () => {
      await client.configure(testConfig)
      vi.mocked(getSecret).mockResolvedValue('test-password')

      // 模拟 GET 响应
      const petDataResponse = {
        timestamp: Date.now(),
        deviceId: 'dev-remote',
        data: { sharedCoins: 200 },
      }

      vi.mocked(safeFetch).mockImplementation(async (_url, options) => {
        const method = (options as RequestInit)?.method
        if (method === 'GET') {
          const url = _url as string
          if (url.includes('pet-data.json')) {
            return new Response(JSON.stringify(petDataResponse), { status: 200 })
          }
          if (url.includes('settings.json')) {
            return new Response('', { status: 404 })
          }
        }
        return new Response('', { status: 201 })
      })

      const result = await client.downloadSyncData()
      expect(result).not.toBeNull()
      expect(result!.petData).toEqual({ sharedCoins: 200 })
      expect(result!.deviceId).toBe('dev-remote')
    })
  })

  describe('downloadManifest', () => {
    it('未配置时返回默认清单', async () => {
      const manifest = await client.downloadManifest()
      expect(manifest.version).toBe(1)
      expect(manifest.devices).toHaveLength(0)
    })

    it('下载成功时返回清单', async () => {
      await client.configure(testConfig)
      vi.mocked(getSecret).mockResolvedValue('test-password')

      const testManifest = {
        version: 1,
        lastSyncAt: Date.now(),
        devices: [{ deviceId: 'dev1', deviceName: 'Desktop', lastSeenAt: Date.now() }],
      }

      vi.mocked(safeFetch).mockImplementation(async (_url, options) => {
        const method = (options as RequestInit)?.method
        if (method === 'GET') {
          return new Response(JSON.stringify(testManifest), { status: 200 })
        }
        return new Response('', { status: 404 })
      })

      const manifest = await client.downloadManifest()
      expect(manifest.version).toBe(1)
      expect(manifest.devices).toHaveLength(1)
    })
  })

  describe('delete', () => {
    it('未配置时返回 false', async () => {
      const result = await client.delete('/some/path')
      expect(result).toBe(false)
    })

    it('200 响应表示删除成功', async () => {
      await client.configure(testConfig)
      vi.mocked(getSecret).mockResolvedValue('test-password')
      vi.mocked(safeFetch).mockResolvedValue(new Response('', { status: 200 }))

      const result = await client.delete('/SpiritPal/data/old-file.json')
      expect(result).toBe(true)
    })

    it('404 响应也视为成功（文件已不存在）', async () => {
      await client.configure(testConfig)
      vi.mocked(getSecret).mockResolvedValue('test-password')
      vi.mocked(safeFetch).mockResolvedValue(new Response('', { status: 404 }))

      const result = await client.delete('/SpiritPal/data/missing-file.json')
      expect(result).toBe(true)
    })
  })
})

describe('WebDAV 单例', () => {
  beforeEach(() => {
    resetWebDAVClient()
  })

  it('getWebDAVClient 返回同一实例', () => {
    const a = getWebDAVClient()
    const b = getWebDAVClient()
    expect(a).toBe(b)
  })

  it('resetWebDAVClient 后返回新实例', () => {
    const a = getWebDAVClient()
    resetWebDAVClient()
    const b = getWebDAVClient()
    expect(a).not.toBe(b)
  })
})
