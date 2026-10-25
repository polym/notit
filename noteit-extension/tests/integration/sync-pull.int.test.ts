// Sync pull against the local stack (Story 2.17, D3): paging by server_seq, cursor advance and resume
// after a failed page. Prerequisite: `npm run db:start && npm run db:reset`.
import 'fake-indexeddb/auto'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { clearCloudRows, getLocalSupabaseEnv, TEST_USERS } from '../helpers/local-supabase.ts'
import { getDb } from '../../src/core/db/schema.ts'
import { read } from '../../src/core/db/read.ts'
import { toPushRow } from '../../src/core/sync/mapping.ts'
import type { HighlightRecord } from '../../src/core/model/index.ts'
import { PULL_PAGE_SIZE, pullAll, type PullPageFetch } from '../../src/core/sync/background/pull.ts'
import { pushAll } from '../../src/core/sync/background/push.ts'
import { supabasePullPage, supabaseRpc } from '../../src/core/sync/background/rpc.ts'

async function signedInClient(): Promise<SupabaseClient> {
  const env = getLocalSupabaseEnv()
  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { error } = await client.auth.signInWithPassword(TEST_USERS.a)
  if (error) throw new Error('sign-in failed', { cause: error })
  return client
}

async function resetLocal(): Promise<void> {
  const db = getDb()
  await Promise.all(db.tables.map((t) => t.clear()))
}

async function maxServerSeq(client: SupabaseClient): Promise<number> {
  const { data, error } = await client.from('highlights').select('server_seq').order('server_seq', { ascending: false }).limit(1)
  if (error) throw new Error(`select failed: ${error.message}`)
  return data.length === 0 ? 0 : Number(data[0].server_seq)
}

function record(id: string, editedAt: number, overrides: Partial<HighlightRecord> = {}): HighlightRecord {
  return {
    id,
    userId: '',
    canonicalUrl: 'https://example.com/pull',
    siteKey: 'example.com',
    url: 'https://example.com/pull',
    text: 'Pull highlight text',
    color: 'blue',
    comment: null,
    anchor: null,
    pageTitle: null,
    favicon: null,
    createdAt: 1_000,
    editedAt,
    deviceId: 'device-b',
    deletedAt: null,
    schemaVersion: 1,
    ...overrides,
  }
}

/** Writes rows to the cloud as "device B" through sync_push, in chunks of 100. */
async function pushFromDeviceB(client: SupabaseClient, records: HighlightRecord[]): Promise<void> {
  for (let i = 0; i < records.length; i += 100) {
    const { error } = await client.rpc('sync_push', { rows: records.slice(i, i + 100).map(toPushRow) })
    if (error) throw new Error(`sync_push failed: ${error.message}`)
  }
}

describe('sync pull (local Supabase)', () => {
  let client: SupabaseClient

  beforeAll(async () => {
    client = await signedInClient()
  })

  beforeEach(async () => {
    await resetLocal()
    // Only this test's rows are in the account, pulled from cursor 0.
    clearCloudRows(TEST_USERS.a.email)
  })

  it('pulls 1,200 rows in 3 pages and advances the cursor to the max server_seq', async () => {
    const base = Date.now()
    const rows = Array.from({ length: 1200 }, (_, i) => record(`pull-${crypto.randomUUID()}`, base + i))
    await pushFromDeviceB(client, rows)
    const head = await maxServerSeq(client)

    const fetch = supabasePullPage(client)
    const cursors: number[] = []
    const counting: PullPageFetch = (cursor, limit) => {
      cursors.push(cursor)
      return fetch(cursor, limit)
    }
    const summary = await pullAll(counting)
    expect(summary.received).toBe(1200)
    expect(summary.pages).toBe(3)
    expect(cursors).toHaveLength(3)
    expect(await read.getMeta('pullCursor')).toBe(head)
    expect(await read.outboxCount()).toBe(0)
    const ids = new Set(await read.allIds())
    expect(rows.every((r) => ids.has(r.id))).toBe(true)
  })

  it('a failure on page 2 is resumed from page 2', async () => {
    const base = Date.now()
    const rows = Array.from({ length: 1200 }, (_, i) => record(`pull-${crypto.randomUUID()}`, base + i))
    await pushFromDeviceB(client, rows)
    const head = await maxServerSeq(client)
    const start = 0

    const fetch = supabasePullPage(client)
    let calls = 0
    const failing: PullPageFetch = (cursor, limit) => {
      if (++calls === 2) return Promise.reject(new Error('offline'))
      return fetch(cursor, limit)
    }
    await expect(pullAll(failing)).rejects.toThrow('offline')
    const afterPage1 = (await read.getMeta('pullCursor')) as number
    expect(afterPage1).toBeGreaterThan(start)
    expect(await read.allIds()).toHaveLength(PULL_PAGE_SIZE)

    const cursors: number[] = []
    const summary = await pullAll((cursor, limit) => {
      cursors.push(cursor)
      return fetch(cursor, limit)
    })
    expect(cursors[0]).toBe(afterPage1)
    expect(summary.received).toBe(700)
    expect(await read.getMeta('pullCursor')).toBe(head)
    expect(await read.allIds()).toHaveLength(1200)
  })

  it('a remote delete wins over an older local live copy, which does not resurrect it', async () => {
    const id = `pull-${crypto.randomUUID()}`
    const at = Date.now()
    // Device A holds an unpushed older live version.
    await getDb().highlights.put(record(id, at, { deviceId: 'device-a' }))
    await getDb().outbox.put({ id, editedAt: at, attempts: 0 })
    // Device B deleted it later.
    await pushFromDeviceB(client, [record(id, at + 1_000, { deletedAt: at + 1_000 })])

    // Push first (the engine order): the server rejects the older copy and returns the delete.
    await pushAll(supabaseRpc(client))
    await pullAll(supabasePullPage(client))
    expect((await read.byId(id))?.deletedAt).toBe(at + 1_000)
    expect(await read.outboxCount()).toBe(0)
    const { data } = await client.from('highlights').select('deleted_at').eq('id', id).single()
    expect(Number(data?.deleted_at)).toBe(at + 1_000)
  })
})
