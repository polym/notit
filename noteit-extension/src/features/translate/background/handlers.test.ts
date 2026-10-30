// translate/* through the real handlers, config, provider and cache, with an in-memory
// chrome.storage and a fake provider fetch (spec "selection translation", seam: translate/lookup).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HandlerError } from '../../../core/messaging/index.ts'
import { MAX_TEXT_LENGTH } from '../shared/classify.ts'
import type { TranslateRequests } from '../shared/protocol.ts'
import { createCache } from './cache.ts'
import { createTranslateHandlers } from './handlers.ts'
import type { FetchFn } from './provider.ts'

const KEY = 'sk-test-0000000000001234'
const CONFIG = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: KEY }

function memoryArea() {
  const store = new Map<string, unknown>()
  return {
    store,
    area: {
      get: vi.fn(async (key: string) => (store.has(key) ? { [key]: structuredClone(store.get(key)) } : {})),
      set: vi.fn(async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v))
      }),
      remove: vi.fn(async (key: string) => void store.delete(key)),
    },
  }
}

let local: ReturnType<typeof memoryArea>
let session: ReturnType<typeof memoryArea>

beforeEach(() => {
  local = memoryArea()
  session = memoryArea()
  vi.stubGlobal('chrome', { runtime: { id: 'test' }, storage: { local: local.area, session: session.area } })
})
afterEach(() => vi.unstubAllGlobals())

/** A provider answer with `content` as the assistant message. */
function answer(content: unknown, status = 200): Response {
  const body = status === 200 ? { choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] } : { error: { message: 'x' } }
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const WORD = { lemma: 'bank', ipa: { us: '/bæŋk/', uk: 'bæŋk' }, pos: 'n.', sense: 'sense:riverbank', otherSenses: ['sense:bank', 'sense:riverbank', 'sense:reserve'] }

function setup(responses: (Response | Error)[] = []) {
  const queue = [...responses]
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn: FetchFn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const next = queue.shift()
    if (!next) throw new Error('unexpected provider call')
    if (next instanceof Error) throw next
    return next
  })
  const handlers = createTranslateHandlers({ fetch: fetchFn, cache: createCache(session.area as unknown as chrome.storage.StorageArea) })
  const call = <K extends keyof TranslateRequests>(type: K, req: TranslateRequests[K]['req']) =>
    (handlers[type] as (req: unknown) => Promise<TranslateRequests[K]['res']>)(req)
  return { call, calls }
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (e) {
    if (e instanceof HandlerError) return e.code
    throw e
  }
  throw new Error('expected a rejection')
}

const lookup = (text: string, context = text) => ({ requestId: 'r1', text, context })

