// Story 3.7: the all-sites view groups highlights by date bucket, then by page (FR21, Q52, Q66).
// Group header: chevron + favicon (globe fallback) + title + item-count; only the most recent group
// starts expanded; items in article order; whole-row toggle and ArrowLeft / ArrowRight; empty state;
// scroll position and collapse state kept across view switches; x.com timeline (/home) is one group.
// Date bucket boundaries are covered by the unit tests (src/ui/format/time.test.ts).
import { test, expect, signIn } from './fixtures/extension.ts'
import { computeSeedsInPage, type ExpectedHighlight } from '../corpus/runner.ts'
import { openExtensionPage, resetLocalData, seedHighlights, seedToCreateReq } from '../helpers/local-db.ts'
import type { CreateHighlightReq } from '../../src/features/highlight/index.ts'
import { strings } from '../../src/ui/strings.ts'
import { openAllSites, pageGroup } from './fixtures/all-sites.ts'

const TITLE = 'NoteIt smoke article'
const X_TITLE = 'Home / X'
const BROKEN_TITLE = 'Broken favicon page'
const CONTEXT_LENGTH = 64

function plain(url: string, text: string, pageTitle: string, favicon: string | null): CreateHighlightReq {
  return { id: crypto.randomUUID(), url, text, color: 'yellow', comment: null, anchor: null, pageTitle, favicon }
}

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await signIn(context, extensionId)
})

