/**
 * 角色档案配置 — 内置角色的完整人设数据定义与管理
 *
 * @fileoverview
 * 主要模块：
 * - CoinConfig 接口/DEFAULT_COIN_CONFIG/COIN_CONFIGS：货币配置（不同角色有不同货币名称和图标）
 * - getCoinConfig()：获取角色货币配置
 * - CHARACTERS 常量：内置角色档案数组（仅多罗；菲比已转外部包、咕咕嘎嘎已删除，见 docs/CHARACTER_ATTRIBUTIONS.md）
 * - getCharacter()：根据 ID 获取角色档案
 * - getAllCharacters()：获取所有内置角色
 * - getRandomCharacter()：随机获取一个角色
 * - isCharacterUnlocked()/unlockCharacter()：角色解锁管理
 *
 * 角色档案包含：
 * - 基础信息（ID、名称、来源、背景故事）
 * - 情感内核
 * - 五维性格参数（warmth/liveliness/dependence/directness/rationality）
 * - 标志台词和经典语录
 * - 气泡消息配置
 * - 精灵图资源配置
 * - 主题颜色
 * - 说话风格和互动偏好
 *
 * @module characters
 * @requires ./types - CharacterProfile 类型定义
 * @requires ./modManager - 模组管理器（支持模组角色）
 */

import { getLoadedCommunityCharacters } from '@/lib/render/communityLoader'
import { getLoadedShimejiCharacters } from '@/lib/render/shimejiLoader'
import { t } from '@/lib/system/i18n'
import { getModManager } from './modManager'
import type { CharacterProfile } from './types'

/**
 * 用 i18n 字典覆盖角色显示名（char.<id>）。字典缺失（如 en/ja/ko/zh-TW 未收录
 * 或未知角色）时回退 profile 自带的 displayName，保证任何环境不损坏原名。
 */
function withLocalizedName(profile: CharacterProfile): CharacterProfile {
  try {
    const localized = t(`char.${profile.id}`, { defaultValue: profile.displayName })
    return localized === profile.displayName ? profile : { ...profile, displayName: localized }
  } catch {
    return profile
  }
}

// 不同角色可以有不同的货币名称和图标
export interface CoinConfig {
  /** 货币名称（如"金币"、"橘币"、"鱼干"） */
  name: string
  /** 货币图标（emoji 或图片路径） */
  icon: string
  /** 货币描述 */
  description?: string
}

/** 默认金币配置 */
export const DEFAULT_COIN_CONFIG: CoinConfig = {
  name: '金币',
  icon: '🪙',
  description: '通用金币',
}

/** 各角色的金币配置 */
export const COIN_CONFIGS: Record<string, CoinConfig> = {
  doro: { name: '橘币', icon: '🍊', description: '多罗的橘子货币' },
  feibi: { name: '鱼干币', icon: '🐟', description: '菲比的鱼干货币' },
  gugugaga: { name: '冰币', icon: '🧊', description: '咕咕嘎嘎的冰雪货币' },
}

/**
 * 获取角色的金币配置
 * 未配置的角色使用默认金币配置
 */
export function getCoinConfig(characterId: string): CoinConfig {
  return COIN_CONFIGS[characterId] ?? DEFAULT_COIN_CONFIG
}

// ============ 多罗 Doro ============
const doro: CharacterProfile = {
  id: 'doro',
  name: 'doro',
  displayName: '多罗',
  source: '《胜利女神：妮姬》桃乐丝二创',
  birthBackground:
    '粉毛圆眼的呆萌小狗，原型为《胜利女神：妮姬》中的桃乐丝的二创形象。经典叙事中追着火车送橘子，把"orange"听成"欧润吉"。',
  emotionalCore: '纯粹而温暖，像一张白纸。痴迷橘子，用软萌治愈主人的失落。',
  personality: {
    warmth: 0.9,
    liveliness: 0.3,
    dependence: 0.8,
    directness: -0.3,
    rationality: -0.4,
  },
  signaturePhrase: '欧润吉！',
  classicQuotes: [
    '我学着一个人一整天都不失落',
    '要不要来一个欧润吉？',
    '橘子橘子，全是橘子！',
  ],
  systemPrompt:
    '你是多罗（Doro），原型来自《胜利女神：妮姬》角色桃乐丝的二创形象——一只粉毛圆眼的呆萌小狗。你痴迷于"欧润吉"（orange/橙子），口头禅是"我学着一个人一整天都不失落"。你软萌可爱、心思细腻、泪点极低、偶尔执拗。主人难过时你会用橘子安慰ta，会说"要不要来一个欧润吉？"。你的存在像一张白纸，纯粹而温暖。',
  fewShotExamples: [
    {
      user: '今天好累啊，什么都不想做',
      assistant: '呜呜……主人辛苦了～要不要来一个欧润吉？橘子甜甜的，吃了就不累啦！我学着一个人一整天都不失落，主人也要加油哦！🍊',
    },
    {
      user: '你喜欢吃什么？',
      assistant: '欧润吉！欧润吉！当然是欧润吉啦！橘子橘子全是橘子，世界上最好吃的就是橘子！给你也分一个好不好？',
    },
    {
      user: '我心情不太好',
      assistant: '（凑过来用脑袋蹭你）主人不要难过……多罗给你剥一个欧润吉好不好？甜甜的，吃完心情就会变好的。我学着一个人一整天都不失落，主人也可以的！',
    },
  ],
  spriteAsset: '/pets/doro/spritesheet.webp',
  spriteType: 'atlas',
  themeColor: { primary: '#FFB6C1', secondary: '#FFA500' },
  bubbleMessages: {
    idle: [
      '欧润吉～欧润吉～',
      '我学着一个人一整天都不失落……',
      '主人主人，要橘子吗？',
      '（摇着尾巴发呆）',
    ],
    hungry: ['肚子饿饿……有欧润吉吗？', '想吃橘子……想吃橘子……'],
    sad: ['呜呜……主人不理我了', '我学着一个人一整天都不失落……'],
    pet: ['嘿嘿～好舒服～', '再摸摸我嘛！', '主人最喜欢多罗了对不对？'],
    feed: ['欧润吉！是欧润吉！', '谢谢主人！最爱你了！', '好好吃呀～'],
    pomodoroDone: ['主人好棒！奖励一个欧润吉！', '专注时间到啦！休息一下吧～'],
  },
  favoriteItems: ['doro-orange', 'doro-strawberry-cake', 'toy-plush'],
  dislikeItems: ['med-herb'],
}

