// M2 release handoff (Story 3.17, architecture.md "Escalations" E5). Runs the offline pre-release checks
// (same as M1: versions match, tag is new, scan:dist passes) and prints the handoff: the gates that must
// be green before the tag, the E5 tag command and a <= 30 minute manual Edge smoke test.
//
// Usage (Node 24, cwd = noteit-extension, after `npm run build`):
//   node scripts/release-m2-checklist.ts
//
// Exit 1 when a pre-release check fails. The script never contacts Supabase or GitHub, never reads
// credentials and never runs the printed commands.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkRelease, releaseTag, type ReleaseFacts } from './release-m1-checklist.ts'

/** Key Flow E2E files (EXPERIENCE.md Flow 1-3) that must pass before the tag. */
export const KEY_FLOW_E2E = [
  'tests/e2e/flow-1-reading.e2e.ts',
  'tests/e2e/flow-2-timeline.e2e.ts',
  'tests/e2e/flow-3-review.e2e.ts',
] as const

/** One manual Edge smoke step: what to do, what to see, and its time budget in minutes. */
export interface SmokeStep {
  action: string
  expect: string
  minutes: number
}

/** Edge smoke test for M2 (one manual run per milestone release, PRD). Total must stay <= 30 minutes. */
export const EDGE_SMOKE: readonly SmokeStep[] = [
  {
    action: 'Install the release zip in Edge (edge://extensions, developer mode, load unpacked from the unzipped folder)',
    expect: 'No errors on the extension card; the toolbar icon shows',
    minutes: 3,
  },
  {
    action: 'Open the side panel and sign in with your account',
    expect: 'The login form only, then the current page view; a wrong password shows the credential error',
    minutes: 3,
  },
  {
    action: 'Open a long article on a site that is off; press "turn on" in the side panel',
    expect: 'The header switch turns on; the page shows no status overlay',
    minutes: 2,
  },
  {
    action: 'Select a sentence, click the yellow dot; select another, comment button, blue dot, type, Cmd/Ctrl+Enter',
    expect: 'Both highlights render; the commented one has a dotted underline; the badge counts 2',
    minutes: 4,
  },
  {
    action: 'Hover the commented highlight; click the other one, add a comment, Cmd/Ctrl+Enter; delete one from the popover and undo',
    expect: 'Hover only previews; the popover saves and closes; "deleted · undo" restores the highlight',
    minutes: 4,
  },
  {
    action: 'Use Cmd/Ctrl+Shift+H and the right-click menu item on a new selection',
    expect: 'Both create a yellow highlight; the context menu has a single NoteIt item',
    minutes: 2,
  },
  {
    action: 'In the side panel: current page order, click an item, switch to all sites, expand a page group',
    expect: 'Items in article order; the click scrolls and flashes the highlight; groups by date then page',
    minutes: 4,
  },
  {
    action: 'Reload the article',
    expect: 'Every highlight comes back with its color, comment and underline',
    minutes: 2,
  },
  {
    action: 'Turn Wi-Fi off, make a highlight, turn Wi-Fi on, wait about a minute, open the account panel',
    expect: 'The header shows the pending count while offline; pending returns to 0 and the last sync time updates',
    minutes: 4,
  },
  {
    action: 'On a Chrome device signed in to the same account, open the same article',
    expect: 'The Edge highlights show there too',
    minutes: 2,
  },
]

export function smokeMinutes(steps: readonly SmokeStep[] = EDGE_SMOKE): number {
  return steps.reduce((sum, s) => sum + s.minutes, 0)
}

/** The ordered handoff text for Polym. */
export function formatChecklist(facts: ReleaseFacts, errors: readonly string[]): string {
  const tag = releaseTag(facts.packageVersion)
  const lines = [
    '# NoteIt M2 release checklist',
    '',
    '## Pre-release checks (agent, offline)',
    `- version: package.json ${facts.packageVersion}, dist/manifest.json ${facts.manifestVersion ?? 'missing'}`,
    `- release tag: ${tag} ${facts.existingTags.includes(tag) ? '(ALREADY EXISTS)' : '(not created yet)'}`,
    `- scan:dist: ${facts.scanStatus === 0 ? 'pass' : `FAIL (exit ${facts.scanStatus ?? 'not run'})`}`,
    errors.length === 0 ? '- result: READY' : `- result: NOT READY\n${errors.map((e) => `  - ${e}`).join('\n')}`,
    '',
    '## Gates that must be green before the tag (cwd = noteit-extension)',
    '1. npm run verify (CI verify.yml runs the same steps), which includes the Key Flow E2E:',
    ...KEY_FLOW_E2E.map((f) => `   - ${f}`),
    '   plus the axe and keyboard review (tests/e2e/sidepanel-a11y.e2e.ts) and the SC-3 perf cases.',
    '2. On the Polym machine: npm run build && npm run test:perf -- --absolute',
    '   All three SC-3 budgets (create, restore, open side panel) must pass.',
    '',
    '## Steps for Polym',
    '',
    `1. E5 release: git tag ${tag} && git push origin ${tag} (release.yml builds and publishes the zip).`,
    `   If ${tag} already exists, bump "version" in package.json first and rebuild.`,
    '',
    `2. Edge smoke test, once (about ${smokeMinutes()} minutes):`,
    ...EDGE_SMOKE.flatMap((s, i) => [`   ${i + 1}. ${s.action} (${s.minutes} min)`, `      expect: ${s.expect}`]),
    '',
    '3. If a smoke step fails: do not announce the release; open an issue with the step number and a',
    '   screenshot. The release can be withdrawn by deleting the GitHub release; the tag stays for history.',
    '',
    'The agent runs none of these steps and holds no access token.',
  ]
  return lines.join('\n')
}

function gitTags(): string[] {
  const result = spawnSync('git', ['tag', '--list'], { encoding: 'utf8' })
  if (result.status !== 0) return []
  return result.stdout.split('\n').map((t) => t.trim()).filter((t) => t !== '')
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

  const facts: ReleaseFacts = { packageVersion: pkg.version, manifestVersion, existingTags: gitTags(), scanStatus, backupRows: null }
  const errors = checkRelease(facts)
  console.log(`\n${formatChecklist(facts, errors)}`)
  return errors.length === 0 ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
