// Regression: highlighting text inside an inline SVG (<text> / <tspan>) must never make it vanish.
// MarkRenderer used to wrap SVG text in an HTML <mark>, which SVG does not render, so the selected
// diagram text disappeared (claude.dev/blog/solving-code-review-at-anthropic). SVG text is now
// painted with a <rect> behind its <text>; HTML text around it is painted with marks as before.
import type { Page } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { enableSite, liveRecords, openExtensionPage, resetLocalData } from '../helpers/local-db.ts'
import { MENU, POPOVER, clickMenuButton, dragSelect } from './fixtures/page-actions.ts'

const SITE = '127.0.0.1'
const ROWS = ['#row1', '#row2', '#row3']
const SVG_RECTS = '#diagram rect.noteit-svg-highlight'

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  await ext.close()
})

async function openDiagram(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
}

/** Rendered width of every SVG text row (0 when its text is not drawn). */
const rowWidths = (page: Page) =>
  page.evaluate((ids) => ids.map((id) => (document.querySelector(id) as SVGTextElement).getBBox().width), ROWS)

/** Viewport point at a character offset of the first text node under `selector`. */
const charPoint = (page: Page, selector: string, offset: number, side: 'left' | 'right') =>
  page.evaluate(
    ({ selector, offset, side }) => {
      const walker = document.createTreeWalker(document.querySelector(selector)!, NodeFilter.SHOW_TEXT)
      const node = walker.nextNode() as Text
      const range = document.createRange()
      range.setStart(node, side === 'left' ? offset : offset - 1)
      range.setEnd(node, side === 'left' ? offset + 1 : offset)
      const r = range.getBoundingClientRect()
      return { x: side === 'left' ? r.left + 1 : r.right - 1, y: r.top + r.height / 2 }
    },
    { selector, offset, side },
  )

/** Mouse-drags from the start of `from` to the end of `to` (a real mouseup for the content script). */
async function dragAcross(page: Page, from: string, to: string): Promise<string> {
  const toLength = await page.locator(to).evaluate((el) => el.textContent!.length)
  const start = await charPoint(page, from, 0, 'left')
  const end = await charPoint(page, to, toLength, 'right')
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 15 })
  await page.mouse.up()
  return page.evaluate(() => window.getSelection()?.toString().trim() ?? '')
}

test('highlighting SVG diagram text keeps it visible, also after a reload', async ({
  context,
  serviceWorker,
  server,
  externalRequests,
}, testInfo) => {
  const page = await context.newPage()
  await openDiagram(page, `${server.origin}/svg-diagram.html`)
  const before = await rowWidths(page)
  expect(before.every((w) => w > 0)).toBe(true)
  await page.locator('#diagram').screenshot({ path: testInfo.outputPath('svg-before.png') })

  const selected = await dragAcross(page, '#row1', '#row2')
  expect(selected).toContain('Lint, types, tests across platforms')
  expect(selected).toContain('blocks the merge')
  await clickMenuButton(page, 0)
  await expect(page.locator(MENU)).toHaveCount(0)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)

  // The highlight is saved and drawn as one rect per row; nothing is wrapped and every row is still drawn.
  expect(await page.locator('#diagram mark').count()).toBe(0)
  await expect(page.locator(SVG_RECTS)).toHaveCount(2)
  expect(await rowWidths(page)).toEqual(before)
  await page.locator('#diagram').screenshot({ path: testInfo.outputPath('svg-after-highlight.png') })

  // Clicking the highlighted SVG text opens the highlight popover.
  const box = (await page.locator('#row1').boundingBox())!
  await page.mouse.click(box.x + 20, box.y + box.height / 2)
  await expect(page.locator(POPOVER)).toBeVisible()
  await page.keyboard.press('Escape')

  // Restore on reload goes through the same renderer.
  await openDiagram(page, `${server.origin}/svg-diagram.html`)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)
  await page.waitForTimeout(500)
  expect(await page.locator('#diagram mark').count()).toBe(0)
  await expect(page.locator(SVG_RECTS)).toHaveCount(2)
  expect(await rowWidths(page)).toEqual(before)
  await page.locator('#diagram').screenshot({ path: testInfo.outputPath('svg-after-reload.png') })

  expect(externalRequests).toEqual([])
})

test('HTML text on the same page is still painted; a range into the SVG paints both parts', async ({
  context,
  serviceWorker,
  server,
  externalRequests,
}, testInfo) => {
  const page = await context.newPage()
  await openDiagram(page, `${server.origin}/svg-diagram.html`)
  const before = await rowWidths(page)

  // Control: a plain paragraph highlight still paints a mark.
  await dragSelect(page, page.locator('#outro'))
  await clickMenuButton(page, 0)
  await expect(page.locator('#outro .noteit-highlight').first()).toBeVisible()
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(1)

  // Mixed: from the intro paragraph into the first diagram row.
  const selected = await dragAcross(page, '#intro', '#row1')
  expect(selected).toContain('Every pull request')
  await clickMenuButton(page, 2)
  await expect.poll(async () => (await liveRecords(serviceWorker)).length).toBe(2)
  await expect(page.locator('#intro .noteit-highlight').first()).toBeVisible()
  // The drag crosses the "Required CI" label before #row1 in document order: both get a rect.
  await expect(page.locator(SVG_RECTS)).toHaveCount(2)
  expect(await page.locator('#row1').evaluate((el) => el.previousElementSibling?.matches('rect.noteit-svg-highlight'))).toBe(true)
  expect(await page.locator('#diagram mark').count()).toBe(0)
  expect(await rowWidths(page)).toEqual(before)
  await page.screenshot({ path: testInfo.outputPath('mixed-page.png') })

  expect(externalRequests).toEqual([])
})
