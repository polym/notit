// Playwright fixture that loads the built extension (dist/) into a persistent Chromium profile.
// Fixture callbacks name Playwright's `use` argument `provide` so react-hooks lint does not mistake it for a hook.
// Exposes:
//   context        persistent BrowserContext with the extension loaded
//   extensionId    id of the unpacked extension
//   serviceWorker  the extension's MV3 service worker
//   openSidePanel  opens the side panel document as a tab (chrome.sidePanel.open needs a user gesture);
//                  signs in as local test user A first unless { signIn: false } (Story 2.14 login gate)
//   server         local static server for tests/e2e/pages
//   externalRequests  every non-localhost request seen by the context (always blocked)
import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { startStaticServer, type StaticServer } from '../../helpers/static-server.ts'
import { clearCloudRows, TEST_USERS } from '../../helpers/local-supabase.ts'

const ROOT = resolve(import.meta.dirname, '../../..')
export const DIST_DIR = join(ROOT, 'dist')
export const PAGES_DIR = join(ROOT, 'tests/e2e/pages')

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** True for URLs the tests are allowed to load: the local server, extension pages and inline data. */
export function isLocalUrl(rawUrl: string): boolean {
  const url = new URL(rawUrl)
  if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ws:' || url.protocol === 'wss:') {
    return LOCAL_HOSTS.has(url.hostname)
  }
  return true
}

interface WorkerFixtures {
  server: StaticServer
}

interface TestFixtures {
  context: BrowserContext
  extensionId: string
  serviceWorker: Worker
  openSidePanel: (page?: Page, options?: { signIn?: boolean }) => Promise<Page>
  externalRequests: string[]
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
  server: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires an object pattern here.
    async ({}, provide) => {
      const server = await startStaticServer(PAGES_DIR)
      await provide(server)
      await server.close()
    },
    { scope: 'worker' },
  ],

  // eslint-disable-next-line no-empty-pattern -- Playwright requires an object pattern here.
  externalRequests: async ({}, provide) => {
    await provide([])
  },

  context: async ({ externalRequests }, provide) => {
    if (!existsSync(join(DIST_DIR, 'manifest.json'))) {
      throw new Error('dist/manifest.json not found; run "npm run build" before the e2e tests')
    }
    // Sign-in pulls the account's rows (Story 2.17): every test starts from an empty cloud account.
    clearCloudRows(TEST_USERS.a.email)
    const userDataDir = mkdtempSync(join(tmpdir(), 'noteit-e2e-'))
    const context = await chromium.launchPersistentContext(userDataDir, {
      // The "chromium" channel uses the new headless mode, which supports extensions.
      channel: 'chromium',
      headless: !process.env.HEADED,
      args: [`--disable-extensions-except=${DIST_DIR}`, `--load-extension=${DIST_DIR}`],
    })
    // Block and record every request that would leave the machine.
    await context.route(
      (url) => !isLocalUrl(url.href),
      async (route) => {
        externalRequests.push(route.request().url())
        await route.abort('blockedbyclient')
      },
    )
    await provide(context)
    await context.close()
    rmSync(userDataDir, { recursive: true, force: true })
    // Leave no client rows behind: later suites (legacy migration) expect an empty account.
    clearCloudRows(TEST_USERS.a.email)
  },

  serviceWorker: async ({ context }, provide) => {
    const worker =
      context.serviceWorkers().find((w) => w.url().startsWith('chrome-extension://')) ??
      (await context.waitForEvent('serviceworker', (w) => w.url().startsWith('chrome-extension://')))
    await provide(worker)
  },

  extensionId: async ({ serviceWorker }, provide) => {
    await provide(new URL(serviceWorker.url()).host)
  },

  openSidePanel: async ({ context, extensionId }, provide) => {
    await provide(async (page?: Page, options?: { signIn?: boolean }) => {
      const target = page ?? (await context.newPage())
      await target.goto(`chrome-extension://${extensionId}/src/entries/sidepanel/index.html`)
      if (options?.signIn !== false) {
        const signedIn = await signInFromPage(target)
        if (!signedIn) throw new Error('could not sign in to the local Supabase stack (npm run db:start, env:local, build)')
        await target.reload()
      }
      return target
    })
  },
})

/**
 * Signs in as local test user A through the real auth/login handler (same envelope the side panel
 * sends). No-op when a session already exists. Returns the resulting signedIn flag.
 */
export async function signInFromPage(page: Page, user: { email: string; password: string } = TEST_USERS.a): Promise<boolean> {
  return page.evaluate(async ({ email, password }) => {
    const send = (type: string, req: unknown) =>
      chrome.runtime.sendMessage({ kind: 'noteit/request', type, req }) as Promise<{ ok: boolean; data?: { signedIn: boolean } }>
    const state = await send('auth/getState', undefined)
    if (state.ok && state.data?.signedIn) return true
    const login = await send('auth/login', { email, password })
    return login.ok && login.data?.signedIn === true
  }, user)
}

/**
 * Signs the extension in as local test user A from a short-lived extension page (Story 2.15 login
 * gate: highlight writes need a session). Call after resetLocalData, which clears the session.
 */
export async function signIn(context: BrowserContext, extensionId: string): Promise<void> {
  const page = await context.newPage()
  try {
    await page.goto(`chrome-extension://${extensionId}/src/entries/sidepanel/index.html`)
    if (!(await signInFromPage(page))) {
      throw new Error('could not sign in to the local Supabase stack (npm run db:start, env:local, build)')
    }
  } finally {
    await page.close()
  }
}

export const expect = test.expect
