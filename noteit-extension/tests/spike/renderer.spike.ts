// Renderer spike measurements (Story 4.6): measures S1-S7 for the engine dist/ was built with
// (SPIKE_ENGINE = VITE_RENDERER, default mark) and writes spike-results/<engine>.json. Every reading is
// renderer-agnostic: painted highlights are read from <mark data-noteit-id> elements (mark) or from
// CSS.highlights (highlight-api; the registry belongs to the document, so the main world sees the
// content script's ranges). Run through scripts/run-spike.ts, which builds both engines and merges
// the runs into tests/spike/spike-report.json.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import type { BrowserContext, Page, Worker } from '@playwright/test'
import { test, expect, signIn, PAGES_DIR } from '../e2e/fixtures/extension.ts'
import { startStaticServer, type StaticServer } from '../helpers/static-server.ts'
import { enableSite, liveRecords, openExtensionPage, resetLocalData, seedHighlights, seedToCreateReq } from '../helpers/local-db.ts'
import { POPOVER, PREVIEW, clickMenuButton, dragSelect, menuButton } from '../e2e/fixtures/page-actions.ts'
import {
  buildReport,
  computeSeedsInPage,
  loadSnapshots,
  summarizeSnapshot,
  type ExpectedHighlight,
  type HighlightResult,
  type SnapshotResult,
} from '../corpus/runner.ts'
import { SPIKE_ENGINES, SPIKE_RESULTS_DIR, p95, type SpikeEngine, type SpikeRun } from './spike.ts'

const ROOT = resolve(import.meta.dirname, '../..')
const SPIKE_PAGES = join(import.meta.dirname, 'pages')
const CORPUS_DIR = join(ROOT, 'tests/corpus')
const PERF_PAGES = join(ROOT, 'tests/perf/pages')

const ENGINE: SpikeEngine = (SPIKE_ENGINES as readonly string[]).includes(process.env.SPIKE_ENGINE ?? '')
  ? (process.env.SPIKE_ENGINE as SpikeEngine)
  : 'mark'
const SITE = '127.0.0.1'
// Same context length and settle rules as tests/corpus/anchoring.corpus.ts.
const CONTEXT_LENGTH = 64
const MIN_SETTLE_MS = 3000
const STABLE_FOR_MS = 1500
const MAX_SETTLE_MS = 15_000
const POLL_MS = 250
const RESTORE_COUNT = 50
const RESTORE_RUNS = 5
const COLOR_RUNS = 10
const HOVER_WAIT_MS = 400
const LONGTASK_TAIL_MS = 500

interface PaintedGroup {
  range: Range
  text: string
}
/** Main-world probe (installed by an init script; kept off window.__noteit*, which the extension owns). */
interface SpikeProbe {
  engine(): string | null
  groups(): PaintedGroup[]
  painted(): string[]
  classify(highlights: ExpectedHighlight[]): HighlightResult[]
  pointOf(selector: string, text: string, char: number): { x: number; y: number } | null
  flashing(): boolean
  longTasks: Array<[number, number]>
  t0?: number
  t1?: number
  flashStart?: number
  flashEnd?: number
}
type SpikeWindow = Window & { __spike: SpikeProbe }

