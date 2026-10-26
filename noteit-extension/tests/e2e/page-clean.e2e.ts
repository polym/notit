// Story 3.16 (FR42, Q44): the page shows no site status overlay. Besides the highlights themselves
// (spans and their stylesheet), everything NoteIt adds to a page lives inside the single
// <noteit-root> shadow host; site state is shown only in the side panel header and the badge. The
// legacy status overlay code is gone.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { computeSeedsInPage } from '../corpus/runner.ts'
import {
  enableSite,
  extensionRequest,
  openExtensionPage,
  resetLocalData,
  seedHighlights,
  seedToCreateReq,
} from '../helpers/local-db.ts'

const SITE = '127.0.0.1'
const TITLE = 'NoteIt smoke article'
const HOST_ON = 'noteit-root[data-noteit-site="on"]'
// The highlight span stylesheet in <head> belongs to the highlights themselves: the spans live in
// the page DOM, so their styles cannot move into the shadow root. It shows nothing on its own.
const HIGHLIGHT_STYLES = 'style#noteit-highlight-styles'

/**
 * Elements in the live document that the fixture HTML does not have, ignoring highlight spans and
 * anything inside <noteit-root>. Compared as tag#id.class signatures in document order.
 */
async function injectedOutsideHost(page: Page): Promise<string[]> {
  return page.evaluate(async (allowed) => {
    const html = await (await fetch(location.href)).text()
    const original = new DOMParser().parseFromString(html, 'text/html')
    const sig = (el: Element) => `${el.tagName.toLowerCase()}#${el.id}.${[...el.classList].sort().join('.')}`
    const count = (doc: Document, skip: (el: Element) => boolean) => {
      const counts = new Map<string, number>()
      for (const el of doc.querySelectorAll('*')) {
        if (skip(el)) continue
        counts.set(sig(el), (counts.get(sig(el)) ?? 0) + 1)
      }
      return counts
    }
    const before = count(original, () => false)
    const after = count(
      document,
      (el) => el.closest('noteit-root') !== null || el.closest('.noteit-highlight') !== null || el.matches(allowed),
    )
    const extra: string[] = []
    for (const [key, n] of after) {
      if (n > (before.get(key) ?? 0)) extra.push(key)
    }
    return extra
  }, HIGHLIGHT_STYLES)
}

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await signIn(context, extensionId)
})

test('an enabled page with highlights has no NoteIt element outside <noteit-root> besides the highlights', async ({
  context,
  extensionId,
  server,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const ext = await openExtensionPage(context, extensionId)
  const page = await context.newPage()
  await page.goto(url)
  const seeds = await page.evaluate(computeSeedsInPage, {
    highlights: [{ id: 'a', text: 'quick brown fox', scope: '#intro' }],
    contextLength: 64,
  })
  if (typeof seeds === 'string') throw new Error(seeds)
  await enableSite(ext, SITE)
  await seedHighlights(
    ext,
    seeds.map((s) => seedToCreateReq(s, url, TITLE)),
  )

  await page.reload()
  await page.locator(HOST_ON).waitFor({ state: 'attached' })
  await expect(page.locator('.noteit-highlight').first()).toBeVisible()
  // Give any delayed overlay (the legacy one faded in and out over 3 s) time to appear.
  await page.waitForTimeout(500)
  expect(await injectedOutsideHost(page)).toEqual([])
  expect(await page.locator(`[id^="noteit-"]:not(${HIGHLIGHT_STYLES})`).count()).toBe(0)
  expect(await page.evaluate(() => document.querySelectorAll('noteit-root').length)).toBe(1)

  // Turning the site off from the side panel path adds nothing either.
  const off = await extensionRequest<void>(ext, 'site/setEnabled', { siteKey: SITE, enabled: false })
  expect(off.ok).toBe(true)
  await expect(page.locator('.noteit-highlight')).toHaveCount(0)
  await expect(page.locator('noteit-root')).not.toHaveAttribute('data-noteit-site', 'on')
  expect(await injectedOutsideHost(page)).toEqual([])
  expect(externalRequests).toEqual([])
})

test('a page on a closed site has no NoteIt element outside <noteit-root>', async ({ context, server }) => {
  const page = await context.newPage()
  await page.goto(`${server.origin}/article.html`)
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('noteit-root').length)).toBe(1)
  await page.waitForTimeout(500)
  expect(await injectedOutsideHost(page)).toEqual([])
})

test('the legacy status overlay and site toggle menu code no longer exist in src', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(ts|tsx|json)$/.test(name)) files.push(path)
    }
  }
  walk(join(import.meta.dirname, '../../src'))
  walk(join(import.meta.dirname, '../../public'))
  const legacy =
    /noteit-status-indicator|createStatusIndicator|updateStatusIndicator|TOGGLE_EXTENSION|GET_EXTENSION_STATE|TOGGLE_MENU_ID|noteit-toggle|menuToggleSite/
  const hits = files.filter((f) => !f.endsWith('.test.ts') && legacy.test(readFileSync(f, 'utf8')))
  expect(hits).toEqual([])
})
