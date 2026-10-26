// Story 3.11 (FR44, NFR18, NFR20, NFR21): Accessibility Floor of the side panel.
// - chrome.sidePanel undefined (Arc): only the fixed unsupported-notice renders.
// - Keyboard walkthrough: Tab order header (toggle -> sync-status -> account) -> module tab -> segmented
//   control -> list items; turning the site on, switching views, expanding a page group, changing a color,
//   writing a comment, deleting and undoing, opening the account panel and signing out, keyboard only.
// - Real buttons / inputs with names; 2px ring focus outline on :focus-visible only.
// - axe: no serious / critical violations on login, current page, all sites, account panel, logout confirm.
// - 300px and 600px widths: single full-width column, two-line clamp, item actions usable, no horizontal scroll.
// Needs the local Supabase stack (npm run db:start, env:local, build).
import AxeBuilder from '@axe-core/playwright'
import type { Locator, Page, Worker } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { computeSeedsInPage, type ExpectedHighlight } from '../corpus/runner.ts'
import { enableSite, extensionRequest, openExtensionPage, resetLocalData, seedHighlights, seedToCreateReq } from '../helpers/local-db.ts'
import { strings } from '../../src/ui/strings.ts'
import { colors } from '../../src/ui/tokens/index.ts'

const SITE = '127.0.0.1'
const ARTICLE_TITLE = 'NoteIt smoke article'
const LONG_TITLE = 'NoteIt long article'
const RPC = '**/rest/v1/rpc/sync_push'
// Same context length as src/content/SelectionManager.ts getSelectionContext.
const CONTEXT_LENGTH = 64
const COMMENT = 'typed with the keyboard'

/** CSS rgb() string of a #RRGGBB token, as getComputedStyle reports it. */
function rgb(hex: string): string {
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16)
  return `rgb(${n(1)}, ${n(3)}, ${n(5)})`
}

/** Seeds anchored highlights on `path` (computed in a throwaway tab so the anchors are real). */
async function seedPage(ext: Page, origin: string, path: string, title: string, targets: ExpectedHighlight[]): Promise<void> {
  const url = `${origin}/${path}`
  const probe = await ext.context().newPage()
  await probe.goto(url)
  const seeds = await probe.evaluate(computeSeedsInPage, { highlights: targets, contextLength: CONTEXT_LENGTH })
  await probe.close()
  if (typeof seeds === 'string') throw new Error(seeds)
  await seedHighlights(
    ext,
    seeds.map((s) => seedToCreateReq(s, url, title)),
  )
}

/**
 * Two pages of highlights; the long article is seeded first so the smoke article is the most recent
 * group (expanded by default) and the long article starts collapsed. The site is then turned off so the
 * walkthrough turns it on from the header.
 */
async function seedTwoPages(ext: Page, origin: string, siteOff: boolean): Promise<void> {
  await enableSite(ext, SITE)
  await seedPage(ext, origin, 'long-article.html', LONG_TITLE, [{ id: 'l', text: 'opening paragraph', scope: '#intro' }])
  await seedPage(ext, origin, 'article.html', ARTICLE_TITLE, [
    { id: 'a', text: 'quick brown fox', scope: '#intro' },
    { id: 'b', text: 'survive a page reload', scope: '#target' },
  ])
  if (siteOff) {
    const off = await extensionRequest<void>(ext, 'site/setEnabled', { siteKey: SITE, enabled: false })
    if (!off.ok) throw new Error(`site/setEnabled failed: ${JSON.stringify(off.error)}`)
  }
}

/** Waits until the content script of the tab showing `url` answers page/ping (imported asynchronously). */
async function waitForContentScript(serviceWorker: Worker, url: string): Promise<void> {
  await expect
    .poll(() =>
      serviceWorker.evaluate(async (target) => {
        const tab = (await chrome.tabs.query({})).find((t) => t.url === target)
        if (tab?.id === undefined) return false
        try {
          const res = (await chrome.tabs.sendMessage(tab.id, { kind: 'noteit/request', type: 'page/ping', req: {} })) as { ok?: boolean }
          return res?.ok === true
        } catch {
          return false
        }
      }, url),
    )
    .toBe(true)
}

