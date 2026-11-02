// Sync push engine against the local stack (Story 2.16, FR34, D1, D2).
// Two engine instances (two devices) share one account; each device's local database is simulated
// by clearing the fake IndexedDB between turns, since core/db is a per-process singleton.
// Prerequisite: `npm run db:start && npm run db:reset`.
import 'fake-indexeddb/auto'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getLocalSupabaseEnv, TEST_USERS } from '../helpers/local-supabase.ts'
import { getDb } from '../../src/core/db/schema.ts'
import { read } from '../../src/core/db/read.ts'
import { write, type HighlightDraft } from '../../src/core/db/write.ts'
import { setNowForTests } from '../../src/core/clock/index.ts'
import { pushAll } from '../../src/core/sync/background/push.ts'
import { supabaseRpc } from '../../src/core/sync/background/rpc.ts'

interface Device {
  id: string
  client: SupabaseClient
}

async function signedInClient(): Promise<SupabaseClient> {
  const env = getLocalSupabaseEnv()
  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { error } = await client.auth.signInWithPassword(TEST_USERS.a)
  if (error) throw new Error('sign-in failed', { cause: error })
  return client
}

function draft(id: string, comment: string): HighlightDraft {
  return {
    id,
    userId: '',
    canonicalUrl: 'https://example.com/engine',
    siteKey: 'example.com',
    url: 'https://example.com/engine',
    text: 'Engine highlight text',
    color: 'green',
    comment,
    anchor: null,
    pageTitle: null,
    favicon: null,
    createdAt: 1_000,
    deletedAt: null,
    schemaVersion: 1,
  }
}

async function resetLocal(): Promise<void> {
  const db = getDb()
  await Promise.all(db.tables.map((t) => t.clear()))
}

/** One device turn: a fresh local database, one local edit at `editedAt`, then a push. */
async function editAndPush(device: Device, id: string, comment: string, editedAt: number): Promise<void> {
  await resetLocal()
  setNowForTests(() => editedAt)
  const record = await write.upsert(draft(id, comment), device.id)
  expect(record.editedAt).toBe(editedAt)
  await pushAll(supabaseRpc(device.client))
}

async function cloudRow(client: SupabaseClient, id: string): Promise<Record<string, unknown>> {
  const { data, error } = await client.from('highlights').select('*').eq('id', id).single()
  if (error) throw new Error(`select failed: ${error.message}`, { cause: error })
  return data as Record<string, unknown>
}

describe('sync engine push (two devices, one account)', () => {
  let a: Device
  let b: Device

  beforeAll(async () => {
    a = { id: 'device-a', client: await signedInClient() }
    b = { id: 'device-b', client: await signedInClient() }
  })

  afterEach(() => setNowForTests(null))

  it('the later edit wins whichever device pushes first', async () => {
    const base = Date.now()
    const id1 = `engine-${crypto.randomUUID()}`
    await editAndPush(a, id1, 'from a (newer)', base + 2_000)
    await editAndPush(b, id1, 'from b (older)', base + 1_000)
    expect(await cloudRow(a.client, id1)).toMatchObject({ comment: 'from a (newer)', device_id: 'device-a', edited_at: base + 2_000 })
    // The losing device adopted the server row and has nothing left to push.
    expect((await read.byId(id1))?.comment).toBe('from a (newer)')
    expect(await read.outboxCount()).toBe(0)

    const id2 = `engine-${crypto.randomUUID()}`
    await editAndPush(a, id2, 'from a (older)', base + 1_000)
    await editAndPush(b, id2, 'from b (newer)', base + 2_000)
    expect(await cloudRow(b.client, id2)).toMatchObject({ comment: 'from b (newer)', device_id: 'device-b' })
  })

  it('equal editedAt: the larger deviceId wins', async () => {
    const at = Date.now()
    const id = `engine-${crypto.randomUUID()}`
    await editAndPush(b, id, 'from b', at)
    await editAndPush(a, id, 'from a', at)
    expect(await cloudRow(a.client, id)).toMatchObject({ comment: 'from b', device_id: 'device-b' })
  })

  it('a pushed record gets the account user id locally and clears its outbox item', async () => {
    const id = `engine-${crypto.randomUUID()}`
    await editAndPush(a, id, 'owned', Date.now())
    const { data } = await a.client.auth.getUser()
    expect((await read.byId(id))?.userId).toBe(data.user?.id)
    expect(await read.outboxCount()).toBe(0)
  })
})
