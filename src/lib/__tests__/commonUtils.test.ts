// commonUtils 单元测试 — 公共工具函数
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  generateId,
  selectTopK,
  debounce,
  throttle,
  safeGet,
  unique,
  groupBy,
  delay,
  retry,
  PerformanceMonitor,
  safeAsync,
  safeSync,
  once,
  guard,
  perfMonitor,
  isNonNullable,
  clamp,
  fetchWithTimeout,
  LRUCache,
} from '../commonUtils'

describe('generateId', () => {
  it('生成唯一ID，无重复', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) {
      const id = generateId()
      expect(ids.has(id)).toBe(false)
      ids.add(id)
    }
    expect(ids.size).toBe(1000)
  })

  it('支持前缀', () => {
    const id = generateId('test')
    expect(id.startsWith('test_')).toBe(true)
  })

  it('无前缀时不包含下划线开头', () => {
    const id = generateId()
    expect(id.startsWith('_')).toBe(false)
  })
})

describe('selectTopK', () => {
  it('返回Top-K最大元素（降序）', () => {
    const items = [
      { id: 1, score: 0.1 },
      { id: 2, score: 0.9 },
      { id: 3, score: 0.5 },
      { id: 4, score: 0.7 },
      { id: 5, score: 0.3 },
    ]
    const result = selectTopK(items, 3, (a, b) => a.score - b.score, 'desc')
    expect(result.map(r => r.id)).toEqual([2, 4, 3])
    expect(result.map(r => r.score)).toEqual([0.9, 0.7, 0.5])
  })

  it('返回Top-K最小元素（升序）', () => {
    const items = [
      { id: 1, score: 0.1 },
      { id: 2, score: 0.9 },
      { id: 3, score: 0.5 },
      { id: 4, score: 0.7 },
      { id: 5, score: 0.3 },
    ]
    const result = selectTopK(items, 2, (a, b) => a.score - b.score, 'asc')
    expect(result.map(r => r.id)).toEqual([1, 5])
  })

  it('K大于等于数组长度时返回全部元素', () => {
    const items = [{ id: 1, score: 0.5 }, { id: 2, score: 0.8 }]
    const result = selectTopK(items, 5, (a, b) => a.score - b.score, 'desc')
    expect(result.length).toBe(2)
  })

  it('K为0时返回空数组', () => {
    const items = [{ id: 1, score: 0.5 }]
    const result = selectTopK(items, 0, (a, b) => a.score - b.score, 'desc')
    expect(result).toEqual([])
  })

  it('空数组返回空', () => {
    const result = selectTopK<{ id: number; score: number }>([], 3, (a, b) => a.score - b.score, 'desc')
    expect(result).toEqual([])
  })

  it('处理相同分数的元素', () => {
    const items = [
      { id: 1, score: 0.5 },
      { id: 2, score: 0.5 },
      { id: 3, score: 0.5 },
    ]
    const result = selectTopK(items, 2, (a, b) => a.score - b.score, 'desc')
    expect(result.length).toBe(2)
  })
})

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('延迟执行', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced()
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('多次调用只执行最后一次', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced('a')
    debounced('b')
    debounced('c')
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('c')
  })

  it('cancel可以取消执行', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced()
    debounced.cancel()
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
  })

  it('flush可以立即执行', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)
    debounced('test')
    debounced.flush()
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith('test')
  })
})

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('首次立即执行', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 100)
    throttled()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('节流期间调用被忽略', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 100)
    throttled()
    throttled()
    throttled()
    expect(fn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(100)
    throttled()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('cancel可以取消待执行的trailing调用', () => {
    const fn = vi.fn()
    const throttled = throttle(fn, 100, { trailing: true })
    throttled() // 立即执行
    throttled() // 被节流，trailing会在100ms后执行
    expect(fn).toHaveBeenCalledTimes(1)
    throttled.cancel()
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(1) // 没有trailing调用
  })
})

describe('safeGet', () => {
  it('安全获取嵌套属性', () => {
    const obj = { a: { b: { c: 42 } } }
    expect(safeGet(obj, 'a.b.c')).toBe(42)
    expect(safeGet(obj, 'a.b.d', 'default')).toBe('default')
  })

  it('null/undefined路径返回默认值', () => {
    expect(safeGet(null, 'a.b')).toBeUndefined()
    expect(safeGet(undefined, 'a.b', 'fallback')).toBe('fallback')
  })

  it('不存在的属性返回undefined', () => {
    const obj = { a: 1 }
    expect(safeGet(obj, 'b' as any)).toBeUndefined()
  })

  it('数组索引访问', () => {
    const obj = { a: [1, 2, 3] }
    expect(safeGet(obj, 'a.1')).toBe(2)
  })
})

describe('unique', () => {
  it('基本去重', () => {
    expect(unique([1, 2, 2, 3, 1, 4])).toEqual([1, 2, 3, 4])
  })

  it('按keyFn去重', () => {
    const items = [
      { id: 1, name: 'a' },
      { id: 2, name: 'b' },
      { id: 1, name: 'a2' },
    ]
    const result = unique(items, (item) => item.id)
    expect(result.map(r => r.id)).toEqual([1, 2])
  })

  it('空数组返回空', () => {
    expect(unique([])).toEqual([])
  })
})

