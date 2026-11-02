// Spec "login-supabase-config" (variant A): the login page server row shows the active Supabase
// server, edits it in place, tests the connection before saving and restores the build default.
// The build points at http://127.0.0.1:54321; the custom server is the same local stack reached as
// http://localhost:54321, so it is a different config that still signs in.
// Needs the local Supabase stack (npm run db:start, env:local, build).
import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/extension.ts'
import { extensionRequest, resetLocalData } from '../helpers/local-db.ts'
import { getLocalSupabaseEnv, TEST_USERS } from '../helpers/local-supabase.ts'
import { strings } from '../../src/ui/strings.ts'

const env = getLocalSupabaseEnv()
const CUSTOM_URL = env.url.replace('127.0.0.1', 'localhost')

test.beforeEach(async ({ serviceWorker }) => {
  await resetLocalData(serviceWorker)
})

async function openServer(panel: Page) {
  await panel.getByTestId('server-toggle').click()
  await expect(panel.getByTestId('server-toggle')).toHaveAttribute('aria-expanded', 'true')
}

async function fillServer(panel: Page, url: string, anonKey: string) {
  await panel.getByLabel(strings.serverUrl).fill(url)
  await panel.getByLabel(strings.serverAnonKey).fill(anonKey)
}

test('the collapsed row shows the build server; Esc closes the expanded row', async ({ openSidePanel }) => {
  const panel = await openSidePanel(undefined, { signIn: false })
  await expect(panel.getByTestId('server-url')).toHaveText(env.url.replace(/^https?:\/\//, ''))
  await expect(panel.getByTestId('server-source')).toHaveText(strings.serverSourceBuild)

  await openServer(panel)
  // Prefilled with the active URL, never with the key; no restore button for the build default.
  await expect(panel.getByLabel(strings.serverUrl)).toHaveValue(env.url)
  await expect(panel.getByLabel(strings.serverAnonKey)).toHaveValue('')
  await expect(panel.getByLabel(strings.serverAnonKey)).toHaveAttribute('type', 'password')
  await expect(panel.getByRole('button', { name: strings.serverReset })).toHaveCount(0)

  await panel.getByLabel(strings.serverUrl).press('Escape')
  await expect(panel.getByTestId('server-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(panel.getByLabel(strings.serverUrl)).toHaveCount(0)
})

test('invalid values are rejected before any request and nothing is saved', async ({ context, openSidePanel, serviceWorker }) => {
  const panel = await openSidePanel(undefined, { signIn: false })
  const probes: string[] = []
  await context.route('**/auth/v1/settings', (route) => {
    probes.push(route.request().url())
    return route.continue()
  })
  await openServer(panel)
  await fillServer(panel, 'http://example.com', 'sb_secret_abc')
  await panel.getByRole('button', { name: strings.serverSave }).click()

  await expect(panel.getByText(strings.serverUrlInsecure)).toBeVisible()
  await expect(panel.getByText(strings.serverKeySecret)).toBeVisible()
  await expect(panel.getByLabel(strings.serverUrl)).toHaveAttribute('aria-invalid', 'true')
  expect(probes).toEqual([])
  const stored = await serviceWorker.evaluate(async () => (await chrome.storage.local.get('supabaseConfig')).supabaseConfig)
  expect(stored).toBeUndefined()
})

test('testing a key the server refuses reports it and saves nothing', async ({ context, openSidePanel, serviceWorker }) => {
  const panel = await openSidePanel(undefined, { signIn: false })
  await context.route('**/auth/v1/settings', (route) => route.fulfill({ status: 401, body: '{}' }))
  await openServer(panel)
  await fillServer(panel, CUSTOM_URL, 'sb_publishable_wrong')
  await panel.getByRole('button', { name: strings.serverTest }).click()

  await expect(panel.getByRole('alert')).toHaveText(strings.serverTestRejected)
  const stored = await serviceWorker.evaluate(async () => (await chrome.storage.local.get('supabaseConfig')).supabaseConfig)
  expect(stored).toBeUndefined()
})

test('save a custom server, sign in through it, see it in the account panel, then restore the default', async ({
  openSidePanel,
  serviceWorker,
}) => {
  const panel = await openSidePanel(undefined, { signIn: false })
  await openServer(panel)
  await fillServer(panel, `${CUSTOM_URL}/`, env.anonKey)
  await panel.getByRole('button', { name: strings.serverTest }).click()
  await expect(panel.getByTestId('server-test-status')).toHaveText(strings.serverTestOk)

  await panel.getByRole('button', { name: strings.serverSave }).click()
  await expect(panel.getByTestId('server-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(panel.getByTestId('server-url')).toHaveText(CUSTOM_URL.replace(/^https?:\/\//, ''))
  await expect(panel.getByTestId('server-source')).toHaveText(strings.serverSourceUser)
  const stored = await serviceWorker.evaluate(async () => (await chrome.storage.local.get('supabaseConfig')).supabaseConfig)
  expect(stored).toMatchObject({ url: CUSTOM_URL, anonKey: env.anonKey })

  // The token request goes to the saved server.
  const token = panel.context().waitForEvent('request', (r) => r.url().startsWith(`${CUSTOM_URL}/auth/v1/token`))
  await panel.getByLabel(strings.loginEmail).fill(TEST_USERS.a.email)
  await panel.getByLabel(strings.loginPassword).fill(TEST_USERS.a.password)
  await panel.getByRole('button', { name: strings.loginSubmit }).click()
  await token
  await expect(panel.getByRole('button', { name: strings.viewAllSites })).toBeVisible()

  // Signed in: the worker refuses to change the server.
  const refused = await extensionRequest(panel, 'auth/setConfig', { url: env.url, anonKey: env.anonKey })
  expect(refused).toMatchObject({ ok: false, error: { code: 'bad_request' } })

  await panel.getByTestId('account-button').click()
  await expect(panel.getByTestId('account-server')).toHaveText(CUSTOM_URL)
  await panel.getByTestId('account-logout').click()

  await expect(panel.getByTestId('login-form')).toBeVisible()
  await openServer(panel)
  await panel.getByRole('button', { name: strings.serverReset }).click()
  await expect(panel.getByTestId('server-source')).toHaveText(strings.serverSourceBuild)
  await expect(panel.getByTestId('server-url')).toHaveText(env.url.replace(/^https?:\/\//, ''))
  const after = await serviceWorker.evaluate(async () => (await chrome.storage.local.get('supabaseConfig')).supabaseConfig)
  expect(after).toBeUndefined()
})
