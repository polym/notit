// Runs the anchoring corpus against the current engine and writes corpus-report.json.
// Fails when the overall recovery rate is below CORPUS_MIN_RATE (95%, SC-2; sourceGone excluded).
// tests/corpus/baseline.json records the last accepted run for review; CORPUS_UPDATE_BASELINE=1
// (npm run baseline:update) rewrites it from this run.
import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { BrowserContext, Page, Worker } from '@playwright/test'
import { test, expect, signIn } from '../e2e/fixtures/extension.ts'
import { startStaticServer, type StaticServer } from '../helpers/static-server.ts'
import { openExtensionPage, resetLocalData, seedHighlights, seedToCreateReq } from '../helpers/local-db.ts'
import {
  buildReport,
  classifyInPage,
  checkCorpusGate,
  computeSeedsInPage,
  formatReport,
  loadSnapshots,
  markSignatureInPage,
  summarizeSnapshot,
  toBaseline,
  type Seed,
  type Snapshot,
  type SnapshotResult,
} from './runner.ts'

const CORPUS_DIR = resolve(import.meta.dirname)
const REPORT_PATH = join(CORPUS_DIR, 'corpus-report.json')
const BASELINE_PATH = join(CORPUS_DIR, 'baseline.json')
const ENGINE = 'anchor-resolve+mark-renderer'

// Same context length as src/content/SelectionManager.ts getSelectionContext (stored in anchor.prefix/suffix).
const CONTEXT_LENGTH = 64
// Pages settle (late ads, simulated fetches, the engine's 300 ms debounced re-resolve) before results are read.
const MIN_SETTLE_MS = 3000
const STABLE_FOR_MS = 1500
const MAX_SETTLE_MS = 15_000
const POLL_MS = 250

async function settle(page: Page): Promise<void> {
  const started = Date.now()
  let last = await page.evaluate(markSignatureInPage)
  let stableSince = Date.now()
  while (Date.now() - started < MAX_SETTLE_MS) {
    await page.waitForTimeout(POLL_MS)
    const current = await page.evaluate(markSignatureInPage)
    if (current !== last) {
      last = current
      stableSince = Date.now()
    } else if (Date.now() - started >= MIN_SETTLE_MS && Date.now() - stableSince >= STABLE_FOR_MS) {
      return
    }
  }
}

/**
 * Stores seeds through highlight/create, the way the content script saves a selection. Records need
 * UUID ids, so each snapshot id is mapped to a fresh UUID; returns snapshot id -> UUID.
 */
async function storeSeeds(ext: Page, url: string, title: string, seeds: Seed[]): Promise<Map<string, string>> {
  const ids = new Map(seeds.map((s) => [s.id, crypto.randomUUID()]))
  await seedHighlights(
    ext,
    seeds.map((s) => seedToCreateReq(s, url, title, ids.get(s.id))),
  )
  return ids
}

async function runSnapshot(
  snapshot: Snapshot,
  server: StaticServer,
  context: BrowserContext,
  ext: Page,
  serviceWorker: Worker,
): Promise<SnapshotResult> {
  const url = `${server.origin}/${snapshot.name}/page.html`
  const { highlights } = snapshot.expected
  // The session from the test start survives the reset (Story 2.15 login gate).
  await resetLocalData(serviceWorker, { keepSession: true })

  // 1. Seed: the extension is inactive (no stored highlights, site not enabled), so the page is untouched.
  const seedPage = await context.newPage()
  await seedPage.goto(url)
  await seedPage.waitForTimeout(MIN_SETTLE_MS)
  const seeds = await seedPage.evaluate(computeSeedsInPage, { highlights, contextLength: CONTEXT_LENGTH })
  if (typeof seeds === 'string') throw new Error(`${snapshot.name}: ${seeds}`)
  const title = await seedPage.title()
  await seedPage.close()

  // 2. Restore: stored highlights auto-enable the site; the engine renders them on load.
  const ids = await storeSeeds(ext, url, title, seeds)
  const page = await context.newPage()
  await page.goto(url)
  await settle(page)
  // Classify against the stored UUIDs, then report under the snapshot's own ids.
  const stored = highlights.map((h) => ({ ...h, id: ids.get(h.id) ?? h.id }))
  const byUuid = new Map([...ids].map(([name, uuid]) => [uuid, name]))
  const results = (await page.evaluate(classifyInPage, stored)).map((r) => ({ ...r, id: byUuid.get(r.id) ?? r.id }))
  await page.close()
  return summarizeSnapshot(snapshot, results)
}

test('anchoring corpus recovers at least 95% of highlights', async ({ context, extensionId, serviceWorker, externalRequests }) => {
  const snapshots = loadSnapshots(CORPUS_DIR)
  expect(snapshots.length).toBeGreaterThan(0)
  test.setTimeout(60_000 * snapshots.length)

  const server = await startStaticServer(CORPUS_DIR)
  const results: SnapshotResult[] = []
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  try {
    for (const snapshot of snapshots) {
      results.push(await runSnapshot(snapshot, server, context, ext, serviceWorker))
    }
  } finally {
    await server.close()
  }

  const report = buildReport(ENGINE, results)
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(formatReport(report))

  // Snapshots are sanitized and must never reach the network.
  expect(externalRequests).toEqual([])

  if (process.env.CORPUS_UPDATE_BASELINE === '1') {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(toBaseline(report), null, 2)}\n`)
    console.log(`wrote ${BASELINE_PATH}`)
  }
  expect(checkCorpusGate(report)).toEqual([])
})
