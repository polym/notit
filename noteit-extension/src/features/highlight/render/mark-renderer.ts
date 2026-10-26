// MarkRenderer (architecture.md D7, fallback engine): wraps Ranges in <mark data-noteit-id> elements with
// mark.js markRanges. Ranges come from the TextIndex (anchoring/), so creation and restoration share one
// text baseline; this file only translates a Range into mark.js's own offset space before painting.
import Mark from 'mark.js'
import { overlayColor, solidToken } from '../../../ui/palette.ts'
import { colors } from '../../../ui/tokens/index.ts'
import { isOnDarkHost, type DarkHostCache } from './host-background.ts'
import { TEXT_INDEX_EXCLUDE } from '../anchoring/text-index.ts'
import { HIGHLIGHT_FLASH_MS, type HighlightStyle, type PaintItem, type Renderer, type RendererRect } from './renderer.ts'

/** Class on every mark element (host-page stylesheet below). */
export const HIGHLIGHT_CLASS = 'noteit-highlight'
/** highlight-mark-commented: the highlight has a comment (bubble marker after its last fragment). */
export const COMMENTED_CLASS = 'noteit-commented'
/** Last fragment of a highlight, where the comment marker is drawn. */
const LAST_CLASS = 'noteit-last'
const FLASH_CLASS = 'noteit-flash'
const ID_ATTR = 'data-noteit-id'
const STYLE_ID = 'noteit-highlight-styles'

// mark.js only tests a text node's direct parent against `exclude`, so every TextIndex exclusion is
// listed both for the element and for its descendants. mark.js adds its own built-ins on top.
export const MARK_EXCLUDE: readonly string[] = TEXT_INDEX_EXCLUDE.flatMap((tag) => [tag, `${tag} *`])
const MARKJS_BUILTIN_EXCLUDE = ['script', 'style', 'title', 'head', 'html']
const MARK_SPACE_EXCLUDE = [...MARK_EXCLUDE, ...MARKJS_BUILTIN_EXCLUDE].join(',')

const STYLES = `
  /* highlight-mark (DESIGN.md): transparent rounded overlay, host text color kept. */
  mark.${HIGHLIGHT_CLASS} {
    cursor: pointer;
    color: inherit !important;
    padding: 1px 0 !important;
    border-radius: 5px !important;
    transition: box-shadow 0.15s ease !important;
    box-decoration-break: clone !important;
    -webkit-box-decoration-break: clone !important;
    position: relative;
  }
  /* Hover deepens the tint with an inset layer under the text; the text itself never fades. */
  mark.${HIGHLIGHT_CLASS}:hover {
    box-shadow: inset 0 0 0 100vmax var(--noteit-hover) !important;
  }
  /* highlight-flash (DESIGN.md): the jump target darkens, then eases back. */
  mark.${HIGHLIGHT_CLASS}.${FLASH_CLASS} {
    filter: saturate(2.2) brightness(0.82);
    transition: filter 0.2s ease !important;
  }
  /* highlight-mark-commented (DESIGN.md): a small speech-bubble marker after the last fragment. */
  mark.${HIGHLIGHT_CLASS}.${COMMENTED_CLASS}.${LAST_CLASS}::after {
    content: '' !important;
    display: inline-block !important;
    width: 10px !important;
    height: 9px !important;
    margin-left: 3px !important;
    vertical-align: 0.1em !important;
    border-radius: 3px 3px 3px 0 !important;
    background: var(--noteit-marker) !important;
  }
`

const isOwnMark = (node: Node | null): node is HTMLElement =>
  node instanceof HTMLElement && node.localName === 'mark' && node.hasAttribute(ID_ATTR)

/**
 * Offsets of a Range in mark.js's text space (text nodes under `root` whose parent is not excluded,
 * in document order). Same walk as mark.js getTextNodes, so markRanges marks exactly this text.
 */
function markSpaceOffsets(root: Node, range: Range): { start: number; end: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let length = 0
  let start: number | null = null
  let end: number | null = null
  const startProbe = document.createRange()
  startProbe.setStart(range.startContainer, range.startOffset)
  const endProbe = document.createRange()
  endProbe.setStart(range.endContainer, range.endOffset)
  const boundary = (probe: Range, node: Text): number | null => {
    if (probe.startContainer === node) return length + Math.min(probe.startOffset, node.data.length)
    // The boundary point lies before this node: everything counted so far precedes it.
    return probe.comparePoint(node, 0) >= 0 ? length : null
  }
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const parent = node.parentElement
    if (parent && parent.matches(MARK_SPACE_EXCLUDE)) continue
    if (start === null) start = boundary(startProbe, node)
    if (end === null) end = boundary(endProbe, node)
    if (start !== null && end !== null) break
    length += node.data.length
  }
  const s = start ?? length
  return { start: s, end: Math.max(s, end ?? length) }
}

