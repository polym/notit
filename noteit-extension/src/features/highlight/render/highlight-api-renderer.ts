// HighlightApiRenderer (architecture.md D7, M3 spike): paints Ranges with the CSS Custom Highlight API.
// One Highlight per {color, commented} combination is registered in CSS.highlights (names prefixed
// `noteit-`), and one stylesheet with the ::highlight() rules is injected into the host document. The
// host DOM is never changed, so isOwnMutation is always false. Selected by VITE_RENDERER=highlight-api
// (render/create-renderer.ts); MarkRenderer stays the default per the Story 4.7 decision.
// Light overlays only: ::highlight() rules are global per name, so a per-host dark variant would need a
// second set of registry names; MarkRenderer handles dark hosts.
import type { ColorName } from '../../../core/model/index.ts'
import { COLOR_ORDER, overlayColor } from '../../../ui/palette.ts'
import { colors } from '../../../ui/tokens/index.ts'
import { HIGHLIGHT_FLASH_MS, type HighlightStyle, type PaintItem, type Renderer, type RendererRect } from './renderer.ts'

/** Prefix of every Highlight name this renderer registers. */
export const HIGHLIGHT_NAME_PREFIX = 'noteit-'
/** Highlight used by flash(): drawn above the color highlights for HIGHLIGHT_FLASH_MS. */
export const FLASH_HIGHLIGHT_NAME = 'noteit-flash'
const STYLE_ID = 'noteit-highlight-api-styles'
// Color highlights share one priority; the flash layer sits above them.
const COLOR_PRIORITY = 0
const FLASH_PRIORITY = 1

/** Registry name of a {color, commented} combination, e.g. noteit-yellow or noteit-yellow-commented. */
export const highlightName = (style: HighlightStyle): string =>
  `${HIGHLIGHT_NAME_PREFIX}${style.color}${style.commented ? '-commented' : ''}`

const STYLES = () =>
  [
    ...COLOR_ORDER.flatMap((color: ColorName) => [
      // highlight-mark (DESIGN.md): transparent overlay, host text color kept. ::highlight() only
      // accepts color, background-color, text-decoration and text-shadow, so padding / radius /
      // hover opacity of the mark version are not reproduced (spike report S3 notes).
      `::highlight(${highlightName({ color, commented: false })}) { background-color: ${overlayColor(color)}; }`,
      // highlight-mark-commented (DESIGN.md): dotted underline in currentColor.
      `::highlight(${highlightName({ color, commented: true })}) { background-color: ${overlayColor(color)};` +
        ' text-decoration-line: underline; text-decoration-style: dotted; text-decoration-color: currentColor;' +
        ' text-decoration-thickness: 1.5px; text-underline-offset: 3px; }',
    ]),
    // highlight-flash (DESIGN.md): the jump target darkens, then returns to its normal style. A filter
    // is not allowed in ::highlight(), so a translucent foreground layer is stacked over the color overlay.
    `::highlight(${FLASH_HIGHLIGHT_NAME}) { background-color: color-mix(in srgb, ${colors.foreground} 18%, transparent); }`,
  ].join('\n')

interface Entry {
  range: Range
  style: HighlightStyle
  // Boundary points at paint time. Live Ranges collapse onto a parent when their text nodes are
  // removed; a Range whose boundaries moved no longer marks the painted text and counts as unpainted.
  startNode: Node
  startOffset: number
  endNode: Node
  endOffset: number
  /** Paint order; on overlap the most recent highlight wins hitTest (like the innermost mark). */
  order: number
}

/** Result shape of CSS.highlights.highlightsFromPoint (Chrome 140+); older drafts returned Highlights. */
type PointHit = Highlight | { highlight: Highlight; ranges: AbstractRange[] }
type RegistryWithHitTest = HighlightRegistry & {
  highlightsFromPoint?: (x: number, y: number, options?: { shadowRoots?: ShadowRoot[] }) => PointHit[]
}

const rectContains = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom

/** True when the browser has the CSS Custom Highlight API. */
export const highlightApiSupported = (): boolean =>
  typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight === 'function'

export class HighlightApiRenderer implements Renderer {
  readonly paintsElements = false
  private readonly entries = new Map<string, Entry>()
  private readonly highlights = new Map<string, Highlight>()
  private readonly flashHighlight: Highlight
  private readonly flashTimers = new Map<string, number>()
  private nextOrder = 0

