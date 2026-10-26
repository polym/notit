// Story 2.20: rehearses scripts/migrate-legacy.ts (dry run, backup, migration, idempotency) and
// scripts/rollback-v2.sql on the local stack with supabase/tests/fixtures/legacy-highlights.json.
// The rollback runs inside a transaction that is rolled back, so the database keeps the v2 schema.
// Prerequisite: `npm run db:start && npm run db:reset`.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { legacyColorToName } from '../../src/core/color/index.ts'
import { canonicalUrl, siteKey } from '../../src/core/url/index.ts'
import { getLocalServiceRoleKey, getLocalSupabaseEnv, runLocalSql, supabasePath } from '../helpers/local-supabase.ts'
import { DESCRIBE_PUBLIC_SQL, M0_SCHEMA_BASELINE } from '../helpers/schema-snapshot.ts'

const EXT_ROOT = resolve(import.meta.dirname, '../..')
const SCRIPT = resolve(EXT_ROOT, 'scripts/migrate-legacy.ts')
const ROLLBACK = resolve(EXT_ROOT, 'scripts/rollback-v2.sql')
const USER_A = '00000000-0000-4000-a000-00000000000a'

interface FixtureRow {
  id: string
  text: string
  url: string
  color: string
  timestamp: number
  pageTitle: string | null
  favicon: string | null
  comment: string | null
  start: number | null
  length: number | null
  context: { prefix?: string; suffix?: string } | null
}

const FIXTURES: FixtureRow[] = JSON.parse(readFileSync(supabasePath('tests', 'fixtures', 'legacy-highlights.json'), 'utf8'))
const FIXTURE_IDS = FIXTURES.map((r) => r.id)
const ID_LIST = FIXTURE_IDS.map((id) => `'${id}'`).join(',')

function seedLegacySql(): string {
  // Dollar quoting keeps the fixture JSON verbatim (quotes, newlines, emoji).
  return `insert into public.highlights_legacy
    select * from jsonb_populate_recordset(null::public.highlights_legacy, $fx$${JSON.stringify(FIXTURES)}$fx$::jsonb);`
}

function cleanup(): void {
  // Clear every highlights row of test user A, not only the fixture ids: migrate-legacy.ts refuses
  // to write when the user already has client rows, so this suite owns that precondition itself
  // instead of relying on other suites (e.g. e2e teardown) to leave the user empty.
  runLocalSql(`
    delete from public.highlights where user_id = '${USER_A}';
    delete from public.highlights where id in (${ID_LIST});
    delete from public.highlights_legacy where id in (${ID_LIST});
  `)
}

function runScript(args: string[]): string {
  const { url } = getLocalSupabaseEnv()
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    cwd: EXT_ROOT,
    encoding: 'utf8',
    env: { ...process.env, SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: getLocalServiceRoleKey() },
  })
}

function migratedCount(): number {
  return Number(runLocalSql(`select count(*) from public.highlights where id in (${ID_LIST});`).trim())
}

const LEGACY_FINGERPRINT = `select count(*) || ':' || md5(coalesce(string_agg(t::text, '|' order by t.id), ''))
  from public.%TABLE% t where t.id in (${ID_LIST});`