test('page groups: header parts, default expansion, article order, toggles, x.com /home', async ({
  context,
  extensionId,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const targets: ExpectedHighlight[] = [
    { id: 'outro', text: 'paragraph exists', scope: '#outro' },
    { id: 'intro', text: 'quick brown fox', scope: '#intro' },
  ]
  const probe = await context.newPage()
  await probe.goto(url)
  const seeds = await probe.evaluate(computeSeedsInPage, { highlights: targets, contextLength: CONTEXT_LENGTH })
  await probe.close()
  if (typeof seeds === 'string') throw new Error(seeds)
  // Created out of article order (outro first).
  const article = seeds.map((s) => ({ ...seedToCreateReq(s, url, TITLE), favicon: `${server.origin}/favicon.svg` }))
  // x.com timeline highlights share the /home URL (seeded only, never loaded: no network).
  const timeline = [
    plain('https://x.com/home', 'First tweet text', X_TITLE, null),
    plain('https://x.com/home?utm_source=share', 'Second tweet text', X_TITLE, null),
  ]
  // Newest page: its favicon URL is a 404, so the globe icon is shown.
  const broken = plain(`${server.origin}/broken.html`, 'Broken page text', BROKEN_TITLE, `${server.origin}/missing-icon.png`)

  const ext = await openExtensionPage(context, extensionId)
  await seedHighlights(ext, article)
  await seedHighlights(ext, timeline)
  await seedHighlights(ext, [broken])
  await ext.close()

  const panel = await openSidePanel()
  const view = await openAllSites(panel)
  await expect(view.getByTestId('view-controls').getByTestId('item-count')).toHaveText(strings.itemCount(5))
  // Everything was created now: one "today" bucket, empty buckets hidden.
  await expect(view.getByTestId('date-group-heading')).toHaveText([strings.dateToday])
  await expect(view.getByTestId('page-group-title')).toHaveText([BROKEN_TITLE, X_TITLE, TITLE])

  // Only the most recent group starts expanded.
  const brokenGroup = pageGroup(view, BROKEN_TITLE)
  const xGroup = pageGroup(view, X_TITLE)
  const articleGroup = pageGroup(view, TITLE)
  await expect(brokenGroup.getByTestId('page-group-header')).toHaveAttribute('aria-expanded', 'true')
  await expect(xGroup.getByTestId('page-group-header')).toHaveAttribute('aria-expanded', 'false')
  await expect(articleGroup.getByTestId('page-group-header')).toHaveAttribute('aria-expanded', 'false')
  await expect(view.getByTestId('highlight-item')).toHaveCount(1)

  // Header: chevron, favicon (or globe fallback), title, item-count.
  await expect(brokenGroup.getByTestId('group-chevron')).toHaveCount(1)
  await expect(brokenGroup.getByTestId('favicon-fallback')).toBeVisible()
  await expect(brokenGroup.getByTestId('item-count')).toHaveText(strings.itemCount(1))
  await expect(articleGroup.getByTestId('favicon')).toHaveAttribute('src', `${server.origin}/favicon.svg`)
  await expect.poll(() => articleGroup.getByTestId('favicon').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  await expect(articleGroup.getByTestId('item-count')).toHaveText(strings.itemCount(2))
  await expect(xGroup.getByTestId('favicon-fallback')).toBeVisible()

  // x.com timeline: both highlights in one /home group.
  await expect(view.getByTestId('page-group').filter({ hasText: X_TITLE })).toHaveCount(1)
  await expect(xGroup.getByTestId('item-count')).toHaveText(strings.itemCount(2))

  // Whole row toggles; items in article order.
  const articleHeader = articleGroup.getByTestId('page-group-header')
  await articleGroup.getByTestId('page-group-title').click()
  await expect(articleHeader).toHaveAttribute('aria-expanded', 'true')
  const items = articleGroup.getByTestId('highlight-item')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('quick brown fox')
  await expect(items.nth(1)).toContainText('paragraph exists')
  await articleGroup.getByTestId('item-count').click()
  await expect(articleHeader).toHaveAttribute('aria-expanded', 'false')
  await expect(items).toHaveCount(0)

  // Keyboard: ArrowRight expands, ArrowLeft collapses (focus on the header).
  const xHeader = xGroup.getByTestId('page-group-header')
  await xHeader.focus()
  await panel.keyboard.press('ArrowRight')
  await expect(xHeader).toHaveAttribute('aria-expanded', 'true')
  await expect(xGroup.getByTestId('highlight-item')).toHaveCount(2)
  await panel.keyboard.press('ArrowRight')
  await expect(xHeader).toHaveAttribute('aria-expanded', 'true')
  await panel.keyboard.press('ArrowLeft')
  await expect(xHeader).toHaveAttribute('aria-expanded', 'false')
  await expect(xHeader).toBeFocused()

  // Only the favicon from the local server was requested.
  expect(externalRequests).toEqual([])
})

test('empty all-sites view shows the empty state', async ({ openSidePanel, externalRequests }) => {
  const panel = await openSidePanel()
  const view = await openAllSites(panel)
  await expect(view.getByTestId('empty-all-sites')).toHaveText(strings.emptyAllSites)
  await expect(view.getByTestId('page-group')).toHaveCount(0)
  await expect(view.getByTestId('date-group-heading')).toHaveCount(0)
  expect(externalRequests).toEqual([])
})

test('switching views keeps each view scroll position and collapse state', async ({
  context,
  extensionId,
  server,
  openSidePanel,
  externalRequests,
}) => {
  // Many pages so the all-sites view scrolls; one page with many items to expand.
  const seeds: CreateHighlightReq[] = []
  for (let i = 0; i < 40; i++) seeds.push(plain(`${server.origin}/p${i}.html`, `Text ${i}`, `Page ${i}`, null))
  const ext = await openExtensionPage(context, extensionId)
  await seedHighlights(ext, seeds)
  await ext.close()

  const panel = await openSidePanel()
  await panel.setViewportSize({ width: 360, height: 400 })
  const view = await openAllSites(panel)
  await expect(view.getByTestId('page-group')).toHaveCount(40)
  // Newest (Page 39) starts expanded: collapse it, expand Page 0 at the bottom.
  await pageGroup(view, 'Page 39').getByTestId('page-group-header').click()
  const bottom = pageGroup(view, 'Page 0').getByTestId('page-group-header')
  await bottom.click()
  await expect(bottom).toHaveAttribute('aria-expanded', 'true')
  await panel.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  const scrolled = await panel.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(200)

  await panel.getByRole('button', { name: strings.viewCurrentPage }).click()
  await expect(panel.getByTestId('current-page-view')).toBeVisible()
  await expect.poll(() => panel.evaluate(() => window.scrollY)).toBe(0)

  await panel.getByRole('button', { name: strings.viewAllSites }).click()
  await expect(view).toBeVisible()
  await expect.poll(() => panel.evaluate(() => window.scrollY)).toBe(scrolled)
  await expect(bottom).toHaveAttribute('aria-expanded', 'true')
  await expect(pageGroup(view, 'Page 39').getByTestId('page-group-header')).toHaveAttribute('aria-expanded', 'false')

  expect(externalRequests).toEqual([])
})
