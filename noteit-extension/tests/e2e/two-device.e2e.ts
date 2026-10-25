// Story 2.22: two-device consistency suite (SC-1, NFR5, NFR6). Two real extension installs (separate
// persistent profiles) share one local test account; after every scenario both devices' local
// (id, editedAt, deletedAt) sets equal the cloud's and no "same text at the same place" duplicate
// exists (helpers/two-device.ts converge). Runs in the "two-device" Playwright project, which repeats
// every scenario 3 times without retries (flake guard).
// Needs the local Supabase stack (npm run db:start, env:local, build).
import { test as base, expect } from './fixtures/extension.ts'
import { clickMenuButton, dragSelect } from './fixtures/page-actions.ts'
import { controlServiceWorker } from '../helpers/sw-restart.ts'
import { clearCloud, connectCloud, converge, launchDevice, syncDevice, TEST_USER, type Cloud, type Device } from '../helpers/two-device.ts'
import { wins } from '../../src/core/sync/merge.ts'
import type { HighlightRecord } from '../../src/core/model/index.ts'
import type { CreateHighlightReq } from '../../src/features/highlight/index.ts'
import { strings } from '../../src/ui/strings.ts'

const RPC = '**/rest/v1/rpc/sync_push'

interface TwoDevices {
  a: Device
  b: Device
  cloud: Cloud
}

const test = base.extend<TwoDevices>({
  // Devices launch together; the fixture's own single context is never created here.
  // eslint-disable-next-line no-empty-pattern -- Playwright requires an object pattern here.
  cloud: async ({}, provide) => {
    clearCloud()
    await provide(await connectCloud())
    clearCloud()
  },
  a: async ({ cloud }, provide) => {
    void cloud
    const device = await launchDevice('a')
    await provide(device)
    try {
      expect(device.externalRequests).toEqual([])
    } finally {
      // Always release the persistent context and its profile dir, even if the assert fails.
      await device.close()
    }
  },
  b: async ({ a }, provide) => {
    void a
    const device = await launchDevice('b')
    await provide(device)
    try {
      expect(device.externalRequests).toEqual([])
    } finally {
      // Always release the persistent context and its profile dir, even if the assert fails.
      await device.close()
    }
  },
})

let seq = 0
function createReq(origin: string, label: string): CreateHighlightReq {
  seq += 1
  return {
    id: crypto.randomUUID(),
    url: `${origin}/article.html`,
    text: `two-device ${label} ${seq} ${crypto.randomUUID().slice(0, 8)}`,
    color: 'yellow',
    comment: null,
    anchor: null,
    pageTitle: 'NoteIt smoke article',
    favicon: null,
  }
}

/** Waits past the current millisecond so the next edit gets a strictly later editedAt. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

function byId(records: HighlightRecord[], id: string): HighlightRecord {
  const record = records.find((r) => r.id === id)
  if (!record) throw new Error(`record ${id} missing`)
  return record
}

/** Both devices hold exactly `expected` for `id` (color, comment, deletedAt, editedAt, deviceId). */
function expectSame(locals: HighlightRecord[][], id: string, expected: HighlightRecord): void {
  for (const records of locals) {
    expect(byId(records, id)).toMatchObject({
      color: expected.color,
      comment: expected.comment,
      deletedAt: expected.deletedAt,
      editedAt: expected.editedAt,
      deviceId: expected.deviceId,
    })
  }
}

