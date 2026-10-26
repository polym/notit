// Story 2.9: after every commit the service worker sends page/sync to all tabs with the same
// canonicalUrl, and the toolbar badge shows the live count of the active tab's page.
import type { Page, Worker } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { computeSeedsInPage, type ExpectedHighlight } from '../corpus/runner.ts'
import {
  enableSite,
  extensionRequest,
  openExtensionPage,
  resetLocalData,
  seedHighlights,
  seedToCreateReq,
} from '../helpers/local-db.ts'
import { clickMenuButton, dragSelect } from './fixtures/page-actions.ts'

const SITE = '127.0.0.1'
const TITLE = 'NoteIt smoke article'
// Same context length as src/content/SelectionManager.ts getSelectionContext.
const CONTEXT_LENGTH = 64
const TARGETS: ExpectedHighlight[] = [
  { id: 'a', text: 'quick brown fox', scope: '#intro' },
  { id: 'b', text: 'survive a page reload', scope: '#target' },
]

async function openArticle(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
}

/** Badge text of the tab whose URL is exactly `url`, read in the service worker. */
async function badgeOf(serviceWorker: Worker, url: string): Promise<string> {
  return serviceWorker.evaluate(async (target) => {
    const tabs = await chrome.tabs.query({})
    const tab = tabs.find((t) => t.url === target)
    if (tab?.id === undefined) throw new Error(`no tab for ${target}`)
    return chrome.action.getBadgeText({ tabId: tab.id })
  }, url)
}

async function seedArticle(
  page: Page,
  url: string,
  extPage: Page,
): Promise<ReturnType<typeof seedToCreateReq>[]> {
  await page.goto(url)
  const seeds = await page.evaluate(computeSeedsInPage, { highlights: TARGETS, contextLength: CONTEXT_LENGTH })
  if (typeof seeds === 'string') throw new Error(seeds)
  const requests = seeds.map((s) => seedToCreateReq(s, url, TITLE))
  await seedHighlights(extPage, requests)
  return requests
}

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  // Story 2.15 login gate: highlight writes need a session.
  await signIn(context, extensionId)
})

test('delete and restore reach every tab of the same page (hash and utm_source differ)', async ({
  context,
  extensionId,
  server,
  externalRequests,
}) => {
  const urlA = `${server.origin}/article.html#intro`
  const urlB = `${server.origin}/article.html?utm_source=x#sec`
  const ext = await openExtensionPage(context, extensionId)
  const probe = await context.newPage()
  const [recA, recB] = await seedArticle(probe, `${server.origin}/article.html`, ext)
  await probe.close()

  const tabA = await context.newPage()
  const tabB = await context.newPage()
  await openArticle(tabA, urlA)
  await openArticle(tabB, urlB)
  // A page opened with ?utm_source=x#sec renders every highlight of its canonicalUrl.
  for (const rec of [recA, recB]) {
    await expect(tabA.locator(`[data-noteit-id="${rec.id}"]`).first()).toBeVisible()
    await expect(tabB.locator(`[data-noteit-id="${rec.id}"]`).first()).toBeVisible()
  }

  // The legacy page UI has no delete action; the request goes through the same SW router.
  const deleted = await extensionRequest(ext, 'highlight/delete', { id: recA.id })
  expect(deleted.ok).toBe(true)
  await expect(tabB.locator(`[data-noteit-id="${recA.id}"]`)).toHaveCount(0, { timeout: 1000 })
  await expect(tabA.locator(`[data-noteit-id="${recA.id}"]`)).toHaveCount(0, { timeout: 1000 })
  await expect(tabB.locator(`[data-noteit-id="${recB.id}"]`).first()).toBeVisible()

  const restored = await extensionRequest(ext, 'highlight/restore', { id: recA.id })
  expect(restored.ok).toBe(true)
  await expect(tabB.locator(`[data-noteit-id="${recA.id}"]`).first()).toBeVisible({ timeout: 1000 })
  await expect(tabA.locator(`[data-noteit-id="${recA.id}"]`).first()).toBeVisible({ timeout: 1000 })

  expect(externalRequests).toEqual([])
})

test('a highlight created in one tab appears in the other tab of the same page', async ({
  context,
  extensionId,
  server,
  externalRequests,
}) => {
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  const tabA = await context.newPage()
  const tabB = await context.newPage()
  await openArticle(tabA, `${server.origin}/article.html`)
  await openArticle(tabB, `${server.origin}/article.html?utm_source=x#sec`)

  await tabA.bringToFront()
  await dragSelect(tabA, tabA.locator('#target'))
  await clickMenuButton(tabA, 0)
  await expect(tabA.locator('.noteit-highlight').first()).toBeVisible()
  await expect(tabB.locator('.noteit-highlight').first()).toBeVisible({ timeout: 1000 })

  expect(externalRequests).toEqual([])
})

test('the badge shows the live count of the current page and follows tab switches', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  externalRequests,
}) => {
  const article = `${server.origin}/article.html`
  const other = `${server.origin}/slow-favicon.html`
  const ext = await openExtensionPage(context, extensionId)
  const probe = await context.newPage()
  const [recA] = await seedArticle(probe, article, ext)
  await probe.close()

  const tabA = await context.newPage()
  await openArticle(tabA, `${article}?utm_source=x`)
  await expect.poll(() => badgeOf(serviceWorker, `${article}?utm_source=x`)).toBe('2')

  // A page without highlights has an empty badge after switching to it.
  const tabB = await context.newPage()
  await tabB.goto(other)
  await tabB.bringToFront()
  await expect.poll(() => badgeOf(serviceWorker, other)).toBe('')

  // Commits update the badge of the page's tabs.
  await tabA.bringToFront()
  await extensionRequest(ext, 'highlight/delete', { id: recA.id })
  await expect.poll(() => badgeOf(serviceWorker, `${article}?utm_source=x`)).toBe('1')

  // A site turned off shows an empty badge.
  const off = await extensionRequest(ext, 'site/setEnabled', { siteKey: SITE, enabled: false })
  expect(off.ok).toBe(true)
  await tabA.bringToFront()
  await expect.poll(() => badgeOf(serviceWorker, `${article}?utm_source=x`)).toBe('')

  expect(externalRequests).toEqual([])
})
