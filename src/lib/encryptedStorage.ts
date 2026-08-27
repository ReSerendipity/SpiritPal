/**
 * @file encryptedStorage.ts
 * @description 加密 Storage 适配器 — 为 Zustand persist 中间件提供 AES-256-GCM 加密的 localStorage
 *
 * 安全设计：
 * - 写入时：JSON.stringify → invoke('encrypt_data') → localStorage.setItem(密文)
 * - 读取时：localStorage.getItem(密文) → invoke('decrypt_data') → JSON.parse(明文)
 * - 密钥来源：Rust 端使用机器 ID 派生（PBKDF2-HMAC-SHA256，100,000 次迭代）
 * - 降级策略：Tauri 环境不可用时（如测试环境）回退到明文 localStorage + console.warn
 *
 * 前缀约定：加密数据以 `ENC2:` 前缀标识（与 Rust 端 crypto.rs 一致）
 * 非加密数据（旧版明文 / 降级模式）直接为 JSON 字符串
 *
 * 依赖关系：
 * - @tauri-apps/api/core: Tauri invoke 调用 Rust 后端加密/解密命令
 * - zustand/middleware: StateStorage 接口
 *
 * @module lib/encryptedStorage
 */

import { invoke, isTauri } from '@tauri-apps/api/core'
import type { StateStorage } from 'zustand/middleware'

/**
 * 判断当前是否处于 Tauri 环境
 * 在非 Tauri 环境（如 Vitest jsdom）中，isTauri 返回 false
 */
let tauriAvailable: boolean | null = null

async function checkTauriAvailable(): Promise<boolean> {
  if (tauriAvailable !== null) return tauriAvailable
  try {
    tauriAvailable = isTauri()
  } catch {
    tauriAvailable = false
  }
  return tauriAvailable
}

/**
 * 加密的 StateStorage 适配器
 *
 * 将 Zustand persist 的数据通过 Rust 端 AES-256-GCM 加密后存储到 localStorage。
 * 读取时自动解密。兼容旧版明文数据（无 ENC2: 前缀时直接 JSON.parse）。
 *
 * @returns StateStorage 接口实现（getItem / setItem / removeItem）
 *
 * @example
 * ```ts
 * import { createJSONStorage } from 'zustand/middleware'
 * import { encryptedStorage } from '@/lib/encryptedStorage'
 *
 * export const useStore = create<State>()(
 *   persist(
 *     (set) => ({ ... }),
 *     {
 *       name: 'spiritpal-secure-store',
 *       storage: createJSONStorage(() => encryptedStorage),
 *     }
 *   )
 * )
 * ```
 */
export const encryptedStorage: StateStorage = {
  async getItem(name: string): Promise<string | null> {
    const raw = localStorage.getItem(name)
    if (raw === null) return null

    // 检查是否为加密数据（ENC2: 前缀）
    if (raw.startsWith('ENC2:')) {
      const canEncrypt = await checkTauriAvailable()
      if (!canEncrypt) {
        // Tauri 不可用但有加密数据 — 无法解密，返回 null 让 store 使用默认值
        console.warn('[encryptedStorage] Encrypted data found but Tauri is not available — falling back to defaults')
        return null
      }
      try {
        const decrypted = await invoke<string>('decrypt_data', { encrypted: raw, password: '' })
        return decrypted
      } catch (e) {
        console.error('[encryptedStorage] Decryption failed:', e)
        // 解密失败返回 null 让 store 使用默认值（而非崩溃）
        return null
      }
    }

    // 旧版明文数据，直接返回
    return raw
  },

  async setItem(name: string, value: string): Promise<void> {
    const canEncrypt = await checkTauriAvailable()
    if (!canEncrypt) {
      // Tauri 不可用 — 降级为明文存储（仅在开发/测试环境）
      if (tauriAvailable === false) {
        // 仅首次警告，避免控制台刷屏
        console.warn('[encryptedStorage] Tauri not available — storing settings in plaintext (dev/test mode)')
        tauriAvailable = false // 确保不再重复检查
      }
      localStorage.setItem(name, value)
      return
    }

    try {
      const encrypted = await invoke<string>('encrypt_data', { data: value, password: '' })
      localStorage.setItem(name, encrypted)
    } catch (e) {
      console.error('[encryptedStorage] Encryption failed, falling back to plaintext:', e)
      // 加密失败时降级为明文（不丢数据）
      localStorage.setItem(name, value)
    }
  },

  removeItem(name: string): Promise<void> {
    localStorage.removeItem(name)
    return Promise.resolve()
  },
}

/**
 * 重置 Tauri 可用性缓存（供测试使用）
 */
export function _resetTauriCache(): void {
  tauriAvailable = null
}

/**
 * 强制设置 Tauri 可用性（供测试使用）
 * @param available 是否可用
 */
export function _setTauriAvailable(available: boolean): void {
  tauriAvailable = available
}
