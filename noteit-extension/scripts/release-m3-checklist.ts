// M3 release handoff (Story 4.8, architecture.md "Escalations" E5 and E7). Runs the offline pre-release
// checks (versions match, tag is new, scan:dist passes), reads the M3 evidence reports (corpus, renderer
// spike, perf) and prints the handoff: the E5 tag step with its Edge smoke test, and the E7 decision on
// dropping highlights_legacy after the SC-1 one-week trial.
//
// Usage (Node 24, cwd = noteit-extension, after `npm run build`, `npm run test:corpus` and `npm run test:perf`):
//   node scripts/release-m3-checklist.ts
//
// Exit 1 when a pre-release check or an evidence gate fails. The script never contacts Supabase or GitHub,
// never reads credentials and never runs the printed commands or SQL. The E7 SQL is text for Polym only.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEGACY_DEVICE_ID, checkRelease, releaseTag, type ReleaseFacts } from './release-m1-checklist.ts'
import { EDGE_SMOKE, KEY_FLOW_E2E, smokeMinutes, type SmokeStep } from './release-m2-checklist.ts'
import { compareToBudgets, type PerfReport } from '../tests/perf/perf.ts'
import { decideRenderer, type SpikeReport } from '../tests/spike/spike.ts'

/** Report files the checklist reads, relative to noteit-extension. */
export const CORPUS_REPORT = 'tests/corpus/corpus-report.json'
export const SPIKE_REPORT = 'tests/spike/spike-report.json'
export const PERF_REPORT = 'tests/perf/perf-report.json'

/**
 * SC-2 gate; same value as CORPUS_MIN_RATE in tests/corpus/runner.ts (that module uses DOM types and
 * cannot be imported under tsconfig.node.json). release-m3-checklist.test.ts asserts they stay equal.
 */
export const M3_CORPUS_MIN_RATE = 0.95
const RATE_EPSILON = 1e-9

/** The subset of corpus-report.json the checklist reads. */
export interface CorpusSummary {
  engine: string
  categories: Record<string, { eligible: number; correct: number; rate: number }>
  overall: { snapshots: number; eligible: number; correct: number; sourceGone: number; rate: number }
}

/** Evidence for the M3 gates; null when a report file is missing. */
export interface M3Evidence {
  corpus: CorpusSummary | null
  spike: SpikeReport | null
  perf: PerfReport | null
  /** Whether an M2 release tag exists (input to the Story 4.7 renderer decision). */
  m2Released: boolean
}

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

/** Returns the failed evidence gates; empty means the reports support an M3 release. */
export function checkEvidence(evidence: M3Evidence): string[] {
  const errors: string[] = []
  if (!evidence.m2Released) {
    errors.push(`M2 release tag ${M2_RELEASE_TAG} missing; release M2 first (node scripts/release-m2-checklist.ts, E5)`)
  }
  if (evidence.corpus === null) {
    errors.push(`${CORPUS_REPORT} missing; run npm run test:corpus`)
  } else if (evidence.corpus.overall.rate < M3_CORPUS_MIN_RATE - RATE_EPSILON) {
    errors.push(`corpus recovery ${pct(evidence.corpus.overall.rate)} is below ${pct(M3_CORPUS_MIN_RATE)} (SC-2)`)
  }
  if (evidence.spike === null) {
    errors.push(`${SPIKE_REPORT} missing; run npm run test:spike`)
  } else if (!evidence.spike.automatedPass) {
    errors.push('renderer spike automated criteria did not all pass; see npm run test:spike')
  }
  if (evidence.perf === null) {
    errors.push(`${PERF_REPORT} missing; run npm run test:perf`)
  } else {
    errors.push(...compareToBudgets(evidence.perf))
  }
  return errors
}

/**
 * M1 and M2 share package version 1.0.0 (Stories 2.24 and 3.17), so v1.0.0 marks the M2 release. M3 must
 * ship after it (Story 4.7 precondition) under a bumped version.
 */
export const M2_RELEASE_TAG = 'v1.0.0'