/**
 * Opens the article and then the side panel in the same window, with the article as the active tab.
 * The article's content script answers first, so the panel's site state never settles on unsupported
 * under load.
 */
async function panelForArticle(
  openSidePanel: (page?: Page, options?: { signIn?: boolean }) => Promise<Page>,
  serviceWorker: Worker,
  article: Page,
  url: string,
): Promise<Page> {
  await article.goto(url)
  await article.waitForLoadState('load')
  await waitForContentScript(serviceWorker, url)
  const panel = await openSidePanel()
  await article.bringToFront()
  await expect(panel.getByTestId('page-title')).toHaveText(ARTICLE_TITLE)
  return panel
}

/** testid / role / name of the focused element, for readable assertions. */
function focused(panel: Page): Promise<string> {
  return panel.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el || el === document.body) return 'body'
    // Color dots share one testid; their color name tells them apart.
    if (el.dataset.testid === 'color-dot') return el.getAttribute('aria-label') ?? 'color-dot'
    return el.dataset.testid ?? el.getAttribute('aria-label') ?? el.textContent?.trim() ?? el.tagName
  })
}

/** Presses Tab (or Shift+Tab) until `target` has focus; fails after `max` presses. */
async function tabTo(panel: Page, target: Locator, options: { back?: boolean; max?: number } = {}): Promise<void> {
  const key = options.back ? 'Shift+Tab' : 'Tab'
  for (let i = 0; i < (options.max ?? 40); i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return
    await panel.keyboard.press(key)
  }
  throw new Error(`could not reach the target with ${key}; focus is on ${await focused(panel)}`)
}

/** Focus outline of the focused element, as computed. */
function focusOutline(panel: Page): Promise<{ style: string; width: string; color: string }> {
  return panel.evaluate(() => {
    const s = getComputedStyle(document.activeElement!)
    return { style: s.outlineStyle, width: s.outlineWidth, color: s.outlineColor }
  })
}

const RING = { style: 'solid', width: '2px', color: rgb(colors.ring) }

/** Serious / critical axe violations of the current panel state, as "rule: targets" lines. */
async function seriousViolations(panel: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page: panel }).analyze()
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
}

test.beforeEach(async ({ serviceWorker }) => {
  await resetLocalData(serviceWorker)
})

test('without chrome.sidePanel (Arc) only the fixed unsupported-notice renders', async ({ context, extensionId, externalRequests }) => {
  await context.addInitScript(() => {
    if (location.protocol !== 'chrome-extension:' || typeof chrome === 'undefined') return
    Object.defineProperty(chrome, 'sidePanel', { value: undefined, configurable: true })
  })
  const panel = await context.newPage()
  await panel.goto(`chrome-extension://${extensionId}/src/entries/sidepanel/index.html`)

  const notice = panel.getByTestId('unsupported-notice')
  await expect(notice).toHaveText(strings.browserUnsupported)
  await expect(notice).toHaveCSS('background-color', rgb(colors.hover))
  await expect(notice).toHaveCSS('border-top-width', '1px')
  // Nothing else: no login form, header, module tabs or content, and nothing to dismiss the notice.
  await expect(panel.getByTestId('login-form')).toHaveCount(0)
  await expect(panel.getByTestId('sidebar-shell')).toHaveCount(0)
  await expect(panel.locator('button, input, textarea, a')).toHaveCount(0)
  expect(await seriousViolations(panel)).toEqual([])
  expect(externalRequests).toEqual([])
})

