// Story 2.14: core/auth against the local Supabase stack, with chrome.storage.local and
// chrome.runtime stubbed in memory. Prerequisite: `npm run db:start && npm run db:reset`.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getLocalSupabaseEnv, TEST_USERS } from '../helpers/local-supabase.ts'

const store = new Map<string, unknown>()
const sent: unknown[] = []

beforeAll(() => {
  const env = getLocalSupabaseEnv()
  vi.stubEnv('VITE_SUPABASE_URL', env.url)
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', env.anonKey)
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v)
        },
        remove: async (key: string) => {
          store.delete(key)
        },
      },
    },
    runtime: {
      sendMessage: async (message: unknown) => {
        sent.push(message)
      },
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

const { getAuthState, login, logout, withSession } = await import('../../src/core/auth/session.ts')

describe('core/auth (local Supabase)', () => {
  it('rejects wrong credentials as unauthenticated and stores nothing', async () => {
    const result = await login(TEST_USERS.a.email, 'wrong-password')
    expect(!result.ok && result.error.code).toBe('unauthenticated')
    expect(store.has('sb-auth')).toBe(false)
  })

  it('signs in, persists the session under sb-auth and runs withSession', async () => {
    const result = await login(TEST_USERS.a.email, TEST_USERS.a.password)
    expect(result).toEqual({ ok: true, data: { signedIn: true, email: TEST_USERS.a.email } })
    expect(typeof store.get('sb-auth')).toBe('string')
    expect(await getAuthState()).toEqual({ signedIn: true, email: TEST_USERS.a.email })

    const email = await withSession(async (supabase) => (await supabase.auth.getUser()).data.user?.email)
    expect(email).toEqual({ ok: true, data: TEST_USERS.a.email })
  })

  it('refreshes a session that expires within the margin before calling fn', async () => {
    const before = JSON.parse(store.get('sb-auth') as string) as { refresh_token: string; expires_at: number }
    // Pretend the access token has 30s left.
    const realNow = Date.now.bind(Date)
    const shift = before.expires_at * 1000 - 30_000 - realNow()
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + shift)

    const token = await withSession(async (_supabase, session) => session.refresh_token)
    expect(token.ok).toBe(true)
    if (token.ok) expect(token.data).not.toBe(before.refresh_token)
  })

  it('logout removes sb-auth and announces signedIn:false', async () => {
    sent.length = 0
    await logout()
    expect(store.has('sb-auth')).toBe(false)
    expect(await getAuthState()).toEqual({ signedIn: false, email: null })
    expect(sent).toContainEqual({ kind: 'noteit/event', type: 'auth/changed', payload: { signedIn: false, email: null } })
  })
})
