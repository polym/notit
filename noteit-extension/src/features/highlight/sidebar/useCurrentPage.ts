// Current page data of the side panel (Story 3.5, FR20, NFR3): the active tab's URL and title, its live
// highlights in article order (through the canonicalUrl index, so opening the panel reads only this
// page) and the ids not found on their page (anchorStatus, Q54). Re-queries on db/changed (useQuery).
import { useEffect, useState } from 'react'
import type { HighlightRecord } from '../../../core/model/index.ts'
import { read } from '../../../core/db/read.ts'
import { canonicalUrl } from '../../../core/url/index.ts'
import { useQuery } from '../../../ui/sidebar/hooks/useQuery.ts'
import { sortForPage } from './order.ts'

const EMPTY: HighlightRecord[] = []
const NO_IDS: ReadonlySet<string> = new Set()

/** Same-page key for a tab URL; non-http(s) tabs (extension pages) fall back to the raw URL. */
export const pageKey = (url: string): string => canonicalUrl(url) ?? url

/** Host name for display; extension-page keys may not parse. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

export interface CurrentPage {
  /** Active tab URL; empty until the first tab query resolves. */
  url: string
  /** Page title row: tab title, else the stored page title, else the host name. */
  title: string
  highlights: HighlightRecord[]
  /** False until the first query for the current URL has resolved. */
  loaded: boolean
  lost: ReadonlySet<string>
}

export function useActiveTab(): { url: string; tabTitle: string } {
  const [tab, setTab] = useState({ url: '', tabTitle: '' })

  useEffect(() => {
    const refresh = async () => {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (active?.url) setTab({ url: active.url, tabTitle: active.title ?? '' })
    }
    void refresh()

    const onActivated = () => void refresh()
    // Every window has its own active tab, so an update is only trusted after re-querying the
    // panel's own window (currentWindow); another window's navigation or title change is ignored.
    const onUpdated = (_tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, updated: chrome.tabs.Tab) => {
      if (!updated.active || (!changeInfo.url && changeInfo.title === undefined)) return
      void refresh()
    }
    chrome.tabs.onActivated.addListener(onActivated)
    chrome.tabs.onUpdated.addListener(onUpdated)
    return () => {
      chrome.tabs.onActivated.removeListener(onActivated)
      chrome.tabs.onUpdated.removeListener(onUpdated)
    }
  }, [])

  return tab
}

export function useCurrentPage(url: string, tabTitle: string): CurrentPage {
  const key = url ? pageKey(url) : ''
  const current = useQuery(async () => ({ key, rows: key ? await read.byCanonicalUrl(key) : EMPTY }), [key])
  const lost = useQuery(async () => new Set(await read.lostIds()), [])

  // A result for an older key is not shown for the new page.
  const rows = current.data?.key === key ? current.data.rows : undefined
  const highlights = rows ? sortForPage(rows) : EMPTY
  const title = tabTitle || highlights.find((h) => h.pageTitle)?.pageTitle || (url ? hostOf(url) : '')

  return { url, title, highlights, loaded: rows !== undefined && key !== '', lost: lost.data ?? NO_IDS }
}
