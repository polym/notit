import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../../db/schema.ts'
import { read } from '../../db/read.ts'
import { write, type HighlightDraft } from '../../db/write.ts'
import { getClockOffset, setClockOffset, setNowForTests } from '../../clock/index.ts'
import type { HighlightRecord } from '../../model/index.ts'
import { wins } from '../merge.ts'
import { toPushRow, type PushRow } from '../mapping.ts'
import { PUSH_BATCH_SIZE, loadClockOffset, pushAll, type SyncPushRpc } from './push.ts'

const DEVICE = 'device-a'
const USER = 'user-1'

function draft(id: string, overrides: Partial<HighlightDraft> = {}): HighlightDraft {
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
    ...overrides,
  }
}

type StoredRow = PushRow & { user_id: string; server_seq: number }

/** In-memory sync_push with the same LWW rule as the SQL function. */
function fakeServer(nowMs: () => number = () => Date.now()) {
  const rows = new Map<string, StoredRow>()
  let seq = 0
  const calls: PushRow[][] = []
  const rpc: SyncPushRpc = async (incoming) => {
    calls.push(incoming)
    for (const row of incoming) {
      const stored = rows.get(row.id)
      const key = (r: PushRow) => ({ editedAt: r.edited_at, deviceId: r.device_id })
      if (!stored || wins(key(row), key(stored))) rows.set(row.id, { ...row, user_id: USER, server_seq: ++seq })
    }
    return { now_ms: nowMs(), rows: incoming.map((r) => rows.get(r.id)) }
  }
  return { rows, calls, rpc }
}

async function clearAll(): Promise<void> {
  const db = getDb()
  await Promise.all(db.tables.map((t) => t.clear()))
}

