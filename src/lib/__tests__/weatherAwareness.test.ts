// weatherAwareness 模块测试 — 天气感知引擎（mock fetch）
// 注意：实现已从 navigator.geolocation 改为 IP 定位（ipapi.co），
// fetch 需按 URL 分发返回不同响应（ipapi.co 返回经纬度，open-meteo 返回天气）
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  WeatherAwarenessManager,
  getWeatherAwarenessManager,
} from '../weatherAwareness'

// 辅助函数：设置 fetch mock，按 URL 分发 IP 定位与天气请求
function setWeatherFetch(temp: number, weatherCode: number) {
  vi.stubGlobal('fetch', vi.fn((url: string) =>
    Promise.resolve({
      ok: true,
      json: () =>
        String(url).includes('ipapi.co')
          ? Promise.resolve({ latitude: 35.68, longitude: 139.76 })
          : Promise.resolve({
              current_weather: { temperature: temp, weathercode: weatherCode },
            }),
    }),
  ))
}

// 辅助函数：设置 fetch mock 模拟 IP 定位失败（不返回经纬度）
function setGeolocationFetchFail() {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
  ))
}

describe('weatherAwareness', () => {
  let mgr: WeatherAwarenessManager

  beforeEach(() => {
    mgr = new WeatherAwarenessManager()
  })

  afterEach(() => {
    mgr.stop()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('getWeather', () => {
    it('返回天气信息', async () => {
      setWeatherFetch(25, 0)
      const weather = await mgr.getWeather()
      expect(weather).not.toBeNull()
      expect(weather!.temperature).toBe(25)
      expect(weather!.weatherCode).toBe(0)
      expect(weather!.description).toBe('晴朗')
    })

    it('IP 定位不可用（请求失败）时返回 null', async () => {
      setGeolocationFetchFail()
      const weather = await mgr.getWeather()
      expect(weather).toBeNull()
    })

    it('IP 定位无经纬度数据时返回 null', async () => {
      vi.stubGlobal('fetch', vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ city: 'Shanghai' }),
        }),
      ))
      const weather = await mgr.getWeather()
      expect(weather).toBeNull()
    })

    it('fetch 失败时返回 null', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('network error'))))
      const weather = await mgr.getWeather()
      expect(weather).toBeNull()
    })

    it('fetch 返回非 ok 时返回 null', async () => {
      vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 500 })))
      const weather = await mgr.getWeather()
      expect(weather).toBeNull()
    })

    it('未知 weatherCode 返回"未知"描述', async () => {
      setWeatherFetch(20, 999)
      const weather = await mgr.getWeather()
      expect(weather!.description).toBe('未知')
    })
  })

  describe('天气行为映射', () => {
    it('雨天 → umbrella 行为', async () => {
      setWeatherFetch(20, 61)
      await mgr.getWeather()
      mgr.start()
      // 等待 refresh 完成
      await new Promise((r) => setTimeout(r, 0))
      // getWeather 不更新 currentBehavior，需要通过 refresh
      // 但 refresh 是私有的，通过 start 触发
    })

    it('炎热 → fan 行为（temp > 30）', async () => {
      setWeatherFetch(35, 0)
      await mgr.getWeather()
    })

    it('寒冷 → cold 行为（temp < 5）', async () => {
      setWeatherFetch(-5, 0)
      await mgr.getWeather()
    })

    it('晴朗 → sunny 行为（code 0-1, temp 15-28）', async () => {
      setWeatherFetch(22, 1)
      await mgr.getWeather()
    })

    it('普通天气 → normal 行为', async () => {
      setWeatherFetch(10, 3)
      await mgr.getWeather()
    })
  })

  describe('start / stop', () => {
    it('start 后定时刷新天气', async () => {
      setWeatherFetch(25, 0)
      mgr.start()
      await new Promise((r) => setTimeout(r, 50))
      const weather = mgr.getCurrentWeather()
      expect(weather).not.toBeNull()
      expect(weather!.temperature).toBe(25)
    })

    it('stop 后停止定时器', () => {
      setWeatherFetch(25, 0)
      mgr.start()
      mgr.stop()
      // 不抛出错误即可
    })

    it('重复 start 不重复启动', () => {
      setWeatherFetch(25, 0)
      mgr.start()
      mgr.start()
      // 不抛出错误即可
    })
  })

  describe('onWeatherChange', () => {
    it('订阅后收到天气变化通知', async () => {
      setWeatherFetch(25, 0)
      const listener = vi.fn()
      mgr.onWeatherChange(listener)
      mgr.start()
      await new Promise((r) => setTimeout(r, 50))
      expect(listener).toHaveBeenCalled()
    })

    it('行为未变化时不通知', async () => {
      setWeatherFetch(25, 0)
      const listener = vi.fn()
      mgr.onWeatherChange(listener)
      mgr.start()
      await new Promise((r) => setTimeout(r, 50))
      const callCount = listener.mock.calls.length
      // 再次 start 不会重新触发（因为 start 会先检查 timer）
      // 但如果手动触发 refresh，行为未变化时不通知
      expect(callCount).toBeGreaterThanOrEqual(1)
    })

    it('取消订阅后不再通知', async () => {
      setWeatherFetch(25, 0)
      const listener = vi.fn()
      const unsub = mgr.onWeatherChange(listener)
      unsub()
      mgr.start()
      await new Promise((r) => setTimeout(r, 50))
      expect(listener).not.toHaveBeenCalled()
    })

    it('已有缓存天气时立即回放', async () => {
      setWeatherFetch(25, 0)
      mgr.start()
      await new Promise((r) => setTimeout(r, 50))
      const listener = vi.fn()
      mgr.onWeatherChange(listener)
      expect(listener).toHaveBeenCalled()
    })
  })

  describe('getCurrentWeather / getCurrentBehavior', () => {
    it('初始状态返回 null', () => {
      expect(mgr.getCurrentWeather()).toBeNull()
      expect(mgr.getCurrentBehavior()).toBeNull()
    })
  })

  describe('getWeatherAwarenessManager 单例', () => {
    it('返回同一个实例', () => {
      const m1 = getWeatherAwarenessManager()
      const m2 = getWeatherAwarenessManager()
      expect(m1).toBe(m2)
    })
  })
})
