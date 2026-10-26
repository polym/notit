// Story 2.23: diagnostics page (not linked in UI) shows syncStatus, outbox and recent logs, and
// exports the local id list with {id, editedAt, deletedAt} only (no text, comment or URL).
// Needs the local Supabase stack (npm run db:start, env:local, build).
import { test, expect, signIn } from './fixtures/extension.ts'
import { enableSite, extensionRequest, openExtensionPage, resetLocalData, seedHighlights } from '../helpers/local-db.ts'
import type { CreateHighlightReq } from '../../src/features/highlight/index.ts'
import type { LocalIdExport } from '../../src/core/diagnostics/consistency.ts'
import { strings } from '../../src/ui/strings.ts'

const SITE = '127.0.0.1'
const TEXT = 'diagnostics secret text'
const COMMENT = 'diagnostics secret comment'

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  await ext.close()
})

test('debug.html shows sync status, outbox and logs and exports ids only', async ({ context, extensionId, server }) => {
  const ext = await openExtensionPage(context, extensionId)
  const reqs: CreateHighlightReq[] = [1, 2].map((n) => ({
    id: crypto.randomUUID(),
    url: `${server.origin}/article.html?n=${n}`,
    text: `${TEXT} ${n}`,
    color: 'yellow',
    comment: COMMENT,
    anchor: null,
    pageTitle: 'NoteIt smoke article',
    favicon: null,
  }))
  // Offline so the outbox keeps both items while the page is inspected.
  await context.setOffline(true)
  try {
    await seedHighlights(ext, reqs)
    const deleted = await extensionRequest(ext, 'highlight/delete', { id: reqs[1].id })
    expect(deleted.ok).toBe(true)

    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/debug.html`)
    await expect(page.locator('h1')).toHaveText(strings.debugTitle)
    await expect(page.getByTestId('debug-sync-status')).toContainText('"pending": 2')
    await expect(page.getByTestId('debug-outbox')).toContainText(strings.debugOutbox(2))
    await expect(page.getByTestId('debug-outbox')).toContainText(reqs[0].id)
    await expect(page.getByTestId('debug-logs')).toContainText('"scope"')

    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: strings.debugExport }).click()
    expect((await download).suggestedFilename()).toMatch(/^noteit-local-ids-\d+\.json$/)
    await expect(page.getByRole('status')).toHaveText(strings.debugExported(2))

    const raw = (await page.getByTestId('debug-export-json').textContent()) ?? ''
    const exported = JSON.parse(raw) as LocalIdExport
    expect(exported.kind).toBe('noteit/local-ids')
    expect(exported.entries.map((e) => e.id).sort()).toEqual(reqs.map((r) => r.id).sort())
    for (const entry of exported.entries) expect(Object.keys(entry).sort()).toEqual(['deletedAt', 'editedAt', 'id'])
    expect(exported.entries.find((e) => e.id === reqs[1].id)?.deletedAt).toEqual(expect.any(Number))
    expect(exported.entries.find((e) => e.id === reqs[0].id)?.deletedAt).toBeNull()
    expect(raw).not.toContain(TEXT)
    expect(raw).not.toContain(COMMENT)
    expect(raw).not.toContain(server.origin)
    expect(raw).not.toContain('article.html')
  } finally {
    await context.setOffline(false)
  }
})

test('no extension UI links to debug.html', async ({ openSidePanel }) => {
  const panel = await openSidePanel()
  expect(await panel.locator('a[href*="debug"]').count()).toBe(0)
  expect(await panel.content()).not.toContain('debug.html')
})
