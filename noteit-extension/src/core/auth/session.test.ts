import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'

const emitMock = vi.fn(async () => {})
const getSupabaseMock = vi.fn()

vi.mock('../messaging/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../messaging/index.ts')>()
  return { ...actual, emit: (...args: unknown[]) => emitMock(...(args as [])) }
})
vi.mock('./client.ts', () => ({ getSupabase: () => getSupabaseMock() }))
const storedItems = new Map<string, string>()
vi.mock('./storage-adapter.ts', () => ({
  chromeLocalStorageAdapter: {
    getItem: async (key: string) => storedItems.get(key) ?? null,
    setItem: async (key: string, value: string) => void storedItems.set(key, value),
    removeItem: async (key: string) => void storedItems.delete(key),
  },
}))

const { withSession, login, getAuthState, authErrorCode, REFRESH_MARGIN_MS, setBeforeSignInHook, setSignedInHook } =
  await import('./session.ts')

function sessionExpiringIn(ms: number, token = 'old') {
  return {
    access_token: token,
    refresh_token: `r-${token}`,
    expires_at: Math.floor((Date.now() + ms) / 1000),
    user: { email: 'user-a@noteit.test' },
  }
}

function fakeSupabase(session: ReturnType<typeof sessionExpiringIn> | null) {
  const order: string[] = []
  const auth = {
    getSession: vi.fn(async () => {
      order.push('getSession')
      return { data: { session }, error: null }
    }),
    refreshSession: vi.fn(async () => {
      order.push('refresh')
      return { data: { session: sessionExpiringIn(3600_000, 'new') }, error: null as unknown }
    }),
    signOut: vi.fn(async () => ({ error: null })),
    signInWithPassword: vi.fn(),
  }
  return { client: { auth }, auth, order }
}

beforeEach(() => {
  emitMock.mockClear()
  getSupabaseMock.mockReset()
  storedItems.clear()
})