describe('legacy migration script', () => {
  let tmp: string

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'noteit-migrate-'))
    cleanup()
    runLocalSql(seedLegacySql())
  })

  afterAll(() => {
    cleanup()
    rmSync(tmp, { recursive: true, force: true })
  })

  it('--dry-run prints statistics and a diff without writing', () => {
    const before = runLocalSql('select count(*) from public.highlights;').trim()
    const output = runScript(['--user', USER_A, '--dry-run'])
    expect(output).toContain('to insert:        10')
    expect(output).toContain('skipped:          1')
    expect(output).toMatch(/\+ legacy-fx-04 {2}color #ef9a9a -> orange/)
    expect(output).toMatch(/! legacy-fx-11 {2}skipped: unsupported url/)
    expect(output).toContain('dry run: nothing written')
    expect(runLocalSql('select count(*) from public.highlights;').trim()).toBe(before)
  })

  it('--backup writes the highlights_legacy row set as JSON', () => {
    const file = join(tmp, 'backup.json')
    runScript(['--user', USER_A, '--dry-run', '--backup', file])
    const backup: Record<string, unknown>[] = JSON.parse(readFileSync(file, 'utf8'))
    const expected: Record<string, unknown>[] = JSON.parse(
      runLocalSql(`select coalesce(json_agg(t order by t.id), '[]') from public.highlights_legacy t;`),
    )
    const byId = (rows: Record<string, unknown>[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)))
    expect(byId(backup)).toEqual(byId(expected))
    expect(backup.map((r) => r.id)).toEqual(expect.arrayContaining(FIXTURE_IDS))
  })

  it('migrates every convertible row with the core/url and core/color rules', () => {
    const output = runScript(['--user', USER_A])
    expect(output).toContain('inserted 10 rows')
    const rows: Record<string, unknown>[] = JSON.parse(
      runLocalSql(`select coalesce(json_agg(t order by t.id), '[]') from public.highlights t where t.id in (${ID_LIST});`),
    )
    expect(rows).toHaveLength(10)
    const seqs = new Set<number>()
    for (const row of rows) {
      const legacy = FIXTURES.find((f) => f.id === row.id)!
      expect(row.user_id).toBe(USER_A)
      expect(row.color).toBe(legacyColorToName(legacy.color))
      expect(row.canonical_url).toBe(canonicalUrl(legacy.url))
      expect(row.site_key).toBe(siteKey(legacy.url))
      expect(row.url).toBe(legacy.url)
      expect(row.text).toBe(legacy.text)
      expect(row.comment).toBe(legacy.comment)
      expect(row.page_title).toBe(legacy.pageTitle)
      expect(row.created_at).toBe(legacy.timestamp)
      expect(row.edited_at).toBe(legacy.timestamp)
      expect(row.device_id).toBe('legacy-migration')
      expect(row.deleted_at).toBeNull()
      if (legacy.start === null) {
        expect(row.anchor).toBeNull()
      } else {
        const anchor = row.anchor as Record<string, unknown>
        expect(anchor.start).toBe(legacy.start)
        expect(anchor.end).toBe(legacy.start + (legacy.length ?? legacy.text.length))
        expect(anchor.exact).toBe(legacy.text)
        expect(anchor.prefix).toBe((legacy.context?.prefix ?? '').slice(-32))
        expect(anchor.suffix).toBe((legacy.context?.suffix ?? '').slice(0, 32))
      }
      seqs.add(Number(row.server_seq))
    }
    expect(seqs.size).toBe(10)
    // Spot checks of the Q50 table and URL normalisation.
    const get = (id: string) => rows.find((r) => r.id === id)!
    expect(get('legacy-fx-02').color).toBe('green')
    expect(get('legacy-fx-05').color).toBe('yellow')
    expect(get('legacy-fx-06').color).toBe('blue')
    expect(get('legacy-fx-07').color).toBe('yellow')
    expect(get('legacy-fx-09').color).toBe('orange')
    expect(get('legacy-fx-09').canonical_url).toBe('https://www.example.com/article?id=7')
    expect(get('legacy-fx-09').site_key).toBe('example.com')
    expect(get('legacy-fx-08').anchor).toBeNull()
    expect(rows.some((r) => r.id === 'legacy-fx-11')).toBe(false)
  })

  it('is idempotent: a second run inserts nothing and changes no row', () => {
    const before = runLocalSql(LEGACY_FINGERPRINT.replace('%TABLE%', 'highlights'))
    const output = runScript(['--user', USER_A])
    expect(output).toContain('already migrated: 10')
    expect(output).toContain('inserted 0 rows')
    expect(migratedCount()).toBe(10)
    expect(runLocalSql(LEGACY_FINGERPRINT.replace('%TABLE%', 'highlights'))).toBe(before)
  })

  it('refuses to write when a client already pushed rows for the user', () => {
    const id = `int-guard-${crypto.randomUUID()}`
    runLocalSql(`insert into public.highlights
      (id, user_id, canonical_url, site_key, url, text, color, created_at, edited_at, device_id, server_seq)
      values ('${id}', '${USER_A}', 'https://example.com/', 'example.com', 'https://example.com/', 'x', 'yellow', 1, 1,
        'client-device', nextval('public.highlights_seq'));`)
    try {
      let stderr = ''
      let status = 0
      try {
        runScript(['--user', USER_A])
      } catch (error) {
        const failure = error as { status: number; stderr: string }
        status = failure.status
        stderr = failure.stderr
      }
      expect(status).toBe(1)
      expect(stderr).toContain('refusing to write')
      expect(migratedCount()).toBe(10)
      // A dry run still reports the plan.
      expect(runScript(['--user', USER_A, '--dry-run'])).toContain('dry run: nothing written')
    } finally {
      runLocalSql(`delete from public.highlights where id = '${id}';`)
    }
  })

  it('rollback-v2.sql restores the M0 schema and the legacy data', () => {
    const legacyBefore = runLocalSql(LEGACY_FINGERPRINT.replace('%TABLE%', 'highlights_legacy')).trim()
    const output = runLocalSql(`
      begin;
      ${readFileSync(ROLLBACK, 'utf8')}
      ${DESCRIBE_PUBLIC_SQL}
      select '--fingerprint--';
      ${LEGACY_FINGERPRINT.replace('%TABLE%', 'highlights')}
      select '--migrations--';
      select max(version) from supabase_migrations.schema_migrations;
      rollback;
    `)
    const [schema, rest] = output.split('--fingerprint--\n')
    const [fingerprint, maxVersion] = rest.split('--migrations--\n')
    expect(schema).toBe(readFileSync(M0_SCHEMA_BASELINE, 'utf8'))
    expect(fingerprint.trim()).toBe(legacyBefore)
    // The v2 migrations are no longer recorded, so `supabase db push` would apply them again.
    expect(maxVersion.trim()).toBe('20261018000000')
    expect(legacyBefore).toMatch(/^11:[0-9a-f]{32}$/)
    // The transaction was rolled back: the v2 schema is still in place.
    expect(runLocalSql(`select to_regclass('public.highlights_legacy') is not null;`).trim()).toBe('t')
  })
})
