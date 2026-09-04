/**
 * @file weatherAwareness.ts
 * @description 天气感知引擎模块
 *
 * 基于 Open-Meteo API（免费无需 Key）实现宠物天气联动行为（PRD §7.6 F1.3）
 *
 * 核心功能：
 * 1. 通过 IP 定位获取地理位置（无需浏览器权限弹窗）
 * 2. 请求 Open-Meteo 当前天气（带超时）
 * 3. 映射天气到宠物行为（雨→打伞、热→扇风、冷→穿衣、晴→开心）
 * 4. 提供 onWeatherChange 订阅接口，每 30 分钟刷新一次
 *
 * 安全与健壮性：
 * - 所有外部调用强制超时，避免 hang 死
 * - 单点失败静默降级，不影响主流程
 * - 防止 refresh 重入导致并发请求堆积
 * - 仅在行为变化时通知，避免高频无意义回调
 *
 * 主要模块：
 * - WeatherInfo: 天气信息接口
 * - WeatherAction/WeatherBehavior: 天气行为类型
 * - WeatherAwarenessManager: 天气感知管理器类
 * - getWeatherAwarenessManager(): 单例获取
 *
 * 依赖关系：
 * - IP 定位 API: https://ipapi.co/json/（免费无需 Key）
 * - Open-Meteo API: https://api.open-meteo.com/
 *
 * Open-Meteo API 文档：https://open-meteo.com/en/docs
 */

// ============ 类型定义 ============

/**
 * 天气信息接口
 */
export interface WeatherInfo {
  /** 温度（摄氏度） */
  temperature: number
  /** WMO 天气解释代码 */
  weatherCode: number
  /** 中文天气描述 */
  description: string
}

/**
 * 宠物可执行的天气行为类型
 */
export type WeatherAction =
  | 'umbrella'    // 打伞（雨）
  | 'fan'         // 扇风（炎热）
  | 'cold'        // 发抖/穿衣（寒冷）
  | 'sunny'       // 开心（晴朗）
  | 'normal'      // 无特殊行为

/**
 * 天气行为配置接口
 */
export interface WeatherBehavior {
  /** 行为动作 */
  action: WeatherAction
  /** 气泡文案 */
  bubble: string
  /** 宠物状态（复用现有 PetState） */
  petState: 'happy' | 'sad' | 'sick' | 'idle'
}

// ============ 常量 ============

/** Open-Meteo API 端点（SECURITY: 外置常量便于审计） */
const OPEN_METEO_ENDPOINT = 'https://api.open-meteo.com/v1/forecast'

/** 地理位置请求超时（毫秒） */
const GEOLOCATION_TIMEOUT_MS = 8000

/** 天气 API 请求超时（毫秒） */
const WEATHER_FETCH_TIMEOUT_MS = 10000

/** 天气刷新间隔（30 分钟）— Open-Meteo 数据更新频率约 15 分钟，30 分钟平衡时效与流量 */
const REFRESH_INTERVAL_MS = 30 * 60 * 1000

// ============ WMO Weather Code 映射 ============
// 详见 https://open-meteo.com/en/docs#weather_variable_documentation

/** WMO 天气代码 → 中文描述映射表 */
const WMO_DESCRIPTION: Record<number, string> = {
  0: '晴朗',
  1: '主要晴朗',
  2: '局部多云',
  3: '阴天',
  45: '雾',
  48: '雾凇',
  51: '毛毛雨（轻度）',
  53: '毛毛雨（中度）',
  55: '毛毛雨（密集）',
  56: '冻毛毛雨（轻度）',
  57: '冻毛毛雨（密集）',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨（轻度）',
  67: '冻雨（重度）',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪粒',
  80: '阵雨（轻度）',
  81: '阵雨（中度）',
  82: '阵雨（猛烈）',
  85: '阵雪（轻度）',
  86: '阵雪（重度）',
  95: '雷阵雨',
  96: '雷阵雨伴小冰雹',
  99: '雷阵雨伴大冰雹',
}

