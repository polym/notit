// One-off migration of the legacy cloud table into the v2 schema (architecture.md D9, FR40, FR41).
// Reads public.highlights_legacy with the service role, converts every row with the same core/url
// and core/color code the extension uses, and inserts it into the v2 public.highlights table.
//
// Usage (Node 24 runs this TypeScript file natively, cwd = noteit-extension):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-legacy.ts --user <uid> [--dry-run] [--backup <file>]
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/migrate-legacy.ts --backup <file> --source highlights
//
//   --user <uid>      owner (auth.users id) of every migrated row; required unless backing up only
//   --dry-run         print statistics and a per-row diff, write nothing to public.highlights
//   --backup <file>   export the legacy table as JSON to <file> before anything else (also with --dry-run)
//   --source <table>  legacy table to read: highlights_legacy (default, after the v2 migration) or
//                     highlights (before `supabase db push`, for the E1 backup). Without --user the
//                     script only writes the backup and exits.
//
// Idempotent: ids already present in public.highlights are skipped and existing rows are never
// updated, so re-running the script inserts nothing new. Rows whose URL is not http(s) are skipped
// and reported. The service role key bypasses RLS; never commit it or pass it to the extension.
//
// Precondition: run this before the account's first sign-in from any client. The inserts take
// server_seq from the column default without sync_push's per-user advisory lock, so a client
// pushing and pulling at the same time could move its cursor past rows not committed yet. A
// non-dry run therefore refuses to write when public.highlights already holds rows for --user
// that a client wrote (device_id other than 'legacy-migration').
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { legacyColorToName } from '../src/core/color/legacy.ts'
import { canonicalUrl, siteKey } from '../src/core/url/index.ts'

export const LEGACY_DEVICE_ID = 'legacy-migration'
/** Prefix / suffix length kept in a TextAnchor (architecture.md HighlightRecord). */
export const CONTEXT_CHARS = 32

const PAGE_SIZE = 1000
const INSERT_BATCH = 500
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A row of public.highlights_legacy as returned by PostgREST. */
export interface LegacyRow {
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
  context: unknown
  xpath: string | null
  created_at?: string | null
}

export interface V2Anchor {
  start: number
  end: number
  exact: string
  prefix: string
  suffix: string
}

/** Columns written to public.highlights; server_seq comes from the column default (highlights_seq). */
export interface V2Row {
  id: string
  user_id: string
  canonical_url: string
  site_key: string
  url: string
  text: string
  color: string
  comment: string | null
  anchor: V2Anchor | null
  page_title: string | null
  favicon: string | null
  created_at: number
  edited_at: number
  device_id: string
  deleted_at: null
}

export type TransformResult = { ok: true; row: V2Row } | { ok: false; reason: string }

