/**
 * @file blobCrypto.test.ts
 * @description 大 blob 加密统一入口单测（B-3）
 *
 * 契约：
 *  1. 小数据（≤5M 字符）走 ENC2 单块命令
 *  2. 大数据（>5M 字符）自动走 ENC3 分块命令
 *  3. 解密按前缀分派：ENC3 → chunked；ENC1/ENC2/其他 → 原路径
 */

import { invoke } from '@tauri-apps/api/core'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { encryptBlob, decryptBlob, LARGE_BLOB_THRESHOLD } from '@/lib/data/blobCrypto'

const mockInvoke = vi.mocked(invoke)

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockResolvedValue('')
})

describe('encryptBlob', () => {
  it('小数据走 ENC2 单块命令', async () => {
    await encryptBlob('small data')

    expect(mockInvoke).toHaveBeenCalledWith('encrypt_data', {
      data: 'small data',
      password: '',
    })
  })

  it('超过阈值的大数据自动走 ENC3 分块命令', async () => {
    const big = 'a'.repeat(LARGE_BLOB_THRESHOLD + 1)

    await encryptBlob(big)

    expect(mockInvoke).toHaveBeenCalledWith('encrypt_data_chunked', {
      data: big,
      password: '',
    })
    expect(mockInvoke).not.toHaveBeenCalledWith('encrypt_data', expect.anything())
  })

  it('恰好等于阈值的数据走单块路径', async () => {
    const exact = 'a'.repeat(LARGE_BLOB_THRESHOLD)

    await encryptBlob(exact)

    expect(mockInvoke).toHaveBeenCalledWith('encrypt_data', expect.anything())
  })
})

describe('decryptBlob', () => {
  it.each(['ENC3:', 'ENC2:', 'ENC1:'])('%s 前缀数据正确分派', async (prefix) => {
    const cipher = `${prefix}payload`
    await decryptBlob(cipher)

    if (prefix === 'ENC3:') {
      expect(mockInvoke).toHaveBeenCalledWith('decrypt_data_chunked', {
        encrypted: cipher,
        password: '',
      })
    } else {
      expect(mockInvoke).toHaveBeenCalledWith('decrypt_data', {
        encrypted: cipher,
        password: '',
      })
    }
  })

  it('无前缀明文走原路径（由 Rust 端报错）', async () => {
    await decryptBlob('plain text')

    expect(mockInvoke).toHaveBeenCalledWith('decrypt_data', {
      encrypted: 'plain text',
      password: '',
    })
  })
})
