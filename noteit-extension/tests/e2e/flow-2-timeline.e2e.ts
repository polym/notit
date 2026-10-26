// Story 3.17: EXPERIENCE.md Key Flow 2 (timeline collection) end to end on the built extension.
// A virtual-list timeline served as https://x.com/home (tests/e2e/pages/timeline.html, no network):
// one click on yellow while scrolling, no popup; the post leaves the DOM and the highlight silently
// comes back when it is scrolled into view again. Days later the all-sites view lists it under
// "this week" in the x.com /home page group; the post was deleted by its author, so clicking the item
// shows "not found on the page" while the text and comment stay in the side panel.
// Needs the local Supabase stack (npm run db:start, env:local, build).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, PAGES_DIR, signIn } from './fixtures/extension.ts'
import { anchorStatusIds, dumpLocalDb, enableSite, extensionRequest, liveRecords, openExtensionPage, putRecords, resetLocalData } from '../helpers/local-db.ts'
import { runLocalSql } from '../helpers/local-supabase.ts'
import { MENU, POPOVER, TOAST, clickHighlight, clickMenuButton, dragSelect } from './fixtures/page-actions.ts'
import { expandGroup, openAllSites } from './fixtures/all-sites.ts'
import type { SyncStatus } from '../../src/core/sync/protocol.ts'
import { startOfWeek } from '../../src/ui/format/time.ts'
import { strings } from '../../src/ui/strings.ts'

const HOME = 'https://x.com/home'
const X_TITLE = 'Home / X'
const POST = 'Marginal notes are conversations with the dead, and sometimes they answer.'
const DELETED = 'This post was deleted by its author.'
const NOTE = 'quote this in the essay'

test.setTimeout(120_000)

/** Serves the timeline for every x.com request; `state.deleted` swaps the target post out. */
async function routeTimeline(context: BrowserContext, state: { deleted: boolean }): Promise<void> {
  const template = readFileSync(join(PAGES_DIR, 'timeline.html'), 'utf8')
  // Registered after the fixture's catch-all block, so it takes precedence for x.com.
  await context.route('https://x.com/**', async (route) => {
    if (new URL(route.request().url()).pathname !== '/home') {
      await route.fulfill({ status: 404, body: '' })
      return
    }
    const body = template.replaceAll('TARGET_POST', state.deleted ? DELETED : POST)
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
  })
}

async function openTimeline(page: Page): Promise<void> {
  await page.goto(HOME)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
}

const markOf = (page: Page, id: string) => page.locator(`[data-noteit-id="${id}"]`)
const scrollFeed = (page: Page, top: number) => page.locator('#feed').evaluate((el, y) => (el.scrollTop = y), top)

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, 'x.com')
  await ext.close()
})

