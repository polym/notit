// Story 3.8: side panel inline edit, delete and undo. Hovering an item floats the color dots, comment
// and delete buttons; color changes and comments go through the service worker and reach the page;
// delete shows the deleted + undo toast for 5 seconds in the side panel only, and undo restores the highlight in
// every tab of the page.
import type { Page } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { dumpLocalDb, enableSite, liveRecords, openExtensionPage, resetLocalData } from '../helpers/local-db.ts'
import { clickMenuButton, computedColor, dragSelect } from './fixtures/page-actions.ts'
import { colors } from '../../src/ui/tokens/index.ts'
import { strings } from '../../src/ui/strings.ts'

const SITE = '127.0.0.1'

async function openArticle(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
}

/** Background color of the first rendered span of a highlight. */
function markColor(page: Page, id: string): Promise<string> {
  return page.locator(`[data-noteit-id="${id}"]`).first().evaluate((el) => getComputedStyle(el).backgroundColor)
}

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  // Story 2.15 login gate: highlight writes need a session.
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  await ext.close()
})

test('hover actions change color and comment without optimistic updates', async ({
  context,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const page = await context.newPage()
  await openArticle(page, url)
  await dragSelect(page, page.locator('#target'))
  await clickMenuButton(page, 0)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
  const [record] = await liveRecords(serviceWorker)
  expect(record.color).toBe('yellow')

  const panel = await openSidePanel()
  await page.bringToFront()
  const item = panel.getByTestId('current-page-view').getByTestId('highlight-item')
  await expect(item).toHaveCount(1)

  // Hover: the actions bar shows at top 4px / right 6px and the text keeps 136px clear.
  const actions = item.getByTestId('item-actions')
  await expect(actions).toHaveCSS('opacity', '0')
  await item.hover()
  await expect(actions).toHaveCSS('opacity', '1')
  await expect(actions).toHaveCSS('top', '4px')
  await expect(actions).toHaveCSS('right', '6px')
  await expect(item.getByTestId('highlight-body')).toHaveCSS('padding-right', '136px')
  const dots = actions.getByTestId('color-dot')
  await expect(dots).toHaveCount(4)
  await expect(actions.getByRole('button', { name: strings.colorYellow })).toHaveAttribute('aria-pressed', 'true')

  // Color: written by the SW, the panel and the page follow db/changed and page/sync.
  await actions.getByRole('button', { name: strings.colorOrange }).click()
  await expect.poll(async () => (await liveRecords(serviceWorker))[0]?.color).toBe('orange')
  await expect(item.getByRole('img', { name: strings.colorOrange })).toHaveCount(1)
  await expect(actions.getByRole('button', { name: strings.colorOrange })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => markColor(page, record.id)).toBe(await computedColor(page, colors['highlight-orange']))

  // Comment: Esc cancels without writing.
  await actions.getByRole('button', { name: strings.commentAdd }).click()
  const editor = item.getByTestId('comment-editor')
  await expect(editor).toBeFocused()
  await editor.fill('discarded')
  // Keys pressed during IME composition belong to the IME: neither Esc nor Ctrl/Cmd+Enter acts.
  for (const init of [
    { key: 'Escape' },
    { key: 'Enter', ctrlKey: true },
    { key: 'Enter', metaKey: true },
  ]) {
    await editor.dispatchEvent('keydown', { ...init, isComposing: true, bubbles: true, cancelable: true })
  }
  await expect(editor).toHaveCount(1)
  await expect(editor).toHaveValue('discarded')
  expect((await liveRecords(serviceWorker))[0]?.comment).toBeNull()
  await editor.press('Escape')
  await expect(editor).toHaveCount(0)
  expect((await liveRecords(serviceWorker))[0]?.comment).toBeNull()

  // Ctrl/Cmd+Enter saves; the color stays as it was.
  await item.hover()
  await actions.getByRole('button', { name: strings.commentAdd }).click()
  await editor.fill('Keep this in mind')
  await editor.press('ControlOrMeta+Enter')
  await expect(editor).toHaveCount(0)
  await expect(item.getByTestId('highlight-comment')).toHaveText('Keep this in mind')
  const [saved] = await liveRecords(serviceWorker)
  expect(saved.comment).toBe('Keep this in mind')
  expect(saved.color).toBe('orange')

  // Editing prefills the existing comment.
  await item.hover()
  await actions.getByRole('button', { name: strings.commentEdit }).click()
  await expect(editor).toHaveValue('Keep this in mind')
  await editor.press('Escape')

  expect(externalRequests).toEqual([])
})

test('delete shows the undo toast in the side panel only and undo restores every tab', async ({
  context,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const page = await context.newPage()
  await openArticle(page, url)
  await dragSelect(page, page.locator('#intro'))
  await clickMenuButton(page, 0)
  await dragSelect(page, page.locator('#target'))
  await clickMenuButton(page, 2)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(2)
  const target = (await liveRecords(serviceWorker)).find((r) => r.text.includes('survive'))
  if (!target) throw new Error('target highlight missing')
  // A second tab of the same page.
  const second = await context.newPage()
  await openArticle(second, url)
  await expect(second.locator(`[data-noteit-id="${target.id}"]`).first()).toBeVisible()

  const panel = await openSidePanel()
  await page.bringToFront()
  const view = panel.getByTestId('current-page-view')
  const items = view.getByTestId('highlight-item')
  await expect(items).toHaveCount(2)
  await expect(items.nth(1)).toContainText('survive')

  // Delete: immediate, no confirm dialog; toast bottom center with aria-live polite.
  let dialogs = 0
  panel.on('dialog', () => dialogs++)
  const deletedItem = items.nth(1)
  await deletedItem.hover()
  await deletedItem.getByRole('button', { name: strings.deleteHighlight }).click()
  await expect(items).toHaveCount(1)
  await expect(view.getByTestId('item-count')).toHaveText(strings.itemCount(1))
  const toast = panel.getByTestId('undo-toast')
  await expect(toast).toBeVisible()
  await expect(toast).toContainText(strings.deleted)
  await expect(panel.getByTestId('undo-toast-region')).toHaveAttribute('aria-live', 'polite')
  const box = await toast.boundingBox()
  const viewport = panel.viewportSize()
  if (!box || !viewport) throw new Error('no layout')
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1)
  expect(Math.round(viewport.height - (box.y + box.height))).toBe(16)
  await expect(page.locator(`[data-noteit-id="${target.id}"]`)).toHaveCount(0)
  await expect(second.locator(`[data-noteit-id="${target.id}"]`)).toHaveCount(0)
  // The page tabs never show the toast.
  await expect(page.getByText(strings.deleted)).toHaveCount(0)
  await expect(second.getByText(strings.deleted)).toHaveCount(0)

  // Undo within 5 seconds: back in place in the panel and in both tabs.
  await toast.getByRole('button', { name: strings.undo }).click()
  await expect(toast).toHaveCount(0)
  await expect(items).toHaveCount(2)
  await expect(items.nth(1)).toContainText('survive')
  await expect(page.locator(`[data-noteit-id="${target.id}"]`).first()).toBeVisible()
  await expect(second.locator(`[data-noteit-id="${target.id}"]`).first()).toBeVisible()
  expect((await liveRecords(serviceWorker)).length).toBe(2)

  // Delete again and let the window pass: the toast goes, the record stays soft-deleted.
  await items.nth(1).hover()
  await items.nth(1).getByRole('button', { name: strings.deleteHighlight }).click()
  await expect(toast).toBeVisible()
  await expect(toast).toHaveCount(0, { timeout: 7000 })
  const stored = (await dumpLocalDb(serviceWorker)).records.find((r) => r.id === target.id)
  expect(stored?.deletedAt).not.toBeNull()
  await expect(items).toHaveCount(1)
  expect(dialogs).toBe(0)

  expect(externalRequests).toEqual([])
})

test('item actions are reachable with the keyboard and dots are named by color', async ({
  context,
  serviceWorker,
  server,
  openSidePanel,
}) => {
  const url = `${server.origin}/article.html`
  const page = await context.newPage()
  await openArticle(page, url)
  await dragSelect(page, page.locator('#target'))
  await clickMenuButton(page, 0)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)

  const panel = await openSidePanel()
  await page.bringToFront()
  const item = panel.getByTestId('current-page-view').getByTestId('highlight-item')
  await expect(item).toHaveCount(1)
  const actions = item.getByTestId('item-actions')

  // Focus the item's text button: the actions show without hover, and Tab walks through them.
  await item.getByTestId('highlight-text').evaluate((el) => (el.closest('button') as HTMLButtonElement).focus())
  await expect(actions).toHaveCSS('opacity', '1')
  const names = [strings.colorYellow, strings.colorOrange, strings.colorBlue, strings.colorGreen, strings.commentAdd, strings.deleteHighlight]
  for (const name of names) {
    await panel.keyboard.press('Tab')
    await expect(actions.getByRole('button', { name, exact: true })).toBeFocused()
    await expect(actions).toHaveCSS('opacity', '1')
  }

  // Enter on a focused dot changes the color.
  await actions.getByRole('button', { name: strings.colorGreen, exact: true }).focus()
  await panel.keyboard.press('Enter')
  await expect.poll(async () => (await liveRecords(serviceWorker))[0]?.color).toBe('green')
})
