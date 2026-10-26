// Shortcut and context menu entry points (architecture.md D8, Q41, Q58, FR2, FR19).
// Both turn a closed site on first ('on' override) and then ask the tab's content script to
// create a yellow highlight from its current selection with page/triggerHighlight.
// Login gate (D5, Q47): while signed out neither creates anything; both open the side panel
// (which shows the login form) and fall back to a '!' badge when that open throws.
import { createClient, type Result } from '../../../core/messaging/index.ts'
import { siteKey } from '../../../core/url/index.ts'
import type { HighlightRecord } from '../../../core/model/index.ts'
import { strings } from '../../../ui/strings.ts'
import type { PageRequests } from '../shared/protocol.ts'
import { ensureSiteEnabled } from './site-state.ts'
import { broadcastSiteChanged } from './broadcast.ts'
import { cachedSignedIn, isSignedIn } from './auth-gate.ts'

export const HIGHLIGHT_COMMAND = 'highlight-selection'
export const HIGHLIGHT_MENU_ID = 'noteit-highlight'
/** _locales key of the selection menu title (must equal strings.menuHighlightSelection). */
export const HIGHLIGHT_MENU_MESSAGE = 'menuHighlightSelection'

const pageClient = createClient<PageRequests>()

interface TabLike {
  id?: number
  url?: string
  windowId?: number
}

/** Badge shown when the side panel could not be opened for a signed-out shortcut / menu use. */
export const LOGIN_NEEDED_BADGE = '!'

function markLoginNeeded(tab: TabLike | undefined, error: unknown): void {
  console.error('[NoteIt] Failed to open the side panel for sign-in:', error)
  const details = tab?.id !== undefined ? { text: LOGIN_NEEDED_BADGE, tabId: tab.id } : { text: LOGIN_NEEDED_BADGE }
  chrome.action.setBadgeText(details).catch((e: unknown) => console.error('[NoteIt] Failed to set badge:', e))
}

/**
 * Opens the side panel so the user can sign in. Must be called synchronously from the command /
 * menu listener: chrome.sidePanel.open only works inside that user gesture. A throw or rejection
 * puts '!' on the badge; the badge is recomputed on the next sign-in change or navigation.
 */
export function openSidePanelForLogin(tab: TabLike | undefined): void {
  try {
    const options =
      tab?.windowId !== undefined ? { windowId: tab.windowId } : tab?.id !== undefined ? { tabId: tab.id } : null
    if (options === null) throw new Error('no window or tab to open the side panel in')
    chrome.sidePanel.open(options).catch((error: unknown) => markLoginNeeded(tab, error))
  } catch (error) {
    markLoginNeeded(tab, error)
  }
}

/**
 * Turns the tab's site on (when it is not on yet) and sends page/triggerHighlight {color:'yellow'}.
 * Returns null for tabs that are not http(s) pages. A tab without a content script yields an
 * error Result (createClient never rejects).
 */
export async function triggerHighlight(tab: TabLike | undefined): Promise<Result<HighlightRecord> | null> {
  if (tab?.id === undefined || !tab.url) return null
  const site = siteKey(tab.url)
  if (site === null) return null
  // Tell the side panel and the site's other tabs even when the create below fails (no selection).
  if (await ensureSiteEnabled(site)) void broadcastSiteChanged({ siteKey: site, enabled: true })
  return pageClient.send('page/triggerHighlight', { color: 'yellow' }, { tabId: tab.id })
}

function runTrigger(tab: TabLike | undefined): void {
  // Synchronous check: awaiting the sign-in state here would lose the user gesture.
  const known = cachedSignedIn()
  if (known === false) {
    openSidePanelForLogin(tab)
    return
  }
  if (known === null) {
    // The command woke the worker before the first read finished. Open the panel now, while the
    // gesture is still active, then create only if the read says signed in. A signed-in user
    // may see the panel open on a cold start; that is the price of keeping the gesture.
    openSidePanelForLogin(tab)
    isSignedIn().then(
      (signedIn) => {
        if (signedIn) startTrigger(tab)
      },
      (error: unknown) => console.error('[NoteIt] Failed to read sign-in state:', error),
    )
    return
  }
  startTrigger(tab)
}

function startTrigger(tab: TabLike | undefined): void {
  triggerHighlight(tab).then(
    (result) => {
      // The cached state was stale (session expired since): the gesture is gone, try anyway.
      if (result && !result.ok && result.error.code === 'unauthenticated') {
        openSidePanelForLogin(tab)
        return
      }
      if (result && !result.ok && result.error.code !== 'bad_request') {
        console.error('[NoteIt] Highlight from shortcut / menu failed:', result.error.code)
      }
    },
    (error: unknown) => console.error('[NoteIt] Highlight from shortcut / menu failed:', error),
  )
}

export function onCommand(command: string, tab: TabLike | undefined): void {
  if (command === HIGHLIGHT_COMMAND) runTrigger(tab)
}

export function onMenuClicked(info: { menuItemId: string | number }, tab: TabLike | undefined): void {
  if (info.menuItemId === HIGHLIGHT_MENU_ID) runTrigger(tab)
}

/**
 * Creates the only context menu item (Story 3.16, FR42): highlight the selection. Site on / off
 * lives in the side panel header, not in the menu. The title comes from _locales; the UI strings
 * copy is the fallback when the message is missing.
 */
export function createMenus(): void {
  const title = chrome.i18n.getMessage(HIGHLIGHT_MENU_MESSAGE) || strings.menuHighlightSelection
  // Drop items left by an earlier version (the legacy site toggle) before creating ours.
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: HIGHLIGHT_MENU_ID, title, contexts: ['selection'] })
  })
}

/** Registers the context menu item (on install) and the shortcut / menu listeners. */
export function registerCommands(): void {
  chrome.runtime.onInstalled.addListener(createMenus)
  chrome.contextMenus.onClicked.addListener(onMenuClicked)
  chrome.commands.onCommand.addListener(onCommand)
}
