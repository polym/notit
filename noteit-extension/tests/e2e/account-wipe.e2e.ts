// Story 2.19 (account-panel since Story 3.10): sign-out wipe (FR29, NFR17) and first sign-in wipe (FR39).
// Needs the local Supabase stack (npm run db:start, env:local, build).
import type { Page, Worker } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { test, expect, signIn, signInFromPage } from './fixtures/extension.ts'
import { clickMenuButton, dragSelect } from './fixtures/page-actions.ts'
import { enableSite, extensionRequest, openExtensionPage, resetLocalData, seedHighlights } from '../helpers/local-db.ts'
import { clearCloudRows, getLocalSupabaseEnv, TEST_USERS } from '../helpers/local-supabase.ts'
import { toPushRow } from '../../src/core/sync/mapping.ts'
import type { CreateHighlightReq } from '../../src/features/highlight/index.ts'
import { strings } from '../../src/ui/strings.ts'

const SITE = '127.0.0.1'
const RPC = '**/rest/v1/rpc/sync_push'
const STORES = ['highlights', 'outbox', 'anchorStatus', 'meta', 'logs'] as const

type RawDb = Record<(typeof STORES)[number], unknown[]>

/** Every row of every Dexie table, read with raw IndexedDB in the service worker. */
async function rawDb(serviceWorker: Worker): Promise<RawDb> {
  return serviceWorker.evaluate(async (stores) => {
    return new Promise<Record<string, unknown[]>>((resolve, reject) => {
      const open = indexedDB.open('noteit')
      open.onupgradeneeded = () => open.transaction?.abort()
      open.onerror = () => (open.error?.name === 'AbortError' ? resolve(Object.fromEntries(stores.map((s) => [s, []]))) : reject(open.error))
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction([...stores], 'readonly')
        const reqs = stores.map((s) => [s, tx.objectStore(s).getAll()] as const)
        tx.oncomplete = () => {
          db.close()
          resolve(Object.fromEntries(reqs.map(([s, r]) => [s, r.result as unknown[]])))
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  }, [...STORES]) as Promise<RawDb>
}

/** Writes rows into one store with raw IndexedDB (the database must exist). */
async function rawPut(serviceWorker: Worker, store: string, rows: unknown[]): Promise<void> {
  await serviceWorker.evaluate(
    async ({ store, rows }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('noteit')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction(store, 'readwrite')
          for (const row of rows) tx.objectStore(store).put(row)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
    },
    { store, rows },
  )
}

async function storageLocal(serviceWorker: Worker): Promise<Record<string, unknown>> {
  return serviceWorker.evaluate(() => chrome.storage.local.get(null))
}

function createReq(origin: string, text: string, comment: string): CreateHighlightReq {
  return {
    id: crypto.randomUUID(),
    url: `${origin}/article.html?wipe-marker=1`,
    text,
    color: 'yellow',
    comment,
    anchor: null,
    pageTitle: 'NoteIt smoke article',
    favicon: null,
  }
}

async function pending(page: Page): Promise<number> {
  const result = await extensionRequest<{ pending: number }>(page, 'auth/getPendingCount', undefined)
  if (!result.ok) throw new Error(`auth/getPendingCount failed: ${JSON.stringify(result.error)}`)
  return result.data.pending
}

/** Makes the stored session unusable: expired access token and an invalid refresh token. */
async function breakSession(serviceWorker: Worker): Promise<void> {
  await serviceWorker.evaluate(async () => {
    const raw = (await chrome.storage.local.get('sb-auth'))['sb-auth']
    if (typeof raw !== 'string') throw new Error('no stored session')
    const session = JSON.parse(raw) as Record<string, unknown>
    await chrome.storage.local.set({ 'sb-auth': JSON.stringify({ ...session, expires_at: 1, refresh_token: 'invalid-refresh-token' }) })
  })
}

async function signedIn(page: Page): Promise<boolean> {
  const result = await extensionRequest<{ signedIn: boolean }>(page, 'auth/getState', undefined)
  return result.ok && result.data.signedIn
}

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  clearCloudRows(TEST_USERS.b.email)
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  await ext.close()
})

test('sign-out with pending items asks first; confirming wipes everything but deviceId', async ({
  context,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  // Keep the items pending: every push fails with a server error.
  await context.route(RPC, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'boom' }) }),
  )
  const page = await context.newPage()
  await page.goto(`${server.origin}/article.html`)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
  await dragSelect(page, page.locator('#target'))
  await clickMenuButton(page, 0)
  await expect(page.locator('#target .noteit-highlight').first()).toBeVisible()

  const panel = await openSidePanel()
  await seedHighlights(panel, [createReq(server.origin, 'zebra-marker-text', 'zebra-marker-comment')])
  await expect.poll(() => pending(panel)).toBe(2)
  const deviceId = (await storageLocal(serviceWorker)).deviceId
  expect(typeof deviceId).toBe('string')

  await panel.getByTestId('account-button').click()
  const account = panel.getByTestId('account-panel')
  await expect(account.getByTestId('account-email')).toHaveText(TEST_USERS.a.email)
  await expect(account.getByTestId('account-pending')).toHaveText('2')

  // Cancel keeps everything.
  await account.getByRole('button', { name: strings.logout }).click()
  const dialog = panel.getByRole('alertdialog')
  await expect(dialog).toHaveText(new RegExp(strings.logoutConfirm(2).replace(/[?\uFF1F]/g, '.')))
  await dialog.getByRole('button', { name: strings.logoutCancel }).click()
  await expect(dialog).toHaveCount(0)
  expect(await signedIn(panel)).toBe(true)
  expect(await pending(panel)).toBe(2)
  expect((await rawDb(serviceWorker)).highlights).toHaveLength(2)

  // Confirm signs out and wipes.
  await account.getByRole('button', { name: strings.logout }).click()
  await panel.getByRole('alertdialog').getByRole('button', { name: strings.logout }).click()
  await expect(panel.getByRole('button', { name: strings.loginSubmit, exact: true })).toBeVisible()
  expect(await signedIn(panel)).toBe(false)

  await expect.poll(async () => Object.values(await rawDb(serviceWorker)).map((rows) => rows.length)).toEqual([0, 0, 0, 0, 0])
  const local = await storageLocal(serviceWorker)
  expect(local).toEqual({ deviceId })

  // Every tab's renders are gone and the badge is empty.
  await expect(page.locator('.noteit-highlight')).toHaveCount(0)
  const tabId = await serviceWorker.evaluate(async (url) => (await chrome.tabs.query({})).find((t) => t.url === url)?.id, page.url())
  expect(tabId).toBeDefined()
  await expect.poll(() => serviceWorker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId as number)).toBe('')

  // NFR17: no trace of the seeded text, comment or URL in Dexie or chrome.storage.local.
  await page.waitForTimeout(500)
  const haystack = JSON.stringify([await rawDb(serviceWorker), await storageLocal(serviceWorker)])
  for (const needle of ['zebra-marker-text', 'zebra-marker-comment', 'wipe-marker', 'article.html']) {
    expect(haystack).not.toContain(needle)
  }
  expect(externalRequests).toEqual([])
})

