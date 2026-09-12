/**
 * encryptionAudit — 持久化数据加密路径审计工具
 *
 * @fileoverview
 * 梳理 SpiritPal 各数据持久化路径的加密状态，输出「已加密 / 明文」清单，
 * 并对敏感明文路径给出迁移建议。同时提供可复用的安全值助手
 * encryptSensitiveValue / decryptSensitiveValue（基于 blobCrypto 的 AES-256-GCM），
 * 供新增「敏感数据持久化」场景直接调用，避免再发明明文存储。
 *
 * 覆盖的加密原语（不重复实现）：
 * - Rust AES-256-GCM（ENC1/ENC2/ENC3 前缀）：encryptedStorage / blobCrypto
 * - Web Crypto AES-256-GCM（用户密码派生）：encryptedExport（.spiritpal 导出文件）
 * - 系统 Keychain：secureStorage（API Key 等凭证，不落 localStorage）
 *
 * 审计方式：
 * - 静态注册表 KNOWN_DATA_PATHS 描述已知持久化路径的预期加密状态
 * - runEncryptionAudit() 扫描实际 storage，按密文前缀判定真实加密状态，
 *   交叉比对注册表，输出差异与风险项
 *
 * @module lib/data/encryptionAudit
 */

import { encryptBlob, decryptBlob } from './blobCrypto'

// ============ 类型定义 ============

/** 数据域 */
export type DataPathDomain =
  | 'settings'
  | 'memory'
  | 'mod'
  | 'auth'
  | 'analytics'
  | 'nurture'
  | 'system'

/** 敏感度 */
export type Sensitivity = 'high' | 'medium' | 'low'

/** 加密机制 */
export type EncryptionMechanism =
  | 'aes-gcm-tauri'
  | 'aes-gcm-webcrypto'
  | 'keychain'
  | 'sqlite-encrypted'
  | 'plaintext'
  | 'unknown'

/** 单条持久化路径的静态描述 */
export interface DataPathRecord {
  /** localStorage 键前缀（用于匹配实际键名） */
  keyPrefix: string
  domain: DataPathDomain
  sensitivity: Sensitivity
  /** 设计预期：是否应加密 */
  expectedEncrypted: boolean
  mechanism: EncryptionMechanism
  description: string
  /** 若不达标时的迁移建议 */
  recommendation?: string
}

/** 单键审计结果 */
export interface AuditEntry {
  key: string
  /** 实际存储值形态 */
  actual: 'tauri-encrypted' | 'webcrypto-encrypted' | 'plaintext' | 'empty'
  known: boolean
  sensitivity: Sensitivity | 'unknown'
  mechanism: EncryptionMechanism | 'unknown'
  /** 是否为待处理风险（敏感 + 明文） */
  risky: boolean
  recommendation?: string
}

/** 审计报告 */
export interface EncryptionAuditReport {
  totalKeys: number
  encryptedCount: number
  plaintextCount: number
  entries: AuditEntry[]
  /** 风险项：敏感数据明文持久化 */
  findings: AuditEntry[]
}

// ============ 已知持久化路径注册表 ============

/**
 * 已知数据持久化路径清单（静态事实源）。
 * 新增敏感持久化点时在此登记，便于审计对账。
 */
export const KNOWN_DATA_PATHS: DataPathRecord[] = [
  {
    keyPrefix: 'spiritpal-settings-store',
    domain: 'settings',
    sensitivity: 'medium',
    expectedEncrypted: true,
    mechanism: 'aes-gcm-tauri',
    description: '应用偏好设置（encryptedStorage 加密适配器）',
  },
  {
    keyPrefix: 'spiritpal-ai-config',
    domain: 'auth',
    sensitivity: 'high',
    expectedEncrypted: false,
    mechanism: 'plaintext',
    description: 'AI 配置主体（不含明文 apiKey，apiKey 走 Keychain）',
    recommendation: '确认配置体不含密钥；敏感字段应迁移到 secureStorage/Keychain',
  },
  {
    keyPrefix: 'spiritpal-enhanced-memory',
    domain: 'memory',
    sensitivity: 'high',
    expectedEncrypted: true,
    mechanism: 'sqlite-encrypted',
    description: '增强记忆主库（SQLite，Rust 端加密落盘）',
  },
  {
    keyPrefix: 'spiritpal-memory',
    domain: 'memory',
    sensitivity: 'high',
    expectedEncrypted: true,
    mechanism: 'sqlite-encrypted',
    description: '旧版记忆库（迁移至 SQLite）',
  },
  {
    keyPrefix: 'spiritpal-mods',
    domain: 'mod',
    sensitivity: 'low',
    expectedEncrypted: false,
    mechanism: 'plaintext',
    description: 'Mod 安装清单（元数据，非用户私密数据）',
  },
  {
    keyPrefix: 'spiritpal-achievements',
    domain: 'nurture',
    sensitivity: 'low',
    expectedEncrypted: false,
    mechanism: 'plaintext',
    description: '成就统计（非敏感）',
  },
  {
    keyPrefix: 'spiritpal-tasks',
    domain: 'nurture',
    sensitivity: 'low',
    expectedEncrypted: false,
    mechanism: 'plaintext',
    description: '任务清单（非敏感）',
  },
  {
    keyPrefix: 'analytics-events',
    domain: 'analytics',
    sensitivity: 'low',
    expectedEncrypted: true,
    mechanism: 'aes-gcm-tauri',
    description: '本地分析事件（用户同意后加密落盘）',
  },
]

