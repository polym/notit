console.log('[NoteIt] Content Script Loaded');

import { SelectionManager } from './SelectionManager';
import { client } from './client';
import { AnchorTracker } from './anchors';
import { isExtensionEnabled, pageRecords, setExtensionEnabled, setSignedIn } from './state';
import { canonicalUrl, siteKey } from '../core/url';
import { HandlerError, createRouter, onEvent, type Handlers } from '../core/messaging';
import { ANCHOR_LOST_WINDOW_MS, isColorName, type HighlightRecord } from '../core/model';
import type { PageEvents, PageRequests, PageState, PageSync, SiteChanged } from '../features/highlight/index.ts';
import { mountShadowHost } from '../ui/inpage/index.ts';
import {
  createRenderer,
  anchorQuery,
  PageObserver,
  createTextIndex,
  resolveAnchor,
  runRestorePass,
  hideCommentPreview,
  hideHighlightPopover,
  installFloatingMenuKeyGuard,
  openCommentPreviewKey,
  openHighlightPopoverKey,
  refreshCommentPreview,
  refreshHighlightPopover,
} from '../features/highlight/inpage.ts';

// Keydown capture guard first (Story 3.13): it must precede any page listener registered later.
installFloatingMenuKeyGuard();

// In-page Shadow host (Story 3.12, D10): mounted once per tab; later stories render their overlays
// into it. It sits outside <body>, so the body MutationObserver below never sees it. A failure here
// must never stop the managers, the router or the message listeners below from registering.
try {
  mountShadowHost();
} catch (error) {
  console.warn('[NoteIt] Shadow host not mounted', error);
}

// Initialize Managers
const renderer = createRenderer();
// The active engine (Story 4.6 spike) on the host, so tests know how to read painted highlights.
mountShadowHost()?.host.setAttribute('data-noteit-renderer', renderer.paintsElements ? 'mark' : 'highlight-api');
const selectionManager = new SelectionManager(renderer);

const styleOf = (record: HighlightRecord) => ({ color: record.color, commented: Boolean(record.comment) });

/** Resolves and paints one record against a fresh TextIndex. */
const renderOne = (record: HighlightRecord) => {
  const hit = resolveAnchor(createTextIndex(), anchorQuery(record));
  if (hit) renderer.paint(record.id, hit.range, styleOf(record));
};

// Restore passes (Story 4.4): one runs at a time. A 'full' pass fetches the page records, clears and
// repaints everything; an 'incremental' pass (after page mutations) only re-resolves the records that
// are not painted (Range gone or never found). Requests that arrive while a pass runs are queued; a
// queued full pass absorbs a queued incremental one.
type PassKind = 'full' | 'incremental';
// True while a pass runs (the lost window end waits for it).
let passRunning = false;
let pendingPass: PassKind | null = null;
let passLoop: Promise<void> | null = null;
// Bumped on every site switch-off; a pass that sees a different value after an await is stale.
let loadGeneration = 0;
// TextIndex builds by restore passes, mirrored on the host for tests (the host is outside <body>).
let indexBuilds = 0;
// Canonical URL of the last non-stale full pass; a change means an SPA navigation happened.
let lastLoadUrl: string | null = null;

// Lost decision (Story 2.11): verdicts go to the service worker, which owns anchorStatus.
const anchorTracker = new AnchorTracker({
  expectedIds: () => pageRecords.keys(),
  isRendered: (id) => renderer.isPainted(id),
  isBusy: () => passRunning,
  canonicalUrl: () => canonicalUrl(window.location.href),
  send: (report) => {
    void client.send('anchor/report', report).then((result) => {
      if (!result.ok) console.error('[NoteIt] Failed to report anchors:', result.error.code);
    });
  },
  windowMs: ANCHOR_LOST_WINDOW_MS,
});

// Site state marker (Story 3.16, FR42): the page shows no status overlay; site state lives in the
// side panel header and the badge. The host carries a data attribute so tests can tell when the
// content script has applied an enable.
const markSiteState = (enabled: boolean) => {
  const host = mountShadowHost()?.host;
  if (!host) return;
  if (enabled) host.setAttribute('data-noteit-site', 'on');
  else host.removeAttribute('data-noteit-site');
};

/** Page state from the service worker; null for pages it does not handle (non-http(s), no receiver). */
const fetchPageState = async (url: string): Promise<PageState | null> => {
  const result = await client.send('page/getState', { url });
  if (!result.ok) {
    if (result.error.code !== 'bad_request') console.error('[NoteIt] Failed to read page state:', result.error.code);
    return null;
  }
  return result.data;
};