test('sign-out without pending items signs out at once', async ({ serviceWorker, openSidePanel, externalRequests }) => {
  const panel = await openSidePanel()
  expect(await pending(panel)).toBe(0)
  await panel.getByTestId('account-button').click()
  await panel.getByTestId('account-panel').getByRole('button', { name: strings.logout }).click()
  await expect(panel.getByRole('button', { name: strings.loginSubmit, exact: true })).toBeVisible()
  await expect(panel.getByRole('alertdialog')).toHaveCount(0)
  await expect.poll(async () => (await rawDb(serviceWorker)).meta).toEqual([])
  expect(externalRequests).toEqual([])
})

test('first sign-in removes legacy keys, starts the cursor at 0 and keeps only the account cloud rows', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  externalRequests,
}) => {
  // Back to a pre-M1 install: signed out (resetLocalData also clears account A's cloud rows).
  await resetLocalData(serviceWorker)

  // A row of account A written by another device.
  const env = getLocalSupabaseEnv()
  const deviceB = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const { error } = await deviceB.auth.signInWithPassword(TEST_USERS.a)
  if (error) throw new Error('test-side sign-in failed', { cause: error })
  const cloudId = crypto.randomUUID()
  const url = `${server.origin}/article.html`
  const now = Date.now()
  const push = await deviceB.rpc('sync_push', {
    rows: [
      toPushRow({
        id: cloudId,
        userId: '',
        canonicalUrl: url,
        siteKey: SITE,
        url,
        text: 'cloud row',
        color: 'blue',
        comment: null,
        anchor: null,
        pageTitle: null,
        favicon: null,
        createdAt: now,
        editedAt: now,
        deviceId: 'device-b',
        deletedAt: null,
        schemaVersion: 1,
      }),
    ],
  })
  if (push.error) throw new Error(`sync_push failed: ${push.error.message}`)

  // Legacy keys, a stale local row and a cursor past the cloud row.
  const ext = await openExtensionPage(context, extensionId)
  await extensionRequest(ext, 'page/getState', { url: 'http://127.0.0.1/' })
  await serviceWorker.evaluate(() =>
    chrome.storage.local.set({ highlights: [{ text: 'legacy' }], enabledSites: ['127.0.0.1'] }),
  )
  const stale = { id: crypto.randomUUID(), userId: '', canonicalUrl: url, siteKey: SITE, url, text: 'stale local', color: 'yellow', comment: null, anchor: null, pageTitle: null, favicon: null, createdAt: 1, editedAt: 1, deviceId: 'x', deletedAt: null, schemaVersion: 1 }
  await rawPut(serviceWorker, 'highlights', [stale])
  await rawPut(serviceWorker, 'meta', [{ key: 'pullCursor', value: Number.MAX_SAFE_INTEGER }])

  expect(await signInFromPage(ext)).toBe(true)
  const local = await storageLocal(serviceWorker)
  expect(local).not.toHaveProperty('highlights')
  expect(local).not.toHaveProperty('enabledSites')
  // The cursor restarted from 0, so the full pull brings exactly the account's cloud row.
  await expect.poll(async () => (await rawDb(serviceWorker)).highlights.map((r) => (r as { id: string }).id)).toEqual([cloudId])
  const meta = (await rawDb(serviceWorker)).meta as Array<{ key: string; value: unknown }>
  expect(meta.find((m) => m.key === 'userId')?.value).toEqual(expect.any(String))
  expect(meta.find((m) => m.key === 'pullCursor')?.value).toEqual(expect.any(Number))
  expect(meta.find((m) => m.key === 'pullCursor')?.value).not.toBe(Number.MAX_SAFE_INTEGER)
  await ext.close()
  expect(externalRequests).toEqual([])
})

