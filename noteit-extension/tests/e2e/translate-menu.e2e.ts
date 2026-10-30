// Spec "selection translation": the context menu "translate with NoteIt" works signed out and on a
// site that is off, creates nothing, and the word card offers pronunciation. Native menus cannot be
// driven from Playwright, so the real onClicked listener is dispatched in the service worker (same
// approach as login-gate.e2e.ts). Speech output itself cannot be observed headless; the test checks
// that the pronounce button is there and that clicking it raises no page error.
// Needs the local Supabase stack (npm run db:start, env:local, build).
import type { BrowserContext, Page, Worker } from '@playwright/test'
import { test, expect } from './fixtures/extension.ts'
import { liveRecords, resetLocalData } from '../helpers/local-db.ts'
import { MENU, dragSelect } from './fixtures/page-actions.ts'
import { strings } from '../../src/ui/strings.ts'

const PROVIDER = 'https://api.deepseek.com'
const CARD = 'noteit-root [data-noteit-translate]'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}
const WORD = { lemma: 'bank', ipa: { us: 'bæŋk', uk: 'bæŋk' }, pos: 'n.', sense: 'sense:riverbank', otherSenses: [] }

async function mockProvider(context: BrowserContext): Promise<number[]> {
  const calls: number[] = []
  await context.route(`${PROVIDER}/**`, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    calls.push(Date.now())
    const body = { choices: [{ message: { content: JSON.stringify(WORD) } }] }
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  })
  return calls
}

async function clickTranslateMenu(serviceWorker: Worker, url: string): Promise<void> {
  await serviceWorker.evaluate(async (target) => {
    const tab = (await chrome.tabs.query({})).find((t) => t.url === target)
    if (!tab) throw new Error(`no tab for ${target}`)
    ;(
      chrome.contextMenus.onClicked as unknown as {
        dispatch(i: Partial<chrome.contextMenus.OnClickData>, t: chrome.tabs.Tab): void
      }
    ).dispatch({ menuItemId: 'noteit-translate', selectionText: 'bank' }, tab)
  }, url)
}

async function openFixture(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.locator('noteit-root').waitFor({ state: 'attached' })
}

test.beforeEach(async ({ serviceWorker }) => {
  // Signed out (resetLocalData clears the session) and the site left off.
  await resetLocalData(serviceWorker)
  await serviceWorker.evaluate(() =>
    chrome.storage.local.set({ translateConfig: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'sk-e2e-0000abcd' } }),
  )
})

test('signed out on a site that is off: the menu entry translates without creating or enabling anything', async ({
  context,
  serviceWorker,
  server,
}) => {
  const calls = await mockProvider(context)
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const url = `${server.origin}/translate.html`
  await openFixture(page, url)

  await dragSelect(page, page.locator('#word'))
  await page.waitForTimeout(300)
  // Signed out: the floating menu stays hidden (login gate), the menu entry is the way in.
  await expect(page.locator(MENU)).toHaveCount(0)
  expect(calls).toEqual([])

  await clickTranslateMenu(serviceWorker, url)
  const card = page.locator(CARD)
  await expect(card).toHaveAttribute('data-noteit-translate-state', 'word')
  await expect(card.locator('[data-noteit-sense]')).toHaveText('sense:riverbank')
  // No session and the site is off: the card cannot highlight.
  await expect(card.getByRole('button', { name: strings.translateHighlight })).toHaveCount(0)

  // Pronunciation: present for a word, clicking it is safe.
  const speak = card.getByRole('button', { name: new RegExp(`^${strings.translatePronounce}`) })
  await expect(speak).toHaveCount(1)
  if (await speak.isEnabled()) await speak.click()
  expect(errors).toEqual([])

  expect(calls).toHaveLength(1)
  expect(await liveRecords(serviceWorker)).toEqual([])
  const overrides = await serviceWorker.evaluate(async () => (await chrome.storage.local.get('siteOverrides')).siteOverrides)
  expect(overrides ?? {}).toEqual({})
  await expect(page.locator('noteit-root')).not.toHaveAttribute('data-noteit-site', 'on')
})

test('the menu entry with nothing selected shows no card', async ({ context, serviceWorker, server }) => {
  const calls = await mockProvider(context)
  const page = await context.newPage()
  const url = `${server.origin}/translate.html`
  await openFixture(page, url)
  await clickTranslateMenu(serviceWorker, url)
  await page.waitForTimeout(300)
  await expect(page.locator(CARD)).toHaveCount(0)
  expect(calls).toEqual([])
})