function installProbeInPage(): void {
  const EXCLUDE = 'script,style,noscript,template,textarea,noteit-root'
  const w = window as unknown as SpikeWindow
  /** Indexed text of a Range (same exclusions as the TextIndex; never Range.toString()). */
  const textOf = (range: Range): string => {
    let out = ''
    const root = range.commonAncestorContainer
    if (root.nodeType === Node.TEXT_NODE) {
      const p = root.parentElement
      return p && p.closest(EXCLUDE) ? '' : (root as Text).data.slice(range.startOffset, range.endOffset)
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      if (!range.intersectsNode(n) || n.parentElement?.closest(EXCLUDE)) continue
      const s = n === range.startContainer ? range.startOffset : 0
      const e = n === range.endContainer ? range.endOffset : n.data.length
      out += n.data.slice(s, e)
    }
    return out
  }
  const engine = () => document.querySelector('noteit-root')?.getAttribute('data-noteit-renderer') ?? null
  const groups = (): PaintedGroup[] => {
    const out: PaintedGroup[] = []
    if (engine() === 'highlight-api') {
      CSS.highlights.forEach((highlight, name) => {
        if (!name.startsWith('noteit-') || name === 'noteit-flash') return
        highlight.forEach((r) => {
          const range = r as Range
          if (range.collapsed) return
          const text = textOf(range)
          if (text) out.push({ range, text })
        })
      })
      return out
    }
    const byId = new Map<string, Element[]>()
    for (const el of Array.from(document.querySelectorAll('mark[data-noteit-id]'))) {
      const id = el.getAttribute('data-noteit-id')!
      byId.set(id, [...(byId.get(id) ?? []), el])
    }
    for (const els of byId.values()) {
      const range = document.createRange()
      range.setStartBefore(els[0])
      range.setEndAfter(els[els.length - 1])
      out.push({ range, text: els.map((e) => e.textContent ?? '').join('') })
    }
    return out
  }
  const classify = (highlights: ExpectedHighlight[]): HighlightResult[] => {
    const all = groups()
    const used = new Set<PaintedGroup>()
    return highlights.map((h): HighlightResult => {
      if (h.sourceGone) return { id: h.id, outcome: 'source-gone' }
      const scope = document.querySelector(h.scope)
      if (!scope) return { id: h.id, outcome: 'wrong', detail: 'scope not found' }
      const whole = document.createRange()
      whole.selectNodeContents(scope)
      const full = textOf(whole)
      let expected = -1
      for (let i = 0; i <= (h.occurrence ?? 0); i++) {
        expected = full.indexOf(h.text, expected + 1)
        if (expected === -1) return { id: h.id, outcome: 'wrong', detail: 'expected occurrence not on the page' }
      }
      const hit = all.find((g) => {
        if (used.has(g) || g.text !== h.text) return false
        if (!scope.contains(g.range.startContainer) || !scope.contains(g.range.endContainer)) return false
        const before = document.createRange()
        before.setStart(scope, 0)
        before.setEnd(g.range.startContainer, g.range.startOffset)
        return textOf(before).length === expected
      })
      if (!hit) return { id: h.id, outcome: 'missing' }
      used.add(hit)
      return { id: h.id, outcome: 'correct' }
    })
  }
  const pointOf = (selector: string, text: string, char: number) => {
    const scope = document.querySelector(selector)
    if (!scope) return null
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
    const nodes: Text[] = []
    let full = ''
    for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
      nodes.push(n)
      full += n.data
    }
    let at = full.indexOf(text)
    if (at === -1) return null
    at += char
    for (const n of nodes) {
      if (at < n.data.length) {
        const r = document.createRange()
        r.setStart(n, at)
        r.setEnd(n, at + 1)
        const b = r.getBoundingClientRect()
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
      }
      at -= n.data.length
    }
    return null
  }
  const flashing = () =>
    engine() === 'highlight-api'
      ? (CSS.highlights.get('noteit-flash')?.size ?? 0) > 0
      : document.querySelector('mark.noteit-flash') !== null
  w.__spike = { engine, groups, painted: () => groups().map((g) => g.text), classify, pointOf, flashing, longTasks: [] }
  if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__spike.longTasks.push([e.startTime, e.duration])
    }).observe({ type: 'longtask', buffered: true })
  }
}

const probe = <T>(page: Page, fn: (p: SpikeProbe) => T) =>
  page.evaluate((source) => {
    const p = (window as unknown as SpikeWindow).__spike
    return new Function('p', `return (${source})(p)`)(p) as T
  }, fn.toString())

const paintedCount = (page: Page) => probe(page, (p) => p.groups().length)

async function waitForSite(page: Page): Promise<void> {
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
}

async function settle(page: Page): Promise<void> {
  const started = Date.now()
  let last = JSON.stringify(await probe(page, (p) => p.painted()))
  let stableSince = Date.now()
  while (Date.now() - started < MAX_SETTLE_MS) {
    await page.waitForTimeout(POLL_MS)
    const current = JSON.stringify(await probe(page, (p) => p.painted()))
    if (current !== last) {
      last = current
      stableSince = Date.now()
    } else if (Date.now() - started >= MIN_SETTLE_MS && Date.now() - stableSince >= STABLE_FOR_MS) {
      return
    }
  }
}

/** Seeds (computed on the untouched page) and stores the expected highlights of `url`. */
async function seedPage(
  context: BrowserContext,
  ext: Page,
  url: string,
  highlights: ExpectedHighlight[],
  patch: (h: ExpectedHighlight) => { comment?: string | null; color?: 'yellow' | 'orange' | 'blue' | 'green' } = () => ({}),
): Promise<void> {
  const page = await context.newPage()
  await page.goto(url)
  const seeds = await page.evaluate(computeSeedsInPage, { highlights, contextLength: CONTEXT_LENGTH })
  const title = await page.title()
  await page.close()
  if (typeof seeds === 'string') throw new Error(seeds)
  await seedHighlights(
    ext,
    seeds.map((s, i) => ({ ...seedToCreateReq(s, url, title), ...patch(highlights[i]) })),
  )
}

