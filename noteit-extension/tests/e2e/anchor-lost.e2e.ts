// Story 2.11: lost decision (anchor/report -> anchorStatus) and nav/jumpTo (Q54, Q55, FR13, FR22).
// Seeds go through highlight/create; anchorStatus is read straight from the service worker's IndexedDB.
import type { Page } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import {
  anchorStatusIds,
  enableSite,
  extensionRequest,
  openExtensionPage,
  resetLocalData,
  seedHighlights,
} from '../helpers/local-db.ts'
import type { CreateHighlightReq } from '../../src/features/highlight/index.ts'
import { strings } from '../../src/ui/strings.ts'
import { expandGroup, openAllSites } from './fixtures/all-sites.ts'

const SITE = '127.0.0.1'
const TITLE = 'NoteIt smoke article'
const GHOST = 'This sentence is not on the page yet.'
const LOST_TEXT = strings.anchorLost

function req(url: string, text: string, comment: string | null = null): CreateHighlightReq {
  // No anchor: the renderer falls back to context / text search, so the text alone decides.
  return { id: crypto.randomUUID(), url, text, color: 'yellow', comment, anchor: null, pageTitle: TITLE, favicon: null }
}

async function openArticle(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
}

async function jumpTo(ext: Page, id: string): Promise<string> {
  const r = await extensionRequest<{ result: string }>(ext, 'nav/jumpTo', { id })
  if (!r.ok) throw new Error(`nav/jumpTo failed: ${JSON.stringify(r.error)}`)
  return r.data.result
}

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  // Story 2.15 login gate: highlight writes need a session.
  await signIn(context, extensionId)
})

test('a missing highlight is marked lost after 3s and cleared once its text appears', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  const ghost = req(url, GHOST, 'my note')
  const present = req(url, 'Highlights must survive a page reload.')
  const neverOpened = { ...req(`${server.origin}/never-opened.html`, 'Text of a page nobody opened.'), pageTitle: 'Never opened' }
  await seedHighlights(ext, [ghost, present, neverOpened])

  const page = await context.newPage()
  const openedAt = Date.now()
  await openArticle(page, url)
  await expect(page.locator(`[data-noteit-id="${present.id}"]`).first()).toBeVisible()
  // Not lost before the window ends.
  await page.waitForTimeout(1500)
  expect(await anchorStatusIds(serviceWorker)).toEqual([])
  await expect.poll(() => anchorStatusIds(serviceWorker), { timeout: 6000 }).toEqual([ghost.id])
  expect(Date.now() - openedAt).toBeGreaterThanOrEqual(3000)

  // The side panel keeps text and comment and shows the lost note.
  const panel = await openSidePanel()
  const view = await openAllSites(panel)
  await expandGroup(view, TITLE)
  const lostItem = view.locator('li', { hasText: GHOST })
  await expect(lostItem.getByTestId('anchor-lost')).toHaveText(LOST_TEXT)
  await expect(lostItem).toContainText('my note')
  await expect(view.getByTestId('anchor-lost')).toHaveCount(1)

  // The text shows up on the page: the mutation retry renders it and the row is deleted.
  await page.evaluate((text) => {
    const p = document.createElement('p')
    p.textContent = text
    document.body.appendChild(p)
  }, GHOST)
  await expect(page.locator(`[data-noteit-id="${ghost.id}"]`).first()).toBeVisible({ timeout: 5000 })
  await expect.poll(() => anchorStatusIds(serviceWorker)).toEqual([])
  await expect(view.getByTestId('anchor-lost')).toHaveCount(0)

  // A page that was never opened has no anchorStatus row.
  expect(await anchorStatusIds(serviceWorker)).not.toContain(neverOpened.id)
  expect(externalRequests).toEqual([])
})

test('nav/jumpTo reuses an open tab, opens a new one when needed and reports lost', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  const present = req(url, 'Highlights must survive a page reload.')
  const ghost = req(`${server.origin}/article.html?utm_source=x`, GHOST)
  await seedHighlights(ext, [present, ghost])

  // No tab of the page yet: a new tab opens and the highlight is flashed there.
  const opened = context.waitForEvent('page')
  expect(await jumpTo(ext, present.id)).toBe('flashed')
  const page = await opened
  expect(new URL(page.url()).pathname).toBe('/article.html')
  await expect(page.locator(`[data-noteit-id="${present.id}"]`).first()).toBeVisible()
  const tabCount = context.pages().length

  // The same page (other URL variant) is reused, no new tab.
  await ext.bringToFront()
  expect(await jumpTo(ext, present.id)).toBe('flashed')
  expect(context.pages().length).toBe(tabCount)
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible')

  // A highlight that cannot be shown returns lost and is written to anchorStatus.
  expect(await jumpTo(ext, ghost.id)).toBe('lost')
  expect(context.pages().length).toBe(tabCount)
  expect(await anchorStatusIds(serviceWorker)).toEqual([ghost.id])
  expect(externalRequests).toEqual([])
})
