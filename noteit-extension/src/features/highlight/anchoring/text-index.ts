// Unified text baseline (architecture.md D7, fixes #5). Creation (Range -> offsets) and restoration
// (offsets -> Range) both go through one TextIndex so they share the same "page body text":
// - TreeWalker(SHOW_TEXT) over document.body, in document order;
// - text nodes with an ancestor in TEXT_INDEX_EXCLUDE are skipped (inline scripts, styles, form
//   values and NoteIt's own Shadow host are not part of the readable text);
// - the remaining text nodes are concatenated into one virtual string, with a (node, start) table.
// Never compute offsets from body.textContent or Range.toString() (both include excluded text);
// lint enforces this in anchoring/ and inpage/.
import { HOST_TAG } from '../../../ui/inpage/shadow-host.ts'

/** Element names whose descendant text is not indexed. MarkRenderer's `exclude` derives from this list. */
export const TEXT_INDEX_EXCLUDE: readonly string[] = ['script', 'style', 'noscript', 'template', 'textarea', HOST_TAG]

const EXCLUDE_SELECTOR = TEXT_INDEX_EXCLUDE.join(',')

export interface TextOffsets {
  start: number
  end: number
}

export interface TextIndex {
  /** Concatenated text of every indexed text node. */
  readonly text: string
  /** Offsets of a Range in `text`. Boundaries outside indexed text snap to the nearest indexed position. */
  rangeToOffsets(range: Range): TextOffsets
  /** Range covering `text.slice(start, end)`, or null when the offsets are out of bounds or reversed. */
  offsetsToRange(start: number, end: number): Range | null
}

interface Entry {
  node: Text
  start: number
}

function isExcluded(node: Text): boolean {
  const parent = node.parentElement
  return parent !== null && parent.closest(EXCLUDE_SELECTOR) !== null
}

/** Builds a TextIndex over `root` (default document.body). Rebuild after the DOM changes. */
export function createTextIndex(root: Node = document.body): TextIndex {
  const entries: Entry[] = []
  const parts: string[] = []
  let length = 0
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (node.data.length === 0 || isExcluded(node)) continue
    entries.push({ node, start: length })
    parts.push(node.data)
    length += node.data.length
  }
  const text = parts.join('')
  const position = new Map<Text, number>(entries.map((e, i) => [e.node, i]))

  /** Offset in `text` of a DOM boundary point. */
  function boundaryOffset(container: Node, offset: number): number {
    if (container.nodeType === Node.TEXT_NODE) {
      const i = position.get(container as Text)
      if (i !== undefined) return entries[i].start + Math.min(offset, entries[i].node.data.length)
    }
    // Not an indexed text node: count every indexed node that lies before the boundary point.
    const probe = document.createRange()
    probe.setStart(container, offset)
    let lo = 0
    let hi = entries.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      // comparePoint < 0: the node's start is before the boundary point.
      const node = entries[mid].node
      if (probe.comparePoint(node, 0) < 0 && !node.contains(container)) lo = mid + 1
      else hi = mid
    }
    if (lo === 0) return 0
    const prev = entries[lo - 1]
    // The boundary may sit inside an excluded or non-indexed text node: snap to the end of the
    // previous indexed node.
    return prev.start + prev.node.data.length
  }

  function rangeToOffsets(range: Range): TextOffsets {
    const start = boundaryOffset(range.startContainer, range.startOffset)
    const end = boundaryOffset(range.endContainer, range.endOffset)
    return { start, end: Math.max(start, end) }
  }

  /** Index of the entry containing `offset`; `preferNext` picks the following node at a node boundary. */
  function locate(offset: number, preferNext: boolean): number {
    let lo = 0
    let hi = entries.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      const s = entries[mid].start
      if (s < offset || (preferNext && s === offset)) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  function offsetsToRange(start: number, end: number): Range | null {
    if (!Number.isInteger(start) || !Number.isInteger(end)) return null
    if (start < 0 || end < start || end > length || entries.length === 0) return null
    // Start boundaries attach to the node that follows them, end boundaries to the node that precedes them,
    // so a Range never begins at the end of one node or ends at the start of the next.
    const si = locate(start, true)
    const ei = start === end ? si : locate(end, false)
    const range = document.createRange()
    range.setStart(entries[si].node, start - entries[si].start)
    range.setEnd(entries[ei].node, end - entries[ei].start)
    return range
  }

  return { text, rangeToOffsets, offsetsToRange }
}