/**
 * 将 WMO 天气代码转换为中文描述
 * @param code WMO 天气代码
 * @returns 中文描述，未知代码返回「未知」
 */
function describeWeatherCode(code: number): string {
  return WMO_DESCRIPTION[code] ?? '未知'
}

// ============ 天气行为映射 ============

/**
 * 根据天气信息映射到宠物行为
 *
 * 映射规则：
 * - 雨天（WMO 51-67, 80-82）→ 打伞
 * - 炎热（temp > 30℃）→ 扇风
 * - 寒冷（temp < 5℃）→ 穿衣/发抖
 * - 晴朗（code 0-1, temp 15-28℃）→ 开心
 * - 其他 → 无特殊行为
 *
 * @param weather 天气信息
 * @returns 对应的宠物行为配置
 */
function mapWeatherToBehavior(weather: WeatherInfo): WeatherBehavior {
  const { temperature: t, weatherCode: code } = weather

  // 雨天（WMO 51-67, 80-82）→ 打伞
  const isRain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82)
  if (isRain) {
    return { action: 'umbrella', bubble: '下雨了，出门记得带伞~', petState: 'sad' }
  }

  // 炎热（temp > 30）→ 扇风
  if (t > 30) {
    return { action: 'fan', bubble: '好热呀~', petState: 'sad' }
  }

  // 寒冷（temp < 5）→ 穿衣/发抖
  if (t < 5) {
    return { action: 'cold', bubble: '好冷~', petState: 'sad' }
  }

  // 晴朗（code 0-1, temp 15-28）→ 开心
  if (code <= 1 && t >= 15 && t <= 28) {
    return { action: 'sunny', bubble: '今天天气真好~', petState: 'happy' }
  }

  return { action: 'normal', bubble: '', petState: 'idle' }
}

// ============ 天气感知管理器 ============

/** 天气变化监听器类型 */
type WeatherListener = (weather: WeatherInfo, behavior: WeatherBehavior) => void

/**
 * 天气感知管理器类
 *
 * 负责定时获取天气、映射宠物行为、通知订阅者
 * 支持防重入、超时保护、变化通知优化
 */
export class WeatherAwarenessManager {
  private currentWeather: WeatherInfo | null = null
  private currentBehavior: WeatherBehavior | null = null
  private listeners: Set<WeatherListener> = new Set()
  /** 记录上次行为 action，仅在其变化时通知，避免高频无意义回调 */
  private lastBehaviorAction: WeatherAction = 'normal'
  private timer: ReturnType<typeof setInterval> | null = null
  /** 防止 refresh 重入导致并发请求堆积 */
  private refreshing: boolean = false

