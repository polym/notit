import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from '../../db/schema.ts'
import { read } from '../../db/read.ts'
import { write, type HighlightDraft } from '../../db/write.ts'
import type { HighlightRecord } from '../../model/index.ts'
import { toPushRow } from '../mapping.ts'
import { PULL_PAGE_SIZE, pullAll, type PullPageFetch } from './pull.ts'
import { throttle } from './alarms.ts'

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

function remoteRecord(id: string, overrides: Partial<HighlightRecord> = {}): HighlightRecord {
  return { ...draft(id), userId: USER, editedAt: 5_000, deviceId: 'device-b', ...overrides }
}

type ServerRow = Record<string, unknown> & { server_seq: number }

function serverRow(record: HighlightRecord, seq: number): ServerRow {
  return { ...toPushRow(record), user_id: record.userId, server_seq: seq }
}

/** In-memory `server_seq > cursor order by server_seq limit n`. */
function fakeTable(rows: ServerRow[]) {
  const cursors: number[] = []
  const fetch: PullPageFetch = async (cursor, limit) => {
    cursors.push(cursor)
    return rows
      .filter((r) => r.server_seq > cursor)
      .sort((a, b) => a.server_seq - b.server_seq)
      .slice(0, limit)
  }
  return { fetch, cursors }
}

async function clearAll(): Promise<void> {
  const db = getDb()
  await Promise.all(db.tables.map((t) => t.clear()))
}

describe('core/sync pull merge', () => {
  beforeEach(clearAll)

  it('absent locally: writes the remote row without an outbox item', async () => {
    const remote = remoteRecord('a')
    const summary = await pullAll(fakeTable([serverRow(remote, 1)]).fetch)
    expect(summary.applied.map((r) => r.id)).toEqual(['a'])
    expect(await read.byId('a')).toEqual(remote)
    expect(await read.outboxCount()).toBe(0)
    expect(await read.getMeta('pullCursor')).toBe(1)
  })

  it('remote newer: overwrites the local row and drops its outbox item', async () => {
    const local = await write.upsert(draft('a', { comment: 'mine' }), DEVICE)
    expect(await read.outboxCount()).toBe(1)
    const remote = remoteRecord('a', { comment: 'theirs', editedAt: local.editedAt + 10 })
    await pullAll(fakeTable([serverRow(remote, 7)]).fetch)
    expect(await read.byId('a')).toEqual(remote)
    expect(await read.outboxCount()).toBe(0)
  })

  it('local newer (pending in the outbox): keeps the local row and its outbox item', async () => {
    const local = await write.upsert(draft('a', { comment: 'mine' }), DEVICE)
    const remote = remoteRecord('a', { comment: 'theirs', editedAt: local.editedAt - 10 })
    const summary = await pullAll(fakeTable([serverRow(remote, 3)]).fetch)
    expect(summary.applied).toEqual([])
    expect(await read.byId('a')).toEqual(local)
    expect(await read.outboxItems()).toEqual([{ id: 'a', editedAt: local.editedAt, attempts: 0 }])
    // The cursor still moves past the row.
    expect(await read.getMeta('pullCursor')).toBe(3)
  })

  it('equal version: keeps the local row (no rewrite)', async () => {
    const remote = remoteRecord('a')
    await pullAll(fakeTable([serverRow(remote, 1)]).fetch)
    const summary = await pullAll(fakeTable([serverRow(remote, 2)]).fetch)
    expect(summary.applied).toEqual([])
  })

  it('a newer remote delete is applied; an older local live version does not bring it back', async () => {
    const local = await write.upsert(draft('a'), DEVICE)
    const deleted = remoteRecord('a', { editedAt: local.editedAt + 5, deletedAt: local.editedAt + 5 })
    await pullAll(fakeTable([serverRow(deleted, 4)]).fetch)
    expect((await read.byId('a'))?.deletedAt).toBe(local.editedAt + 5)
    expect(await read.outboxCount()).toBe(0)
    // A stale live copy of the row arriving later (older editedAt) is ignored.
    await pullAll(fakeTable([serverRow({ ...local, userId: USER }, 9)]).fetch)
    expect((await read.byId('a'))?.deletedAt).toBe(local.editedAt + 5)
    expect(await read.byCanonicalUrl('https://example.com/a')).toEqual([])
  })

  it('pull-only: no outbox items are created (FR36)', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => serverRow(remoteRecord(`r-${i}`), i + 1))
    await pullAll(fakeTable(rows).fetch)
    expect((await read.allIds()).length).toBe(20)
    expect(await read.outboxCount()).toBe(0)
  })
})

describe('core/sync pull paging and cursor', () => {
  beforeEach(clearAll)

  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => serverRow(remoteRecord(`id-${String(i).padStart(4, '0')}`), 10 + i * 2))

  it('pulls 1,200 rows in 3 pages and advances the cursor to the max server_seq', async () => {
    const table = fakeTable(rows(1200))
    const summary = await pullAll(table.fetch)
    expect(table.cursors).toEqual([0, 10 + 499 * 2, 10 + 999 * 2])
    expect(summary).toMatchObject({ pages: 3, received: 1200, cursor: 10 + 1199 * 2 })
    expect(await read.getMeta('pullCursor')).toBe(10 + 1199 * 2)
    expect((await read.allIds()).length).toBe(1200)
  })

  it('an exact multiple of the page size ends with one empty page', async () => {
    const table = fakeTable(rows(PULL_PAGE_SIZE))
    const summary = await pullAll(table.fetch)
    expect(summary.pages).toBe(2)
  })

  it('a failure on page 2 keeps the page-1 cursor; the retry starts at page 2', async () => {
    const table = fakeTable(rows(1200))
    let calls = 0
    const failing: PullPageFetch = async (cursor, limit) => {
      if (++calls === 2) throw new Error('offline')
      return table.fetch(cursor, limit)
    }
    await expect(pullAll(failing)).rejects.toThrow('offline')
    const afterPage1 = 10 + 499 * 2
    expect(await read.getMeta('pullCursor')).toBe(afterPage1)
    expect((await read.allIds()).length).toBe(500)

    table.cursors.length = 0
    await pullAll(table.fetch)
    expect(table.cursors).toEqual([afterPage1, 10 + 999 * 2])
    expect((await read.allIds()).length).toBe(1200)
  })

  it('an invalid row is skipped but still advances the cursor', async () => {
    const bad = { ...serverRow(remoteRecord('bad'), 5), color: 'purple' }
    await pullAll(fakeTable([bad, serverRow(remoteRecord('ok'), 6)]).fetch)
    expect(await read.allIds()).toEqual(['ok'])
    expect(await read.getMeta('pullCursor')).toBe(6)
  })

  it('accepts server_seq as a numeric string', async () => {
    const row = { ...serverRow(remoteRecord('s'), 0), server_seq: '42' }
    const fetch: PullPageFetch = async (cursor) => (cursor < 42 ? [row] : [])
    await pullAll(fetch)
    expect(await read.getMeta('pullCursor')).toBe(42)
  })
})

describe('core/sync tab pull throttle', () => {
  it('runs once per 30s window', () => {
    let t = 0
    const fn = vi.fn()
    const throttled = throttle(fn, 30_000, () => t)
    throttled()
    t = 1_000
    throttled()
    t = 29_999
    throttled()
    expect(fn).toHaveBeenCalledTimes(1)
    t = 30_000
    throttled()
    t = 30_500
    throttled()
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
