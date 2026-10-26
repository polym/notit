// Story 2.8: the side panel reads the local database (Dexie) directly and re-queries on db/changed;
// every write goes to the service worker by message, so concurrent edits never overwrite each other.
import type { Locator, Page } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { computeSeedsInPage, type ExpectedHighlight } from '../corpus/runner.ts'
import {
  enableSite,
  extensionRequest,
  liveRecords,
  openExtensionPage,
  resetLocalData,
  seedHighlights,
  seedToCreateReq,
} from '../helpers/local-db.ts'
import { clickMenuButton, dragSelect } from './fixtures/page-actions.ts'
import { strings } from '../../src/ui/strings.ts'
import { expandGroup, openAllSites } from './fixtures/all-sites.ts'

const SITE = '127.0.0.1'
const TITLE = 'NoteIt smoke article'
// Same context length as src/content/SelectionManager.ts getSelectionContext.
const CONTEXT_LENGTH = 64

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  // Story 2.15 login gate: highlight writes need a session.
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  await ext.close()
})

async function openArticle(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
}

/** Opens the all-sites view and expands the article group; returns the view. */
async function showArticleGroup(panel: Page): Promise<Locator> {
  const view = await openAllSites(panel)
  await expandGroup(view, TITLE)
  return view
}

test('a highlight created while the side panel is closed is listed when it opens', async ({
  context,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const page = await context.newPage()
  await openArticle(page, `${server.origin}/article.html`)
  const selected = await dragSelect(page, page.locator('#target'))
  await clickMenuButton(page, 0)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)

  const panel = await openSidePanel()
  const view = await showArticleGroup(panel)
  await expect(view.locator('li')).toHaveCount(1)
  await expect(view.locator('li').first()).toContainText(selected)

  // The open panel follows later writes through db/changed, without a reload.
  await page.bringToFront()
  await dragSelect(page, page.locator('#intro'))
  await clickMenuButton(page, 1)
  await expect(view.locator('li')).toHaveCount(2)

  expect(externalRequests).toEqual([])
})

test('two tabs and the side panel editing three records at once keep all three edits', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const targets: ExpectedHighlight[] = [
    { id: 'a', text: 'quick brown fox', scope: '#intro' },
    { id: 'b', text: 'survive a page reload', scope: '#target' },
    { id: 'c', text: 'paragraph exists', scope: '#outro' },
  ]
  const probe = await context.newPage()
  await probe.goto(url)
  const seeds = await probe.evaluate(computeSeedsInPage, { highlights: targets, contextLength: CONTEXT_LENGTH })
  await probe.close()
  if (typeof seeds === 'string') throw new Error(seeds)
  const requests = seeds.map((s) => seedToCreateReq(s, url, TITLE))
  const ext = await openExtensionPage(context, extensionId)
  await seedHighlights(ext, requests)
  await ext.close()
  const [recA, recB, recC] = requests

  const tabA = await context.newPage()
  const tabB = await context.newPage()
  await openArticle(tabA, url)
  await openArticle(tabB, url)
  const panel = await openSidePanel()
  const view = await showArticleGroup(panel)
  await expect(view.locator('li')).toHaveCount(3)

  // Story 3.14 removed the in-page hover editor (the click popover arrives in Story 3.15), so the two
  // comment writes come from two extension pages; both tabs stay open and receive the broadcasts.
  const writerA = await openExtensionPage(context, extensionId)
  const writerB = await openExtensionPage(context, extensionId)
  await panel.bringToFront()
  const deleteC = view.locator('li', { hasText: recC.text }).getByTitle(strings.deleteHighlight)

  const [resA, resB] = await Promise.all([
    extensionRequest(writerA, 'highlight/update', { id: recA.id, patch: { comment: 'note from tab A' } }),
    extensionRequest(writerB, 'highlight/update', { id: recB.id, patch: { comment: 'note from tab B' } }),
    deleteC.click(),
  ])
  expect(resA.ok && resB.ok).toBe(true)

  await expect
    .poll(async () => {
      const live = await liveRecords(serviceWorker)
      return live.map((r) => `${r.id}:${r.comment ?? ''}`).sort()
    })
    .toEqual([`${recA.id}:note from tab A`, `${recB.id}:note from tab B`].sort())
  // The panel shows the result of all three edits.
  await expect(view.locator('li')).toHaveCount(2)
  await expect(view.getByText('note from tab A')).toBeVisible()
  await expect(view.getByText('note from tab B')).toBeVisible()
  // Both page tabs repaint the comment marker from the broadcast and drop the deleted highlight.
  for (const tab of [tabA, tabB]) {
    await expect(tab.locator(`[data-noteit-id="${recA.id}"]`).first()).toHaveClass(/noteit-commented/)
    await expect(tab.locator(`[data-noteit-id="${recB.id}"]`).first()).toHaveClass(/noteit-commented/)
    await expect(tab.locator(`[data-noteit-id="${recC.id}"]`)).toHaveCount(0)
  }

  expect(externalRequests).toEqual([])
})
