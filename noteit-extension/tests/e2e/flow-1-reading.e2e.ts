// Story 3.17: EXPERIENCE.md Key Flow 1 (long article reading) end to end on the built extension.
// Turn the site on from the side panel, one-click yellow, blue "question" with a comment, hover shows
// only the preview, click a highlight to add a comment, current page lists in article order, click an
// item to jump and flash, then a second device (its own profile) signs in through the login form and
// sees every highlight with its color, comment and comment marker. Failure paths: offline highlights
// count as pending and upload once the network is back; the second device's login errors; a highlight
// that cannot be anchored shows the "not found" caption and keeps its content.
// Needs the local Supabase stack (npm run db:start, env:local, build).
import type { Page, Worker } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { extensionRequest, liveRecords, openExtensionPage, resetLocalData, seedHighlights } from '../helpers/local-db.ts'
import { launchDevice, type Device } from '../helpers/two-device.ts'
import { TEST_USERS } from '../helpers/local-supabase.ts'
import {
  COMMENT_BUTTON_INDEX,
  MENU,
  POPOVER,
  PREVIEW,
  clickHighlight,
  clickMenuButton,
  computedColor,
  dragSelect,
  hasCommentMarker,
  hoverHighlight,
} from './fixtures/page-actions.ts'
import type { SyncStatus } from '../../src/core/sync/protocol.ts'
import type { CreateHighlightReq } from '../../src/features/highlight/index.ts'
import { errorText, strings } from '../../src/ui/strings.ts'
import { colors } from '../../src/ui/tokens/index.ts'

const TITLE = 'NoteIt smoke article'
const QUESTION = 'Why would a fox jump at all?'
const AFTERTHOUGHT = 'Reload safety is the whole point.'
const GHOST = 'This sentence was never on the article page.'
// Offline uploads wait for the push alarm (30s backoff) once the network is back.
const RECOVERY_MS = 90_000

test.setTimeout(240_000)

/** Badge text of the tab showing `url`, read in the service worker. */
function badgeOf(serviceWorker: Worker, url: string): Promise<string> {
  return serviceWorker.evaluate(async (target) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === target)
    if (tab?.id === undefined) throw new Error(`no tab for ${target}`)
    return chrome.action.getBadgeText({ tabId: tab.id })
  }, url)
}

async function syncStatus(page: Page): Promise<SyncStatus> {
  const result = await extensionRequest<SyncStatus>(page, 'sync/getStatus', undefined)
  if (!result.ok) throw new Error(`sync/getStatus failed: ${JSON.stringify(result.error)}`)
  return result.data
}

const marksOf = (page: Page, id: string) => page.locator(`[data-noteit-id="${id}"]`)
const markOf = (page: Page, id: string) => marksOf(page, id).first()

async function idOf(page: Page, scope: string): Promise<string> {
  const mark = page.locator(`${scope} .noteit-highlight`).first()
  await expect(mark).toBeVisible()
  const id = await mark.getAttribute('data-noteit-id')
  if (!id) throw new Error(`no highlight in ${scope}`)
  return id
}

async function fillLogin(panel: Page, email: string, password: string): Promise<void> {
  await panel.getByLabel(strings.loginEmail).fill(email)
  await panel.getByLabel(strings.loginPassword).fill(password)
  await panel.getByRole('button', { name: strings.loginSubmit }).click()
}

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  // resetLocalData also clears the site overrides: the site starts off, as on a new blog.
  await resetLocalData(serviceWorker)
  await signIn(context, extensionId)
})