  constructor() {
    // Highlights left by a previous content script instance (extension reload) share the registry.
    for (const name of [...CSS.highlights.keys()]) if (name.startsWith(HIGHLIGHT_NAME_PREFIX)) CSS.highlights.delete(name)
    for (const color of COLOR_ORDER) {
      for (const commented of [false, true]) {
        const highlight = new Highlight()
        highlight.priority = COLOR_PRIORITY
        const name = highlightName({ color, commented })
        this.highlights.set(name, highlight)
        CSS.highlights.set(name, highlight)
      }
    }
    this.flashHighlight = new Highlight()
    this.flashHighlight.priority = FLASH_PRIORITY
    CSS.highlights.set(FLASH_HIGHLIGHT_NAME, this.flashHighlight)
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLES()
      // Non-HTML documents (raw .svg/.xml) have no <head>; fall back to the root element.
      const parent: HTMLElement | Element | null = document.head ?? document.documentElement
      parent?.appendChild(style)
    }
  }

  paint(id: string, range: Range, style: HighlightStyle): void {
    this.remove(id)
    if (range.collapsed) return
    // A private copy: the caller's Range may be reused or changed after this call.
    const own = range.cloneRange()
    this.entries.set(id, {
      range: own,
      style: { ...style },
      startNode: own.startContainer,
      startOffset: own.startOffset,
      endNode: own.endContainer,
      endOffset: own.endOffset,
      order: this.nextOrder++,
    })
    this.highlightOf(style).add(own)
  }

  paintAll(items: Iterable<PaintItem>): void {
    // Painting does not touch the DOM, so the Ranges never move and any order is fine.
    for (const item of items) this.paint(item.id, item.range, item.style)
  }

  remove(id: string): void {
    window.clearTimeout(this.flashTimers.get(id))
    this.flashTimers.delete(id)
    const entry = this.entries.get(id)
    if (!entry) return
    this.entries.delete(id)
    this.highlightOf(entry.style).delete(entry.range)
    this.flashHighlight.delete(entry.range)
  }

  clear(): void {
    for (const id of [...this.entries.keys()]) this.remove(id)
  }

  flash(id: string): boolean {
    const entry = this.live(id)
    if (!entry) return false
    window.clearTimeout(this.flashTimers.get(id))
    this.flashHighlight.add(entry.range)
    this.flashTimers.set(
      id,
      window.setTimeout(() => {
        this.flashTimers.delete(id)
        this.flashHighlight.delete(entry.range)
      }, HIGHLIGHT_FLASH_MS),
    )
    return true
  }

  hitTest(x: number, y: number): string | null {
    const registry = CSS.highlights as RegistryWithHitTest
    let candidates: Entry[]
    if (typeof registry.highlightsFromPoint === 'function') {
      const ranges = new Set<AbstractRange>()
      for (const hit of registry.highlightsFromPoint(x, y)) {
        if (hit instanceof Highlight) {
          // Highlight-only result: every Range of the hit highlight is a candidate, checked by rect below.
          hit.forEach((range) => ranges.add(range))
        } else {
          for (const range of hit.ranges) ranges.add(range)
        }
      }
      candidates = [...this.entries.values()].filter((entry) => ranges.has(entry.range))
    } else {
      candidates = [...this.entries.values()]
    }
    let best: [string, Entry] | null = null
    for (const [id, entry] of this.entries) {
      if (!candidates.includes(entry) || !this.isLive(entry)) continue
      if (!Array.from(entry.range.getClientRects()).some((r) => rectContains(r, x, y))) continue
      if (!best || entry.order > best[1].order) best = [id, entry]
    }
    return best ? best[0] : null
  }

  isOwnMutation(): boolean {
    // Painting never changes the DOM, so no mutation is ever ours.
    return false
  }

  restyle(id: string, style: HighlightStyle): void {
    const entry = this.entries.get(id)
    if (!entry) return
    if (highlightName(entry.style) === highlightName(style)) return
    this.highlightOf(entry.style).delete(entry.range)
    entry.style = { ...style }
    this.highlightOf(style).add(entry.range)
  }

  isPainted(id: string): boolean {
    return this.live(id) !== null
  }

  boundingRect(id: string): RendererRect | null {
    const entry = this.live(id)
    if (!entry) return null
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const r of entry.range.getClientRects()) {
      if (r.width === 0 && r.height === 0) continue
      left = Math.min(left, r.left)
      top = Math.min(top, r.top)
      right = Math.max(right, r.right)
      bottom = Math.max(bottom, r.bottom)
    }
    if (left === Infinity) return null
    return { left, top, width: right - left, height: bottom - top }
  }

  scrollIntoView(id: string): boolean {
    const entry = this.live(id)
    if (!entry) return false
    const node = entry.range.startContainer
    const element = node instanceof Element ? node : node.parentElement
    if (!element) return false
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return true
  }

  private highlightOf(style: HighlightStyle): Highlight {
    // Unknown colors fall back to yellow, like overlayColor().
    return this.highlights.get(highlightName(style)) ?? this.highlights.get(highlightName({ ...style, color: 'yellow' }))!
  }

  private live(id: string): Entry | null {
    const entry = this.entries.get(id)
    return entry && this.isLive(entry) ? entry : null
  }

  private isLive(entry: Entry): boolean {
    const { range } = entry
    return (
      entry.startNode.isConnected &&
      entry.endNode.isConnected &&
      range.startContainer === entry.startNode &&
      range.startOffset === entry.startOffset &&
      range.endContainer === entry.endNode &&
      range.endOffset === entry.endOffset
    )
  }
}
