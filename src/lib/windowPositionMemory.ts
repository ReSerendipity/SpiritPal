/**
 * @file windowPositionMemory.ts
 * @description 窗口位置记忆模块
 *
 * 参考 clawd-on-desk 的窗口位置恢复机制实现
 * 支持多显示器环境下的窗口位置保存与恢复，自动处理屏幕边界检测
 *
 * 核心机制：
 * 1. 保存宠物窗口位置到持久化存储（tauri-plugin-store，降级到 localStorage）
 * 2. 应用启动时恢复上次位置
 * 3. 如果保存的位置在屏幕外（显示器断开、分辨率变更），自动钳制到最近的可见位置
 * 4. 防抖保存（500ms），避免频繁写入
 * 5. tauri-plugin-store 不可用时自动降级到 localStorage
 *
 * 主要模块：
 * - SavedWindowPosition: 保存的窗口位置数据接口
 * - saveWindowPosition(): 防抖保存窗口位置
 * - saveWindowPositionImmediate(): 立即保存窗口位置（应用退出时用）
 * - loadWindowPosition(): 读取保存的窗口位置
 * - restoreWindowPosition(): 恢复窗口位置（带离屏检测）
 * - startPositionTracking(): 启动窗口位置自动跟踪
 * - initPetWindowPosition(): 初始化宠物窗口位置记忆
 *
 * 依赖关系：
 * - @tauri-apps/api/window: Tauri 窗口 API
 * - @tauri-apps/plugin-store: Tauri 持久化存储插件
 * - ./multiMonitor: 多显示器工具函数（显示器枚举、位置检测）
 */

import { getAvailableMonitors, isPositionOnScreen, type MonitorInfo, type WindowPosition } from './multiMonitor'

// ============ 常量 ============

/** Store 文件名 */
const STORE_FILE = 'window-positions.json'

/** 保存位置键前缀 */
const POSITION_KEY_PREFIX = 'window-position:'

/** 保存位置防抖延迟（毫秒） */
const SAVE_DEBOUNCE_MS = 500

/** 默认宠物窗口宽度 */
const DEFAULT_PET_WIDTH = 300

/** 默认宠物窗口高度 */
const DEFAULT_PET_HEIGHT = 400

// ============ 类型定义 ============

/** 保存的窗口位置数据 */
export interface SavedWindowPosition {
  /** 窗口 X 坐标（逻辑像素） */
  x: number
  /** 窗口 Y 坐标（逻辑像素） */
  y: number
  /** 窗口宽度（逻辑像素） */
  width: number
  /** 窗口高度（逻辑像素） */
  height: number
  /** 保存时间戳 */
  savedAt: number
  /** 所在显示器名称 */
  monitorName?: string
}

// ============ Store 操作 ============

/**
 * 获取 tauri-plugin-store 实例
 * 使用延迟初始化，避免模块加载时就创建 store
 * tauri-plugin-store 不可用时返回 null，后续操作会降级到 localStorage
 * @returns Store 实例，不可用时返回 null
 */
let storeInstance: any = null

/**
 * 获取 tauri-plugin-store 实例（懒加载单例）
 * 首次调用时动态导入并加载 store 文件，失败时返回 null（降级到 localStorage）
 * @returns Store 实例，不可用时返回 null
 */
async function getStore(): Promise<any> {
  if (storeInstance) return storeInstance

  try {
    const { load } = await import('@tauri-apps/plugin-store')
    storeInstance = await load(STORE_FILE, { defaults: {}, autoSave: true })
    return storeInstance
  } catch (e) {
    console.warn('[WindowPositionMemory] tauri-plugin-store 不可用，使用 localStorage 降级:', e)
    return null
  }
}

/**
 * 从持久化存储读取值
 * 优先使用 tauri-plugin-store，失败时降级到 localStorage
 * @param key 存储键
 * @returns 存储的值，不存在时返回 null
 */
async function storeGet<T>(key: string): Promise<T | null> {
  try {
    const store = await getStore()
    if (store) {
      const value = (await store.get(key)) as T | null
      return value ?? null
    }
  } catch {
    // 降级到 localStorage
  }

  // localStorage 降级
  try {
    const raw = localStorage.getItem(`${STORE_FILE}:${key}`)
    if (raw) return JSON.parse(raw) as T
  } catch {
    // 忽略
  }
  return null
}

/**
 * 向持久化存储写入值
 * 优先使用 tauri-plugin-store，失败时降级到 localStorage
 * @param key 存储键
 * @param value 要存储的值（会被 JSON 序列化）
 */
