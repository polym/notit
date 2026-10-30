// Story 3.13 (FR1, FR3, NFR22): the Preact floating menu in the Shadow host. Four color dots (yellow
// first) named by strings.colorYellow / colorOrange / colorBlue / colorGreen, a separator and the comment button; a dot click creates that
// color; the comment editor saves highlight and comment together with Cmd/Ctrl+Enter; Esc closes the
// menu or cancels the editor, and neither key reaches the host page's keydown listeners.
import type { Page } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { enableSite, liveRecords, openExtensionPage, resetLocalData } from '../helpers/local-db.ts'
import { COMMENT_BUTTON_INDEX, MENU, clickMenuButton, computedColor, dragSelect, menuButton } from './fixtures/page-actions.ts'
import { strings } from '../../src/ui/strings.ts'
import { colors } from '../../src/ui/tokens/index.ts'

const SITE = '127.0.0.1'

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

/**
 * Records the keydowns the host page sees. Bubble listeners on window, document and body record
 * every key; capture listeners on window and document record Esc and Mod+Enter (the keys the menu
 * must keep from the page). Capture listeners see typed characters before the editor does, which
 * the AC does not cover, so they ignore other keys. Registered after the content script, as any
 * page listener added after document_end would be.
 */
async function recordHostKeys(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: string[] = []
    ;(window as unknown as { __hostKeys: string[] }).__hostKeys = seen
    const label = (e: KeyboardEvent) => `${e.metaKey || e.ctrlKey ? 'Mod+' : ''}${e.key}`
    const push = (e: KeyboardEvent) => seen.push(label(e))
    const pushGuarded = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) seen.push(`capture:${label(e)}`)
    }
    window.addEventListener('keydown', push)
    document.addEventListener('keydown', push)
    document.body.addEventListener('keydown', push)
    window.addEventListener('keydown', pushGuarded, { capture: true })
    document.addEventListener('keydown', pushGuarded, { capture: true })
  })
}

const hostKeys = (page: Page) => page.evaluate(() => (window as unknown as { __hostKeys: string[] }).__hostKeys)

test('menu content: four named color chips (yellow first) and the comment button', async ({
  context,
  server,
  externalRequests,
}) => {
  const page = await context.newPage()
  await openArticle(page, `${server.origin}/article.html`)
  await dragSelect(page, page.locator('#target'))

  const menu = page.locator(MENU)
  await expect(menu).toBeVisible()
  await expect(menu).toHaveAttribute('role', 'toolbar')
  // The menu lives in the Shadow host, not in the page body.
  expect(await page.evaluate(() => document.body.querySelector('[data-noteit-menu]'))).toBeNull()
  const labels = await menu.locator('button').evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))
  expect(labels).toEqual([
    strings.colorYellow,
    strings.colorOrange,
    strings.colorBlue,
    strings.colorGreen,
    strings.commentButton,
    strings.translateButton,
  ])

  // color-chip: every chip shows its color name without hovering.
  await expect(menuButton(page, 0)).toHaveText(strings.colorYellow)
  await expect(menuButton(page, 1)).toHaveText(strings.colorOrange)
  await expect(menuButton(page, 1)).toBeVisible()

  // Q65: above the selection, not covering it.
  const sel = await page.evaluate(() => {
    const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
    return { top: r.top }
  })
  const box = (await menu.boundingBox())!
  expect(box.y + box.height).toBeLessThanOrEqual(sel.top)

  expect(externalRequests).toEqual([])
})

test('a dot click creates that color; marks use the overlay color and inherit the text color', async ({
  context,
  serviceWorker,
  server,
  externalRequests,
}) => {
  const page = await context.newPage()
  await openArticle(page, `${server.origin}/dark.html`)
  const before = await page.locator('#target').evaluate((el) => getComputedStyle(el).color)
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(30, 30, 30)')

  const selected = await dragSelect(page, page.locator('#target'))
  await clickMenuButton(page, 2)
  await expect(page.locator(MENU)).toHaveCount(0)
  const mark = page.locator('#target .noteit-highlight').first()
  await expect(mark).toBeVisible()
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
  expect((await liveRecords(serviceWorker))[0]).toMatchObject({ text: selected, color: 'blue', comment: null })

  // dark.html has a #1E1E1E body, so the renderer picks the on-dark overlay.
  expect(await mark.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
    await computedColor(page, colors['highlight-blue-on-dark']),
  )
  expect(await mark.evaluate((el) => getComputedStyle(el).color)).toBe(before)
  expect(await page.locator('#target').evaluate((el) => getComputedStyle(el).color)).toBe(before)

  // Default yellow: the first dot.
  await dragSelect(page, page.locator('#intro'))
  await clickMenuButton(page, 0)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(2)
  expect((await liveRecords(serviceWorker)).map((r) => r.color).sort()).toEqual(['blue', 'yellow'])

  expect(externalRequests).toEqual([])
})

test('the comment editor saves highlight and comment with Mod+Enter; keys never reach the host page', async ({
  context,
  serviceWorker,
  server,
  externalRequests,
}) => {
  const page = await context.newPage()
  await openArticle(page, `${server.origin}/article.html`)
  await recordHostKeys(page)
  const selected = await dragSelect(page, page.locator('#target'))

  await clickMenuButton(page, COMMENT_BUTTON_INDEX)
  const editor = page.locator(`${MENU} textarea`)
  await expect(editor).toBeVisible()
  await expect(editor).toBeFocused()
  // While editing, a dot only picks the color.
  await clickMenuButton(page, 1)
  await expect(menuButton(page, 1)).toHaveAttribute('aria-pressed', 'true')
  expect(await liveRecords(serviceWorker)).toEqual([])

  await editor.focus()
  await page.keyboard.type('why does this matter')
  await page.keyboard.press('Escape')
  // Esc in the editor cancels editing only; the menu stays.
  await expect(editor).toHaveCount(0)
  await expect(page.locator(MENU)).toBeVisible()

  // The color picked while editing is kept when the editor is reopened.
  await clickMenuButton(page, COMMENT_BUTTON_INDEX)
  await expect(editor).toBeFocused()
  await page.keyboard.type('a question')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.locator(MENU)).toHaveCount(0)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
  expect((await liveRecords(serviceWorker))[0]).toMatchObject({ text: selected, color: 'orange', comment: 'a question' })
  await expect(page.locator('#target .noteit-highlight').first()).toBeVisible()

  expect(await hostKeys(page)).toEqual([])
  expect(externalRequests).toEqual([])
})

test('Esc closes the menu without reaching host keydown listeners; no highlight is created', async ({
  context,
  serviceWorker,
  server,
  externalRequests,
}) => {
  const page = await context.newPage()
  await openArticle(page, `${server.origin}/article.html`)
  await recordHostKeys(page)
  await dragSelect(page, page.locator('#target'))
  await expect(page.locator(MENU)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator(MENU)).toHaveCount(0)
  expect(await hostKeys(page)).toEqual([])

  // Other keys still reach the page when no editor is focused.
  await page.keyboard.press('a')
  expect(await hostKeys(page)).toContain('a')
  expect(await liveRecords(serviceWorker)).toEqual([])

  expect(externalRequests).toEqual([])
})
