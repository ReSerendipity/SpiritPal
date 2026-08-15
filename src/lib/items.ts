/**
 * 游戏道具/物品配置模块
 *
 * @fileoverview 定义各角色专属食物、通用玩具、药品、装饰品等物品配置数据
 *
 * 主要模块：
 * - 角色专属食物: doroFoods, feibiFoods, gugugagaFoods 等
 * - 通用物品: 玩具、药品、装饰品、收藏品等
 * - 物品查询函数: 按角色/类型获取物品列表
 *
 * 依赖关系：
 * - types.ts: InventoryItem 类型定义
 * - characters.ts: 角色信息获取
 *
 * 核心接口：
 * - getItemsForCharacter(characterId): 获取指定角色可用物品
 * - getAllItems(): 获取所有物品列表
 * - getDefaultItems(): 获取初始默认物品
 *
 * 物品分类：
 * - food: 食物（恢复饱食度）
 * - toy: 玩具（恢复心情）
 * - medicine: 药品（恢复健康）
 * - accessory: 装饰品
 * - consumable: 消耗品
 * - collection: 收藏品
 */
import type { InventoryItem } from './types'
import { ItemType, type ItemRarity } from './types'
import { getCharacter } from './characters'

// ============ 各角色专属食物 ============
const doroFoods: InventoryItem[] = [
  {
    id: 'doro-orange',
    name: '欧润橘',
    icon: '🍊',
    type: 'food',
    hungerRestore: 20,
    moodRestore: 5,
    price: 8,
    count: 0,
    fvLock: 0,
    dropRate: 1.0,
    description: '多罗最爱的欧润橘！甜甜的～',
  },
  {
    id: 'doro-strawberry-cake',
    name: '草莓蛋糕',
    icon: '🍰',
    type: 'food',
    hungerRestore: 15,
    moodRestore: 10,
    price: 12,
    count: 0,
    fvLock: 1,
    dropRate: 0.8,
    description: '精致的草莓蛋糕，心情大好！',
  },
  {
    id: 'doro-chocolate',
    name: '巧克力',
    icon: '🍫',
    type: 'food',
    hungerRestore: 10,
    moodRestore: 6,
    price: 6,
    count: 0,
    fvLock: 0,
    dropRate: 1.0,
    description: '甜甜的巧克力～',
  },
]

const feibiFoods: InventoryItem[] = [
  {
    id: 'feibi-fish-dried',
    name: '鱼干',
    icon: '🐟',
    type: 'food',
    hungerRestore: 18,
    moodRestore: 4,
    price: 10,
    count: 0,
    fvLock: 0,
    dropRate: 1.0,
    description: '菲比最爱的鱼干～海风温和，丰满殷足',
  },
  {
    id: 'feibi-honey',
    name: '蜂蜜',
    icon: '🍯',
    type: 'food',
    hungerRestore: 12,
    moodRestore: 8,
    price: 8,
    count: 0,
    fvLock: 1,
    dropRate: 0.7,
    description: '甜甜的蜂蜜，修女也满足了呢',
  },
  {
    id: 'feibi-biscuit',
    name: '饼干',
    icon: '🍪',
    type: 'food',
    hungerRestore: 8,
    moodRestore: 4,
    price: 4,
    count: 0,
    fvLock: 0,
    dropRate: 1.0,
    description: '普通的饼干～',
  },
]

const gugugagaFoods: InventoryItem[] = [
  {
    id: 'gugugaga-small-fish',
    name: '小鱼',
    icon: '🐟',
    type: 'food',
    hungerRestore: 15,
    moodRestore: 5,
    price: 8,
    count: 0,
    fvLock: 0,
    dropRate: 1.0,
    description: '小企鹅最爱的小鱼～嘎嘎！',
  },
  {
    id: 'gugugaga-penguin-biscuit',
    name: '企鹅饼干',
    icon: '🐧',
    type: 'food',
    hungerRestore: 10,
    moodRestore: 8,
    price: 5,
    count: 0,
    fvLock: 0,
    dropRate: 1.0,
    description: '管理员专用企鹅饼干',
  },
  {
    id: 'gugugaga-hot-chocolate',
    name: '热巧克力',
    icon: '☕',
    type: 'food',
    hungerRestore: 12,
    moodRestore: 10,
    price: 7,
    count: 0,
    fvLock: 2,
    dropRate: 0.5,
    description: '暖暖的热巧克力，管理员有力量了！',
    buff: {
      effect: 'hp',
      value: 1,
      interval: 30,
      expiration: 120,
      description: '每30秒恢复1点饱食度，持续2分钟',
    },
  },
]

