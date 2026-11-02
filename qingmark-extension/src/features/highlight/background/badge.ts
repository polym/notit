// Toolbar badge, icon and tooltip for each tab's page (FR23), read from the local db. The badge is
// the live highlight count; the icon is the gold ginkgo leaf when the page has highlights.
// Empty when the count is 0, the site is disabled or the tab is not an http(s) page.
import { read } from '../../../core/db/read.ts'
import { canonicalUrl, siteKey } from '../../../core/url/index.ts'
import { strings } from '../../../ui/strings.ts'
import { colors } from '../../../ui/tokens/index.ts'
import { isSiteEnabled } from './site-state.ts'

// DESIGN.md action-badge: foreground background with primary-foreground text.
const BADGE_COLOR = colors.foreground

/** Badge text for a page URL: the live count of its canonicalUrl, or '' (0, disabled, non-http). */
export async function badgeText(url: string | undefined): Promise<string> {
  const canonical = url ? canonicalUrl(url) : null
  const site = url ? siteKey(url) : null
  if (canonical === null || site === null) return ''
  if (!(await isSiteEnabled(site))) return ''
  const count = (await read.byCanonicalUrl(canonical)).length
  return count > 0 ? count.toString() : ''
}

/** Toolbar icon paths for a state: hollow green leaf (no highlights) or solid gold leaf. */
export function actionIconPaths(hasHighlights: boolean): Record<16 | 32 | 48, string> {
  const state = hasHighlights ? 'on' : 'off'
  return { 16: `icons/leaf-${state}-16.png`, 32: `icons/leaf-${state}-32.png`, 48: `icons/leaf-${state}-48.png` }
}

/**
 * Recomputes the badge, icon and tooltip of one tab. Chrome resets per-tab icons on navigation,
 * so this runs on every load and tab switch. Errors (closed tab, db failure) are logged, never thrown.
 */
export async function updateBadge(tabId: number, url: string | undefined): Promise<void> {
  try {
    const text = await badgeText(url)
    const hasHighlights = text !== ''
    await Promise.all([
      chrome.action.setBadgeText({ text, tabId }),
      chrome.action.setIcon({ path: actionIconPaths(hasHighlights), tabId }),
      chrome.action.setTitle({ title: hasHighlights ? strings.actionTitleWithHighlights(Number(text)) : strings.actionTitleIdle, tabId }),
    ])
    if (hasHighlights) await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR, tabId })
  } catch (error) {
    console.error('[QingMark] Failed to update badge:', error)
  }
}

/** Recomputes the badge of the active tab of every window. */
export async function updateActiveBadges(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ active: true })
    await Promise.all(tabs.map((tab) => (tab.id === undefined ? undefined : updateBadge(tab.id, tab.url))))
  } catch (error) {
    console.error('[QingMark] Failed to update active badges:', error)
  }
}

/** Registers the badge listeners (navigation and tab switch). Commits call updateBadge directly. */
export function startBadge(): void {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' || changeInfo.url !== undefined) void updateBadge(tabId, tab.url)
  })
  chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs
      .get(activeInfo.tabId)
      .then((tab) => updateBadge(activeInfo.tabId, tab.url))
      .catch((error: unknown) => console.error('[QingMark] Failed to update badge on tab activation:', error))
  })
  void updateActiveBadges()
}
