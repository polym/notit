// Story 2.15: the login gate covers every entry point (FR27, Q47). While signed out the selection
// menu never shows, highlight/create answers unauthenticated, and the shortcut / context menu open
// the side panel instead of creating; when that open throws the badge shows '!' until sign-in.
// Native accelerators and menus cannot be driven from Playwright, so the real listeners are
// dispatched in the service worker, and chrome.sidePanel.open is replaced there by a recorder.
import type { Page, Worker } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { MENU, dragSelect } from './fixtures/page-actions.ts'
import { enableSite, extensionRequest, liveRecords, openExtensionPage, resetLocalData } from '../helpers/local-db.ts'
import type { CreateHighlightReq } from '../../src/features/highlight/index.ts'

type Entry = 'shortcut' | 'menu'

async function dispatchEntry(serviceWorker: Worker, url: string, entry: Entry): Promise<void> {
  await serviceWorker.evaluate(
    async ({ target, via }) => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url === target)
      if (!tab) throw new Error(`no tab for ${target}`)
      if (via === 'shortcut') {
        ;(chrome.commands.onCommand as unknown as { dispatch(c: string, t: chrome.tabs.Tab): void }).dispatch(
          'highlight-selection',
          tab,
        )
      } else {
        ;(
          chrome.contextMenus.onClicked as unknown as {
            dispatch(i: Partial<chrome.contextMenus.OnClickData>, t: chrome.tabs.Tab): void
          }
        ).dispatch({ menuItemId: 'noteit-highlight', selectionText: '' }, tab)
      }
    },
    { target: url, via: entry },
  )
}

/** Replaces chrome.sidePanel.open with a recorder; `fail` makes it throw like a lost user gesture. */
async function stubSidePanelOpen(serviceWorker: Worker, fail: boolean): Promise<void> {
  await serviceWorker.evaluate((shouldFail) => {
    const g = globalThis as unknown as { __sidePanelOpens: unknown[] }
    g.__sidePanelOpens = []
    Object.defineProperty(chrome.sidePanel, 'open', {
      configurable: true,
      writable: true,
      value: (options: unknown) => {
        g.__sidePanelOpens.push(options)
        if (shouldFail) throw new Error('`sidePanel.open()` may only be called in response to a user gesture.')
        return Promise.resolve()
      },
    })
  }, fail)
}

async function sidePanelOpens(serviceWorker: Worker): Promise<unknown[]> {
  return serviceWorker.evaluate(() => (globalThis as unknown as { __sidePanelOpens: unknown[] }).__sidePanelOpens)
}

async function badgeOf(serviceWorker: Worker, url: string): Promise<string> {
  return serviceWorker.evaluate(async (target) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === target)
    if (tab?.id === undefined) throw new Error(`no tab for ${target}`)
    return chrome.action.getBadgeText({ tabId: tab.id })
  }, url)
}

async function openPage(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.waitForLoadState('load')
  await page.waitForTimeout(300)
}

function createReq(url: string): CreateHighlightReq {
  return {
    id: crypto.randomUUID(),
    url,
    text: 'gated quote',
    color: 'yellow',
    comment: null,
    anchor: null,
    pageTitle: 'Article',
    favicon: null,
  }
}

test.beforeEach(async ({ serviceWorker }) => {
  // Clears the stored session too: every case starts signed out.
  await resetLocalData(serviceWorker)
})

test('signed out: no selection menu and highlight/create returns unauthenticated; sign-in lifts both', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, new URL(url).hostname)

  const page = await context.newPage()
  await openPage(page, url)
  await dragSelect(page, page.locator('#target'))
  await page.waitForTimeout(300)
  await expect(page.locator(MENU)).toHaveCount(0)

  const denied = await extensionRequest(ext, 'highlight/create', createReq(url))
  expect(denied).toMatchObject({ ok: false, error: { code: 'unauthenticated' } })
  expect(await liveRecords(serviceWorker)).toEqual([])

  // Signing in reaches the open tab through page/sync: the menu shows without a reload.
  await signIn(context, extensionId)
  await page.bringToFront()
  await page.mouse.click(5, 5)
  await expect
    .poll(async () => {
      await dragSelect(page, page.locator('#target'))
      return page.locator(MENU).count()
    })
    .toBe(1)
  expect((await extensionRequest(ext, 'highlight/create', createReq(url))).ok).toBe(true)

  expect(externalRequests).toEqual([])
})

for (const entry of ['shortcut', 'menu'] as const) {
  test(`signed out ${entry}: opens the side panel and creates nothing`, async ({
    context,
    serviceWorker,
    server,
    externalRequests,
  }) => {
    const url = `${server.origin}/article.html`
    const page = await context.newPage()
    await openPage(page, url)
    await stubSidePanelOpen(serviceWorker, false)
    await page.bringToFront()
    await dragSelect(page, page.locator('#target'))
    await dispatchEntry(serviceWorker, url, entry)

    await expect.poll(async () => (await sidePanelOpens(serviceWorker)).length).toBe(1)
    const [options] = (await sidePanelOpens(serviceWorker)) as Array<{ windowId?: number }>
    expect(typeof options.windowId).toBe('number')
    await page.waitForTimeout(500)
    expect(await liveRecords(serviceWorker)).toEqual([])
    await expect(page.locator('.noteit-highlight')).toHaveCount(0)
    // The site was not turned on either.
    const overrides = await serviceWorker.evaluate(async () => (await chrome.storage.local.get('siteOverrides')).siteOverrides ?? null)
    expect(overrides).toBeNull()
    expect(await badgeOf(serviceWorker, url)).toBe('')

    expect(externalRequests).toEqual([])
  })

  test(`signed out ${entry}: a throwing sidePanel.open shows '!' and sign-in restores the count`, async ({
    context,
    extensionId,
    serviceWorker,
    server,
    externalRequests,
  }) => {
    const url = `${server.origin}/article.html`
    const page = await context.newPage()
    await openPage(page, url)
    await stubSidePanelOpen(serviceWorker, true)
    await page.bringToFront()
    await dragSelect(page, page.locator('#target'))
    await dispatchEntry(serviceWorker, url, entry)

    await expect.poll(() => badgeOf(serviceWorker, url)).toBe('!')
    expect(await liveRecords(serviceWorker)).toEqual([])

    // Sign in and create one highlight on the page: the badge goes back to the count.
    await signIn(context, extensionId)
    await expect.poll(() => badgeOf(serviceWorker, url)).toBe('')
    const ext = await openExtensionPage(context, extensionId)
    expect((await extensionRequest(ext, 'highlight/create', createReq(url))).ok).toBe(true)
    await expect.poll(() => badgeOf(serviceWorker, url)).toBe('1')

    // Signed in, the same entry point creates a highlight instead of opening the panel.
    await page.bringToFront()
    await dragSelect(page, page.locator('#intro'))
    await dispatchEntry(serviceWorker, url, entry)
    await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(2)
    expect(await sidePanelOpens(serviceWorker)).toHaveLength(1)

    expect(externalRequests).toEqual([])
  })
}
