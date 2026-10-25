// Story 2.18: pending count, failure reason and manual retry in the side panel (FR37, NFR8).
// Story 3.10: header sync-status (quiet icon / pending label / warning icon), sync-error-popover,
// account-panel and logout-confirm.
// Needs the local Supabase stack (npm run db:start, env:local, build).
import type { Page } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { TEST_USERS } from '../helpers/local-supabase.ts'
import { dumpLocalDb, enableSite, extensionRequest, liveRecords, openExtensionPage, resetLocalData, seedHighlights } from '../helpers/local-db.ts'
import type { CreateHighlightReq } from '../../src/features/highlight/index.ts'
import type { SyncStatus } from '../../src/core/sync/protocol.ts'
import { errorText, strings } from '../../src/ui/strings.ts'

const SITE = '127.0.0.1'
const RPC = '**/rest/v1/rpc/sync_push'
// colors.warning (#B7791F) as computed CSS.
const WARNING_RGB = 'rgb(183, 121, 31)'

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  await ext.close()
})

function createReq(origin: string, text: string): CreateHighlightReq {
  return {
    id: crypto.randomUUID(),
    url: `${origin}/article.html`,
    text,
    color: 'yellow',
    comment: null,
    anchor: null,
    pageTitle: 'NoteIt smoke article',
    favicon: null,
  }
}

async function syncStatus(page: Page, type: 'sync/getStatus' | 'sync/retry'): Promise<SyncStatus> {
  const result = await extensionRequest<SyncStatus>(page, type, undefined)
  if (!result.ok) throw new Error(`${type} failed: ${JSON.stringify(result.error)}`)
  return result.data
}

test('offline edits show the pending count, which drops to zero after a retry online', async ({
  context,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const panel = await openSidePanel()
  // Opening the panel starts a push + pull; let it finish so going offline does not strand a request
  // that is already in flight (the engine has no fetch timeout).
  await expect.poll(async () => (await syncStatus(panel, 'sync/getStatus')).state).toBe('idle')
  await context.setOffline(true)
  try {
    await seedHighlights(panel, ['one', 'two', 'three'].map((t) => createReq(server.origin, t)))
    expect(await liveRecords(serviceWorker)).toHaveLength(3)
    await expect(panel.getByTestId('sync-status')).toContainText(strings.syncPending(3))
    // The debounced push really runs and fails offline; the count stays.
    await expect.poll(async () => (await syncStatus(panel, 'sync/getStatus')).lastError?.code).toBe('network')
    expect((await syncStatus(panel, 'sync/getStatus')).pending).toBe(3)
    await expect(panel.getByTestId('sync-status')).toContainText(strings.syncPending(3))
  } finally {
    await context.setOffline(false)
  }

  const status = await syncStatus(panel, 'sync/retry')
  expect(status).toMatchObject({ state: 'idle', pending: 0 })
  await expect(panel.getByTestId('sync-status')).toHaveAttribute('data-state', 'idle')
  await expect(panel.getByTestId('sync-status-pending')).toHaveCount(0)
  expect((await dumpLocalDb(serviceWorker)).outbox).toHaveLength(0)
  expect(externalRequests).toEqual([])
})

test('three server errors show the reason and a retry button; retry recovers and local edits keep working', async ({
  context,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const panel = await openSidePanel()
  let failures = 0
  await context.route(RPC, async (route) => {
    failures++
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'boom' }) })
  })

  await seedHighlights(panel, [createReq(server.origin, 'first')])
  // Drive consecutive failures with sync/retry until the engine reports error (3 failures).
  let status = await syncStatus(panel, 'sync/getStatus')
  for (let i = 0; i < 3 && status.state !== 'error'; i++) status = await syncStatus(panel, 'sync/retry')
  expect(status).toMatchObject({ state: 'error', lastError: { code: 'server' } })
  expect(failures).toBeGreaterThanOrEqual(3)

  const bar = panel.getByTestId('sync-status')
  await expect(bar).toHaveAttribute('data-state', 'error')
  await expect(panel.getByTestId('sync-status-icon')).toHaveCSS('color', WARNING_RGB)
  await expect(panel.getByTestId('sync-status-pending')).toHaveText(strings.syncPending(1))
  await expect(panel.getByTestId('sync-status-live')).toHaveAttribute('aria-live', 'polite')
  await expect(panel.getByTestId('sync-status-live')).toContainText(strings.syncFailedState)

  // The popover opens on click and closes on Esc and on a click outside.
  const popover = panel.getByTestId('sync-error-popover')
  await expect(popover).toHaveCount(0)
  await bar.click()
  await expect(popover.getByTestId('sync-error-reason')).toHaveText(errorText('server'))
  await panel.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)
  await bar.click()
  await expect(popover).toBeVisible()
  await panel.getByTestId('module-content').click({ position: { x: 5, y: 5 } })
  await expect(popover).toHaveCount(0)

  // Local creation is unaffected while sync is failing.
  await seedHighlights(panel, [createReq(server.origin, 'second')])
  expect(await liveRecords(serviceWorker)).toHaveLength(2)
  await expect(panel.getByTestId('sync-status-pending')).toHaveText(strings.syncPending(2))

  await context.unroute(RPC)
  await bar.click()
  await popover.getByRole('button', { name: strings.syncRetry }).click()
  await expect(popover).toHaveCount(0)
  await expect(bar).toHaveAttribute('data-state', 'idle')
  await expect(panel.getByTestId('sync-status-pending')).toHaveCount(0)
  await expect(panel.getByTestId('sync-status-icon')).not.toHaveCSS('color', WARNING_RGB)
  await expect.poll(async () => (await syncStatus(panel, 'sync/getStatus')).state).toBe('idle')
  expect((await syncStatus(panel, 'sync/getStatus')).pending).toBe(0)
  await expect(bar).toBeFocused()

  // A later failure does not reopen the popover on its own; it needs a fresh click.
  await context.route(RPC, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'boom' }) }),
  )
  await seedHighlights(panel, [createReq(server.origin, 'third')])
  status = await syncStatus(panel, 'sync/getStatus')
  for (let i = 0; i < 3 && status.state !== 'error'; i++) status = await syncStatus(panel, 'sync/retry')
  expect(status.state).toBe('error')
  await expect(bar).toHaveAttribute('data-state', 'error')
  await expect(popover).toHaveCount(0)
  await bar.click()
  await expect(popover).toBeVisible()
  await context.unroute(RPC)
  expect(externalRequests).toEqual([])
})