// Turns the page on after the service worker has already decided the site is enabled (D8).
const enableExtension = async () => {
  setExtensionEnabled(true);
  console.log('[NoteIt] Extension enabled for:', window.location.href);
  markSiteState(true);
  await requestPass('full');
};

/** Current style of a page record; null once it is gone (a pass skips it). */
const styleById = (id: string) => {
  const record = pageRecords.get(id);
  return record ? styleOf(record) : null;
};

const countIndexBuild = () => {
  indexBuilds++;
  mountShadowHost()?.host.setAttribute('data-noteit-index-builds', String(indexBuilds));
};

/** Records the next pass should restore, or null when there is nothing to do. */
const prepareFullPass = async (isStale: () => boolean): Promise<HighlightRecord[] | null> => {
  const state = await fetchPageState(window.location.href);
  if (!state) return null;
  setSignedIn(state.signedIn);
  if (isStale()) return null;
  pageRecords.clear();
  for (const record of state.highlights) pageRecords.set(record.id, record);
  // A full pass may follow an SPA navigation or drop records: overlays bound to a highlight that is
  // no longer on this page must close (and a URL change closes the undo toast too).
  const passUrl = canonicalUrl(window.location.href);
  if (lastLoadUrl !== null && passUrl !== lastLoadUrl) selectionManager.hideOverlays();
  lastLoadUrl = passUrl;
  const openKey = openHighlightPopoverKey();
  if (openKey !== null && !pageRecords.has(openKey)) hideHighlightPopover();
  console.log(`[NoteIt] Found ${state.highlights.length} highlights for current page`);
  renderer.clear();
  return state.highlights;
};

const runPass = async (kind: PassKind) => {
  // Only restore highlights if the extension is enabled for this site
  if (!isExtensionEnabled()) return;
  const generation = loadGeneration;
  // The site was switched off while this pass awaited: drop its results and anything it rendered.
  const isStale = () => generation !== loadGeneration || !isExtensionEnabled();
  const records =
    kind === 'full'
      ? await prepareFullPass(isStale)
      : [...pageRecords.values()].filter((record) => !renderer.isPainted(record.id));
  if (records === null) return;
  // Incremental pass with every record painted: no TextIndex rebuild. A highlight whose node came
  // back with its marks still inside is painted again, so the lost decision is re-evaluated (only
  // after a full pass has opened the window).
  if (kind === 'incremental' && records.length === 0) {
    passRunning = false;
    if (lastLoadUrl !== null) anchorTracker.afterRender();
    return;
  }
  await runRestorePass(records, { renderer, styleOf: styleById, cancelled: isStale, onIndexBuilt: countIndexBuild });
  if (isStale()) {
    renderer.clear();
    pageRecords.clear();
    return;
  }
  // Cleared before the evaluation, so this pass's own verdicts are not deferred as busy.
  passRunning = false;
  anchorTracker.afterRender();
};

/** Runs queued passes one after another until none is left. */
const drainPasses = async () => {
  // Starts in a later microtask, so `passLoop` is assigned before the loop can finish and clear it.
  await Promise.resolve();
  try {
    while (pendingPass !== null) {
      const kind = pendingPass;
      pendingPass = null;
      passRunning = true;
      try {
        await runPass(kind);
      } catch (error) {
        console.error('[NoteIt] Failed to restore highlights:', error);
      } finally {
        passRunning = false;
      }
    }
  } finally {
    passLoop = null;
  }
};

/** Queues a restore pass; resolves when the queue (including this pass) has drained. */
const requestPass = (kind: PassKind): Promise<void> => {
  pendingPass = kind === 'full' || pendingPass === 'full' ? 'full' : 'incremental';
  passLoop ??= drainPasses();
  return passLoop;
};

// Dynamic pages (FR11, D7): foreign mutations re-resolve the records that are not painted. A changed
// canonical URL (SPA navigation) needs the other page's records, so it gets a full pass instead.
const pageObserver = new PageObserver({
  isOwnMutation: (record) => renderer.isOwnMutation(record),
  onChange: () => {
    const navigated = lastLoadUrl !== null && canonicalUrl(window.location.href) !== lastLoadUrl;
    void requestPass(navigated ? 'full' : 'incremental');
  },
});

// D8: the service worker decides whether the site is enabled (manual override or has highlights).
const init = async () => {
  // Observed from the start, so content that arrives while the first pass runs is retried.
  pageObserver.start();
  const currentUrl = window.location.href;
  const state = await fetchPageState(currentUrl);
  if (state) setSignedIn(state.signedIn);
  if (state?.enabled) {
    console.log('[NoteIt] Site enabled, loading highlights');
    await enableExtension();
  } else {
    console.log('[NoteIt] Extension disabled by default for this site');
  }
};

