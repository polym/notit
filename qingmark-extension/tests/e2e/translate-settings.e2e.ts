// Spec "selection translation": the side panel translation settings row, on the login page and in the
// account panel. The provider is mocked with context.route (the fixture blocks every other external
// request); answers carry CORS headers because the worker fetches without a granted host permission.
// Needs the local Supabase stack for the signed-in case (npm run db:start, env:local, build).
import type { BrowserContext, Page } from '@playwright/test'
import { test, expect } from './fixtures/extension.ts'
import { resetLocalData } from '../helpers/local-db.ts'
import { strings, translateErrorText } from '../../src/ui/strings.ts'

const PROVIDER = 'https://api.deepseek.com'
const KEY = 'sk-e2e-000000000000abcd'
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
}

test.beforeEach(async ({ serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await serviceWorker.evaluate(() => chrome.storage.local.remove('translateConfig'))
})

/** Answers provider calls with `status` (200: a valid word lookup) and records the POSTs. */
async function mockProvider(context: BrowserContext, status = 200): Promise<{ url: string; auth: string | null }[]> {
  const calls: { url: string; auth: string | null }[] = []
  await context.route(`${PROVIDER}/**`, async (route) => {
    const request = route.request()
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    calls.push({ url: request.url(), auth: request.headers()['authorization'] ?? null })
    const content = JSON.stringify({ lemma: 'test', ipa: { us: 'test', uk: 'test' }, pos: 'n.', sense: 'sense:test', otherSenses: [] })
    const body = status === 200 ? { choices: [{ message: { content } }] } : { error: { message: 'x' } }
    return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  })
  return calls
}

async function openTranslate(panel: Page) {
  await panel.getByTestId('translate-toggle').click()
  await expect(panel.getByTestId('translate-toggle')).toHaveAttribute('aria-expanded', 'true')
}

const stored = (sw: { evaluate: <T>(fn: () => Promise<T>) => Promise<T> }) =>
  sw.evaluate(async () => (await chrome.storage.local.get('translateConfig')).translateConfig as Record<string, unknown> | undefined)

test('signed out: the row shows defaults and refuses to save without a key', async ({ openSidePanel, serviceWorker }) => {
  const panel = await openSidePanel(undefined, { signIn: false })
  await expect(panel.getByTestId('translate-state')).toHaveText(strings.translateNotConfigured)
  await openTranslate(panel)
  await expect(panel.getByLabel(strings.translateBaseUrl)).toHaveValue(PROVIDER)
  await expect(panel.getByLabel(strings.translateModel)).toHaveValue('deepseek-flash')
  await expect(panel.getByLabel(strings.translateApiKey)).toHaveAttribute('type', 'password')
  await expect(panel.getByTestId('translate-privacy')).toHaveText(strings.translatePrivacyNote)

  await panel.getByRole('button', { name: strings.serverSave }).last().click()
  await expect(panel.getByText(strings.translateKeyMissing)).toBeVisible()
  expect(await stored(serviceWorker)).toBeUndefined()

  await panel.getByLabel(strings.translateBaseUrl).fill('http://api.deepseek.com')
  await panel.getByRole('button', { name: strings.serverSave }).last().click()
  await expect(panel.getByText(strings.translateBaseUrlInvalid)).toBeVisible()
})

test('testing a key the provider refuses reports it and saves nothing', async ({ context, openSidePanel, serviceWorker }) => {
  const calls = await mockProvider(context, 401)
  const panel = await openSidePanel(undefined, { signIn: false })
  await openTranslate(panel)
  await panel.getByLabel(strings.translateApiKey).fill(KEY)
  await panel.getByRole('button', { name: strings.serverTest }).last().click()
  await expect(panel.getByTestId('translate-status')).toHaveText(translateErrorText('unauthenticated'))
  expect(calls).toHaveLength(1)
  expect(calls[0].auth).toBe(`Bearer ${KEY}`)
  expect(await stored(serviceWorker)).toBeUndefined()
})

test('test then save: the key is stored in the worker and the panel only shows its last 4 characters', async ({
  context,
  openSidePanel,
  serviceWorker,
}) => {
  const calls = await mockProvider(context)
  const panel = await openSidePanel(undefined, { signIn: false })
  await openTranslate(panel)
  await panel.getByLabel(strings.translateApiKey).fill(KEY)
  await panel.getByRole('button', { name: strings.serverTest }).last().click()
  await expect(panel.getByTestId('translate-status')).toHaveText(strings.translateTestOk)
  expect(calls[0].url).toBe(`${PROVIDER}/chat/completions`)

  await panel.getByRole('button', { name: strings.serverSave }).last().click()
  await expect(panel.getByTestId('translate-status')).toHaveText(strings.translateSaved)
  await expect(panel.getByTestId('translate-state')).toHaveText(strings.translateConfigured('abcd'))
  expect(await stored(serviceWorker)).toMatchObject({ baseUrl: PROVIDER, model: 'deepseek-flash', apiKey: KEY })

  // Reopened after a reload: the key field is empty and the panel never received the key.
  await panel.reload()
  await expect(panel.getByTestId('translate-state')).toHaveText(strings.translateConfigured('abcd'))
  await openTranslate(panel)
  await expect(panel.getByLabel(strings.translateApiKey)).toHaveValue('')
  expect(await panel.content()).not.toContain(KEY)

  // Saving without a new key keeps the stored one.
  await panel.getByLabel(strings.translateModel).fill('deepseek-v4-pro')
  await panel.getByRole('button', { name: strings.serverSave }).last().click()
  await expect(panel.getByTestId('translate-status')).toHaveText(strings.translateSaved)
  expect(await stored(serviceWorker)).toMatchObject({ model: 'deepseek-v4-pro', apiKey: KEY })
})

test('signed in: the account panel shows the same settings row', async ({ openSidePanel }) => {
  const panel = await openSidePanel()
  await panel.getByTestId('account-button').click()
  await expect(panel.getByTestId('account-panel').getByTestId('translate-settings')).toBeVisible()
  await expect(panel.getByTestId('translate-state')).toHaveText(strings.translateNotConfigured)
})
