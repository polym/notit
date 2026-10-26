// In-page Shadow host (architecture.md D10 "In-page UI Isolation", NFR19):
// - one <noteit-root> per tab, appended at the end of document.documentElement (outside <body>, so it
//   is not part of the page's layout flow or the body MutationObserver);
// - open shadow root (Playwright and axe can reach the overlays);
// - the first rule resets the host with `all: initial` and pins it as a fixed, zero-size layer on
//   top of the page that does not take pointer events; overlays opt back in with `.nt-overlay`;
// - styles are injected via adoptedStyleSheets: the --nt-* token variables plus per-component CSS.
// Declarations on :host are !important: page !important rules (e.g. `* { all: unset !important }`)
// match the host element too, and only an important :host rule from the shadow tree outranks them.
import { cssVarsText } from '../tokens/index.ts'

export const HOST_TAG = 'noteit-root'

/** Base stylesheet text of the shadow root (exported for tests). */
export const HOST_CSS = `:host {
  all: initial !important;
  display: block !important;
  position: fixed !important;
  inset: 0 auto auto 0 !important;
  width: 0 !important;
  height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  overflow: visible !important;
  z-index: 2147483647 !important;
  pointer-events: none !important;
  color: var(--nt-foreground) !important;
  font-family: var(--nt-font-family) !important;
  font-size: var(--nt-body-font-size) !important;
  font-weight: var(--nt-body-font-weight) !important;
  line-height: var(--nt-body-line-height) !important;
}
*, *::before, *::after { box-sizing: border-box; }
.nt-overlay {
  position: fixed;
  pointer-events: auto;
}
`

export interface ShadowHost {
  host: HTMLElement
  root: ShadowRoot
  /** Adds a component stylesheet (constructed once by the caller or from text here). */
  adoptStyles(css: string | CSSStyleSheet): CSSStyleSheet
  /** Removes the host from the page. */
  destroy(): void
}

let current: ShadowHost | null = null

function sheetFrom(css: string): CSSStyleSheet {
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(css)
  return sheet
}

const XHTML_NS = 'http://www.w3.org/1999/xhtml'
const HTML_CONTENT_TYPES = new Set(['text/html', 'application/xhtml+xml'])

/** True when the document can host an HTML custom element with a shadow root (not SVG/XML). */
function isHtmlDocument(doc: Document): boolean {
  const view = doc.defaultView
  const root = doc.documentElement as Element | null
  if (view === null || root === null || !(root instanceof view.HTMLElement)) return false
  return HTML_CONTENT_TYPES.has(doc.contentType)
}

function create(doc: Document): ShadowHost | null {
  if (!isHtmlDocument(doc)) return null
  // A host left behind by a previous content script instance (extension reload) is replaced.
  for (const stale of doc.querySelectorAll(HOST_TAG)) stale.remove()
  // createElementNS keeps the host an HTML element even in XHTML documents.
  const host = doc.createElementNS(XHTML_NS, HOST_TAG) as HTMLElement
  let root: ShadowRoot
  try {
    root = host.attachShadow({ mode: 'open' })
  } catch {
    return null
  }
  root.adoptedStyleSheets = [sheetFrom(`${cssVarsText(':host')}${HOST_CSS}`)]
  doc.documentElement.append(host)
  const shadowHost: ShadowHost = {
    host,
    root,
    adoptStyles(css) {
      const sheet = typeof css === 'string' ? sheetFrom(css) : css
      if (!root.adoptedStyleSheets.includes(sheet)) root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet]
      return sheet
    },
    destroy() {
      host.remove()
      if (current === shadowHost) current = null
    },
  }
  return shadowHost
}

/**
 * Returns the page's shadow host, mounting it on first use (idempotent). Returns null on documents
 * that cannot host it (SVG, XML and other non-HTML documents).
 */
export function mountShadowHost(doc: Document = document): ShadowHost | null {
  if (current && current.host.ownerDocument === doc) {
    // Re-append when the page removed it (e.g. a framework replacing documentElement children).
    if (!current.host.isConnected) doc.documentElement.append(current.host)
    return current
  }
  current = create(doc)
  return current
}
