// Service worker lifecycle helpers for E2E tests.
// Chrome terminates idle MV3 service workers; these helpers reproduce that on demand over CDP
// (ServiceWorker.stopWorker) and wake the worker again with a runtime message.
// Target.closeTarget reports success for SW targets but leaves the worker running, and Playwright's
// Worker handle does not follow restarts, so the CDP runningStatus is the source of truth here.
import type { BrowserContext, CDPSession, Page } from '@playwright/test'

type RunningStatus = 'stopped' | 'starting' | 'running' | 'stopping'

interface WorkerVersion {
  versionId: string
  scriptURL: string
  runningStatus: RunningStatus
}

export interface ServiceWorkerController {
  /** Latest CDP running status of the extension's service worker. */
  status(): RunningStatus | undefined
  /** Terminates the worker and resolves once CDP reports it stopped. */
  stop(): Promise<void>
  /** Messages the worker from the extension page, waits until it runs again and returns the reply. */
  wake(message?: unknown): Promise<unknown>
  dispose(): Promise<void>
}

const STATUS_TIMEOUT_MS = 10_000

/**
 * Attaches to `extensionPage` (any chrome-extension:// page of the extension under test) and
 * returns a controller for the extension's service worker.
 */
export async function controlServiceWorker(
  context: BrowserContext,
  extensionId: string,
  extensionPage: Page,
): Promise<ServiceWorkerController> {
  const prefix = `chrome-extension://${extensionId}/`
  const cdp: CDPSession = await context.newCDPSession(extensionPage)
  let version: WorkerVersion | undefined
  const listeners = new Set<() => void>()
  // Pending status-wait timers, cleared on dispose so none fires after the controller is gone.
  const timers = new Set<ReturnType<typeof setTimeout>>()

  cdp.on('ServiceWorker.workerVersionUpdated', (event: { versions: WorkerVersion[] }) => {
    const match = event.versions.filter((v) => v.scriptURL.startsWith(prefix)).at(-1)
    if (!match) return
    version = match
    for (const notify of listeners) notify()
  })
  await cdp.send('ServiceWorker.enable')

  const waitForStatus = (wanted: RunningStatus): Promise<void> =>
    new Promise((resolveWait, rejectWait) => {
      const check = (): void => {
        if (version?.runningStatus !== wanted) return
        listeners.delete(check)
        timers.delete(timer)
        clearTimeout(timer)
        resolveWait()
      }
      const timer = setTimeout(() => {
        listeners.delete(check)
        timers.delete(timer)
        rejectWait(new Error(`service worker did not reach "${wanted}" (last: ${version?.runningStatus ?? 'unknown'})`))
      }, STATUS_TIMEOUT_MS)
      timers.add(timer)
      listeners.add(check)
      check()
    })

  // ServiceWorker.enable replays the current versions; wait for the extension's to show up.
  await waitForStatus('running')

  return {
    status: () => version?.runningStatus,
    async stop() {
      if (!version) throw new Error(`no service worker registered for extension ${extensionId}`)
      await cdp.send('ServiceWorker.stopWorker', { versionId: version.versionId })
      await waitForStatus('stopped')
    },
    async wake(message: unknown = { action: 'PING' }) {
      // Promise.all attaches a handler to both, so a failing sendMessage cannot leave the status
      // wait rejecting unobserved later.
      const [reply] = await Promise.all([
        extensionPage.evaluate((msg) => chrome.runtime.sendMessage(msg), message),
        waitForStatus('running'),
      ])
      return reply
    },
    async dispose() {
      listeners.clear()
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
      await cdp.detach().catch(() => undefined)
    },
  }
}