test('keyboard only: turn the site on, edit, delete and undo, switch views, expand a group, sign out', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  // Every push fails, so the edits below stay pending and sign-out asks first.
  await context.route(RPC, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'boom' }) }),
  )
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await seedTwoPages(ext, server.origin, true)
  await ext.close()

  const url = `${server.origin}/article.html`
  const article = await context.newPage()
  const panel = await panelForArticle(openSidePanel, serviceWorker, article, url)
  const header = panel.getByTestId('sidebar-header')
  const toggle = header.getByRole('switch')
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await expect(toggle).toBeEnabled()

  // Tab order starts in the header: toggle -> sync-status -> account.
  await panel.locator('body').focus()
  await panel.keyboard.press('Tab')
  expect(await focused(panel)).toBe('site-toggle')
  expect(await focusOutline(panel)).toEqual(RING)

  // Turn the site on.
  await panel.keyboard.press('Space')
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  const current = panel.getByTestId('current-page-view')
  await expect(current.getByTestId('highlight-item')).toHaveCount(2)

  const order: string[] = []
  for (let i = 0; i < 6; i++) {
    await panel.keyboard.press('Tab')
    order.push(await focused(panel))
    expect(await focusOutline(panel)).toEqual(RING)
  }
  expect(order).toEqual([
    'sync-status',
    'account-button',
    'module-tab-highlight',
    strings.viewCurrentPage,
    strings.viewAllSites,
    // First list item: its jump button (the highlight text).
    'quick brown fox',
  ])

  // Item actions: four color dots, comment, delete; visible while the row holds focus.
  const item = current.getByTestId('highlight-item').first()
  await panel.keyboard.press('Tab')
  expect(await focused(panel)).toBe(strings.colorYellow)
  await expect(item.getByTestId('item-actions')).toHaveCSS('opacity', '1')
  await panel.keyboard.press('Tab')
  expect(await focused(panel)).toBe(strings.colorOrange)
  await panel.keyboard.press('Enter')
  await expect(item).toHaveAttribute('data-color', 'orange')

  // Write a comment: comment button -> editor -> Ctrl+Enter; focus returns to the comment button.
  await tabTo(panel, item.getByTestId('item-comment'))
  await panel.keyboard.press('Enter')
  const editor = item.getByTestId('comment-editor')
  await expect(editor).toBeFocused()
  await panel.keyboard.type(COMMENT)
  await panel.keyboard.press('Control+Enter')
  await expect(item.getByTestId('highlight-comment')).toHaveText(COMMENT)
  await expect(item.getByTestId('item-comment')).toBeFocused()

  // Delete, then undo from the toast.
  await panel.keyboard.press('Tab')
  expect(await focused(panel)).toBe('item-delete')
  await panel.keyboard.press('Enter')
  await expect(current.getByTestId('highlight-item')).toHaveCount(1)
  const undo = panel.getByTestId('undo-toast').getByRole('button', { name: strings.undo })
  await expect(undo).toBeVisible()
  await tabTo(panel, undo)
  await panel.keyboard.press('Enter')
  await expect(current.getByTestId('highlight-item')).toHaveCount(2)

  // Switch to all sites; focus follows to the pressed segment of the view just shown.
  await tabTo(panel, current.getByRole('button', { name: strings.viewAllSites }), { back: true })
  await panel.keyboard.press('Enter')
  const all = panel.getByTestId('all-sites-view')
  await expect(all).toBeVisible()
  await expect(all.getByRole('button', { name: strings.viewAllSites })).toBeFocused()

  // Expand the collapsed page group with the keyboard (Enter toggles, ArrowRight expands).
  const longGroup = all.getByTestId('page-group').filter({ hasText: LONG_TITLE })
  const longHeader = longGroup.getByTestId('page-group-header')
  await expect(longHeader).toHaveAttribute('aria-expanded', 'false')
  await tabTo(panel, longHeader)
  expect(await focusOutline(panel)).toEqual(RING)
  await panel.keyboard.press('Enter')
  await expect(longHeader).toHaveAttribute('aria-expanded', 'true')
  await panel.keyboard.press('ArrowLeft')
  await expect(longHeader).toHaveAttribute('aria-expanded', 'false')
  await panel.keyboard.press('ArrowRight')
  await expect(longGroup.getByTestId('highlight-item')).toHaveCount(1)

  // Back to the current page view with the keyboard too.
  await tabTo(panel, all.getByRole('button', { name: strings.viewCurrentPage }), { back: true })
  await panel.keyboard.press('Enter')
  await expect(current).toBeVisible()
  await expect(current.getByRole('button', { name: strings.viewCurrentPage })).toBeFocused()

  // Account panel, then sign out through the confirm dialog.
  await tabTo(panel, header.getByTestId('account-button'), { back: true })
  await panel.keyboard.press('Enter')
  const accountPanel = panel.getByTestId('account-panel')
  await expect(accountPanel).toBeVisible()
  await tabTo(panel, accountPanel.getByTestId('account-logout'))
  expect(await focusOutline(panel)).toEqual(RING)
  await panel.keyboard.press('Enter')
  const dialog = panel.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: strings.logoutCancel })).toBeFocused()
  await panel.keyboard.press('Tab')
  await expect(dialog.getByRole('button', { name: strings.logout })).toBeFocused()
  await panel.keyboard.press('Enter')
  await expect(panel.getByTestId('login-form')).toBeVisible()
  await expect(panel.getByTestId('sidebar-shell')).toHaveCount(0)

  await context.unroute(RPC)
  expect(externalRequests).toEqual([])
})