test('A creates and edits 5 offline while B edits 2 online; both merge by LWW after A reconnects', async ({
  a,
  b,
  cloud,
  server,
}) => {
  // Two shared highlights both devices know about.
  const s1 = await a.call<HighlightRecord>('highlight/create', createReq(server.origin, 's1'))
  const s2 = await a.call<HighlightRecord>('highlight/create', createReq(server.origin, 's2'))
  await converge([a, b], cloud)

  await a.setOffline(true)
  // A edits s1 first (older than B's edit), creates 3 new highlights.
  await a.call('highlight/update', { id: s1.id, patch: { color: 'green', comment: 'a offline s1' } })
  const created = []
  for (const label of ['n1', 'n2', 'n3']) created.push(await a.call<HighlightRecord>('highlight/create', createReq(server.origin, label)))
  await tick()
  // B, online, edits both shared highlights.
  const b1 = await b.call<HighlightRecord>('highlight/update', { id: s1.id, patch: { color: 'blue', comment: 'b online s1' } })
  await b.call('highlight/update', { id: s2.id, patch: { color: 'blue', comment: 'b online s2' } })
  await syncDevice(b)
  await tick()
  // A edits s2 after B (newer than B's edit).
  const a2 = await a.call<HighlightRecord>('highlight/update', { id: s2.id, patch: { color: 'orange', comment: 'a offline s2' } })
  expect((await a.local()).outbox).toHaveLength(5)
  await a.setOffline(false)

  const { locals, cloud: rows } = await converge([a, b], cloud)
  expectSame(locals, s1.id, b1)
  expectSame(locals, s2.id, a2)
  for (const record of created) expectSame(locals, record.id, record)
  expect(rows.filter((r) => r.deletedAt === null)).toHaveLength(5)
})

test('A and B edit the same highlight concurrently; both end at the (editedAt, deviceId) winner', async ({
  a,
  b,
  cloud,
  server,
}) => {
  const shared = await a.call<HighlightRecord>('highlight/create', createReq(server.origin, 'shared'))
  await converge([a, b], cloud)

  // Neither device sees the other's edit before both are made.
  await a.setOffline(true)
  await b.setOffline(true)
  const editA = await a.call<HighlightRecord>('highlight/update', { id: shared.id, patch: { color: 'green', comment: 'from a' } })
  const editB = await b.call<HighlightRecord>('highlight/update', { id: shared.id, patch: { color: 'orange', comment: 'from b' } })
  await a.setOffline(false)
  await b.setOffline(false)

  const winner = wins(editA, editB) ? editA : editB
  const { locals } = await converge([a, b], cloud)
  expectSame(locals, shared.id, winner)
})

test('A deletes, B edits the old version before the delete reaches it, A undoes; LWW decides', async ({
  a,
  b,
  cloud,
  server,
}) => {
  const target = await a.call<HighlightRecord>('highlight/create', createReq(server.origin, 'undo'))
  await converge([a, b], cloud)

  // B is offline, so the delete does not reach it before its edit.
  await b.setOffline(true)
  const deleted = await a.call<HighlightRecord>('highlight/delete', { id: target.id })
  await syncDevice(a)
  await tick()
  const edited = await b.call<HighlightRecord>('highlight/update', { id: target.id, patch: { color: 'blue', comment: 'b on stale copy' } })
  expect(edited.deletedAt).toBeNull()
  await tick()
  const restored = await a.call<HighlightRecord>('highlight/restore', { id: target.id })
  await b.setOffline(false)

  // Last write is A's undo: live again with A's pre-delete content, B's stale edit loses.
  expect(deleted.editedAt).toBeLessThan(edited.editedAt)
  expect(edited.editedAt).toBeLessThan(restored.editedAt)
  const { locals, cloud: rows } = await converge([a, b], cloud)
  expectSame(locals, target.id, restored)
  expect(restored).toMatchObject({ deletedAt: null, color: target.color, comment: target.comment })
  expect(rows.find((r) => r.id === target.id)?.deletedAt).toBeNull()
})

