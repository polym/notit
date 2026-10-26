import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HandlerError, type ErrorCode, type Result } from '../../messaging/index.ts'
import { getDb } from '../../db/schema.ts'
import { write, type HighlightDraft } from '../../db/write.ts'
import type { SyncPushRpc } from './push.ts'
import type { PullPageFetch } from './pull.ts'

const authState = { signedIn: true }
/** User id of the stand-in session. */
const sessionUser = { id: 'u1' }
const storageItems: Record<string, unknown> = {}
const pushRpc = vi.fn<SyncPushRpc>()
const pullPage = vi.fn<PullPageFetch>()

// withSession stand-in: a signed-in session of sessionUser, thrown errors mapped to their code.
vi.mock('../../auth/index.ts', () => ({
  getAuthState: async () => ({ signedIn: authState.signedIn }),
  onAuthChanged: () => () => {},
  setBeforeSignInHook: () => {},
  setSignedInHook: () => {},
  setSignOutHook: () => {},
  withSession: async <T>(fn: (supabase: unknown, session: { user: { id: string } }) => Promise<T>): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn({}, { user: { id: sessionUser.id } }) }
    } catch (e) {
      const code: ErrorCode = e instanceof HandlerError ? e.code : 'internal'
      return { ok: false, error: { code, message: String(e) } }
    }
  },
}))
vi.mock('./rpc.ts', () => ({
  supabaseRpc: () => pushRpc,
  supabasePullPage: () => pullPage,
}))

vi.stubGlobal('chrome', {
  runtime: { id: 'test', sendMessage: vi.fn(async () => undefined) },
  alarms: {
    create: vi.fn(async () => {}),
    clear: vi.fn(async () => true),
    get: vi.fn(async () => undefined),
    onAlarm: { addListener: vi.fn() },
  },
  tabs: { onActivated: { addListener: vi.fn() } },
  storage: {
    local: {
      get: vi.fn(async (key: string) => (key in storageItems ? { [key]: storageItems[key] } : {})),
      set: vi.fn(async (items: Record<string, unknown>) => Object.assign(storageItems, items)),
      remove: vi.fn(async (keys: string | string[]) => {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete storageItems[k]
      }),
    },
  },
})

const { pullNow, pushNow, reconcileAccount, retryNow, startSyncEngine } = await import('./engine.ts')
const { loadRetry } = await import('./status.ts')

function draft(id: string): HighlightDraft {
  return {
    id,
    userId: '',
    canonicalUrl: 'https://example.com/a',
    siteKey: 'example.com',
    url: 'https://example.com/a',
    text: `text ${id}`,
    color: 'yellow',
    comment: null,
    anchor: null,
    pageTitle: null,
    favicon: null,
    createdAt: 1_000,
    deletedAt: null,
    schemaVersion: 1,
  }
}

describe('sync engine push-then-pull gate', () => {
  beforeEach(async () => {
    const db = getDb()
    await Promise.all(db.tables.map((t) => t.clear()))
    pushRpc.mockReset()
    pullPage.mockReset()
    pullPage.mockResolvedValue([])
    sessionUser.id = 'u1'
    await write.setMeta('userId', 'u1')
    // A pending outbox row so the push actually calls the rpc.
    await write.upsert(draft('h1'), 'device-a')
  })

  it('never pushes or pulls when the session belongs to another account than meta.userId', async () => {
    sessionUser.id = 'u2'
    await pullNow()
    expect(pushRpc).not.toHaveBeenCalled()
    expect(pullPage).not.toHaveBeenCalled()
    // Nothing was sent, so the outbox item is untouched and no failure is counted.
    expect(await getDb().outbox.get('h1')).toMatchObject({ attempts: 0 })
    expect(await loadRetry()).toEqual({ failures: 0, backoffStep: 0, lastError: null })
  })

  it('still pulls when the push fails with a server error', async () => {
    pushRpc.mockRejectedValue(new HandlerError('server', 'boom'))
    await pullNow()
    expect(pushRpc).toHaveBeenCalled()
    expect(pullPage).toHaveBeenCalled()
  })

  it('still pulls when the push is rejected as a bad request', async () => {
    pushRpc.mockRejectedValue(new HandlerError('bad_request', 'bad row'))
    await pullNow()
    expect(pullPage).toHaveBeenCalled()
  })

  it.each<ErrorCode>(['network', 'unauthenticated'])('skips the pull when the push fails with %s', async (code) => {
    pushRpc.mockRejectedValue(new HandlerError(code, 'no'))
    await pullNow()
    expect(pushRpc).toHaveBeenCalled()
    expect(pullPage).not.toHaveBeenCalled()
  })
})

