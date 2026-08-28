/**
 * @file blobCrypto.ts
 * @description 大 blob 加密统一入口（B-3）
 *
 * 背景：此前各模块直接 `invoke('encrypt_data'/'decrypt_data')`（ENC2 单块格式），
 * MB 级记忆 blob 每次读写都要：10 万次 PBKDF2 + 全量 AES + ≈1.35× base64 拷贝。
 *
 * 本模块按大小自动分派：
 * - ≤ LARGE_BLOB_THRESHOLD → 原路径（ENC2 单块，行为与之前完全一致）
 * - > LARGE_BLOB_THRESHOLD → ENC3 分块流式加密（Rust `encrypt_data_chunked`，
 *   一次 PBKDF2 派生密钥，每块独立随机 nonce + AES-GCM 认证）
 *
 * 兼容性：decryptBlob 按密文前缀分派（ENC3 → chunked，ENC1/ENC2 → 原路径），
 * **旧数据无需迁移**；新写入的大 blob 自动升级为分块格式。
 *
 * ⚠️ 阈值按 JS 字符串长度（UTF-16 code units）估算字节数：
 * 对 CJK 文本（3 字节/字符）会低估约 50%，属保守方向（更晚才切分块），可接受。
 */

import { invoke } from '@tauri-apps/api/core'

/** 超过该长度（约字符数）的明文走分块加密 */
export const LARGE_BLOB_THRESHOLD = 5 * 1024 * 1024

/**
 * 加密 blob：小数据走 ENC2 单块，大数据自动走 ENC3 分块
 */
export async function encryptBlob(plain: string): Promise<string> {
  if (plain.length > LARGE_BLOB_THRESHOLD) {
    return invoke<string>('encrypt_data_chunked', { data: plain, password: '' })
  }
  return invoke<string>('encrypt_data', { data: plain, password: '' })
}

/**
 * 解密 blob：按密文前缀自动分派（ENC3 / ENC2 / ENC1）
 */
export async function decryptBlob(cipher: string): Promise<string> {
  if (cipher.startsWith('ENC3:')) {
    return invoke<string>('decrypt_data_chunked', { encrypted: cipher, password: '' })
  }
  return invoke<string>('decrypt_data', { encrypted: cipher, password: '' })
}
