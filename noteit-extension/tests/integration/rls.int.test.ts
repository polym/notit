// RLS and access rules of the v2 public.highlights table (Story 2.12, NFR11, NFR12, #19).
// Prerequisite: `npm run db:start && npm run db:reset`.
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  getLocalSupabaseEnv,
  supabasePath,
  TEST_USERS,
  v2HighlightRow,
  type LocalSupabaseEnv,
} from '../helpers/local-supabase.ts'

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

describe('v2 highlights RLS', () => {
  let env: LocalSupabaseEnv
  let a: SupabaseClient
  let b: SupabaseClient
  let anon: SupabaseClient
  let userA: string

  beforeAll(async () => {
    env = getLocalSupabaseEnv()
    const sessionA = await signedIn(env, TEST_USERS.a)
    a = sessionA.client
    userA = sessionA.userId
    b = (await signedIn(env, TEST_USERS.b)).client
    anon = newClient(env)
  })

  async function insertAsA(overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const row = v2HighlightRow(overrides)
    const { error } = await a.from('highlights').insert(row)
    expect(error).toBeNull()
    return row
  }

  async function readAsA(id: string) {
    const { data, error } = await a.from('highlights').select('id, text, user_id, deleted_at').eq('id', id)
    expect(error).toBeNull()
    return data
  }

  it('stamps user_id with the signed-in user', async () => {
    const row = await insertAsA()
    expect(await readAsA(row.id as string)).toEqual([
      { id: row.id, text: row.text, user_id: userA, deleted_at: null },
    ])
  })

  it('hides user A rows from user B', async () => {
    const row = await insertAsA()
    const { data, error } = await b.from('highlights').select('id').eq('id', row.id as string)
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('does not let user B update user A rows', async () => {
    const row = await insertAsA()
    const { data, error } = await b
      .from('highlights')
      .update({ text: 'changed by B', edited_at: Date.now() + 1 })
      .eq('id', row.id as string)
      .select('id')
    expect(error).toBeNull()
    expect(data).toEqual([])
    expect(await readAsA(row.id as string)).toEqual([expect.objectContaining({ text: row.text })])
  })

  it('does not let user B insert or move rows into user A account', async () => {
    const { error: insertError } = await b.from('highlights').insert(v2HighlightRow({ user_id: userA }))
    expect(insertError).not.toBeNull()

    // User A cannot hand a row over to another account either (update with check).
    const row = await insertAsA()
    const { error: updateError } = await a
      .from('highlights')
      .update({ user_id: '00000000-0000-4000-a000-00000000000b' })
      .eq('id', row.id as string)
    expect(updateError).not.toBeNull()
    expect(await readAsA(row.id as string)).toEqual([expect.objectContaining({ user_id: userA })])
  })

  it('lets the owner update (soft delete) their own row', async () => {
    const row = await insertAsA()
    const deletedAt = Date.now()
    const { data, error } = await a
      .from('highlights')
      .update({ deleted_at: deletedAt, edited_at: deletedAt })
      .eq('id', row.id as string)
      .select('id')
    expect(error).toBeNull()
    expect(data).toEqual([{ id: row.id }])
    expect(await readAsA(row.id as string)).toEqual([expect.objectContaining({ deleted_at: deletedAt })])
  })

  it('rejects anonymous reads and writes', async () => {
    const { error: selectError } = await anon.from('highlights').select('id')
    expect(selectError).not.toBeNull()
    const { error: insertError } = await anon.from('highlights').insert(v2HighlightRow({ user_id: userA }))
    expect(insertError).not.toBeNull()
    const { error: updateError } = await anon.from('highlights').update({ text: 'anon' }).eq('user_id', userA)
    expect(updateError).not.toBeNull()
  })

  it('affects 0 rows on any client delete', async () => {
    const row = await insertAsA()
    for (const client of [a, b]) {
      const { data, error } = await client
        .from('highlights')
        .delete()
        .eq('id', row.id as string)
        .select('id')
      expect(error).toBeNull()
      expect(data).toEqual([])
    }
    const { error: anonError } = await anon
      .from('highlights')
      .delete()
      .eq('id', row.id as string)
    expect(anonError).not.toBeNull()
    expect(await readAsA(row.id as string)).toHaveLength(1)
  })

  it('rejects colors outside the four names', async () => {
    for (const color of ['#ffeb3b', 'red', 'Yellow', '']) {
      const { error } = await a.from('highlights').insert(v2HighlightRow({ color }))
      expect(error?.code).toBe('23514') // check_violation
    }
    for (const color of ['yellow', 'orange', 'blue', 'green']) {
      await insertAsA({ color })
    }
  })

  it('keeps highlights_legacy away from client roles', async () => {
    for (const client of [a, anon]) {
      const { error } = await client.from('highlights_legacy').select('id')
      expect(error).not.toBeNull()
    }
  })

  it('keeps public sign-up disabled in config.toml', async () => {
    const config = readFileSync(supabasePath('config.toml'), 'utf8')
    const authSection = /^\[auth\]\n([\s\S]*?)^\[/m.exec(config)?.[1] ?? ''
    expect(authSection).toMatch(/^enable_signup = false$/m)

    const { data, error } = await newClient(env).auth.signUp({
      email: `signup-${crypto.randomUUID()}@noteit.test`,
      password: 'some-password-123',
    })
    expect(error).not.toBeNull()
    expect(data.user).toBeNull()
  })
})
