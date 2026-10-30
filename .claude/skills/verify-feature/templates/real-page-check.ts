// Real-page check for the built NoteIt extension. Copy into noteit-extension/ (it imports test helpers)
// and run with Node 24 while the local Supabase stack is up:
//   node tmp-real-page-check.ts --dist dist --url <page> --site <siteKey> --text <start text> \
//     [--text-end <end text>] --out <path prefix for screenshots>
// It selects from the start of --text to the end of --text-end (default: --text) with a real mouse drag,
// clicks the first color, clicks the highlight, reloads, and prints JSON metrics plus four screenshots:
// <out>-before.png, <out>-after.png, <out>-popover.png, <out>-reload.png.
import { chromium, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { enableSite, liveRecords, openExtensionPage, resetLocalData } from './tests/helpers/local-db.ts'
import { signIn } from './tests/e2e/fixtures/extension.ts'
import { clearCloudRows, TEST_USERS } from './tests/helpers/local-supabase.ts'

const { values } = parseArgs({
  options: {
    dist: { type: 'string', default: 'dist' },
    url: { type: 'string' },
    site: { type: 'string' },
    text: { type: 'string' },
    'text-end': { type: 'string' },
    out: { type: 'string', default: '../test-reports/real' },
  },
})
if (!values.url || !values.site || !values.text) {
  console.error('usage: --url <page> --site <siteKey> --text <start text> [--text-end <end text>] [--dist dist] [--out prefix]')
  process.exit(1)
}
const startText = values.text
const endText = values['text-end'] ?? values.text
const out = resolve(values.out!)
mkdirSync(dirname(out), { recursive: true })

const PAINTED = '[data-noteit-id]:not(noteit-root *)'

/** Viewport points at the first character of `start` and the last character of `end` (visible text nodes only). */
const dragPoints = (page: Page) =>
  page.evaluate(
    ({ start, end }) => {
      const find = (needle: string) => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
          const i = n.data.indexOf(needle)
          if (i === -1) continue
          const r = document.createRange()
          r.setStart(n, i)
          r.setEnd(n, i + needle.length)
          if (r.getBoundingClientRect().width > 0) return { node: n, index: i }
        }
        throw new Error(`text not found or not visible: ${needle}`)
      }
      const s = find(start)
      const e = find(end)
      ;(s.node.parentElement ?? document.body).scrollIntoView({ block: 'center' })
      const point = (node: Text, from: number, to: number, left: boolean) => {
        const r = document.createRange()
        r.setStart(node, from)
        r.setEnd(node, to)
        const b = r.getBoundingClientRect()
        return { x: left ? b.left + 1 : b.right - 1, y: b.top + b.height / 2 }
      }
      const endAt = e.index + end.length
      return {
        start: point(s.node, s.index, s.index + 1, true),
        end: point(e.node, endAt - 1, endAt, false),
      }
    },
    { start: startText, end: endText },
  )

/** Rendered widths of the elements holding the selected text: 0 means the text is no longer drawn. */
const hostWidths = (page: Page) =>
  page.evaluate(
    ({ start, end }) =>
      [...new Set([start, end])].map((needle) => {
        const el = Array.from(document.querySelectorAll('body *')).find(
          (e) => e.textContent?.includes(needle) && Array.from(e.children).every((c) => !c.textContent?.includes(needle)),
        )
        if (!el) return null
        return el instanceof SVGGraphicsElement ? el.getBBox().width : el.getBoundingClientRect().width
      }),
    { start: startText, end: endText },
  )

const painted = (page: Page) =>
  page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel))
    return els.map((e) => {
      const s = getComputedStyle(e)
      const b = e.getBoundingClientRect()
      return { tag: e.localName, fill: e.localName === 'rect' ? s.fill : s.backgroundColor, w: Math.round(b.width), h: Math.round(b.height) }
    })
  }, PAINTED)

/** Viewport clip around the selection, for screenshots. */
async function clipAround(page: Page) {
  const p = await dragPoints(page)
  const vw = page.viewportSize()!.width
  const top = Math.max(0, Math.min(p.start.y, p.end.y) - 150)
  return { x: 0, y: top, width: vw, height: Math.min(400, Math.max(p.start.y, p.end.y) - top + 150) }
}

clearCloudRows(TEST_USERS.a.email)
const dir = mkdtempSync(join(tmpdir(), 'noteit-real-'))
const context = await chromium.launchPersistentContext(dir, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${resolve(values.dist!)}`, `--load-extension=${resolve(values.dist!)}`],
})
try {
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
  const extensionId = new URL(sw.url()).host
  await resetLocalData(sw)
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, values.site)
  await ext.close()

  const page = await context.newPage()
  await page.goto(values.url, { waitUntil: 'networkidle' })
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })

  const widthsBefore = await hostWidths(page)
  const clip = await clipAround(page)
  await page.screenshot({ path: `${out}-before.png`, clip })

  const pts = await dragPoints(page)
  await page.mouse.move(pts.start.x, pts.start.y)
  await page.mouse.down()
  await page.mouse.move(pts.end.x, pts.end.y, { steps: 15 })
  await page.mouse.up()
  const selected = await page.evaluate(() => window.getSelection()?.toString() ?? '')
  const dot = page.locator('noteit-root [data-noteit-menu] button').first()
  await dot.waitFor({ state: 'visible' })
  const db = (await dot.boundingBox())!
  await page.mouse.click(db.x + db.width / 2, db.y + db.height / 2)
  for (let i = 0; i < 50 && (await liveRecords(sw)).length === 0; i++) await page.waitForTimeout(100)
  await page.waitForTimeout(400)

  const widthsAfter = await hostWidths(page)
  const paintedAfter = await painted(page)
  await page.screenshot({ path: `${out}-after.png`, clip })

  await page.mouse.click(pts.start.x + 10, pts.start.y)
  const popover = await page
    .locator('noteit-root [data-noteit-popover]')
    .waitFor({ state: 'visible', timeout: 2000 })
    .then(() => true, () => false)
  await page.screenshot({ path: `${out}-popover.png`, clip })

  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
  await page.waitForTimeout(1500)
  const paintedReload = await painted(page)
  const widthsReload = await hostWidths(page)
  await page.screenshot({ path: `${out}-reload.png`, clip: await clipAround(page) })

  const records = await liveRecords(sw)
  console.log(
    JSON.stringify(
      {
        dist: values.dist,
        selected,
        widths: { before: widthsBefore, after: widthsAfter, reload: widthsReload },
        painted: { after: paintedAfter, reload: paintedReload.length },
        popover,
        records: records.map((r) => ({ text: r.text, color: r.color })),
      },
      null,
      1,
    ),
  )
} finally {
  await context.close()
  rmSync(dir, { recursive: true, force: true })
  clearCloudRows(TEST_USERS.a.email)
}
