// Story 3.17: EXPERIENCE.md Key Flow 3 (weekend review) end to end on the built extension.
// All-sites view by date and page (only the newest page expanded), delete with "deleted · undo",
// undo puts the item back in place, comment and "key point" edits straight from the side panel,
// offline edits counted as pending and uploaded once the network is back (account panel: pending 0,
// last sync refreshed, rows in the cloud). Failure paths: a failing sync turns the header warning,
// shows the reason and retries by hand; signing out with pending items is stopped by logout-confirm.
// Needs the local Supabase stack (npm run db:start, env:local, build).
import type { Locator, Page } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { dumpLocalDb, extensionRequest, openExtensionPage, resetLocalData, seedHighlights } from '../helpers/local-db.ts'
import { runLocalSql } from '../helpers/local-supabase.ts'
import { expandGroup, openAllSites, pageGroup } from './fixtures/all-sites.ts'
import type { SyncStatus } from '../../src/core/sync/protocol.ts'
import type { CreateHighlightReq } from '../../src/features/highlight/index.ts'
import { errorText, strings } from '../../src/ui/strings.ts'

const RPC = '**/rest/v1/rpc/sync_push'
// colors.warning (#B7791F) as computed CSS.
const WARNING_RGB = 'rgb(183, 121, 31)'
// Offline uploads wait for the push alarm (30s backoff) once the network is back.
const RECOVERY_MS = 90_000
const ARTICLE = 'NoteIt smoke article'

test.setTimeout(240_000)

function req(origin: string, path: string, pageTitle: string, text: string): CreateHighlightReq {
  return { id: crypto.randomUUID(), url: `${origin}/${path}`, text, color: 'yellow', comment: null, anchor: null, pageTitle, favicon: null }
}

async function syncStatus(page: Page, type: 'sync/getStatus' | 'sync/retry' = 'sync/getStatus'): Promise<SyncStatus> {
  const result = await extensionRequest<SyncStatus>(page, type, undefined)
  if (!result.ok) throw new Error(`${type} failed: ${JSON.stringify(result.error)}`)
  return result.data
}

async function settle(panel: Page): Promise<void> {
  await expect.poll(async () => {
    const s = await syncStatus(panel)
    return `${s.state}/${s.pending}`
  }, { timeout: 20_000 }).toBe('idle/0')
}

/** Writes a comment through the item's hover actions (Cmd/Ctrl+Enter saves). */
async function comment(item: Locator, text: string): Promise<void> {
  await item.hover()
  // "Add comment" on a plain item, "edit comment" once it has one.
  const actions = item.getByTestId('item-actions')
  await actions
    .getByRole('button', { name: strings.commentAdd, exact: true })
    .or(actions.getByRole('button', { name: strings.commentEdit, exact: true }))
    .click()
  const editor = item.getByTestId('comment-editor')
  await editor.fill(text)
  await editor.press('ControlOrMeta+Enter')
  await expect(item.getByTestId('highlight-comment')).toHaveText(text)
}

/** color, comment and deleted flag of cloud rows (superuser read of the local stack). */
function cloudRows(ids: string[]): Map<string, string> {
  for (const id of ids) if (!/^[\w-]+$/.test(id)) throw new Error('unexpected id')
  const out = runLocalSql(
    `select id, color, coalesce(comment, ''), deleted_at is not null from public.highlights where id in (${ids.map((i) => `'${i}'`).join(', ')});`,
  )
  const rows = new Map<string, string>()
  for (const line of out.trim().split('\n').filter(Boolean)) {
    const [id, ...rest] = line.split('|')
    rows.set(id, rest.join('|'))
  }
  return rows
}

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await signIn(context, extensionId)
})

