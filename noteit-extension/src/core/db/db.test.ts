import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getDb } from './schema.ts'
import { byCanonicalUrl, byCanonicalUrls, byId, liveCount, lostIds, outboxItems, recent } from './read.ts'
import { applyAnchorReport, restore, softDelete, update, upsert, type HighlightDraft } from './write.ts'
import { setNowForTests } from '../clock/index.ts'
import type { HighlightRecord } from '../model/highlight.ts'

const DEVICE = 'device-a'

function draft(id: string, overrides: Partial<HighlightDraft> = {}): HighlightDraft {
  return {
    id,
    userId: 'user-1',
    canonicalUrl: 'https://example.com/a',
    siteKey: 'example.com',
    url: 'https://example.com/a?utm_source=x',
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

async function clearAll(): Promise<void> {
  const db = getDb()
  await Promise.all(db.tables.map((t) => t.clear()))
}

describe('core/db schema', () => {
  it('opens database "noteit" version 1 with the D4 tables and indexes', async () => {
    const db = getDb()
    await db.open()
    expect(db.name).toBe('noteit')
    expect(db.verno).toBe(1)
    expect(db.tables.map((t) => t.name).sort()).toEqual(['anchorStatus', 'highlights', 'logs', 'meta', 'outbox'])
    const indexes = db.highlights.schema.indexes.map((i) => i.name).sort()
    expect(indexes).toEqual(['[canonicalUrl+deletedAt]', 'canonicalUrl', 'createdAt', 'siteKey'])
  })
})

describe('core/db write', () => {
  let now = 10_000
  beforeEach(async () => {
    now = 10_000
    setNowForTests(() => now)
    await clearAll()
  })
  afterEach(() => {
    setNowForTests(null)
    vi.restoreAllMocks()
  })

  it('upsert writes the record and its outbox item together', async () => {
    const rec = await upsert(draft('h1'), DEVICE)
    expect(rec).toMatchObject({ id: 'h1', editedAt: 10_000, deviceId: DEVICE })
    expect(await byId('h1')).toEqual(rec)
    expect(await outboxItems()).toEqual([{ id: 'h1', editedAt: 10_000, attempts: 0 }])
  })

  it('upsert re-stamps above the previous editedAt and keeps createdAt', async () => {
    await upsert(draft('h1'), DEVICE)
    const again = await upsert(draft('h1', { color: 'blue', createdAt: 99_999 }), 'device-b')
    expect(again.editedAt).toBe(10_001)
    expect(again.createdAt).toBe(1_000)
    expect(again.deviceId).toBe('device-b')
    expect(await outboxItems()).toEqual([{ id: 'h1', editedAt: 10_001, attempts: 0 }])
  })

  it('leaves both tables unchanged when the transaction throws midway', async () => {
    const before = await upsert(draft('h1'), DEVICE)
    const db = getDb()
    vi.spyOn(db.outbox, 'put').mockRejectedValueOnce(new Error('boom'))
    await expect(upsert(draft('h1', { comment: 'changed' }), DEVICE)).rejects.toThrow('boom')
    vi.spyOn(db.outbox, 'put').mockRejectedValueOnce(new Error('boom'))
    await expect(upsert(draft('h2'), DEVICE)).rejects.toThrow('boom')
    expect(await byId('h1')).toEqual(before)
    expect(await byId('h2')).toBeUndefined()
    expect(await outboxItems()).toEqual([{ id: 'h1', editedAt: before.editedAt, attempts: 0 }])
  })

  it('update applies the patch with a fresh stamp and returns null for unknown ids', async () => {
    await upsert(draft('h1', { color: 'green' }), DEVICE)
    const next = await update('h1', { comment: 'note' }, DEVICE)
    expect(next).toMatchObject({ comment: 'note', color: 'green', editedAt: 10_001 })
    expect(await update('missing', { comment: 'x' }, DEVICE)).toBeNull()
  })

  it('softDelete sets deletedAt = editedAt and hides the row from byCanonicalUrl', async () => {
    await upsert(draft('h1'), DEVICE)
    await upsert(draft('h2'), DEVICE)
    now = 20_000
    const deleted = await softDelete('h1', DEVICE)
    expect(deleted?.deletedAt).toBe(20_000)
    expect(deleted?.editedAt).toBe(20_000)
    expect((await byCanonicalUrl('https://example.com/a')).map((r) => r.id)).toEqual(['h2'])
    expect((await recent(10)).map((r) => r.id)).toEqual(['h2'])
    expect((await byId('h1'))?.deletedAt).toBe(20_000)
    expect(await outboxItems()).toContainEqual({ id: 'h1', editedAt: 20_000, attempts: 0 })
    expect(await softDelete('missing', DEVICE)).toBeNull()
  })

  it('byCanonicalUrls returns live rows of the given pages and liveCount counts live rows', async () => {
    await upsert(draft('h1'), DEVICE)
    await upsert(draft('h2', { canonicalUrl: 'https://example.com/b' }), DEVICE)
    await upsert(draft('h3', { canonicalUrl: 'https://example.com/c' }), DEVICE)
    await softDelete('h2', DEVICE)
    const rows = await byCanonicalUrls(['https://example.com/a', 'https://example.com/b'])
    expect(rows.map((r) => r.id)).toEqual(['h1'])
    expect(await byCanonicalUrls([])).toEqual([])
    expect(await liveCount()).toBe(2)
  })

  it('restore clears deletedAt and stamps again', async () => {
    await upsert(draft('h1'), DEVICE)
    const deleted = await softDelete('h1', DEVICE)
    const restored = await restore('h1', DEVICE)
    expect(restored?.deletedAt).toBeNull()
    expect(restored!.editedAt).toBeGreaterThan(deleted!.editedAt)
    expect((await byCanonicalUrl('https://example.com/a')).map((r) => r.id)).toEqual(['h1'])
    expect(await outboxItems()).toEqual([{ id: 'h1', editedAt: restored!.editedAt, attempts: 0 }])
    expect(await restore('missing', DEVICE)).toBeNull()
  })
})

describe('core/db anchorStatus', () => {
  beforeEach(clearAll)

  it('writes lost rows, deletes them when found, and ignores unknown ids', async () => {
    await upsert(draft('h1'), DEVICE)
    await upsert(draft('h2'), DEVICE)
    expect(await applyAnchorReport([], ['h1', 'missing'], 5)).toEqual(['h1'])
    expect(await lostIds()).toEqual(['h1'])
    expect(await getDb().anchorStatus.get('h1')).toEqual({ id: 'h1', status: 'lost', checkedAt: 5 })

    // A repeat only refreshes checkedAt and reports no change.
    expect(await applyAnchorReport(['h2'], ['h1'], 9)).toEqual([])
    expect((await getDb().anchorStatus.get('h1'))?.checkedAt).toBe(9)

    expect(await applyAnchorReport(['h1'], [], 10)).toEqual(['h1'])
    expect(await lostIds()).toEqual([])
    // anchorStatus is local only: no outbox item comes from a report.
    expect((await outboxItems()).map((o) => o.id).sort()).toEqual(['h1', 'h2'])
  })
})

describe('core/db read with 10,000 records', () => {
  const TOTAL = 10_000
  const PAGES = 500

  beforeEach(async () => {
    await clearAll()
    const rows: HighlightRecord[] = []
    for (let i = 0; i < TOTAL; i++) {
      rows.push({
        ...draft(`h${i}`, {
          canonicalUrl: `https://example.com/p${i % PAGES}`,
          createdAt: i,
          deletedAt: i % 50 === 0 ? i : null,
        }),
        editedAt: i,
        deviceId: DEVICE,
      })
    }
    await getDb().highlights.bulkPut(rows)
  }, 60_000)

  async function time<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
    const start = performance.now()
    const value = await fn()
    return { ms: performance.now() - start, value }
  }

  it('byCanonicalUrl and recent(200) use indexes and run under 50ms', async () => {
    const db = getDb()
    // Warm up once so the first-call cost of opening cursors is not measured.
    await byCanonicalUrl('https://example.com/p1')
    await recent(200)

    const page = await time(() => byCanonicalUrl('https://example.com/p7'))
    const latest = await time(() => recent(200))
    // Unindexed baseline: a full table scan with the same predicates.
    const scan = await time(async () => {
      const all = await db.highlights.toArray()
      return all.filter((r) => r.canonicalUrl === 'https://example.com/p7' && r.deletedAt === null)
    })

    expect(page.value).toHaveLength(TOTAL / PAGES)
    expect(page.value.every((r) => r.deletedAt === null)).toBe(true)
    expect(latest.value).toHaveLength(200)
    expect(latest.value[0].createdAt).toBe(TOTAL - 1)
    expect(latest.value.every((r, i, a) => i === 0 || a[i - 1].createdAt > r.createdAt)).toBe(true)
    expect(latest.value.some((r) => r.deletedAt !== null)).toBe(false)

    expect(page.ms).toBeLessThan(50)
    expect(latest.ms).toBeLessThan(50)
    // Relative check: indexed reads are clearly cheaper than scanning the whole table.
    expect(page.ms).toBeLessThan(scan.ms)
    expect(latest.ms).toBeLessThan(scan.ms)
  }, 60_000)
})