// 按角色 id 分组的食物
export const FOODS_BY_CHARACTER: Record<string, InventoryItem[]> = {
  doro: doroFoods,
  feibi: feibiFoods,
  gugugaga: gugugagaFoods,
}

// ============ 通用玩具 ============
export const TOYS: InventoryItem[] = [
  {
    id: 'toy-ball',
    name: '小皮球',
    icon: '⚽',
    type: 'toy',
    moodRestore: 25,
    price: 15,
    count: 0,
    fvLock: 0,
    dropRate: 1.0,
    description: '弹弹的小皮球，玩得好开心！',
  },
  {
    id: 'toy-plush',
    name: '毛绒玩具',
    icon: '🧸',
    type: 'toy',
    moodRestore: 20,
    price: 20,
    count: 0,
    fvLock: 1,
    dropRate: 0.6,
    description: '软软的毛绒玩具～',
  },
  {
    id: 'toy-puzzle',
    name: '益智拼图',
    icon: '🧩',
    type: 'toy',
    moodRestore: 15,
    price: 18,
    count: 0,
    fvLock: 2,
    dropRate: 0.4,
    description: '动动脑筋的益智拼图',
    buff: {
      effect: 'fv',
      value: 2,
      interval: 60,
      expiration: 300,
      description: '每60秒增加2点亲密度，持续5分钟',
    },
  },
]

// ============ 通用药品 ============
export const MEDICINES: InventoryItem[] = [
  {
    id: 'med-vitamin',
    name: '维生素',
    icon: '💊',
    type: 'medicine',
    healthRestore: 30,
    price: 25,
    count: 0,
    fvLock: 2,
    dropRate: 0.5,
    description: '高级维生素，健康大涨！',
  },
  {
    id: 'med-syrup',
    name: '糖浆',
    icon: '🧪',
    type: 'medicine',
    healthRestore: 20,
    moodRestore: 5,
    price: 18,
    count: 0,
    fvLock: 1,
    dropRate: 0.7,
    description: '甜甜的糖浆，心情也变好了',
  },
  {
    id: 'med-herb',
    name: '草药',
    icon: '🌿',
    type: 'medicine',
    healthRestore: 15,
    price: 12,
    count: 0,
    fvLock: 0,
    dropRate: 1.0,
    description: '天然草药，温和有效',
  },
  {
    id: 'med-first-aid',
    name: '急救包',
    icon: '🩹',
    type: 'medicine',
    healthRestore: 50,
    moodRestore: -5,
    price: 40,
    count: 0,
    fvLock: 3,
    dropRate: 0.3,
    description: '紧急治疗套装，回复大量健康但有点痛',
  },
  {
    id: 'med-herbal-tea',
    name: '草本茶',
    icon: '🍵',
    type: 'medicine',
    healthRestore: 10,
    moodRestore: 15,
    price: 15,
    count: 0,
    fvLock: 1,
    dropRate: 0.8,
    description: '安神草本茶，健康心情双恢复',
    buff: {
      effect: 'fv',
      value: 1,
      interval: 60,
      expiration: 180,
      description: '每60秒增加1点亲密度，持续3分钟',
    },
  },
]

// ============ 装饰品 ============
export const ACCESSORIES: InventoryItem[] = [
  {
    id: 'acc-bow',
    name: '蝴蝶结',
    icon: '🎀',
    type: 'accessory',
    moodRestore: 10,
    price: 30,
    count: 0,
    fvLock: 2,
    dropRate: 0.5,
    description: '可爱的蝴蝶结，心情大好！',
  },
  {
    id: 'acc-hat',
    name: '小帽子',
    icon: '🎩',
    type: 'accessory',
    moodRestore: 8,
    price: 35,
    count: 0,
    fvLock: 3,
    dropRate: 0.3,
    description: '帅气的小帽子，魅力十足',
  },
  {
    id: 'acc-scarf',
    name: '围巾',
    icon: '🧣',
    type: 'accessory',
    moodRestore: 5,
    healthRestore: 5,
    price: 25,
    count: 0,
    fvLock: 1,
    dropRate: 0.6,
    description: '暖暖的围巾，冬天必备',
  },
  {
    id: 'acc-glasses',
    name: '小眼镜',
    icon: '👓',
    type: 'accessory',
    moodRestore: 6,
    price: 28,
    count: 0,
    fvLock: 2,
    dropRate: 0.4,
    description: '斯文的小眼镜，看起来很聪明',
  },
  {
    id: 'acc-crown',
    name: '皇冠',
    icon: '👑',
    type: 'accessory',
    moodRestore: 20,
    price: 80,
    count: 0,
    fvLock: 5,
    dropRate: 0.1,
    description: '华丽的皇冠，只有最亲密的伙伴才能佩戴',
  },
]

