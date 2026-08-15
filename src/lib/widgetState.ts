/**
 * @file widgetState.ts
 * @description Widget 数据共享模块
 *
 * 实现桌面应用 ↔ 移动端 Widget 的数据同步（PRD §7.8.2：iOS/Android Widget 显示宠物状态、快捷喂食）
 *
 * 架构：
 * - 主应用写入 JSON 到共享存储（appDataDir/widget_state.json）
 * - Widget 读取同一路径获取最新状态
 * - Widget 点击通过 Deep Link (spiritpal://feed?item_id=xxx) 回到主应用
 *
 * 数据格式（JSON）：
 * {
 *   hp: number,           // 饱食度 0-100
 *   mood: number,         // 心情 0-100
 *   level: number,        // 等级 1-256
 *   affection: number,    // 亲密度 0-9999
 *   coins: number,        // 金币
 *   characterName: string, // 角色名
 *   lastInteraction: number, // 上次交互时间戳
 *   updatedAt: number     // 数据更新时间戳
 * }
 *
 * 主要模块：
 * - WidgetState: Widget 状态接口
 * - WidgetDeepLink: Deep Link 解析结果接口
 * - parseWidgetDeepLink(): 解析 Widget Deep Link
 * - syncWidgetState()/readWidgetState(): 状态读写
 * - buildWidgetStateFromPetStore(): 从 petStore 构建状态
 * - handleWidgetDeepLink(): 处理 Deep Link 动作
 * - startWidgetAutoSync()/stopWidgetAutoSync(): 自动同步
 *
 * 依赖关系：
 * - @tauri-apps/api/core: Tauri invoke API
 */

import { invoke } from '@tauri-apps/api/core'

// ============ Widget 状态接口 ============

/**
 * Widget 状态接口
 * 定义桌面/移动端 Widget 显示所需的宠物状态数据
 */
export interface WidgetState {
  /** 饱食度 0-100 */
  hp: number
  /** 心情 0-100 */
  mood: number
  /** 等级 1-256 */
  level: number
  /** 亲密度 0-9999 */
  affection: number
  /** 金币 */
  coins: number
  /** 角色名称（内部 ID） */
  characterName: string
  /** 角色显示名称 */
  characterDisplayName: string
  /** 角色 emoji/图标（根据等级自动生成） */
  characterIcon: string
  /** 上次交互时间戳（ms） */
  lastInteraction: number
  /** 数据更新时间戳（ms） */
  updatedAt: number
}

// ============ Deep Link 路由 ============

/**
 * Widget Deep Link 解析结果接口
 */
export interface WidgetDeepLink {
  /** 动作类型 */
  action: 'feed' | 'pet' | 'open_chat' | 'open_settings'
  /** 物品 ID（仅 feed 动作） */
  itemId?: string
}

/**
 * 解析 Widget Deep Link URL
 *
 * 支持格式：
 * - spiritpal://feed?item_id=apple
 * - spiritpal://pet
 * - spiritpal://open_chat
 * - spiritpal://open_settings
 *
 * @param url Deep Link URL
 * @returns 解析结果，格式错误返回 null
 */
export function parseWidgetDeepLink(url: string): WidgetDeepLink | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'spiritpal:') return null

    const action = parsed.hostname || parsed.pathname.replace(/^\//, '')
    const itemId = parsed.searchParams.get('item_id') ?? undefined

    switch (action) {
      case 'feed':
        return { action: 'feed', itemId }
      case 'pet':
        return { action: 'pet' }
      case 'open_chat':
        return { action: 'open_chat' }
      case 'open_settings':
        return { action: 'open_settings' }
      default:
        return null
    }
  } catch {
    return null
  }
}

// ============ 状态管理 ============

/**
 * 将当前宠物状态写入 Widget 共享文件
 *
 * 调用时机：宠物状态变化后（HP/FV 变化、交互完成、角色切换等）
 *
 * 实现方式：
 * - Desktop: 写入 appDataDir/widget_state.json
 * - Android: 通过 Tauri 插件写入 SharedPreferences 或文件
 * - iOS: 通过 App Group 共享 UserDefaults
 *
 * @param state Widget 状态数据
 */
export async function syncWidgetState(state: WidgetState): Promise<void> {
  try {
    // 使用 Tauri invoke 调用 Rust 后端写入共享文件
    await invoke('sync_widget_state', { state: JSON.stringify(state) })
  } catch (e) {
    // Widget 同步失败不应阻断主应用，静默忽略
    console.warn('[widgetState] syncWidgetState failed:', e)
  }
}

