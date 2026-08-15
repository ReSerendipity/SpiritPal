/**
 * 多显示器适配模块
 *
 * @fileoverview 处理多显示器检测、虚拟屏幕边界计算、DPI缩放与任务栏感知定位
 *
 * 主要模块：
 * - MonitorInfo: 显示器信息类型（分辨率、位置、缩放因子）
 * - ScreenBounds: 虚拟屏幕联合边界
 * - TaskbarInfo: 任务栏信息
 * - WindowPosition: 窗口位置类型
 *
 * 依赖关系：
 * - @tauri-apps/api/window: Tauri窗口API（availableMonitors/primaryMonitor/currentMonitor）
 *
 * 核心接口：
 * - getAvailableMonitors(): 获取所有可用显示器列表
 * - getPrimaryMonitor(): 获取主显示器
 * - getCurrentMonitor(): 获取窗口所在显示器
 * - calculateScreenBounds(): 计算虚拟屏幕联合边界
 * - clampPositionToScreen(): 将位置钳制在屏幕范围内
 * - getTaskbarInfo(): 获取任务栏高度与位置
 *
 * 核心机制（参考CodeWalkers/clawd-on-desk）：
 * 1. 多显示器枚举：获取所有显示器分辨率、位置、缩放因子
 * 2. 虚拟屏幕计算：联合所有显示器边界作为可移动区域
 * 3. DPI混合处理：高DPI/标准DPI显示器混合环境适配
 * 4. 位置钳制：确保宠物窗口始终在可见屏幕范围内
 * 5. 任务栏感知：计算任务栏高度，避免窗口被任务栏遮挡
 */

import { getCurrentWindow, availableMonitors, primaryMonitor, currentMonitor } from '@tauri-apps/api/window'

// ============ 类型定义 ============

/** 显示器信息 */
export interface MonitorInfo {
  /** 显示器名称 */
  name: string
  /** 显示器分辨率（逻辑像素） */
  size: { width: number; height: number }
  /** 显示器在虚拟屏幕坐标系中的位置 */
  position: { x: number; y: number }
  /** 缩放因子（1.0 = 100%, 1.5 = 150%, 2.0 = 200%） */
  scaleFactor: number
}

/** 虚拟屏幕边界（包含所有显示器的联合区域） */
export interface ScreenBounds {
  /** 最小 X 坐标（左侧显示器最左端） */
  minX: number
  /** 最小 Y 坐标（顶部显示器最顶端） */
  minY: number
  /** 最大 X 坐标（右侧显示器最右端） */
  maxX: number
  /** 最大 Y 坐标（底部显示器最底端，不含任务栏） */
  maxY: number
  /** 总宽度 */
  totalWidth: number
  /** 总高度 */
  totalHeight: number
}

/** 任务栏信息 */
export interface TaskbarInfo {
  /** 任务栏高度（像素） */
  height: number
  /** 任务栏位置 */
  position: 'top' | 'bottom' | 'left' | 'right'
  /** 屏幕可用区域（不含任务栏） */
  workArea: { x: number; y: number; width: number; height: number }
}

/** 窗口位置（逻辑坐标） */
export interface WindowPosition {
  x: number
  y: number
}

/** 窗口尺寸（逻辑像素） */
export interface WindowSize {
  width: number
  height: number
}

// ============ 显示器信息获取 ============

/**
 * 获取所有可用显示器信息
 * 使用 Tauri v2 的 availableMonitors API
 *
 * @returns 显示器信息数组
 */
export async function getAvailableMonitors(): Promise<MonitorInfo[]> {
  try {
    const monitors = await availableMonitors()

    return monitors.map((monitor) => ({
      name: monitor.name ?? 'unknown',
      size: {
        width: monitor.size.width / monitor.scaleFactor,
        height: monitor.size.height / monitor.scaleFactor,
      },
      position: {
        x: monitor.position.x / monitor.scaleFactor,
        y: monitor.position.y / monitor.scaleFactor,
      },
      scaleFactor: monitor.scaleFactor,
    }))
  } catch (e) {
    console.warn('[MultiMonitor] 获取显示器信息失败:', e)
    // 降级：返回默认 1920x1080 单显示器
    return [{
      name: 'default',
      size: { width: 1920, height: 1080 },
      position: { x: 0, y: 0 },
      scaleFactor: 1.0,
    }]
  }
}

/**
 * 获取主显示器信息
 *
 * @returns 主显示器信息，失败时返回默认值
 */
