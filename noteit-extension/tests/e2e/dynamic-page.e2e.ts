// Story 4.4: dynamic page observation (FR11, architecture.md D7 "dynamic pages").
// The x.com virtual timeline (tests/e2e/pages/timeline.html served as https://x.com/home, no network):
// rows leave the DOM when scrolled out and come back as fresh nodes (or as the same node). The
// highlight reappears within 1s, and the extension's own paints never trigger a TextIndex rebuild
// (counted through the host's data-noteit-index-builds attribute).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect, PAGES_DIR, signIn } from './fixtures/extension.ts'
import { anchorStatusIds, enableSite, liveRecords, openExtensionPage, resetLocalData } from '../helpers/local-db.ts'
import { clickMenuButton, dragSelect } from './fixtures/page-actions.ts'

const HOME = 'https://x.com/home'
const POST = 'Marginal notes are conversations with the dead, and sometimes they answer.'
const REAPPEAR_MS = 1000

async function routeTimeline(context: BrowserContext): Promise<void> {
  const body = readFileSync(join(PAGES_DIR, 'timeline.html'), 'utf8').replaceAll('TARGET_POST', POST)
  await context.route('https://x.com/**', async (route) => {
    if (new URL(route.request().url()).pathname !== '/home') {
      await route.fulfill({ status: 404, body: '' })
      return
    }
    await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body })
  })
}

const markOf = (page: Page, id: string) => page.locator(`[data-noteit-id="${id}"]`)
const scrollFeed = (page: Page, top: number) => page.locator('#feed').evaluate((el, y) => (el.scrollTop = y), top)
const indexBuilds = (page: Page) =>
  page.locator('noteit-root').evaluate((el) => Number(el.getAttribute('data-noteit-index-builds') ?? '0'))

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, 'x.com')
  await ext.close()
  await routeTimeline(context)
})

/** Opens the timeline and highlights the target post; returns the record id. */
async function highlightPost(page: Page, serviceWorker: Parameters<typeof liveRecords>[0]): Promise<string> {
  await page.goto(HOME)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
  const post = page.locator('.row[data-index="3"] p')
  await expect(post).toHaveText(POST)
  await dragSelect(page, post)
  await clickMenuButton(page, 0)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
  const [record] = await liveRecords(serviceWorker)
  await expect(markOf(page, record.id).first()).toBeVisible()
  return record.id
}

test('virtual list: a row removed and inserted again shows its highlight within 1s', async ({ context, serviceWorker, externalRequests }) => {
  const page = await context.newPage()
  const id = await highlightPost(page, serviceWorker)

  // Fresh nodes: the row is scrolled out (removed) and back in (rebuilt without marks).
  for (let round = 0; round < 3; round++) {
    await scrollFeed(page, 2400)
    await expect(page.locator('.row[data-index="3"]')).toHaveCount(0)
    await expect(markOf(page, id)).toHaveCount(0)
    await page.waitForTimeout(400)
    await scrollFeed(page, 0)
    await expect(page.locator('.row[data-index="3"]')).toHaveCount(1)
    const shownAt = Date.now()
    await expect(markOf(page, id).first()).toBeVisible({ timeout: REAPPEAR_MS })
    expect(Date.now() - shownAt).toBeLessThanOrEqual(REAPPEAR_MS)
    await expect(markOf(page, id).first()).toHaveText(POST)
  }

  // The same node: detached, then inserted again with its mark still inside.
  await page.evaluate(() => {
    const row = document.querySelector('.row[data-index="3"]')!
    const spacer = row.parentNode!
    const next = row.nextSibling
    row.remove()
    setTimeout(() => spacer.insertBefore(row, next), 500)
  })
  await expect(markOf(page, id)).toHaveCount(0)
  await expect(markOf(page, id).first()).toBeVisible({ timeout: REAPPEAR_MS + 500 })

  expect(await liveRecords(serviceWorker)).toHaveLength(1)
  // Lost rule (Story 2.11) is untouched: a highlight that keeps coming back is never reported lost.
  await page.waitForTimeout(3500)
  expect(await anchorStatusIds(serviceWorker)).toEqual([])
  expect(externalRequests).toEqual([])
})

test('own paints do not trigger a TextIndex rebuild (count)', async ({ context, serviceWorker }) => {
  const page = await context.newPage()
  const id = await highlightPost(page, serviceWorker)
  // Let the first restore pass and any debounce settle.
  await page.waitForTimeout(800)
  const before = await indexBuilds(page)

  // Creating, recoloring and repainting highlights only produce the renderer's own mutations.
  const second = page.locator('.row[data-index="1"] p')
  await dragSelect(page, second)
  await clickMenuButton(page, 1)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(2)
  await page.waitForTimeout(800)
  expect(await indexBuilds(page)).toBe(before)

  // A foreign change that removes a painted row does rebuild once it is back.
  await scrollFeed(page, 2400)
  await page.waitForTimeout(400)
  await scrollFeed(page, 0)
  await expect(markOf(page, id).first()).toBeVisible({ timeout: REAPPEAR_MS })
  await expect.poll(() => indexBuilds(page)).toBeGreaterThan(before)
})