test('Key Flow 2: collect from a virtual timeline, find it under this week, original deleted', async ({
  context,
  extensionId,
  serviceWorker,
  openSidePanel,
  externalRequests,
}) => {
  const state = { deleted: false }
  await routeTimeline(context, state)
  const page = await context.newPage()
  await openTimeline(page)

  // Step 2: one click on yellow, no popup or toast interrupts the scrolling.
  const post = page.locator('.row[data-index="3"] p')
  await expect(post).toHaveText(POST)
  await dragSelect(page, post)
  await clickMenuButton(page, 0)
  await expect(page.locator(MENU)).toHaveCount(0)
  await expect(page.locator(POPOVER)).toHaveCount(0)
  await expect(page.locator(TOAST)).toHaveCount(0)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
  const [record] = await liveRecords(serviceWorker)
  expect(record).toMatchObject({ text: POST, color: 'yellow', siteKey: 'x.com', pageTitle: X_TITLE })
  await expect(markOf(page, record.id).first()).toBeVisible()

  // A comment, so the side panel can show it is kept after the post is gone.
  await clickHighlight(page, markOf(page, record.id).first())
  await page.locator(`${POPOVER} textarea`).fill(NOTE)
  await page.locator(`${POPOVER} textarea`).press('ControlOrMeta+Enter')
  await expect(page.locator(POPOVER)).toHaveCount(0)
  await expect.poll(async () => (await liveRecords(serviceWorker))[0]?.comment).toBe(NOTE)

  // Step 3: scrolled out, the row and its highlight leave the DOM; scrolled back, it reappears.
  await scrollFeed(page, 2400)
  await expect(page.locator('.row[data-index="3"]')).toHaveCount(0)
  await expect(markOf(page, record.id)).toHaveCount(0)
  // A reader pauses before scrolling back; the content script re-resolves after its 300ms debounce.
  await page.waitForTimeout(1000)
  await scrollFeed(page, 0)
  await expect(page.locator('.row[data-index="3"]')).toHaveCount(1)
  await expect(markOf(page, record.id).first()).toBeVisible()
  await expect(markOf(page, record.id).first()).toHaveText(POST)
  await expect(page.locator(MENU)).toHaveCount(0)
  await expect(page.locator(POPOVER)).toHaveCount(0)
  // Re-rendering never creates a second record and never marks the highlight lost.
  expect(await liveRecords(serviceWorker)).toHaveLength(1)
  expect(await anchorStatusIds(serviceWorker)).toEqual([])

  // Step 4, "a few days later": the highlight was made on Tuesday of this week and the panel's clock
  // reads Friday noon. createdAt is moved locally and in the cloud after the push settles, so a pull
  // cannot bring the old value back.
  const ext = await openExtensionPage(context, extensionId)
  await expect
    .poll(async () => {
      const r = await extensionRequest<SyncStatus>(ext, 'sync/getStatus', undefined)
      return r.ok ? `${r.data.state}/${r.data.pending}` : 'error'
    })
    .toBe('idle/0')
  await ext.close()
  const monday = new Date(startOfWeek(Date.now()))
  const tuesday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 1, 10).getTime()
  const friday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 4, 12).getTime()
  const stored = (await dumpLocalDb(serviceWorker)).records.find((r) => r.id === record.id)
  if (!stored) throw new Error('record missing')
  await putRecords(serviceWorker, [{ ...stored, createdAt: tuesday }])
  if (!/^[\w-]+$/.test(record.id)) throw new Error('unexpected id')
  runLocalSql(`update public.highlights set created_at = ${tuesday} where id = '${record.id}';`)

  // The post is deleted by its author and the timeline tab is closed.
  state.deleted = true
  await page.close()

  const panel = await context.newPage()
  await panel.clock.setFixedTime(friday)
  await openSidePanel(panel)
  const view = await openAllSites(panel)
  const week = view.locator('[data-testid="date-group"][data-bucket="thisWeek"]')
  await expect(week.getByTestId('date-group-heading')).toHaveText(strings.dateThisWeek)
  await expect(view.getByTestId('date-group-heading')).toHaveText([strings.dateThisWeek])
  // The x.com timeline is one /home page group.
  await expect(week.getByTestId('page-group-title')).toHaveText([X_TITLE])
  const group = await expandGroup(week, X_TITLE)
  const item = group.getByTestId('highlight-item').filter({ hasText: POST })
  await expect(item).toHaveCount(1)
  await expect(item.getByTestId('anchor-lost')).toHaveCount(0)

  // Step 5-6: back on the timeline the post is gone; clicking the item finds nothing on the page, and
  // the item says so but keeps everything. The timeline tab is opened by the test because Playwright
  // routes cannot serve x.com to a tab the service worker creates itself.
  const reopened = await context.newPage()
  await openTimeline(reopened)
  await expect(reopened.locator('.row[data-index="3"] p')).toHaveText(DELETED)
  await item.getByTestId('highlight-text').click()
  await expect(item.getByTestId('anchor-lost')).toHaveText(strings.anchorLost, { timeout: 15_000 })
  await expect(item.getByTestId('highlight-text')).toHaveText(POST)
  await expect(item.getByTestId('highlight-comment')).toHaveText(NOTE)
  expect(await anchorStatusIds(serviceWorker)).toEqual([record.id])
  await expect(markOf(reopened, record.id)).toHaveCount(0)

  expect(externalRequests).toEqual([])
})