export async function getPrimaryMonitor(): Promise<MonitorInfo> {
  try {
    const monitor = await primaryMonitor()

    if (!monitor) {
      return getDefaultMonitor()
    }

    return {
      name: monitor.name ?? 'primary',
      size: {
        width: monitor.size.width / monitor.scaleFactor,
        height: monitor.size.height / monitor.scaleFactor,
      },
      position: {
        x: monitor.position.x / monitor.scaleFactor,
        y: monitor.position.y / monitor.scaleFactor,
      },
      scaleFactor: monitor.scaleFactor,
    }
  } catch {
    return getDefaultMonitor()
  }
}

/**
 * 获取当前窗口所在显示器信息
 *
 * @returns 当前显示器信息
 */
export async function getCurrentMonitor(): Promise<MonitorInfo> {
  try {
    const monitor = await currentMonitor()

    if (!monitor) {
      return getPrimaryMonitor()
    }

    return {
      name: monitor.name ?? 'current',
      size: {
        width: monitor.size.width / monitor.scaleFactor,
        height: monitor.size.height / monitor.scaleFactor,
      },
      position: {
        x: monitor.position.x / monitor.scaleFactor,
        y: monitor.position.y / monitor.scaleFactor,
      },
      scaleFactor: monitor.scaleFactor,
    }
  } catch {
    return getPrimaryMonitor()
  }
}

// ============ 屏幕边界计算 ============

/**
 * 计算多显示器联合屏幕边界
 * 虚拟屏幕坐标系：所有显示器的联合矩形区域
 *
 * @param monitors 显示器信息列表
 * @returns 屏幕边界
 */
export function calculateScreenBounds(monitors: MonitorInfo[]): ScreenBounds {
  if (monitors.length === 0) {
    return {
      minX: 0, minY: 0,
      maxX: 1920, maxY: 1080,
      totalWidth: 1920, totalHeight: 1080,
    }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const monitor of monitors) {
    const monRight = monitor.position.x + monitor.size.width
    const monBottom = monitor.position.y + monitor.size.height

    minX = Math.min(minX, monitor.position.x)
    minY = Math.min(minY, monitor.position.y)
    maxX = Math.max(maxX, monRight)
    maxY = Math.max(maxY, monBottom)
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    totalWidth: maxX - minX,
    totalHeight: maxY - minY,
  }
}

// ============ 位置钳制 ============

/**
 * 将窗口位置钳制到屏幕边界内
 * 确保窗口始终至少部分可见（不会完全移出屏幕）
 *
 * @param position 窗口位置
 * @param windowSize 窗口尺寸
 * @param bounds 屏幕边界
 * @param minVisiblePx 至少可见的像素数（默认 50px，防止窗口完全不可见）
 * @returns 钳制后的窗口位置
 */
export function clampToScreenBounds(
  position: WindowPosition,
  windowSize: WindowSize,
  bounds: ScreenBounds,
  minVisiblePx = 50,
): WindowPosition {
  // 窗口右侧至少 minVisiblePx 可见
  const clampedX = Math.max(
    bounds.minX - windowSize.width + minVisiblePx,
    Math.min(position.x, bounds.maxX - minVisiblePx),
  )

  // 窗口底部至少 minVisiblePx 可见
  const clampedY = Math.max(
    bounds.minY - windowSize.height + minVisiblePx,
    Math.min(position.y, bounds.maxY - minVisiblePx),
  )

  return { x: clampedX, y: clampedY }
}

/**
 * 检查窗口位置是否在任意显示器上可见
 *
 * @param position 窗口位置
 * @param windowSize 窗口尺寸
 * @param monitors 显示器列表
 * @param minVisibleRatio 最小可见比例（0-1，默认 0.1 = 10%）
 * @returns 是否可见
 */
export function isPositionOnScreen(
  position: WindowPosition,
  windowSize: WindowSize,
  monitors: MonitorInfo[],
  minVisibleRatio = 0.1,
): boolean {
  const minPixels = Math.min(windowSize.width, windowSize.height) * minVisibleRatio

  for (const monitor of monitors) {
    const monRight = monitor.position.x + monitor.size.width
    const monBottom = monitor.position.y + monitor.size.height

    // 计算窗口与显示器的交集面积
    const overlapX = Math.max(0, Math.min(position.x + windowSize.width, monRight) - Math.max(position.x, monitor.position.x))
    const overlapY = Math.max(0, Math.min(position.y + windowSize.height, monBottom) - Math.max(position.y, monitor.position.y))
    const overlapArea = overlapX * overlapY

    if (overlapArea >= minPixels * minPixels) {
      return true
    }
  }

  return false
}

// ============ DPI 缩放适配 ============

