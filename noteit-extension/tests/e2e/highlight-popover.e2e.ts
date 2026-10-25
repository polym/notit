// Story 3.15 (FR5, FR7, Q39, Q57, Q60): clicking a highlight on the page opens the highlight popover in
// the Shadow host (four color dots with the current one selected, the comment editor prefilled from
// the record, a quiet delete button). A dot changes the color at once; Cmd/Ctrl+Enter saves the
// comment and closes; Esc or an outside click closes and drops unsaved input. Delete removes the
// highlight and shows "deleted · undo" at the former popover position for 5 seconds in this tab only;
// undo restores the highlight in this tab, other tabs of the page and the side panel.
import type { Page } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { dumpLocalDb, enableSite, liveRecords, openExtensionPage, resetLocalData } from '../helpers/local-db.ts'
import {
  MENU,
  POPOVER,
  PREVIEW,
  TOAST,
  clickHighlight,
  clickMenuButton,
  computedColor,
  dragSelect,
  hasCommentMarker,
  hoverHighlight,
} from './fixtures/page-actions.ts'
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

/** Creates a highlight of `#scope` through the floating menu (dot `colorIndex`) and returns its id. */
async function createHighlight(page: Page, scope: string, colorIndex: number, serviceWorker: Parameters<typeof liveRecords>[0]) {
  const before = (await liveRecords(serviceWorker)).length
  await dragSelect(page, page.locator(scope))
  await clickMenuButton(page, colorIndex)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(before + 1)
  const mark = page.locator(`${scope} .noteit-highlight`).first()
  await expect(mark).toBeVisible()
  const id = await mark.getAttribute('data-noteit-id')
  if (!id) throw new Error('highlight missing')
  return id
}

const markOf = (page: Page, id: string) => page.locator(`[data-noteit-id="${id}"]`).first()

test('popover shows the current color and record comment; dots, save, Esc and outside click', async ({
  context,
  serviceWorker,
  server,
  externalRequests,
}) => {
  const page = await context.newPage()
  await openArticle(page, `${server.origin}/article.html`)
  const id = await createHighlight(page, '#target', 0, serviceWorker)
  const mark = markOf(page, id)

  // Open: current color carries the selected ring, the editor is empty (no comment yet) and focused.
  await clickHighlight(page, mark)
  const popover = page.locator(POPOVER)
  await expect(popover).toBeVisible()
  await expect(popover).toHaveAttribute('role', 'dialog')
  await expect(popover).toHaveAttribute('aria-label', strings.highlightPopoverLabel)
  const dot = (name: string) => popover.getByRole('button', { name, exact: true })
  await expect(dot(strings.colorYellow)).toHaveAttribute('aria-pressed', 'true')
  await expect(dot(strings.colorOrange)).toHaveAttribute('aria-pressed', 'false')
  const editor = popover.locator('textarea')
  await expect(editor).toHaveValue('')
  await expect(editor).toBeFocused()
  // Delete uses the quiet subtle-foreground color, not red.
  const del = popover.getByRole('button', { name: strings.deleteHighlight })
  const subtle = await page.evaluate((v) => {
    const el = document.createElement('span')
    el.style.color = v
    document.body.append(el)
    const out = getComputedStyle(el).color
    el.remove()
    return out
  }, colors['subtle-foreground'])
  await expect(del).toHaveCSS('color', subtle)
  // Placed 6px below the highlight.
  const markBox = (await mark.boundingBox())!
  const popBox = (await popover.boundingBox())!
  expect(Math.round(popBox.y - (markBox.y + markBox.height))).toBe(6)

  // Dot: color changes at once, the popover stays open with the new selection.
  await dot(strings.colorOrange).click()
  await expect.poll(async () => (await liveRecords(serviceWorker))[0]?.color).toBe('orange')
  await expect
    .poll(() => mark.evaluate((el) => getComputedStyle(el).backgroundColor))
    .toBe(await computedColor(page, colors['highlight-orange']))
  await expect(popover).toBeVisible()
  await expect(dot(strings.colorOrange)).toHaveAttribute('aria-pressed', 'true')
  await expect(dot(strings.colorYellow)).toHaveAttribute('aria-pressed', 'false')

  // Cmd/Ctrl+Enter saves the comment and closes; the comment marker appears.
  await editor.fill('Worth a second read')
  await editor.press('ControlOrMeta+Enter')
  await expect(popover).toHaveCount(0)
  await expect.poll(async () => (await liveRecords(serviceWorker))[0]?.comment).toBe('Worth a second read')
  await expect(mark).toHaveClass(/noteit-commented/)
  await expect.poll(() => hasCommentMarker(mark)).toBe(true)
  expect((await liveRecords(serviceWorker))[0]?.color).toBe('orange')

  // Reopen: the comment is prefilled from the record. Esc drops the unsaved edit.
  await clickHighlight(page, mark)
  await expect(editor).toHaveValue('Worth a second read')
  await editor.fill('discarded by Esc')
  await editor.press('Escape')
  await expect(popover).toHaveCount(0)
  // Outside click drops the unsaved edit too.
  await clickHighlight(page, mark)
  await expect(editor).toHaveValue('Worth a second read')
  await editor.fill('discarded by outside click')
  await page.mouse.click(5, 5)
  await expect(popover).toHaveCount(0)
  await page.waitForTimeout(300)
  expect((await liveRecords(serviceWorker))[0]?.comment).toBe('Worth a second read')

  // Esc with focus moved back to the page (a dot was clicked, then focus left the shadow root).
  await clickHighlight(page, mark)
  await expect(popover).toBeVisible()
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Escape')
  await expect(popover).toHaveCount(0)

  expect(externalRequests).toEqual([])
})

