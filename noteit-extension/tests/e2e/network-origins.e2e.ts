// Story 2.21: highlight data only goes to the build-injected Supabase (NFR16) and the manifest keeps
// the least-privilege permission set (NFR15, #20). Walks login, create, edit, delete, sync and
// logout while recording every network request of the context (service worker, side panel, pages).
// Needs the local Supabase stack (npm run db:start, env:local, build).
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, DIST_DIR } from './fixtures/extension.ts'
import { clickMenuButton, dragSelect } from './fixtures/page-actions.ts'
import { enableSite, extensionRequest, liveRecords, resetLocalData } from '../helpers/local-db.ts'
import { getLocalSupabaseEnv, TEST_USERS } from '../helpers/local-supabase.ts'
import type { HighlightRecord } from '../../src/core/model/index.ts'
import { strings } from '../../src/ui/strings.ts'

const SITE = '127.0.0.1'
const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:'])

/** Every built JS file under dist/, concatenated. */
function distJs(): string {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.js')) out.push(readFileSync(path, 'utf8'))
    }
  }
  walk(DIST_DIR)
  return out.join('\n')
}

async function pending(page: Page): Promise<number> {
  const result = await extensionRequest<{ pending: number }>(page, 'auth/getPendingCount', undefined)
  if (!result.ok) throw new Error(`auth/getPendingCount failed: ${JSON.stringify(result.error)}`)
  return result.data.pending
}

test('the built manifest requests only the least-privilege permissions', () => {
  const manifest = JSON.parse(readFileSync(join(DIST_DIR, 'manifest.json'), 'utf8')) as chrome.runtime.ManifestV3
  expect([...(manifest.permissions ?? [])].sort()).toEqual(['alarms', 'contextMenus', 'sidePanel', 'storage', 'tabs'])
  expect(manifest.host_permissions ?? []).toEqual([])
  expect(manifest.optional_permissions ?? []).toEqual([])
  // Translation provider origins are granted one at a time from the side panel, never at install.
  expect(manifest.optional_host_permissions ?? []).toEqual(['https://*/*'])
})

test('login, create, edit, delete, sync and logout only reach Supabase and the test page', async ({
  context,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const supabaseOrigin = new URL(getLocalSupabaseEnv().url).origin
  // The Supabase address is the one injected at build time.
  expect(distJs()).toContain(getLocalSupabaseEnv().url)

  await resetLocalData(serviceWorker)
  const requests: string[] = []
  context.on('request', (request) => {
    const url = new URL(request.url())
    if (NETWORK_PROTOCOLS.has(url.protocol)) requests.push(request.url())
  })

  // Login through the side panel form.
  const panel = await openSidePanel(undefined, { signIn: false })
  await panel.getByLabel(strings.loginEmail).fill(TEST_USERS.a.email)
  await panel.getByLabel(strings.loginPassword).fill(TEST_USERS.a.password)
  await panel.getByRole('button', { name: strings.loginSubmit }).click()
  await expect(panel.getByTestId('account-button')).toBeVisible()
  await enableSite(panel, SITE)

  // Create on the page through the floating menu.
  const page = await context.newPage()
  await page.goto(`${server.origin}/article.html`)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
  await dragSelect(page, page.locator('#target'))
  await clickMenuButton(page, 0)
  await expect(page.locator('#target .noteit-highlight').first()).toBeVisible()
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
  const id = (await liveRecords(serviceWorker))[0].id
  await expect.poll(() => pending(panel)).toBe(0)

  // Edit, then delete; each change is pushed.
  const edited = await extensionRequest<HighlightRecord>(panel, 'highlight/update', { id, patch: { color: 'blue', comment: 'note' } })
  expect(edited.ok).toBe(true)
  await expect.poll(() => pending(panel)).toBe(0)
  const deleted = await extensionRequest<HighlightRecord>(panel, 'highlight/delete', { id })
  expect(deleted.ok).toBe(true)
  await expect.poll(() => pending(panel)).toBe(0)

  // Manual sync (push + pull).
  const retried = await extensionRequest(panel, 'sync/retry', undefined)
  expect(retried.ok).toBe(true)

  // Logout (nothing pending, so no confirmation).
  await panel.getByTestId('account-button').click()
  await panel.getByTestId('account-panel').getByRole('button', { name: strings.logout }).click()
  await expect(panel.getByRole('button', { name: strings.loginSubmit, exact: true })).toBeVisible()
  await page.waitForTimeout(500)

  // The recording saw the Supabase traffic (auth and sync), so the capture covers the service worker.
  expect(requests.some((u) => u.startsWith(`${supabaseOrigin}/auth/v1/`))).toBe(true)
  expect(requests.some((u) => u.startsWith(`${supabaseOrigin}/rest/v1/rpc/sync_push`))).toBe(true)
  const origins = new Set(requests.map((u) => new URL(u).origin))
  for (const origin of origins) expect([supabaseOrigin, server.origin]).toContain(origin)
  expect(externalRequests).toEqual([])
})
