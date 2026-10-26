// SC-1 manual daily check (architecture.md "Diagnostics"): compares the local id exports of two
// devices (debug.html -> "export local ids") with the cloud rows of the same account and prints the
// missing count and the duplicate count (same text at the same position). 0 / 0 means consistent.
//
// Usage (Node 24 runs this TypeScript file natively, cwd = noteit-extension):
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... NOTEIT_EMAIL=... NOTEIT_PASSWORD=... \
//     node scripts/verify-consistency.ts <device-a.json> <device-b.json>
//   node scripts/verify-consistency.ts <device-a.json> <device-b.json> --cloud <snapshot.json>
//
//   --cloud <file>   compare against a saved cloud snapshot (JSON array of rows) instead of querying
//
// The cloud is queried read-only with the user's own session under RLS (anon key + password sign-in);
// the script never needs or accepts a service role key. Exit code: 0 when missing and duplicates
// are both 0, 1 otherwise, 2 on usage errors.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { compareConsistency, parseLocalIdExport, type CloudRow, type ConsistencyReport } from '../src/core/diagnostics/consistency.ts'

const PAGE_SIZE = 1000
export const CLOUD_COLUMNS = 'id, canonical_url, text, anchor, edited_at, deleted_at'

export interface CliOptions {
  devices: string[]
  cloud: string | null
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const options: CliOptions = { devices: [], cloud: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--cloud') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error('--cloud needs a value')
      options.cloud = value
      i += 1
    } else if (arg.startsWith('--')) throw new Error(`unknown argument: ${arg}`)
    else options.devices.push(arg)
  }
  if (options.devices.length !== 2) throw new Error('exactly two device export files are required')
  return options
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toNumber(v: unknown): number | null {
  // bigint columns arrive as numbers from PostgREST; accept numeric strings from hand-made snapshots.
  if (typeof v === 'number') return v
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

/** Validates cloud rows (query result or snapshot file). */
export function parseCloudRows(value: unknown): CloudRow[] {
  if (!Array.isArray(value)) throw new Error('cloud snapshot must be a JSON array of rows')
  return value.map((raw: unknown, i: number): CloudRow => {
    if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.canonical_url !== 'string' || typeof raw.text !== 'string') {
      throw new Error(`cloud row ${i} needs id, canonical_url and text`)
    }
    const editedAt = toNumber(raw.edited_at)
    const deletedAt = raw.deleted_at === null || raw.deleted_at === undefined ? null : toNumber(raw.deleted_at)
    if (editedAt === null || (raw.deleted_at != null && deletedAt === null)) throw new Error(`cloud row ${i} has bad edited_at / deleted_at`)
    const a = raw.anchor
    const anchor = isObject(a) && typeof a.start === 'number' && typeof a.end === 'number' ? { start: a.start, end: a.end } : null
    return { id: raw.id, canonical_url: raw.canonical_url, text: raw.text, anchor, edited_at: editedAt, deleted_at: deletedAt }
  })
}

/** Refuses anything that is not a public anon key (service role JWTs and sb_secret_ keys bypass RLS). */
export function assertAnonKey(key: string): void {
  if (key.startsWith('sb_secret_')) throw new Error('a secret key was given; use the anon / publishable key')
  const parts = key.split('.')
  if (parts.length === 3) {
    let role: unknown
    try {
      role = (JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { role?: unknown }).role
    } catch {
      role = undefined
    }
    if (role !== 'anon') throw new Error('the key is not an anon key; the script only runs under the user session')
  }
}

/** Ids only; never prints text, comments or URLs. */
export function formatReport(report: ConsistencyReport): string {
  const lines = [`missing: ${report.missing}`, `duplicates: ${report.duplicates}`, `mismatched (editedAt / deletedAt): ${report.mismatched}`]
  for (const d of report.devices) {
    lines.push(`[${d.name}] missing locally: ${d.missingLocally.length}, missing in cloud: ${d.missingInCloud.length}, mismatched: ${d.mismatched.length}`)
    for (const id of d.missingLocally) lines.push(`  missing locally   ${id}`)
    for (const id of d.missingInCloud) lines.push(`  missing in cloud  ${id}`)
    for (const id of d.mismatched) lines.push(`  mismatched        ${id}`)
  }
  for (const ids of report.duplicateGroups) lines.push(`duplicate group: ${ids.join(', ')}`)
  lines.push(report.missing === 0 && report.duplicates === 0 ? 'result: consistent (0 / 0)' : 'result: NOT consistent')
  return lines.join('\n')
}

async function fetchCloudRows(): Promise<CloudRow[]> {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  const email = process.env.NOTEIT_EMAIL
  const password = process.env.NOTEIT_PASSWORD
  if (!url || !anonKey || !email || !password) {
    throw new Error('SUPABASE_URL, SUPABASE_ANON_KEY, NOTEIT_EMAIL and NOTEIT_PASSWORD must be set (or pass --cloud)')
  }
  assertAnonKey(anonKey)
  const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: signInError } = await client.auth.signInWithPassword({ email, password })
  if (signInError) throw new Error(`sign-in failed: ${signInError.message}`)
  try {
    const rows: unknown[] = []
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client
        .from('highlights')
        .select(CLOUD_COLUMNS)
        .order('id')
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw new Error(`reading public.highlights failed: ${error.message}`)
      rows.push(...data)
      if (data.length < PAGE_SIZE) return parseCloudRows(rows)
    }
  } finally {
    await client.auth.signOut({ scope: 'local' })
  }
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(resolve(file), 'utf8')) as unknown
}

async function main(argv: string[]): Promise<number> {
  let options: CliOptions
  try {
    options = parseArgs(argv)
  } catch (error) {
    console.error(`[verify-consistency] ${(error as Error).message}`)
    console.error('usage: node scripts/verify-consistency.ts <device-a.json> <device-b.json> [--cloud <snapshot.json>]')
    return 2
  }
  const devices = options.devices.map((file) => ({ name: file, export: parseLocalIdExport(readJson(file)) }))
  const cloud = options.cloud ? parseCloudRows(readJson(options.cloud)) : await fetchCloudRows()
  const report = compareConsistency(devices, cloud)
  console.log(formatReport(report))
  return report.missing === 0 && report.duplicates === 0 ? 0 : 1
}

// Only run when executed directly, so the unit test can import the pure functions.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`[verify-consistency] ${(error as Error).message}`)
      process.exit(1)
    },
  )
}
