/**
 * @file secureStorage.ts
 * @description 安全存储层模块 — 使用系统 Keychain 加密存储敏感数据
 *
 * 主要功能：
 * - 将敏感数据（如 AI API Key）安全存储到系统密钥链
 * - 支持存储、读取、删除操作
 * - 提供 API Key 专用的封装接口
 *
 * 平台存储位置：
 * - Windows: Credential Manager
 * - macOS: Keychain
 * - Linux: Secret Service (GNOME Keyring / KWallet)
 *
 * 主要模块：
 * - setSecret/getSecret/deleteSecret: 底层 Keychain 操作
 * - setApiKey/getApiKey/deleteApiKey: API Key 专用封装
 *
 * 依赖关系：
 * - @tauri-apps/api/core: Tauri invoke 调用 Rust 后端
 *
 * 核心接口：
 * - setSecret(): 存储密钥
 * - getSecret(): 读取密钥
 * - setApiKey(): 存储 API Key
 * - getApiKey(): 读取 API Key
 *
 * 命名规范：
 * - service name 统一为 "SpiritPal"
 * - API Key 的 key 格式：api-key-${providerId}
 */

import { invoke } from '@tauri-apps/api/core'

// ============ 底层 Keychain 封装 ============

/**
 * 将值存储到系统 Keychain
 * @param key 存储键名
 * @param value 要存储的值（明文）
 * @returns Promise，存储完成时解析
 * @throws 调用 Tauri 命令失败时抛出异常
 */
export async function setSecret(key: string, value: string): Promise<void> {
  await invoke('set_secret', { key, value })
}

/**
 * 从系统 Keychain 读取值
 * @param key 存储键名
 * @returns Promise，解析为存储的值，不存在时返回 null
 * @throws 调用 Tauri 命令失败时抛出异常
 */
export async function getSecret(key: string): Promise<string | null> {
  return await invoke<string | null>('get_secret', { key })
}

/**
 * 从系统 Keychain 删除值
 * @param key 存储键名
 * @returns Promise，删除完成时解析
 * @throws 调用 Tauri 命令失败时抛出异常
 */
export async function deleteSecret(key: string): Promise<void> {
  await invoke('delete_secret', { key })
}

// ============ API Key 专用封装 ============

/**
 * 构建 API Key 在 Keychain 中的 account 标识
 * @param providerId 服务商 ID
 * @returns 格式化的键名
 */
function apiKeyId(providerId: string): string {
  return `api-key-${providerId}`
}

/**
 * 存储 AI 服务商的 API Key 到系统 Keychain
 * @param providerId 服务商 ID（如 "openai"、"anthropic"）
 * @param key API Key 明文
 * @returns Promise，存储完成时解析
 * @throws 调用 Tauri 命令失败时抛出异常
 */
export async function setApiKey(providerId: string, key: string): Promise<void> {
  await setSecret(apiKeyId(providerId), key)
}

/**
 * 从系统 Keychain 读取 AI 服务商的 API Key
 * @param providerId 服务商 ID
 * @returns Promise，解析为 API Key 明文，不存在时返回 null
 * @throws 调用 Tauri 命令失败时抛出异常
 */
export async function getApiKey(providerId: string): Promise<string | null> {
  return await getSecret(apiKeyId(providerId))
}

/**
 * 从系统 Keychain 删除 AI 服务商的 API Key
 * @param providerId 服务商 ID
 * @returns Promise，删除完成时解析
 * @throws 调用 Tauri 命令失败时抛出异常
 */
export async function deleteApiKey(providerId: string): Promise<void> {
  await deleteSecret(apiKeyId(providerId))
}
