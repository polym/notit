// Smoke test for the legacy UI on top of the local database (Story 2.7):
// select text -> create a highlight with the floating menu -> reload -> highlight is still rendered.
import { test, expect, signIn } from './fixtures/extension.ts'
import { controlServiceWorker } from '../helpers/sw-restart.ts'
import { enableSite, liveRecords, openExtensionPage, resetLocalData } from '../helpers/local-db.ts'
import { clickMenuButton, dragSelect } from './fixtures/page-actions.ts'

test('selected text highlighted from the floating menu survives a reload', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`

  // The extension is off per site by default; enable it the way the site toggle does.
  await resetLocalData(serviceWorker)
  // Story 2.15 login gate: highlight writes need a session.
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, new URL(url).hostname)

  const page = await context.newPage()
  await page.goto(url)
  const target = page.locator('#target')
  await expect(target).toHaveText('Highlights must survive a page reload.')

  const selected = await dragSelect(page, target)
  expect(selected.length).toBeGreaterThan(10)
  await clickMenuButton(page, 0)

  const highlight = page.locator('#target .noteit-highlight')
  await expect(highlight.first()).toBeVisible()
  await expect.poll(() => highlight.allTextContents().then((parts) => parts.join(''))).toBe(selected)

  // Wait until the highlight is persisted before reloading.
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)

  await page.reload()
  const restored = page.locator('#target .noteit-highlight')
  await expect(restored.first()).toBeVisible()
  await expect.poll(() => restored.allTextContents().then((parts) => parts.join(''))).toBe(selected)

  expect(externalRequests).toEqual([])
})

test('service worker restarts on a message after being terminated', async ({
  context,
  extensionId,
  serviceWorker,
  openSidePanel,
  externalRequests,
}) => {
  expect(serviceWorker.url()).toContain(extensionId)
  const panel = await openSidePanel()
  const sw = await controlServiceWorker(context, extensionId, panel)
  try {
    expect(sw.status()).toBe('running')

    await sw.stop()
    expect(sw.status()).toBe('stopped')

    // The PING reply comes from the restarted worker's onMessage handler.
    expect(await sw.wake()).toEqual({ ok: true })
    expect(sw.status()).toBe('running')
  } finally {
    await sw.dispose()
  }

  expect(externalRequests).toEqual([])
})