test('refresh failure keeps data for the same account; another account triggers the first sign-in wipe', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  externalRequests,
}) => {
  await context.route(RPC, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'boom' }) }),
  )
  const ext = await openExtensionPage(context, extensionId)
  await seedHighlights(ext, [createReq(server.origin, 'kept text', 'kept comment')])
  await expect.poll(() => pending(ext)).toBe(1)
  const userA = ((await rawDb(serviceWorker)).meta as Array<{ key: string; value: unknown }>).find((m) => m.key === 'userId')?.value
  expect(userA).toEqual(expect.any(String))

  // Refresh token rejected: signed out, local data untouched.
  await breakSession(serviceWorker)
  await expect.poll(async () => (await extensionRequest(ext, 'sync/retry', undefined)).ok && !(await signedIn(ext))).toBe(true)
  expect((await rawDb(serviceWorker)).highlights).toHaveLength(1)
  expect(await pending(ext)).toBe(1)

  // Same account: data and outbox stay and the push continues.
  await context.unroute(RPC)
  expect(await signInFromPage(ext, TEST_USERS.a)).toBe(true)
  expect((await rawDb(serviceWorker)).highlights).toHaveLength(1)
  await expect.poll(() => pending(ext)).toBe(0)
  expect((await rawDb(serviceWorker)).highlights).toHaveLength(1)

  // Another account: first sign-in wipe.
  await breakSession(serviceWorker)
  await expect.poll(async () => (await extensionRequest(ext, 'sync/retry', undefined)).ok && !(await signedIn(ext))).toBe(true)
  expect(await signInFromPage(ext, TEST_USERS.b)).toBe(true)
  const db = await rawDb(serviceWorker)
  expect(db.highlights).toHaveLength(0)
  expect(db.outbox).toHaveLength(0)
  const userB = (db.meta as Array<{ key: string; value: unknown }>).find((m) => m.key === 'userId')?.value
  expect(userB).toEqual(expect.any(String))
  expect(userB).not.toBe(userA)
  await ext.close()
  expect(externalRequests).toEqual([])
})
