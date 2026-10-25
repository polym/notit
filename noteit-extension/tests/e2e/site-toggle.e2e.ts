// Story 3.6: the sidebar-header site-toggle, the current page empty states (site off, no highlights,
// unsupported page) and no cold-start skeleton (FR18, FR24, FR45, Q43, Q46, Q67).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page, Worker } from '@playwright/test'
import { test, expect, PAGES_DIR, signIn } from './fixtures/extension.ts'
import { computeSeedsInPage, type ExpectedHighlight } from '../corpus/runner.ts'
import {
  enableSite,
  extensionRequest,
  openExtensionPage,
  resetLocalData,
  seedHighlights,
  seedToCreateReq,
} from '../helpers/local-db.ts'
import { MENU, dragSelect } from './fixtures/page-actions.ts'
import { strings } from '../../src/ui/strings.ts'

const SITE = '127.0.0.1'
const TITLE = 'NoteIt smoke article'
// Same context length as src/content/SelectionManager.ts getSelectionContext.
const CONTEXT_LENGTH = 64
const TARGETS: ExpectedHighlight[] = [
  { id: 'a', text: 'quick brown fox', scope: '#intro' },
  { id: 'b', text: 'survive a page reload', scope: '#target' },
]

// One-page PDF with no content; enough for Chrome's viewer to open it.
const MINIMAL_PDF = [
  '%PDF-1.4',
  '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj',
  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj',
  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj',
  'trailer<</Root 1 0 R>>',
  '%%EOF',
].join('\n')

async function openArticle(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
}

/** Badge text of the tab whose URL is exactly `url`, read in the service worker. */
async function badgeOf(serviceWorker: Worker, url: string): Promise<string> {
  return serviceWorker.evaluate(async (target) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === target)
    if (tab?.id === undefined) throw new Error(`no tab for ${target}`)
    return chrome.action.getBadgeText({ tabId: tab.id })
  }, url)
}

/** Seeds the two article highlights, then turns the site off (manual override). */
async function seedThenDisable(page: Page, ext: Page, url: string): Promise<void> {
  await page.goto(url)
  const seeds = await page.evaluate(computeSeedsInPage, { highlights: TARGETS, contextLength: CONTEXT_LENGTH })
  if (typeof seeds === 'string') throw new Error(seeds)
  await enableSite(ext, SITE)
  await seedHighlights(
    ext,
    seeds.map((s) => seedToCreateReq(s, url, TITLE)),
  )
  const off = await extensionRequest<void>(ext, 'site/setEnabled', { siteKey: SITE, enabled: false })
  if (!off.ok) throw new Error(`site/setEnabled failed: ${JSON.stringify(off.error)}`)
}

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  // Story 2.15 login gate: highlight writes need a session.
  await signIn(context, extensionId)
})

test('site off: empty state with the turn-on button, hidden item-count; turning on renders highlights and the menu', async ({
  context,
  extensionId,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const ext = await openExtensionPage(context, extensionId)
  const page = await context.newPage()
  await seedThenDisable(page, ext, url)
  await ext.close()

  // A closed site never marks the host as on: wait for the content script's page/getState instead.
  await page.goto(url)
  await page.waitForLoadState('load')
  await page.waitForTimeout(300)
  await expect(page.locator('.noteit-highlight')).toHaveCount(0)

  const panel = await openSidePanel()
  await page.bringToFront()
  const header = panel.getByTestId('sidebar-header')
  const toggle = header.getByRole('switch')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(toggle).toBeEnabled()
  await expect(header.getByTestId('site-toggle-text')).toHaveText(strings.siteOff)

  const view = panel.getByTestId('current-page-view')
  const off = view.getByTestId('site-off')
  await expect(off).toContainText(strings.siteOff)
  await expect(view.getByTestId('item-count')).toHaveCount(0)
  await expect(view.getByTestId('highlight-item')).toHaveCount(0)

  // The empty-state button turns the site on: the page renders its highlights right away.
  await off.getByRole('button', { name: strings.siteTurnOn }).click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await expect(header.getByTestId('site-toggle-text')).toHaveText(strings.siteOn)
  await expect(view.getByTestId('item-count')).toHaveText(strings.itemCount(2))
  await expect(view.getByTestId('highlight-item')).toHaveCount(2)
  await expect(page.locator('.noteit-highlight').first()).toBeAttached()

  // The selection menu is allowed again.
  await page.bringToFront()
  await dragSelect(page, page.locator('#outro'))
  await expect(page.locator(MENU)).toBeVisible()

  expect(externalRequests).toEqual([])
})

test('switching the site off removes page highlights and the badge; data stays in all sites', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const ext = await openExtensionPage(context, extensionId)
  const page = await context.newPage()
  await seedThenDisable(page, ext, url)
  await enableSite(ext, SITE)
  await ext.close()

  await openArticle(page, url)
  await expect(page.locator('.noteit-highlight').first()).toBeAttached()
  await expect.poll(() => badgeOf(serviceWorker, url)).toBe('2')

  const panel = await openSidePanel()
  await page.bringToFront()
  const toggle = panel.getByTestId('sidebar-header').getByRole('switch')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')

  await expect(page.locator('.noteit-highlight')).toHaveCount(0)
  await expect.poll(() => badgeOf(serviceWorker, url)).toBe('')
  await expect(panel.getByTestId('site-off')).toBeVisible()

  // Data is kept: the all-sites view still lists the page.
  await panel.getByRole('button', { name: strings.viewAllSites }).click()
  await expect(panel.getByTestId('all-sites-view')).toContainText(TITLE)

  // The site stays off after a reload (no auto-enable from existing highlights).
  await page.reload()
  await page.waitForLoadState('load')
  await page.waitForTimeout(500)
  await expect(page.locator('.noteit-highlight')).toHaveCount(0)

  expect(externalRequests).toEqual([])
})

