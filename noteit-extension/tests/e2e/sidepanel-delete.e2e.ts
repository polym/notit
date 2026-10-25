// Stories 2.7 / 2.8: a side panel delete reaches the local database through the service worker even
// when the highlight's page is not the active tab.
import { test, expect, signIn } from './fixtures/extension.ts'
import { dumpLocalDb, enableSite, liveRecords, openExtensionPage, resetLocalData } from '../helpers/local-db.ts'
import { clickMenuButton, dragSelect } from './fixtures/page-actions.ts'
import { strings } from '../../src/ui/strings.ts'
import { expandGroup, openAllSites } from './fixtures/all-sites.ts'

test('deleting from the side panel while another tab is active soft-deletes the record', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  await resetLocalData(serviceWorker)
  // Story 2.15 login gate: highlight writes need a session.
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, new URL(url).hostname)
  await ext.close()

  // Page A: create one highlight.
  const pageA = await context.newPage()
  await pageA.goto(url)
  await pageA.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
  await dragSelect(pageA, pageA.locator('#target'))
  await clickMenuButton(pageA, 0)
  await expect(pageA.locator('#target .noteit-highlight').first()).toBeVisible()
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
  const [record] = await liveRecords(serviceWorker)

  // Page B (the side panel tab, no content script) is the active tab.
  const panel = await openSidePanel()
  await panel.bringToFront()
  const view = await openAllSites(panel)
  const group = await expandGroup(view, 'NoteIt smoke article')
  await group.getByTitle(strings.deleteHighlight).first().click()

  await expect
    .poll(async () => (await dumpLocalDb(serviceWorker)).records.find((r) => r.id === record.id)?.deletedAt ?? null)
    .not.toBeNull()
  expect(await liveRecords(serviceWorker)).toEqual([])

  // Reopening page A renders nothing.
  await pageA.close()
  const reopened = await context.newPage()
  await reopened.goto(url)
  await reopened.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
  await reopened.waitForTimeout(500)
  await expect(reopened.locator('.noteit-highlight')).toHaveCount(0)

  expect(externalRequests).toEqual([])
})