// Wait for DOM to be ready before loading highlights
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => void init());
} else {
  void init();
}

// Cross-tab broadcast (Story 2.9): the service worker sends page/sync after every commit to all
// tabs of the same canonicalUrl. Records are applied by id; the DOM is never read back.
const applyPageSync = (sync: PageSync) => {
  if (canonicalUrl(window.location.href) !== sync.canonicalUrl) return;
  setSignedIn(sync.signedIn);
  if (!isExtensionEnabled()) {
    // A highlight created in another tab of this page turns the site on (D8); load everything.
    if (sync.enabled && sync.upserts.length > 0) void enableExtension();
    return;
  }
  for (const id of sync.removes) {
    // A removed mark fires no mouseout; close its preview here.
    if (id === openCommentPreviewKey()) hideCommentPreview();
    if (id === openHighlightPopoverKey()) hideHighlightPopover();
    renderer.remove(id);
    pageRecords.delete(id);
  }
  let painted = false;
  for (const record of sync.upserts) {
    const known = pageRecords.get(record.id);
    const rendered = renderer.isPainted(record.id);
    // Skip echoes of our own writes and stale events that arrive after a newer local result.
    if (known && known.editedAt >= record.editedAt && rendered) continue;
    pageRecords.set(record.id, record);
    // The preview shows the stored comment; follow edits and clears of it.
    refreshCommentPreview(record.id, record.comment);
    refreshHighlightPopover(record.id, record.color);
    if (rendered) {
      renderer.restyle(record.id, styleOf(record));
    } else {
      renderOne(record);
      painted = true;
    }
  }
  // While a pass runs, a full pass has unpainted every highlight; evaluating now would report them
  // all lost. The pass's own afterRender covers these records.
  if (painted && !passRunning) anchorTracker.afterRender();
};

// Sign-out / first sign-in wipe (Story 2.19): local data is gone, so every render goes too.
const applyPageClear = () => {
  hideCommentPreview();
  selectionManager.hideOverlays();
  renderer.clear();
  pageRecords.clear();
};

// Site switch (Story 3.6, FR18): the service worker has already stored the override, wherever it was
// flipped (side panel, shortcut / context menu, another tab of the site); only apply it to this page.
const applySiteChanged = (change: SiteChanged) => {
  if (siteKey(window.location.href) !== change.siteKey) return;
  if (change.enabled === isExtensionEnabled()) return;
  if (change.enabled) {
    void enableExtension();
  } else {
    setExtensionEnabled(false);
    markSiteState(false);
    loadGeneration++;
    pendingPass = null;
    hideCommentPreview();
    selectionManager.hideOverlays();
    renderer.clear();
    pageRecords.clear();
    anchorTracker.reset();
  }
};

onEvent<PageEvents>({ 'page/sync': applyPageSync, 'page/clear': applyPageClear, 'site/changed': applySiteChanged });

/** Waits up to the lost window for a highlight to render, then scrolls to and flashes it. */
const flashHighlight = async (id: string): Promise<boolean> => {
  for (let waited = 0; !renderer.isPainted(id) && waited < ANCHOR_LOST_WINDOW_MS; waited += 100) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!renderer.scrollIntoView(id)) return false;
  // highlight-flash (DESIGN.md, Story 3.9): darker for HIGHLIGHT_FLASH_MS, then back to the normal style.
  return renderer.flash(id);
};

// Shortcut / context menu (Story 2.10): the service worker has already written the 'on' override,
// so the site is on before the create. The selection is used as it is when the request arrives;
// existing highlights are loaded only after the create so their repaint cannot drop the selection.
const pageHandlers: Handlers<PageRequests> = {
  async 'page/triggerHighlight'(req) {
    const color = typeof req === 'object' && req !== null && isColorName(req.color) ? req.color : 'yellow';
    const wasEnabled = isExtensionEnabled();
    setExtensionEnabled(true);
    const result = await selectionManager.triggerHighlight(color);
    if (!wasEnabled) {
      markSiteState(true);
      await requestPass('full');
    }
    if (result === null) throw new HandlerError('bad_request', 'no text selected');
    if (!result.ok) throw new HandlerError(result.error.code, result.error.message);
    return result.data;
  },

  async 'page/flash'(req) {
    if (typeof req !== 'object' || req === null || typeof req.id !== 'string') {
      throw new HandlerError('bad_request', 'id is required');
    }
    return { found: await flashHighlight(req.id) };
  },

  async 'page/ping'() {
    // PDF viewer wrapper (any URL that served application/pdf): the text lives in the viewer plugin.
    return { supported: document.contentType !== 'application/pdf' };
  },
};

createRouter<PageRequests>(pageHandlers).listen();

console.log('[NoteIt] Managers Initialized');