function contextString(context: unknown, key: 'prefix' | 'suffix'): string {
  if (typeof context !== 'object' || context === null) return ''
  const value = (context as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

/**
 * Legacy offsets -> TextAnchor. A row without `start` has no anchor (null). A missing `length`
 * falls back to the text length. prefix keeps the last and suffix the first CONTEXT_CHARS characters.
 */
export function legacyAnchor(row: Pick<LegacyRow, 'text' | 'start' | 'length' | 'context'>): V2Anchor | null {
  if (typeof row.start !== 'number' || !Number.isFinite(row.start)) return null
  const length = typeof row.length === 'number' && Number.isFinite(row.length) ? row.length : row.text.length
  return {
    start: row.start,
    end: row.start + length,
    exact: row.text,
    prefix: contextString(row.context, 'prefix').slice(-CONTEXT_CHARS),
    suffix: contextString(row.context, 'suffix').slice(0, CONTEXT_CHARS),
  }
}

/** Converts one legacy row; rows whose URL has no canonical form (non-http(s)) are rejected. */
export function transformLegacyRow(row: LegacyRow, userId: string): TransformResult {
  const canonical = canonicalUrl(row.url)
  const site = siteKey(row.url)
  if (canonical === null || site === null) return { ok: false, reason: 'unsupported url' }
  return {
    ok: true,
    row: {
      id: row.id,
      user_id: userId,
      canonical_url: canonical,
      site_key: site,
      url: row.url,
      text: row.text,
      color: legacyColorToName(row.color),
      comment: row.comment,
      anchor: legacyAnchor(row),
      page_title: row.pageTitle,
      favicon: row.favicon,
      created_at: row.timestamp,
      edited_at: row.timestamp,
      device_id: LEGACY_DEVICE_ID,
      deleted_at: null,
    },
  }
}

export interface MigrationPlan {
  inserts: V2Row[]
  existing: string[]
  skipped: { id: string; reason: string }[]
  colors: Record<string, number>
  nullAnchors: number
}

/**
 * Splits legacy rows into inserts, already-migrated ids and skipped rows. Inserts are ordered by
 * legacy timestamp (then id) so server_seq follows the original creation order.
 */
export function planMigration(legacy: readonly LegacyRow[], existingIds: ReadonlySet<string>, userId: string): MigrationPlan {
  const plan: MigrationPlan = { inserts: [], existing: [], skipped: [], colors: {}, nullAnchors: 0 }
  const sorted = [...legacy].sort((a, b) => a.timestamp - b.timestamp || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const row of sorted) {
    if (existingIds.has(row.id)) {
      plan.existing.push(row.id)
      continue
    }
    const result = transformLegacyRow(row, userId)
    if (!result.ok) {
      plan.skipped.push({ id: row.id, reason: result.reason })
      continue
    }
    plan.inserts.push(result.row)
    plan.colors[result.row.color] = (plan.colors[result.row.color] ?? 0) + 1
    if (result.row.anchor === null) plan.nullAnchors += 1
  }
  return plan
}

/** Human-readable statistics and per-row diff (one line per legacy row). */
export function formatPlan(plan: MigrationPlan, legacy: readonly LegacyRow[]): string {
  const byId = new Map(legacy.map((r) => [r.id, r]))
  const lines = [
    `legacy rows:      ${legacy.length}`,
    `to insert:        ${plan.inserts.length}`,
    `already migrated: ${plan.existing.length}`,
    `skipped:          ${plan.skipped.length}`,
    `colors:           ${Object.entries(plan.colors).map(([name, n]) => `${name}=${n}`).join(' ') || '-'}`,
    `null anchors:     ${plan.nullAnchors}`,
    '',
  ]
  for (const row of plan.inserts) {
    const old = byId.get(row.id)
    const anchor = row.anchor ? `${row.anchor.start}-${row.anchor.end}` : 'null'
    lines.push(`+ ${row.id}  color ${old?.color ?? '?'} -> ${row.color}  url ${row.url} -> ${row.canonical_url}  site ${row.site_key}  anchor ${anchor}`)
  }
  for (const id of plan.existing) lines.push(`= ${id}  already in public.highlights`)
  for (const { id, reason } of plan.skipped) lines.push(`! ${id}  skipped: ${reason} (${byId.get(id)?.url ?? '?'})`)
  return lines.join('\n')
}

export interface CliOptions {
  user: string
  dryRun: boolean
  backup: string | null
  source: LegacySource
}

/** Tables the legacy rows can be read from: before the v2 migration they still live in public.highlights. */
export const LEGACY_SOURCES = ['highlights_legacy', 'highlights'] as const
export type LegacySource = (typeof LEGACY_SOURCES)[number]

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { user: '', dryRun: false, backup: null, source: 'highlights_legacy' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--user' || arg === '--backup' || arg === '--source') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error(`${arg} needs a value`)
      if (arg === '--user') options.user = value
      else if (arg === '--backup') options.backup = value
      else if ((LEGACY_SOURCES as readonly string[]).includes(value)) options.source = value as LegacySource
      else throw new Error(`--source must be one of ${LEGACY_SOURCES.join(', ')}`)
      i += 1
    } else throw new Error(`unknown argument: ${arg}`)
  }
  const backupOnly = options.user === '' && options.backup !== null && !options.dryRun
  if (!backupOnly && !UUID_PATTERN.test(options.user)) throw new Error('--user <uid> is required and must be a uuid')
  // Before the v2 migration public.highlights is the legacy table, so migrating from it would write into itself.
  if (!backupOnly && options.source !== 'highlights_legacy') throw new Error('--source highlights is only allowed for a backup without --user')
  return options
}

