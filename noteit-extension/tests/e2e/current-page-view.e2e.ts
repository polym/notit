// Story 3.5: the current page view lists the active page's highlights in article order. Each item has a
// 3px solid color bar, text clamped to two lines and its comment; the color name is exposed to screen
// readers; lost items turn muted with a 0.35 bar and the "not found" caption; item-count follows edits.
import type { Page } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { computeSeedsInPage, type ExpectedHighlight } from '../corpus/runner.ts'
import {
  anchorStatusIds,
  enableSite,
  openExtensionPage,
  resetLocalData,
  seedHighlights,
  seedToCreateReq,
} from '../helpers/local-db.ts'
import { clickMenuButton, dragSelect } from './fixtures/page-actions.ts'
import type { CreateHighlightReq } from '../../src/features/highlight/index.ts'
import { strings } from '../../src/ui/strings.ts'
import { colors } from '../../src/ui/tokens/index.ts'

const SITE = '127.0.0.1'
const TITLE = 'NoteIt smoke article'
// Same context length as src/content/SelectionManager.ts getSelectionContext.
const CONTEXT_LENGTH = 64
const GHOST = 'This sentence is not on the page yet.'
const LONG_COMMENT = 'A comment that should be shown in full below the text.'

/** CSS rgb() string of a #RRGGBB token, as getComputedStyle reports it. */
function rgb(hex: string): string {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  return `rgb(${n(1)}, ${n(3)}, ${n(5)})`
}

async function openArticle(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
}

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  // Story 2.15 login gate: highlight writes need a session.
  await signIn(context, extensionId)
})

test('current page lists items in article order with color bar, clamped text, comment and lost state', async ({
  context,
  extensionId,
  serviceWorker,
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
  // Created out of order: outro first, so article order differs from creation order.
  const [outro, intro] = seeds.map((s) => seedToCreateReq(s, url, TITLE))
  outro.color = 'blue'
  outro.comment = LONG_COMMENT
  // No anchor: sorted after positioned items, and never found on the page (lost after 3s).
  const ghost: CreateHighlightReq = {
    id: crypto.randomUUID(),
    url,
    text: `${GHOST} ${'More words to wrap over several lines in a narrow panel. '.repeat(8)}`,
    color: 'green',
    comment: 'ghost note',
    anchor: null,
    pageTitle: TITLE,
    favicon: null,
  }
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  await seedHighlights(ext, [outro, ghost, intro])
  await ext.close()

  const page = await context.newPage()
  await openArticle(page, url)
  await expect.poll(() => anchorStatusIds(serviceWorker), { timeout: 8000 }).toEqual([ghost.id])

  const panel = await openSidePanel()
  // The panel reads the active tab of its window: bring the article back to the front.
  await page.bringToFront()
  const view = panel.getByTestId('current-page-view')
  const items = view.getByTestId('highlight-item')
  await expect(items).toHaveCount(3)
  await expect(view.getByTestId('item-count')).toHaveText(strings.itemCount(3))
  await expect(view.getByTestId('page-title')).toHaveText(TITLE)
  await expect(view.getByRole('button', { name: strings.viewCurrentPage })).toHaveAttribute('aria-pressed', 'true')

  // Article order: intro (start offset lower) before outro; the unpositioned ghost last.
  await expect(items.nth(0)).toContainText('quick brown fox')
  await expect(items.nth(1)).toContainText('paragraph exists')
  await expect(items.nth(2)).toContainText(GHOST)

  // Color bar: 3px solid token color; the color name is the accessible name.
  const blueItem = items.nth(1)
  const bar = blueItem.getByRole('img', { name: strings.colorBlue })
  await expect(bar).toHaveCount(1)
  const barStyle = await bar.evaluate((el) => {
    const s = getComputedStyle(el)
    return { width: s.width, background: s.backgroundColor, opacity: s.opacity }
  })
  expect(barStyle).toEqual({ width: '3px', background: rgb(colors['highlight-blue-solid']), opacity: '1' })
  await expect(items.nth(0).getByRole('img', { name: strings.colorYellow })).toHaveCount(1)
  await expect(blueItem.getByTestId('highlight-comment')).toHaveText(LONG_COMMENT)
  await expect(items.nth(0).getByTestId('highlight-comment')).toHaveCount(0)

  // Two-line clamp on the text; the lost item keeps its full text and comment.
  const lostItem = items.nth(2)
  const clamp = await lostItem.getByTestId('highlight-text').evaluate((el) => {
    const s = getComputedStyle(el)
    return {
      clamp: s.webkitLineClamp,
      lines: Math.round(el.getBoundingClientRect().height / parseFloat(s.lineHeight)),
      full: el.textContent,
    }
  })
  expect(clamp.clamp).toBe('2')
  expect(clamp.lines).toBe(2)
  expect(clamp.full).toBe(ghost.text)

  // Lost: muted text, bar at 0.35, caption shown, comment kept.
  await expect(lostItem.getByTestId('anchor-lost')).toHaveText(strings.anchorLost)
  await expect(lostItem.getByTestId('highlight-comment')).toHaveText('ghost note')
  const lostText = await lostItem.getByTestId('highlight-text').evaluate((el) => getComputedStyle(el).color)
  expect(lostText).toBe(rgb(colors['muted-foreground']))
  const lostBar = lostItem.getByRole('img', { name: strings.colorGreen })
  expect(await lostBar.evaluate((el) => getComputedStyle(el).opacity)).toBe('0.35')
  const normalText = await items.nth(0).getByTestId('highlight-text').evaluate((el) => getComputedStyle(el).color)
  expect(normalText).toBe(rgb(colors.foreground))
  await expect(view.getByTestId('anchor-lost')).toHaveCount(1)

  expect(externalRequests).toEqual([])
})

test('item-count updates right after a highlight is added or deleted', async ({
  context,
  extensionId,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  await ext.close()

  const page = await context.newPage()
  await openArticle(page, url)
  const panel = await openSidePanel()
  await page.bringToFront()
  const view = panel.getByTestId('current-page-view')
  await expect(view.getByTestId('item-count')).toHaveText(strings.itemCount(0))
  // Story 3.6: the shortcut hint follows the platform (Ctrl+Shift+H off macOS).
  await expect(view.getByTestId('empty-current-page')).toBeVisible()

  await dragSelect(page, page.locator('#target'))
  await clickMenuButton(page, 0)
  await expect(view.getByTestId('item-count')).toHaveText(strings.itemCount(1))
  await dragSelect(page, page.locator('#intro'))
  await clickMenuButton(page, 1)
  await expect(view.getByTestId('item-count')).toHaveText(strings.itemCount(2))
  await expect(view.getByTestId('highlight-item')).toHaveCount(2)

  await view.getByTestId('highlight-item').first().getByTitle(strings.deleteHighlight).click()
  await expect(view.getByTestId('item-count')).toHaveText(strings.itemCount(1))
  await expect(view.getByTestId('highlight-item')).toHaveCount(1)

  expect(externalRequests).toEqual([])
})
