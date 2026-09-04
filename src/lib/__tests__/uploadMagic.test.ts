// uploadMagic 单元测试 — 上传文件魔数校验前端助手
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getFileExtension, validateUploadMagic } from '@/lib/system/uploadMagic'

// 动态 import('@tauri-apps/api/core')：测试中 mock 掉
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

import { invoke } from '@tauri-apps/api/core'

const mockInvoke = vi.mocked(invoke)

function makeFile(name: string, bytes: number[]): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/octet-stream' })
}

describe('getFileExtension（扩展名提取）', () => {
  it('提取小写扩展名', () => {
    expect(getFileExtension('cat.PNG')).toBe('.png')
    expect(getFileExtension('photo.jpeg')).toBe('.jpeg')
  })

  it('无扩展名返回空字符串', () => {
    expect(getFileExtension('noext')).toBe('')
    expect(getFileExtension('.hidden')).toBe('')
  })
})

describe('validateUploadMagic（魔数校验）', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
  })

  it('未登记扩展名跳过校验（返回 null）', async () => {
    const file = makeFile('data.json', [0x7b, 0x22])
    await expect(validateUploadMagic(file)).resolves.toBeNull()
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('Rust 端校验失败时返回错误文案携带文件名', async () => {
    mockInvoke.mockResolvedValue(false)
    const file = makeFile('fake.png', [0x89, 0x50, 0x4e, 0x47])
    const error = await validateUploadMagic(file)
    expect(error).toContain('fake.png')
    expect(error).toMatch(/魔数校验失败/)
  })

  it('Rust 端校验通过时返回 null', async () => {
    mockInvoke.mockResolvedValue(true)
    const file = makeFile('real.png', [0x89, 0x50, 0x4e, 0x47])
    await expect(validateUploadMagic(file)).resolves.toBeNull()
  })

  it('非 Tauri 环境（invoke 抛错）时跳过不阻断', async () => {
    mockInvoke.mockRejectedValue(new Error('not in tauri'))
    const file = makeFile('ok.png', [0x89, 0x50, 0x4e, 0x47])
    await expect(validateUploadMagic(file)).resolves.toBeNull()
  })

  it('调用 Rust 端时传递文件头字节与扩展名', async () => {
    mockInvoke.mockResolvedValue(true)
    const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]
    const file = makeFile('header.png', header)
    await validateUploadMagic(file)
    expect(mockInvoke).toHaveBeenCalledWith('validate_upload_magic', {
      contents: header,
      fileExt: '.png',
    })
  })
})