describe('groupBy', () => {
  it('按键分组', () => {
    const items = [
      { type: 'fruit', name: 'apple' },
      { type: 'veg', name: 'carrot' },
      { type: 'fruit', name: 'banana' },
    ]
    const result = groupBy(items, (item) => item.type)
    expect(result.fruit.length).toBe(2)
    expect(result.veg.length).toBe(1)
    expect(result.fruit.map(f => f.name)).toEqual(['apple', 'banana'])
  })

  it('空数组返回空对象', () => {
    expect(groupBy([], () => 'key')).toEqual({})
  })
})

describe('delay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('延迟指定时间后resolve', async () => {
    let resolved = false
    const promise = delay(100).then(() => { resolved = true })
    expect(resolved).toBe(false)
    vi.advanceTimersByTime(100)
    await promise
    expect(resolved).toBe(true)
  })
})

describe('retry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('成功时不重试', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const result = await retry(fn, { retries: 3 })
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('失败后重试', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('ok')

    const promise = retry(fn, { retries: 3, initialDelayMs: 10, maxDelayMs: 100 })
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise
    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('达到最大重试次数后抛出错误', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always fail'))
    const promise = retry(fn, { retries: 2, initialDelayMs: 1 })
    // 先挂载拒绝断言，避免 promise 在推进定时器期间以无处理器状态被拒绝
    const assertion = expect(promise).rejects.toThrow('always fail')
    await vi.advanceTimersByTimeAsync(1000)
    await assertion
    expect(fn).toHaveBeenCalledTimes(3) // 1次初始 + 2次重试
  })
})

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor

  beforeEach(() => {
    monitor = new PerformanceMonitor()
  })

  it('measure同步函数', () => {
    const result = monitor.measure('test', () => 42)
    expect(result).toBe(42)
    const stats = monitor.getStats('test')
    expect(stats).toBeDefined()
    expect(stats!.count).toBe(1)
    expect(stats!.avg).toBeGreaterThanOrEqual(0)
  })

  it('measure异步函数', async () => {
    const result = await monitor.measure('async-test', async () => {
      await delay(10)
      return 'done'
    })
    expect(result).toBe('done')
    const stats = monitor.getStats('async-test')
    expect(stats).toBeDefined()
    expect(stats!.count).toBe(1)
  })

  it('start/end手动计时', () => {
    const marker = monitor.start('manual')
    monitor.end(marker)
    const stats = monitor.getStats('manual')
    expect(stats).toBeDefined()
    expect(stats!.count).toBe(1)
  })

  it('累积统计', () => {
    monitor.measure('count-test', () => {})
    monitor.measure('count-test', () => {})
    monitor.measure('count-test', () => {})
    const stats = monitor.getStats('count-test')
    expect(stats!.count).toBe(3)
  })

  it('不存在的name返回undefined', () => {
    expect(monitor.getStats('nonexistent')).toBeUndefined()
  })

  it('getAllStats返回所有统计', () => {
    monitor.measure('a', () => {})
    monitor.measure('b', () => {})
    const all = monitor.getAllStats()
    expect(Object.keys(all).length).toBe(2)
    expect(all.a).toBeDefined()
    expect(all.b).toBeDefined()
  })

  it('clear清除指定统计', () => {
    monitor.measure('keep', () => {})
    monitor.measure('remove', () => {})
    monitor.clear('remove')
    expect(monitor.getStats('keep')).toBeDefined()
    expect(monitor.getStats('remove')).toBeUndefined()
  })

  it('clearAll清除所有统计', () => {
    monitor.measure('a', () => {})
    monitor.measure('b', () => {})
    monitor.clearAll()
    expect(monitor.getAllStats()).toEqual({})
  })
})

describe('safeAsync', () => {
  it('成功时返回结果', async () => {
    const result = await safeAsync(async () => 42)
    expect(result).toBe(42)
  })

  it('失败时返回undefined（默认）', async () => {
    const result = await safeAsync(async () => {
      throw new Error('test error')
    })
    expect(result).toBeUndefined()
  })

  it('失败时返回defaultValue', async () => {
    const result = await safeAsync(
      async () => { throw new Error('fail') },
      { defaultValue: 'fallback' }
    )
    expect(result).toBe('fallback')
  })

  it('失败时调用onError', async () => {
    const onError = vi.fn()
    await safeAsync(
      async () => { throw new Error('test') },
      { onError }
    )
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.any(Error))
  })
})

describe('safeSync', () => {
  it('成功时返回结果', () => {
    const result = safeSync(() => 42)
    expect(result).toBe(42)
  })

  it('失败时返回undefined', () => {
    const result = safeSync(() => {
      throw new Error('sync error')
    })
    expect(result).toBeUndefined()
  })

  it('失败时返回defaultValue', () => {
    const result = safeSync(
      () => { throw new Error('fail') },
      { defaultValue: 0 }
    )
    expect(result).toBe(0)
  })
})