async function storeSet<T>(key: string, value: T): Promise<void> {
  try {
    const store = await getStore()
    if (store) {
      await store.set(key, value)
      return
    }
  } catch {
    // 降级到 localStorage
  }

  // localStorage 降级
  try {
    localStorage.setItem(`${STORE_FILE}:${key}`, JSON.stringify(value))
  } catch {
    // 忽略
  }
}

// ============ 位置保存 ============

/** 防抖定时器映射 */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * 保存窗口位置（防抖）
 * 窗口移动/调整大小时频繁调用，使用防抖减少写入频率
 *
 * @param windowLabel 窗口标签
 * @param position 窗口位置
 * @param size 窗口尺寸
 * @param monitorName 所在显示器名称
 */
export function saveWindowPosition(
  windowLabel: string,
  position: WindowPosition,
  size: { width: number; height: number },
  monitorName?: string,
): void {
  const key = `${POSITION_KEY_PREFIX}${windowLabel}`

  // 清除之前的防抖定时器
  const existingTimer = debounceTimers.get(key)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  // 设置新的防抖定时器
  const timer = setTimeout(async () => {
    debounceTimers.delete(key)

    const data: SavedWindowPosition = {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      savedAt: Date.now(),
      monitorName,
    }

    try {
      await storeSet(key, data)
    } catch (e) {
      console.warn(`[WindowPositionMemory] 保存 ${windowLabel} 位置失败:`, e)
    }
  }, SAVE_DEBOUNCE_MS)

  debounceTimers.set(key, timer)
}

/**
 * 立即保存窗口位置（不带防抖）
 * 用于应用退出前的最终保存
 *
 * @param windowLabel 窗口标签
 * @param position 窗口位置
 * @param size 窗口尺寸
 */
export async function saveWindowPositionImmediate(
  windowLabel: string,
  position: WindowPosition,
  size: { width: number; height: number },
): Promise<void> {
  const key = `${POSITION_KEY_PREFIX}${windowLabel}`

  // 取消防抖定时器
  const existingTimer = debounceTimers.get(key)
  if (existingTimer) {
    clearTimeout(existingTimer)
    debounceTimers.delete(key)
  }

  const data: SavedWindowPosition = {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    savedAt: Date.now(),
  }

  await storeSet(key, data)
}

// ============ 位置恢复 ============

/**
 * 读取保存的窗口位置
 *
 * @param windowLabel 窗口标签
 * @returns 保存的位置，不存在时返回 null
 */
export async function loadWindowPosition(
  windowLabel: string,
): Promise<SavedWindowPosition | null> {
  const key = `${POSITION_KEY_PREFIX}${windowLabel}`
  return await storeGet<SavedWindowPosition>(key)
}

/**
 * 恢复窗口位置
 * 如果保存的位置在屏幕外（显示器断开、分辨率变更），回退到居中位置
 *
 * @param windowLabel 窗口标签
 * @param fallbackPosition 回退位置（默认居中偏下）
 * @returns 是否成功恢复到保存的位置
 */
export async function restoreWindowPosition(
  windowLabel: string,
  fallbackPosition?: WindowPosition,
): Promise<boolean> {
  const saved = await loadWindowPosition(windowLabel)
  if (!saved) {
    // 无保存位置，使用回退位置
    const fallback = fallbackPosition ?? await getDefaultPosition()
    await applyWindowPosition(windowLabel, fallback)
    return false
  }

  // 检查保存的位置是否在屏幕上可见
  const monitors = await getAvailableMonitors()
  const isOnScreen = isPositionOnScreen(
    { x: saved.x, y: saved.y },
    { width: saved.width, height: saved.height },
    monitors,
  )

  if (isOnScreen) {
    // 位置有效，恢复到保存的位置
    await applyWindowPosition(windowLabel, { x: saved.x, y: saved.y })
    return true
  }

  // 位置已不在任何显示器上（显示器断开或分辨率变更）
  // 尝试在主显示器上找到最近的可用位置
  const clampedPosition = await findNearestOnScreenPosition(saved, monitors)
  await applyWindowPosition(windowLabel, clampedPosition)
  return false
}

/**
 * 应用窗口位置
 * 查找指定标签的窗口并设置其位置，失败时静默忽略
 * @param windowLabel 窗口标签
 * @param position 目标位置（逻辑像素）
 */
async function applyWindowPosition(
  windowLabel: string,
  position: WindowPosition,
): Promise<void> {
  try {
    const { getAllWindows } = await import('@tauri-apps/api/window')
    const windows = await getAllWindows()
    const targetWindow = windows.find(w => w.label === windowLabel)

    if (targetWindow) {
      const { LogicalPosition } = await import('@tauri-apps/api/dpi')
      await targetWindow.setPosition(new LogicalPosition(position.x, position.y))
    }
  } catch (e) {
    console.warn(`[WindowPositionMemory] 应用 ${windowLabel} 位置失败:`, e)
  }
}