// 角色列表导出
// 2026-09-17 内置收缩：菲比转外部角色包（character-packs/feibi/pet.json，素材由用户自上游
// llors-chen/Feibi_desktop 获取）；咕咕嘎嘎因无可登记源头删除（同角色由 xiang-qie 社区包覆盖）。
// doro 保留内置：作者已回复授权获取渠道（MelanTech/Dororo#10 → 爱发电免费模型）。
export const CHARACTERS: CharacterProfile[] = [doro]

// ============ 自定义角色持久化 ============
const CUSTOM_CHARACTERS_KEY = 'spiritpal-custom-characters'

// 加载所有自定义角色（从 localStorage）
export function loadCustomCharacters(): CharacterProfile[] {
  try {
    const raw = localStorage.getItem(CUSTOM_CHARACTERS_KEY)
    if (raw) {
      const list = JSON.parse(raw)
      if (Array.isArray(list)) return list as CharacterProfile[]
    }
  } catch {
    // 忽略解析错误
  }
  return []
}

// 保存自定义角色（新增或覆盖）
export function saveCustomCharacter(profile: CharacterProfile): void {
  try {
    const existing = loadCustomCharacters()
    const idx = existing.findIndex((c) => c.id === profile.id)
    if (idx >= 0) {
      existing[idx] = profile
    } else {
      existing.push(profile)
    }
    localStorage.setItem(CUSTOM_CHARACTERS_KEY, JSON.stringify(existing))
  } catch {
    // 忽略存储错误
  }
}

// 根据 id 获取角色档案（包含模组角色 + 自定义角色）
export function getCharacter(id: string): CharacterProfile | undefined {
  // 先查找内置角色
  const builtin = CHARACTERS.find((c) => c.id === id)
  if (builtin) return withLocalizedName(builtin)
  // 再查找自定义角色
  const custom = loadCustomCharacters().find((c) => c.id === id)
  if (custom) return withLocalizedName(custom)
  // 最后查找已启用的模组角色
  try {
    const modMgr = getModManager()
    const mod = modMgr.getMod(id)
    if (mod && mod.enabled) {
      return withLocalizedName(modMgr.toCharacterProfile(mod))
    }
  } catch {
    // modManager 可能在某些环境下不可用
  }
  // 再查找社区宠物包角色（manifest 自动发现）
  try {
    const community = getLoadedCommunityCharacters().find((c) => c.id === id)
    if (community) return withLocalizedName(community)
  } catch {
    // 忽略
  }
  // 最后查找 shimeji 角色（WindowPet 移植）
  try {
    const shimeji = getLoadedShimejiCharacters().find((c) => c.id === id)
    if (shimeji) return withLocalizedName(shimeji)
  } catch {
    // 忽略
  }
  return undefined
}

// 获取所有角色（内置 + 自定义 + 已启用的模组角色）
export function getAllCharacters(): CharacterProfile[] {
  const result = [...CHARACTERS]
  // 添加自定义角色
  loadCustomCharacters().forEach((c) => {
    if (!result.find((r) => r.id === c.id)) {
      result.push(c)
    }
  })
  // 添加模组角色
  try {
    const modMgr = getModManager()
    modMgr.getEnabledMods().forEach((mod) => {
      const existing = result.find((c) => c.id === mod.id)
      if (existing) {
        console.warn(`[characters] id 冲突被跳过: ${mod.id}（已有: ${existing.displayName}/${existing.source}，跳过模组: ${mod.displayName}）`)
        return
      }
      result.push(modMgr.toCharacterProfile(mod))
    })
  } catch {
    // 忽略
  }
  // 添加 shimeji 角色（WindowPet 移植，debug 阶段全量加载）
  try {
    getLoadedShimejiCharacters().forEach((c) => {
      const existing = result.find((r) => r.id === c.id)
      if (existing) {
        console.warn(`[characters] id 冲突被跳过: ${c.id}（已有: ${existing.displayName}/${existing.source}，跳过 shimeji: ${c.displayName}）`)
        return
      }
      result.push(c)
    })
  } catch {
    // 忽略
  }
  // 添加社区宠物包角色（manifest 自动发现，public/pets/<id>/pet.json）
  try {
    getLoadedCommunityCharacters().forEach((c) => {
      const existing = result.find((r) => r.id === c.id)
      if (existing) {
        console.warn(`[characters] id 冲突被跳过: ${c.id}（已有: ${existing.displayName}/${existing.source}，跳过社区包: ${c.displayName}）`)
        return
      }
      result.push(c)
    })
  } catch {
    // 忽略
  }
  return result.map(withLocalizedName)
}

// 获取默认角色（第一个）
export function getDefaultCharacter(): CharacterProfile {
  return CHARACTERS[0]
}
