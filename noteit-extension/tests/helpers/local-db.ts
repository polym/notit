// Test access to the extension's local data (Story 2.7: highlights live in Dexie, not chrome.storage).
// - resetLocalData / dumpLocalDb run raw IndexedDB inside the service worker. The e2e build is a
//   production build, where debug/dump is not registered (architecture.md D6), so dumpLocalDb reads
//   the same tables debug/dump returns ({ids, outbox} plus the records themselves).
// - extensionRequest sends a typed request envelope from an extension page, exactly like the
//   content script does, so seeds go through the real highlight/create handler.
import type { BrowserContext, Page, Worker } from '@playwright/test'
import type { HighlightRecord } from '../../src/core/model/index.ts'
import type { OutboxItem } from '../../src/core/db/schema.ts'
import { clearCloudRows, TEST_USERS } from './local-supabase.ts'
import type { Result } from '../../src/core/messaging/index.ts'
import type { CreateHighlightReq } from '../../src/features/highlight/index.ts'

export interface LocalDump {
  records: HighlightRecord[]
  outbox: OutboxItem[]
}

const DB_NAME = 'noteit'
// meta holds pullCursor (Story 2.17): a reset starts the next pull from 0.
const DATA_STORES = ['highlights', 'outbox', 'anchorStatus', 'meta']

/**
 * Clears chrome.storage.local and the highlight tables of the local database, then the cloud rows
 * of test user A: since Story 2.17 any pull (tab switch, side panel) would bring them back.
 * keepSession keeps the stored Supabase session (sb-auth) so loops need to sign in only once.
 */
export async function resetLocalData(serviceWorker: Worker, options?: { keepSession?: boolean }): Promise<void> {
  await serviceWorker.evaluate(
    async ({ name, stores, keepSession }) => {
      const session = keepSession ? await chrome.storage.local.get('sb-auth') : {}
      await chrome.storage.local.clear()
      if (keepSession) await chrome.storage.local.set(session)
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name)
        // The database does not exist yet: do not create it here (Dexie owns the schema).
        open.onupgradeneeded = () => open.transaction?.abort()
        open.onerror = () => (open.error?.name === 'AbortError' ? resolve() : reject(open.error))
        open.onsuccess = () => {
          const db = open.result
          const present = stores.filter((s) => db.objectStoreNames.contains(s))
          if (present.length === 0) {
            db.close()
            resolve()
            return
          }
          const tx = db.transaction(present, 'readwrite')
          for (const s of present) tx.objectStore(s).clear()
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
    },
    { name: DB_NAME, stores: DATA_STORES, keepSession: options?.keepSession === true },
  )
  // After the local reset the outbox is empty, so the worker has nothing left to push back.
  clearCloudRows(TEST_USERS.a.email)
}

/** Every highlight record (including soft-deleted ones) and the outbox. */
export async function dumpLocalDb(serviceWorker: Worker): Promise<LocalDump> {
  return serviceWorker.evaluate(async (name) => {
    return new Promise<{ records: HighlightRecord[]; outbox: OutboxItem[] }>((resolve, reject) => {
      const open = indexedDB.open(name)
      open.onupgradeneeded = () => open.transaction?.abort()
      open.onerror = () =>
        open.error?.name === 'AbortError' ? resolve({ records: [], outbox: [] }) : reject(open.error)
      open.onsuccess = () => {
        const db = open.result
        if (!db.objectStoreNames.contains('highlights')) {
          db.close()
          resolve({ records: [], outbox: [] })
          return
        }
        const tx = db.transaction(['highlights', 'outbox'], 'readonly')
        const records = tx.objectStore('highlights').getAll()
        const outbox = tx.objectStore('outbox').getAll()
        tx.oncomplete = () => {
          db.close()
          resolve({ records: records.result as HighlightRecord[], outbox: outbox.result as OutboxItem[] })
        }
        tx.onerror = () => reject(tx.error)
      }
    })
  }, DB_NAME)
}

/**
 * Writes records straight into the highlights table (bulk perf seeds; no outbox, no db/changed).
 * The database must already exist: call any request that reads it first (see ensureLocalDb).
 */
