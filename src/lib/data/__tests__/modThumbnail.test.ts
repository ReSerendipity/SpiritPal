// modThumbnail 测试 — 候选路径解析与存在性探测顺序
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ModInfo } from '@/lib/data/modManager'
import { getModThumbnailCandidates, resolveModThumbnail } from '@/lib/data/modThumbnail'
const { existsMock, readTextMock, convertMock } = vi.hoisted(() => ({
  existsMock: vi.fn<(p: string) => Promise<boolean>>(),
  readTextMock: vi.fn<(p: string) => Promise<string>>(),
  convertMock: vi.fn((p: string) => `http://asset.localhost/${p}`),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: existsMock,
  readTextFile: readTextMock,
}))
vi.mock('@tauri-apps/api/path', () => ({
  join: vi.fn((...args: string[]) => Promise.resolve(args.join('/'))),
}))
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: convertMock,
}))

function makeMod(modPath?: string): ModInfo {
  return {
    id: 'demo-pet',
    displayName: '演示',
    source: '社区',
    version: '1.0.0',
    enabled: true,
    isBuiltIn: false,
    installedAt: 0,
    modData: {
      petConf: {} as never,
      dialogueConf: {} as never,
    },
    modPath,
  }
}

describe('getModThumbnailCandidates', () => {
  it('按 preview.png → thumbnail.png → icon.png 顺序给出候选', () => {
    const candidates = getModThumbnailCandidates(makeMod('/mods/demo-pet'))
    expect(candidates).toEqual([
      '/mods/demo-pet/preview.png',
      '/mods/demo-pet/thumbnail.png',
      '/mods/demo-pet/icon.png',
    ])
  })

  it('modPath 缺失时返回空数组', () => {
    expect(getModThumbnailCandidates(makeMod(undefined))).toEqual([])
  })
})

describe('resolveModThumbnail', () => {
  beforeEach(() => {
    existsMock.mockReset()
    readTextMock.mockReset()
    convertMock.mockClear()
  })

  it('preview.png 存在时优先返回其 asset URL', async () => {
    existsMock.mockImplementation((p: string) => Promise.resolve(p === '/mods/demo-pet/preview.png'))
    const url = await resolveModThumbnail(makeMod('/mods/demo-pet'))
    expect(url).toBe('http://asset.localhost//mods/demo-pet/preview.png')
    expect(existsMock).toHaveBeenCalledWith('/mods/demo-pet/preview.png')
  })

  it('preview 缺失时回退 thumbnail.png', async () => {
    existsMock.mockImplementation(
      (p: string) => Promise.resolve(p === '/mods/demo-pet/thumbnail.png'),
    )
    const url = await resolveModThumbnail(makeMod('/mods/demo-pet'))
    expect(url).toBe('http://asset.localhost//mods/demo-pet/thumbnail.png')
  })

  it('候选文件全缺失时回退 manifest.thumbnail 字段', async () => {
    readTextMock.mockResolvedValue(JSON.stringify({ thumbnail: 'art/cover.png' }))
    existsMock.mockImplementation((p: string) =>
      Promise.resolve(
        p === '/mods/demo-pet/manifest.json' || p === '/mods/demo-pet/art/cover.png',
      ),
    )
    const url = await resolveModThumbnail(makeMod('/mods/demo-pet'))
    expect(readTextMock).toHaveBeenCalledWith('/mods/demo-pet/manifest.json')
    expect(url).toBe('http://asset.localhost//mods/demo-pet/art/cover.png')
  })

  it('manifest.icon 作为 thumbnail 的回退字段', async () => {
    readTextMock.mockResolvedValue(JSON.stringify({ icon: 'art/icon.png' }))
    existsMock.mockImplementation((p: string) =>
      Promise.resolve(
        p === '/mods/demo-pet/manifest.json' || p === '/mods/demo-pet/art/icon.png',
      ),
    )
    const url = await resolveModThumbnail(makeMod('/mods/demo-pet'))
    expect(url).toBe('http://asset.localhost//mods/demo-pet/art/icon.png')
  })

  it('manifest 中绝对路径/协议路径被拒绝，返回 null', async () => {
    readTextMock.mockResolvedValue(JSON.stringify({ thumbnail: 'https://evil.example/x.png' }))
    existsMock.mockImplementation((p: string) => Promise.resolve(p === '/mods/demo-pet/manifest.json'))
    const url = await resolveModThumbnail(makeMod('/mods/demo-pet'))
    expect(url).toBeNull()
  })

  it('所有来源都不存在时返回 null（UI 展示占位图）', async () => {
    readTextMock.mockResolvedValue('{}')
    existsMock.mockResolvedValue(false)
    const url = await resolveModThumbnail(makeMod('/mods/demo-pet'))
    expect(url).toBeNull()
  })

  it('modPath 缺失时直接返回 null', async () => {
    const url = await resolveModThumbnail(makeMod(undefined))
    expect(url).toBeNull()
    expect(existsMock).not.toHaveBeenCalled()
  })
})
