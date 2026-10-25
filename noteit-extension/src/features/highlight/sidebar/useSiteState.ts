// Site state of the active tab for the side panel (Story 3.6, FR18, FR24, D8). The service worker owns
// the rule (override or has highlights) and answers page/getState; the panel re-reads it after
// site/changed (manual switch, from anywhere) and db/changed (a first highlight turns a site on).
import { useEffect, useState } from 'react'
import { createClient, onEvent } from '../../../core/messaging/index.ts'
import { useQuery } from '../../../ui/sidebar/hooks/useQuery.ts'
import type { HighlightEvents, PageRequests } from '../shared/protocol.ts'
import { client } from './client.ts'
import { supportedSiteKey } from './site-support.ts'

/** loading: not answered yet; unsupported: chrome://, extension pages, PDF tabs. */
export type SiteStatus = 'loading' | 'unsupported' | 'on' | 'off'

export interface SiteState {
  status: SiteStatus
  setEnabled: (enabled: boolean) => Promise<void>
}

const pageClient = createClient<PageRequests>()

/** How often a loaded tab without a content-script answer is pinged again before it counts as unsupported. */
const NO_RECEIVER_RETRIES = 6
const RETRY_MS = 300

/** pending: tab still loading or no longer active; noReceiver: loaded, but nothing answered yet. */
type Reach = 'reachable' | 'unsupported' | 'noReceiver' | 'pending'

/**
 * Whether the active tab showing `url` can highlight. PDFs served without a .pdf suffix open in
 * Chrome's viewer: its wrapper document answers supported: false. A tab with no content script
 * (opened before install, blocked page) never answers; the content script is imported
 * asynchronously, so a loaded tab may also not answer yet, and the hook retries before deciding.
 */
async function reachActiveTab(url: string): Promise<Reach> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
  // The active tab moved on; the next url change re-runs this check.
  if (active?.id === undefined || active.url !== url) return 'pending'
  const ping = await pageClient.send('page/ping', {}, { tabId: active.id })
  if (ping.ok) return ping.data.supported ? 'reachable' : 'unsupported'
  return active.status === 'complete' ? 'noReceiver' : 'pending'
}

export function useSiteState(url: string): SiteState {
  const site = url ? supportedSiteKey(url) : null
  const [version, setVersion] = useState(0)

  useEffect(() => onEvent<HighlightEvents>({ 'site/changed': () => setVersion((v) => v + 1) }), [])

  // A tab that finished loading gets pinged again (its content script runs at document_end).
  useEffect(() => {
    const onUpdated = (_tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => {
      if (tab.active && changeInfo.status === 'complete') setVersion((v) => v + 1)
    }
    chrome.tabs.onUpdated.addListener(onUpdated)
    return () => chrome.tabs.onUpdated.removeListener(onUpdated)
  }, [])

  const query = useQuery(async () => {
    if (!site) return { url, reach: 'unsupported' as Reach, enabled: null }
    const [reach, result] = await Promise.all([reachActiveTab(url), client.send('page/getState', { url })])
    if (!result.ok) {
      console.warn('[NoteIt] page/getState failed:', result.error.code)
      return { url, reach, enabled: null }
    }
    return { url, reach, enabled: result.data.enabled }
  }, [url, site, version])

  // Re-check a tab that is still loading or has not answered yet. tabs.onUpdated 'complete' alone is
  // not enough: it can fire before the panel has the new URL or before the content script listens.
  const [retries, setRetries] = useState({ url: '', count: 0 })
  const retryCount = retries.url === url ? retries.count : 0
  const reach = site && query.data?.url === url ? query.data.reach : null
  const waiting = reach === 'pending' || (reach === 'noReceiver' && retryCount < NO_RECEIVER_RETRIES)
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => {
      // A tab that loads again (same URL revisited) gets the full retry budget again.
      setRetries({ url, count: reach === 'noReceiver' ? retryCount + 1 : 0 })
      setVersion((v) => v + 1)
    }, RETRY_MS)
    return () => clearTimeout(timer)
  }, [waiting, reach, url, retryCount, query.data])

  let status: SiteStatus
  if (!url) status = 'loading'
  else if (!site) status = 'unsupported'
  else if (query.data?.url !== url || waiting) status = 'loading'
  else if (query.data.reach !== 'reachable') status = 'unsupported'
  // The service worker could not answer for a supported page: keep the switch off, but usable.
  else status = query.data.enabled ? 'on' : 'off'

  const setEnabled = async (enabled: boolean) => {
    if (!site) return
    const result = await client.send('site/setEnabled', { siteKey: site, enabled })
    if (!result.ok) console.warn('[NoteIt] site/setEnabled failed:', result.error.code)
    // site/changed also triggers a re-read; this one covers a missed event.
    setVersion((v) => v + 1)
  }

  return { status, setEnabled }
}
