// Service worker entry: composition only (architecture.md "Structure Patterns").
import { createRouter } from '../../core/messaging/index.ts'
import { authHandlers, getAuthState, onAuthChanged, type AuthRequests } from '../../core/auth/index.ts'
import { clockReady, schedulePush, startSyncEngine, syncHandlers, type SyncRequests } from '../../core/sync/index.ts'
import {
  anchorHandlers,
  broadcastAuthChanged,
  isSignedIn,
  setCachedSignedIn,
  setSignedInChangeListener,
  setSignedInSource,
  debugHandlers,
  type AnchorRequests,
  highlightHandlers,
  notifyCommitted,
  notifyWiped,
  registerCommands,
  setAfterLocalCommit,
  setBeforeLocalWrite,
  startBadge,
  type DebugRequests,
  siteHandlers,
  type HighlightRequests,
  type SiteRequests,
} from '../../features/highlight/index.ts'

console.log('[NoteIt] Service Worker Loaded')

// Login gate (Story 2.15): the highlight feature reads sign-in state through core/auth, and every
// sign-in change updates its cache, the tabs' selection menus and the badges.
setSignedInSource(async () => (await getAuthState()).signedIn)
onAuthChanged((state) => {
  setCachedSignedIn(state.signedIn)
  void broadcastAuthChanged(state.signedIn)
})
// A read that finds a different state than the cached one (session expired or revoked without
// auth/changed) reaches the open tabs and badges the same way.
setSignedInChangeListener((signedIn) => void broadcastAuthChanged(signedIn))
// Warm the cache so a shortcut right after the worker wakes sees the stored session.
void isSignedIn()

// Stamped writes wait for the persisted clock offset (D1), wired before any handler can run.
setBeforeLocalWrite(clockReady)

// debug/dump is registered only outside production builds (architecture.md D6 [proxy]).
if (import.meta.env.MODE !== 'production') {
  createRouter<HighlightRequests & SiteRequests & AnchorRequests & AuthRequests & SyncRequests & DebugRequests>({
    ...highlightHandlers,
    ...authHandlers,
    ...syncHandlers,
    ...siteHandlers,
    ...anchorHandlers,
    ...debugHandlers,
  }).listen()
} else {
  createRouter<HighlightRequests & SiteRequests & AnchorRequests & AuthRequests & SyncRequests>({
    ...highlightHandlers,
    ...authHandlers,
    ...syncHandlers,
    ...siteHandlers,
    ...anchorHandlers,
  }).listen()
}

startBadge()

// Sync (Stories 2.16, 2.17): every local commit schedules a push (1.5s debounce + 30s alarm
// fallback); pulls run on worker start, sign-in, sidebar/opened, tab switches (30s throttle) and a
// 5 minute alarm. Server rows written by a push or pull are announced like local commits
// (db/changed + page/sync).
setAfterLocalCommit(schedulePush)
// Sign-out and first sign-in wipes (Story 2.19) clear every tab's renders and badge.
void startSyncEngine({ onApplied: notifyCommitted, onWiped: notifyWiped })

// Arc has no chrome.sidePanel (FR44, Story 3.11): guard the access so the worker keeps evaluating
// and still registers commands and the PING listener below.
if (chrome.sidePanel) {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error(error))
}

registerCommands()

// Liveness probe: any extension page can wake the service worker with { action: 'PING' }.
// Used by the E2E sw-restart helper to prove the worker restarts on a message.
chrome.runtime.onMessage.addListener((message: { action?: string }, _sender, sendResponse) => {
  if (message?.action === 'PING') sendResponse({ ok: true })
  return false
})