/**
 * 将逻辑坐标转换为指定显示器的物理坐标
 *
 * @param logicalPos 逻辑坐标
 * @param scaleFactor 目标显示器的缩放因子
 * @returns 物理坐标
 */
export function logicalToPhysical(
  logicalPos: WindowPosition,
  scaleFactor: number,
): WindowPosition {
  return {
    x: logicalPos.x * scaleFactor,
    y: logicalPos.y * scaleFactor,
  }
}

/**
 * 将物理坐标转换为逻辑坐标
 *
 * @param physicalPos 物理坐标
 * @param scaleFactor 源显示器的缩放因子
 * @returns 逻辑坐标
 */
export function physicalToLogical(
  physicalPos: WindowPosition,
  scaleFactor: number,
): WindowPosition {
  if (scaleFactor === 0) return physicalPos
  return {
    x: physicalPos.x / scaleFactor,
    y: physicalPos.y / scaleFactor,
  }
}

/**
 * 获取当前窗口的缩放因子
 *
 * @returns 缩放因子（默认 1.0）
 */
export async function getScaleFactor(): Promise<number> {
  try {
    const appWindow = getCurrentWindow()
    return await appWindow.scaleFactor()
  } catch {
    return 1.0
  }
}

// ============ 任务栏感知定位 ============

/**
 * 计算任务栏信息
 * 通过比较屏幕总分辨率和可用工作区来推断任务栏位置和高度
 *
 * 参考 WindowPet：screen.height - screen.availHeight
 *
 * @returns 任务栏信息
 */
export async function getTaskbarInfo(): Promise<TaskbarInfo> {
  try {
    const monitor = await currentMonitor()

    if (!monitor) {
      return getDefaultTaskbarInfo()
    }

    const screenSize = {
      width: monitor.size.width / monitor.scaleFactor,
      height: monitor.size.height / monitor.scaleFactor,
    }

    // 尝试获取工作区大小
    // Tauri v2 的 Monitor 对象不直接提供 workArea，
    // 使用 screen.availHeight 降级方案
    const workAreaHeight = await getWorkAreaHeight()
    const taskbarHeight = Math.max(0, screenSize.height - workAreaHeight)

    // 推断任务栏位置
    let position: TaskbarInfo['position'] = 'bottom'
    if (taskbarHeight > 0) {
      // 默认底部任务栏
      position = 'bottom'
    }

    return {
      height: taskbarHeight,
      position,
      workArea: {
        x: 0,
        y: 0,
        width: screenSize.width,
        height: workAreaHeight,
      },
    }
  } catch {
    return getDefaultTaskbarInfo()
  }
}

/**
 * 获取工作区高度（不含任务栏）
 * 使用 screen.availHeight 作为降级方案
 */
async function getWorkAreaHeight(): Promise<number> {
  try {
    // 在 WebView 中，screen.availHeight 返回排除任务栏的可用高度
    return window.screen.availHeight
  } catch {
    return 1080 - 40 // 默认值：1080 - 40px 任务栏
  }
}

/**
 * 计算任务栏上方的 Y 坐标（宠物窗口底部对齐到任务栏上方）
 *
 * @param windowHeight 窗口高度
 * @returns 窗口 Y 坐标
 */
export async function getTaskbarTopY(windowHeight: number): Promise<number> {
  const taskbar = await getTaskbarInfo()
  return taskbar.workArea.height - windowHeight
}

// ============ 默认值 ============

/** 获取默认显示器信息 */
function getDefaultMonitor(): MonitorInfo {
  return {
    name: 'default',
    size: { width: 1920, height: 1080 },
    position: { x: 0, y: 0 },
    scaleFactor: 1.0,
  }
}

/** 获取默认任务栏信息 */
function getDefaultTaskbarInfo(): TaskbarInfo {
  return {
    height: 40,
    position: 'bottom',
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  }
}

// ============ 辅助函数 ============

/**
 * 获取宠物窗口安全放置区域
 * 考虑多显示器边界和任务栏
 *
 * @param _windowSize 窗口尺寸（预留）
 * @returns 安全区域 { x, y, width, height }
 */
export async function getSafePlacementArea(
  _windowSize: WindowSize,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const monitors = await getAvailableMonitors()
  const bounds = calculateScreenBounds(monitors)
  const taskbar = await getTaskbarInfo()

  // 安全区 = 屏幕边界 - 任务栏
  return {
    x: bounds.minX,
    y: bounds.minY,
    width: bounds.totalWidth,
    height: bounds.totalHeight - taskbar.height,
  }
}
