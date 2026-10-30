// Story 2.14 / 3.4: email + password login against the local Supabase stack. The side panel shows
// only the login form while signed out (no header, no module tabs); the session lives in
// chrome.storage.local ('sb-auth'). Story 3.4 adds Enter submit, the loading state and landing on
// the highlight module "current page" view.
import { test, expect } from './fixtures/extension.ts'
import { resetLocalData } from '../helpers/local-db.ts'
import { TEST_USERS } from '../helpers/local-supabase.ts'
import { errorText, strings } from '../../src/ui/strings.ts'

test.beforeEach(async ({ serviceWorker }) => {
  await resetLocalData(serviceWorker)
})

async function fillLogin(panel: import('@playwright/test').Page, email: string, password: string) {
  await panel.getByLabel(strings.loginEmail).fill(email)
  await panel.getByLabel(strings.loginPassword).fill(password)
  await panel.getByRole('button', { name: strings.loginSubmit }).click()
}

test('signed out shows only the login form; correct credentials show the list', async ({
  openSidePanel,
  serviceWorker,
}) => {
  const panel = await openSidePanel(undefined, { signIn: false })
  await expect(panel.getByLabel(strings.loginEmail)).toBeVisible()
  await expect(panel.getByLabel(strings.loginPassword)).toBeVisible()
  // The server row is collapsed: no URL / key fields until it is opened (spec "login-supabase-config").
  await expect(panel.getByText(/anon key|Project URL/i)).toHaveCount(0)
  await expect(panel.getByTestId('server-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(panel.getByRole('button', { name: strings.viewAllSites })).toHaveCount(0)
  // Only the form: no header (site toggle lives there later) and no module tabs, no sign-up link.
  await expect(panel.getByTestId('sidebar-header')).toHaveCount(0)
  await expect(panel.getByRole('tablist')).toHaveCount(0)
  // Sign-in plus the collapsed server and translation settings rows.
  await expect(panel.getByRole('button')).toHaveCount(3)
  await expect(panel.getByTestId('translate-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(panel.getByRole('link')).toHaveCount(0)
  // DESIGN.md login-form: 30px inputs, 12px labels, full-width primary button.
  const emailBox = (await panel.getByLabel(strings.loginEmail).boundingBox())!
  expect(emailBox.height).toBe(30)
  const label = panel.locator('label[for="noteit-login-email"]')
  expect(await label.evaluate((e) => getComputedStyle(e).fontSize)).toBe('12px')
  const submit = (await panel.getByRole('button', { name: strings.loginSubmit }).boundingBox())!
  expect(submit.width).toBe(emailBox.width)
  // 10px gap (space token 2.5) between fields, button and error.
  const formGap = await panel.getByTestId('login-form').evaluate((e) => getComputedStyle(e).rowGap)
  expect(formGap).toBe('10px')

  await fillLogin(panel, TEST_USERS.a.email, TEST_USERS.a.password)
  await expect(panel.getByRole('button', { name: strings.viewAllSites })).toBeVisible()
  await expect(panel.getByLabel(strings.loginEmail)).toHaveCount(0)
  // Lands on the highlight module, "current page" view, with the shell around it.
  await expect(panel.getByRole('tab', { name: strings.moduleHighlight })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByTestId('sidebar-header')).toBeVisible()
  await expect(panel.getByRole('button', { name: strings.viewCurrentPage })).toBeVisible()

  // The session is stored only in chrome.storage.local under sb-auth.
  const stored = await serviceWorker.evaluate(async () => {
    const local = await chrome.storage.local.get('sb-auth')
    return typeof local['sb-auth'] === 'string'
  })
  expect(stored).toBe(true)

  // A reopened panel stays signed in.
  await panel.reload()
  await expect(panel.getByRole('button', { name: strings.viewAllSites })).toBeVisible()
})

test('wrong credentials show the credential error and clear the password', async ({ openSidePanel }) => {
  const panel = await openSidePanel(undefined, { signIn: false })
  await fillLogin(panel, TEST_USERS.a.email, 'wrong-password')
  await expect(panel.getByRole('alert')).toHaveText(strings.loginInvalidCredentials)
  await expect(panel.getByLabel(strings.loginPassword)).toHaveValue('')
  await expect(panel.getByLabel(strings.loginEmail)).toHaveValue(TEST_USERS.a.email)
})

test('a network failure shows the connection error and keeps the password', async ({ context, openSidePanel }) => {
  const panel = await openSidePanel(undefined, { signIn: false })
  // Fail the token request from the service worker at the network layer.
  await context.route('**/auth/v1/token**', (route) => route.abort('internetdisconnected'))
  await fillLogin(panel, TEST_USERS.a.email, TEST_USERS.a.password)
  await expect(panel.getByRole('alert')).toHaveText(errorText('network'))
  await expect(panel.getByLabel(strings.loginPassword)).toHaveValue(TEST_USERS.a.password)
  await expect(panel.getByLabel(strings.loginEmail)).toHaveValue(TEST_USERS.a.email)
  await expect(panel.getByRole('button', { name: strings.loginSubmit })).toBeEnabled()
})

test('Enter submits; the button is disabled with a spinner while the request runs', async ({ context, openSidePanel }) => {
  const panel = await openSidePanel(undefined, { signIn: false })
  // Hold the token request so the loading state is observable.
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  await context.route('**/auth/v1/token**', async (route) => {
    await held
    await route.continue()
  })
  await panel.getByLabel(strings.loginEmail).fill(TEST_USERS.a.email)
  await panel.getByLabel(strings.loginPassword).fill(TEST_USERS.a.password)
  await panel.getByLabel(strings.loginPassword).press('Enter')

  const button = panel.getByRole('button', { name: strings.loginSubmit })
  await expect(button).toBeDisabled()
  await expect(button).toHaveAttribute('aria-busy', 'true')
  await expect(panel.getByTestId('login-spinner')).toBeVisible()

  release()
  await expect(panel.getByRole('button', { name: strings.viewCurrentPage })).toBeVisible()
  await context.unroute('**/auth/v1/token**')
})