/** Sends a page request to the content script of the tab showing `url` (through the service worker). */
function pageRequest(serviceWorker: Worker, url: string, type: string, req: unknown): Promise<unknown> {
  return serviceWorker.evaluate(
    async ({ url, type, req }) => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url === url)
      if (tab?.id === undefined) throw new Error(`no tab for ${url}`)
      return chrome.tabs.sendMessage(tab.id, { kind: 'noteit/request', type, req })
    },
    { url, type, req },
  )
}

// --- S1 -----------------------------------------------------------------------------------------

async function measureCorpus(context: BrowserContext, ext: Page, serviceWorker: Worker): Promise<SpikeRun['corpus']> {
  const server = await startStaticServer(CORPUS_DIR)
  const results: SnapshotResult[] = []
  try {
    for (const snapshot of loadSnapshots(CORPUS_DIR)) {
      await resetLocalData(serviceWorker, { keepSession: true })
      const url = `${server.origin}/${snapshot.name}/page.html`
      const seedTab = await context.newPage()
      await seedTab.goto(url)
      await seedTab.waitForTimeout(MIN_SETTLE_MS)
      const seeds = await seedTab.evaluate(computeSeedsInPage, { highlights: snapshot.expected.highlights, contextLength: CONTEXT_LENGTH })
      const title = await seedTab.title()
      await seedTab.close()
      if (typeof seeds === 'string') throw new Error(`${snapshot.name}: ${seeds}`)
      await seedHighlights(
        ext,
        seeds.map((s) => seedToCreateReq(s, url, title)),
      )
      const page = await context.newPage()
      await page.goto(url)
      await settle(page)
      const outcomes = await page.evaluate(
        (hs) => (window as unknown as SpikeWindow).__spike.classify(hs),
        snapshot.expected.highlights,
      )
      await page.close()
      results.push(summarizeSnapshot(snapshot, outcomes))
    }
  } finally {
    await server.close()
  }
  const report = buildReport(`spike-${ENGINE}`, results)
  const perCategory = Object.fromEntries(
    Object.entries(report.categories).map(([k, v]) => [k, { eligible: v!.eligible, correct: v!.correct }]),
  )
  return { eligible: report.overall.eligible, correct: report.overall.correct, rate: report.overall.rate, perCategory }
}

// --- S2 / S3 / S4 / S7 (spike page) ---------------------------------------------------------------

const HIT_HIGHLIGHTS: ExpectedHighlight[] = [
  { id: 'adjA', text: 'first word', scope: '#adjacent' },
  { id: 'adjB', text: 'second word', scope: '#adjacent' },
  { id: 'ovA', text: 'alpha beta gamma', scope: '#overlap' },
  { id: 'ovB', text: 'gamma delta epsilon', scope: '#overlap' },
  { id: 'cross', text: 'head bold middle and italic', scope: '#cross' },
  { id: 'plain', text: 'sample text', scope: '#plain' },
  { id: 'commented', text: 'sample text', scope: '#commented' },
]
const commentOf = (id: string) => (id === 'plain' ? null : `comment-${id}`)

/** [selector, text, char, accepted ids] hit checks; an empty list means "no highlight here". */
const HIT_CHECKS: Array<[string, string, number, string[]]> = [
  ['#adjacent', 'first word', 0, ['adjA']],
  ['#adjacent', 'first word', 9, ['adjA']],
  ['#adjacent', 'second word', 0, ['adjB']],
  ['#adjacent', 'second word', 10, ['adjB']],
  ['#adjacent', 'Lead', 1, []],
  ['#overlap', 'alpha', 1, ['ovA']],
  ['#overlap', 'gamma', 2, ['ovA', 'ovB']],
  ['#overlap', 'epsilon', 3, ['ovB']],
  ['#overlap', 'Start', 1, []],
  ['#cross', 'head', 1, ['cross']],
  ['#cross', 'bold middle', 3, ['cross']],
  ['#cross', 'italic', 2, ['cross']],
  ['#cross', 'tail', 1, []],
]

