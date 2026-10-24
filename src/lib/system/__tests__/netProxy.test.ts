import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Channel, invoke } from '@tauri-apps/api/core'
import { proxyFetch } from '../netProxy'

type Event =
  | { type: 'headers'; status: number; headers: Array<[string, string]> }
  | { type: 'chunk'; dataBase64: string }
  | { type: 'end' }
  | { type: 'error'; message: string }

// Use the installed Channel itself: the fake transport delivers indexed wire
// envelopes, including out-of-order arrival, not direct onmessage shortcuts.
const ipc = vi.hoisted(() => ({
  callbacks: new Map<number, (message: unknown) => void>(),
  nextId: 0,
}))
vi.mock('@tauri-apps/api/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tauri-apps/api/core')>()),
  invoke: vi.fn(),
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const invokeMock = vi.mocked(invoke)
let registration: ReturnType<typeof deferred<void>>
let unregister: ReturnType<typeof vi.fn>

async function tick() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

function start(init?: RequestInit) {
  const pending = proxyFetch('http://localhost:11434/api/chat', init)
  // Attach immediately so intentionally rejected requests never leak rejections.
  void pending.catch(() => {})
  expect(invokeMock.mock.calls[0]?.[0]).toBe('http_proxy_stream')
  const args = invokeMock.mock.calls[0][1] as {
    requestId: string
    onEvent: Channel<Event>
    request: Record<string, unknown>
  }
  expect(args.requestId).toEqual(expect.any(String))
  expect(args.onEvent).toBeInstanceOf(Channel)
  let nextIndex = 0
  const wire = (index: number, message: Event) => ipc.callbacks.get(args.onEvent.id)?.({ index, message })
  const emit = (event: Event) => wire(nextIndex++, event)
  return { pending, args, emit, wire }
}

function headers(s: ReturnType<typeof start>, status = 200) {
  s.emit({ type: 'headers', status, headers: [['content-type', 'text/event-stream']] })
}

function chunk(s: ReturnType<typeof start>, bytes: number[]) {
  s.emit({ type: 'chunk', dataBase64: btoa(String.fromCharCode(...bytes)) })
}

function expectReleased(s: ReturnType<typeof start>, remove?: ReturnType<typeof vi.spyOn>) {
  expect(ipc.callbacks.has(s.args.onEvent.id)).toBe(false)
  expect(unregister).toHaveBeenCalledWith(s.args.onEvent.id)
  if (remove) expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
}