test('focus moves into the popover and returns to where it was on close', async ({ context, serviceWorker, server }) => {
  const page = await context.newPage()
  await openArticle(page, `${server.origin}/article.html`)
  const id = await createHighlight(page, '#target', 0, serviceWorker)
  // A focusable ancestor: clicking the highlight focuses it before the popover opens.
  await page.locator('#target').evaluate((el) => el.setAttribute('tabindex', '-1'))

  await clickHighlight(page, markOf(page, id))
  const editor = page.locator(`${POPOVER} textarea`)
  await expect(editor).toBeFocused()
  await editor.press('Escape')
  await expect(page.locator(POPOVER)).toHaveCount(0)
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('target')

  // Saving also returns focus.
  await clickHighlight(page, markOf(page, id))
  await editor.fill('note')
  await editor.press('ControlOrMeta+Enter')
  await expect(page.locator(POPOVER)).toHaveCount(0)
  expect(await page.evaluate(() => document.activeElement?.id)).toBe('target')
})

test('only one overlay at a time: the popover closes the floating menu and the preview', async ({
  context,
  serviceWorker,
  server,
}) => {
  const page = await context.newPage()
  await openArticle(page, `${server.origin}/article.html`)
  const id = await createHighlight(page, '#target', 0, serviceWorker)
  const mark = markOf(page, id)
  await clickHighlight(page, mark)
  const editor = page.locator(`${POPOVER} textarea`)
  await editor.fill('has a comment')
  await editor.press('ControlOrMeta+Enter')
  await expect(mark).toHaveClass(/noteit-commented/)

  // Hover shows the preview; clicking the highlight replaces it with the popover. The mouse is still
  // on the highlight after the save, so it leaves first to produce a fresh mouseover.
  await page.mouse.move(1, 1)
  await hoverHighlight(page, mark)
  await expect(page.locator(PREVIEW)).toBeVisible()
  await clickHighlight(page, mark)
  await expect(page.locator(POPOVER)).toBeVisible()
  await expect(page.locator(PREVIEW)).toHaveCount(0)
  // Hovering again while the popover is open shows no preview.
  await page.mouse.move(1, 1)
  await hoverHighlight(page, mark)
  await page.waitForTimeout(200)
  await expect(page.locator(PREVIEW)).toHaveCount(0)

  // A new selection opens the floating menu and closes the popover; clicking the highlight closes the menu.
  await dragSelect(page, page.locator('#intro'))
  await expect(page.locator(MENU)).toBeVisible()
  await expect(page.locator(POPOVER)).toHaveCount(0)
  await clickHighlight(page, mark)
  await expect(page.locator(POPOVER)).toBeVisible()
  await expect(page.locator(MENU)).toHaveCount(0)
  expect(await page.locator('noteit-root .nt-overlay').count()).toBe(1)
})