/**
 * 从共享存储读取 Widget 状态
 * 用于调试或主应用启动时恢复状态
 * @returns Widget 状态，不存在或失败时返回 null
 */
export async function readWidgetState(): Promise<WidgetState | null> {
  try {
    const raw = await invoke<string>('read_widget_state')
    if (!raw) return null
    return JSON.parse(raw) as WidgetState
  } catch {
    return null
  }
}

/**
 * 从 petStore 数据构建 Widget 状态
 *
 * 自动从 Zustand store 提取当前宠物状态并格式化为 Widget 所需格式
 * 根据等级自动生成对应 emoji 图标：
 * - Lv1+: ⭐
 * - Lv16+: 🌙
 * - Lv64+: ☀️
 * - Lv256+: 👑
 *
 * @param pet 宠物状态数据（来自 petStore）
 * @returns 格式化后的 Widget 状态
 */
export function buildWidgetStateFromPetStore(pet: {
  hunger: number
  mood: number
  level: number
  affection: number
  coins: number
  characterName: string
  characterDisplayName: string
  lastInteractionAt: number
}): WidgetState {
  // 根据等级生成 emoji 图标
  let icon = '🐱'
  if (pet.level >= 256) icon = '👑'
  else if (pet.level >= 64) icon = '☀️'
  else if (pet.level >= 16) icon = '🌙'
  else if (pet.level >= 1) icon = '⭐'

  return {
    hp: Math.round(pet.hunger),
    mood: Math.round(pet.mood),
    level: pet.level,
    affection: Math.round(pet.affection),
    coins: pet.coins,
    characterName: pet.characterName,
    characterDisplayName: pet.characterDisplayName,
    characterIcon: icon,
    lastInteraction: pet.lastInteractionAt,
    updatedAt: Date.now(),
  }
}

// ============ Deep Link 处理器 ============

/**
 * 处理来自 Widget 的 Deep Link
 *
 * 支持的动作：
 * - feed: 喂食（需要 itemId 参数）
 * - pet: 摸头（激活宠物窗口）
 * - open_chat: 打开聊天窗口
 * - open_settings: 打开设置窗口
 *
 * 应在应用启动时注册 URL scheme 处理器
 *
 * @param url Deep Link URL
 * @returns 是否成功处理
 */
export async function handleWidgetDeepLink(url: string): Promise<boolean> {
  const link = parseWidgetDeepLink(url)
  if (!link) return false

  switch (link.action) {
    case 'feed': {
      // 触发喂食动作
      if (link.itemId) {
        const { invoke: inv } = await import('@tauri-apps/api/core')
        await inv('feed_pet_from_widget', { itemId: link.itemId })
      }
      return true
    }
    case 'pet': {
      // 激活宠物窗口
      const { invoke: inv } = await import('@tauri-apps/api/core')
      await inv('show_pet_window')
      return true
    }
    case 'open_chat': {
      // 打开聊天窗口
      const { invoke: inv } = await import('@tauri-apps/api/core')
      await inv('open_chat_window')
      return true
    }
    case 'open_settings': {
      // 打开设置窗口
      const { invoke: inv } = await import('@tauri-apps/api/core')
      await inv('open_settings_window')
      return true
    }
  }
}

// ============ 自动同步监听器 ============

/** 自动同步定时器 */
let syncInterval: ReturnType<typeof setInterval> | null = null

/**
 * 启动自动同步监听器
 *
 * 定时将最新状态同步到 Widget，建议在应用启动时调用
 * 立即同步一次，然后按指定间隔定时同步
 *
 * @param getState 获取最新状态的函数
 * @param intervalMs 同步间隔（毫秒），默认 30 秒
 */
export function startWidgetAutoSync(
  getState: () => WidgetState,
  intervalMs = 30_000,
): void {
  // 清除之前的监听器
  stopWidgetAutoSync()

  // 立即同步一次
  syncWidgetState(getState()).catch(() => {})

  // 定时同步
  syncInterval = setInterval(() => {
    syncWidgetState(getState()).catch(() => {})
  }, intervalMs)
}

/**
 * 停止自动同步监听器
 */
export function stopWidgetAutoSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval)
    syncInterval = null
  }
}
