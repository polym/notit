// Jump from the side panel to a highlight on its page (architecture.md D6 "Jump", Q55, FR22).
// Tab choice: a tab of the same canonicalUrl in the current window, else one in another window,
// else a new tab. The tab is activated, then page/flash asks its content script to scroll to and
// flash the highlight; content waits up to the lost window for the highlight to render.
import { createClient } from '../../../core/messaging/index.ts'
import { canonicalUrl } from '../../../core/url/index.ts'
import { ANCHOR_LOST_WINDOW_MS, type HighlightRecord } from '../../../core/model/index.ts'
import type { PageRequests } from '../shared/protocol.ts'

const pageClient = createClient<PageRequests>()

/** How long a new or reloading tab may take before its content script answers page/flash. */
const CONTENT_READY_TIMEOUT_MS = 10_000
const RETRY_INTERVAL_MS = 200

export interface TabLike {
  id?: number
  url?: string
  windowId?: number
}

/** Picks the tab to reuse: same canonicalUrl, current window first. Undefined when none matches. */
export function pickTab<T extends TabLike>(tabs: T[], target: string, currentWindowId: number | undefined): T | undefined {
  const matching = tabs.filter((t) => t.id !== undefined && t.url !== undefined && canonicalUrl(t.url) === target)
  return matching.find((t) => t.windowId === currentWindowId) ?? matching[0]
}

async function currentWindowId(): Promise<number | undefined> {
  try {
    return (await chrome.windows.getLastFocused()).id
  } catch {
    return undefined
  }
}

/** Activates an existing tab of the record's page or opens a new one; returns its id. */
export async function openRecordTab(record: HighlightRecord): Promise<number | undefined> {
  const [tabs, windowId] = await Promise.all([chrome.tabs.query({}), currentWindowId()])
  const tab = pickTab(tabs, record.canonicalUrl, windowId)
  if (tab?.id !== undefined) {
    await chrome.tabs.update(tab.id, { active: true })
    if (tab.windowId !== undefined && tab.windowId !== windowId) {
      await chrome.windows.update(tab.windowId, { focused: true })
    }
    return tab.id
  }
  const created = await chrome.tabs.create({ url: record.url, active: true, ...(windowId !== undefined && { windowId }) })
  return created.id
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Sends page/flash, retrying while the tab has no content script yet (new tab, still loading).
 * Returns the content answer, or null when no content script answered in time.
 */
export async function flashInTab(tabId: number, id: string): Promise<{ found: boolean } | null> {
  const deadline = Date.now() + CONTENT_READY_TIMEOUT_MS + ANCHOR_LOST_WINDOW_MS
  for (;;) {
    const result = await pageClient.send('page/flash', { id }, { tabId })
    if (result.ok) return result.data
    // 'internal' means no receiver yet; any other code is a real answer from content.
    if (result.error.code !== 'internal' || Date.now() >= deadline) return null
    await sleep(RETRY_INTERVAL_MS)
  }
}
