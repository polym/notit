// Reads the local Supabase stack address and anon key from `supabase status -o env`.
// Only public values (API URL, anon key) are returned; nothing is hard-coded in the repo.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Repo root holds the Supabase CLI project (supabase/config.toml).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const SUPABASE_BIN = resolve(REPO_ROOT, 'noteit-extension/node_modules/.bin/supabase')

export interface LocalSupabaseEnv {
  url: string
  anonKey: string
}

export function parseStatusEnv(output: string): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const line of output.split('\n')) {
    const match = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim())
    if (match) vars[match[1]] = match[2]
  }
  return vars
}

export function getLocalSupabaseEnv(): LocalSupabaseEnv {
  let output: string
  try {
    output = execFileSync(SUPABASE_BIN, ['status', '-o', 'env', '--workdir', REPO_ROOT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new Error('Local Supabase is not running. Run `npm run db:start && npm run db:reset` first.', {
      cause: error,
    })
  }
  const vars = parseStatusEnv(output)
  const url = vars.API_URL
  const anonKey = vars.ANON_KEY
  if (!url || !anonKey) {
    throw new Error('`supabase status -o env` did not report API_URL and ANON_KEY.')
  }
  return { url, anonKey }
}

/**
 * Service role key of the LOCAL stack only (well-known demo key printed by `supabase status`).
 * Used by integration tests of admin scripts (scripts/migrate-legacy.ts); never a live key.
 */
export function getLocalServiceRoleKey(): string {
  const output = execFileSync(SUPABASE_BIN, ['status', '-o', 'env', '--workdir', REPO_ROOT], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const key = parseStatusEnv(output).SERVICE_ROLE_KEY
  if (!key) throw new Error('`supabase status -o env` did not report SERVICE_ROLE_KEY.')
  return key
}

/** Local Supabase project id from supabase/config.toml (names the docker containers). */
function localProjectId(): string {
  const config = readFileSync(resolve(REPO_ROOT, 'supabase/config.toml'), 'utf8')
  const match = /^project_id\s*=\s*"([^"]+)"/m.exec(config)
  if (!match) throw new Error('supabase/config.toml has no project_id.')
  return match[1]
}

/** Absolute path of a file inside the Supabase CLI project (supabase/). */
export function supabasePath(...parts: string[]): string {
  return resolve(REPO_ROOT, 'supabase', ...parts)
}

/**
 * Runs SQL as the postgres superuser inside the local database container (no client
 * credentials needed). Stops at the first error. Returns unaligned, tuples-only output.
 */
export function runLocalSql(sql: string): string {
  return execFileSync(
    'docker',
    ['exec', '-i', `supabase_db_${localProjectId()}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-A', '-t'],
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
  )
}

/** A v2 public.highlights row with unique id; user_id is left to the auth.uid() default. */
export function v2HighlightRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now()
  return {
    id: `int-${crypto.randomUUID()}`,
    canonical_url: 'https://example.com/article',
    site_key: 'example.com',
    url: 'https://example.com/article',
    text: 'Integration highlight text',
    color: 'yellow',
    created_at: now,
    edited_at: now,
    device_id: 'int-device',
    // sync_push (Story 2.13) assigns server_seq; direct inserts here use any value.
    server_seq: now,
    ...overrides,
  }
}

// Test users created by supabase/seed.sql (local stack only).
export const TEST_USERS = {
  a: { email: 'user-a@noteit.test', password: 'test-password-a' },
  b: { email: 'user-b@noteit.test', password: 'test-password-b' },
} as const

/**
 * Deletes every public.highlights row of one test user (superuser psql; clients cannot delete).
 * Since Story 2.17 a sign-in pulls the account's rows, so tests that count local records start
 * from an empty cloud account.
 */
export function clearCloudRows(email: string): void {
  if (!/^[a-z0-9.@-]+$/.test(email)) throw new Error('unexpected test email')
  runLocalSql(`delete from public.highlights where user_id = (select id from auth.users where email = '${email}');`)
}