test('an enabled page without highlights shows the shortcut hint with no skeleton', async ({
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
  const isMac = await panel.evaluate(() => /mac/i.test(navigator.platform || navigator.userAgent))
  const hint = isMac ? strings.emptyCurrentPage : strings.emptyCurrentPageCtrl
  await expect(view.getByTestId('empty-current-page')).toHaveText(hint)
  expect(hint).toContain(isMac ? '⌘⇧H' : 'Ctrl+Shift+H')
  await expect(view.getByTestId('item-count')).toHaveText(strings.itemCount(0))
  // No cold-start placeholder text anywhere in the panel.
  await expect(panel.getByText(strings.loading)).toHaveCount(0)

  expect(externalRequests).toEqual([])
})

test('extension pages and PDF tabs are unsupported; all sites still works', async ({
  context,
  extensionId,
  server,
  openSidePanel,
  externalRequests,
}) => {
  // Seed one highlight so the all-sites view has something to browse.
  const url = `${server.origin}/article.html`
  const ext = await openExtensionPage(context, extensionId)
  const page = await context.newPage()
  await seedThenDisable(page, ext, url)
  await ext.close()
  await page.close()

  // The panel itself is an extension page: as the active tab it is the unsupported page.
  const panel = await openSidePanel()
  const toggle = panel.getByTestId('sidebar-header').getByRole('switch')
  const view = panel.getByTestId('current-page-view')
  await expect(view.getByTestId('page-unsupported')).toHaveText(strings.pageUnsupported)
  await expect(toggle).toBeDisabled()
  await expect(view.getByTestId('item-count')).toHaveCount(0)

  await panel.getByRole('button', { name: strings.viewAllSites }).click()
  await expect(panel.getByTestId('all-sites-view')).toContainText(TITLE)
  await panel.getByRole('button', { name: strings.viewCurrentPage }).click()
  await expect(view.getByTestId('page-unsupported')).toBeVisible()

  // A PDF tab (URL path *.pdf) is unsupported too.
  const article = readFileSync(join(PAGES_DIR, 'article.html'), 'utf8')
  await context.route('**/doc.pdf', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: article }),
  )
  const pdf = await context.newPage()
  await pdf.goto(`${server.origin}/doc.pdf`)
  await pdf.bringToFront()
  await expect(view.getByTestId('page-unsupported')).toBeVisible()
  await expect(toggle).toBeDisabled()

  // A real PDF served from a path without a .pdf suffix opens in Chrome's viewer, where no content
  // script runs: the panel finds out by pinging the tab.
  await context.route('**/paper/2401', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: MINIMAL_PDF }),
  )
  const viewer = await context.newPage()
  await viewer.goto(`${server.origin}/paper/2401`)
  await viewer.bringToFront()
  await expect(view.getByTestId('page-unsupported')).toBeVisible()
  await expect(toggle).toBeDisabled()

  // chrome://extensions is unsupported.
  const chromePage = await context.newPage()
  await chromePage.goto('chrome://extensions')
  await chromePage.bringToFront()
  await expect(view.getByTestId('page-unsupported')).toBeVisible()
  await expect(toggle).toBeDisabled()

  // Back on a web page the switch works again.
  const web = await context.newPage()
  await web.goto(url)
  await web.bringToFront()
  await expect(toggle).toBeEnabled()
  await expect(view.getByTestId('site-off')).toBeVisible()

  expect(externalRequests).toEqual([])
})
