// Story 3.14 (FR4, FR14, #14): commented highlights carry a bubble marker (highlight-mark-commented)
// and hovering them shows only the read-only comment preview in the Shadow host. Hovering a highlight
// without a comment shows nothing; the legacy hover edit menu is gone.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { computeSeedsInPage, type ExpectedHighlight } from '../corpus/runner.ts'
import { enableSite, openExtensionPage, resetLocalData, seedHighlights, seedToCreateReq } from '../helpers/local-db.ts'
import { PREVIEW, computedColor, hasCommentMarker, hoverHighlight } from './fixtures/page-actions.ts'
import { colors } from '../../src/ui/tokens/index.ts'

const SITE = '127.0.0.1'
const TITLE = 'NoteIt smoke article'
const CONTEXT_LENGTH = 64
const COMMENT = 'Why does this survive?\nSecond line.'

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  await ext.close()
})

async function openArticle(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
}

/** Seeds one blue highlight with a comment (#target) and one blue highlight without (#intro). */
async function seedPair(page: Page, url: string, context: Parameters<typeof openExtensionPage>[0], extensionId: string) {
  const targets: ExpectedHighlight[] = [
    { id: 'commented', text: 'survive a page reload', scope: '#target' },
    { id: 'plain', text: 'quick brown fox', scope: '#intro' },
  ]
  await page.goto(url)
  const seeds = await page.evaluate(computeSeedsInPage, { highlights: targets, contextLength: CONTEXT_LENGTH })
  if (typeof seeds === 'string') throw new Error(seeds)
  const [commented, plain] = seeds.map((s) => ({ ...seedToCreateReq(s, url, TITLE), color: 'blue' as const }))
  commented.comment = COMMENT
  const ext = await openExtensionPage(context, extensionId)
  await seedHighlights(ext, [commented, plain])
  await ext.close()
  return { commented, plain }
}

test('commented highlights carry the marker, keep their color, and preview the record comment read-only', async ({
  context,
  extensionId,
  server,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const page = await context.newPage()
  const { commented, plain } = await seedPair(page, url, context, extensionId)
  await openArticle(page, url)

  const commentedMark = page.locator(`[data-noteit-id="${commented.id}"]`).first()
  const plainMark = page.locator(`[data-noteit-id="${plain.id}"]`).first()
  await expect(commentedMark).toBeVisible()
  await expect(plainMark).toBeVisible()

  // highlight-mark-commented: the marker only on the commented highlight.
  expect(await hasCommentMarker(page.locator(`[data-noteit-id="${commented.id}"]`))).toBe(true)
  expect(await hasCommentMarker(page.locator(`[data-noteit-id="${plain.id}"]`))).toBe(false)
  // Same color for both: a comment never changes it (no legacy purple).
  const bg = (el: Element) => getComputedStyle(el).backgroundColor
  const blue = await computedColor(page, colors['highlight-blue'])
  expect(await commentedMark.evaluate(bg)).toBe(blue)
  expect(await plainMark.evaluate(bg)).toBe(blue)

  // Hovering the plain highlight shows no overlay at all.
  await hoverHighlight(page, plainMark)
  await page.waitForTimeout(200)
  await expect(page.locator(PREVIEW)).toHaveCount(0)
  await expect(page.locator('noteit-root .nt-overlay')).toHaveCount(0)

  // Hovering the commented highlight shows the preview with the record's comment.
  await hoverHighlight(page, commentedMark)
  const preview = page.locator(PREVIEW)
  await expect(preview).toBeVisible()
  await expect(preview).toHaveText(COMMENT)
  expect(await preview.locator('button, input, textarea, select, [contenteditable]').count()).toBe(0)

  // Placed 6px below the highlight, inside the Shadow host, never inside the highlight span.
  const markBox = (await commentedMark.boundingBox())!
  const previewBox = (await preview.boundingBox())!
  expect(Math.round(previewBox.y - (markBox.y + markBox.height))).toBe(6)
  const dom = await commentedMark.evaluate((el) => {
    const host = document.querySelector('noteit-root')
    const inShadow = host?.shadowRoot?.querySelector('[data-noteit-preview]') ?? null
    return {
      childElements: el.children.length,
      previewInLightDom: document.querySelectorAll('[data-noteit-preview]').length,
      inShadow: inShadow !== null,
    }
  })
  expect(dom).toEqual({ childElements: 0, previewInLightDom: 0, inShadow: true })

  // Leaving the highlight hides the preview.
  await page.mouse.move(1, 1)
  await expect(preview).toHaveCount(0)

  expect(externalRequests).toEqual([])
})

test('the legacy hover-to-edit code path no longer exists in src', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(ts|tsx)$/.test(name)) files.push(path)
    }
  }
  walk(join(import.meta.dirname, '../../src'))
  // Markers of the removed hover edit menu and the in-span tooltip it relied on.
  const legacy = /LegacyEditMenu|EDIT_MENU_ATTR|data-noteit-edit-menu|noteit-comment-tooltip|attachCommentTooltip|noteit-with-comment|editMenu\.show/
  const hits = files.filter((f) => legacy.test(readFileSync(f, 'utf8')))
  expect(hits).toEqual([])
})
