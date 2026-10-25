// Story 2.10: site enable rules (D8, keyed by siteKey) and highlight creation from the shortcut and
// the context menu. Native accelerators and context menus cannot be driven from Playwright, so the
// tests dispatch the real chrome.commands.onCommand / chrome.contextMenus.onClicked listeners of
// the service worker with the real tab.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Page, Worker } from '@playwright/test'
import { test, expect, PAGES_DIR, signIn } from './fixtures/extension.ts'
import { MENU, dragSelect } from './fixtures/page-actions.ts'
import {
  dumpLocalDb,
  extensionRequest,
  liveRecords,
  openExtensionPage,
  resetLocalData,
} from '../helpers/local-db.ts'
import type { PageState } from '../../src/features/highlight/index.ts'

const ARTICLE = readFileSync(join(PAGES_DIR, 'article.html'), 'utf8')

/** Serves the e2e article for every *.example.test URL (registered after the fixture's block route, so it wins). */
async function serveExampleTest(context: BrowserContext): Promise<void> {
  await context.route(
    (url) => url.hostname === 'example.test' || url.hostname.endsWith('.example.test'),
    async (route) => {
      if (new URL(route.request().url()).pathname.endsWith('.html')) {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: ARTICLE })
      } else {
        await route.fulfill({ status: 204 })
      }
    },
  )
}

async function pageState(ext: Page, url: string): Promise<PageState> {
  const r = await extensionRequest<PageState>(ext, 'page/getState', { url })
  if (!r.ok) throw new Error(`page/getState failed: ${JSON.stringify(r.error)}`)
  return r.data
}

/** Opens a page and gives the content script's page/getState round trip time to settle. */
async function openPage(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.waitForLoadState('load')
  await page.waitForTimeout(300)
}

async function dispatchShortcut(serviceWorker: Worker, url: string): Promise<void> {
  await serviceWorker.evaluate(async (target) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === target)
    if (!tab) throw new Error(`no tab for ${target}`)
    ;(chrome.commands.onCommand as unknown as { dispatch(c: string, t: chrome.tabs.Tab): void }).dispatch(
      'highlight-selection',
      tab,
    )
  }, url)
}

async function dispatchMenuClick(serviceWorker: Worker, url: string): Promise<void> {
  await serviceWorker.evaluate(async (target) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === target)
    if (!tab) throw new Error(`no tab for ${target}`)
    ;(
      chrome.contextMenus.onClicked as unknown as {
        dispatch(i: Partial<chrome.contextMenus.OnClickData>, t: chrome.tabs.Tab): void
      }
    ).dispatch({ menuItemId: 'noteit-highlight', selectionText: '' }, tab)
  }, url)
}

async function overrides(serviceWorker: Worker): Promise<unknown> {
  return serviceWorker.evaluate(async () => (await chrome.storage.local.get('siteOverrides')).siteOverrides ?? null)
}

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  // Story 2.15 login gate: highlight writes need a session.
  await signIn(context, extensionId)
})

test('enabling www.example.test enables example.test but not docs.example.test', async ({
  context,
  extensionId,
  serviceWorker,
  externalRequests,
}) => {
  await serveExampleTest(context)
  const ext = await openExtensionPage(context, extensionId)
  const www = 'http://www.example.test/article.html'
  const page = await context.newPage()
  await openPage(page, www)
  expect((await pageState(ext, www)).enabled).toBe(false)

  // The shortcut on a closed site turns it on and creates the highlight.
  await page.bringToFront()
  const text = await dragSelect(page, page.locator('#target'))
  await dispatchShortcut(serviceWorker, www)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
  expect(await overrides(serviceWorker)).toEqual({ 'example.test': 'on' })
  expect((await liveRecords(serviceWorker))[0]).toMatchObject({ text, color: 'yellow', siteKey: 'example.test' })

  expect((await pageState(ext, 'http://example.test/other.html')).enabled).toBe(true)
  expect((await pageState(ext, 'http://docs.example.test/article.html')).enabled).toBe(false)

  // example.test shows the selection menu; docs.example.test does not.
  const bare = await context.newPage()
  await openPage(bare, 'http://example.test/other.html')
  await dragSelect(bare, bare.locator('#intro'))
  await expect(bare.locator(MENU)).toBeVisible()

  const docs = await context.newPage()
  await openPage(docs, 'http://docs.example.test/article.html')
  await dragSelect(docs, docs.locator('#intro'))
  await docs.waitForTimeout(300)
  await expect(docs.locator(MENU)).toHaveCount(0)

  expect(externalRequests).toEqual([])
})

test('a manually closed site with highlights does not render or open the menu, data stays', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const ext = await openExtensionPage(context, extensionId)
  const page = await context.newPage()
  await openPage(page, url)
  await page.bringToFront()
  await dragSelect(page, page.locator('#target'))
  await dispatchMenuClick(serviceWorker, url)
  await expect(page.locator('.noteit-highlight').first()).toBeVisible()
  const [record] = await liveRecords(serviceWorker)

  const off = await extensionRequest(ext, 'site/setEnabled', { siteKey: '127.0.0.1', enabled: false })
  expect(off.ok).toBe(true)
  await page.reload()
  await page.waitForTimeout(500)
  await expect(page.locator('.noteit-highlight')).toHaveCount(0)
  await dragSelect(page, page.locator('#intro'))
  await page.waitForTimeout(300)
  await expect(page.locator(MENU)).toHaveCount(0)

  // Data is still there (debug/dump reads the same tables; the e2e build is production).
  const dump = await dumpLocalDb(serviceWorker)
  expect(dump.records.map((r) => r.id)).toContain(record.id)
  expect(dump.records.find((r) => r.id === record.id)?.deletedAt).toBeNull()

  expect(externalRequests).toEqual([])
})

for (const via of ['shortcut', 'context menu'] as const) {
  test(`${via} on a closed site turns it on and creates a yellow highlight`, async ({
    context,
    extensionId,
    serviceWorker,
    server,
    externalRequests,
  }) => {
    const url = `${server.origin}/article.html`
    const ext = await openExtensionPage(context, extensionId)
    const off = await extensionRequest(ext, 'site/setEnabled', { siteKey: '127.0.0.1', enabled: false })
    expect(off.ok).toBe(true)
    const page = await context.newPage()
    await openPage(page, url)
    await page.bringToFront()
    const text = await dragSelect(page, page.locator('#target'))
    await expect(page.locator(MENU)).toHaveCount(0)

    if (via === 'shortcut') await dispatchShortcut(serviceWorker, url)
    else await dispatchMenuClick(serviceWorker, url)

    await expect(page.locator('.noteit-highlight').first()).toBeVisible()
    await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
    expect((await liveRecords(serviceWorker))[0]).toMatchObject({ text, color: 'yellow' })
    expect(await overrides(serviceWorker)).toEqual({ '127.0.0.1': 'on' })
    expect((await pageState(ext, url)).enabled).toBe(true)

    // Still there after a reload.
    await page.reload()
    await expect(page.locator('.noteit-highlight').first()).toBeVisible()
    expect(externalRequests).toEqual([])
  })
}