test('A signs out with pending items (confirmed) and signs in again; its data equals the cloud', async ({
  a,
  b,
  cloud,
  server,
}) => {
  const synced = await b.call<HighlightRecord>('highlight/create', createReq(server.origin, 'synced'))
  await converge([a, b], cloud)

  // Two items on A that cannot be pushed.
  await a.context.route(RPC, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'boom' }) }),
  )
  const lost = [
    await a.call<HighlightRecord>('highlight/create', createReq(server.origin, 'lost1')),
    await a.call<HighlightRecord>('highlight/create', createReq(server.origin, 'lost2')),
  ]
  await expect.poll(async () => (await a.syncStatus()).pending).toBe(2)

  const panel = await a.extensionPage()
  await panel.reload()
  await panel.getByTestId('account-button').click()
  const account = panel.getByTestId('account-panel')
  await expect(account.getByTestId('account-pending')).toHaveText('2')
  await account.getByRole('button', { name: strings.logout }).click()
  const dialog = panel.getByRole('alertdialog')
  await expect(dialog).toHaveText(new RegExp(strings.logoutConfirm(2).replace(/[?\uFF1F]/g, '.')))
  await dialog.getByRole('button', { name: strings.logout }).click()
  await expect(panel.getByRole('button', { name: strings.loginSubmit, exact: true })).toBeVisible()
  await expect.poll(async () => (await a.local()).records).toEqual([])

  await a.context.unroute(RPC)
  const login = await a.call<{ signedIn: boolean }>('auth/login', TEST_USER)
  expect(login.signedIn).toBe(true)

  // The confirmed loss is final: only the cloud's rows come back, on both devices.
  const { locals, cloud: rows } = await converge([a, b], cloud)
  expect(rows.map((r) => r.id)).toEqual([synced.id])
  for (const records of locals) {
    expect(records.map((r) => r.id)).toEqual([synced.id])
    for (const gone of lost) expect(records.find((r) => r.id === gone.id)).toBeUndefined()
  }
})

test('side panel closed, service worker killed, browser closed and reopened: nothing is lost', async ({
  a,
  b,
  cloud,
  server,
}) => {
  // 1. Created from the page with no extension page open (side panel closed).
  await a.closeExtensionPage()
  const article = await a.context.newPage()
  await article.goto(`${server.origin}/article.html`)
  await article.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
  await dragSelect(article, article.locator('#target'))
  await clickMenuButton(article, 0)
  await expect(article.locator('#target .noteit-highlight').first()).toBeVisible()
  await expect.poll(async () => (await cloud.rows()).length, { timeout: 10_000 }).toBe(1)
  await article.close()

  // 2. Created, then the service worker is terminated before its debounced push.
  const page = await a.extensionPage()
  const sw = await controlServiceWorker(a.context, a.extensionId, page)
  let afterKill: HighlightRecord
  try {
    afterKill = await a.call<HighlightRecord>('highlight/create', createReq(server.origin, 'sw-kill'))
    // Precondition: the item is still unpushed, so only the restarted worker can deliver it.
    expect((await a.local()).outbox.map((o) => o.id)).toContain(afterKill.id)
    await sw.stop()
    await sw.wake({ kind: 'noteit/request', type: 'sync/getStatus', req: undefined })
  } finally {
    await sw.dispose()
  }
  await expect.poll(async () => (await cloud.rows()).some((r) => r.id === afterKill.id), { timeout: 10_000 }).toBe(true)

  // 3. Created offline, then the whole browser is closed and reopened online on the same profile.
  await a.setOffline(true)
  const beforeClose = await a.call<HighlightRecord>('highlight/create', createReq(server.origin, 'reopen'))
  expect((await a.local()).outbox.map((o) => o.id)).toEqual([beforeClose.id])
  await a.restart()
  // The worker's startup run pushes the outbox without any extension page being opened.
  await expect.poll(async () => (await cloud.rows()).some((r) => r.id === beforeClose.id), { timeout: 15_000 }).toBe(true)

  const { locals, cloud: rows } = await converge([a, b], cloud)
  expect(rows.filter((r) => r.deletedAt === null)).toHaveLength(3)
  for (const records of locals) expect(records.filter((r) => r.deletedAt === null)).toHaveLength(3)
})
