// Performance cases for SC-3 and NFR4 against the built extension (architecture.md "Testing & CI Architecture").
// Each metric runs ITERATIONS times online and again with context.setOffline(true); p95 goes to perf-report.json.
// Timing uses in-page performance.now() with MutationObserver / PerformanceObserver('longtask').
// Modes:
//   default                 fail when any p95 regresses > 20% over max(baseline, per-metric minimum reference; see perf.ts);
//                           over-budget items are only reported
//   PERF_ABSOLUTE=1         (npm run test:perf -- --absolute) fail when any p95 exceeds its NFR1-NFR4 budget
//   PERF_UPDATE_BASELINE=1  (npm run baseline:update) rewrite the baseline from this run
// Offline note: setOffline also blocks 127.0.0.1, so page cases load the page online and switch offline
// before the measured interaction (the offline restore case forces a full re-restore after switching).
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { BrowserContext, Page, Worker } from '@playwright/test'
import { test, expect, signIn, signInFromPage } from '../e2e/fixtures/extension.ts'
import { startStaticServer, type StaticServer } from '../helpers/static-server.ts'
import { computeSeedsInPage, type ExpectedHighlight, type Seed } from '../corpus/runner.ts'
import {
  enableSite,
  ensureLocalDb,
  liveRecords,
  openExtensionPage,
  putRecords,
  resetLocalData,
  seedHighlights,
  seedToCreateReq,
} from '../helpers/local-db.ts'
import type { HighlightRecord } from '../../src/core/model/index.ts'
import { canonicalUrl, siteKey } from '../../src/core/url/index.ts'
import { clickMenuButton } from '../e2e/fixtures/page-actions.ts'
import {
  PERF_METRICS,
  PERF_MODES,
  buildPerfReport,
  compareToBudgets,
  compareToPerfBaseline,
  formatPerfReport,
  summarizeMetric,
  toPerfBaseline,
  type MetricResult,
  type PerfBaseline,
  type PerfMode,
} from './perf.ts'

const PERF_DIR = resolve(import.meta.dirname)
const PAGES_DIR = join(PERF_DIR, 'pages')
const REPORT_PATH = join(PERF_DIR, 'perf-report.json')
const BASELINE_PATH = join(PERF_DIR, 'baseline.json')
const ENGINE = 'legacy-mark.js'

const ITERATIONS = 20
const PARAGRAPHS = 60
const RESTORE_COUNT = 50
const SIDEPANEL_TOTAL = 5000
const SIDEPANEL_ON_PAGE = 50
/** Page the side panel case pretends is the active tab (never loaded). */
const SIDEPANEL_PAGE_URL = 'http://127.0.0.1/perf-panel/current.html'
// Same context length as src/content/SelectionManager.ts getSelectionContext.
const CONTEXT_LENGTH = 64
// Long tasks that end shortly after the last mark is rendered still belong to the restore.
const LONGTASK_TAIL_MS = 500

/** In-page timing state. Kept off `window.__noteit*`, which is reserved for the extension. */
interface Probe {
  mouseUp?: number
  colorDown?: number
  menuShown?: number
  markShown?: number
  listShown?: number
  /** Long tasks as [startTime, duration]; restore cases only count the ones that end after restoreStart. */
  longTasks: Array<[number, number]>
  restoreStart?: number
  removedMarks: number
}
type ProbeWindow = Window & { __perfProbe: Probe }

/** Init script: records long tasks and the time the side panel list reaches `expectedItems` entries. */
function installProbeInPage(expectedItems: number): void {
  const w = window as unknown as ProbeWindow
  w.__perfProbe = { longTasks: [], removedMarks: 0 }
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) w.__perfProbe.longTasks.push([entry.startTime, entry.duration])
  }).observe({ type: 'longtask', buffered: true })
  if (expectedItems > 0) {
    const observer = new MutationObserver(() => {
      if (document.querySelectorAll('li').length >= expectedItems) {
        w.__perfProbe.listShown = performance.now()
        observer.disconnect()
      }
    })
    // Init scripts can run before documentElement exists (extension pages), so observe the document node.
    observer.observe(document, { childList: true, subtree: true })
  }
}

