// Two-device harness for the SC-1 consistency suite (Story 2.22, architecture.md "Testing & CI").
// Each device is its own persistent Chromium profile with the built extension (dist/) loaded and
// signed in to the same local test account. Devices can go offline, be closed and relaunched on the
// same profile, and be driven to convergence; the cloud side is read with a test-side client signed
// in to the same account (RLS, anon key only).
import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DIST_DIR, isLocalUrl, signInFromPage } from '../e2e/fixtures/extension.ts'
import { clearCloudRows, getLocalSupabaseEnv, TEST_USERS } from './local-supabase.ts'
import type { HighlightRecord } from '../../src/core/model/index.ts'
import type { OutboxItem } from '../../src/core/db/schema.ts'
import type { Result } from '../../src/core/messaging/index.ts'
import type { SyncStatus } from '../../src/core/sync/protocol.ts'

export const SITE = '127.0.0.1'
export const TEST_USER = TEST_USERS.a

/** The fields SC-1 compares between devices and the cloud. */
export interface RecordKey {
  id: string
  editedAt: number
  deletedAt: number | null
}

/** Fields that identify "same text at the same place" for the duplicate check. */
interface PlaceKey {
  id: string
  canonicalUrl: string
  text: string
  start: number | null
  end: number | null
  deletedAt: number | null
}

export interface LocalState {
  records: HighlightRecord[]
  outbox: OutboxItem[]
}

export interface Device {
  readonly name: string
  readonly extensionId: string
  readonly context: BrowserContext
  /** Extension page (side panel document) used to send requests; null while closed on purpose. */
  page: Page | null
  /** Every non-localhost request the device tried (always blocked). */
  readonly externalRequests: string[]
  /** Returns the open extension page, opening one when needed. */
  extensionPage(): Promise<Page>
  /** Closes the extension page so no extension page is open (side panel closed). */
  closeExtensionPage(): Promise<void>
  request<T>(type: string, req: unknown): Promise<Result<T>>
  /** Like request, but throws on a failed Result. */
  call<T>(type: string, req: unknown): Promise<T>
  local(): Promise<LocalState>
  syncStatus(): Promise<SyncStatus>
  setOffline(offline: boolean): Promise<void>
  /** Closes the browser context and launches it again on the same profile. */
  restart(): Promise<void>
  close(): Promise<void>
}

interface DeviceInternals {
  context: BrowserContext
  extensionId: string
}

async function launchContext(userDataDir: string, externalRequests: string[]): Promise<DeviceInternals> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${DIST_DIR}`, `--load-extension=${DIST_DIR}`],
  })
  await context.route(
    (url) => !isLocalUrl(url.href),
    async (route) => {
      externalRequests.push(route.request().url())
      await route.abort('blockedbyclient')
    },
  )
  const worker =
    context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')) ??
    (await context.waitForEvent('serviceworker', (w) => w.url().startsWith('chrome-extension://')))
  return { context, extensionId: new URL(worker.url()).host }
}

/** Reads every highlight record and the outbox with raw IndexedDB from an extension page. */
async function readLocal(page: Page): Promise<LocalState> {
  return page.evaluate(async () => {
    return new Promise<{ records: HighlightRecord[]; outbox: OutboxItem[] }>((resolve, reject) => {
      const open = indexedDB.open('noteit')
      open.onupgradeneeded = () => open.transaction?.abort()
      open.onerror = () => (open.error?.name === 'AbortError' ? resolve({ records: [], outbox: [] }) : reject(open.error))
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
  })
}

/**
 * Launches one signed-in device on a fresh profile. The site of the static test pages is turned on
 * so the content script works there. With { signIn: false } the device stays signed out and the site
 * is left as is (Key Flow 1: the second device signs in through the login form).
 */
export async function launchDevice(name: string, options?: { signIn?: boolean }): Promise<Device> {
  if (!existsSync(join(DIST_DIR, 'manifest.json'))) {
    throw new Error('dist/manifest.json not found; run "npm run build" before the e2e tests')
  }
  const userDataDir = mkdtempSync(join(tmpdir(), `noteit-two-device-${name}-`))
  const externalRequests: string[] = []
  let internals = await launchContext(userDataDir, externalRequests)

  const device: Device = {
    name,
    get extensionId() {
      return internals.extensionId
    },
    get context() {
      return internals.context
    },
    page: null,
    externalRequests,
    async extensionPage() {
      if (device.page && !device.page.isClosed()) return device.page
      const page = await internals.context.newPage()
      await page.goto(`chrome-extension://${internals.extensionId}/src/entries/sidepanel/index.html`)
      device.page = page
      return page
    },
    async closeExtensionPage() {
      if (device.page && !device.page.isClosed()) await device.page.close()
      device.page = null
    },
    async request<T>(type: string, req: unknown) {
      const page = await device.extensionPage()
      return page.evaluate(
        async ({ type, req }) => (await chrome.runtime.sendMessage({ kind: 'noteit/request', type, req })) as Result<T>,
        { type, req },
      )
    },
    async call<T>(type: string, req: unknown) {
      const result = await device.request<T>(type, req)
      if (!result.ok) throw new Error(`[${name}] ${type} failed: ${JSON.stringify(result.error)}`)
      return result.data
    },
    async local() {
      return readLocal(await device.extensionPage())
    },
    async syncStatus() {
      return device.call<SyncStatus>('sync/getStatus', undefined)
    },
    async setOffline(offline: boolean) {
      await internals.context.setOffline(offline)
    },
    async restart() {
      device.page = null
      await internals.context.close()
      internals = await launchContext(userDataDir, externalRequests)
    },
    async close() {
      device.page = null
      await internals.context.close().catch(() => undefined)
      rmSync(userDataDir, { recursive: true, force: true })
    },
  }

  const page = await device.extensionPage()
  if (options?.signIn === false) return device
  if (!(await signInFromPage(page, TEST_USER))) {
    throw new Error('could not sign in to the local Supabase stack (npm run db:start, env:local, build)')
  }
  // The side panel shows the list (and the account area) only after a reload once signed in.
  await page.reload()
  await device.call('site/setEnabled', { siteKey: SITE, enabled: true })
  return device
}

