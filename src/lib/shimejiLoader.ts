/**
 * @file shimejiLoader.ts
 * @description Shimeji 角色加载器模块 — 加载 WindowPet 移植的角色资源
 *
 * 主要功能：
 * - 加载 WindowPet 移植的 shimeji 角色 profile
 * - 支持 Vite 静态枚举（import.meta.glob）和 fetch 动态加载两种方式
 * - 自动规范化 profile 字段，补全 SpiritPal 必需字段
 * - 转换 spriteAsset 路径为 Tauri 资源路径
 * - 提供人工审核排除列表，过滤版权争议角色
 *
 * 主要模块：
 * - loadShimejiCharacters(): 加载所有 shimeji 角色
 * - loadFromPublicDir(): 从 public 目录 fetch 加载（回退方案）
 * - normalizeShimejiProfile(): 规范化 profile 字段
 * - getLoadedShimejiCharacters(): 同步获取已加载角色
 *
 * 依赖关系：
 * - ./types: CharacterProfile 类型定义
 * - @tauri-apps/api/path: 获取 Tauri 资源目录
 * - @tauri-apps/api/core: convertFileSrc 转换
 *
 * 核心接口：
 * - loadShimejiCharacters(): 异步加载所有角色
 * - getLoadedShimejiCharacters(): 同步获取已缓存角色
 * - getShimejiCharacter(): 获取单个角色
 *
 * Phase 1.6: 将 shimeji profiles 加载为可用角色
 * 参考仓库：WindowPet（MIT 许可，仅代码与配置，形象版权由人工审核流程把关）
 *
 * 注意：profiles 中的角色在 debug 阶段全部加载，正式发布前需经人工审核
 * 过滤掉形象版权存在争议的 IP 角色（见 AUDIT_EXCLUDE 列表）
 */

import type { CharacterProfile } from './types'

// ============ 人工审核排除列表 ============
// debug 阶段保留在资源目录，但不在角色选择列表中加载
// 正式发布前由人工审核决定去留
/** 人工审核排除列表 — 版权争议角色 ID */
const AUDIT_EXCLUDE = new Set<string>([
  // 在此追加需排除的 IP 角色 id（如 'hu-tao', 'zhongli-ys' 等）
  // 当前为空，debug 阶段全量加载
])