// ============ 特殊收集品 ============
export const COLLECTIBLES: InventoryItem[] = [
  {
    id: 'col-star',
    name: '星星贴纸',
    icon: '⭐',
    type: 'collection',
    price: 10,
    count: 0,
    fvLock: 0,
    dropRate: 1.0,
    description: '收集闪亮的星星贴纸',
    fvReward: 5,
  },
  {
    id: 'col-gem',
    name: '宝石',
    icon: '💎',
    type: 'collection',
    price: 50,
    count: 0,
    fvLock: 4,
    dropRate: 0.2,
    description: '稀有宝石，珍贵收藏品',
    fvReward: 20,
  },
  {
    id: 'col-medal',
    name: '纪念章',
    icon: '🏅',
    type: 'collection',
    price: 30,
    count: 0,
    fvLock: 3,
    dropRate: 0.3,
    description: '纪念章，见证每一次成就',
    fvReward: 15,
  },
]

// ============ 对话物品（dialogue 类型）============
// 使用时触发特定对话树
export const DIALOGUE_ITEMS: InventoryItem[] = [
  {
    id: 'dlg-memory-book',
    name: '记忆之书',
    icon: '📖',
    type: 'dialogue',
    price: 20,
    count: 0,
    fvLock: 1,
    dropRate: 0.5,
    description: '翻开记忆之书，回忆与宠物的点点滴滴',
    dialogueTrigger: 'memory-book-dialogue',
    fvReward: 3,
  },
  {
    id: 'dlg-secret-letter',
    name: '秘密信件',
    icon: '✉️',
    type: 'dialogue',
    price: 35,
    count: 0,
    fvLock: 3,
    dropRate: 0.2,
    description: '一封神秘的信件，里面有宠物想说的话',
    dialogueTrigger: 'secret-letter-dialogue',
    fvReward: 8,
  },
  {
    id: 'dlg-dream-catcher',
    name: '捕梦网',
    icon: '🌀',
    type: 'dialogue',
    price: 40,
    count: 0,
    fvLock: 2,
    dropRate: 0.3,
    description: '捕获宠物的梦境，听听它梦到了什么',
    dialogueTrigger: 'dream-catcher-dialogue',
    fvReward: 5,
  },
]

// ============ 子宠物物品（subpet 类型）============
// 召唤一只小宠物陪伴主宠物
export const SUBPET_ITEMS: InventoryItem[] = [
  {
    id: 'subpet-mini-ghost',
    name: '小幽灵',
    icon: '👻',
    type: 'subpet',
    price: 50,
    count: 0,
    fvLock: 2,
    dropRate: 0.3,
    description: '召唤一只可爱的小幽灵在身边飘荡',
    subpetConfig: {
      spritePath: '/pets/subpets/mini-ghost.png',
      name: '小幽灵',
      scale: 0.4,
      behavior: 'wander',
      speed: 30,
      interactive: true,
    },
    fvReward: 2,
  },
  {
    id: 'subpet-firefly',
    name: '萤火虫',
    icon: '✨',
    type: 'subpet',
    price: 30,
    count: 0,
    fvLock: 1,
    dropRate: 0.5,
    description: '一只发光的萤火虫，照亮夜晚',
    subpetConfig: {
      spritePath: '/pets/subpets/firefly.png',
      name: '萤火虫',
      scale: 0.3,
      behavior: 'orbit',
      speed: 20,
      interactive: false,
    },
    fvReward: 1,
  },
  {
    id: 'subpet-little-cat',
    name: '小猫咪',
    icon: '🐱',
    type: 'subpet',
    price: 80,
    count: 0,
    fvLock: 4,
    dropRate: 0.1,
    description: '召唤一只小猫咪跟着宠物走',
    subpetConfig: {
      spritePath: '/pets/subpets/little-cat.png',
      name: '小猫咪',
      scale: 0.5,
      behavior: 'follow',
      speed: 40,
      duration: 600,
      interactive: true,
    },
    fvReward: 10,
  },
]

// cost = 50 × (fvLock + 1) —— 同类桌宠方案 的基础定价公式
export function getItemPrice(item: Omit<InventoryItem, 'price' | 'count'>): number {
  if (item.fvLock !== undefined) {
    return 50 * (item.fvLock + 1)
  }
  return 0
}

// 稀有度名称映射
export function getRarityName(fvLock: number | undefined): string {
  switch (fvLock) {
    case 0: return '普通'
    case 1: return '稀有'
    case 2: return '珍贵'
    case 3: return '史诗'
    case 4: return '传说'
    case 5: return '神话'
    default: return '普通'
  }
}

