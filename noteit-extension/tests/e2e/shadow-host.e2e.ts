// In-page Shadow host isolation (Story 3.12, NFR19, architecture.md D10): on a page with hostile global
// styles, mounting <noteit-root> leaves the page's layout and colors unchanged, and content inside the
// shadow root renders exactly as it does on a plain page.
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/extension.ts'

const PAGE_IDS = ['box-a', 'para', 'box-b']

/** Bounding rects and computed colors of the page's own elements. */
async function snapshot(page: Page) {
  return page.evaluate((ids) => {
    const els = [document.documentElement, document.body, ...ids.map((id) => document.getElementById(id)!)]
    return els.map((el) => {
      const r = el.getBoundingClientRect()
      return { tag: el.tagName, rect: [r.left, r.top, r.width, r.height], color: getComputedStyle(el).color }
    })
  }, PAGE_IDS)
}

/** Renders a sample overlay inside the shadow root and returns a screenshot of it. */
async function overlayScreenshot(page: Page) {
  await page.evaluate(() => {
    const root = document.querySelector('noteit-root')!.shadowRoot!
    root.querySelector('#sample')?.remove()
    const el = document.createElement('div')
    el.id = 'sample'
    el.className = 'nt-overlay'
    el.textContent = 'Sample overlay text'
    el.style.cssText =
      'left: 20px; top: 200px; width: 180px; padding: 4px 8px; background: var(--nt-background); border: 1px solid var(--nt-border-strong);'
    root.append(el)
  })
  const sample = page.locator('noteit-root #sample')
  await expect(sample).toBeVisible()
  return sample.screenshot({ animations: 'disabled' })
}

test('the shadow host does not change a hostile page and is not changed by it', async ({ context, server }) => {
  const page = await context.newPage()
  await page.goto(`${server.origin}/aggressive-styles.html`)
  // The content script mounts the host on every page, whether or not the site is enabled.
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('noteit-root').length)).toBe(1)
  expect(await page.evaluate(() => document.documentElement.lastElementChild?.tagName)).toBe('NOTEIT-ROOT')
  expect(await page.evaluate(() => document.querySelector('noteit-root')!.shadowRoot?.mode)).toBe('open')

  const host = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('noteit-root')!)
    return { position: s.position, pointerEvents: s.pointerEvents, zIndex: s.zIndex, width: s.width, height: s.height }
  })
  expect(host).toEqual({ position: 'fixed', pointerEvents: 'none', zIndex: '2147483647', width: '0px', height: '0px' })

  const withHost = await snapshot(page)
  // Detach and re-attach the host: the page must look the same in both states.
  await page.evaluate(() => {
    ;(window as unknown as { __host: Element }).__host = document.querySelector('noteit-root')!
    document.querySelector('noteit-root')!.remove()
  })
  const withoutHost = await snapshot(page)
  await page.evaluate(() => document.documentElement.append((window as unknown as { __host: Element }).__host))
  const reattached = await snapshot(page)

  expect(withoutHost).toEqual(withHost)
  expect(reattached).toEqual(withHost)
  // Sanity check that the hostile styles are in effect.
  expect(withHost.find((e) => e.tag === 'DIV')?.color).toBe('rgb(255, 0, 0)')

  // Overlay content keeps the token styles, not the page's `div { color: red !important }`.
  const hostileShot = await overlayScreenshot(page)
  const overlayColor = await page.evaluate(
    () => getComputedStyle(document.querySelector('noteit-root')!.shadowRoot!.querySelector('#sample')!).color,
  )
  expect(overlayColor).not.toBe('rgb(255, 0, 0)')

  const plain = await context.newPage()
  await plain.goto(`${server.origin}/article.html`)
  await expect.poll(() => plain.evaluate(() => document.querySelectorAll('noteit-root').length)).toBe(1)
  const plainShot = await overlayScreenshot(plain)
  expect(hostileShot.equals(plainShot), 'overlay renders identically on hostile and plain pages').toBe(true)
})

test('a standalone SVG document gets no shadow host and the host mount does not throw', async ({ context, server }) => {
  const page = await context.newPage()
  const messages: string[] = []
  page.on('console', (m) => messages.push(m.text()))
  page.on('pageerror', (e) => messages.push(e.message))
  await page.goto(`${server.origin}/drawing.svg`)
  expect(await page.evaluate(() => document.contentType)).toBe('image/svg+xml')
  // The content script ran. It logs on load, before the shadow host mount, so this alone does not
  // prove the script got past the mount; the checks below only show the mount itself did not throw.
  // A page/ping round trip is not asserted: MarkRenderer (pre-existing behavior, outside this story)
  // throws on documents without <head>, so the router never registers on standalone SVG.
  await expect.poll(() => messages.some((m) => m.includes('[NoteIt] Content Script Loaded'))).toBe(true)
  await page.waitForTimeout(500)
  expect(messages.filter((m) => /attachShadow|NotSupportedError|Shadow host not mounted/.test(m))).toEqual([])
  expect(await page.evaluate(() => document.getElementsByTagName('noteit-root').length)).toBe(0)
})