/** Records mouseup / color mousedown (capture phase, before the extension's handlers) and when the menu and mark appear. */
function watchInteractionInPage(): void {
  const probe = (window as unknown as ProbeWindow).__perfProbe
  // Only the selection's mouseup counts; the later color click produces its own mouseup.
  window.addEventListener(
    'mouseup',
    () => {
      if (probe.menuShown === undefined) probe.mouseUp = performance.now()
    },
    true,
  )
  window.addEventListener(
    'mousedown',
    () => {
      if (probe.menuShown !== undefined && probe.colorDown === undefined) probe.colorDown = performance.now()
    },
    true,
  )
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (!(node instanceof HTMLElement)) continue
        if (probe.markShown === undefined && node.classList.contains('noteit-highlight')) probe.markShown = performance.now()
      }
    }
  }).observe(document.body, { childList: true, subtree: true })
  // Story 3.13: the selection menu renders inside the <noteit-root> shadow root, outside <body>.
  const shadow = document.querySelector('noteit-root')?.shadowRoot
  if (!shadow) throw new Error('noteit-root shadow root missing')
  new MutationObserver((mutations) => {
    if (probe.menuShown !== undefined) return
    for (const m of mutations) {
      for (const node of Array.from(m.addedNodes)) {
        if (!(node instanceof Element)) continue
        if (node.matches('[data-noteit-menu]') || node.querySelector('[data-noteit-menu]')) probe.menuShown = performance.now()
      }
    }
  }).observe(shadow, { childList: true, subtree: true })
}

/** Counts marks that left the page (directly or inside a removed node), proving a re-restore happened. */
function watchRemovedMarksInPage(): void {
  const probe = (window as unknown as ProbeWindow).__perfProbe
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of Array.from(m.removedNodes)) {
        if (!(node instanceof HTMLElement)) continue
        if (node.classList.contains('noteit-highlight')) probe.removedMarks++
        probe.removedMarks += node.querySelectorAll('.noteit-highlight').length
      }
    }
  }).observe(document.body, { childList: true, subtree: true })
}

/**
 * Longest long task that ends after the restore started (0 when none). The online restore starts when
 * the content script runs (run_at document_end, so domInteractive); the offline case stamps the time
 * right before it triggers the re-restore. Tasks before that (page parsing, the load-time restore in
 * the offline case) are not part of the measured restore.
 */
function longestRestoreTaskInPage(): number {
  const probe = (window as unknown as ProbeWindow).__perfProbe
  const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  const start = probe.restoreStart ?? nav?.domInteractive ?? 0
  return Math.max(0, ...probe.longTasks.filter(([s, d]) => s + d > start).map(([, d]) => d))
}

/**
 * Makes the panel's chrome.tabs.query({ active, currentWindow }) report `url` for its own tab, so the
 * current page view reads an http page while the panel document is the active tab. That tab has no
 * content script, so the panel's page/ping (supported-page check) is answered here as well.
 */
