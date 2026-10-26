// Story 3.9: clicking a side panel item jumps to its highlight (FR22, Q55). The panel sends
// nav/jumpTo; the service worker reuses or opens the page's tab and content scrolls to the highlight and
// applies highlight-flash for about 1200ms. A highlight not found within 3s turns the item lost, and
// lost items do not jump.
import type { Locator, Page, Worker } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { anchorStatusIds, enableSite, openExtensionPage, resetLocalData, seedHighlights } from '../helpers/local-db.ts'
import type { CreateHighlightReq } from '../../src/features/highlight/index.ts'
import { strings } from '../../src/ui/strings.ts'
import { expandGroup, openAllSites } from './fixtures/all-sites.ts'

const SITE = '127.0.0.1'
const TITLE = 'NoteIt long article'
const TARGET = 'The jump target lives far below the fold.'
const GHOST = 'This sentence is not on the page at all.'
const FLASH_MS = 1200

function req(url: string, text: string): CreateHighlightReq {
  // No anchor: the renderer falls back to context / text search, so the text alone decides.
  return { id: crypto.randomUUID(), url, text, color: 'yellow', comment: null, anchor: null, pageTitle: TITLE, favicon: null }
}

/** The side panel item showing `text` in the all-sites view, with its page group expanded. */
async function panelItem(panel: Page, text: string): Promise<Locator> {
  const view = await openAllSites(panel)
  await expandGroup(view, TITLE)
  return view.getByTestId('highlight-item').filter({ hasText: text })
}

/** Whether the first span of the highlight is inside the viewport. */
function inViewport(page: Page, id: string): Promise<boolean> {
  return page
    .locator(`[data-noteit-id="${id}"]`)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect()
      return r.top >= 0 && r.bottom <= window.innerHeight
    })
}

/** Waits for the flash to start, then checks that it ends about FLASH_MS later. */
async function expectFlash(page: Page, id: string): Promise<void> {
  const span = page.locator(`[data-noteit-id="${id}"]`).first()
  await expect(span).toHaveClass(/noteit-flash/)
  const startedAt = Date.now()
  // Darker while flashing: the filter is set on top of the normal highlight style.
  await expect.poll(() => span.evaluate((el) => getComputedStyle(el).filter)).not.toBe('none')
  await expect(span).not.toHaveClass(/noteit-flash/, { timeout: FLASH_MS + 2000 })
  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(FLASH_MS - 300)
  await expect.poll(() => span.evaluate((el) => getComputedStyle(el).filter)).toBe('none')
}

/** Pages of the context showing the long article. */
function articleTabs(pages: Page[]): Page[] {
  return pages.filter((p) => p.url().includes('/long-article.html'))
}

async function openWindow(serviceWorker: Worker, url: string): Promise<void> {
  await serviceWorker.evaluate(async (u) => {
    await chrome.windows.create({ url: u, focused: false })
  }, url)
}

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  // Story 2.15 login gate: highlight writes need a session.
  await signIn(context, extensionId)
})

test('clicking an item scrolls to its highlight and flashes it, reusing or opening the tab', async ({
  context,
  extensionId,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/long-article.html`
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  const target = req(url, TARGET)
  await seedHighlights(ext, [target])
  await ext.close()

  const panel = await openSidePanel()
  const item = await panelItem(panel, TARGET)
  await expect(item).toHaveCount(1)

  // Page not open: a new tab opens, loads and flashes the highlight.
  const opened = context.waitForEvent('page')
  await item.getByTestId('highlight-text').click()
  const page = await opened
  await expect(page.locator(`[data-noteit-id="${target.id}"]`).first()).toBeAttached()
  await expectFlash(page, target.id)
  await expect.poll(() => inViewport(page, target.id)).toBe(true)
  const tabCount = context.pages().length

  // Target page already open in this window: no new tab, it scrolls back and flashes again.
  await page.evaluate(() => window.scrollTo(0, 0))
  expect(await inViewport(page, target.id)).toBe(false)
  await panel.bringToFront()
  await item.getByTestId('highlight-text').click()
  await expectFlash(page, target.id)
  await expect.poll(() => inViewport(page, target.id)).toBe(true)
  expect(context.pages().length).toBe(tabCount)
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible')
  expect(externalRequests).toEqual([])
})

test('clicking an item switches to the page open in another window', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/long-article.html`
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  const target = req(url, TARGET)
  await seedHighlights(ext, [target])
  await ext.close()

  const panel = await openSidePanel()
  const item = await panelItem(panel, TARGET)
  await expect(item).toHaveCount(1)

  const opened = context.waitForEvent('page')
  await openWindow(serviceWorker, url)
  const page = await opened
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
  const windows = await serviceWorker.evaluate(async () => (await chrome.windows.getAll()).length)
  expect(windows).toBeGreaterThanOrEqual(2)
  const tabCount = context.pages().length

  await panel.bringToFront()
  await item.getByTestId('highlight-text').click()
  await expectFlash(page, target.id)
  await expect.poll(() => inViewport(page, target.id)).toBe(true)
  // The existing tab was used: no new tab and only one tab of the page.
  expect(context.pages().length).toBe(tabCount)
  expect(articleTabs(context.pages())).toHaveLength(1)
  const active = await serviceWorker.evaluate(async (u) => {
    const [tab] = await chrome.tabs.query({ url: u })
    return tab?.active ?? false
  }, url)
  expect(active).toBe(true)
  expect(externalRequests).toEqual([])
})

test('an item not found within 3s turns lost, and a lost item does not jump', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/long-article.html`
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  const ghost = req(url, GHOST)
  await seedHighlights(ext, [ghost])
  await ext.close()

  const panel = await openSidePanel()
  const item = await panelItem(panel, GHOST)
  await expect(item).toHaveCount(1)
  await expect(item.getByTestId('anchor-lost')).toHaveCount(0)

  // The page opens, the highlight never renders, and after the 3s window the item turns lost.
  const opened = context.waitForEvent('page')
  const clickedAt = Date.now()
  await item.getByTestId('highlight-text').click()
  const page = await opened
  await expect(item.getByTestId('anchor-lost')).toHaveText(strings.anchorLost, { timeout: 15_000 })
  expect(Date.now() - clickedAt).toBeGreaterThanOrEqual(3000)
  expect(await anchorStatusIds(serviceWorker)).toEqual([ghost.id])
  await expect(item.getByRole('button', { name: GHOST })).toBeDisabled()

  // Lost, page still open: clicking neither opens a tab nor scrolls or flashes the open page.
  await page.evaluate(() => window.scrollTo(0, 500))
  const scrollBefore = await page.evaluate(() => window.scrollY)
  expect(scrollBefore).toBeGreaterThan(0)
  const pagesBefore = context.pages().length
  await panel.bringToFront()
  await item.getByTestId('highlight-text').click({ force: true })
  await panel.waitForTimeout(1000)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)
  expect(context.pages().length).toBe(pagesBefore)
  expect(articleTabs(context.pages())).toHaveLength(1)
  expect(await page.locator('.noteit-flash').count()).toBe(0)

  // Lost, page closed: clicking does not open a new tab.
  await page.close()
  const before = context.pages().length
  await panel.bringToFront()
  await item.getByTestId('highlight-text').click({ force: true })
  await panel.waitForTimeout(1000)
  expect(context.pages().length).toBe(before)
  expect(articleTabs(context.pages())).toHaveLength(0)
  expect(externalRequests).toEqual([])
})
