import { invoke } from '@tauri-apps/api/core'
import { listen, type Event, type EventCallback, type UnlistenFn } from '@tauri-apps/api/event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  cancelImage,
  defaultImageOutputPath,
  generateImage,
  loadImageModel,
  missingImageFiles,
  probeImageDevice,
  readImageAsObjectUrl,
  releaseImageModel,
  IMAGE_OUTPUT_SUBDIR,
  type ImageGenRequest,
} from '@/lib/ai/imageStudio'

// 两个 Tauri API 都要 mock：core.invoke 走命令，event.listen 回灌进度/完成事件。
vi.mock('@tauri-apps/api/core')
vi.mock('@tauri-apps/api/event')
// 产物落点与读回各走一个插件，按需动态 import —— 同样 mock 掉
vi.mock('@tauri-apps/api/path')
vi.mock('@tauri-apps/plugin-fs')

/** 捕获 listen 注册的回调，供测试手动触发事件（类型与真实 EventCallback 对齐）。 */
type Handler = EventCallback<unknown>
const handlers = new Map<string, Handler[]>()

beforeEach(() => {
  vi.mocked(invoke).mockReset()
  vi.mocked(listen).mockReset()
  handlers.clear()
  vi.mocked(listen).mockImplementation(async (name: string, cb: Handler): Promise<UnlistenFn> => {
    const list = handlers.get(name) ?? []
    list.push(cb)
    handlers.set(name, list)
    return () => {
      const l = handlers.get(name) ?? []
      const i = l.indexOf(cb)
      if (i >= 0) l.splice(i, 1)
    }
  })
})

/** 触发某个事件的全部已注册回调（模拟 Rust 侧 emit）。 */
function emit(event: string, payload: unknown): void {
  const name = event as Parameters<typeof listen>[0]
  for (const cb of handlers.get(event) ?? []) {
    cb({ event: name, id: 1, payload } as Event<unknown>)
  }
}

/**
 * 让 invoke 挂起，返回 { promise, resolve } —— 用于在生成**进行中**发事件
 * （若 invoke 立即 resolve，`finally` 会先注销监听，事件便无人接收）。
 * 之后调用 {@link flushListeners} 等两个 listen 注册完成。
 */
function deferredInvoke(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  vi.mocked(invoke).mockReturnValue(promise)
  return { promise, resolve }
}

/** 冲刷微任务，等 generateImage 里两个 await listen(...) 注册完毕。 */
async function flushListeners(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
}

describe('loadImageModel / releaseImageModel', () => {
  it('load 传 modelDir + optionsJson（默认空选项）', async () => {
    await loadImageModel('/mnt/models/Qwen-Image-2.1')
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('ondevice_image_load', {
      modelDir: '/mnt/models/Qwen-Image-2.1',
      optionsJson: '{}',
    })
  })

  it('load 把选项对象序列化透传', async () => {
    await loadImageModel('/d', { turbo: true, threads: 4, useGpu: false })
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('ondevice_image_load', {
      modelDir: '/d',
      optionsJson: JSON.stringify({ turbo: true, threads: 4, useGpu: false }),
    })
  })

  it('release 无参数调用', async () => {
    await releaseImageModel()
    expect(vi.mocked(invoke)).toHaveBeenCalledWith('ondevice_image_release')
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1)
  })
})

describe('missingImageFiles / probeImageDevice', () => {
  it('missing 传 modelDir 并原样返回 Rust 结果', async () => {
    vi.mocked(invoke).mockResolvedValue({ missing: 'dit.mnn', complete: false })
    const r = await missingImageFiles('/d')
    expect(invoke).toHaveBeenCalledWith('ondevice_image_missing_files', { modelDir: '/d' })
    expect(r).toEqual({ missing: 'dit.mnn', complete: false })
  })

  it('probe 无参数调用，snake_case 字段直通（不做驼峰转换）', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ram_gb: 14.75,
      opencl: true,
      model_dir: '/x/files/models',
    })
    const r = await probeImageDevice()
    expect(invoke).toHaveBeenCalledWith('ondevice_image_probe')
    expect(r.ram_gb).toBe(14.75)
    expect(r.opencl).toBe(true)
    expect(r.model_dir).toBe('/x/files/models')
  })

  it('probe 在非 Android 环境（命令不存在）时把异常抛给调用方', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('Command not found'))
    await expect(probeImageDevice()).rejects.toThrow('Command not found')
  })
})

