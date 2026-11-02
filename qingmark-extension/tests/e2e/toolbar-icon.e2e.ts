// Ginkgo toolbar icon: hollow green leaf by default, solid gold leaf on a page with highlights.
// Chrome has no getIcon, so the state is read through the per-tab tooltip (set in the same call as
// the icon) and setIcon failures are caught as service worker console errors.
// Needs the local Supabase stack (npm run db:start, env:local, build).
import { test, expect, signIn } from './fixtures/extension.ts'
import { enableSite, openExtensionPage, resetLocalData, seedHighlights } from '../helpers/local-db.ts'
import { strings } from '../../src/ui/strings.ts'

const SITE = '127.0.0.1'

test.beforeEach(async ({ context, extensionId, serviceWorker }) => {
  await resetLocalData(serviceWorker)
  await signIn(context, extensionId)
  const ext = await openExtensionPage(context, extensionId)
  await enableSite(ext, SITE)
  await ext.close()
})

test('the toolbar switches to the gold leaf when the page gets a highlight and back after navigation', async ({
  context,
  serviceWorker,
  server,
  openSidePanel,
  externalRequests,
}) => {
  const errors: string[] = []
  serviceWorker.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const page = await context.newPage()
  await page.goto(`${server.origin}/article.html`)
  await page.locator('qingmark-root[data-qingmark-site="on"]').waitFor({ state: 'attached' })
  const toolbar = () =>
    serviceWorker.evaluate(async (url) => {
      const tab = (await chrome.tabs.query({})).find((t) => t.url === url)
      if (tab?.id === undefined) return null
      return { title: await chrome.action.getTitle({ tabId: tab.id }), badge: await chrome.action.getBadgeText({ tabId: tab.id }) }
    }, page.url())
  await expect.poll(toolbar).toEqual({ title: strings.actionTitleIdle, badge: '' })

  const panel = await openSidePanel()
  await seedHighlights(panel, [
    {
      id: crypto.randomUUID(),
      url: `${server.origin}/article.html`,
      text: 'leaf',
      color: 'yellow',
      comment: null,
      anchor: null,
      pageTitle: null,
      favicon: null,
    },
  ])
  await page.bringToFront()
  await expect.poll(toolbar).toEqual({ title: strings.actionTitleWithHighlights(1), badge: '1' })

  await page.goto(`${server.origin}/long-article.html`)
  await expect.poll(toolbar).toEqual({ title: strings.actionTitleIdle, badge: '' })

  expect(errors.filter((e) => e.includes('badge') || e.includes('icon'))).toEqual([])
  expect(externalRequests).toEqual([])
})