test('Key Flow 3: review all sites, delete and undo, edit in the panel, offline edits sync back', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const o = server.origin
  const article = [
    req(o, 'article.html', ARTICLE, 'The quick brown fox jumps over the lazy dog.'),
    req(o, 'article.html', ARTICLE, 'Highlights must survive a page reload.'),
    req(o, 'article.html', ARTICLE, 'This paragraph exists so the target is not the last block.'),
  ]
  const older = req(o, 'notes.html', 'Reading notes', 'An older page with one highlight.')
  const newest = req(o, 'essay.html', 'Weekend essay', 'The newest page of the week.')
  const ext = await openExtensionPage(context, extensionId)
  await seedHighlights(ext, article)
  await seedHighlights(ext, [older])
  await seedHighlights(ext, [newest])
  await ext.close()

  const panel = await openSidePanel()
  await settle(panel)

  // Step 1: grouped by date, then by page; only the newest page starts expanded.
  const view = await openAllSites(panel)
  await expect(view.getByTestId('date-group-heading')).toHaveText([strings.dateToday])
  await expect(view.getByTestId('page-group-title')).toHaveText(['Weekend essay', 'Reading notes', ARTICLE])
  await expect(pageGroup(view, 'Weekend essay').getByTestId('page-group-header')).toHaveAttribute('aria-expanded', 'true')
  await expect(pageGroup(view, 'Reading notes').getByTestId('page-group-header')).toHaveAttribute('aria-expanded', 'false')
  await expect(pageGroup(view, ARTICLE).getByTestId('page-group-header')).toHaveAttribute('aria-expanded', 'false')

  // Step 2-3: delete shows "deleted · undo"; undo within 5s puts the item back in place.
  const group = await expandGroup(view, ARTICLE)
  const items = group.getByTestId('highlight-item')
  await expect(items).toHaveCount(3)
  const middle = items.nth(1)
  await expect(middle).toContainText('survive a page reload')
  await middle.hover()
  await middle.getByRole('button', { name: strings.deleteHighlight }).click()
  await expect(items).toHaveCount(2)
  const toast = panel.getByTestId('undo-toast')
  await expect(toast).toContainText(strings.deleted)
  await toast.getByRole('button', { name: strings.undo }).click()
  await expect(toast).toHaveCount(0)
  await expect(items).toHaveCount(3)
  await expect(items.nth(1)).toContainText('survive a page reload')
  // A delete that is not undone stays deleted once the toast is gone.
  await items.nth(2).hover()
  await items.nth(2).getByRole('button', { name: strings.deleteHighlight }).click()
  await expect(toast).toBeVisible()
  await expect(toast).toHaveCount(0, { timeout: 7000 })
  await expect(items).toHaveCount(2)

  // Step 4: comment straight in the panel and change one item from "highlight" to "key point".
  await comment(items.nth(0), 'Classic pangram.')
  await items.nth(1).hover()
  await items.nth(1).getByTestId('item-actions').getByRole('button', { name: strings.colorOrange }).click()
  await expect(items.nth(1).getByRole('img', { name: strings.colorOrange })).toHaveCount(1)
  await settle(panel)

  // Step 5: offline, edits still apply and the header counts them as pending.
  await panel.getByTestId('account-button').click()
  const lastSyncBefore = await panel.getByTestId('account-last-sync').textContent()
  await panel.getByTestId('account-button').click()
  await context.setOffline(true)
  try {
    await comment(items.nth(1), 'Worth rereading offline.')
    await expect.poll(async () => (await syncStatus(panel)).pending).toBeGreaterThan(0)
    const pending = (await syncStatus(panel)).pending
    await expect(panel.getByTestId('sync-status-pending')).toHaveText(strings.syncPending(pending))
    await expect.poll(async () => (await syncStatus(panel)).lastError?.code).toBe('network')
  } finally {
    await context.setOffline(false)
  }

  // Step 6: back online the upload happens on its own; the account panel shows pending 0 and a
  // fresh last sync time.
  await expect.poll(async () => (await syncStatus(panel)).pending, { timeout: RECOVERY_MS }).toBe(0)
  await expect(panel.getByTestId('sync-status-pending')).toHaveCount(0)
  await panel.getByTestId('account-button').click()
  await expect(panel.getByTestId('account-pending')).toHaveText('0')
  await expect(panel.getByTestId('account-last-sync')).not.toHaveText(lastSyncBefore ?? '')
  await panel.getByTestId('account-back').click()

  // Step 7: the undone delete, the real delete and every offline edit are in the cloud.
  const local = (await dumpLocalDb(serviceWorker)).records
  const deleted = local.filter((r) => r.deletedAt !== null).map((r) => r.id)
  expect(deleted).toEqual([article[2].id])
  const cloud = cloudRows(article.map((r) => r.id))
  expect(cloud.get(article[0].id)).toBe('yellow|Classic pangram.|f')
  expect(cloud.get(article[1].id)).toBe('orange|Worth rereading offline.|f')
  expect(cloud.get(article[2].id)).toBe('yellow||t')

  // Failure path: sync keeps failing; the header turns warning, shows the reason and retries by hand.
  await context.route(RPC, (route) => route.abort('internetdisconnected'))
  try {
    await comment(items.nth(0), 'Edited while sync fails.')
    let status = await syncStatus(panel)
    for (let i = 0; i < 3 && status.state !== 'error'; i++) status = await syncStatus(panel, 'sync/retry')
    expect(status).toMatchObject({ state: 'error', lastError: { code: 'network' } })
    const bar = panel.getByTestId('sync-status')
    await expect(bar).toHaveAttribute('data-state', 'error')
    await expect(panel.getByTestId('sync-status-icon')).toHaveCSS('color', WARNING_RGB)
    await bar.click()
    const popover = panel.getByTestId('sync-error-popover')
    await expect(popover.getByTestId('sync-error-reason')).toHaveText(errorText('network'))
    await panel.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
    // Local edits are kept while sync fails.
    expect((await dumpLocalDb(serviceWorker)).records.find((r) => r.id === article[0].id)?.comment).toBe('Edited while sync fails.')

    // Failure path: signing out with pending items is stopped; cancel keeps the session.
    await panel.getByTestId('account-button').click()
    await panel.getByTestId('account-panel').getByRole('button', { name: strings.logout }).click()
    const dialog = panel.getByRole('alertdialog')
    await expect(dialog).toContainText(strings.logoutConfirm(status.pending))
    await dialog.getByRole('button', { name: strings.logoutCancel }).click()
    await expect(dialog).toHaveCount(0)
    await expect(panel.getByTestId('account-panel')).toBeVisible()
    await expect(panel.getByTestId('account-email')).not.toHaveText('')
    await panel.getByTestId('account-back').click()
  } finally {
    await context.unroute(RPC)
  }
  // Manual retry once the network is back: pending returns to 0.
  const bar = panel.getByTestId('sync-status')
  await bar.click()
  await panel.getByTestId('sync-error-popover').getByRole('button', { name: strings.syncRetry }).click()
  await expect(bar).toHaveAttribute('data-state', 'idle')
  await expect.poll(async () => (await syncStatus(panel)).pending).toBe(0)
  expect(cloudRows([article[0].id]).get(article[0].id)).toBe('yellow|Edited while sync fails.|f')

  expect(externalRequests).toEqual([])
})
