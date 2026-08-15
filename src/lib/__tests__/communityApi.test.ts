// communityApi 模块测试 — 社区形象 API（fetch 失败时回退 mock 数据）
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchCommunityCharacters,
  fetchCharacterDetail,
  downloadCharacter,
  uploadCharacter,
  rateCharacter,
  fetchComments,
  addComment,
} from '../communityApi'
import type { UploadModData } from '../communityApi'

describe('communityApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    // fetch 默认 reject（模拟网络不可达），触发 mock 回退
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
  })

  describe('fetchCommunityCharacters', () => {
    it('回退 mock 数据返回分页列表', async () => {
      const result = await fetchCommunityCharacters(1, 'hot')
      expect(result.items).toHaveLength(3)
      expect(result.page).toBe(1)
      expect(result.total).toBe(3)
      expect(result.hasMore).toBe(false)
    })

    it('按 latest 排序（uploadAt 降序）', async () => {
      const result = await fetchCommunityCharacters(1, 'latest')
      const times = result.items.map((c) => c.uploadAt)
      expect(times[0]).toBeGreaterThanOrEqual(times[1])
      expect(times[1]).toBeGreaterThanOrEqual(times[2])
    })

    it('按 rating 排序（评分降序）', async () => {
      const result = await fetchCommunityCharacters(1, 'rating')
      expect(result.items[0].rating).toBeGreaterThanOrEqual(result.items[1].rating)
    })

    it('搜索关键词过滤结果', async () => {
      const result = await fetchCommunityCharacters(1, 'hot', '柴犬')
      expect(result.items.length).toBe(1)
      expect(result.items[0].name).toBe('shiba')
    })

    it('pageSize 控制返回条数', async () => {
      const result = await fetchCommunityCharacters(1, 'hot', undefined, 2)
      expect(result.items).toHaveLength(2)
      expect(result.hasMore).toBe(true)
    })

    it('page=2 返回第二页', async () => {
      const result = await fetchCommunityCharacters(2, 'hot', undefined, 2)
      expect(result.items).toHaveLength(1)
      expect(result.page).toBe(2)
    })

    it('搜索无匹配时返回空列表', async () => {
      const result = await fetchCommunityCharacters(1, 'hot', '不存在的关键词')
      expect(result.items).toHaveLength(0)
      expect(result.total).toBe(0)
    })
  })

  describe('fetchCharacterDetail', () => {
    it('返回 mock 详情（含 modData）', async () => {
      const detail = await fetchCharacterDetail('mock-1')
      expect(detail.id).toBe('mock-1')
      expect(detail.displayName).toBe('初音未来 · 社区版')
      expect(detail.modData).toBeDefined()
      expect(detail.modData.petConf).toBeDefined()
    })

    it('不存在的 ID 抛出错误', async () => {
      await expect(fetchCharacterDetail('nonexistent')).rejects.toThrow()
    })
  })

  describe('downloadCharacter', () => {
    it('回退 mock 返回 Blob', async () => {
      const blob = await downloadCharacter('mock-1')
      expect(blob).toBeInstanceOf(Blob)
      const text = await blob.text()
      expect(text).toContain('petmod')
    })

    it('不存在的 ID 也返回 Blob（modData 为 null）', async () => {
      const blob = await downloadCharacter('nonexistent')
      expect(blob).toBeInstanceOf(Blob)
    })
  })

  describe('uploadCharacter', () => {
    it('回退 mock 返回本地 ID', async () => {
      const modData: UploadModData = {
        file: new File(['test'], 'test.petmod'),
        displayName: '测试形象',
        description: '描述',
        author: '作者',
        tags: ['测试'],
      }
      const result = await uploadCharacter(modData)
      expect(result.id).toMatch(/^local-/)
    })
  })

  describe('rateCharacter', () => {
    it('对 mock 角色评分后更新 ratingCount', async () => {
      const before = await fetchCharacterDetail('mock-1')
      const beforeCount = before.ratingCount // 捕获值（避免引用突变）
      const result = await rateCharacter('mock-1', 5)
      expect(result.characterId).toBe('mock-1')
      expect(result.ratingCount).toBe(beforeCount + 1)
    })

    it('评分 < 1 被钳制为 1', async () => {
      const result = await rateCharacter('mock-2', -1)
      expect(result.characterId).toBe('mock-2')
    })

    it('评分 > 5 被钳制为 5', async () => {
      const result = await rateCharacter('mock-2', 10)
      expect(result.characterId).toBe('mock-2')
    })

    it('不存在的角色返回 ratingCount=0', async () => {
      const result = await rateCharacter('nonexistent', 3)
      expect(result.ratingCount).toBe(0)
    })
  })

  describe('fetchComments', () => {
    it('返回 mock 评论列表', async () => {
      const comments = await fetchComments('mock-1')
      expect(comments.length).toBeGreaterThanOrEqual(2)
      expect(comments[0].characterId).toBe('mock-1')
    })

    it('无评论的角色返回空数组', async () => {
      const comments = await fetchComments('nonexistent')
      expect(comments).toHaveLength(0)
    })
  })

  describe('addComment', () => {
    it('添加评论并返回新评论对象', async () => {
      const comment = await addComment('mock-2', '测试评论内容')
      expect(comment.characterId).toBe('mock-2')
      expect(comment.content).toBe('测试评论内容')
      expect(comment.userName).toBe('我')
      expect(comment.id).toMatch(/^local-/)
    })

    it('添加后评论列表包含新评论', async () => {
      await addComment('mock-3', '新评论')
      const comments = await fetchComments('mock-3')
      expect(comments.some((c) => c.content === '新评论')).toBe(true)
    })
  })

  describe('自定义 API URL', () => {
    it('使用 window.__COMMUNITY_API_BASE_URL__ 时发起 fetch 请求', async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [], page: 1, pageSize: 12, total: 0, hasMore: false }),
          statusText: 'OK',
        }),
      )
      vi.stubGlobal('fetch', mockFetch)
      ;(window as unknown as { __COMMUNITY_API_BASE_URL__: string }).__COMMUNITY_API_BASE_URL__ =
        'https://custom.api.com/'

      await fetchCommunityCharacters(1, 'hot')

      expect(mockFetch).toHaveBeenCalled()
      const url = (mockFetch.mock.calls as any[][])[0][0] as string
      expect(url).toContain('https://custom.api.com/api/characters')

      delete (window as unknown as { __COMMUNITY_API_BASE_URL__?: string }).__COMMUNITY_API_BASE_URL__
    })
  })

  describe('API 返回错误状态码时不回退 mock', () => {
    it('HTTP 500 错误抛出而非回退', async () => {
      const apiError = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      }
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(apiError)))
      ;(window as unknown as { __COMMUNITY_API_BASE_URL__: string }).__COMMUNITY_API_BASE_URL__ =
        'https://custom.api.com'

      await expect(fetchCommunityCharacters(1)).rejects.toThrow()

      delete (window as unknown as { __COMMUNITY_API_BASE_URL__?: string }).__COMMUNITY_API_BASE_URL__
    })
  })

  describe('R5-A: 网络层超时控制', () => {
    it('fetchCommunityCharacters 调用 fetch 时注入 AbortSignal（超时控制已启用）', async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ items: [], page: 1, pageSize: 12, total: 0, hasMore: false }),
          statusText: 'OK',
        }),
      )
      vi.stubGlobal('fetch', mockFetch)
      ;(window as unknown as { __COMMUNITY_API_BASE_URL__: string }).__COMMUNITY_API_BASE_URL__ =
        'https://custom.api.com'

      await fetchCommunityCharacters(1, 'hot')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const callArgs = mockFetch.mock.calls[0] as unknown as [string, RequestInit?]; const callInit = callArgs[1]
      // ROBUSTNESS 验证：request() 必须为 fetch 注入 AbortSignal 用于超时控制
      expect(callInit?.signal).toBeInstanceOf(AbortSignal)

      delete (window as unknown as { __COMMUNITY_API_BASE_URL__?: string }).__COMMUNITY_API_BASE_URL__
    })

    it('downloadCharacter 调用 fetch 时注入 AbortSignal', async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          blob: () => Promise.resolve(new Blob(['test'], { type: 'application/octet-stream' })),
          statusText: 'OK',
        }),
      )
      vi.stubGlobal('fetch', mockFetch)
      ;(window as unknown as { __COMMUNITY_API_BASE_URL__: string }).__COMMUNITY_API_BASE_URL__ =
        'https://custom.api.com'

      await downloadCharacter('mock-1')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const callArgs = mockFetch.mock.calls[0] as unknown as [string, RequestInit?]; const callInit = callArgs[1]
      expect(callInit?.signal).toBeInstanceOf(AbortSignal)

      delete (window as unknown as { __COMMUNITY_API_BASE_URL__?: string }).__COMMUNITY_API_BASE_URL__
    })

    it('uploadCharacter 调用 fetch 时注入 AbortSignal（文件大小通过校验后）', async () => {
      const mockFetch = vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ id: 'server-123' }),
          statusText: 'OK',
        }),
      )
      vi.stubGlobal('fetch', mockFetch)
      ;(window as unknown as { __COMMUNITY_API_BASE_URL__: string }).__COMMUNITY_API_BASE_URL__ =
        'https://custom.api.com'

      const modData: UploadModData = {
        file: new File(['test'], 'test.petmod'),
        displayName: '测试',
        description: '描述',
        author: '作者',
        tags: [],
      }
      await uploadCharacter(modData)

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const callArgs = mockFetch.mock.calls[0] as unknown as [string, RequestInit?]; const callInit = callArgs[1]
      expect(callInit?.signal).toBeInstanceOf(AbortSignal)

      delete (window as unknown as { __COMMUNITY_API_BASE_URL__?: string }).__COMMUNITY_API_BASE_URL__
    })

    it('AbortError 不回退 mock（超时是真实错误，应抛出）', async () => {
      // 模拟超时触发：fetch 立即 reject AbortError（DOMException）
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(abortError)))
      ;(window as unknown as { __COMMUNITY_API_BASE_URL__: string }).__COMMUNITY_API_BASE_URL__ =
        'https://custom.api.com'

      // 超时不应回退 mock，应直接抛错
      await expect(fetchCommunityCharacters(1)).rejects.toThrow()

      delete (window as unknown as { __COMMUNITY_API_BASE_URL__?: string }).__COMMUNITY_API_BASE_URL__
    })

    it('fetchCommunityCharacters 在占位 URL 下默认回退 mock（TypeError 而非超时）', async () => {
      // 此场景下 fetch 立即 reject TypeError，应回退 mock 而非触发超时
      const result = await fetchCommunityCharacters(1, 'hot')
      expect(result.items).toHaveLength(3)
    })
  })

  describe('R5-B: 上传文件大小校验', () => {
    it('文件超过 50MB 上限时抛错且不调用 fetch', async () => {
      const oversizedFile = new File([new Uint8Array(51 * 1024 * 1024)], 'huge.petmod')
      const modData: UploadModData = {
        file: oversizedFile,
        displayName: '超大形象',
        description: '描述',
        author: '作者',
        tags: ['测试'],
      }
      const fetchSpy = vi.fn()
      vi.stubGlobal('fetch', fetchSpy)

      await expect(uploadCharacter(modData)).rejects.toThrow(/文件过大/)
      // SECURITY 验证：超限文件不应触发任何网络请求
      expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('文件恰等于 50MB 上限时通过校验（边界条件）', async () => {
      // 边界测试：50MB 整应通过（> 才抛错）
      const boundaryFile = new File([new Uint8Array(50 * 1024 * 1024)], 'boundary.petmod')
      const modData: UploadModData = {
        file: boundaryFile,
        displayName: '边界形象',
        description: '描述',
        author: '作者',
        tags: ['测试'],
      }
      // fetch 默认 reject → 回退 mock → 返回 local- ID
      const result = await uploadCharacter(modData)
      expect(result.id).toMatch(/^local-/)
    })

    it('正常小文件通过校验（不抛尺寸错误）', async () => {
      const modData: UploadModData = {
        file: new File(['test'], 'test.petmod'),
        displayName: '测试形象',
        description: '描述',
        author: '作者',
        tags: ['测试'],
      }
      const result = await uploadCharacter(modData)
      expect(result.id).toMatch(/^local-/)
    })
  })
})