describe('translate/lookup', () => {
  beforeEach(() => local.store.set('translateConfig', { ...CONFIG, savedAt: 1 }))

  it('answers a single word with lemma, IPA, part of speech and the in-context sense', async () => {
    const { call, calls } = setup([answer(WORD)])
    const result = await call('translate/lookup', lookup('bank,', 'We sat on the bank of the river.'))
    expect(result).toEqual({
      mode: 'word',
      word: 'bank',
      lemma: 'bank',
      ipa: { us: 'bæŋk', uk: 'bæŋk' },
      pos: 'n.',
      sense: 'sense:riverbank',
      otherSenses: ['sense:bank', 'sense:reserve'],
    })
    const sent = JSON.parse(String(calls[0].init.body))
    expect(calls[0].url).toBe('https://api.deepseek.com/chat/completions')
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`)
    expect(sent.model).toBe('deepseek-flash')
    expect(sent.thinking).toEqual({ type: 'disabled' })
    expect(sent.response_format).toEqual({ type: 'json_object' })
    expect(sent.messages[1].content).toContain('We sat on the bank of the river.')
  })

  it.each(['well-known', "don't", '  "Children."  '])('treats %j as one word', async (text) => {
    const { call } = setup([answer(WORD)])
    expect((await call('translate/lookup', lookup(text))).mode).toBe('word')
  })

  it('answers a phrase or sentence with a translation', async () => {
    const { call, calls } = setup([answer({ translation: 'text:break-the-ice' })])
    const result = await call('translate/lookup', lookup('break the ice', 'He told a joke to break the ice.'))
    expect(result).toEqual({ mode: 'text', translation: 'text:break-the-ice' })
    expect(JSON.parse(String(calls[0].init.body)).messages[0].content).toContain('translator')
  })

  it('sends no thinking field to a non-DeepSeek provider', async () => {
    local.store.set('translateConfig', { ...CONFIG, baseUrl: 'https://api.example.com/v1' })
    const { call, calls } = setup([answer({ translation: 'text:good' })])
    await call('translate/lookup', lookup('good morning'))
    expect(calls[0].url).toBe('https://api.example.com/v1/chat/completions')
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty('thinking')
  })

  it('retries once on empty or off-schema content', async () => {
    const { call, calls } = setup([answer(''), answer({ translation: 'text:hello' })])
    expect(await call('translate/lookup', lookup('hello there'))).toEqual({ mode: 'text', translation: 'text:hello' })
    expect(calls).toHaveLength(2)
  })

  it('reports bad_request when the retry is unusable too', async () => {
    const { call, calls } = setup([answer('not json'), answer({ sense: '' })])
    expect(await code(call('translate/lookup', lookup('bank')))).toBe('bad_request')
    expect(calls).toHaveLength(2)
  })

  it.each([
    [401, 'unauthenticated'],
    [402, 'quota'],
    [429, 'quota'],
    [500, 'server'],
    [503, 'server'],
    [422, 'bad_request'],
  ])('maps HTTP %i to %s', async (status, expected) => {
    const { call } = setup([answer(null, status)])
    expect(await code(call('translate/lookup', lookup('bank')))).toBe(expected)
  })

  it('maps a failed fetch to network', async () => {
    const { call } = setup([new TypeError('Failed to fetch')])
    expect(await code(call('translate/lookup', lookup('bank')))).toBe('network')
  })

  it('reports not_configured without a saved key and calls no provider', async () => {
    local.store.clear()
    const { call, calls } = setup()
    expect(await code(call('translate/lookup', lookup('bank')))).toBe('not_configured')
    expect(calls).toHaveLength(0)
  })

  it('refuses empty and over-long selections without calling the provider', async () => {
    const { call, calls } = setup()
    expect(await code(call('translate/lookup', lookup('   ')))).toBe('bad_request')
    expect(await code(call('translate/lookup', lookup('a'.repeat(MAX_TEXT_LENGTH + 1))))).toBe('bad_request')
    expect(calls).toHaveLength(0)
  })

  it('serves a repeated lookup in the same context from the cache', async () => {
    const { call, calls } = setup([answer(WORD), answer({ ...WORD, sense: 'sense:bank' })])
    await call('translate/lookup', lookup('bank', 'We sat on the bank of the river.'))
    expect((await call('translate/lookup', lookup('Bank', 'We sat on the bank of the river.'))).mode).toBe('word')
    expect(calls).toHaveLength(1)
    // A different context is a different sense: the provider is asked again.
    const other = await call('translate/lookup', lookup('bank', 'She went to the bank to deposit a check.'))
    expect(other).toMatchObject({ sense: 'sense:bank' })
    expect(calls).toHaveLength(2)
  })

  it('keeps the cache across a worker restart through storage.session', async () => {
    await setup([answer(WORD)]).call('translate/lookup', lookup('bank', 'river bank'))
    const restarted = setup()
    expect(await restarted.call('translate/lookup', lookup('bank', 'river bank'))).toMatchObject({ sense: 'sense:riverbank' })
    expect(restarted.calls).toHaveLength(0)
  })

  it('aborts an in-flight lookup on translate/cancel', async () => {
    let seen: AbortSignal | undefined
    const fetchFn: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        seen = init.signal ?? undefined
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    const handlers = createTranslateHandlers({ fetch: fetchFn, cache: createCache(null) })
    const pending = handlers['translate/lookup'](lookup('bank'), {} as chrome.runtime.MessageSender)
    await vi.waitFor(() => expect(seen).toBeDefined())
    await handlers['translate/cancel']({ requestId: 'r1' }, {} as chrome.runtime.MessageSender)
    expect(await code(pending)).toBe('bad_request')
    expect(seen?.aborted).toBe(true)
  })
})

describe('translate config', () => {
  it('shows the defaults and no key before anything is saved', async () => {
    const { call } = setup()
    expect(await call('translate/getConfig', undefined)).toEqual({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      hasKey: false,
      keyHint: null,
    })
  })

  it('saves a config and never returns the key, only its last 4 characters', async () => {
    const { call } = setup()
    const view = await call('translate/saveConfig', { baseUrl: 'https://api.deepseek.com/', model: 'deepseek-flash', apiKey: ` ${KEY} ` })
    expect(view).toEqual({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', hasKey: true, keyHint: '1234' })
    expect(JSON.stringify(await call('translate/getConfig', undefined))).not.toContain(KEY)
    expect(local.store.get('translateConfig')).toMatchObject({ apiKey: KEY })
  })

  it('keeps the saved key when the panel saves without one', async () => {
    local.store.set('translateConfig', CONFIG)
    const { call } = setup()
    await call('translate/saveConfig', { baseUrl: CONFIG.baseUrl, model: 'deepseek-v4-pro' })
    expect(local.store.get('translateConfig')).toMatchObject({ apiKey: KEY, model: 'deepseek-v4-pro' })
  })

  it.each([
    [{ baseUrl: 'http://api.deepseek.com', model: 'm', apiKey: KEY }, 'bad_request'],
    [{ baseUrl: 'not a url', model: 'm', apiKey: KEY }, 'bad_request'],
    [{ baseUrl: CONFIG.baseUrl, model: '  ', apiKey: KEY }, 'bad_request'],
    [{ baseUrl: CONFIG.baseUrl, model: 'm', apiKey: 'has space' }, 'bad_request'],
    [{ baseUrl: CONFIG.baseUrl, model: 'm' }, 'not_configured'],
  ])('refuses %j with %s', async (input, expected) => {
    const { call } = setup()
    expect(await code(call('translate/saveConfig', input))).toBe(expected)
    expect(local.store.has('translateConfig')).toBe(false)
  })

  it('tests a config with one provider call and reports the provider error code', async () => {
    const ok = setup([answer(WORD)])
    expect(await ok.call('translate/testConfig', { baseUrl: CONFIG.baseUrl, model: CONFIG.model, apiKey: KEY })).toEqual({ reachable: true })
    expect(ok.calls).toHaveLength(1)
    const rejected = setup([answer(null, 401)])
    expect(await code(rejected.call('translate/testConfig', { baseUrl: CONFIG.baseUrl, model: CONFIG.model, apiKey: KEY }))).toBe('unauthenticated')
    expect(local.store.has('translateConfig')).toBe(false)
  })
})