  /**
   * 启动定时刷新（每 30 分钟）。
   * 幂等：已运行时重复调用为 no-op，但首次启动会立即触发一次刷新。
   */
  start(): void {
    if (this.timer) return
    // 立即触发一次，避免等待整个周期才更新状态
    void this.refresh()
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS)
  }

  /**
   * 停止定时刷新。幂等。
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * 主动获取天气（不依赖 start()）。
   * 成功时更新缓存并通知监听器；失败返回 null（不抛出）。
   * @returns 天气信息，失败返回 null
   */
  async getWeather(): Promise<WeatherInfo | null> {
    // geolocation 不可用 / 拒绝 / 超时 → null
    const coords = await this.getCoordinates().catch(() => null)
    if (!coords) return null

    // fetch 失败 / 非 ok / 超时 → null
    const weather = await this.fetchWeather(coords.latitude, coords.longitude).catch(() => null)
    if (!weather) return null

    this.applyWeather(weather)
    return weather
  }

  /**
   * 内部刷新（由 start 触发）：失败静默，下次周期重试
   */
  private async refresh(): Promise<void> {
    // 前一次未完成时跳过，防止请求堆积
    if (this.refreshing) return
    this.refreshing = true
    try {
      await this.getWeather()
    } finally {
      this.refreshing = false
    }
  }

  /**
   * 更新缓存并在行为 action 变化时通知监听器。
   * 首次获取天气时 lastBehaviorAction='normal'，若实际行为不同则触发通知。
   * @param weather 新获取的天气信息
   */
  private applyWeather(weather: WeatherInfo): void {
    const behavior = mapWeatherToBehavior(weather)
    this.currentWeather = weather
    this.currentBehavior = behavior

    if (behavior.action !== this.lastBehaviorAction) {
      this.lastBehaviorAction = behavior.action
      this.notifyListeners(weather, behavior)
    }
  }

  /**
   * 通知所有监听器天气变化
   * 单个监听器异常不影响其他监听器
   */
  private notifyListeners(weather: WeatherInfo, behavior: WeatherBehavior): void {
    for (const listener of this.listeners) {
      try {
        listener(weather, behavior)
      } catch {
        // 单个监听器异常不影响其他监听器与整体流程
      }
    }
  }

  /**
   * 获取地理位置（通过 IP 定位，无需浏览器权限弹窗）。
   * 失败时 reject。
   * @returns Promise，解析为经纬度坐标
   * @throws 定位失败时抛出异常
   */
  private async getCoordinates(): Promise<{ latitude: number; longitude: number }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), GEOLOCATION_TIMEOUT_MS)
    try {
      const resp = await fetch('https://ipapi.co/json/', { signal: controller.signal })
      if (!resp.ok) throw new Error(`ipapi ${resp.status}`)
      const data = await resp.json() as { latitude?: number; longitude?: number }
      if (typeof data.latitude === 'number' && typeof data.longitude === 'number') {
        return { latitude: data.latitude, longitude: data.longitude }
      }
      throw new Error('ipapi: missing coords')
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 请求 Open-Meteo API 获取天气，带超时。
   * @param lat 纬度
   * @param lon 经度
   * @returns 天气信息，失败返回 null
   */
  private async fetchWeather(lat: number, lon: number): Promise<WeatherInfo | null> {
    const url = `${OPEN_METEO_ENDPOINT}?latitude=${lat}&longitude=${lon}&current_weather=true`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), WEATHER_FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(url, { signal: controller.signal })
      // 非 ok 视为失败
      if (!res.ok) return null
      const data = await res.json()
      const cw = data?.current_weather
      // 严格校验返回结构，避免 undefined 透传
      if (!cw || typeof cw.temperature !== 'number' || typeof cw.weathercode !== 'number') {
        return null
      }
      return {
        temperature: cw.temperature,
        weatherCode: cw.weathercode,
        description: describeWeatherCode(cw.weathercode),
      }
    } finally {
      // 无论成功失败都清理定时器
      clearTimeout(timer)
    }
  }

  /**
   * 订阅天气变化。
   * 若已有缓存天气，立即回放一次（便于新订阅者快速渲染）。
   * @param listener 天气变化监听器
   * @returns 取消订阅函数
   */
  onWeatherChange(listener: WeatherListener): () => void {
    this.listeners.add(listener)
    if (this.currentWeather && this.currentBehavior) {
      try {
        listener(this.currentWeather, this.currentBehavior)
      } catch {
        // 忽略回放异常
      }
    }
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 获取当前缓存的天气信息
   * @returns 当前天气，未获取过时返回 null
   */
  getCurrentWeather(): WeatherInfo | null {
    return this.currentWeather
  }

  /**
   * 获取当前缓存的天气行为
   * @returns 当前天气行为，未获取过时返回 null
   */
  getCurrentBehavior(): WeatherBehavior | null {
    return this.currentBehavior
  }
}

// ============ 单例 ============

/** 天气感知管理器单例 */
let weatherMgr: WeatherAwarenessManager | null = null

/**
 * 获取天气感知管理器单例
 * @returns 天气感知管理器实例
 */
export function getWeatherAwarenessManager(): WeatherAwarenessManager {
  if (!weatherMgr) {
    weatherMgr = new WeatherAwarenessManager()
  }
  return weatherMgr
}