test('interactive elements are real buttons and inputs with names; mouse clicks show no focus ring', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await seedTwoPages(ext, server.origin, false)
  await ext.close()
  const article = await context.newPage()
  const panel = await panelForArticle(openSidePanel, serviceWorker, article, `${server.origin}/article.html`)
  await expect(panel.getByTestId('highlight-item')).toHaveCount(2)
  await panel.getByRole('button', { name: strings.viewAllSites }).first().click()
  await expect(panel.getByTestId('all-sites-view')).toBeVisible()

  const audit = await panel.evaluate(() => {
    const problems: string[] = []
    const describe = (el: Element) => (el as HTMLElement).dataset.testid ?? el.outerHTML.slice(0, 80)
    // Anything focusable or with an interactive role must be a native control.
    const candidates = document.querySelectorAll('[tabindex], [role="button"], [role="switch"], [role="tab"], [onclick]')
    for (const el of candidates) {
      if (!['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'A'].includes(el.tagName)) problems.push(`not native: ${describe(el)}`)
    }
    // Every button has an accessible name: text content or aria-label (icon buttons).
    for (const el of document.querySelectorAll('button')) {
      const name = el.getAttribute('aria-label') ?? el.textContent?.trim() ?? ''
      if (!name) problems.push(`unnamed button: ${describe(el)}`)
      const iconOnly = !el.textContent?.trim()
      if (iconOnly && !el.getAttribute('aria-label')) problems.push(`icon button without aria-label: ${describe(el)}`)
    }
    return problems
  })
  expect(audit).toEqual([])

  // A mouse click focuses the button but :focus-visible does not match, so no ring is drawn.
  const account = panel.getByTestId('account-button')
  await account.click()
  await expect(account).toBeFocused()
  expect(await account.evaluate((el) => el.matches(':focus-visible'))).toBe(false)
  expect((await focusOutline(panel)).style).toBe('none')
  await account.click()
  const groupHeader = panel.getByTestId('page-group-header').first()
  await groupHeader.click()
  expect(await groupHeader.evaluate((el) => el.matches(':focus-visible'))).toBe(false)
  expect((await focusOutline(panel)).style).toBe('none')
  expect(externalRequests).toEqual([])
})

test('axe: no serious or critical violations on login, current page, all sites, account panel and logout confirm', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  // Signed out: the login form.
  const login = await openSidePanel(undefined, { signIn: false })
  await expect(login.getByTestId('login-form')).toBeVisible()
  expect(await seriousViolations(login), 'login').toEqual([])
  await login.close()

  await context.route(RPC, (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'boom' }) }),
  )
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await seedTwoPages(ext, server.origin, false)
  await ext.close()
  const article = await context.newPage()
  const panel = await panelForArticle(openSidePanel, serviceWorker, article, `${server.origin}/article.html`)
  const current = panel.getByTestId('current-page-view')
  await expect(current.getByTestId('highlight-item')).toHaveCount(2)
  expect(await seriousViolations(panel), 'current page').toEqual([])

  await current.getByRole('button', { name: strings.viewAllSites }).click()
  const all = panel.getByTestId('all-sites-view')
  await expect(all.getByTestId('page-group')).toHaveCount(2)
  expect(await seriousViolations(panel), 'all sites').toEqual([])

  await panel.getByTestId('account-button').click()
  const accountPanel = panel.getByTestId('account-panel')
  await expect(accountPanel).toBeVisible()
  expect(await seriousViolations(panel), 'account panel').toEqual([])

  await accountPanel.getByTestId('account-logout').click()
  await expect(panel.getByRole('alertdialog')).toBeVisible()
  expect(await seriousViolations(panel), 'logout confirm').toEqual([])

  await context.unroute(RPC)
  expect(externalRequests).toEqual([])
})