/**
 * 为离屏位置找到最近的屏幕内位置
 * 当保存的位置因显示器断开/分辨率变更而超出屏幕范围时，
 * 将坐标钳制到主显示器的可视范围内
 * @param saved 保存的窗口位置数据
 * @param monitors 可用显示器列表
 * @returns 钳制后的屏幕内位置
 */
async function findNearestOnScreenPosition(
  saved: SavedWindowPosition,
  monitors: MonitorInfo[],
): Promise<WindowPosition> {
  // 如果有多个显示器，尝试在任意显示器上找到位置
  if (monitors.length > 0) {
    const primary = monitors[0]
    return {
      // 钳制到主显示器范围内
      x: Math.max(primary.position.x, Math.min(saved.x, primary.position.x + primary.size.width - saved.width)),
      y: Math.max(primary.position.y, Math.min(saved.y, primary.position.y + primary.size.height - saved.height)),
    }
  }

  // 无显示器信息时，回退到默认位置
  return await getDefaultPosition(saved.width, saved.height)
}

/**
 * 获取默认居中位置
 * 宠物窗口默认居中偏下显示（距离底部约 100px，预留任务栏空间）
 * 无显示器信息时回退到 1920x1080 分辨率的默认位置
 * @param width 窗口宽度，默认 300
 * @param height 窗口高度，默认 400
 * @returns 默认位置坐标
 */
async function getDefaultPosition(
  width = DEFAULT_PET_WIDTH,
  height = DEFAULT_PET_HEIGHT,
): Promise<WindowPosition> {
  try {
    const monitors = await getAvailableMonitors()
    if (monitors.length > 0) {
      const primary = monitors[0]
      return {
        x: primary.position.x + (primary.size.width - width) / 2,
        // 偏下放置，距离底部约 100px（包含任务栏）
        y: primary.position.y + primary.size.height - height - 100,
      }
    }
  } catch {
    // 降级
  }

  // 最终降级
  return {
    x: (1920 - width) / 2,
    y: 1080 - height - 100,
  }
}

// ============ 自动位置跟踪 ============

/**
 * 启动窗口位置自动保存
 * 监听窗口移动和调整大小事件，自动保存位置
 *
 * @param windowLabel 窗口标签
 * @returns 取消跟踪函数
 */
export async function startPositionTracking(
  windowLabel: string,
): Promise<() => void> {
  const { getAllWindows } = await import('@tauri-apps/api/window')
  const windows = await getAllWindows()
  const targetWindow = windows.find(w => w.label === windowLabel)

  if (!targetWindow) {
    console.warn(`[WindowPositionMemory] 窗口 ${windowLabel} 不存在`)
    return () => {}
  }

  let unlistenMove: (() => void) | null = null
  let unlistenResize: (() => void) | null = null

  try {
    // 监听窗口移动
    const { listen } = await import('@tauri-apps/api/event')
    const moveEventName = `tauri://move/${windowLabel}`
    const resizeEventName = `tauri://resize/${windowLabel}`

    unlistenMove = await listen<{ x: number; y: number }>(moveEventName, async (event) => {
      try {
        const size = await targetWindow.innerSize()
        const scaleFactor = await targetWindow.scaleFactor()
        saveWindowPosition(windowLabel, event.payload, {
          width: size.width / scaleFactor,
          height: size.height / scaleFactor,
        })
      } catch {
        // 忽略
      }
    })

    unlistenResize = await listen<{ width: number; height: number }>(resizeEventName, async (event) => {
      try {
        const pos = await targetWindow.outerPosition()
        const scaleFactor = await targetWindow.scaleFactor()
        saveWindowPosition(windowLabel, {
          x: pos.x / scaleFactor,
          y: pos.y / scaleFactor,
        }, {
          width: event.payload.width / scaleFactor,
          height: event.payload.height / scaleFactor,
        })
      } catch {
        // 忽略
      }
    })
  } catch (e) {
    console.warn(`[WindowPositionMemory] 启动 ${windowLabel} 位置跟踪失败:`, e)
  }

  // 返回取消函数
  return () => {
    // 清理防抖定时器
    const key = `${POSITION_KEY_PREFIX}${windowLabel}`
    const timer = debounceTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      debounceTimers.delete(key)
    }
    unlistenMove?.()
    unlistenResize?.()
  }
}

// ============ 初始化 ============

/**
 * 初始化宠物窗口位置记忆
 * 恢复保存的位置并启动自动跟踪
 *
 * @returns 取消跟踪函数
 */
export async function initPetWindowPosition(): Promise<() => void> {
  // 恢复位置
  await restoreWindowPosition('pet-window')

  // 启动自动跟踪
  return await startPositionTracking('pet-window')
}
