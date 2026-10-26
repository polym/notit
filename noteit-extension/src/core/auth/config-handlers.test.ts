// auth/* config requests through the real handlers, session and client modules, with an in-memory
// chrome.storage.local and a stubbed fetch (spec "login-supabase-config").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HandlerError } from '../messaging/index.ts'

const BUILD = { url: 'https://build.supabase.co', anonKey: 'sb_publishable_build' }
const USER = { url: 'http://127.0.0.1:54321', anonKey: 'sb_publishable_user' }

const store = new Map<string, unknown>()
function installStorage() {
  store.clear()
  vi.stubGlobal('chrome', {
    runtime: { sendMessage: vi.fn(async () => undefined), id: 'test' },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (store.has(key) ? { [key]: structuredClone(store.get(key)) } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v))
        }),
        remove: vi.fn(async (key: string) => void store.delete(key)),
      },
    },
  })
}

/** A stored supabase-js session that stays valid for an hour. */
function storeSignedInSession() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  store.set(
    'sb-auth',
    JSON.stringify({
      access_token: 'a',
      refresh_token: 'r',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: expiresAt,
      user: { id: 'u1', email: 'user-a@noteit.test', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
    }),
  )
}

async function loadHandlers(build: typeof BUILD | null) {
  vi.resetModules()
  vi.stubEnv('VITE_SUPABASE_URL', build?.url ?? '')
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', build?.anonKey ?? '')
  const { authHandlers } = await import('./handlers.ts')
  // Handlers ignore the sender; a typed cast keeps the calls short.
  const call = <K extends keyof typeof authHandlers>(type: K, req?: unknown) =>
    (authHandlers[type] as (req: unknown) => Promise<unknown>)(req)
  return call
}

async function rejection(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (e) {
    // vi.resetModules gives the handlers their own HandlerError class, so match on the shape.
    if (e instanceof Error && e.name === new HandlerError('internal', '').name && 'code' in e) return String(e.code)
    throw e
  }
  throw new Error('expected a rejection')
}

beforeEach(() => installStorage())
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('auth/getConfig', () => {
  it('reports the build-time config as the default', async () => {
    const call = await loadHandlers(BUILD)
    expect(await call('auth/getConfig')).toEqual({ url: BUILD.url, source: 'build', hasBuildDefault: true })
  })

  it('reports none when the build has no config and nothing is saved', async () => {
    const call = await loadHandlers(null)
    expect(await call('auth/getConfig')).toEqual({ url: null, source: 'none', hasBuildDefault: false })
  })

  it('prefers a saved config, and ignores a saved entry that no longer validates', async () => {
    store.set('supabaseConfig', { ...USER, savedAt: 1 })
    let call = await loadHandlers(BUILD)
    expect(await call('auth/getConfig')).toEqual({ url: USER.url, source: 'user', hasBuildDefault: true })

    store.set('supabaseConfig', { url: 'http://evil.example', anonKey: 'sb_secret_x' })
    call = await loadHandlers(BUILD)
    expect(await call('auth/getConfig')).toEqual({ url: BUILD.url, source: 'build', hasBuildDefault: true })
  })

  it('never returns the anon key', async () => {
    store.set('supabaseConfig', { ...USER, savedAt: 1 })
    const call = await loadHandlers(BUILD)
    expect(JSON.stringify(await call('auth/getConfig'))).not.toContain(USER.anonKey)
  })
})

describe('auth/setConfig and auth/resetConfig', () => {
  it('saves a valid config while signed out and makes it the active one', async () => {
    const call = await loadHandlers(null)
    expect(await call('auth/setConfig', { url: `${USER.url}/`, anonKey: USER.anonKey })).toEqual({ url: USER.url, source: 'user' })
    expect(await call('auth/getConfig')).toEqual({ url: USER.url, source: 'user', hasBuildDefault: false })
    expect(store.get('supabaseConfig')).toMatchObject(USER)
  })

  it('rejects an invalid config without saving it', async () => {
    const call = await loadHandlers(BUILD)
    expect(await rejection(call('auth/setConfig', { url: 'http://example.com', anonKey: 'sb_secret_x' }))).toBe('bad_request')
    expect(store.has('supabaseConfig')).toBe(false)
  })

  it('refuses to change or reset the config while signed in', async () => {
    store.set('supabaseConfig', { ...USER, savedAt: 1 })
    storeSignedInSession()
    const call = await loadHandlers(BUILD)
    expect(await rejection(call('auth/setConfig', BUILD))).toBe('bad_request')
    expect(await rejection(call('auth/resetConfig'))).toBe('bad_request')
    expect(store.get('supabaseConfig')).toMatchObject(USER)
  })

  it('drops any stored session of the previous server when the config changes', async () => {
    // A leftover session that getSession rejects (expired, no refresh possible) still counts as signed out.
    store.set('sb-auth', 'not json')
    const call = await loadHandlers(BUILD)
    await call('auth/setConfig', USER)
    expect(store.has('sb-auth')).toBe(false)
  })

  it('reset removes the saved config and falls back to the build default', async () => {
    store.set('supabaseConfig', { ...USER, savedAt: 1 })
    const call = await loadHandlers(BUILD)
    expect(await call('auth/resetConfig')).toEqual({ url: BUILD.url, source: 'build' })
    expect(store.has('supabaseConfig')).toBe(false)
    expect(await call('auth/getConfig')).toEqual({ url: BUILD.url, source: 'build', hasBuildDefault: true })
  })
})

describe('auth/login without a config', () => {
  it('answers not_configured', async () => {
    const call = await loadHandlers(null)
    expect(await rejection(call('auth/login', { email: 'a@b.c', password: 'p' }))).toBe('not_configured')
  })
})

describe('auth/testConfig', () => {
  it('asks the candidate server with its key and reports reachable', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const call = await loadHandlers(BUILD)
    expect(await call('auth/testConfig', USER)).toEqual({ reachable: true })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${USER.url}/auth/v1/settings`)
    expect(new Headers(init.headers).get('apikey')).toBe(USER.anonKey)
    // Testing never saves.
    expect(store.has('supabaseConfig')).toBe(false)
  })

  it('maps an unreachable server to network and a refused key to unauthenticated', async () => {
    const call = await loadHandlers(BUILD)
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    expect(await rejection(call('auth/testConfig', USER))).toBe('network')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })))
    expect(await rejection(call('auth/testConfig', USER))).toBe('unauthenticated')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 503 })))
    expect(await rejection(call('auth/testConfig', USER))).toBe('server')
  })

  it('validates before calling the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const call = await loadHandlers(BUILD)
    expect(await rejection(call('auth/testConfig', { url: 'nope', anonKey: '' }))).toBe('bad_request')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
