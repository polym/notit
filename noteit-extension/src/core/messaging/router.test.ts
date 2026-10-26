import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HandlerError, createClient, createRouter, emit, onEvent, type Result } from './index.ts'

type TestRequests = {
  'test/echo': { req: { text: string }; res: { text: string } }
  'test/fail': { req: Record<string, never>; res: void }
  'test/missing': { req: Record<string, never>; res: void }
}
type TestEvents = {
  'test/changed': { count: number }
}

const EXTENSION_ID = 'noteit-test-id'
type Listener = (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r?: unknown) => void) => unknown

// Minimal in-memory chrome.runtime: sendMessage delivers to registered onMessage listeners.
function installChromeMock() {
  const listeners = new Set<Listener>()
  const deliver = (message: unknown): Promise<unknown> =>
    new Promise((resolve, reject) => {
      let async = false
      for (const listener of listeners) {
        if (listener(message, { id: EXTENSION_ID }, resolve) === true) async = true
      }
      if (!async) {
        if (listeners.size === 0) reject(new Error('Could not establish connection. Receiving end does not exist.'))
        else resolve(undefined)
      }
    })
  const chromeMock = {
    runtime: {
      id: EXTENSION_ID,
      sendMessage: vi.fn(deliver),
      onMessage: {
        addListener: vi.fn((l: Listener) => listeners.add(l)),
        removeListener: vi.fn((l: Listener) => listeners.delete(l)),
      },
    },
    tabs: { sendMessage: vi.fn((_tabId: number, message: unknown) => deliver(message)) },
  }
  vi.stubGlobal('chrome', chromeMock)
  return { chromeMock, listeners }
}

const self = { id: EXTENSION_ID } as chrome.runtime.MessageSender

function makeRouter() {
  return createRouter<TestRequests>({
    'test/echo': async (req) => ({ text: req.text }),
    'test/fail': async () => {
      throw new Error('boom')
    },
    'test/missing': async () => {
      throw new HandlerError('not_found', 'no such record')
    },
  })
}

describe('createRouter', () => {
  let mock: ReturnType<typeof installChromeMock>
  beforeEach(() => {
    mock = installChromeMock()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('routes a known type to its handler and returns ok', async () => {
    const result = await makeRouter().handle({ kind: 'noteit/request', type: 'test/echo', req: { text: 'hi' } }, self)
    expect(result).toEqual({ ok: true, data: { text: 'hi' } })
  })

  it('turns a throwing handler into an internal error instead of throwing', async () => {
    const result = await makeRouter().handle({ kind: 'noteit/request', type: 'test/fail', req: {} }, self)
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('maps a thrown HandlerError to its own error code', async () => {
    const result = await makeRouter().handle({ kind: 'noteit/request', type: 'test/missing', req: {} }, self)
    expect(result).toEqual({ ok: false, error: { code: 'not_found', message: 'no such record' } })
  })

  it('returns bad_request for an unknown type', async () => {
    const result = await makeRouter().handle({ kind: 'noteit/request', type: 'test/nope', req: {} }, self)
    expect(result).toMatchObject({ ok: false, error: { code: 'bad_request' } })
  })

  it('returns bad_request for inherited object keys used as type', async () => {
    const result = await makeRouter().handle({ kind: 'noteit/request', type: 'toString', req: {} }, self)
    expect(result).toMatchObject({ ok: false, error: { code: 'bad_request' } })
  })

  it('rejects messages whose sender.id is not this extension', async () => {
    const result = await makeRouter().handle(
      { kind: 'noteit/request', type: 'test/echo', req: { text: 'x' } },
      { id: 'other-extension' },
    )
    expect(result).toMatchObject({ ok: false, error: { code: 'bad_request' } })
  })

  it('ignores messages that are not requests (events, legacy actions)', () => {
    const router = makeRouter()
    expect(router.handle({ kind: 'noteit/event', type: 'test/changed', payload: { count: 1 } }, self)).toBeNull()
    expect(router.handle({ action: 'legacy' }, self)).toBeNull()
    expect(router.handle(null, self)).toBeNull()
  })

  it('listen() answers through chrome.runtime.onMessage and unregisters cleanly', async () => {
    const stop = makeRouter().listen()
    expect(mock.chromeMock.runtime.onMessage.addListener).toHaveBeenCalledTimes(1)
    const client = createClient<TestRequests>()
    const echo: Result<{ text: string }> = await client.send('test/echo', { text: 'round trip' })
    expect(echo).toEqual({ ok: true, data: { text: 'round trip' } })
    const fail = await client.send('test/fail', {})
    expect(fail).toMatchObject({ ok: false, error: { code: 'internal', message: 'boom' } })
    stop()
    expect(mock.listeners.size).toBe(0)
  })
})

describe('createClient', () => {
  beforeEach(() => {
    installChromeMock()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps a missing receiver to an internal error instead of rejecting', async () => {
    const result = await createClient<TestRequests>().send('test/echo', { text: 'x' })
    expect(result).toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('sends to a tab when tabId is given', async () => {
    const stop = makeRouter().listen()
    const result = await createClient<TestRequests>().send('test/echo', { text: 'tab' }, { tabId: 7 })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { kind: 'noteit/request', type: 'test/echo', req: { text: 'tab' } })
    expect(result).toEqual({ ok: true, data: { text: 'tab' } })
    stop()
  })
})

describe('emit / onEvent', () => {
  beforeEach(() => {
    installChromeMock()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('delivers typed events to subscribers and is not answered by routers', async () => {
    const stopRouter = makeRouter().listen()
    const received: number[] = []
    const stop = onEvent<TestEvents>({ 'test/changed': (p) => received.push(p.count) })
    await emit<TestEvents>('test/changed', { count: 3 })
    expect(received).toEqual([3])
    stop()
    stopRouter()
  })

  it('swallows delivery failures when nobody listens', async () => {
    await expect(emit<TestEvents>('test/changed', { count: 1 })).resolves.toBeUndefined()
  })
})