test('sync failure leaves the toolbar badge alone', async ({ context, serviceWorker, server, openSidePanel, externalRequests }) => {
  const page = await context.newPage()
  await page.goto(`${server.origin}/article.html`)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
  const panel = await openSidePanel()
  await context.route(RPC, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'boom' }) }),
  )
  await seedHighlights(panel, [createReq(server.origin, 'badge')])
  const badge = () =>
    serviceWorker.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url === url)
      return tab?.id === undefined ? null : chrome.action.getBadgeText({ tabId: tab.id })
    }, page.url())
  await page.bringToFront()
  await expect.poll(badge).toBe('1')
  let status = await syncStatus(panel, 'sync/getStatus')
  for (let i = 0; i < 3 && status.state !== 'error'; i++) status = await syncStatus(panel, 'sync/retry')
  expect(status.state).toBe('error')
  await page.waitForTimeout(300)
  expect(await badge()).toBe('1')
  expect(externalRequests).toEqual([])
})

test('account button swaps the content for the account panel and back', async ({ openSidePanel, externalRequests }) => {
  const panel = await openSidePanel()
  const account = panel.getByTestId('account-button')
  await expect(panel.getByTestId('module-tabs')).toBeVisible()

  await account.click()
  const accountPanel = panel.getByTestId('account-panel')
  await expect(accountPanel).toBeVisible()
  await expect(panel.getByTestId('module-tabs')).toBeHidden()
  await expect(panel.getByTestId('module-content')).toBeHidden()
  await expect(accountPanel.getByTestId('account-email')).toHaveText(TEST_USERS.a.email)
  await expect(accountPanel.getByTestId('account-pending')).toHaveText('0')
  await expect(accountPanel.getByTestId('account-last-sync')).not.toHaveText('')
  await expect(accountPanel.getByRole('button', { name: strings.logout })).toBeVisible()

  // Pressing the account button again returns to the module.
  await account.click()
  await expect(accountPanel).toHaveCount(0)
  await expect(panel.getByTestId('module-tabs')).toBeVisible()

  // So does the back button.
  await account.click()
  await accountPanel.getByTestId('account-back').click()
  await expect(accountPanel).toHaveCount(0)
  await expect(panel.getByTestId('module-content')).toBeVisible()
  expect(externalRequests).toEqual([])
})

test('logout-confirm has the scrim and copy; cancel keeps the session', async ({ context, server, openSidePanel, externalRequests }) => {
  await context.route(RPC, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'boom' }) }),
  )
  const panel = await openSidePanel()
  await seedHighlights(panel, [createReq(server.origin, 'a'), createReq(server.origin, 'b')])
  await expect.poll(async () => (await syncStatus(panel, 'sync/getStatus')).pending).toBe(2)

  await panel.getByTestId('account-button').click()
  await panel.getByTestId('account-panel').getByRole('button', { name: strings.logout }).click()
  const dialog = panel.getByRole('alertdialog')
  await expect(dialog).toContainText(strings.logoutConfirm(2))
  await expect(dialog.getByRole('button')).toHaveText([strings.logoutCancel, strings.logout])
  await expect(panel.getByTestId('logout-confirm-scrim')).toHaveCSS('background-color', 'rgba(43, 37, 64, 0.2)')
  await expect(dialog.getByRole('button', { name: strings.logoutCancel })).toBeFocused()

  await panel.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await panel.getByTestId('account-panel').getByRole('button', { name: strings.logout }).click()
  await dialog.getByRole('button', { name: strings.logoutCancel }).click()
  await expect(dialog).toHaveCount(0)
  await expect(panel.getByTestId('account-panel')).toBeVisible()
  expect(externalRequests).toEqual([])
})