// favoriteItems 中的物品效果 ×2.0，dislikeItems 中的物品效果 ×0.5
export function getCharacterMultiplier(
  characterId: string,
  itemId: string,
): number {
  // 角色偏好定义在 characters.ts 的 CharacterProfile 中
  // 这里通过导入 characters 获取
  const char = getCharacter(characterId)
  if (!char) return 1.0
  if (char.favoriteItems?.includes(itemId)) return 2.0
  if (char.dislikeItems?.includes(itemId)) return 0.5
  return 1.0
}

// 根据角色 id 获取可购买食物列表
export function getFoodsForCharacter(characterId: string): InventoryItem[] {
  return FOODS_BY_CHARACTER[characterId] ?? []
}

// 获取所有可购买道具（食物 + 玩具 + 药品 + 装饰品 + 收集品 + 对话物品 + 陪伴宠物）
export function getAllShopItems(characterId: string): InventoryItem[] {
  return [
    ...getFoodsForCharacter(characterId),
    ...TOYS,
    ...MEDICINES,
    ...ACCESSORIES,
    ...COLLECTIBLES,
    ...DIALOGUE_ITEMS,
    ...SUBPET_ITEMS,
  ]
}

// ============ ITEM_DATABASE: 统一物品数据库 ============
//
// 将所有物品数组合并为一个 Record<string, InventoryItem>，
// 便于通过 id 快速查找物品、检查锁定状态、应用效果等。
// 同时补充 rarity、unlockable、tags 字段（基于 fvLock 自动推导）。

/**
 * 根据 fvLock 推导物品稀有度
 */
function deriveRarity(fvLock: number | undefined): ItemRarity {
  switch (fvLock) {
    case 0: return 'common'
    case 1: return 'rare'
    case 2: return 'epic'
    case 3: return 'legendary'
    case 4:
    case 5: return 'mythic'
    default: return 'common'
  }
}

/**
 * 根据物品类型和描述推导搜索标签
 */
function deriveTags(item: InventoryItem): string[] {
  const tags: string[] = []
  switch (item.type) {
    case 'food': tags.push('食物'); break
    case 'toy': tags.push('玩具'); break
    case 'medicine': tags.push('药品'); break
    case 'accessory': tags.push('装饰品'); break
    case 'collection': tags.push('收藏', '稀有'); break
    case 'dialogue': tags.push('对话', '角色'); break
    case 'subpet': tags.push('宠物'); break
  }
  if (item.fvReward) tags.push('亲密度')
  if (item.buff) tags.push('Buff')
  return tags
}

/**
 * 为物品补充 rarity、unlockable、tags 字段
 */
function enrichItem(item: InventoryItem): InventoryItem {
  return {
    ...item,
    rarity: item.rarity ?? deriveRarity(item.fvLock),
    unlockable: item.unlockable ?? (item.fvLock !== undefined && item.fvLock > 0),
    tags: item.tags ?? deriveTags(item),
  }
}

/**
 * 统一物品数据库
 *
 * 合并所有物品（角色专属食物 + 通用玩具/药品/装饰品/收集品/对话物品/副宠），
 * 以 id 为键，便于 O(1) 查找。
 * 每个物品已补充 rarity、unlockable、tags 元数据字段。
 */
export const ITEM_DATABASE: Record<string, InventoryItem> = (() => {
  const db: Record<string, InventoryItem> = {}

  // 收集所有物品（去重）
  const allRawItems: InventoryItem[] = [
    ...doroFoods,
    ...feibiFoods,
    ...gugugagaFoods,
    ...TOYS,
    ...MEDICINES,
    ...ACCESSORIES,
    ...COLLECTIBLES,
    ...DIALOGUE_ITEMS,
    ...SUBPET_ITEMS,
  ]

  for (const item of allRawItems) {
    if (!db[item.id]) {
      db[item.id] = enrichItem(item)
    }
  }

  return db
})()

/**
 * 根据 id 从数据库获取物品
 * @param id 物品 ID
 * @returns 物品对象，不存在返回 undefined
 */
export function getItemById(id: string): InventoryItem | undefined {
  return ITEM_DATABASE[id]
}

/**
 * 获取所有收藏品类物品
 */
export function getCollectionItems(): InventoryItem[] {
  return Object.values(ITEM_DATABASE).filter((item) => item.type === ItemType.COLLECTION)
}

/**
 * 获取所有对话类物品
 */
export function getDialogueItems(): InventoryItem[] {
  return Object.values(ITEM_DATABASE).filter((item) => item.type === ItemType.DIALOGUE)
}

/**
 * 获取所有副宠类物品
 */
export function getSubpetItems(): InventoryItem[] {
  return Object.values(ITEM_DATABASE).filter((item) => item.type === ItemType.SUBPET)
}
