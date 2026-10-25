// Story 2.7: in-page create and edit go through highlight/* messages (legacy UI kept).
import type { Page, Worker } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { SLOW_DELAY_MS } from '../helpers/static-server.ts'
import { dumpLocalDb, enableSite, extensionRequest, liveRecords, openExtensionPage, resetLocalData } from '../helpers/local-db.ts'
import { MENU_COLORS, PREVIEW, clickMenuButton, computedColor, dragSelect, hoverHighlight } from './fixtures/page-actions.ts'
import { colors } from '../../src/ui/tokens/index.ts'

const SITE = '127.0.0.1'

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
  // The host gets data-noteit-site="on" once the content script has read page/getState and enabled itself.
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
}

async function createWithColor(page: Page, serviceWorker: Worker, colorIndex: number): Promise<string> {
  const selected = await dragSelect(page, page.locator('#target'))
  expect(selected.length).toBeGreaterThan(10)
  await clickMenuButton(page, colorIndex)
  await expect(page.locator('#target .noteit-highlight').first()).toBeVisible()
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
  return selected
}

test('a legacy palette color survives a reload and is stored as its Q50 name', async ({
  context,
  serviceWorker,
  server,
  externalRequests,
}) => {
  const page = await context.newPage()
  await openArticle(page, `${server.origin}/article.html`)
  // Third menu dot is blue (DESIGN.md floating-menu order).
  const selected = await createWithColor(page, serviceWorker, 2)

  const [record] = await liveRecords(serviceWorker)
  expect(record).toMatchObject({ text: selected, color: 'blue', comment: null, siteKey: SITE })
  // The record entered the outbox in the same transaction; since Story 2.16 the sync engine may
  // already have pushed it (outbox cleared, server userId filled in).
  const { outbox, records } = await dumpLocalDb(serviceWorker)
  const pushed = records.find((r) => r.id === record.id)?.userId !== ''
  expect(outbox.map((o) => o.id)).toEqual(pushed ? [] : [record.id])

  await page.reload()
  const restored = page.locator('#target .noteit-highlight')
  await expect(restored.first()).toBeVisible()
  await expect.poll(() => restored.allTextContents().then((parts) => parts.join(''))).toBe(selected)
  await expect(restored.first()).toHaveAttribute('data-noteit-id', record.id)
  // Painted from the record's color name, not from a stored CSS value.
  expect(await restored.first().evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    await computedColor(page, colors['highlight-blue']),
  )
  expect(MENU_COLORS[2]).toBe('blue')

  expect(externalRequests).toEqual([])
})

test('editing a comment keeps the color, and the page preview shows the record comment', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  externalRequests,
}) => {
  const page = await context.newPage()
  await openArticle(page, `${server.origin}/article.html`)
  await createWithColor(page, serviceWorker, 1) // second dot: orange
  const [created] = await liveRecords(serviceWorker)
  const mark = page.locator('#target .noteit-highlight').first()

  // The in-page editor arrives with the click popover (Story 3.15); the comment is written by message.
  const ext = await openExtensionPage(context, extensionId)
  const update = (comment: string) =>
    extensionRequest(ext, 'highlight/update', { id: created.id, patch: { comment } })
  expect((await update('first thought')).ok).toBe(true)
  const afterEdit = (await liveRecords(serviceWorker))[0]
  expect(afterEdit).toMatchObject({ comment: 'first thought', color: 'orange' })

  await page.bringToFront()
  await expect(mark).toHaveClass(/noteit-commented/)
  await hoverHighlight(page, mark)
  await expect(page.locator(PREVIEW)).toHaveText('first thought')

  await page.mouse.move(0, 0)
  await expect(page.locator(PREVIEW)).toHaveCount(0)
  expect((await update('first thought and more')).ok).toBe(true)
  const afterSecond = (await liveRecords(serviceWorker))[0]
  expect(afterSecond.color).toBe('orange')
  expect(afterSecond.editedAt).toBeGreaterThan(afterEdit.editedAt)
  await page.bringToFront()
  await hoverHighlight(page, mark)
  await expect(page.locator(PREVIEW)).toHaveText('first thought and more')

  expect(externalRequests).toEqual([])
})

test('a 3 s favicon does not delay the highlight and is never requested by the extension', async ({
  context,
  serviceWorker,
  server,
  externalRequests,
}) => {
  const page = await context.newPage()
  const url = `${server.origin}/slow-favicon.html`
  await openArticle(page, url)

  // Record color mousedown (capture phase, before the extension) -> first mark inserted.
  await page.evaluate(() => {
    const probe = { down: 0, shown: 0 }
    ;(window as unknown as { __probe: typeof probe }).__probe = probe
    window.addEventListener('mousedown', () => {
      if (document.querySelector('noteit-root')?.shadowRoot?.querySelector('[data-noteit-menu]') && probe.down === 0) probe.down = performance.now()
    }, true)
    new MutationObserver(() => {
      if (probe.shown === 0 && document.querySelector('.noteit-highlight')) probe.shown = performance.now()
    }).observe(document.body, { childList: true, subtree: true })
  })
  // The browser may load the tab icon itself at page load; let that settle and snapshot it, so only
  // requests issued while creating the highlight are attributed to the extension.
  const slowEntries = () =>
    page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((e) => (e as PerformanceResourceTiming).name)
        .filter((name) => name.includes('/__slow/')).length,
    )
  await page.waitForTimeout(SLOW_DELAY_MS + 500)
  const hitsBefore = server.slowHits.length
  const entriesBefore = await slowEntries()
  await createWithColor(page, serviceWorker, 0)
  const probe = await page.evaluate(() => (window as unknown as { __probe: { down: number; shown: number } }).__probe)
  expect(probe.down).toBeGreaterThan(0)
  expect(probe.shown - probe.down).toBeLessThanOrEqual(100)

  const [record] = await liveRecords(serviceWorker)
  expect(record.favicon).toBe(`${server.origin}/__slow/favicon.ico`)

  // Wait past the server delay: the extension must not have issued an image/fetch request for it.
  await page.waitForTimeout(SLOW_DELAY_MS + 500)
  expect(await slowEntries()).toBe(entriesBefore)
  expect(server.slowHits.length).toBe(hitsBefore)

  expect(externalRequests).toEqual([])
})

test('a quota error from the handler rolls the optimistic highlight back', async ({
  context,
  serviceWorker,
  server,
  externalRequests,
}) => {
  const page = await context.newPage()
  await openArticle(page, `${server.origin}/article.html`)

  // Every highlights write in the service worker fails like a full disk.
  await serviceWorker.evaluate(() => {
    const original = IDBObjectStore.prototype.put
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'highlights') throw new DOMException('quota exceeded (test)', 'QuotaExceededError')
      return original.apply(this, args)
    }
  })

  await dragSelect(page, page.locator('#target'))
  await clickMenuButton(page, 0)

  const errorLine = page.locator('#noteit-error-line')
  await expect(errorLine).toBeVisible()
  await expect(errorLine).toHaveAttribute('role', 'alert')
  await expect(page.locator('.noteit-highlight')).toHaveCount(0)
  expect((await dumpLocalDb(serviceWorker)).records).toEqual([])

  expect(externalRequests).toEqual([])
})