// ============ Vite 静态枚举（构建时收集所有 profile 文件）============
// 使用 import.meta.glob 在编译期枚举 src/assets/shimeji-profiles/*.json
/** Vite 编译期枚举的 profile 模块 */
const profileModules = import.meta.glob('../assets/shimeji-profiles/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, CharacterProfile>

// ============ 已知 shimeji profile 回退列表 ============
// 当不存在打包模块时使用（public/pets/shimeji/profiles/manifest.json 优先）
/** 已知 shimeji 角色 ID 列表（回退方案） */
const KNOWN_SHIMEJI_IDS = [
  '68', 'albedo', 'ayaka', 'blooky-shimeji', 'childe', 'chongyun', 'dearla',
  'electro-childe', 'ganyu', 'gengar-shimeji', 'growlithe', 'honey-churros',
  'hu-tao', 'jotaro', 'kamado-nezuko', 'kazuha-xll', 'kazuha', 'kizuna-ai-ver1',
  'klee', 'kuro', 'lavender-town-ghost', 'lumine-xll', 'marisa', 'nahida',
  'punishing-bird', 'puro-the-latex-wolf-shimeji', 'pusheen', 'rosaria-xll',
  'sanji', 'shimeji-caneko', 'shimeji-germouser', 'shimeji-koreacat',
  'shimeji-nekojapan', 'shimeji-turkat', 'slugcat', 'spider-man', 'spongebob',
  'starphin-shimeji', 'tamamo', 'the-chosen-one', 'the-king', 'thoma',
  'venti-ys', 'xiaocat', 'xingqiu-xll', 'yoimiya-ys', 'yuan-ji', 'zhongli-1',
  'zhongli-ys', 'zuo-ci',
]

// ============ Tauri 资源路径前缀 ============
// shimeji 资源已移至 Tauri resources 目录，需要 convertFileSrc 转换
/** Tauri 资源基础路径缓存 */
let _tauriResourceBase: string | null | undefined = undefined

/**
 * 获取 Tauri 资源基础路径
 * @returns Tauri 资源基础路径（经 convertFileSrc 转换），非 Tauri 环境返回 null
 */
async function getTauriResourceBase(): Promise<string | null> {
  if (_tauriResourceBase !== undefined) return _tauriResourceBase ?? null
  try {
    const { resourceDir } = await import('@tauri-apps/api/path')
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    const resDir = await resourceDir()
    _tauriResourceBase = convertFileSrc(resDir)
    return _tauriResourceBase
  } catch {
    _tauriResourceBase = null
    return null
  }
}

// ============ 缓存 ============
/** 已加载角色缓存 */
let shimejiCache: CharacterProfile[] | null = null

/**
 * 加载所有 shimeji 角色 profile
 * 优先从已打包的 JSON 模块读取（import.meta.glob），
 * 回退到 /pets/shimeji/profiles/ 的 fetch 加载
 * @returns Promise，解析为角色配置数组
 */
export async function loadShimejiCharacters(): Promise<CharacterProfile[]> {
  if (shimejiCache) return shimejiCache

  let profiles: CharacterProfile[]

  if (Object.keys(profileModules).length > 0) {
    profiles = await Promise.all(
      Object.values(profileModules)
        .filter((p) => p && p.id && !AUDIT_EXCLUDE.has(p.id))
        .map((p) => normalizeShimejiProfile(p))
    )
  } else {
    profiles = await loadFromPublicDir()
  }

  shimejiCache = profiles
  return profiles
}

/**
 * 从 Tauri resources 或 public 目录 fetch 加载（回退方案）
 * 尝试加载 manifest.json 获取 ID 列表，或使用 KNOWN_SHIMEJI_IDS 回退
 * @returns Promise，解析为角色配置数组
 */
async function loadFromPublicDir(): Promise<CharacterProfile[]> {
  try {
    // 尝试从 Tauri resourceDir 加载（shimeji 资源已移至 Tauri resources）
    let basePath = '/pets/shimeji/profiles'
    try {
      const { resourceDir } = await import('@tauri-apps/api/path')
      const { convertFileSrc } = await import('@tauri-apps/api/core')
      const resDir = await resourceDir()
      basePath = convertFileSrc(resDir + 'pets/shimeji/profiles')
    } catch {
      // 非 Tauri 环境回退到 public 目录
    }

    const manifest = await fetch(`${basePath}/manifest.json`)
      .then((r) => (r.ok ? (r.json() as Promise<{ ids: string[] }>) : null))
      .catch(() => null)

    const ids = manifest?.ids ?? KNOWN_SHIMEJI_IDS
    const results = await Promise.all(
      ids
        .filter((id) => !AUDIT_EXCLUDE.has(id))
        .map(async (id) => {
          const res = await fetch(`${basePath}/${id}.json`)
          if (!res.ok) return null
          const data = (await res.json()) as CharacterProfile
          return normalizeShimejiProfile(data)
        }),
    )
    return results.filter((p): p is CharacterProfile => p !== null)
  } catch {
    return []
  }
}

/**
 * 规范化 shimeji profile：补全 SpiritPal 必需字段
 * data 中的字段优先，缺失时回退到默认值
 * 同时将 spriteAsset 路径转换为 Tauri 资源路径（如已移至 resources 目录）
 * @param data 原始 profile 数据
 * @returns Promise，解析为规范化后的 CharacterProfile
 */
async function normalizeShimejiProfile(data: CharacterProfile): Promise<CharacterProfile> {
  // 转换 spriteAsset 路径：/pets/shimeji/xxx → Tauri 资源路径
  let spriteAsset = data.spriteAsset ?? ''
  if (spriteAsset.startsWith('/pets/')) {
    const resourceBase = await getTauriResourceBase()
    if (resourceBase) {
      spriteAsset = resourceBase + 'pets/' + spriteAsset.slice('/pets/'.length)
    }
  }

  return {
    ...data,
    spriteAsset,
    source: data.source ?? 'WindowPet',
    spriteType: data.spriteType ?? 'atlas',
    type: data.type ?? 'community',
    themeColor: data.themeColor ?? { primary: '#4ECDC4', secondary: '#FF6B6B' },
    bubbleMessages: data.bubbleMessages ?? {
      idle: ['…'],
      hungry: ['有点饿了'],
      sad: ['呜…'],
      pet: ['好舒服~'],
      feed: ['谢谢！'],
      pomodoroDone: ['休息一下~'],
    },
    atlasLayout: data.atlasLayout ?? { cellW: 128, cellH: 128, cols: 8, rows: 9 },
  }
}

/**
 * 同步获取已加载的 shimeji 角色（不触发网络请求）
 * @returns 已缓存的角色配置数组
 */
export function getLoadedShimejiCharacters(): CharacterProfile[] {
  return shimejiCache ?? []
}

/**
 * 获取单个 shimeji 角色
 * @param id 角色 ID
 * @returns 角色配置，未找到返回 undefined
 */
export function getShimejiCharacter(id: string): CharacterProfile | undefined {
  return getLoadedShimejiCharacters().find((c) => c.id === id)
}
