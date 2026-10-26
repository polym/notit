// Story 2.17: rows written by another device are pulled and merged without echo (FR33-FR36).
// "Device B" is a test-side Supabase client signed in to the same account that writes through
// sync_push. Needs the local Supabase stack (npm run db:start, env:local, build).
import type { Page, Worker } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { test, expect, signIn } from './fixtures/extension.ts'
import { clickMenuButton, dragSelect } from './fixtures/page-actions.ts'
import { dumpLocalDb, enableSite, extensionRequest, liveRecords, openExtensionPage, resetLocalData } from '../helpers/local-db.ts'
import { getLocalSupabaseEnv, TEST_USERS } from '../helpers/local-supabase.ts'
import { toPushRow } from '../../src/core/sync/mapping.ts'
import type { HighlightRecord } from '../../src/core/model/index.ts'
import { strings } from '../../src/ui/strings.ts'

const SITE = '127.0.0.1'
const RPC = '**/rest/v1/rpc/sync_push'

let deviceB: SupabaseClient

test.beforeAll(async () => {
  const env = getLocalSupabaseEnv()
  deviceB = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { error } = await deviceB.auth.signInWithPassword(TEST_USERS.a)
  if (error) throw new Error('test-side sign-in failed', { cause: error })
})

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  await ext.close()
})

async function pushAsDeviceB(record: HighlightRecord): Promise<void> {
  const { error } = await deviceB.rpc('sync_push', { rows: [toPushRow(record)] })
  if (error) throw new Error(`sync_push failed: ${error.message}`)
}

async function cloudDeletedAt(id: string): Promise<number | null> {
  const { data, error } = await deviceB.from('highlights').select('deleted_at').eq('id', id).single()
  if (error) throw new Error(`select failed: ${error.message}`)
  return data.deleted_at === null ? null : Number(data.deleted_at)
}

async function createOnArticle(page: Page, serviceWorker: Worker, url: string): Promise<HighlightRecord> {
  await page.goto(url)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
  await dragSelect(page, page.locator('#target'))
  await clickMenuButton(page, 0)
  await expect(page.locator('#target .noteit-highlight').first()).toBeVisible()
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
  return (await liveRecords(serviceWorker))[0]
}

test('pull only: a row from another device appears locally with an empty outbox', async ({
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const id = crypto.randomUUID()
  const now = Date.now()
  await pushAsDeviceB({
    id,
    userId: '',
    canonicalUrl: url,
    siteKey: SITE,
    url,
    text: 'Highlights must survive',
    color: 'green',
    comment: null,
    anchor: null,
    pageTitle: 'NoteIt smoke article',
    favicon: null,
    createdAt: now,
    editedAt: now,
    deviceId: 'device-b',
    deletedAt: null,
    schemaVersion: 1,
  })

  // Opening the side panel sends sidebar/opened: push, then pull.
  const panel = await openSidePanel()
  await expect.poll(async () => (await liveRecords(serviceWorker)).map((r) => r.id)).toEqual([id])
  await panel.getByRole('button', { name: strings.viewAllSites }).click()
  await expect(panel.getByTestId('all-sites-view').getByText('NoteIt smoke article').first()).toBeVisible()

  // No echo (FR36, #2): the pulled row never entered the outbox and nothing is pending.
  const dump = await dumpLocalDb(serviceWorker)
  expect(dump.outbox).toHaveLength(0)
  const status = await extensionRequest<{ pending: number }>(panel, 'sync/getStatus', undefined)
  expect(status).toMatchObject({ ok: true, data: { pending: 0 } })
  expect(externalRequests).toEqual([])
})

test('a delete on device B removes the highlight on A; the older live snapshot on A does not revive it', async ({
  context,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  // A's create stays in the outbox (older live snapshot) until B has deleted the row.
  await context.route(RPC, (route) => route.abort('internetdisconnected'))
  const page = await context.newPage()
  const mine = await createOnArticle(page, serviceWorker, url)
  expect((await dumpLocalDb(serviceWorker)).outbox.map((o) => o.id)).toEqual([mine.id])

  const deletedAt = mine.editedAt + 60_000
  await pushAsDeviceB({ ...mine, editedAt: deletedAt, deletedAt, deviceId: 'device-b' })
  await context.unroute(RPC)

  // Pull (push first): the server rejects A's older version and returns the delete.
  const panel = await openSidePanel()
  await expect
    .poll(async () => (await dumpLocalDb(serviceWorker)).records.find((r) => r.id === mine.id)?.deletedAt ?? null)
    .toBe(deletedAt)
  await expect(page.locator('#target .noteit-highlight')).toHaveCount(0)
  expect((await dumpLocalDb(serviceWorker)).outbox).toHaveLength(0)
  await panel.getByRole('button', { name: strings.viewAllSites }).click()
  await expect(panel.getByTestId('empty-all-sites')).toBeVisible()
  await expect(panel.getByTestId('all-sites-view').getByText('NoteIt smoke article')).toHaveCount(0)

  // Another push/pull round keeps it deleted, locally and in the cloud.
  await panel.reload()
  await page.waitForTimeout(1_000)
  expect(await liveRecords(serviceWorker)).toEqual([])
  expect(await cloudDeletedAt(mine.id)).toBe(deletedAt)
  expect(externalRequests).toEqual([])
})