/** Test-side read-only view of the account's cloud rows (the user's own session, RLS). */
export interface Cloud {
  rows(): Promise<PlaceKey[]>
}

export async function connectCloud(): Promise<Cloud> {
  const env = getLocalSupabaseEnv()
  const client: SupabaseClient = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { error } = await client.auth.signInWithPassword(TEST_USER)
  if (error) throw new Error('test-side sign-in failed', { cause: error })
  return {
    async rows() {
      const { data, error: selectError } = await client
        .from('highlights')
        .select('id, edited_at, deleted_at, canonical_url, text, anchor')
      if (selectError) throw new Error(`cloud select failed: ${selectError.message}`)
      return (data as Array<Record<string, unknown>>).map((row) => {
        const anchor = row.anchor as { start?: number; end?: number } | null
        return {
          id: String(row.id),
          editedAt: Number(row.edited_at),
          deletedAt: row.deleted_at === null ? null : Number(row.deleted_at),
          canonicalUrl: String(row.canonical_url),
          text: String(row.text),
          start: anchor?.start ?? null,
          end: anchor?.end ?? null,
        } as PlaceKey & { editedAt: number }
      })
    },
  }
}

/** Empties the test account in the cloud (superuser psql; clients cannot delete). */
export function clearCloud(): void {
  clearCloudRows(TEST_USER.email)
}

function keySet(rows: RecordKey[]): string[] {
  return rows.map((r) => `${r.id}|${r.editedAt}|${r.deletedAt ?? '-'}`).sort()
}

/** Live rows that share canonical URL, text and anchor offsets with another live row. */
export function duplicatePlaces(rows: PlaceKey[]): string[] {
  const seen = new Map<string, string>()
  const dupes: string[] = []
  for (const row of rows) {
    if (row.deletedAt !== null) continue
    const place = `${row.canonicalUrl}|${row.text}|${row.start ?? '-'}|${row.end ?? '-'}`
    const other = seen.get(place)
    if (other) dupes.push(`${other} ~ ${row.id}`)
    else seen.set(place, row.id)
  }
  return dupes
}

function toPlace(r: HighlightRecord): PlaceKey {
  return {
    id: r.id,
    canonicalUrl: r.canonicalUrl,
    text: r.text,
    start: r.anchor?.start ?? null,
    end: r.anchor?.end ?? null,
    deletedAt: r.deletedAt,
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Pushes then pulls on one device (sidebar/opened) and waits until its run is over. */
export async function syncDevice(device: Device, timeoutMs = 15_000): Promise<void> {
  await device.call('sidebar/opened', {})
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const status = await device.syncStatus()
    if (status.state !== 'syncing' && status.pending === 0) return
    if (Date.now() > deadline) throw new Error(`[${device.name}] sync did not settle: ${JSON.stringify(status)}`)
    await sleep(200)
  }
}

export interface Converged {
  /** The account's cloud rows after convergence. */
  cloud: Array<PlaceKey & { editedAt: number }>
  /** Each device's records (including soft-deleted ones), in the order given. */
  locals: HighlightRecord[][]
}

/**
 * Syncs every device until each device's set of (id, editedAt, deletedAt) equals the cloud's and no
 * outbox item is left; asserts no "same text at the same place" duplicate exists anywhere. Throws
 * with a diff when the devices do not converge within the timeout.
 */
export async function converge(devices: Device[], cloud: Cloud, timeoutMs = 45_000): Promise<Converged> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  for (;;) {
    for (const device of devices) await syncDevice(device)
    // A second round lets every device pull what the others pushed in the first one.
    for (const device of devices) await syncDevice(device)
    const cloudRows = (await cloud.rows()) as Array<PlaceKey & { editedAt: number }>
    const states = await Promise.all(devices.map((d) => d.local()))
    const want = keySet(cloudRows)
    const mismatched = states
      .map((s, i) => ({ name: devices[i].name, have: keySet(s.records), outbox: s.outbox.length }))
      .filter((s) => s.outbox > 0 || JSON.stringify(s.have) !== JSON.stringify(want))
    if (mismatched.length === 0) {
      const dupes = [duplicatePlaces(cloudRows), ...states.map((s) => duplicatePlaces(s.records.map(toPlace)))].flat()
      if (dupes.length > 0) throw new Error(`duplicate highlights at the same place: ${dupes.join(', ')}`)
      return { cloud: cloudRows, locals: states.map((s) => s.records) }
    }
    last = JSON.stringify({ cloud: want, mismatched })
    if (Date.now() > deadline) throw new Error(`devices did not converge with the cloud: ${last}`)
    await sleep(500)
  }
}
