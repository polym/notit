// Story 2.23: scripts/verify-consistency.ts queries the cloud read-only with the user's own session
// (anon key + password, RLS) and refuses a service role key.
// Prerequisite: `npm run db:start && npm run db:reset`.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { buildLocalIdExport } from '../../src/core/diagnostics/consistency.ts'
import {
  clearCloudRows,
  getLocalServiceRoleKey,
  getLocalSupabaseEnv,
  TEST_USERS,
  v2HighlightRow,
  type LocalSupabaseEnv,
} from '../helpers/local-supabase.ts'

const ROOT = resolve(import.meta.dirname, '../..')

async function insertAs(env: LocalSupabaseEnv, user: { email: string; password: string }, row: Record<string, unknown>) {
  const client = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: signInError } = await client.auth.signInWithPassword(user)
  if (signInError) throw signInError
  const { error } = await client.from('highlights').insert(row)
  if (error) throw error
  await client.auth.signOut({ scope: 'local' })
}

function runCli(files: string[], env: Record<string, string>): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, ['scripts/verify-consistency.ts', ...files], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string }
    return { code: e.status, out: `${e.stdout}${e.stderr}` }
  }
}

describe('verify-consistency against the local stack', () => {
  let env: LocalSupabaseEnv
  let dir: string
  let rowA: Record<string, unknown>

  beforeAll(async () => {
    env = getLocalSupabaseEnv()
    clearCloudRows(TEST_USERS.a.email)
    clearCloudRows(TEST_USERS.b.email)
    rowA = v2HighlightRow()
    await insertAs(env, TEST_USERS.a, rowA)
    // Another account's row must be invisible to user A under RLS.
    await insertAs(env, TEST_USERS.b, v2HighlightRow())
    dir = mkdtempSync(join(tmpdir(), 'noteit-consistency-'))
    const exp = buildLocalIdExport([{ id: rowA.id as string, editedAt: rowA.edited_at as number, deletedAt: null }], Date.now())
    for (const name of ['a.json', 'b.json']) writeFileSync(join(dir, name), JSON.stringify(exp))
  })

  afterAll(() => {
    clearCloudRows(TEST_USERS.a.email)
    clearCloudRows(TEST_USERS.b.email)
    rmSync(dir, { recursive: true, force: true })
  })

  const files = () => [join(dir, 'a.json'), join(dir, 'b.json')]
  const userEnv = (key: string) => ({
    SUPABASE_URL: env.url,
    SUPABASE_ANON_KEY: key,
    NOTEIT_EMAIL: TEST_USERS.a.email,
    NOTEIT_PASSWORD: TEST_USERS.a.password,
  })

  it('reports 0 / 0 using only the anon key and the user session', () => {
    const { code, out } = runCli(files(), userEnv(env.anonKey))
    expect(out).toContain('missing: 0')
    expect(out).toContain('duplicates: 0')
    expect(code).toBe(0)
  })

  it('refuses a service role key', () => {
    const { code, out } = runCli(files(), userEnv(getLocalServiceRoleKey()))
    expect(code).toBe(1)
    expect(out).toContain('not an anon key')
  })
})
