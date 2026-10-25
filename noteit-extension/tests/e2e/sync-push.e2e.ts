// Story 2.16: local edits reach the cloud without the side panel (NFR7: within 10s) and survive a
// service worker termination (the outbox is pushed when the worker wakes again). Needs the local
// Supabase stack (npm run db:start, env:local, build).
import type { Page, Worker } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { test, expect, signIn } from './fixtures/extension.ts'
import { dragSelect, clickMenuButton } from './fixtures/page-actions.ts'
import { dumpLocalDb, enableSite, liveRecords, openExtensionPage, resetLocalData } from '../helpers/local-db.ts'
import { getLocalSupabaseEnv, TEST_USERS } from '../helpers/local-supabase.ts'
import { controlServiceWorker } from '../helpers/sw-restart.ts'

const SITE = '127.0.0.1'
const NFR7_MS = 10_000

let cloud: SupabaseClient

test.beforeAll(async () => {
  const env = getLocalSupabaseEnv()
  cloud = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { error } = await cloud.auth.signInWithPassword(TEST_USERS.a)
  if (error) throw new Error('test-side sign-in failed', { cause: error })
})

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  // The side panel stays closed for the rest of each test.
  await ext.close()
})

async function cloudHas(id: string): Promise<boolean> {
  const { data, error } = await cloud.from('highlights').select('id').eq('id', id)
  if (error) throw new Error(`select failed: ${error.message}`)
  return data.length === 1
}

async function createOnArticle(page: Page, serviceWorker: Worker, url: string): Promise<string> {
  await page.goto(url)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
  await dragSelect(page, page.locator('#target'))
  await clickMenuButton(page, 0)
  await expect(page.locator('#target .noteit-highlight').first()).toBeVisible()
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
  return (await liveRecords(serviceWorker))[0].id
}

test('a highlight created with the side panel closed is in the cloud within 10s', async ({
  context,
  serviceWorker,
  server,
  externalRequests,
}) => {
  const page = await context.newPage()
  const id = await createOnArticle(page, serviceWorker, `${server.origin}/article.html`)
  const created = Date.now()
  await expect.poll(() => cloudHas(id), { timeout: NFR7_MS, intervals: [250] }).toBe(true)
  expect(Date.now() - created).toBeLessThan(NFR7_MS)
  // No side panel page was open while the push happened.
  expect(context.pages().some((p) => p.url().includes('/sidepanel/'))).toBe(false)
  // The outbox drains once the push is reconciled.
  await expect.poll(async () => (await dumpLocalDb(serviceWorker)).outbox.length).toBe(0)
  expect(externalRequests).toEqual([])
})

test('the outbox is pushed after the service worker is terminated right after a create', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  externalRequests,
}) => {
  // Hold back every push until the worker has been terminated, so only the outbox survives.
  const RPC = '**/rest/v1/rpc/sync_push'
  await context.route(RPC, (route) => route.abort('internetdisconnected'))
  const page = await context.newPage()
  const id = await createOnArticle(page, serviceWorker, `${server.origin}/article.html`)

  const ext = await openExtensionPage(context, extensionId)
  const sw = await controlServiceWorker(context, extensionId, ext)
  try {
    await sw.stop()
    expect(sw.status()).toBe('stopped')
    expect(await cloudHas(id)).toBe(false)
    await context.unroute(RPC)
    await sw.wake()
  } finally {
    await sw.dispose()
  }

  // The restarted worker finds the pending outbox item on start and pushes it.
  await expect.poll(() => cloudHas(id), { timeout: NFR7_MS, intervals: [250] }).toBe(true)
  expect(externalRequests).toEqual([])
})