describe('sync engine retry and backoff', () => {
  const create = vi.mocked(chrome.alarms.create)

  beforeEach(async () => {
    const db = getDb()
    await Promise.all(db.tables.map((t) => t.clear()))
    pushRpc.mockReset()
    create.mockClear()
    sessionUser.id = 'u1'
    await write.setMeta('userId', 'u1')
    await write.upsert(draft('h1'), 'device-a')
  })

  /** delayInMinutes of the last sync-push alarm, in ms. */
  function lastPushAlarmMs(): number | undefined {
    const calls = create.mock.calls.filter(([name]) => name === 'sync-push')
    const info = calls.at(-1)?.[1] as { delayInMinutes?: number } | undefined
    return info?.delayInMinutes === undefined ? undefined : info.delayInMinutes * 60_000
  }

  it('failed pushes re-arm the alarm with 30s / 1m / 2m / 5m and mark the outbox item', async () => {
    pushRpc.mockRejectedValue(new HandlerError('server', 'boom'))
    const delays: Array<number | undefined> = []
    for (let i = 0; i < 5; i++) {
      await pushNow()
      delays.push(lastPushAlarmMs())
    }
    expect(delays).toEqual([30_000, 60_000, 120_000, 300_000, 300_000])
    const item = await getDb().outbox.get('h1')
    expect(item).toMatchObject({ attempts: 5, lastError: 'server' })
  })

  it('three failures turn syncStatus into error with the reason', async () => {
    pushRpc.mockRejectedValue(new HandlerError('server', 'boom'))
    await pushNow()
    await pushNow()
    await pushNow()
    const status = await retryNow()
    expect(status).toMatchObject({ state: 'error', pending: 1, lastError: { code: 'server' } })
  })

  it('sync/retry pushes immediately and resets the backoff', async () => {
    pushRpc.mockRejectedValue(new HandlerError('server', 'boom'))
    for (let i = 0; i < 3; i++) await pushNow()
    expect(lastPushAlarmMs()).toBe(120_000)
    const callsBefore = pushRpc.mock.calls.length
    // Still failing: retried at once, and the next delay starts over at 30s.
    await retryNow()
    expect(pushRpc.mock.calls.length).toBe(callsBefore + 1)
    expect(lastPushAlarmMs()).toBe(30_000)

    // Server back: the retry drains the outbox and the status returns to idle.
    pushRpc.mockImplementation(async (rows) => ({
      now_ms: Date.now(),
      rows: rows.map((r) => ({ ...r, user_id: 'u1', server_seq: 1 })),
    }))
    const status = await retryNow()
    expect(status).toMatchObject({ state: 'idle', pending: 0 })
    expect(status.lastError).toBeUndefined()
    expect(await loadRetry()).toEqual({ failures: 0, backoffStep: 0, lastError: null })
  })

  it('an auth failure is error at once and does not poll', async () => {
    pushRpc.mockRejectedValue(new HandlerError('unauthenticated', 'expired'))
    const status = await retryNow()
    expect(status.state).toBe('error')
    expect(lastPushAlarmMs()).toBeUndefined()
  })

  it('failed clock-refresh pushes with an empty outbox stay idle and arm no alarm', async () => {
    await getDb().outbox.clear()
    create.mockClear()
    pushRpc.mockRejectedValue(new HandlerError('network', 'offline'))
    await pullNow()
    await pullNow()
    await pullNow()
    // The clock-refresh call was still made on every run.
    expect(pushRpc).toHaveBeenCalledTimes(3)
    const { readSyncStatus } = await import('./status.ts')
    expect(await readSyncStatus()).toMatchObject({ state: 'idle', pending: 0 })
    expect(create.mock.calls.some(([name]) => name === 'sync-push')).toBe(false)
  })
})

describe('sync engine account wipes', () => {
  beforeEach(async () => {
    const db = getDb()
    await Promise.all(db.tables.map((t) => t.clear()))
    for (const k of Object.keys(storageItems)) delete storageItems[k]
    pushRpc.mockReset()
    authState.signedIn = true
    await write.upsert(draft('h1'), 'device-a')
  })

  it('first sign-in (no meta.userId) wipes every table and the legacy keys, keeps deviceId', async () => {
    Object.assign(storageItems, { highlights: [{}], enabledSites: ['a'], siteOverrides: { a: 'on' }, deviceId: 'dev', 'sb-auth': 's' })
    await write.setMeta('pullCursor', 42)
    expect(await reconcileAccount('user-a')).toBe(true)
    const db = getDb()
    expect(await db.highlights.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
    expect(await db.meta.toArray()).toEqual(
      expect.arrayContaining([
        { key: 'userId', value: 'user-a' },
        { key: 'pullCursor', value: 0 },
      ]),
    )
    expect(await db.meta.count()).toBe(2)
    expect(Object.keys(storageItems).sort()).toEqual(['deviceId', 'sb-auth'])
  })

  it('the same account signing in again keeps local data and the outbox', async () => {
    await write.setMeta('userId', 'user-a')
    expect(await reconcileAccount('user-a')).toBe(false)
    expect(await getDb().highlights.count()).toBe(1)
    expect(await getDb().outbox.count()).toBe(1)
  })

  it('another account triggers the wipe', async () => {
    await write.setMeta('userId', 'user-a')
    expect(await reconcileAccount('user-b')).toBe(true)
    expect(await getDb().highlights.count()).toBe(0)
    expect(await getDb().meta.get('userId')).toEqual({ key: 'userId', value: 'user-b' })
  })

  it('worker start with a session from before meta.userId reconciles, then pushes and pulls', async () => {
    sessionUser.id = 'u1'
    pullPage.mockReset()
    pullPage.mockResolvedValue([])
    pushRpc.mockResolvedValue({ now_ms: Date.now(), rows: [] })
    expect(await getDb().meta.get('userId')).toBeUndefined()
    await startSyncEngine()
    expect(await getDb().meta.get('userId')).toEqual({ key: 'userId', value: 'u1' })
    expect(pushRpc).toHaveBeenCalled()
    expect(pullPage).toHaveBeenCalled()
  })

  it('signed out: a run neither pushes nor writes logs', async () => {
    authState.signedIn = false
    await pushNow()
    expect(pushRpc).not.toHaveBeenCalled()
    expect(await getDb().outbox.count()).toBe(1)
    expect(await getDb().logs.count()).toBe(0)
  })
})