async function moveTo(page: Page, selector: string, text: string, char: number): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(({ s, t, c }) => (window as unknown as SpikeWindow).__spike.pointOf(s, t, c), {
    s: selector,
    t: text,
    c: char,
  })
  if (!point) throw new Error(`no point for ${selector} ${text}[${char}]`)
  return point
}

const neutral = (page: Page) => moveTo(page, '#title', 'Renderer', 2)

async function measureHitTest(page: Page): Promise<SpikeRun['hitTest']> {
  const failures: string[] = []
  const preview = page.locator(PREVIEW)
  const popover = page.locator(POPOVER)
  for (const [selector, text, char, accepted] of HIT_CHECKS) {
    const label = `${selector} "${text}"[${char}]`
    const away = await neutral(page)
    await page.mouse.move(away.x, away.y)
    await expect(preview).toHaveCount(0)
    const at = await moveTo(page, selector, text, char)
    // Hover: the comment preview names the highlight (every S2 highlight has its own comment).
    await page.mouse.move(at.x, at.y, { steps: 3 })
    await page.waitForTimeout(HOVER_WAIT_MS)
    const shown = (await preview.count()) > 0 ? ((await preview.textContent()) ?? '') : null
    const hoverOk = accepted.length === 0 ? shown === null : accepted.some((id) => shown?.includes(commentOf(id)!))
    if (!hoverOk) failures.push(`hover ${label}: got ${JSON.stringify(shown)}`)
    // Click: the popover editor holds the clicked highlight's comment.
    await page.mouse.click(at.x, at.y)
    await page.waitForTimeout(HOVER_WAIT_MS)
    const value = (await popover.count()) > 0 ? await popover.locator('textarea').inputValue() : null
    const clickOk = accepted.length === 0 ? value === null : accepted.some((id) => value === commentOf(id))
    if (!clickOk) failures.push(`click ${label}: got ${JSON.stringify(value)}`)
    await page.mouse.click(away.x, away.y)
    await expect(popover).toHaveCount(0)
  }
  const checks = HIT_CHECKS.length * 2
  return { checks, correct: checks - failures.length, failures }
}

async function measureUnderline(page: Page): Promise<SpikeRun['underline']> {
  const away = await neutral(page)
  await page.mouse.move(away.x, away.y)
  await page.waitForTimeout(HOVER_WAIT_MS)
  mkdirSync(SPIKE_RESULTS_DIR, { recursive: true })
  const plainPath = join(SPIKE_RESULTS_DIR, `${ENGINE}-plain.png`)
  const commentedPath = join(SPIKE_RESULTS_DIR, `${ENGINE}-commented.png`)
  const plain = await page.locator('#plain').screenshot({ path: plainPath })
  const commented = await page.locator('#commented').screenshot({ path: commentedPath })
  return { differs: !plain.equals(commented), screenshots: [plainPath, commentedPath].map((p) => relative(ROOT, p)) }
}