for (const width of [300, 600]) {
  test(`at ${width}px: single full-width column, two-line clamp, item actions usable, no horizontal scroll`, async ({
    context,
    extensionId,
    serviceWorker,
    server,
    openSidePanel,
    externalRequests,
  }) => {
    await signIn(context, extensionId)
    const ext = await openExtensionPage(context, extensionId)
    await enableSite(ext, SITE)
    // One very long highlight so the clamp has something to cut.
    const url = `${server.origin}/article.html`
    await seedHighlights(ext, [
      {
        id: crypto.randomUUID(),
        url,
        text: 'A long passage that wraps over several lines in a narrow side panel. '.repeat(6),
        color: 'yellow',
        comment: 'note',
        anchor: null,
        pageTitle: ARTICLE_TITLE,
        favicon: null,
      },
    ])
    await ext.close()
    const article = await context.newPage()
    const panel = await panelForArticle(openSidePanel, serviceWorker, article, url)
    await panel.setViewportSize({ width, height: 700 })
    const item = panel.getByTestId('current-page-view').getByTestId('highlight-item').first()
    await expect(item).toBeVisible()

    // No horizontal scrollbar on the document or the list.
    const overflow = await panel.evaluate(() => ({
      doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      body: document.body.scrollWidth - document.body.clientWidth,
    }))
    expect(overflow).toEqual({ doc: 0, body: 0 })

    // Single column spanning the panel (minus the list margins).
    const list = panel.getByTestId('current-page-view').getByTestId('highlight-list')
    const listBox = (await list.boundingBox())!
    const itemBox = (await item.boundingBox())!
    expect(itemBox.width).toBeCloseTo(listBox.width, 0)
    expect(listBox.width).toBeGreaterThan(width - 32)

    // Body text clamped to two lines.
    const text = item.getByTestId('highlight-text')
    const lines = await text.evaluate((el) => {
      const s = getComputedStyle(el)
      return { clamp: s.webkitLineClamp, height: el.getBoundingClientRect().height, lineHeight: parseFloat(s.lineHeight) }
    })
    expect(lines.clamp).toBe('2')
    expect(lines.height).toBeLessThanOrEqual(lines.lineHeight * 2 + 1)

    // Item actions are reachable and fully inside the panel when the row holds focus.
    await item.getByRole('button', { name: strings.colorYellow }).focus()
    const actions = item.getByTestId('item-actions')
    await expect(actions).toHaveCSS('opacity', '1')
    const actionsBox = (await actions.boundingBox())!
    expect(actionsBox.x).toBeGreaterThanOrEqual(0)
    expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(width)
    await item.getByRole('button', { name: strings.colorBlue }).press('Enter')
    await expect(item).toHaveAttribute('data-color', 'blue')

    // Screenshot after the edit still shows no horizontal scrollbar.
    await panel.screenshot({ path: test.info().outputPath(`sidepanel-${width}.png`), fullPage: true })
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    expect(externalRequests).toEqual([])
  })
}