describe('generateImage', () => {
  const req: ImageGenRequest = {
    prompt: 'a cat',
    width: 512,
    height: 512,
    steps: 6,
    seed: 42,
    outputPng: '/tmp/out.png',
  }

  it('调用 generate 命令并传 sessionId + requestJson', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    await generateImage(req, undefined, 'sess-1')
    expect(invoke).toHaveBeenCalledWith('ondevice_image_generate', {
      sessionId: 'sess-1',
      requestJson: JSON.stringify(req),
    })
  })

  it('未显式给 sessionId 时自动生成（UUID 形）', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    await generateImage(req)
    const arg = vi.mocked(invoke).mock.calls[0][1] as { sessionId: string }
    expect(arg.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('只把同 sessionId 的进度事件回灌给回调（跨会话不串）', async () => {
    const { resolve } = deferredInvoke()
    const onProgress = vi.fn()
    const p = generateImage(req, onProgress, 'mine')
    await flushListeners()

    emit('ondevice://image_progress', { sessionId: 'other', percent: 99 })
    emit('ondevice://image_progress', { sessionId: 'mine', percent: 10 })
    emit('ondevice://image_progress', { sessionId: 'mine', percent: 55 })

    resolve()
    await p
    expect(onProgress.mock.calls).toEqual([[10], [55]])
  })

  it('收到同会话 done 事件后注销两个监听', async () => {
    const { resolve } = deferredInvoke()
    const p = generateImage(req, undefined, 's')
    await flushListeners()
    expect(handlers.get('ondevice://image_progress')?.length).toBe(1)
    expect(handlers.get('ondevice://image_done')?.length).toBe(1)

    // 会话不匹配的 done 不应注销
    emit('ondevice://image_done', { sessionId: 'other', ok: true, error: '' })
    expect(handlers.get('ondevice://image_progress')?.length).toBe(1)

    // 匹配的 done 立即注销两个监听（推理结束后无需再等 invoke 返回）
    emit('ondevice://image_done', { sessionId: 's', ok: true, error: '' })
    expect(handlers.get('ondevice://image_progress')?.length).toBe(0)
    expect(handlers.get('ondevice://image_done')?.length).toBe(0)

    resolve()
    await p
  })

  it('invoke 抛错时 finally 仍注销监听（不泄漏）', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('model files missing'))
    await expect(generateImage(req, undefined, 's')).rejects.toThrow('model files missing')
    expect(handlers.get('ondevice://image_progress')?.length).toBe(0)
    expect(handlers.get('ondevice://image_done')?.length).toBe(0)
  })

  it('invoke 正常返回后 finally 注销监听', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    await generateImage(req, undefined, 's')
    expect(handlers.get('ondevice://image_progress')?.length).toBe(0)
    expect(handlers.get('ondevice://image_done')?.length).toBe(0)
  })

  it('编辑请求带上 sizeTier（上游 edit 重载只吃 tier）', async () => {
    vi.mocked(invoke).mockResolvedValue(undefined)
    await generateImage({ ...req, sizeTier: 'TINY', inputImage: '/a.png' }, undefined, 's')
    const parsed = JSON.parse(
      (vi.mocked(invoke).mock.calls[0][1] as { requestJson: string }).requestJson,
    ) as ImageGenRequest
    expect(parsed.sizeTier).toBe('TINY')
    expect(parsed.inputImage).toBe('/a.png')
  })
})

describe('cancelImage', () => {
  it('传 sessionId 调用 cancel 命令', async () => {
    await cancelImage('sess-9')
    expect(invoke).toHaveBeenCalledWith('ondevice_image_cancel', { sessionId: 'sess-9' })
  })
})

describe('defaultImageOutputPath', () => {
  it('落在 appCacheDir/spiritpal-images 下且文件名带时间戳', async () => {
    const { appCacheDir, join } = await import('@tauri-apps/api/path')
    vi.mocked(appCacheDir).mockResolvedValue('/data/user/0/com.spiritpal.desktop_pet/cache')
    vi.mocked(join).mockImplementation(async (...parts: string[]) => parts.join('/'))

    const p = await defaultImageOutputPath()

    expect(appCacheDir).toHaveBeenCalled()
    expect(p).toMatch(
      /^\/data\/user\/0\/com\.spiritpal\.desktop_pet\/cache\/spiritpal-images\/out-[0-9a-z]+-[0-9a-z]+\.png$/,
    )
    expect(p.startsWith(`x/${IMAGE_OUTPUT_SUBDIR}/`)).toBe(false)
  })
})

describe('readImageAsObjectUrl', () => {
  it('读文件字节并创建 image/png Blob URL', async () => {
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    vi.mocked(readFile).mockResolvedValue(bytes)
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url')

    const url = await readImageAsObjectUrl('/x/out-1.png')

    expect(readFile).toHaveBeenCalledWith('/x/out-1.png')
    expect(url).toBe('blob:mock-url')
    expect(createUrl).toHaveBeenCalledTimes(1)
    const blob = createUrl.mock.calls[0]![0] as Blob
    expect(blob.type).toBe('image/png')
    expect(blob.size).toBe(4)
    createUrl.mockRestore()
  })
})