describe('core/sync push', () => {
  beforeEach(clearAll)
  afterEach(() => {
    setNowForTests(null)
    setClockOffset(0)
  })

  it('accepted and not edited since: deletes the outbox item and fills in userId', async () => {
    await write.upsert(draft('a'), DEVICE)
    const server = fakeServer()
    const summary = await pushAll(server.rpc)
    expect(summary).toMatchObject({ pushed: 1, cleared: 1, calls: 1 })
    expect(await read.outboxItems()).toEqual([])
    const local = await read.byId('a')
    expect(local?.userId).toBe(USER)
    // Filling in userId is not an edit: editedAt and the outbox are unchanged.
    expect(local?.editedAt).toBe(server.rows.get('a')?.edited_at)
    expect(await read.getMeta('lastSyncAt')).toEqual(expect.any(Number))
  })

  it('accepted but edited again during the push: keeps the outbox item', async () => {
    await write.upsert(draft('a'), DEVICE)
    const server = fakeServer()
    let edited = false
    const rpc: SyncPushRpc = async (rows) => {
      const answer = await server.rpc(rows)
      if (!edited) {
        edited = true
        await write.update('a', { comment: 'later' }, DEVICE)
      }
      return answer
    }
    await pushAll(rpc)
    // The first batch made no progress, so the run stops; the new edit is still pending.
    const outbox = await read.outboxItems()
    expect(outbox).toHaveLength(1)
    const local = await read.byId('a')
    expect(local?.comment).toBe('later')
    expect(outbox[0].editedAt).toBe(local?.editedAt)
    expect(server.rows.get('a')?.comment).toBeNull()

    // The next push sends the newer version and clears it.
    await pushAll(server.rpc)
    expect(await read.outboxItems()).toEqual([])
    expect(server.rows.get('a')?.comment).toBe('later')
  })

  it('rejected: applies the newer server row by LWW and deletes the outbox item', async () => {
    const mine = await write.upsert(draft('a', { comment: 'mine' }), DEVICE)
    const server = fakeServer()
    server.rows.set('a', {
      ...toPushRow({ ...mine, comment: 'theirs', editedAt: mine.editedAt + 10, deviceId: 'device-b' }),
      user_id: USER,
      server_seq: 1,
    })
    const summary = await pushAll(server.rpc)
    expect(summary.applied.map((r) => r.id)).toEqual(['a'])
    expect(await read.outboxItems()).toEqual([])
    const local = await read.byId('a')
    expect(local).toMatchObject({ comment: 'theirs', deviceId: 'device-b', editedAt: mine.editedAt + 10, userId: USER })
  })

  it('rejected while a newer local edit is pending: keeps the local edit and its outbox item', async () => {
    const mine = await write.upsert(draft('a', { comment: 'mine' }), DEVICE)
    const server = fakeServer()
    server.rows.set('a', {
      ...toPushRow({ ...mine, comment: 'theirs', editedAt: mine.editedAt + 1, deviceId: 'device-b' }),
      user_id: USER,
      server_seq: 1,
    })
    let edited = false
    const rpc: SyncPushRpc = async (rows) => {
      const answer = await server.rpc(rows)
      if (!edited) {
        edited = true
        // stamp() is above the remote editedAt only when it is above prev + 1; force it.
        setNowForTests(() => mine.editedAt + 1_000)
        await write.update('a', { comment: 'newest' }, DEVICE)
      }
      return answer
    }
    await pushAll(rpc)
    expect((await read.byId('a'))?.comment).toBe('newest')
    expect(await read.outboxItems()).toHaveLength(1)
  })

  it('a remote row that fails validation leaves the outbox item for the next attempt', async () => {
    await write.upsert(draft('a'), DEVICE)
    const rpc: SyncPushRpc = async (rows) => ({ now_ms: Date.now(), rows: rows.map((r) => ({ ...r, color: 'purple' })) })
    await pushAll(rpc)
    expect(await read.outboxItems()).toHaveLength(1)
  })

  it('pushes 150 items in two batches of 100 and 50', async () => {
    for (let i = 0; i < 150; i++) await write.upsert(draft(`id-${String(i).padStart(3, '0')}`), DEVICE)
    const server = fakeServer()
    const summary = await pushAll(server.rpc)
    expect(server.calls.map((c) => c.length)).toEqual([PUSH_BATCH_SIZE, 50])
    expect(summary).toMatchObject({ pushed: 150, cleared: 150, calls: 2 })
    expect(await read.outboxCount()).toBe(0)
    expect(server.rows.size).toBe(150)
  })

  it('an empty outbox still makes one call (clock) and sends no rows', async () => {
    const server = fakeServer()
    const summary = await pushAll(server.rpc)
    expect(server.calls).toEqual([[]])
    expect(summary.calls).toBe(1)
  })

  it('an rpc failure leaves the outbox untouched and rethrows', async () => {
    await write.upsert(draft('a'), DEVICE)
    const rpc = vi.fn<SyncPushRpc>(async () => {
      throw new Error('offline')
    })
    await expect(pushAll(rpc)).rejects.toThrow('offline')
    expect(await read.outboxItems()).toHaveLength(1)
  })

  it('soft deletes are pushed as ordinary edits', async () => {
    await write.upsert(draft('a'), DEVICE)
    await write.softDelete('a', DEVICE)
    const server = fakeServer()
    await pushAll(server.rpc)
    expect(server.rows.get('a')?.deleted_at).toEqual(expect.any(Number))
    expect(await read.outboxItems()).toEqual([])
  })
})

describe('core/sync clock offset', () => {
  beforeEach(clearAll)
  afterEach(() => {
    setNowForTests(null)
    setClockOffset(0)
  })

  const LOCAL = 1_700_000_000_000

  it('a 30s skew is ignored (clockOffsetMs = 0)', async () => {
    const server = fakeServer(() => LOCAL + 30_000)
    await pushAll(server.rpc, { now: () => LOCAL })
    expect(getClockOffset()).toBe(0)
    expect(await read.getMeta('clockOffsetMs')).toBe(0)
  })

  it('a 2h skew is applied as the round-trip estimate and persisted', async () => {
    const twoHours = 2 * 60 * 60 * 1000
    let t = LOCAL
    // Request starts at LOCAL, answer arrives 200ms later: midpoint LOCAL + 100.
    const now = () => {
      const v = t
      t += 200
      return v
    }
    const server = fakeServer(() => LOCAL + 100 + twoHours)
    await pushAll(server.rpc, { now })
    expect(getClockOffset()).toBe(twoHours)
    expect(await read.getMeta('clockOffsetMs')).toBe(twoHours)

    // A fresh worker loads the stored offset, and stamps use it.
    setClockOffset(0)
    await loadClockOffset()
    expect(getClockOffset()).toBe(twoHours)
    setNowForTests(() => LOCAL)
    const record: HighlightRecord = await write.upsert(draft('z'), DEVICE)
    expect(record.editedAt).toBe(LOCAL + twoHours)
  })
})