test('Key Flow 1: read, highlight, comment, review and restore on a second device', async ({
  context,
  extensionId,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const url = `${server.origin}/article.html`
  const page = await context.newPage()
  await page.goto(url)
  const panel = await openSidePanel()
  await page.bringToFront()

  // Step 1-2: the current page says the site is off; "turn on" enables it and the page goes live.
  const view = panel.getByTestId('current-page-view')
  const off = view.getByTestId('site-off')
  await expect(off).toContainText(strings.siteOff)
  await off.getByRole('button', { name: strings.siteTurnOn }).click()
  await expect(panel.getByTestId('sidebar-header').getByTestId('site-toggle-text')).toHaveText(strings.siteOn)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })

  // Step 3: one click on the yellow dot creates a highlight; the toolbar badge counts it.
  await page.bringToFront()
  await dragSelect(page, page.locator('#target'))
  await expect(page.locator(MENU)).toBeVisible()
  await clickMenuButton(page, 0)
  await expect(page.locator(MENU)).toHaveCount(0)
  const yellowId = await idOf(page, '#target')
  await expect.poll(() => badgeOf(serviceWorker, page.url())).toBe('1')

  // Step 4: blue "question" plus a comment, saved with Cmd/Ctrl+Enter; the comment marker shows.
  await dragSelect(page, page.locator('#intro'))
  await clickMenuButton(page, COMMENT_BUTTON_INDEX)
  await clickMenuButton(page, 2)
  const editor = page.locator(`${MENU} textarea`)
  await editor.focus()
  await page.keyboard.type(QUESTION)
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.locator(MENU)).toHaveCount(0)
  const blueId = await idOf(page, '#intro')
  await expect.poll(() => hasCommentMarker(marksOf(page, blueId))).toBe(true)
  await expect.poll(() => badgeOf(serviceWorker, page.url())).toBe('2')
  const blue = (await liveRecords(serviceWorker)).find((r) => r.id === blueId)
  expect(blue).toMatchObject({ color: 'blue', comment: QUESTION })

  // Step 5: hovering only previews; nothing shows over a highlight without a comment.
  await hoverHighlight(page, markOf(page, yellowId))
  await page.waitForTimeout(200)
  await expect(page.locator(PREVIEW)).toHaveCount(0)
  await hoverHighlight(page, markOf(page, blueId))
  await expect(page.locator(PREVIEW)).toHaveText(QUESTION)
  await expect(page.locator(POPOVER)).toHaveCount(0)
  await page.mouse.move(1, 1)
  await expect(page.locator(PREVIEW)).toHaveCount(0)

  // Step 6: click the earlier yellow highlight, add a thought, Cmd/Ctrl+Enter closes the popover.
  await clickHighlight(page, markOf(page, yellowId))
  const popover = page.locator(POPOVER)
  await expect(popover).toBeVisible()
  await popover.locator('textarea').fill(AFTERTHOUGHT)
  await popover.locator('textarea').press('ControlOrMeta+Enter')
  await expect(popover).toHaveCount(0)
  await expect.poll(() => hasCommentMarker(marksOf(page, yellowId))).toBe(true)
  await expect.poll(async () => (await liveRecords(serviceWorker)).find((r) => r.id === yellowId)?.comment).toBe(AFTERTHOUGHT)

  // Step 7: the current page lists in article order (intro before target although created later).
  const items = view.getByTestId('highlight-item')
  await expect(items).toHaveCount(2)
  await expect(items.nth(0)).toContainText('quick brown fox')
  await expect(items.nth(0).getByRole('img', { name: strings.colorBlue })).toHaveCount(1)
  await expect(items.nth(0).getByTestId('highlight-comment')).toHaveText(QUESTION)
  await expect(items.nth(1)).toContainText('survive a page reload')
  // Clicking the "question" scrolls back to it and flashes it.
  // The side panel is a tab here: bringing it to the front would make it the active tab, so it is
  // clicked in the background while the article stays the active tab.
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await items.nth(0).getByTestId('highlight-text').click()
  await expect(markOf(page, blueId)).toHaveClass(/noteit-flash/)
  await expect(markOf(page, blueId)).not.toHaveClass(/noteit-flash/, { timeout: 4000 })

  // Failure path: offline, highlighting still works and the header counts it as pending.
  await expect.poll(async () => (await syncStatus(panel)).state).toBe('idle')
  await expect.poll(async () => (await syncStatus(panel)).pending).toBe(0)
  await context.setOffline(true)
  try {
    await page.bringToFront()
    await dragSelect(page, page.locator('#outro'))
    await clickMenuButton(page, 3)
    await idOf(page, '#outro')
    await expect.poll(() => badgeOf(serviceWorker, page.url())).toBe('3')
    await expect(panel.getByTestId('sync-status-pending')).toHaveText(strings.syncPending(1))
    await expect.poll(async () => (await syncStatus(panel)).lastError?.code).toBe('network')
  } finally {
    await context.setOffline(false)
  }
  // Back online: the upload happens on its own (push alarm), no click needed.
  await expect.poll(async () => (await syncStatus(panel)).pending, { timeout: RECOVERY_MS }).toBe(0)
  await expect(panel.getByTestId('sync-status-pending')).toHaveCount(0)

  // A highlight whose text is not on the page (it will fail to anchor on the second device).
  const ghost: CreateHighlightReq = {
    id: crypto.randomUUID(),
    url,
    text: GHOST,
    color: 'yellow',
    comment: 'kept anyway',
    anchor: null,
    pageTitle: TITLE,
    favicon: null,
  }
  const ext = await openExtensionPage(context, extensionId)
  await seedHighlights(ext, [ghost])
  await ext.close()
  await expect.poll(async () => (await syncStatus(panel)).pending, { timeout: 15_000 }).toBe(0)
  const expected = await liveRecords(serviceWorker)
  expect(expected).toHaveLength(4)

  // Step 8: the second device signs in through the login form.
  let deviceB: Device | null = null
  try {
    deviceB = await launchDevice('flow1-b', { signIn: false })
    const panelB = await deviceB.extensionPage()
    // Failure path: wrong password, then no network.
    await fillLogin(panelB, TEST_USERS.a.email, 'wrong-password')
    await expect(panelB.getByRole('alert')).toHaveText(strings.loginInvalidCredentials)
    await deviceB.context.route('**/auth/v1/token**', (route) => route.abort('internetdisconnected'))
    await fillLogin(panelB, TEST_USERS.a.email, TEST_USERS.a.password)
    await expect(panelB.getByRole('alert')).toHaveText(errorText('network'))
    await deviceB.context.unroute('**/auth/v1/token**')
    await panelB.getByRole('button', { name: strings.loginSubmit }).click()
    await expect(panelB.getByRole('button', { name: strings.viewAllSites })).toBeVisible()
    // The sign-in pulls the account; wait until every highlight is local on the second device.
    await expect.poll(async () => (await deviceB!.local()).records.filter((r) => r.deletedAt === null).length, { timeout: 20_000 }).toBe(4)

    // Step 9: the article on device B shows every highlight as it was (site enabled by its highlights).
    const pageB = await deviceB.context.newPage()
    await pageB.goto(url)
    await pageB.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
    for (const record of expected.filter((r) => r.id !== ghost.id)) {
      const mark = markOf(pageB, record.id)
      await expect(mark).toBeVisible()
      await expect(mark).toHaveText(record.text)
      expect(await mark.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
        await computedColor(pageB, colors[`highlight-${record.color}`]),
      )
      await expect.poll(() => hasCommentMarker(marksOf(pageB, record.id))).toBe(Boolean(record.comment))
    }
    await hoverHighlight(pageB, markOf(pageB, blueId))
    await expect(pageB.locator(PREVIEW)).toHaveText(QUESTION)

    // Failure path: the highlight that cannot be anchored keeps its content and shows "not found".
    const panelBView = panelB.getByTestId('current-page-view')
    await pageB.bringToFront()
    await panelB.reload()
    await pageB.bringToFront()
    const lostItem = panelBView.getByTestId('highlight-item').filter({ hasText: GHOST })
    await expect(lostItem.getByTestId('anchor-lost')).toHaveText(strings.anchorLost, { timeout: 15_000 })
    await expect(lostItem.getByTestId('highlight-comment')).toHaveText('kept anyway')
    await expect(panelBView.getByTestId('highlight-item')).toHaveCount(4)
    expect(deviceB.externalRequests).toEqual([])
  } finally {
    await deviceB?.close()
  }
  expect(externalRequests).toEqual([])
})
