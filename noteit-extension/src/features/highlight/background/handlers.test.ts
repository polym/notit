import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRouter, type Result } from '../../../core/messaging/index.ts'
import { getDb } from '../../../core/db/schema.ts'
import { read } from '../../../core/db/read.ts'
import { flushLogs } from '../../../core/log/index.ts'
import { STORAGE_KEYS, resetDeviceIdCache } from '../../../core/settings/index.ts'
import type { HighlightRecord } from '../../../core/model/index.ts'
import { debugHandlers, highlightHandlers, setBeforeLocalWrite, siteHandlers } from './handlers.ts'
import { setClockOffset, setNowForTests } from '../../../core/clock/index.ts'
import { setSignedInSource } from './auth-gate.ts'
import type {
  CreateHighlightReq,
  DebugDump,
  DebugRequests,
  HighlightRequests,
  PageState,
  SiteRequests,
} from '../shared/protocol.ts'

const EXTENSION_ID = 'noteit-test-id'
const self = { id: EXTENSION_ID } as chrome.runtime.MessageSender

function installChromeMock() {
  const store = new Map<string, unknown>()
  const chromeMock = {
    runtime: { id: EXTENSION_ID, sendMessage: vi.fn(async () => undefined) },
    tabs: {
      query: vi.fn(async () => [
        { id: 1, active: true, url: 'https://www.example.com/post?id=7&utm_source=y#other' },
        { id: 2, active: false, url: 'https://example.com/elsewhere' },
      ]),
      sendMessage: vi.fn(async () => undefined),
    },
    action: { setBadgeText: vi.fn(async () => {}), setBadgeBackgroundColor: vi.fn(async () => {}) },
    storage: {
      local: {
        get: vi.fn(async (key: string) => (store.has(key) ? { [key]: structuredClone(store.get(key)) } : {})),
        set: vi.fn(async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, structuredClone(v))
        }),
      },
    },
  }
  vi.stubGlobal('chrome', chromeMock)
  return { chromeMock, store }
}

type AllRequests = HighlightRequests & SiteRequests & DebugRequests
const router = createRouter<AllRequests>({ ...highlightHandlers, ...siteHandlers, ...debugHandlers })

function call<K extends keyof AllRequests>(
  type: K,
  req: unknown,
): Promise<Result<unknown>> {
  return router.handle({ kind: 'noteit/request', type, req }, self) as Promise<Result<unknown>>
}

async function expectOk<T>(p: Promise<Result<unknown>>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(`expected ok, got ${r.error.code}: ${r.error.message}`)
  return r.data as T
}

function createReq(overrides: Partial<CreateHighlightReq> = {}): CreateHighlightReq {
  return {
    id: crypto.randomUUID(),
    url: 'https://www.example.com/post?id=7&utm_source=x#top',
    text: 'quoted text',
    color: 'yellow',
    comment: null,
    anchor: { start: 10, end: 21, exact: 'quoted text', prefix: 'a ', suffix: ' b' },
    pageTitle: 'Post',
    favicon: 'https://www.example.com/favicon.ico',
    ...overrides,
  }
}

