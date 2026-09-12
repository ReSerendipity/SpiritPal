/**
 * @file communityLoader.ts
 * @description 社区宠物包加载器 — 通过 manifest 自动发现 public/pets/<id>/pet.json 并批量加载
 *
 * 主要功能：
 * - loadCommunityCharacters(): 异步调用 CharacterResourceLoader.discoverPacks() 发现宠物包，
 *   再逐只 loadPack() 规范化为 CharacterProfile（模板人设/许可证校验/重采样由 loadPack 完成）
 * - getLoadedCommunityCharacters(): 同步返回已缓存角色
 *
 * 设计模式：仿 shimejiLoader（启动时异步预热模块级缓存 + getAllCharacters 同步合并），
 * 内置角色优先，社区宠物包按 id 去重合并进统一角色列表。
 */

import type { CharacterProfile } from '@/lib/data/types'
import { getCharacterResourceLoader } from './characterResourceLoader'

// ============ 缓存 ============
/** 已加载社区宠物缓存（null = 尚未加载） */
let communityCache: CharacterProfile[] | null = null

/**
 * 加载所有社区宠物包角色（幂等：已加载直接返回缓存）
 * 失败静默返回空数组，不阻塞启动
 * @returns Promise，解析为角色配置数组
 */
export async function loadCommunityCharacters(): Promise<CharacterProfile[]> {
  if (communityCache) return communityCache
  try {
    const loader = getCharacterResourceLoader()
    const packs = await loader.discoverPacks()
    const results = await Promise.all(packs.map((p) => loader.loadPack(p.id)))
    communityCache = results.filter((p): p is CharacterProfile => p !== null)
  } catch (e) {
    console.error('[communityLoader] failed:', e)
    communityCache = []
  }
  return communityCache
}

/**
 * 同步获取已加载的社区宠物角色（不触发网络请求）
 * @returns 已缓存的角色配置数组
 */
export function getLoadedCommunityCharacters(): CharacterProfile[] {
  return communityCache ?? []
}

/**
 * 获取单个社区宠物角色
 * @param id 角色 ID
 * @returns 角色配置，未找到返回 undefined
 */
export function getCommunityCharacter(id: string): CharacterProfile | undefined {
  return getLoadedCommunityCharacters().find((c) => c.id === id)
}
