// Lost decision on virtual lists: a highlight whose post was scrolled out of the DOM by the page's own
// virtualization (x.com status page: main post vs replies) is not "not found on the page". Two posts
// far apart in a virtual timeline are never in the DOM together, so neither may be marked lost.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, PAGES_DIR, signIn } from './fixtures/extension.ts'
import { anchorStatusIds, enableSite, extensionRequest, liveRecords, openExtensionPage, resetLocalData } from '../helpers/local-db.ts'
import { clickMenuButton, dragSelect } from './fixtures/page-actions.ts'
import { ANCHOR_LOST_WINDOW_MS } from '../../src/core/model/index.ts'

const URL_ = 'https://x.com/someone/status/1'
const MAIN_POST = 'The main post of the thread, highlighted before scrolling to the replies.'

test.setTimeout(90_000)

async function routeStatus(context: BrowserContext): Promise<void> {
  const template = readFileSync(join(PAGES_DIR, 'timeline.html'), 'utf8')
  await context.route('https://x.com/**', async (route) => {
    const body = template.replaceAll('TARGET_POST', MAIN_POST)
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
  })
}

const scrollFeed = (page: Page, top: number) => page.locator('#feed').evaluate((el, y) => (el.scrollTop = y), top)

async function highlightRow(page: Page, index: number): Promise<void> {
  const before = (await liveRecords(page.context().serviceWorkers()[0])).length
  await dragSelect(page, page.locator(`.row[data-index="${index}"] p`))
  await clickMenuButton(page, 0)
  await expect.poll(async () => (await liveRecords(page.context().serviceWorkers()[0])).length).toBe(before + 1)
}

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, 'x.com')
  await ext.close()
})

test('highlights scrolled out by a virtual list are never reported lost', async ({ context, extensionId, serviceWorker }) => {
  await routeStatus(context)
  const page = await context.newPage()
  await page.goto(URL_)
  await page.locator('qingmark-root[data-qingmark-site="on"]').waitFor({ state: 'attached' })

  // Main post at the top, then a reply far below it.
  await highlightRow(page, 3)
  await scrollFeed(page, 3200)
  await highlightRow(page, 41)
  expect(await liveRecords(serviceWorker)).toHaveLength(2)

  // Past the lost window with the main post out of the DOM.
  await page.waitForTimeout(ANCHOR_LOST_WINDOW_MS + 1500)
  expect(await anchorStatusIds(serviceWorker)).toEqual([])

  // Back to the top: now the reply is out of the DOM.
  await scrollFeed(page, 0)
  await page.waitForTimeout(1500)
  expect(await anchorStatusIds(serviceWorker)).toEqual([])

  // Jumping from the side panel to the scrolled-out reply scrolls back to it, so the list renders
  // it again, and flashes it; nothing is marked lost.
  const reply = (await liveRecords(serviceWorker)).find((r) => r.text !== MAIN_POST)
  if (!reply) throw new Error('reply record missing')
  const ext = await openExtensionPage(context, extensionId)
  const jump = await extensionRequest<{ result: string }>(ext, 'nav/jumpTo', { id: reply.id })
  expect(jump).toEqual({ ok: true, data: { result: 'flashed' } })
  await expect(page.locator(`[data-qingmark-id="${reply.id}"]`).first()).toBeInViewport()
  expect(await anchorStatusIds(serviceWorker)).toEqual([])
})
