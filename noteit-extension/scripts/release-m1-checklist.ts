// M1 release handoff (Story 2.24, architecture.md "Escalations"). Runs the pre-release checks an agent can
// do offline and prints the ordered checklist of online steps Polym runs himself (E1-E6).
//
// Usage (Node 24 runs this TypeScript file natively, cwd = noteit-extension, after `npm run build`):
//   node scripts/release-m1-checklist.ts [--backup <file>]
//
//   --backup <file>   count the rows of an E1 backup (migrate-legacy.ts --backup output) and print them
//                     next to the read-only row-count check
//
// Checks (exit 1 when any fails): package.json and dist/manifest.json versions match, the release tag
// v<version> does not exist yet, and scan:dist passes on dist/. The script never contacts Supabase or
// GitHub, never reads credentials and never runs the printed commands.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEGACY_DEVICE_ID } from './migrate-legacy.ts'

export { LEGACY_DEVICE_ID }

export interface ReleaseFacts {
  packageVersion: string
  /** null when dist/manifest.json is missing. */
  manifestVersion: string | null
  existingTags: readonly string[]
  /** scan-dist exit code; null when it could not run. */
  scanStatus: number | null
  /** Row count of the E1 backup file; null when no --backup was given. */
  backupRows: number | null
}

export function releaseTag(version: string): string {
  return `v${version}`
}

/** Returns the failed pre-release checks; empty means ready to hand off. */
export function checkRelease(facts: ReleaseFacts): string[] {
  const errors: string[] = []
  if (facts.manifestVersion === null) {
    errors.push('dist/manifest.json not found; run npm run build first')
  } else if (facts.manifestVersion !== facts.packageVersion) {
    errors.push(`dist/manifest.json version ${facts.manifestVersion} != package.json version ${facts.packageVersion}`)
  }
  const tag = releaseTag(facts.packageVersion)
  if (facts.existingTags.includes(tag)) {
    errors.push(`tag ${tag} already exists; bump package.json version before releasing`)
  }
  if (facts.scanStatus !== 0) {
    errors.push(`scan:dist failed (exit ${facts.scanStatus ?? 'not run'})`)
  }
  return errors
}

/** Counts the rows of a migrate-legacy.ts --backup file (a JSON array). */
export function countBackupRows(json: string): number {
  const value: unknown = JSON.parse(json)
  if (!Array.isArray(value)) throw new Error('backup file is not a JSON array')
  return value.length
}

/** Read-only SQL for the post-migration check: new rows owned by <uid> written by the migration. */
export function rowCountSql(uidPlaceholder = '<uid>'): string {
  return `select count(*) from public.highlights where user_id = '${uidPlaceholder}' and device_id = '${LEGACY_DEVICE_ID}';`
}

/** The ordered handoff text. Commands only reference credentials by env var name. */
export function formatChecklist(facts: ReleaseFacts, errors: readonly string[]): string {
  const tag = releaseTag(facts.packageVersion)
  const backupFile = 'backup-highlights-legacy.json'
  const backupNote = facts.backupRows === null ? '<rows in backup file>' : String(facts.backupRows)
  const lines = [
    '# NoteIt M1 release checklist',
    '',
    '## Pre-release checks (agent, offline)',
    `- version: package.json ${facts.packageVersion}, dist/manifest.json ${facts.manifestVersion ?? 'missing'}`,
    `- release tag: ${tag} ${facts.existingTags.includes(tag) ? '(ALREADY EXISTS)' : '(not created yet)'}`,
    `- scan:dist: ${facts.scanStatus === 0 ? 'pass' : `FAIL (exit ${facts.scanStatus ?? 'not run'})`}`,
    `- E1 backup rows: ${facts.backupRows === null ? 'not checked (pass --backup <file>)' : facts.backupRows}`,
    '- also required before handoff: npm run verify green; npm run test:perf -- --absolute on the Polym',
    '  machine meets the SC-3 create and open-side-panel budgets',
    errors.length === 0 ? '- result: READY' : `- result: NOT READY\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    '',
    '## Steps for Polym (run in this order, cwd = noteit-extension unless noted)',
    '',
    '1. E1 backup of the live legacy table before db push (read-only, service role key from your shell only):',
    `   SUPABASE_URL=<live url> SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/migrate-legacy.ts --backup ${backupFile} --source highlights`,
    `   Confirm: rows in ${backupFile} = select count(*) from public.highlights; (live, still the legacy table)`,
    `   Optional: node scripts/release-m1-checklist.ts --backup ${backupFile}`,
    '',
    '2. E3 in the Supabase dashboard: disable public sign-ups, create your account (email + password), copy its uid.',
    '',
    '3. E2 schema and data (from the repo root for supabase commands):',
    '   supabase link --project-ref <project-ref>',
    '   supabase db push',
    '   Dry run first, then migrate:',
    '   SUPABASE_URL=<live url> SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/migrate-legacy.ts --user <uid> --dry-run',
    '   SUPABASE_URL=<live url> SUPABASE_SERVICE_ROLE_KEY=<key> node scripts/migrate-legacy.ts --user <uid>',
    '   Read-only check in the SQL editor (expect backup rows minus rows the dry run reported as skipped):',
    `   ${rowCountSql()}`,
    `   Expected: ${backupNote} - skipped`,
    '   Rollback if needed (destroys every v2 row; take a fresh backup first):',
    '   psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f scripts/rollback-v2.sql',
    '',
    '4. E4 (required before step 6; release.yml fails without it): set repository Variables',
    '   VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to the live public values.',
    '',
    '5. E6 before installing M1 on any of your devices: confirm the E1 backup exists',
    '   (the first sign-in wipes local data and pulls from the cloud).',
    '',
    `6. E5 release: git tag ${tag} && git push origin ${tag} (release.yml builds and publishes the zip).`,
    '   Smoke test once in Edge. Then start the one-week two-device trial and run daily:',
    '   SUPABASE_URL=<live url> SUPABASE_ANON_KEY=<anon key> NOTEIT_EMAIL=<email> NOTEIT_PASSWORD=<password> \\',
    '     node scripts/verify-consistency.ts <device-a.json> <device-b.json>',
    '   0 missing / 0 duplicates every day means SC-1 is met.',
    '',
    'The agent runs none of these online steps and holds no service role key or access token.',
  ]
  return lines.join('\n')
}

function gitTags(): string[] {
  const result = spawnSync('git', ['tag', '--list'], { encoding: 'utf8' })
  if (result.status !== 0) return []
  return result.stdout.split('\n').map((t) => t.trim()).filter((t) => t !== '')
}

function main(args: string[]): number {
  const backupIndex = args.indexOf('--backup')
  const backupPath = backupIndex === -1 ? null : args[backupIndex + 1]
  if (backupIndex !== -1 && !backupPath) {
    console.error('usage: node scripts/release-m1-checklist.ts [--backup <file>]')
    return 2
  }

  const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
  const manifestPath = resolve('dist/manifest.json')
  const manifestVersion = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as { version: string }).version
    : null

  let scanStatus: number | null = null
  if (manifestVersion !== null) {
    const scan = spawnSync(process.execPath, ['scripts/scan-dist.ts'], { stdio: 'inherit' })
    scanStatus = scan.status
  }

  const facts: ReleaseFacts = {
    packageVersion: pkg.version,
    manifestVersion,
    existingTags: gitTags(),
    scanStatus,
    backupRows: backupPath ? countBackupRows(readFileSync(resolve(backupPath), 'utf8')) : null,
  }
  const errors = checkRelease(facts)
  console.log(`\n${formatChecklist(facts, errors)}`)
  return errors.length === 0 ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
