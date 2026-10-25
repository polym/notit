// Cross-tab broadcast after a commit (architecture.md D6 "Cross-tab broadcast", #16, FR15).
// For each affected canonicalUrl the SW sends one page/sync to every tab whose canonicalUrl(tab.url)
// matches, and refreshes those tabs' badges. Tabs without a content script are ignored.
import { emit } from '../../../core/messaging/index.ts'
import { canonicalUrl, siteKey } from '../../../core/url/index.ts'
import type { HighlightRecord } from '../../../core/model/index.ts'
import type { HighlightEvents, PageEvents, PageSync, SiteChanged } from '../shared/protocol.ts'
import { updateBadge } from './badge.ts'
import { isSiteEnabled } from './site-state.ts'
import { isSignedIn } from './auth-gate.ts'

/** Groups committed records into one page/sync payload per canonicalUrl. */
export async function pageSyncs(records: HighlightRecord[]): Promise<PageSync[]> {
  const byPage = new Map<string, HighlightRecord[]>()
  for (const record of records) {
    const list = byPage.get(record.canonicalUrl) ?? []
    list.push(record)
    byPage.set(record.canonicalUrl, list)
  }
  const signedIn = await isSignedIn()
  return Promise.all(
    [...byPage].map(async ([canonical, list]) => ({
      canonicalUrl: canonical,
      upserts: list.filter((r) => r.deletedAt === null),
      removes: list.filter((r) => r.deletedAt !== null).map((r) => r.id),
      enabled: await isSiteEnabled(list[0].siteKey),
      signedIn,
    })),
  )
}

// Broadcasts run one at a time in commit order. Content applies `removes` without an editedAt
// check, so a late delete must never overtake the restore that followed it.
let chain: Promise<void> = Promise.resolve()

/**
 * Sends page/sync to every tab showing an affected page and updates their badges.
 * Calls are serialized: each broadcast starts only after the previous one finished. Never rejects.
 */
export function broadcastCommitted(records: HighlightRecord[]): Promise<void> {
  const next = chain.then(() => doBroadcast(records))
  chain = next.catch(() => {})
  return chain
}

/**
 * After a sign-in change: sends every http(s) tab an empty page/sync carrying the new signedIn flag
 * (content shows or hides the selection menu) and recomputes every tab's badge, which also clears a
 * '!' left by a failed side panel open (Q47). Serialized with commit broadcasts. Never rejects.
 */
export function broadcastAuthChanged(signedIn: boolean): Promise<void> {
  const next = chain.then(() => doAuthBroadcast(signedIn))
  chain = next.catch(() => {})
  return chain
}

/**
 * After a local wipe: sends page/clear to every tab (content removes all renders) and recomputes
 * every tab's badge against the empty database. Serialized with other broadcasts. Never rejects.
 */
export function broadcastCleared(): Promise<void> {
  const next = chain.then(doClearBroadcast)
  chain = next.catch(() => {})
  return chain
}

/**
 * After a manual site switch: sends site/changed to the side panel and to every tab of that site
 * (content renders or removes its highlights) and recomputes their badges. Serialized with other
 * broadcasts. Never rejects.
 */
export function broadcastSiteChanged(change: SiteChanged): Promise<void> {
  const next = chain.then(() => doSiteBroadcast(change))
  chain = next.catch(() => {})
  return chain
}

async function doSiteBroadcast(change: SiteChanged): Promise<void> {
  try {
    void emit<HighlightEvents>('site/changed', change)
    const tabs = await chrome.tabs.query({})
    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id === undefined || !tab.url || siteKey(tab.url) !== change.siteKey) return
        await Promise.all([emit<PageEvents>('site/changed', change, { tabId: tab.id }), updateBadge(tab.id, tab.url)])
      }),
    )
  } catch (error) {
    console.error('[NoteIt] Failed to broadcast site/changed:', error)
  }
}

async function doClearBroadcast(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({})
    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id === undefined) return
        await Promise.all([emit<PageEvents>('page/clear', {}, { tabId: tab.id }), updateBadge(tab.id, tab.url)])
      }),
    )
  } catch (error) {
    console.error('[NoteIt] Failed to broadcast page/clear:', error)
  }
}

async function doAuthBroadcast(signedIn: boolean): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({})
    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id === undefined || !tab.url) return
        const canonical = canonicalUrl(tab.url)
        const site = siteKey(tab.url)
        if (canonical === null || site === null) return
        const sync: PageSync = { canonicalUrl: canonical, upserts: [], removes: [], enabled: await isSiteEnabled(site), signedIn }
        await Promise.all([emit<PageEvents>('page/sync', sync, { tabId: tab.id }), updateBadge(tab.id, tab.url)])
      }),
    )
  } catch (error) {
    console.error('[NoteIt] Failed to broadcast sign-in change:', error)
  }
}

async function doBroadcast(records: HighlightRecord[]): Promise<void> {
  try {
    const [syncs, tabs] = await Promise.all([pageSyncs(records), chrome.tabs.query({})])
    const byPage = new Map(syncs.map((s) => [s.canonicalUrl, s]))
    await Promise.all(
      tabs.map(async (tab) => {
        if (tab.id === undefined || !tab.url) return
        const canonical = canonicalUrl(tab.url)
        const sync = canonical === null ? undefined : byPage.get(canonical)
        if (!sync) return
        // emit swallows delivery failures (tab without content script, closed tab).
        await Promise.all([emit<PageEvents>('page/sync', sync, { tabId: tab.id }), updateBadge(tab.id, tab.url)])
      }),
    )
  } catch (error) {
    console.error('[NoteIt] Failed to broadcast page/sync:', error)
  }
}