const sameNodes = (a: NodeList, b: NodeList) => a.length === b.length && Array.from(a).every((node, i) => node === b[i])

/** True when two records (from different observers) describe the same DOM change. */
function sameRecord(a: MutationRecord, b: MutationRecord): boolean {
  return (
    a.type === b.type &&
    a.target === b.target &&
    a.previousSibling === b.previousSibling &&
    a.nextSibling === b.nextSibling &&
    sameNodes(a.addedNodes, b.addedNodes) &&
    sameNodes(a.removedNodes, b.removedNodes)
  )
}

export class MarkRenderer implements Renderer {
  readonly paintsElements = true
  private readonly marks = new Map<string, HTMLElement[]>()
  // Last style per id, so a host theme change can repaint every mark without the caller.
  private readonly styles = new Map<string, HighlightStyle>()
  private readonly flashTimers = new Map<string, number>()
  // Records of the DOM changes this renderer made itself (split / wrap / unwrap / normalize), captured
  // by a private observer around every operation. A page observer's record counts as own only when it
  // matches one of them, so a host change in the same element is never mistaken for ours.
  private readonly recorder: MutationObserver
  private pending: MutationRecord[] = []
  private cleanup: number | undefined
  private depth = 0

  private readonly root: HTMLElement

  constructor(root: HTMLElement = document.body) {
    this.root = root
    this.recorder = new MutationObserver(() => undefined)
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement('style')
      style.id = STYLE_ID
      style.textContent = STYLES
      document.head.appendChild(style)
    }
    // Host theme toggles usually flip a class, data attribute or inline style on <html> or <body>, or
    // follow the OS scheme; either can turn the page dark (or light) under existing marks.
    const refresh = () => this.refreshHostTheme()
    new MutationObserver(refresh).observe(document.documentElement, { attributes: true })
    if (document.body) new MutationObserver(refresh).observe(document.body, { attributes: true })
    window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', refresh)
  }

  /** Repaints every mark for the current host background, one dark-host cache for the whole pass. */
  private refreshHostTheme(): void {
    if (this.styles.size === 0) return
    const cache: DarkHostCache = new Map()
    for (const [id, style] of this.styles) this.applyStyle(id, style, cache)
  }

  paint(id: string, range: Range, style: HighlightStyle): void {
    this.paintAll([{ id, range, style }])
  }

  paintAll(items: Iterable<PaintItem>): void {
    this.own(() => this.paintAllNow(items))
  }

  /**
   * Runs `operation` while the private observer records its mutations. Every observer receives its
   * records in the same microtask checkpoint, so the captured records only need to live until the next
   * task; they are dropped then, which keeps the list bounded when no page observer consumes them.
   */
  private own(operation: () => void): void {
    if (this.depth > 0) {
      operation()
      return
    }
    this.depth++
    this.recorder.observe(this.root, { childList: true, subtree: true, characterData: true })
    try {
      operation()
    } finally {
      this.pending.push(...this.recorder.takeRecords())
      this.recorder.disconnect()
      this.depth--
    }
    if (this.pending.length > 0 && this.cleanup === undefined) {
      this.cleanup = window.setTimeout(() => {
        this.cleanup = undefined
        this.pending = []
      }, 0)
    }
  }

  private paintAllNow(items: Iterable<PaintItem>): void {
    // Ranges are live and mark.js splits / replaces text nodes, which moves the boundaries of the
    // Ranges not painted yet. Read every Range as mark-space offsets while the DOM is untouched;
    // painting and unwrapping never change the text, so the offsets stay valid in any order.
    const fixed = Array.from(items, (item) => ({ ...item, ...markSpaceOffsets(this.root, item.range) }))
    for (const item of fixed) this.remove(item.id)
    // One dark-host cache for the batch: marks sharing ancestors read each computed style once.
    const cache: DarkHostCache = new Map()
    for (const item of fixed) this.paintOffsets(item.id, item.start, item.end, item.style, cache)
  }

  private paintOffsets(id: string, start: number, end: number, style: HighlightStyle, cache: DarkHostCache): void {
    this.remove(id)
    if (end <= start) return
    const painted: HTMLElement[] = []
    // markRanges is synchronous without the iframes option: `each` runs before it returns.
    new Mark(this.root).markRanges([{ start, length: end - start }], {
      element: 'mark',
      className: HIGHLIGHT_CLASS,
      exclude: [...MARK_EXCLUDE],
      each: (element: Element) => {
        const el = element as HTMLElement
        el.setAttribute(ID_ATTR, id)
        painted.push(el)
      },
    })
    if (painted.length === 0) return
    this.marks.set(id, painted)
    this.applyStyle(id, style, cache)
  }

  remove(id: string): void {
    this.own(() => this.removeNow(id))
  }

  private removeNow(id: string): void {
    window.clearTimeout(this.flashTimers.get(id))
    this.flashTimers.delete(id)
    const painted = this.marks.get(id)
    this.marks.delete(id)
    this.styles.delete(id)
    if (painted) this.unwrap(painted)
  }

  clear(): void {
    this.own(() => {
      for (const id of [...this.marks.keys()]) this.removeNow(id)
      // Marks this instance does not track (e.g. left by a previous content script after a reload).
      this.unwrap(Array.from(this.root.querySelectorAll<HTMLElement>(`mark[${ID_ATTR}]`)))
    })
  }

  flash(id: string): boolean {
    const painted = this.connected(id)
    if (painted.length === 0) return false
    window.clearTimeout(this.flashTimers.get(id))
    painted.forEach((el) => el.classList.add(FLASH_CLASS))
    this.flashTimers.set(
      id,
      window.setTimeout(() => {
        this.flashTimers.delete(id)
        this.marks.get(id)?.forEach((el) => el.classList.remove(FLASH_CLASS))
      }, HIGHLIGHT_FLASH_MS),
    )
    return true
  }

  hitTest(x: number, y: number): string | null {
    const el = document.elementFromPoint(x, y)?.closest(`mark[${ID_ATTR}]`)
    const id = el?.getAttribute(ID_ATTR) ?? null
    return id !== null && this.marks.has(id) ? id : null
  }

  isOwnMutation(record: MutationRecord): boolean {
    // Restyle and flash change attributes on our marks only.
    if (record.type === 'attributes') return isOwnMark(record.target)
    const i = this.pending.findIndex((own) => sameRecord(own, record))
    if (i === -1) return false
    this.pending.splice(i, 1)
    return true
  }

  restyle(id: string, style: HighlightStyle): void {
    this.applyStyle(id, style, new Map())
  }

  private applyStyle(id: string, style: HighlightStyle, cache: DarkHostCache): void {
    const painted = this.marks.get(id)
    if (!painted) return
    this.styles.set(id, style)
    const solid = colors[solidToken(style.color)]
    const last = painted[painted.length - 1]
    for (const el of painted) {
      // Read from the parent: the mark's own background is the overlay being set.
      const onDark = isOnDarkHost(el.parentElement, cache)
      el.style.setProperty('background-color', overlayColor(style.color, onDark), 'important')
      el.style.setProperty('--noteit-hover', `color-mix(in srgb, ${solid} 22%, transparent)`)
      el.style.setProperty('--noteit-marker', colors[onDark ? 'comment-marker-on-dark' : 'comment-marker'])
      el.classList.toggle(COMMENTED_CLASS, style.commented)
      el.classList.toggle(LAST_CLASS, el === last)
    }
  }

  isPainted(id: string): boolean {
    return this.connected(id).length > 0
  }

  boundingRect(id: string): RendererRect | null {
    let left = Infinity
    let top = Infinity
    let right = -Infinity
    let bottom = -Infinity
    for (const el of this.connected(id)) {
      for (const r of el.getClientRects()) {
        if (r.width === 0 && r.height === 0) continue
        left = Math.min(left, r.left)
        top = Math.min(top, r.top)
        right = Math.max(right, r.right)
        bottom = Math.max(bottom, r.bottom)
      }
    }
    if (left === Infinity) return null
    return { left, top, width: right - left, height: bottom - top }
  }

  scrollIntoView(id: string): boolean {
    const first = this.connected(id)[0]
    if (!first) return false
    first.scrollIntoView({ behavior: 'smooth', block: 'center' })
    return true
  }

  private connected(id: string): HTMLElement[] {
    return (this.marks.get(id) ?? []).filter((el) => el.isConnected)
  }

  private unwrap(elements: HTMLElement[]): void {
    const parents = new Set<Node>()
    for (const el of elements) {
      const parent = el.parentNode
      if (!parent) continue
      while (el.firstChild) parent.insertBefore(el.firstChild, el)
      parent.removeChild(el)
      parents.add(parent)
    }
    // Merge the split text nodes back so repeated paints do not fragment the host page.
    for (const parent of parents) if (parent.isConnected) parent.normalize()
  }
}