describe('highlight background handlers', () => {
  let mock: ReturnType<typeof installChromeMock>
  beforeEach(async () => {
    setSignedInSource(async () => true)
    mock = installChromeMock()
    resetDeviceIdCache()
    await flushLogs()
    const db = getDb()
    await Promise.all(db.tables.map((t) => t.clear()))
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    setBeforeLocalWrite(() => Promise.resolve())
    setNowForTests(null)
    setClockOffset(0)
  })

  it('a write waits for the before-write hook, so a clock offset loaded meanwhile is stamped in', async () => {
    setNowForTests(() => 1_000_000)
    let release!: () => void
    setBeforeLocalWrite(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            setClockOffset(120_000)
            resolve()
          }
        }),
    )
    const req = createReq()
    const pending = call('highlight/create', req)
    await new Promise((r) => setTimeout(r, 20))
    expect(await read.byId(req.id)).toBeUndefined()
    release()
    const rec = await expectOk<HighlightRecord>(pending)
    expect(rec.editedAt).toBe(1_120_000)
  })

  it('a rejecting before-write hook does not block the write', async () => {
    setBeforeLocalWrite(() => Promise.reject(new Error('boom')))
    const req = createReq()
    const rec = await expectOk<HighlightRecord>(call('highlight/create', req))
    expect(await read.byId(req.id)).toEqual(rec)
  })

  it('create computes canonicalUrl and siteKey, writes record + outbox and returns the record', async () => {
    const req = createReq()
    const rec = await expectOk<HighlightRecord>(call('highlight/create', req))
    expect(rec).toMatchObject({
      id: req.id,
      canonicalUrl: 'https://www.example.com/post?id=7',
      siteKey: 'example.com',
      url: req.url,
      color: 'yellow',
      deletedAt: null,
      schemaVersion: 1,
    })
    expect(rec.deviceId).toBe(mock.store.get(STORAGE_KEYS.deviceId))
    expect(await read.byId(req.id)).toEqual(rec)
    expect(await read.outboxItems()).toEqual([{ id: req.id, editedAt: rec.editedAt, attempts: 0 }])
  })

  it('create rejects a non-UUID id, a legacy color value and a non-http url with bad_request', async () => {
    for (const bad of [{ id: 'abc' }, { color: '#ffeb3b' as never }, { url: 'chrome://newtab' }]) {
      const r = await call('highlight/create', createReq(bad))
      expect(r).toMatchObject({ ok: false, error: { code: 'bad_request' } })
    }
    expect(await read.allIds()).toEqual([])
  })

  it('create with an existing id returns the stored record without a second write', async () => {
    const req = createReq()
    const first = await expectOk<HighlightRecord>(call('highlight/create', req))
    const again = await expectOk<HighlightRecord>(call('highlight/create', { ...req, color: 'blue' }))
    expect(again).toEqual(first)
  })

  it('two concurrent creates with the same id insert once and emit one db/changed', async () => {
    const req = createReq()
    const [a, b] = await Promise.all([
      expectOk<HighlightRecord>(call('highlight/create', req)),
      expectOk<HighlightRecord>(call('highlight/create', req)),
    ])
    expect(a.editedAt).toBe(b.editedAt)
    expect(a).toEqual(b)
    expect(await read.outboxItems()).toEqual([{ id: req.id, editedAt: a.editedAt, attempts: 0 }])
    const events = mock.chromeMock.runtime.sendMessage.mock.calls.map((c) => (c as unknown[])[0])
    expect(events).toEqual([{ kind: 'noteit/event', type: 'db/changed', payload: { ids: [req.id] } }])
  })

  it('create on a soft-deleted id or with a different url/text returns bad_request', async () => {
    const req = createReq()
    await expectOk(call('highlight/create', req))
    for (const other of [{ text: 'other text' }, { url: 'https://other.org/page' }]) {
      const r = await call('highlight/create', { ...req, ...other })
      expect(r).toMatchObject({ ok: false, error: { code: 'bad_request' } })
    }
    await expectOk(call('highlight/delete', { id: req.id }))
    const r = await call('highlight/create', req)
    expect(r).toMatchObject({ ok: false, error: { code: 'bad_request' } })
    expect((await read.byId(req.id))?.deletedAt).not.toBeNull()
  })

  it('update accepts only {color?, comment?}; a comment update keeps the color (FR8)', async () => {
    const req = createReq({ color: 'green' })
    const created = await expectOk<HighlightRecord>(call('highlight/create', req))
    const updated = await expectOk<HighlightRecord>(
      call('highlight/update', { id: req.id, patch: { comment: 'note', color: undefined } }),
    )
    expect(updated.comment).toBe('note')
    expect(updated.color).toBe('green')
    expect(updated.editedAt).toBeGreaterThan(created.editedAt)

    const recolored = await expectOk<HighlightRecord>(call('highlight/update', { id: req.id, patch: { color: 'blue' } }))
    expect(recolored).toMatchObject({ color: 'blue', comment: 'note' })

    for (const patch of [{ text: 'x' }, { color: 'red' }, {}, null]) {
      const r = await call('highlight/update', { id: req.id, patch })
      expect(r).toMatchObject({ ok: false, error: { code: 'bad_request' } })
    }
    expect((await read.byId(req.id))?.text).toBe('quoted text')
  })

  it('delete and restore are soft; unknown ids return not_found', async () => {
    const req = createReq()
    await expectOk(call('highlight/create', req))
    const deleted = await expectOk<HighlightRecord>(call('highlight/delete', { id: req.id }))
    expect(deleted.deletedAt).toBe(deleted.editedAt)
    expect(await read.byId(req.id)).toBeDefined()
    expect(await read.byCanonicalUrl(deleted.canonicalUrl)).toEqual([])

    const restored = await expectOk<HighlightRecord>(call('highlight/restore', { id: req.id }))
    expect(restored.deletedAt).toBeNull()
    expect(restored.editedAt).toBeGreaterThan(deleted.editedAt)

    const missing = crypto.randomUUID()
    for (const type of ['highlight/update', 'highlight/delete', 'highlight/restore'] as const) {
      const r = await call(type, { id: missing, patch: { comment: 'x' } })
      expect(r).toMatchObject({ ok: false, error: { code: 'not_found' } })
    }
  })

  it('a QuotaExceededError inside the transaction returns quota and leaves both tables unchanged', async () => {
    const db = getDb()
    vi.spyOn(db.outbox, 'put').mockImplementation(() => {
      throw new DOMException('quota exceeded', 'QuotaExceededError')
    })
    const r = await call('highlight/create', createReq())
    expect(r).toMatchObject({ ok: false, error: { code: 'quota' } })
    expect(await db.highlights.count()).toBe(0)
    expect(await db.outbox.count()).toBe(0)
  })

  it('any other transaction failure returns internal', async () => {
    const req = createReq()
    await expectOk(call('highlight/create', req))
    vi.spyOn(getDb().outbox, 'put').mockImplementation(() => {
      throw new Error('disk on fire')
    })
    const r = await call('highlight/update', { id: req.id, patch: { comment: 'x' } })
    expect(r).toMatchObject({ ok: false, error: { code: 'internal' } })
    expect((await read.byId(req.id))?.comment).toBeNull()
  })

  it('emits db/changed {ids} after every committed write and not on failure', async () => {
    const req = createReq()
    await expectOk(call('highlight/create', req))
    await expectOk(call('highlight/update', { id: req.id, patch: { comment: 'c' } }))
    await expectOk(call('highlight/delete', { id: req.id }))
    await expectOk(call('highlight/restore', { id: req.id }))
    await call('highlight/delete', { id: crypto.randomUUID() })
    const events = mock.chromeMock.runtime.sendMessage.mock.calls.map((c) => (c as unknown[])[0])
    expect(events).toEqual(
      Array.from({ length: 4 }, () => ({ kind: 'noteit/event', type: 'db/changed', payload: { ids: [req.id] } })),
    )
  })

  it('login gate: signed out, every highlight/* write returns unauthenticated and writes nothing', async () => {
    const req = createReq()
    await expectOk(call('highlight/create', req))
    setSignedInSource(async () => false)
    const before = await read.byId(req.id)
    for (const [type, body] of [
      ['highlight/create', createReq()],
      ['highlight/update', { id: req.id, patch: { color: 'blue' } }],
      ['highlight/delete', { id: req.id }],
      ['highlight/restore', { id: req.id }],
    ] as const) {
      expect(await call(type, body)).toMatchObject({ ok: false, error: { code: 'unauthenticated' } })
    }
    expect(await read.byId(req.id)).toEqual(before)
    expect(await read.allIds()).toEqual([req.id])
    const state = await expectOk<PageState>(call('page/getState', { url: req.url }))
    expect(state.signedIn).toBe(false)
    expect(state.highlights.map((h) => h.id)).toEqual([req.id])
  })

  it('page/getState returns canonical identity, D8 enabled state and live highlights', async () => {
    const url = 'https://example.com/post?utm_medium=y'
    const empty = await expectOk<PageState>(call('page/getState', { url }))
    expect(empty).toEqual({
      canonicalUrl: 'https://example.com/post',
      siteKey: 'example.com',
      enabled: false,
      signedIn: true,
      highlights: [],
    })

    const req = createReq({ url: 'https://example.com/post#x' })
    await expectOk(call('highlight/create', req))
    const withOne = await expectOk<PageState>(call('page/getState', { url }))
    expect(withOne.enabled).toBe(true)
    expect(withOne.highlights.map((h) => h.id)).toEqual([req.id])

    mock.store.set(STORAGE_KEYS.siteOverrides, { 'example.com': 'off' })
    expect((await expectOk<PageState>(call('page/getState', { url }))).enabled).toBe(false)
    mock.store.set(STORAGE_KEYS.siteOverrides, { 'other.org': 'on' })
    expect((await expectOk<PageState>(call('page/getState', { url: 'https://other.org/' }))).enabled).toBe(true)

    expect(await call('page/getState', { url: 'about:blank' })).toMatchObject({ ok: false, error: { code: 'bad_request' } })
  })

  it('debug/dump returns ids (including deleted), outbox, syncStatus and logs', async () => {
    const a = createReq()
    const b = createReq()
    await expectOk(call('highlight/create', a))
    await expectOk(call('highlight/create', b))
    await expectOk(call('highlight/delete', { id: b.id }))
    const dump = await expectOk<DebugDump>(call('debug/dump', undefined))
    expect(dump.ids.sort()).toEqual([a.id, b.id].sort())
    expect(dump.outbox.map((o) => o.id).sort()).toEqual([a.id, b.id].sort())
    expect(dump.syncStatus).toMatchObject({ state: 'idle', pending: 2, lastSyncAt: null })
    expect(dump.logs.some((l) => l.event === 'create' && l.data?.id === a.id)).toBe(true)
  })

  it('site/setEnabled writes the siteOverrides entry that page/getState reads', async () => {
    const url = 'https://example.com/a'
    await expectOk(call('site/setEnabled', { siteKey: 'example.com', enabled: true }))
    expect(mock.store.get(STORAGE_KEYS.siteOverrides)).toEqual({ 'example.com': 'on' })
    expect((await expectOk<PageState>(call('page/getState', { url }))).enabled).toBe(true)
    await expectOk(call('site/setEnabled', { siteKey: 'example.com', enabled: false }))
    expect((await expectOk<PageState>(call('page/getState', { url }))).enabled).toBe(false)
    expect(await call('site/setEnabled', { siteKey: '', enabled: true })).toMatchObject({
      ok: false,
      error: { code: 'bad_request' },
    })
  })

  it('broadcasts page/sync to tabs of the same canonicalUrl after each commit', async () => {
    const req = createReq()
    await expectOk(call('highlight/create', req))
    await vi.waitFor(() => expect(mock.chromeMock.tabs.sendMessage).toHaveBeenCalledTimes(1))
    expect(mock.chromeMock.tabs.sendMessage).toHaveBeenCalledWith(1, {
      kind: 'noteit/event',
      type: 'page/sync',
      payload: expect.objectContaining({
        canonicalUrl: 'https://www.example.com/post?id=7',
        removes: [],
        enabled: true,
        upserts: [expect.objectContaining({ id: req.id })],
      }),
    })
    await vi.waitFor(() => expect(mock.chromeMock.action.setBadgeText).toHaveBeenCalledWith({ text: '1', tabId: 1 }))
    await expectOk(call('highlight/delete', { id: req.id }))
    await vi.waitFor(() => expect(mock.chromeMock.tabs.sendMessage).toHaveBeenCalledTimes(2))
    expect(mock.chromeMock.tabs.sendMessage).toHaveBeenLastCalledWith(1, {
      kind: 'noteit/event',
      type: 'page/sync',
      payload: expect.objectContaining({ upserts: [], removes: [req.id], enabled: false }),
    })
    await vi.waitFor(() => expect(mock.chromeMock.action.setBadgeText).toHaveBeenLastCalledWith({ text: '', tabId: 1 }))
  })
})