export async function putRecords(serviceWorker: Worker, records: HighlightRecord[]): Promise<void> {
  await serviceWorker.evaluate(
    async ({ name, rows }) => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name)
        open.onupgradeneeded = () => open.transaction?.abort()
        open.onerror = () => reject(open.error ?? new Error('local database does not exist yet'))
        open.onsuccess = () => {
          const db = open.result
          const tx = db.transaction('highlights', 'readwrite')
          const store = tx.objectStore('highlights')
          for (const row of rows) store.put(row)
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      })
    },
    { name: DB_NAME, rows: records },
  )
}

/** Makes the service worker open (and so create) the local database through page/getState. */
export async function ensureLocalDb(page: Page): Promise<void> {
  const result = await extensionRequest(page, 'page/getState', { url: 'http://127.0.0.1/' })
  if (!result.ok) throw new Error(`page/getState failed: ${JSON.stringify(result.error)}`)
}

/** Ids in the anchorStatus table (highlights not found on their page, Q54). */
export async function anchorStatusIds(serviceWorker: Worker): Promise<string[]> {
  return serviceWorker.evaluate(async (name) => {
    return new Promise<string[]>((resolve, reject) => {
      const open = indexedDB.open(name)
      open.onupgradeneeded = () => open.transaction?.abort()
      open.onerror = () => (open.error?.name === 'AbortError' ? resolve([]) : reject(open.error))
      open.onsuccess = () => {
        const db = open.result
        if (!db.objectStoreNames.contains('anchorStatus')) {
          db.close()
          resolve([])
          return
        }
        const req = db.transaction('anchorStatus', 'readonly').objectStore('anchorStatus').getAllKeys()
        req.onsuccess = () => {
          db.close()
          resolve((req.result as string[]).sort())
        }
        req.onerror = () => reject(req.error)
      }
    })
  }, DB_NAME)
}

/** Live records only. */
export async function liveRecords(serviceWorker: Worker): Promise<HighlightRecord[]> {
  return (await dumpLocalDb(serviceWorker)).records.filter((r) => r.deletedAt === null)
}

/** Sends one request envelope from an extension page and returns the router's Result. */
export async function extensionRequest<T>(page: Page, type: string, req: unknown): Promise<Result<T>> {
  return page.evaluate(
    async ({ type, req }) => (await chrome.runtime.sendMessage({ kind: 'noteit/request', type, req })) as Result<T>,
    { type, req },
  )
}

/**
 * Opens an extension page that can message the service worker. The side panel page is used
 * because it is the only extension page; it does not write highlights on its own.
 */
export async function openExtensionPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/src/entries/sidepanel/index.html`)
  return page
}

/** Creates highlights through highlight/create; throws on the first failed Result. */
export async function seedHighlights(page: Page, requests: CreateHighlightReq[]): Promise<void> {
  const results = await page.evaluate(async (reqs) => {
    const out: Array<{ ok: boolean; error?: unknown }> = []
    for (const req of reqs) {
      out.push(await chrome.runtime.sendMessage({ kind: 'noteit/request', type: 'highlight/create', req }))
    }
    return out
  }, requests)
  const failed = results.findIndex((r) => !r.ok)
  if (failed !== -1) throw new Error(`seed ${requests[failed].id} failed: ${JSON.stringify(results[failed].error)}`)
}

/** Enables a site through site/setEnabled (D8 manual override). */
export async function enableSite(page: Page, siteKey: string): Promise<void> {
  const result = await extensionRequest<void>(page, 'site/setEnabled', { siteKey, enabled: true })
  if (!result.ok) throw new Error(`site/setEnabled failed: ${JSON.stringify(result.error)}`)
}

/** Offset-based seed as computed by tests/corpus/runner.ts computeSeedsInPage. */
export interface OffsetSeed {
  text: string
  start: number
  length: number
  context: { prefix: string; suffix: string }
}

/** highlight/create request for a seed: same anchor the content script stores for that selection. */
export function seedToCreateReq(seed: OffsetSeed, url: string, pageTitle: string, id = crypto.randomUUID()): CreateHighlightReq {
  return {
    id,
    url,
    text: seed.text,
    color: 'yellow',
    comment: null,
    anchor: {
      start: seed.start,
      end: seed.start + seed.length,
      exact: seed.text,
      prefix: seed.context.prefix,
      suffix: seed.context.suffix,
    },
    pageTitle,
    favicon: null,
  }
}