async function measureFlash(page: Page, serviceWorker: Worker, url: string, id: string): Promise<SpikeRun['flash']> {
  await probe(page, (p) => {
    p.flashStart = undefined
    p.flashEnd = undefined
    const tick = () => {
      const on = p.flashing()
      if (on && p.flashStart === undefined) p.flashStart = performance.now()
      if (!on && p.flashStart !== undefined) {
        p.flashEnd = performance.now()
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const result = (await pageRequest(serviceWorker, url, 'page/flash', { id })) as { ok: boolean; data?: { found: boolean } }
  if (!result.ok || !result.data?.found) return { observed: false, durationMs: null }
  await expect.poll(() => probe(page, (p) => p.flashEnd !== undefined), { timeout: 5000 }).toBe(true)
  const [start, end] = await probe(page, (p) => [p.flashStart!, p.flashEnd!])
  return { observed: true, durationMs: Math.round(end - start) }
}

const LAYOUT_SELECTORS = ['#title', '#adjacent', '#overlap', '#cross', '#bold', '#italic', '#plain', '#commented', '#free']

function rects(page: Page): Promise<number[][]> {
  return page.evaluate(
    (sels) =>
      sels.map((s) => {
        const r = document.querySelector(s)!.getBoundingClientRect()
        return [r.left, r.top, r.width, r.height]
      }),
    LAYOUT_SELECTORS,
  )
}

// --- S5 -----------------------------------------------------------------------------------------

const X_HOME = 'https://x.com/home'
const X_POST = 'Marginal notes are conversations with the dead, and sometimes they answer.'

async function measureVirtualList(context: BrowserContext, ext: Page, serviceWorker: Worker): Promise<SpikeRun['virtualList']> {
  const body = readFileSync(join(PAGES_DIR, 'timeline.html'), 'utf8').replaceAll('TARGET_POST', X_POST)
  await context.route('https://x.com/**', async (route) => {
    if (new URL(route.request().url()).pathname !== '/home') return route.fulfill({ status: 404, body: '' })
    return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
  })
  await resetLocalData(serviceWorker, { keepSession: true })
  await enableSite(ext, 'x.com')
  const page = await context.newPage()
  await page.goto(X_HOME)
  await waitForSite(page)
  await dragSelect(page, page.locator('.row[data-index="3"] p'))
  await clickMenuButton(page, 0)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
  await expect.poll(() => probe(page, (p) => p.painted())).toContain(X_POST)

  const waitPainted = () =>
    page.evaluate(
      (post) =>
        new Promise<number | null>((done) => {
          const start = performance.now()
          const tick = () => {
            if ((window as unknown as SpikeWindow).__spike.painted().includes(post)) return done(performance.now() - start)
            if (performance.now() - start > 3000) return done(null)
            requestAnimationFrame(tick)
          }
          tick()
        }),
      X_POST,
    )
  const times: Array<number | null> = []
  // Fresh nodes: scrolled out (removed) and back in (rebuilt).
  for (let round = 0; round < 3; round++) {
    await page.locator('#feed').evaluate((el) => (el.scrollTop = 2400))
    await expect(page.locator('.row[data-index="3"]')).toHaveCount(0)
    await page.waitForTimeout(400)
    await page.locator('#feed').evaluate((el) => (el.scrollTop = 0))
    times.push(await waitPainted())
  }
  // The same node detached and inserted again.
  await page.evaluate(() => {
    const row = document.querySelector('.row[data-index="3"]')!
    const parent = row.parentNode!
    const next = row.nextSibling
    row.remove()
    setTimeout(() => parent.insertBefore(row, next), 500)
  })
  await page.waitForTimeout(550)
  times.push(await waitPainted())
  const painted = await probe(page, (p) => p.painted())
  await page.close()
  await context.unroute('https://x.com/**')
  return {
    rounds: times.length,
    worstReappearMs: times.some((t) => t === null) ? null : Math.round(Math.max(...(times as number[]))),
    textCorrect: painted.filter((t) => t === X_POST).length === 1,
  }
}

// --- S6 -----------------------------------------------------------------------------------------

async function measurePerf(context: BrowserContext, ext: Page, serviceWorker: Worker): Promise<SpikeRun['perf']> {
  const server = await startStaticServer(PERF_PAGES)
  const url = `${server.origin}/article.html`
  try {
    // Restore: 50 stored highlights painted on load; longest task after the content script starts.
    await resetLocalData(serviceWorker, { keepSession: true })
    const restore: ExpectedHighlight[] = Array.from({ length: RESTORE_COUNT }, (_, i) => ({
      id: `r${i}`,
      text: `the marker sentence number ${i} for restore`,
      scope: `#p${i}`,
    }))
    await seedPage(context, ext, url, restore)
    let longest = 0
    for (let i = 0; i < RESTORE_RUNS; i++) {
      const page = await context.newPage()
      await page.goto(url)
      await expect.poll(() => paintedCount(page), { timeout: 10_000 }).toBe(RESTORE_COUNT)
      await page.waitForTimeout(LONGTASK_TAIL_MS)
      const task = await probe(page, (p) => {
        const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
        const start = nav?.domInteractive ?? 0
        return Math.max(0, ...p.longTasks.filter(([s, d]) => s + d > start).map(([, d]) => d))
      })
      longest = Math.max(longest, task)
      await page.close()
    }

    // Color -> visible: mousedown on the color dot until the new highlight is painted (rAF poll).
    const samples: number[] = []
    for (let i = 0; i < COLOR_RUNS; i++) {
      await resetLocalData(serviceWorker, { keepSession: true })
      await enableSite(ext, SITE)
      const page = await context.newPage()
      await page.goto(url)
      await waitForSite(page)
      // Same gesture as tests/perf/budgets.perf.ts: half of the first line of the paragraph.
      const target = page.locator(`#p${i}`)
      await target.scrollIntoViewIfNeeded()
      const box = await target.boundingBox()
      if (!box) throw new Error('target paragraph has no layout box')
      await page.mouse.move(box.x + 1, box.y + 8)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2, box.y + 8, { steps: 5 })
      await page.mouse.up()
      await probe(page, (p) => {
        p.t0 = undefined
        p.t1 = undefined
        const base = p.groups().length
        window.addEventListener('mousedown', () => (p.t0 ??= performance.now()), { capture: true, once: true })
        const tick = () => {
          if (p.t0 !== undefined && p.groups().length > base) {
            p.t1 = performance.now()
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      })
      await menuButton(page, 0).waitFor({ state: 'visible', timeout: 10_000 }).catch(async (error: unknown) => {
        await page.screenshot({ path: join(SPIKE_RESULTS_DIR, `${ENGINE}-menu-missing.png`) })
        throw error
      })
      await clickMenuButton(page, 0)
      await expect.poll(() => probe(page, (p) => p.t1 !== undefined)).toBe(true)
      samples.push(await probe(page, (p) => p.t1! - p.t0!))
      await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
      await page.close()
    }
    return { restoreLongestTaskMs: Math.round(longest), colorToVisibleP95Ms: Math.round(p95(samples) * 10) / 10, colorSamples: samples.length }
  } finally {
    await server.close()
  }
}

// --- run ----------------------------------------------------------------------------------------

// SPIKE_PHASES=hit,virtual,perf,corpus runs a subset (debugging); the run file is only written for all.
const PHASES = (process.env.SPIKE_PHASES ?? 'hit,virtual,perf,corpus').split(',')

async function phase<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  if (!PHASES.includes(name)) return null
  const started = Date.now()
  console.log(`[spike ${ENGINE}] ${name} ...`)
  const result = await fn()
  console.log(`[spike ${ENGINE}] ${name} done in ${Math.round((Date.now() - started) / 1000)}s`)
  return result
}

test(`renderer spike S1-S7 (${ENGINE})`, async ({ context, extensionId, serviceWorker, externalRequests }) => {
  test.setTimeout(45 * 60_000)
  await context.addInitScript(installProbeInPage)
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  const spike: StaticServer = await startStaticServer(SPIKE_PAGES)
  const hitUrl = `${spike.origin}/hit.html`
  try {
    const hit = await phase('hit', async () => {
      // S7 baseline: the page without any highlight (site off, nothing stored).
      await resetLocalData(serviceWorker, { keepSession: true })
      const bare = await context.newPage()
      await bare.goto(hitUrl)
      const before = await rects(bare)
      await bare.close()

      await seedPage(context, ext, hitUrl, HIT_HIGHLIGHTS, (h) => ({ comment: commentOf(h.id) }))
      const page = await context.newPage()
      await page.goto(hitUrl)
      await waitForSite(page)
      // The build flag reached the content script.
      expect(await page.locator('noteit-root').getAttribute('data-noteit-renderer')).toBe(ENGINE)
      await expect.poll(() => paintedCount(page)).toBe(HIT_HIGHLIGHTS.length)
      const after = await rects(page)
      const layout = {
        maxShiftPx: Math.max(...before.flatMap((r, i) => r.map((v, j) => Math.abs(v - after[i][j])))),
        elements: LAYOUT_SELECTORS.length,
      }
      const hitTest = await measureHitTest(page)
      const underline = await measureUnderline(page)
      const flashId = (await liveRecords(serviceWorker)).find((r) => r.comment === 'comment-cross')!.id
      const flash = await measureFlash(page, serviceWorker, hitUrl, flashId)
      await page.close()
      return { layout, hitTest, underline, flash }
    })
    const virtualList = await phase('virtual', () => measureVirtualList(context, ext, serviceWorker))
    const perf = await phase('perf', () => measurePerf(context, ext, serviceWorker))
    const corpus = await phase('corpus', () => measureCorpus(context, ext, serviceWorker))
    console.log(JSON.stringify({ hit, virtualList, perf, corpus }, null, 2))
    expect(externalRequests).toEqual([])
    if (!hit || !virtualList || !perf || !corpus) return

    const run: SpikeRun = { engine: ENGINE, generatedAt: new Date().toISOString(), corpus, virtualList, perf, ...hit }
    mkdirSync(SPIKE_RESULTS_DIR, { recursive: true })
    writeFileSync(join(SPIKE_RESULTS_DIR, `${ENGINE}.json`), `${JSON.stringify(run, null, 2)}\n`)
  } finally {
    await spike.close()
  }
})
