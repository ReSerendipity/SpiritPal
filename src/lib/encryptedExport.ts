/**
 * 加密导出/导入工具 — AES-256-GCM 加密 + Base64 编码 + PBKDF2 密钥派生
 * P1-9: 记忆导出/导入增强为加密导出
 *
 * @fileoverview
 * 主要模块：
 * - EncryptedPayload 接口：加密载荷格式（版本/算法/迭代次数/盐/IV/密文）
 * - ExportFormat 类型：导出格式（json 明文 / encrypted 加密）
 * - encryptData()：加密数据（Web Crypto API，AES-256-GCM）
 * - decryptData()：解密数据
 * - exportEncrypted()：加密导出为 .spiritpal 文件
 * - importEncrypted()：从 .spiritpal 文件解密导入
 * - exportPlain()：明文导出为 .json 文件
 *
 * 设计原则：
 * 1. 用户可选：明文 JSON 或加密格式
 * 2. 加密使用 Web Crypto API（浏览器原生，零依赖）
 * 3. 密码派生使用 PBKDF2 + 随机盐（100000 次迭代）
 * 4. 导出格式兼容：加密 .spiritpal 文件 vs 明文 .json
 *
 * 加密流程：plaintext → JSON → AES-256-GCM(password-derived-key, random-iv) → Base64(salt+iv+ciphertext)
 * 解密流程：Base64 → salt+iv+ciphertext → AES-256-GCM-decrypt → JSON → plaintext
 *
 * @module encryptedExport
 */

// ============ 类型定义 ============

export interface EncryptedPayload {
  /** 格式版本 */
  v: 1
  /** 加密算法 */
  alg: 'aes-256-gcm'
  /** PBKDF2 迭代次数 */
  iterations: number
  /** Base64 编码的盐（16 字节） */
  salt: string
  /** Base64 编码的 IV（12 字节） */
  iv: string
  /** Base64 编码的密文 */
  data: string
}

export type ExportFormat = 'json' | 'encrypted'

// ============ 常量 ============

const PBKDF2_ITERATIONS = 100000
const SALT_LENGTH = 16
const IV_LENGTH = 12
const KEY_LENGTH = 256 // AES-256

// ============ 工具函数 ============

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  )
}

// ============ 加密导出 ============

/**
 * 加密数据并返回 EncryptedPayload
 * @param data 原始数据字符串（通常是 JSON）
 * @param password 用户密码
 * @returns 加密后的 payload
 */
export async function encryptExportData(data: string, password: string): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH))
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH))
  const key = await deriveKey(password, salt)

  const encoder = new TextEncoder()
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    encoder.encode(data),
  )

  return {
    v: 1,
    alg: 'aes-256-gcm',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt.buffer),
    iv: toBase64(iv.buffer),
    data: toBase64(ciphertext),
  }
}

/**
 * 解密 EncryptedPayload 并返回原始数据
 * @param payload 加密的 payload
 * @param password 用户密码
 * @returns 原始数据字符串
 */
export async function decryptImportData(payload: EncryptedPayload, password: string): Promise<string> {
  const salt = fromBase64(payload.salt)
  const iv = fromBase64(payload.iv)
  const ciphertext = fromBase64(payload.data)
  const key = await deriveKey(password, salt)

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  )

  const decoder = new TextDecoder()
  return decoder.decode(plaintext)
}

/**
 * 检测字符串是否为加密格式
 */
export function isEncryptedFormat(content: string): boolean {
  try {
    const parsed = JSON.parse(content)
    return parsed.v === 1 && parsed.alg === 'aes-256-gcm' && !!parsed.data
  } catch {
    return false
  }
}

/**
 * 从字符串解析 EncryptedPayload
 */
export function parseEncryptedPayload(content: string): EncryptedPayload | null {
  try {
    const parsed = JSON.parse(content)
    if (parsed.v === 1 && parsed.alg === 'aes-256-gcm' && parsed.data) {
      return parsed as EncryptedPayload
    }
    return null
  } catch {
    return null
  }
}