beforeEach(() => {
  ipc.callbacks.clear()
  registration = deferred<void>()
  unregister = vi.fn((id: number) => ipc.callbacks.delete(id))
  vi.stubGlobal('__TAURI_INTERNALS__', {
    unregisterCallback: unregister,
    transformCallback: (callback: (message: unknown) => void) => {
      const id = ++ipc.nextId
      ipc.callbacks.set(id, callback)
      return id
    },
  })
  invokeMock.mockReset()
  invokeMock.mockImplementation((command) => {
    if (command === 'http_proxy_stream') return registration.promise
    if (command === 'http_proxy_abort') return Promise.resolve()
    // Keep the old buffered implementation pending: it cannot invent a body.
    if (command === 'http_proxy') return new Promise(() => {})
    throw new Error(`Unexpected IPC command: ${command}`)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('proxyFetch streaming IPC', () => {
  it('orders wire envelopes before delivering chunks or the terminal event', async () => {
    const s = start()
    s.wire(1, { type: 'chunk', dataBase64: 'QQ==' })
    s.wire(0, { type: 'headers', status: 200, headers: [] })
    const reader = (await s.pending).body!.getReader()
    expect(await reader.read()).toEqual({ done: false, value: new Uint8Array([65]) })
    s.wire(3, { type: 'end' })
    let finished = false
    const read = reader.read().then((result) => {
      finished = true
      return result
    })
    await tick()
    expect(finished).toBe(false)
    s.wire(2, { type: 'chunk', dataBase64: 'Qg==' })
    expect(await read).toEqual({ done: false, value: new Uint8Array([66]) })
    expect(await reader.read()).toEqual({ done: true, value: undefined })
    expectReleased(s)
  })

  it('rejects end before headers instead of leaving fetch pending', async () => {
    const s = start()
    s.emit({ type: 'end' })
    await expect(s.pending).rejects.toThrow('headers')
    expectReleased(s)
  })

  it('does not invoke if request body conversion aborts the signal', async () => {
    const controller = new AbortController()
    const body = {
      toString() {
        controller.abort()
        return ''
      },
    } as unknown as BodyInit
    await expect(proxyFetch('http://localhost', { body, signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(invokeMock).not.toHaveBeenCalled()
    expect(ipc.callbacks.size).toBe(0)
  })

  it('resolves at headers and reads the first chunk before the last exists', async () => {
    const s = start({ method: 'POST', headers: { 'x-test': 'yes' }, body: '中' })
    expect(s.args.request).toMatchObject({ method: 'POST', headers: [['x-test', 'yes']], bodyB64: '5Lit' })
    let resolved = false
    void s.pending.then(() => {
      resolved = true
    })
    headers(s)
    await tick()
    expect(resolved).toBe(true) // even the registration reply has not arrived yet
    const response = await s.pending
    expect(response).toBeInstanceOf(Response)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body!.getReader()
    chunk(s, [65])
    expect(await reader.read()).toEqual({ done: false, value: new Uint8Array([65]) })
    let secondArrived = false
    const second = reader.read().then((value) => {
      secondArrived = true
      return value
    })
    await tick()
    expect(secondArrived).toBe(false)
    chunk(s, [66])
    expect(await second).toEqual({ done: false, value: new Uint8Array([66]) })
    s.emit({ type: 'end' })
    expect(await reader.read()).toEqual({ done: true, value: undefined })
    expectReleased(s)
  })

  it('preserves multibyte UTF-8 split between chunks', async () => {
    const s = start()
    headers(s)
    const reader = (await s.pending).body!.pipeThrough(new TextDecoderStream()).getReader()
    chunk(s, [0xe4])
    chunk(s, [0xb8, 0xad, 0xf0, 0x9f])
    chunk(s, [0x8c, 0x8d])
    s.emit({ type: 'end' })
    let text = ''
    for (;;) {
      const result = await reader.read()
      if (result.done) break
      text += result.value
    }
    expect(text).toBe('中\u{1f30d}')
  })

  it('makes zero IPC requests and creates no Channel when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = proxyFetch('http://localhost', { signal: controller.signal })
    void result.catch(() => {})
    expect(invokeMock).not.toHaveBeenCalled()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    expect(ipc.callbacks.size).toBe(0)
  })

  it('aborts before headers locally, then cancels backend only after registration', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const s = start({ signal: controller.signal })
    controller.abort()
    await expect(s.pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(invokeMock).toHaveBeenCalledTimes(1)
    registration.resolve()
    await tick()
    expect(invokeMock).toHaveBeenLastCalledWith('http_proxy_abort', { requestId: s.args.requestId })
    expectReleased(s, remove)
  })

  it('aborts after headers, errors pending reads and ignores late events', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const s = start({ signal: controller.signal })
    registration.resolve()
    headers(s)
    const reader = (await s.pending).body!.getReader()
    chunk(s, [65])
    expect((await reader.read()).value).toEqual(new Uint8Array([65]))
    const pendingRead = reader.read()
    controller.abort()
    await expect(pendingRead).rejects.toMatchObject({ name: 'AbortError' })
    await tick()
    expect(invokeMock).toHaveBeenLastCalledWith('http_proxy_abort', { requestId: s.args.requestId })
    expect(() => {
      chunk(s, [66])
      s.emit({ type: 'end' })
    }).not.toThrow()
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
    expectReleased(s, remove)
  })

  it('reader.cancel cancels backend once and cannot enqueue afterward', async () => {
    const controller = new AbortController()
    const s = start({ signal: controller.signal })
    headers(s)
    const reader = (await s.pending).body!.getReader()
    const read = reader.read()
    await reader.cancel('not needed')
    expect(await read).toEqual({ done: true, value: undefined })
    controller.abort()
    registration.resolve()
    await tick()
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'http_proxy_abort')).toHaveLength(1)
    expect(() => {
      chunk(s, [65])
      s.emit({ type: 'error', message: 'late' })
    }).not.toThrow()
    expect(await reader.read()).toEqual({ done: true, value: undefined })
    expectReleased(s)
  })

  it('end is terminal once, removes listeners, and makes later abort/cancel a no-op', async () => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const s = start({ signal: controller.signal })
    headers(s)
    const response = await s.pending
    const late = s.args.onEvent.onmessage
    s.emit({ type: 'end' })
    expect(() => {
      late({ type: 'end' })
      late({ type: 'error', message: 'late' })
    }).not.toThrow()
    controller.abort()
    await response.body!.cancel()
    registration.resolve()
    await tick()
    expect(invokeMock).toHaveBeenCalledTimes(1)
    expect(unregister).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledTimes(1)
    expectReleased(s, remove)
  })

  it.each([400, 429, 500])('preserves HTTP %i status and error body', async (status) => {
    const s = start()
    headers(s, status)
    const response = await s.pending
    chunk(s, [98, 97, 100])
    s.emit({ type: 'end' })
    expect(response.status).toBe(status)
    expect(response.ok).toBe(false)
    expect(await response.text()).toBe('bad')
  })

  it.each([204, 205, 304])('uses a null body for HTTP %i', async (status) => {
    const s = start()
    headers(s, status)
    const response = await s.pending
    expect(response.status).toBe(status)
    expect(response.body).toBeNull()
    s.emit({ type: 'end' })
    expectReleased(s)
  })

  it('uses a null body for HEAD', async () => {
    const s = start({ method: 'HEAD' })
    headers(s)
    expect((await s.pending).body).toBeNull()
    s.emit({ type: 'end' })
    expectReleased(s)
  })

  it.each([false, true])('handles invoke rejection (headers received: %s)', async (received) => {
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const s = start({ signal: controller.signal })
    let read: Promise<unknown> | undefined
    if (received) {
      headers(s)
      read = (await s.pending).body!.getReader().read()
    }
    const failure = expect(read ?? s.pending).rejects.toThrow('IPC failed')
    registration.reject('IPC failed')
    await failure
    expectReleased(s, remove)
    controller.abort()
    expect(invokeMock).toHaveBeenCalledTimes(1)
  })

  it('preserves the first backend error and cleans up before headers', async () => {
    const s = start()
    const late = s.args.onEvent.onmessage
    s.emit({ type: 'error', message: 'connection failed' })
    late({ type: 'error', message: 'second error' })
    await expect(s.pending).rejects.toThrow('connection failed')
    expect(unregister).toHaveBeenCalledTimes(1)
    expectReleased(s)
  })

  it('stops body reads on a backend size-limit error without needing end', async () => {
    const s = start()
    headers(s)
    const reader = (await s.pending).body!.getReader()
    chunk(s, [65])
    expect((await reader.read()).value).toEqual(new Uint8Array([65]))
    const failure = expect(reader.read()).rejects.toThrow('响应体超限')
    s.emit({ type: 'error', message: '响应体超限' })
    await failure
    expect(() => chunk(s, [66])).not.toThrow()
    expectReleased(s)
  })

  it('cancels a malformed chunk rather than leaking a live backend request', async () => {
    const s = start()
    headers(s)
    const reader = (await s.pending).body!.getReader()
    const failure = expect(reader.read()).rejects.toBeDefined()
    s.emit({ type: 'chunk', dataBase64: 'not base64!' })
    await failure
    registration.resolve()
    await tick()
    expect(invokeMock).toHaveBeenLastCalledWith('http_proxy_abort', { requestId: s.args.requestId })
    expectReleased(s)
  })

  it('keeps concurrent request cancellation isolated', async () => {
    const a = start()
    const bPromise = proxyFetch('http://localhost/second')
    const b = invokeMock.mock.calls[1][1] as typeof a.args
    expect(b.requestId).not.toBe(a.args.requestId)
    headers(a)
    b.onEvent.onmessage({ type: 'headers', status: 200, headers: [] })
    await (await a.pending).body!.cancel()
    b.onEvent.onmessage({ type: 'chunk', dataBase64: 'Qg==' })
    b.onEvent.onmessage({ type: 'end' })
    expect(await (await bPromise).text()).toBe('B')
    registration.resolve()
    await tick()
    expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'http_proxy_abort')).toEqual([
      ['http_proxy_abort', { requestId: a.args.requestId }],
    ])
  })
})
