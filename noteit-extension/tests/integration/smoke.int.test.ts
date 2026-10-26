// Smoke tests against the local Supabase stack (v2 schema).
// Prerequisite: `npm run db:start && npm run db:reset`.
import { beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getLocalSupabaseEnv, TEST_USERS, v2HighlightRow, type LocalSupabaseEnv } from '../helpers/local-supabase.ts'

function newClient(env: LocalSupabaseEnv): SupabaseClient {
  return createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

describe('local supabase (v2 schema)', () => {
  let env: LocalSupabaseEnv

  beforeAll(() => {
    env = getLocalSupabaseEnv()
  })

  it('signs in as test user A, writes and reads back a highlights row', async () => {
    const supabase = newClient(env)
    const { data: auth, error: authError } = await supabase.auth.signInWithPassword(TEST_USERS.a)
    expect(authError).toBeNull()
    expect(auth.user?.email).toBe(TEST_USERS.a.email)

    // The test owns its row (unique id); rows cannot be hard deleted, db reset clears them.
    const row = v2HighlightRow({ text: 'Smoke highlight text' })
    const { error: insertError } = await supabase.from('highlights').insert(row)
    expect(insertError).toBeNull()

    const { data, error } = await supabase.from('highlights').select('id, text, user_id').eq('id', row.id as string)
    expect(error).toBeNull()
    expect(data).toEqual([{ id: row.id, text: 'Smoke highlight text', user_id: auth.user?.id }])
  })

  it('rejects public sign-up', async () => {
    const supabase = newClient(env)
    const { data, error } = await supabase.auth.signUp({
      email: `signup-${crypto.randomUUID()}@noteit.test`,
      password: 'some-password-123',
    })
    expect(error).not.toBeNull()
    expect(data.user).toBeNull()
  })
})