function stubActiveTabInPage(url: string): void {
  const tabs = chrome.tabs as unknown as {
    query: (q: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>
    sendMessage: (tabId: number, message: unknown) => Promise<unknown>
  }
  const query = tabs.query.bind(chrome.tabs)
  tabs.query = async (q) => {
    const result = await query(q)
    if (!q.active || !q.currentWindow) return result
    return result.map((t) => ({ ...t, url, title: 'NoteIt perf panel', status: 'complete' }))
  }
  const sendMessage = tabs.sendMessage.bind(chrome.tabs)
  tabs.sendMessage = async (tabId, message) => {
    if ((message as { type?: unknown } | null)?.type === 'page/ping') return { ok: true, data: { supported: true } }
    return sendMessage(tabId, message)
  }
}

function readProbe(page: Page): Promise<Probe> {
  return page.evaluate(() => (window as unknown as ProbeWindow).__perfProbe)
}

function distinctMarks(page: Page): Promise<number> {
  return page.evaluate(
    () => new Set(Array.from(document.querySelectorAll<HTMLElement>('[data-noteit-id]')).map((el) => el.dataset.noteitId)).size,
  )
}

async function storedCount(serviceWorker: Worker): Promise<number> {
  return (await liveRecords(serviceWorker)).length
}

async function waitForContentScript(page: Page): Promise<void> {
  // The host gets data-noteit-site="on" once the content script has enabled itself for the site.
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
}

/** NFR1 + NFR2: drag-select a paragraph, wait for the menu, click the first color, wait for the mark. */
async function measureSelectionAndColor(
  context: BrowserContext,
  serviceWorker: Worker,
  ext: Page,
  url: string,
  mode: PerfMode,
): Promise<{ menu: number[]; color: number[] }> {
  const menu: number[] = []
  const color: number[] = []
  const page = await context.newPage()
  await page.addInitScript(installProbeInPage, 0)
  for (let i = 0; i < ITERATIONS; i++) {
    await resetLocalData(serviceWorker, { keepSession: true })
    await enableSite(ext, new URL(url).hostname)
    await page.goto(url)
    await waitForContentScript(page)
    if (mode === 'offline') await context.setOffline(true)
    await page.evaluate(watchInteractionInPage)

    const target = page.locator(`#p${i % PARAGRAPHS}`)
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    if (!box) throw new Error('target paragraph has no layout box')
    const y = box.y + 8
    await page.mouse.move(box.x + 1, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2, y, { steps: 5 })
    await page.mouse.up()

    await clickMenuButton(page, 0)
    await expect(page.locator('.noteit-highlight').first()).toBeVisible()
    // Let the save finish so it cannot leak into the next iteration.
    await expect.poll(() => storedCount(serviceWorker)).toBe(1)

    const probe = await readProbe(page)
    if (probe.mouseUp === undefined || probe.menuShown === undefined || probe.colorDown === undefined || probe.markShown === undefined) {
      throw new Error(`incomplete interaction timings: ${JSON.stringify(probe)}`)
    }
    const menuMs = probe.menuShown - probe.mouseUp
    const colorMs = probe.markShown - probe.colorDown
    if (menuMs < 0 || colorMs < 0) throw new Error(`negative interaction timing: ${JSON.stringify(probe)}`)
    menu.push(menuMs)
    color.push(colorMs)
    if (mode === 'offline') await context.setOffline(false)
  }
  await page.close()
  return { menu, color }
}

/** NFR3: open the side panel document with 5,000 stored records, 50 of them on the current page. */
async function measureSidepanel(
  context: BrowserContext,
  serviceWorker: Worker,
  ext: Page,
  panelUrl: string,
  mode: PerfMode,
): Promise<number[]> {
  // The panel is opened as a tab (chrome.sidePanel.open needs a user gesture), so the active tab the
  // panel reads as "current page" would be the panel itself, an unsupported page since Story 3.6. An
  // init script makes the panel's active-tab query report an http page instead; the 50 on-page records
  // carry that page's canonicalUrl, and having highlights turns its site on (D8). Seeds go straight
  // into Dexie (Story 2.8: the panel reads the local database only).
  const pageUrl = canonicalUrl(SIDEPANEL_PAGE_URL)!
  const pageSite = siteKey(SIDEPANEL_PAGE_URL)!
  const highlights: HighlightRecord[] = Array.from({ length: SIDEPANEL_TOTAL }, (_, i) => {
    const onPage = i < SIDEPANEL_ON_PAGE
    const site = '127.0.0.1'
    const url = onPage ? pageUrl : `http://${site}/site-${i % 200}/page-${i % 1000}.html`
    const createdAt = 1_760_000_000_000 + i * 60_000
    return {
      id: `00000000-0000-4000-8000-${i.toString().padStart(12, '0')}`,
      userId: '',
      canonicalUrl: url,
      siteKey: onPage ? pageSite : site,
      url,
      text: `Stored highlight number ${i} with enough text to look like a real excerpt from an article.`,
      color: 'yellow',
      comment: null,
      anchor: {
        start: i * 10,
        end: i * 10 + 40,
        exact: 'x'.repeat(40),
        prefix: 'prefix text before the highlight',
        suffix: 'suffix text after the highlight',
      },
      pageTitle: onPage ? 'NoteIt perf panel' : `Site ${i % 200}`,
      favicon: null,
      createdAt,
      editedAt: createdAt,
      deviceId: 'perf-device',
      deletedAt: null,
      schemaVersion: 1,
    }
  })
  await resetLocalData(serviceWorker, { keepSession: true })
  await ensureLocalDb(ext)
  await putRecords(serviceWorker, highlights)
  // The list is behind the login gate (Story 2.14); sign in online before any offline run.
  if (!(await signInFromPage(ext))) throw new Error('could not sign in to the local Supabase stack')

  const samples: number[] = []
  const page = await context.newPage()
  await page.addInitScript(installProbeInPage, SIDEPANEL_ON_PAGE)
  await page.addInitScript(stubActiveTabInPage, SIDEPANEL_PAGE_URL)
  if (mode === 'offline') await context.setOffline(true)
  try {
    for (let i = 0; i < ITERATIONS; i++) {
      await page.goto(panelUrl)
      await page.waitForFunction(() => (window as unknown as ProbeWindow).__perfProbe.listShown !== undefined, undefined, {
        timeout: 10_000,
      })
      await expect(page.locator('li')).toHaveCount(SIDEPANEL_ON_PAGE)
      const probe = await readProbe(page)
      // performance.now() is relative to navigation start, so listShown is open -> list visible.
      samples.push(probe.listShown ?? Number.NaN)
    }
  } finally {
    if (mode === 'offline') await context.setOffline(false)
  }
  await page.close()
  return samples
}

/** Seeds for the 50 restore targets, computed the way the content script stores a selection. */
async function restoreSeeds(context: BrowserContext, serviceWorker: Worker, url: string): Promise<Seed[]> {
  await resetLocalData(serviceWorker, { keepSession: true })
  const highlights: ExpectedHighlight[] = Array.from({ length: RESTORE_COUNT }, (_, i) => ({
    id: `restore-${i}`,
    text: `the marker sentence number ${i} for restore`,
    scope: `#p${i}`,
  }))
  const page = await context.newPage()
  await page.goto(url)
  const seeds = await page.evaluate(computeSeedsInPage, { highlights, contextLength: CONTEXT_LENGTH })
  await page.close()
  if (typeof seeds === 'string') throw new Error(seeds)
  return seeds
}

/** NFR4: longest main-thread task while 50 highlights are restored (0 when no task exceeded 50 ms). */
async function measureRestore(
  context: BrowserContext,
  serviceWorker: Worker,
  ext: Page,
  url: string,
  seeds: Seed[],
  mode: PerfMode,
): Promise<number[]> {
  await resetLocalData(serviceWorker, { keepSession: true })
  await seedHighlights(
    ext,
    seeds.map((s) => seedToCreateReq(s, url, 'NoteIt perf article')),
  )

  const samples: number[] = []
  for (let i = 0; i < ITERATIONS; i++) {
    const page = await context.newPage()
    await page.addInitScript(installProbeInPage, 0)
    await page.goto(url)
    await expect.poll(() => distinctMarks(page)).toBe(RESTORE_COUNT)
    if (mode === 'offline') {
      // Let the load-time restore finish, then force a full re-restore while offline.
      await page.waitForTimeout(LONGTASK_TAIL_MS)
      await context.setOffline(true)
      await page.evaluate(watchRemovedMarksInPage)
      // The page re-renders every paragraph (fresh nodes without marks, like a framework re-render):
      // every highlight's Range is gone, so the observer re-resolves and repaints all of them.
      await page.evaluate(() => {
        ;(window as unknown as ProbeWindow).__perfProbe.restoreStart = performance.now()
        for (const p of Array.from(document.querySelectorAll('body > p'))) {
          const fresh = document.createElement('p')
          fresh.id = p.id
          fresh.textContent = p.textContent
          p.replaceWith(fresh)
        }
      })
      await expect.poll(async () => (await readProbe(page)).removedMarks).toBeGreaterThan(0)
      await expect.poll(() => distinctMarks(page)).toBe(RESTORE_COUNT)
    }
    await page.waitForTimeout(LONGTASK_TAIL_MS)
    samples.push(await page.evaluate(longestRestoreTaskInPage))
    if (mode === 'offline') await context.setOffline(false)
    await page.close()
  }
  return samples
}

test('performance budgets do not regress', async ({ context, serviceWorker, extensionId, externalRequests }) => {
  test.setTimeout(15 * 60_000)
  const server: StaticServer = await startStaticServer(PAGES_DIR)
  const articleUrl = `${server.origin}/article.html`
  const panelUrl = `chrome-extension://${extensionId}/src/entries/sidepanel/index.html`
  const results: MetricResult[] = []
  // Story 2.15 login gate: sign in once; every reset below keeps the session.
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  try {
    for (const mode of PERF_MODES) {
      const { menu, color } = await measureSelectionAndColor(context, serviceWorker, ext, articleUrl, mode)
      results.push(summarizeMetric('selectionToMenu', mode, menu))
      results.push(summarizeMetric('colorToHighlight', mode, color))
    }
    for (const mode of PERF_MODES) {
      results.push(summarizeMetric('sidepanelList', mode, await measureSidepanel(context, serviceWorker, ext, panelUrl, mode)))
    }
    const seeds = await restoreSeeds(context, serviceWorker, articleUrl)
    for (const mode of PERF_MODES) {
      results.push(summarizeMetric('restoreLongTask', mode, await measureRestore(context, serviceWorker, ext, articleUrl, seeds, mode)))
    }
  } finally {
    await server.close()
  }

  const order = (r: MetricResult) => PERF_METRICS.indexOf(r.metric) * PERF_MODES.length + PERF_MODES.indexOf(r.mode)
  results.sort((a, b) => order(a) - order(b))
  const report = buildPerfReport(ENGINE, ITERATIONS, results)
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(formatPerfReport(report))

  // Perf pages are local and must never reach the network.
  expect(externalRequests).toEqual([])

  const overBudget = compareToBudgets(report)
  if (process.env.PERF_ABSOLUTE === '1') {
    expect(overBudget).toEqual([])
    return
  }
  // Pre-existing budget misses are reported, not gated (M0); regressions against the baseline are gated.
  if (overBudget.length > 0) console.log(`over absolute budget (not gated without --absolute):\n  ${overBudget.join('\n  ')}`)

  if (process.env.PERF_UPDATE_BASELINE === '1') {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(toPerfBaseline(report), null, 2)}\n`)
    console.log(`wrote ${BASELINE_PATH}`)
    return
  }
  if (!existsSync(BASELINE_PATH)) {
    throw new Error('tests/perf/baseline.json is missing; run "npm run baseline:update" to create it')
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as PerfBaseline
  expect(compareToPerfBaseline(report, baseline)).toEqual([])
})
