// Spec "selection translation": the floating menu's translate toggle opens the translation inside
// the menu, below its button row. The chips and the comment button stay; the comment editor can
// insert the translation. The provider is mocked with context.route (the fixture blocks every other
// external request); the mock answers by prompt (dictionary for a word, translator for text) and
// records each request.
// Needs the local Supabase stack (npm run db:start, env:local, build).
import AxeBuilder from '@axe-core/playwright'
import type { BrowserContext, Page, Worker } from '@playwright/test'
import { test, expect, signIn } from './fixtures/extension.ts'
import { enableSite, liveRecords, openExtensionPage, resetLocalData } from '../helpers/local-db.ts'
import { COMMENT_BUTTON_INDEX, MENU, clickMenuButton, dragSelect } from './fixtures/page-actions.ts'
import { strings, translateErrorText } from '../../src/ui/strings.ts'

const SITE = '127.0.0.1'
const PROVIDER = 'https://api.deepseek.com'
const SECTION = `${MENU} [data-noteit-translate]`
const TOGGLE = `${MENU} button[aria-label="${strings.translateButton}"]`
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}
const WORD = { lemma: 'bank', ipa: { us: 'bæŋk', uk: 'bæŋk' }, pos: 'n.', sense: 'sense:riverbank', otherSenses: ['sense:bank'] }
/** Blue is the third chip (MENU_COLORS order). */
const BLUE_INDEX = 2

interface ProviderCall {
  mode: 'word' | 'text'
  user: string
}

/** Mocks the provider; `status` answers every call with that HTTP status instead of a result. */
async function mockProvider(context: BrowserContext, status: number | (() => number) = 200): Promise<ProviderCall[]> {
  const calls: ProviderCall[] = []
  await context.route(`${PROVIDER}/**`, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    const body = request.postDataJSON() as { messages: { content: string }[] }
    const mode = body.messages[0].content.includes('dictionary') ? 'word' : 'text'
    calls.push({ mode, user: body.messages[1].content })
    const code = typeof status === 'function' ? status() : status
    const content = JSON.stringify(mode === 'word' ? WORD : { translation: 'text:break-the-ice' })
    const answer = code === 200 ? { choices: [{ message: { content } }] } : { error: { message: 'x' } }
    return route.fulfill({ status: code, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(answer) })
  })
  return calls
}

async function configure(serviceWorker: Worker): Promise<void> {
  await serviceWorker.evaluate(() =>
    chrome.storage.local.set({ translateConfig: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'sk-e2e-0000abcd' } }),
  )
}

