// sync_push RPC: server-side LWW and pull sequence (Story 2.13, FR34, FR35, D2, D3).
// Prerequisite: `npm run db:start && npm run db:reset`.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getLocalSupabaseEnv, TEST_USERS, type LocalSupabaseEnv } from '../helpers/local-supabase.ts'

interface LwwSide {
  editedAt: number
  deviceId: string
  deletedAt: number | null
}
interface LwwCase {
  name: string
  stored: LwwSide
  incoming: LwwSide
  winner: 'stored' | 'incoming'
}

const LWW_CASES = (
  JSON.parse(
    readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/lww-cases.json'), 'utf8'),
  ) as { cases: LwwCase[] }
).cases

type Row = Record<string, unknown>
interface PushResult {
  now_ms: number
  rows: Row[]
}

function newClient(env: LocalSupabaseEnv): SupabaseClient {
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function signedIn(env: LocalSupabaseEnv, user: { email: string; password: string }) {
  const client = newClient(env)
  const { data, error } = await client.auth.signInWithPassword(user)
  if (error || !data.user) throw new Error(`sign-in failed for ${user.email}`, { cause: error })
  return { client, userId: data.user.id }
}

/** A push payload row (no user_id / server_seq: the server owns those). */
function pushRow(overrides: Row = {}): Row {
  const now = Date.now()
  return {
    id: `push-${crypto.randomUUID()}`,
    canonical_url: 'https://example.com/article',
    site_key: 'example.com',
    url: 'https://example.com/article',
    text: 'Pushed highlight text',
    color: 'yellow',
    comment: null,
    anchor: { start: 1, end: 5, exact: 'text', prefix: 'p', suffix: 's' },
    page_title: 'Article',
    favicon: null,
    created_at: now,
    edited_at: now,
    device_id: 'device-a',
    deleted_at: null,
    ...overrides,
  }
}

async function push(client: SupabaseClient, rows: Row[]): Promise<PushResult> {
  const { data, error } = await client.rpc('sync_push', { rows })
  if (error) throw new Error(`sync_push failed: ${error.message}`, { cause: error })
  return data as PushResult
}

function byId(result: PushResult, id: unknown): Row {
  const row = result.rows.find((r) => r.id === id)
  if (!row) throw new Error(`row ${String(id)} missing from sync_push result`)
  return row
}

describe('sync_push RPC', () => {
  let env: LocalSupabaseEnv
  let a: SupabaseClient
  let b: SupabaseClient
  let userA: string

  beforeAll(async () => {
    env = getLocalSupabaseEnv()
    const sessionA = await signedIn(env, TEST_USERS.a)
    a = sessionA.client
    userA = sessionA.userId
    b = (await signedIn(env, TEST_USERS.b)).client
  })

  it('returns only now_ms (and no rows) for an empty array', async () => {
    const before = Date.now()
    const result = await push(a, [])
    expect(result.rows).toEqual([])
    expect(typeof result.now_ms).toBe('number')
    // Local stack shares the host clock.
    expect(Math.abs(result.now_ms - before)).toBeLessThan(60_000)
  })

  it('inserts a new id with the caller as owner and a server_seq', async () => {
    const row = pushRow()
    const result = await push(a, [row])
    expect(result.rows).toHaveLength(1)
    const stored = byId(result, row.id)
    expect(stored).toMatchObject({ ...row, user_id: userA })
    expect(typeof stored.server_seq).toBe('number')
  })

  it('ignores a client supplied user_id and server_seq', async () => {
    const row = pushRow({ user_id: '00000000-0000-4000-a000-00000000000b', server_seq: 1 })
    const stored = byId(await push(a, [row]), row.id)
    expect(stored.user_id).toBe(userA)
    expect(stored.server_seq).not.toBe(1)
  })

  it('gives every written row a new, larger server_seq and leaves rejected rows untouched', async () => {
    const row = pushRow({ edited_at: 1_000 })
    const first = byId(await push(a, [row]), row.id)

    const newer = { ...row, text: 'newer', edited_at: 2_000 }
    const second = byId(await push(a, [newer]), row.id)
    expect(second.text).toBe('newer')
    expect(second.server_seq as number).toBeGreaterThan(first.server_seq as number)

    const older = { ...row, text: 'older', edited_at: 1_500 }
    const third = byId(await push(a, [older]), row.id)
    expect(third).toEqual(second)
  })

  describe('shared LWW cases (tests/fixtures/lww-cases.json)', () => {
    it.each(LWW_CASES)('$name', async ({ stored, incoming, winner }) => {
      const id = `lww-${crypto.randomUUID()}`
      const storedRow = pushRow({
        id,
        text: 'stored',
        edited_at: stored.editedAt,
        device_id: stored.deviceId,
        deleted_at: stored.deletedAt,
      })
      const before = byId(await push(a, [storedRow]), id)

      const incomingRow = pushRow({
        id,
        text: 'incoming',
        created_at: storedRow.created_at,
        edited_at: incoming.editedAt,
        device_id: incoming.deviceId,
        deleted_at: incoming.deletedAt,
      })
      const after = byId(await push(a, [incomingRow]), id)

      if (winner === 'incoming') {
        expect(after).toMatchObject({ ...incomingRow, user_id: userA })
        expect(after.server_seq as number).toBeGreaterThan(before.server_seq as number)
      } else {
        // Rejected: the stored row is returned and stays exactly as it was.
        expect(after).toEqual(before)
      }
    })
  })

  it('returns the stored row of every id in one call, accepted or not', async () => {
    const kept = pushRow({ edited_at: 5_000 })
    await push(a, [kept])
    const fresh = pushRow()
    const stale = { ...kept, text: 'stale', edited_at: 4_000 }
    const result = await push(a, [fresh, stale])
    expect(result.rows.map((r) => r.id).sort()).toEqual([fresh.id, kept.id].sort())
    expect(byId(result, kept.id).text).toBe(kept.text)
    expect(byId(result, fresh.id).text).toBe(fresh.text)
  })

  it('applies duplicate ids in one call in order, with LWW between them', async () => {
    const row = pushRow({ edited_at: 1_000 })
    const result = await push(a, [row, { ...row, text: 'second', edited_at: 3_000 }, { ...row, text: 'third', edited_at: 2_000 }])
    expect(result.rows).toHaveLength(1)
    expect(byId(result, row.id).text).toBe('second')
  })

  it('keeps accounts isolated: B cannot overwrite or read A rows through sync_push', async () => {
    const row = pushRow({ edited_at: 1_000 })
    await push(a, [row])
    const { error } = await b.rpc('sync_push', { rows: [{ ...row, text: 'by B', edited_at: 9_999 }] })
    // B cannot see A's row, so the insert collides on the primary key and the call aborts.
    expect(error?.code).toBe('23505')
    // Pushing an older version as A returns the stored row unchanged.
    const again = byId(await push(a, [{ ...row, edited_at: 1 }]), row.id)
    expect(again.text).toBe(row.text)
  })

  it('rejects anonymous calls', async () => {
    const { error } = await newClient(env).rpc('sync_push', { rows: [] })
    expect(error).not.toBeNull()
  })

  it('rejects rows with an invalid color without writing anything', async () => {
    const good = pushRow()
    const bad = pushRow({ color: '#ffeb3b' })
    const { error } = await a.rpc('sync_push', { rows: [good, bad] })
    expect(error?.code).toBe('23514')
    const { data } = await a.from('highlights').select('id').eq('id', good.id as string)
    expect(data).toEqual([])
  })

  it('keeps server_seq strictly increasing and gap-free for pullers under 2 x 50 interleaved pushes', async () => {
    // Two sessions of the same user (two devices) push concurrently while a puller polls with
    // `server_seq > cursor`. Every committed row must be seen, in increasing server_seq order.
    const second = (await signedIn(env, TEST_USERS.a)).client
    const prefix = `seq-${crypto.randomUUID()}-`
    const pushesPerSession = 50
    const sharedId = `${prefix}shared`
    const expectedIds = new Set<string>([sharedId])

    const sessionPushes = (client: SupabaseClient, device: string) =>
      (async () => {
        for (let i = 0; i < pushesPerSession; i++) {
          const own = pushRow({ id: `${prefix}${device}-${i}`, device_id: device })
          expectedIds.add(own.id as string)
          // Both sessions also edit one shared id so updates interleave with inserts.
          const shared = pushRow({ id: sharedId, device_id: device, edited_at: Date.now() + i })
          await push(client, [own, shared])
        }
      })()

    let cursor = 0
    const seenSeqs: number[] = []
    const lastSeqById = new Map<string, number>()
    let pushing = true
    const poll = async () => {
      const { data, error } = await a
        .from('highlights')
        .select('id, server_seq')
        .like('id', `${prefix}%`)
        .gt('server_seq', cursor)
        .order('server_seq')
      if (error) throw error
      for (const row of data as { id: string; server_seq: number }[]) {
        seenSeqs.push(row.server_seq)
        lastSeqById.set(row.id, row.server_seq)
        cursor = row.server_seq
      }
    }
    const puller = (async () => {
      while (pushing) {
        await poll()
        await new Promise((r) => setTimeout(r, 5))
      }
      await poll()
    })()

    await Promise.all([sessionPushes(a, 'device-a'), sessionPushes(second, 'device-b')]).finally(() => {
      pushing = false
    })
    await puller

    // Strictly increasing across every poll.
    for (let i = 1; i < seenSeqs.length; i++) expect(seenSeqs[i]).toBeGreaterThan(seenSeqs[i - 1])

    // Gap-free from the puller's view: the cursor walk ends at the final state of every row.
    const { data: finalRows, error } = await a
      .from('highlights')
      .select('id, server_seq, user_id')
      .like('id', `${prefix}%`)
      .order('server_seq')
    expect(error).toBeNull()
    const finals = finalRows as { id: string; server_seq: number; user_id: string }[]
    expect(new Set(finals.map((r) => r.id))).toEqual(expectedIds)
    expect(finals).toHaveLength(2 * pushesPerSession + 1)
    for (const row of finals) {
      expect(row.user_id).toBe(userA)
      expect(lastSeqById.get(row.id)).toBe(row.server_seq)
    }
    expect(new Set(finals.map((r) => r.server_seq)).size).toBe(finals.length)
  })
})