async function fetchLegacy(client: SupabaseClient, source: LegacySource): Promise<LegacyRow[]> {
  const rows: LegacyRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from(source)
      .select('*')
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`reading ${source} failed: ${error.message}`)
    rows.push(...(data as LegacyRow[]))
    if (data.length < PAGE_SIZE) return rows
  }
}

async function fetchExistingIds(client: SupabaseClient, ids: readonly string[]): Promise<Set<string>> {
  const existing = new Set<string>()
  // Small chunks keep the `in (...)` filter well under URL length limits.
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await client.from('highlights').select('id').in('id', ids.slice(i, i + 100))
    if (error) throw new Error(`reading public.highlights failed: ${error.message}`)
    for (const row of data as { id: string }[]) existing.add(row.id)
  }
  return existing
}

/** Number of rows of `user` in public.highlights written by a client rather than this script. */
async function countClientRows(client: SupabaseClient, user: string): Promise<number> {
  const { count, error } = await client
    .from('highlights')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user)
    .neq('device_id', LEGACY_DEVICE_ID)
  if (error) throw new Error(`reading public.highlights failed: ${error.message}`)
  return count ?? 0
}

async function insertRows(client: SupabaseClient, rows: readonly V2Row[]): Promise<number> {
  let inserted = 0
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    // ignoreDuplicates (on conflict do nothing) keeps a concurrent or repeated run idempotent;
    // defaultToNull:false lets server_seq take its column default.
    const { data, error } = await client
      .from('highlights')
      .upsert(rows.slice(i, i + INSERT_BATCH), { onConflict: 'id', ignoreDuplicates: true, defaultToNull: false })
      .select('id')
    if (error) throw new Error(`inserting into public.highlights failed: ${error.message}`)
    inserted += data.length
  }
  return inserted
}

async function main(argv: string[]): Promise<number> {
  let options: CliOptions
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(`[migrate-legacy] ${(error as Error).message}`)
    console.error('usage: node scripts/migrate-legacy.ts --user <uid> [--dry-run] [--backup <file>]')
    console.error('       node scripts/migrate-legacy.ts --backup <file> [--source highlights|highlights_legacy]')
    return 2
  }
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('[migrate-legacy] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
    return 2
  }
  const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })

  const legacy = await fetchLegacy(client, options.source)
  if (options.backup) {
    const file = resolve(options.backup)
    writeFileSync(file, `${JSON.stringify(legacy, null, 2)}\n`)
    console.log(`[migrate-legacy] backup: ${legacy.length} rows from public.${options.source} -> ${file}`)
  }
  if (options.user === '') return 0

  const existing = await fetchExistingIds(client, legacy.map((r) => r.id))
  const plan = planMigration(legacy, existing, options.user)
  console.log(formatPlan(plan, legacy))

  if (options.dryRun) {
    console.log('[migrate-legacy] dry run: nothing written')
    return 0
  }
  const clientRows = await countClientRows(client, options.user)
  if (clientRows > 0) {
    console.error(
      `[migrate-legacy] refusing to write: public.highlights already has ${clientRows} rows from a client for this user; ` +
        'the migration must run before the first sign-in',
    )
    return 1
  }
  const inserted = await insertRows(client, plan.inserts)
  console.log(`[migrate-legacy] inserted ${inserted} rows`)
  return 0
}

// Only run when executed directly, so the unit test can import the pure functions.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`[migrate-legacy] ${(error as Error).message}`)
      process.exit(1)
    },
  )
}