describe('withSession', () => {
  it('refreshes first when the session has 30s left, then calls fn with the new session', async () => {
    const fake = fakeSupabase(sessionExpiringIn(30_000))
    getSupabaseMock.mockReturnValue(fake.client)
    const fn = vi.fn(async (_c: unknown, s: { access_token: string }) => {
      fake.order.push('fn')
      return s.access_token
    })
    const result = await withSession(fn)
    expect(result).toEqual({ ok: true, data: 'new' })
    expect(fake.order).toEqual(['getSession', 'refresh', 'fn'])
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('does not refresh when the session is valid beyond the margin', async () => {
    const fake = fakeSupabase(sessionExpiringIn(REFRESH_MARGIN_MS + 120_000))
    getSupabaseMock.mockReturnValue(fake.client)
    const result = await withSession(async (_c, s) => s.access_token)
    expect(result).toEqual({ ok: true, data: 'old' })
    expect(fake.auth.refreshSession).not.toHaveBeenCalled()
  })

  it('emits auth/changed {signedIn:false} when the refresh is rejected, without calling fn', async () => {
    const fake = fakeSupabase(sessionExpiringIn(30_000))
    fake.auth.refreshSession.mockResolvedValue({
      data: { session: null as never },
      error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'),
    })
    getSupabaseMock.mockReturnValue(fake.client)
    const fn = vi.fn(async () => 'x')
    const result = await withSession(fn)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('unauthenticated')
    expect(fn).not.toHaveBeenCalled()
    expect(emitMock).toHaveBeenCalledWith('auth/changed', { signedIn: false, email: null })
    // Only the session is dropped (local scope); no local data API is touched by core/auth.
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('keeps the session on a network failure during refresh', async () => {
    const fake = fakeSupabase(sessionExpiringIn(30_000))
    fake.auth.refreshSession.mockResolvedValue({
      data: { session: null as never },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    })
    getSupabaseMock.mockReturnValue(fake.client)
    const result = await withSession(async () => 'x')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('network')
    expect(emitMock).not.toHaveBeenCalled()
    expect(fake.auth.signOut).not.toHaveBeenCalled()
  })

  it('announces sign-out when there is no session', async () => {
    getSupabaseMock.mockReturnValue(fakeSupabase(null).client)
    const result = await withSession(async () => 'x')
    expect(result.ok).toBe(false)
    expect(emitMock).toHaveBeenCalledWith('auth/changed', { signedIn: false, email: null })
  })
})

describe('login / getAuthState', () => {
  it('maps wrong credentials to unauthenticated and network failures to network', async () => {
    const fake = fakeSupabase(null)
    getSupabaseMock.mockReturnValue(fake.client)
    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
    })
    const wrong = await login('a@b.c', 'bad')
    expect(!wrong.ok && wrong.error.code).toBe('unauthenticated')

    fake.auth.signInWithPassword.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    })
    const offline = await login('a@b.c', 'pw')
    expect(!offline.ok && offline.error.code).toBe('network')
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('emits auth/changed {signedIn:true} after a successful login', async () => {
    const fake = fakeSupabase(null)
    getSupabaseMock.mockReturnValue(fake.client)
    fake.auth.signInWithPassword.mockResolvedValueOnce({ data: { session: sessionExpiringIn(3600_000) }, error: null })
    const result = await login('user-a@noteit.test', 'pw')
    expect(result).toEqual({ ok: true, data: { signedIn: true, email: 'user-a@noteit.test' } })
    expect(emitMock).toHaveBeenCalledWith('auth/changed', { signedIn: true, email: 'user-a@noteit.test' })
  })

  it('pauses sync before signInWithPassword and releases only after the sign-in hook, on every path', async () => {
    const fake = fakeSupabase(null)
    getSupabaseMock.mockReturnValue(fake.client)
    const order: string[] = []
    setBeforeSignInHook(async () => {
      order.push('pause')
      return () => order.push('release')
    })
    setSignedInHook(async () => void order.push('reconcile'))
    fake.auth.signInWithPassword.mockImplementation(async () => {
      order.push('signIn')
      return { data: { session: sessionExpiringIn(3600_000) }, error: null }
    })
    emitMock.mockImplementation(async () => void order.push('emit'))
    try {
      expect((await login('user-a@noteit.test', 'pw')).ok).toBe(true)
      expect(order).toEqual(['pause', 'signIn', 'reconcile', 'release', 'emit'])

      // A failed sign-in still releases the pause, and only once.
      order.length = 0
      fake.auth.signInWithPassword.mockImplementation(async () => {
        order.push('signIn')
        return { data: { session: null }, error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials') }
      })
      expect((await login('user-a@noteit.test', 'bad')).ok).toBe(false)
      expect(order).toEqual(['pause', 'signIn', 'release'])
    } finally {
      setBeforeSignInHook(async () => () => {})
      setSignedInHook(async () => {})
      emitMock.mockImplementation(async () => {})
    }
  })

  it('reports signed out when the build has no Supabase config', async () => {
    getSupabaseMock.mockReturnValue(null)
    expect(await getAuthState()).toEqual({ signedIn: false, email: null })
  })

  it('stays signed in offline when the access token expired but the refresh token is still stored', async () => {
    const fake = fakeSupabase(null)
    fake.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    } as never)
    getSupabaseMock.mockReturnValue(fake.client)
    storedItems.set('sb-auth', JSON.stringify(sessionExpiringIn(-3600_000)))
    expect(await getAuthState()).toEqual({ signedIn: true, email: 'user-a@noteit.test' })
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('reports signed out on a network error when no session is stored', async () => {
    const fake = fakeSupabase(null)
    fake.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    } as never)
    getSupabaseMock.mockReturnValue(fake.client)
    expect(await getAuthState()).toEqual({ signedIn: false, email: null })
  })

  it('reports signed out when getSession fails with a non-retryable error', async () => {
    const fake = fakeSupabase(null)
    fake.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token', 400, 'refresh_token_not_found'),
    } as never)
    getSupabaseMock.mockReturnValue(fake.client)
    storedItems.set('sb-auth', JSON.stringify(sessionExpiringIn(-3600_000)))
    expect(await getAuthState()).toEqual({ signedIn: false, email: null })
  })

  it('classifies server errors', () => {
    expect(authErrorCode(new AuthRetryableFetchError('Bad Gateway', 502))).toBe('server')
    expect(authErrorCode(new Error('boom'))).toBe('internal')
  })
})