async function openFixture(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/translate.html`)
  await page.locator('noteit-root[data-noteit-site="on"]').waitFor({ state: 'attached' })
}

/** Clicks the menu's translate toggle with the mouse. */
async function clickToggle(page: Page): Promise<void> {
  const button = page.locator(TOGGLE)
  await button.waitFor({ state: 'visible' })
  const box = (await button.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

async function translate(page: Page, selector: string): Promise<void> {
  await dragSelect(page, page.locator(selector))
  await clickToggle(page)
}

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await serviceWorker.evaluate(() => chrome.storage.local.remove('translateConfig'))
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  await ext.close()
})

test('a word opens inside the menu with lemma, IPA and sense; the toggle closes it; Esc closes the menu', async ({
  context,
  serviceWorker,
  server,
}) => {
  await configure(serviceWorker)
  const calls = await mockProvider(context)
  const page = await context.newPage()
  await openFixture(page, server.origin)
  await dragSelect(page, page.locator('#word'))
  await expect(page.locator(MENU)).toBeVisible()
  // Nothing leaves the machine until the toggle is clicked.
  expect(calls).toEqual([])

  await clickToggle(page)
  const section = page.locator(SECTION)
  await expect(section).toHaveAttribute('data-noteit-translate-state', 'word')
  await expect(page.locator(TOGGLE)).toHaveAttribute('aria-pressed', 'true')
  // Same menu: the chips and the comment button are still there.
  await expect(page.locator(`${MENU} button`).nth(0)).toHaveText(strings.colorYellow)
  await expect(page.locator(`${MENU} button[aria-label="${strings.commentButton}"]`)).toBeVisible()
  await expect(section.locator('[data-noteit-lemma]')).toHaveText('bank')
  await expect(section.locator('[data-noteit-ipa]')).toContainText('/bæŋk/')
  await expect(section.locator('[data-noteit-sense]')).toHaveText('sense:riverbank')
  await expect(section.locator('[data-noteit-other-senses]')).toContainText('sense:bank')

  // The model got the word and its sentence, not the whole page.
  expect(calls).toHaveLength(1)
  expect(calls[0].mode).toBe('word')
  expect(calls[0].user).toContain('word: bank')
  expect(calls[0].user).toContain('We sat on the bank of the river.')
  expect(calls[0].user).not.toContain('This paragraph exists')

  // The expanded menu stays clear of the selection.
  const sel = await page.evaluate(() => {
    const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
    return { top: r.top, bottom: r.bottom }
  })
  const box = (await page.locator(MENU).boundingBox())!
  expect(box.y + box.height <= sel.top || box.y >= sel.bottom).toBe(true)

  const { violations } = await new AxeBuilder({ page }).include('noteit-root').analyze()
  expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])

  // The toggle closes the section and keeps the menu; reopening is answered from the cache.
  await clickToggle(page)
  await expect(section).toHaveCount(0)
  await expect(page.locator(MENU)).toBeVisible()
  await expect(page.locator(TOGGLE)).toHaveAttribute('aria-pressed', 'false')
  await clickToggle(page)
  await expect(section).toHaveAttribute('data-noteit-translate-state', 'word')
  expect(calls).toHaveLength(1)

  await page.keyboard.press('Escape')
  await expect(page.locator(MENU)).toHaveCount(0)
})

test('a chip highlights in its color while the translation is open', async ({ context, serviceWorker, server }) => {
  await configure(serviceWorker)
  await mockProvider(context)
  const page = await context.newPage()
  await openFixture(page, server.origin)
  await translate(page, '#word')
  await expect(page.locator(SECTION)).toHaveAttribute('data-noteit-translate-state', 'word')

  await clickMenuButton(page, BLUE_INDEX)
  await expect(page.locator(MENU)).toHaveCount(0)
  await expect.poll(async () => (await liveRecords(serviceWorker)).map((r) => [r.text, r.color, r.comment])).toEqual([
    ['bank', 'blue', null],
  ])
})

test('the comment editor inserts the translation and saves it with the highlight', async ({ context, serviceWorker, server }) => {
  await configure(serviceWorker)
  const calls = await mockProvider(context)
  const page = await context.newPage()
  await openFixture(page, server.origin)
  await translate(page, '#sentence')
  const section = page.locator(SECTION)
  await expect(section).toHaveAttribute('data-noteit-translate-state', 'text')
  await expect(section.locator('[data-noteit-translation]')).toHaveText('text:break-the-ice')
  expect(calls[0].mode).toBe('text')

  await clickMenuButton(page, COMMENT_BUTTON_INDEX)
  const editor = page.locator(`${MENU} textarea`)
  await expect(editor).toBeFocused()
  // Translation and editor are open together.
  await expect(section).toBeVisible()
  // The widest state (4 chips + comment + translate): every row button stays on one line.
  const rowTops = await page
    .locator(`${MENU} .nt-floating-menu-row > button`)
    .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)))
  expect(rowTops).toHaveLength(6)
  expect(new Set(rowTops).size).toBe(1)
  await page.keyboard.type('note')
  await page.locator(`${MENU} [data-noteit-insert]`).click()
  await expect(editor).toHaveValue('note\ntext:break-the-ice')
  await expect(editor).toBeFocused()

  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.locator(MENU)).toHaveCount(0)
  await expect.poll(async () => (await liveRecords(serviceWorker)).map((r) => [r.text, r.color, r.comment])).toEqual([
    ['He told a joke to break the ice.', 'yellow', 'note\ntext:break-the-ice'],
  ])
})

test('without the translation open the editor offers no insert', async ({ context, server }) => {
  const page = await context.newPage()
  await openFixture(page, server.origin)
  await dragSelect(page, page.locator('#sentence'))
  await clickMenuButton(page, COMMENT_BUTTON_INDEX)
  await expect(page.locator(`${MENU} textarea`)).toBeVisible()
  await expect(page.locator(`${MENU} [data-noteit-insert]`)).toHaveCount(0)
  // The toggle stays available while editing.
  await expect(page.locator(TOGGLE)).toBeVisible()
})

test('without a config the section says so and offers the settings; nothing is sent', async ({ context, server }) => {
  const calls = await mockProvider(context)
  const page = await context.newPage()
  await openFixture(page, server.origin)
  await translate(page, '#word')
  const section = page.locator(SECTION)
  await expect(section).toHaveAttribute('data-noteit-translate-state', 'error')
  await expect(section).toContainText(translateErrorText('not_configured'))
  await expect(section.getByRole('button', { name: strings.translateOpenSettings })).toBeVisible()
  expect(calls).toEqual([])
})

test('a provider error shows its text and retry asks again', async ({ context, serviceWorker, server }) => {
  await configure(serviceWorker)
  let status = 429
  const calls = await mockProvider(context, () => status)
  const page = await context.newPage()
  await openFixture(page, server.origin)
  await translate(page, '#sentence')
  const section = page.locator(SECTION)
  await expect(section).toContainText(translateErrorText('quota'))

  status = 200
  await section.getByRole('button', { name: strings.translateRetry }).click()
  await expect(section).toHaveAttribute('data-noteit-translate-state', 'text')
  expect(calls).toHaveLength(2)
})

test('clicking outside closes the menu', async ({ context, serviceWorker, server }) => {
  await configure(serviceWorker)
  await mockProvider(context)
  const page = await context.newPage()
  await openFixture(page, server.origin)
  await translate(page, '#word')
  await expect(page.locator(SECTION)).toHaveAttribute('data-noteit-translate-state', 'word')
  const outro = (await page.locator('#outro').boundingBox())!
  await page.mouse.click(outro.x + 5, outro.y + outro.height / 2)
  await expect(page.locator(MENU)).toHaveCount(0)
})

test('a page scroll keeps the menu open and moves it with the selection', async ({ context, serviceWorker, server }) => {
  await configure(serviceWorker)
  await mockProvider(context)
  const page = await context.newPage()
  await openFixture(page, server.origin)
  await translate(page, '#sentence')
  await expect(page.locator(SECTION)).toHaveAttribute('data-noteit-translate-state', 'text')
  await clickMenuButton(page, COMMENT_BUTTON_INDEX)
  await page.keyboard.type('kept')
  const before = (await page.locator(MENU).boundingBox())!

  await page.evaluate(() => window.scrollBy(0, 40))
  await expect.poll(async () => (await page.locator(MENU).boundingBox())!.y).toBeCloseTo(before.y - 40, 0)
  await expect(page.locator(SECTION)).toHaveAttribute('data-noteit-translate-state', 'text')
  await expect(page.locator(`${MENU} textarea`)).toHaveValue('kept')
})
