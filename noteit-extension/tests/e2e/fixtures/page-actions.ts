// Page interactions shared by the e2e and perf cases.
// - Selection menu (Story 3.13): Preact FloatingMenu inside the open <noteit-root> shadow root; its
//   buttons are real <button>s, located through the shadow root.
// - Comment preview (Story 3.14): read-only tooltip in the same shadow root, shown on hover.
import type { Locator, Page } from '@playwright/test'

/** Selection menu selector (pierces the open shadow root). */
export const MENU = 'noteit-root [data-noteit-menu]'
/** Selection menu order: four color dots (yellow first), then the comment button. */
export const MENU_COLORS = ['yellow', 'orange', 'blue', 'green'] as const
export const COMMENT_BUTTON_INDEX = MENU_COLORS.length

/** Comment preview selector (pierces the open shadow root). */
export const PREVIEW = 'noteit-root [data-noteit-preview]'

/** Highlight popover selector (Story 3.15, pierces the open shadow root). */
export const POPOVER = 'noteit-root [data-noteit-popover]'
/** In-page undo toast selector (Story 3.15, pierces the open shadow root). */
export const TOAST = 'noteit-root [data-noteit-toast]'

/** Clicks a rendered highlight with the mouse (a real mousedown / mouseup / click on the page). */
export async function clickHighlight(page: Page, highlight: Locator): Promise<void> {
  const box = await highlight.boundingBox()
  if (!box) throw new Error('highlight has no layout box')
  await page.mouse.click(box.x + 4, box.y + box.height / 2)
}

/** Drag-selects the text of `target` with the mouse so the content script sees a real mouseup. */
export async function dragSelect(page: Page, target: Locator): Promise<string> {
  const box = await target.boundingBox()
  if (!box) throw new Error('target has no layout box')
  const textWidth = await target.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getBoundingClientRect().width
  })
  await page.mouse.move(box.x + 1, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + textWidth - 1, box.y + box.height / 2, { steps: 10 })
  await page.mouse.up()
  return page.evaluate(() => window.getSelection()?.toString().trim() ?? '')
}

/** The n-th button of the visible selection menu (0-3 color dots, 4 the comment button). */
export function menuButton(page: Page, index: number): Locator {
  return page.locator(`${MENU} button`).nth(index)
}

/** Clicks the n-th selection menu button with the mouse (a real mousedown / mouseup on the page). */
export async function clickMenuButton(page: Page, index: number): Promise<void> {
  const button = menuButton(page, index)
  await button.waitFor({ state: 'visible' })
  const box = await button.boundingBox()
  if (!box) throw new Error('menu button has no layout box')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

/** Moves the mouse onto a rendered highlight (a real mouseover on the page). */
export async function hoverHighlight(page: Page, highlight: Locator): Promise<void> {
  const box = await highlight.boundingBox()
  if (!box) throw new Error('highlight has no layout box')
  await page.mouse.move(box.x + 4, box.y + box.height / 2)
}

/**
 * True when the highlight shows the comment marker (highlight-mark-commented: a ::after bubble on its
 * last fragment). Pass the locator of all fragments of one highlight.
 */
export function hasCommentMarker(highlight: Locator): Promise<boolean> {
  return highlight.last().evaluate((el) => getComputedStyle(el, '::after').content !== 'none')
}

/** Computed background-color string the page reports for a CSS color value (e.g. an 8-digit hex token). */
export function computedColor(page: Page, value: string): Promise<string> {
  return page.evaluate((v) => {
    const el = document.createElement('span')
    el.style.backgroundColor = v
    document.body.append(el)
    const out = getComputedStyle(el).backgroundColor
    el.remove()
    return out
  }, value)
}