export function hasM2Release(tags: readonly string[], m2Tag = M2_RELEASE_TAG): boolean {
  return tags.includes(m2Tag)
}

/** Extra Edge smoke steps for the anchoring rewrite; appended to the M2 smoke test. */
export const M3_SMOKE_EXTRA: readonly SmokeStep[] = [
  {
    action: 'Open a page with inline scripts in the body (for example a news article), highlight three sentences, reload',
    expect: 'All three highlights come back on the same words',
    minutes: 2,
  },
  {
    action: 'Scroll x.com/home past a highlighted tweet and back',
    expect: 'The highlight reappears within about a second; scrolling stays smooth',
    minutes: 2,
  },
]

/**
 * M2 steps left out of the M3 smoke test to stay within 30 minutes: M3 does not change them and the E2E
 * suites cover them (context-menu / shortcut creation, and the second-device check in two-device E2E).
 */
export const M3_SMOKE_SKIPPED: readonly SmokeStep[] = [EDGE_SMOKE[5], EDGE_SMOKE[9]]

/** The full M3 smoke test: the remaining M2 steps plus the M3 extras. Must stay <= 30 minutes. */
export const M3_SMOKE: readonly SmokeStep[] = [
  ...EDGE_SMOKE.filter((s) => !M3_SMOKE_SKIPPED.includes(s)),
  ...M3_SMOKE_EXTRA,
]

/** Read-only SQL Polym runs before deciding on E7; both counts should match the E1 backup expectations. */
export function legacyConsistencySql(uidPlaceholder = '<uid>'): string[] {
  return [
    'select count(*) as legacy_rows from public.highlights_legacy;',
    `select count(*) as migrated_rows from public.highlights where user_id = '${uidPlaceholder}' and device_id = '${LEGACY_DEVICE_ID}';`,
    '-- legacy ids with no v2 row (expect only the rows migrate-legacy.ts --dry-run reported as skipped):',
    'select l.id, l.url from public.highlights_legacy l left join public.highlights h on h.id = l.id where h.id is null;',
  ]
}

/**
 * E7 drop statement (irreversible). Text only: the agent never runs it. After this, scripts/rollback-v2.sql
 * no longer works, so the E1 backup file becomes the only copy of the legacy data.
 */
export const DROP_LEGACY_SQL = 'drop table if exists public.highlights_legacy;'