// ============ 密文形态判定 ============

/** Rust 端加密前缀（与 crypto.rs / blobCrypto 一致） */
const TAURI_CIPHER_PREFIXES = ['ENC1:', 'ENC2:', 'ENC3:']

/**
 * 判定一段已存储字符串的实际加密形态
 */
export function classifyStoredValue(value: string | null): AuditEntry['actual'] {
  if (value === null || value === '') return 'empty'
  if (TAURI_CIPHER_PREFIXES.some((p) => value.startsWith(p))) return 'tauri-encrypted'
  // Web Crypto 加密导出格式（EncryptedPayload JSON）
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>
    if (parsed?.v === 1 && parsed?.alg === 'aes-256-gcm' && typeof parsed.data === 'string') {
      return 'webcrypto-encrypted'
    }
  } catch {
    // 非 JSON，视为明文
  }
  return 'plaintext'
}

/** 在注册表中按 keyPrefix 匹配（最长前缀优先） */
function lookupRecord(key: string): DataPathRecord | undefined {
  let best: DataPathRecord | undefined
  for (const rec of KNOWN_DATA_PATHS) {
    if (key.startsWith(rec.keyPrefix)) {
      if (!best || rec.keyPrefix.length > best.keyPrefix.length) best = rec
    }
  }
  return best
}

// ============ 审计执行 ============

/**
 * 扫描给定 storage（默认 localStorage），输出加密审计报告。
 *
 * @param storage 可注入的存储实现（默认全局 localStorage，便于测试）
 */
export function runEncryptionAudit(storage?: Storage): EncryptionAuditReport {
  const target: Storage | undefined = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)

  const entries: AuditEntry[] = []
  const findings: AuditEntry[] = []
  let encryptedCount = 0
  let plaintextCount = 0

  if (target) {
    for (let i = 0; i < target.length; i++) {
      const key = target.key(i)
      if (key === null) continue
      const value = target.getItem(key)
      const actual = classifyStoredValue(value)
      const record = lookupRecord(key)
      const known = Boolean(record)
      const sensitivity: AuditEntry['sensitivity'] = record ? record.sensitivity : 'unknown'
      const mechanism: AuditEntry['mechanism'] = record ? record.mechanism : 'unknown'

      if (actual === 'tauri-encrypted' || actual === 'webcrypto-encrypted') {
        encryptedCount++
      } else if (actual === 'plaintext') {
        plaintextCount++
      }

      // 风险判定：注册表登记为「预期应加密」却以明文落盘
      const risky = Boolean(record?.expectedEncrypted) && actual === 'plaintext'
      const entry: AuditEntry = {
        key,
        actual,
        known,
        sensitivity,
        mechanism,
        risky,
        recommendation: risky ? record?.recommendation ?? '应改用 encryptedStorage / blobCrypto 加密持久化' : undefined,
      }
      entries.push(entry)
      if (risky) findings.push(entry)
    }
  }

  return {
    totalKeys: entries.length,
    encryptedCount,
    plaintextCount,
    entries,
    findings,
  }
}

// ============ 可复用安全值助手 ============

/**
 * 敏感值加密写入助手（AES-256-GCM，自动分派 ENC2/ENC3）。
 *
 * 用于新增「敏感数据持久化」场景：先 encryptSensitiveValue 再写入存储。
 * Tauri 不可用或加密失败时降级为明文（与 encryptedStorage 一致，不丢数据）。
 */
export async function encryptSensitiveValue(plain: string): Promise<string> {
  if (!plain) return plain
  try {
    return await encryptBlob(plain)
  } catch (e) {
    console.warn('[encryptionAudit] encryptSensitiveValue 失败，降级明文:', e)
    return plain
  }
}

/**
 * 敏感值读取助手：识别 ENC 前缀则解密，否则按旧版明文原样返回。
 */
export async function decryptSensitiveValue(stored: string | null): Promise<string | null> {
  if (stored === null) return null
  if (stored === '') return stored
  if (!TAURI_CIPHER_PREFIXES.some((p) => stored.startsWith(p))) return stored
  try {
    return await decryptBlob(stored)
  } catch (e) {
    console.warn('[encryptionAudit] decryptSensitiveValue 失败:', e)
    return null
  }
}