test('popover delete shows the undo toast in place, in this tab only; undo restores everywhere', async ({
  context,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const page = await context.newPage()
  await openArticle(page, url)
  await createHighlight(page, '#intro', 0, serviceWorker)
  const id = await createHighlight(page, '#target', 2, serviceWorker)
  const second = await context.newPage()
  await openArticle(second, url)
  await expect(markOf(second, id)).toBeVisible()

  const panel = await openSidePanel()
  await page.bringToFront()
  const items = panel.getByTestId('current-page-view').getByTestId('highlight-item')
  await expect(items).toHaveCount(2)

  let dialogs = 0
  page.on('dialog', () => dialogs++)
  await clickHighlight(page, markOf(page, id))
  const popover = page.locator(POPOVER)
  await expect(popover).toBeVisible()
  const popBox = (await popover.boundingBox())!
  await popover.getByRole('button', { name: strings.deleteHighlight }).click()

  // Popover closed, highlight gone here and in the other tab, record soft-deleted.
  await expect(popover).toHaveCount(0)
  await expect(page.locator(`[data-noteit-id="${id}"]`)).toHaveCount(0)
  await expect(second.locator(`[data-noteit-id="${id}"]`)).toHaveCount(0)
  await expect(items).toHaveCount(1)
  expect((await dumpLocalDb(serviceWorker)).records.find((r) => r.id === id)?.deletedAt).not.toBeNull()

  // Toast at the former popover position, announced politely; nowhere else.
  const toast = page.locator(TOAST)
  await expect(toast).toBeVisible()
  await expect(toast).toContainText(strings.deleted)
  await expect(toast).toContainText(strings.undo)
  await expect(page.locator('noteit-root [data-noteit-toast-region]')).toHaveAttribute('aria-live', 'polite')
  const toastBox = (await toast.boundingBox())!
  expect(Math.abs(toastBox.x - popBox.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(toastBox.y - popBox.y)).toBeLessThanOrEqual(1)
  await expect(panel.getByTestId('undo-toast')).toHaveCount(0)
  await expect(second.locator(TOAST)).toHaveCount(0)

  // Undo: back in this tab, the other tab and the side panel.
  await toast.getByRole('button', { name: strings.undo }).click()
  await expect(toast).toHaveCount(0)
  await expect(markOf(page, id)).toBeVisible()
  await expect(markOf(second, id)).toBeVisible()
  await expect(items).toHaveCount(2)
  expect((await liveRecords(serviceWorker)).find((r) => r.id === id)?.color).toBe('blue')

  // Delete again and let the window pass: the toast goes, the record stays soft-deleted.
  await clickHighlight(page, markOf(page, id))
  await popover.getByRole('button', { name: strings.deleteHighlight }).click()
  await expect(toast).toBeVisible()
  await expect(toast).toHaveCount(0, { timeout: 7000 })
  expect((await dumpLocalDb(serviceWorker)).records.find((r) => r.id === id)?.deletedAt).not.toBeNull()
  await expect(page.locator(`[data-noteit-id="${id}"]`)).toHaveCount(0)
  expect(dialogs).toBe(0)

  expect(externalRequests).toEqual([])
})