/** The ordered handoff text for Polym. */
export function formatChecklist(
  facts: ReleaseFacts,
  evidence: M3Evidence,
  errors: readonly string[],
): string {
  const tag = releaseTag(facts.packageVersion)
  const corpus = evidence.corpus
  const spike = evidence.spike
  const decision = spike === null ? null : decideRenderer(spike, evidence.m2Released)

  const corpusLines =
    corpus === null
      ? ['- corpus: missing']
      : [
          `- corpus (${corpus.engine}): ${pct(corpus.overall.rate)} (${corpus.overall.correct}/${corpus.overall.eligible}, ` +
            `${corpus.overall.snapshots} snapshots, ${corpus.overall.sourceGone} sourceGone excluded), gate ${pct(M3_CORPUS_MIN_RATE)}`,
          ...Object.entries(corpus.categories).map(
            ([name, c]) => `  - ${name}: ${pct(c.rate)} (${c.correct}/${c.eligible})`,
          ),
        ]
  const spikeLines =
    spike === null || decision === null
      ? ['- renderer spike: missing']
      : [
          `- renderer spike (${spike.browser}): automated ${spike.automatedPass ? 'pass' : 'FAIL'}`,
          ...spike.criteria.map((c) => `  - ${c.id} ${c.pass ? 'pass' : 'FAIL'}: ${c.title}`),
          ...spike.manual.map((m) => `  - ${m.id} manual (${m.status}, ${m.owner}): ${m.title}`),
          `  - default renderer: ${decision.renderer}${decision.reasons.length ? ` (${decision.reasons.join('; ')})` : ''}`,
        ]
  const perfLines =
    evidence.perf === null
      ? ['- perf: missing']
      : [
          `- perf (${evidence.perf.engine}, ${evidence.perf.iterations} iterations):`,
          ...evidence.perf.results.map(
            (r) => `  - ${r.metric} / ${r.mode}: p95 ${r.p95}ms, budget ${r.budget}ms${r.overBudget ? ' OVER BUDGET' : ''}`,
          ),
        ]

  const lines = [
    '# NoteIt M3 release checklist',
    '',
    '## Pre-release checks (agent, offline)',
    `- version: package.json ${facts.packageVersion}, dist/manifest.json ${facts.manifestVersion ?? 'missing'}`,
    `- release tag: ${tag} ${facts.existingTags.includes(tag) ? '(ALREADY EXISTS)' : '(not created yet)'}`,
    `- scan:dist: ${facts.scanStatus === 0 ? 'pass' : `FAIL (exit ${facts.scanStatus ?? 'not run'})`}`,
    errors.length === 0 ? '- result: READY' : `- result: NOT READY\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    '',
    '## M3 evidence',
    ...corpusLines,
    ...spikeLines,
    ...perfLines,
    '',
    '## Gates that must be green before the tag (cwd = noteit-extension)',
    '1. npm run verify (CI verify.yml runs the same steps): corpus >= 95% and the Key Flow E2E:',
    ...KEY_FLOW_E2E.map((f) => `   - ${f}`),
    '2. On the Polym machine: npm run build && npm run test:perf -- --absolute (all budgets pass).',
    '',
    '## Steps for Polym',
    '',
    `1. E5 release: git tag ${tag} && git push origin ${tag} (release.yml builds and publishes the zip).`,
    `   If ${tag} already exists, bump "version" in package.json first and rebuild.`,
    '',
    `2. Edge smoke test before announcing the release, once (about ${smokeMinutes(M3_SMOKE)} minutes):`,
    ...M3_SMOKE.flatMap((s, i) => [`   ${i + 1}. ${s.action} (${s.minutes} min)`, `      expect: ${s.expect}`]),
    '   Also confirm spike item S3 (Edge dotted underline) if it is still pending; see tests/spike/spike.ts MANUAL_ITEMS.',
    '   If a step fails: do not announce the release; open an issue with the step number and a screenshot.',
    '',
    '3. E7 decision on highlights_legacy (irreversible; only after the SC-1 one-week trial shows',
    '   0 missing / 0 duplicates every day with scripts/verify-consistency.ts):',
    '   a. Read-only checks in the SQL editor:',
    ...legacyConsistencySql().map((s) => `      ${s}`),
    '   b. Keep the E1 backup file (backup-highlights-legacy.json) somewhere outside the repo;',
    '      after the drop it is the only copy and scripts/rollback-v2.sql stops working.',
    '   c. Only if you decide to drop, run in the SQL editor:',
    `      ${DROP_LEGACY_SQL}`,
    '   Keeping the table is also a valid decision; nothing in the extension reads it.',
    '',
    'The agent runs none of these steps, executes no SQL and holds no access token.',
  ]
  return lines.join('\n')
}

function gitTags(): string[] {
  const result = spawnSync('git', ['tag', '--list'], { encoding: 'utf8' })
  if (result.status !== 0) return []
  return result.stdout.split('\n').map((t) => t.trim()).filter((t) => t !== '')
}

function readJson<T>(path: string): T | null {
  const full = resolve(path)
  return existsSync(full) ? (JSON.parse(readFileSync(full, 'utf8')) as T) : null
}

function main(): number {
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

  const tags = gitTags()
  const facts: ReleaseFacts = { packageVersion: pkg.version, manifestVersion, existingTags: tags, scanStatus, backupRows: null }
  const evidence: M3Evidence = {
    corpus: readJson<CorpusSummary>(CORPUS_REPORT),
    spike: readJson<SpikeReport>(SPIKE_REPORT),
    perf: readJson<PerfReport>(PERF_REPORT),
    m2Released: hasM2Release(tags),
  }
  const errors = [...checkRelease(facts), ...checkEvidence(evidence)]
  console.log(`\n${formatChecklist(facts, evidence, errors)}`)
  return errors.length === 0 ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