describe('once', () => {
  it('只执行一次', () => {
    const fn = vi.fn().mockReturnValue('result')
    const onceFn = once(fn)
    expect(onceFn()).toBe('result')
    expect(onceFn()).toBe('result')
    expect(onceFn()).toBe('result')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('保持参数传递', () => {
    const fn = vi.fn((x: number) => x * 2)
    const onceFn = once(fn)
    expect(onceFn(5)).toBe(10)
    expect(onceFn(100)).toBe(10) // 第二次调用返回第一次的结果
  })
})

describe('guard', () => {
  it('条件为true时执行函数', () => {
    const fn = vi.fn().mockReturnValue('yes')
    const guarded = guard(() => true, fn, 'no')
    expect(guarded()).toBe('yes')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('条件为false时返回默认值', () => {
    const fn = vi.fn()
    const guarded = guard(() => false, fn, 'default')
    expect(guarded()).toBe('default')
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('isNonNullable', () => {
  it('过滤null和undefined', () => {
    const arr = [1, null, 2, undefined, 3]
    const filtered = arr.filter(isNonNullable)
    expect(filtered).toEqual([1, 2, 3])
  })
})

describe('perfMonitor 单例', () => {
  it('导出为PerformanceMonitor实例', () => {
    expect(perfMonitor).toBeInstanceOf(PerformanceMonitor)
  })
})

describe('clamp', () => {
  it('值在范围内返回原值', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('值小于最小值返回最小值', () => {
    expect(clamp(-1, 0, 10)).toBe(0)
  })

  it('值大于最大值返回最大值', () => {
    expect(clamp(11, 0, 10)).toBe(10)
  })

  it('边界值处理', () => {
    expect(clamp(0, 0, 10)).toBe(0)
    expect(clamp(10, 0, 10)).toBe(10)
  })
})

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('正常请求成功返回Response', async () => {
    const mockResponse = new Response('ok', { status: 200 })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const resp = await fetchWithTimeout('https://example.com', { timeout: 1000 })
    expect(resp).toBe(mockResponse)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('超时后抛出AbortError', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => {
      return new Promise((_resolve, reject) => {
        const signal = (options as RequestInit)?.signal
        if (signal) {
          signal.addEventListener('abort', () => {
            reject(new DOMException(signal.reason?.message || 'The operation was aborted', 'AbortError'))
          })
        }
      })
    })

    await expect(fetchWithTimeout('https://example.com', { timeout: 50 })).rejects.toBeInstanceOf(DOMException)
  }, 10000)

  it('timeout为0时不设置超时', async () => {
    const mockResponse = new Response('ok', { status: 200 })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(mockResponse)

    const resp = await fetchWithTimeout('https://example.com', { timeout: 0 })
    expect(resp).toBe(mockResponse)
  })
})

describe('LRUCache', () => {
  let cache: LRUCache<string, number>

  beforeEach(() => {
    cache = new LRUCache({ maxSize: 3 })
  })

  it('基本set/get操作', () => {
    cache.set('a', 1)
    expect(cache.get('a')).toBe(1)
  })

  it('超过容量时淘汰最旧条目', () => {
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.set('d', 4) // 淘汰 'a'

    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('b')).toBe(2)
    expect(cache.get('c')).toBe(3)
    expect(cache.get('d')).toBe(4)
    expect(cache.size).toBe(3)
  })

  it('访问后刷新顺序（LRU特性）', () => {
    cache.set('a', 1)
    cache.set('b', 2)
    cache.set('c', 3)
    cache.get('a') // 访问 a，b 变为最旧
    cache.set('d', 4) // 淘汰 'b'

    expect(cache.get('a')).toBe(1)
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe(3)
    expect(cache.get('d')).toBe(4)
  })

  it('has方法检查存在性', () => {
    cache.set('a', 1)
    expect(cache.has('a')).toBe(true)
    expect(cache.has('b')).toBe(false)
  })

  it('delete删除条目', () => {
    cache.set('a', 1)
    expect(cache.delete('a')).toBe(true)
    expect(cache.has('a')).toBe(false)
    expect(cache.delete('a')).toBe(false)
  })

  it('clear清空所有条目', () => {
    cache.set('a', 1)
    cache.set('b', 2)
    cache.clear()
    expect(cache.size).toBe(0)
    expect(cache.has('a')).toBe(false)
  })

  it('onEvict回调在淘汰时触发', () => {
    const evicted: Array<[string, number]> = []
    const lru = new LRUCache<string, number>({
      maxSize: 2,
      onEvict: (k, v) => evicted.push([k, v]),
    })
    lru.set('a', 1)
    lru.set('b', 2)
    lru.set('c', 3) // 淘汰 a

    expect(evicted).toHaveLength(1)
    expect(evicted[0]).toEqual(['a', 1])
  })

  it('TTL过期机制', async () => {
    const lru = new LRUCache<string, number>({ maxSize: 10, ttl: 50 })
    lru.set('a', 1)
    expect(lru.get('a')).toBe(1)

    await new Promise(r => setTimeout(r, 80))
    expect(lru.get('a')).toBeUndefined()
  })
})
