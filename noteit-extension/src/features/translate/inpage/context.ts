// Context for a translation (spec "selection translation"): the sentence around the selection, so the
// model picks the sense used on the page. Only the selection's block is read, never the whole page.

/** Raw context cap; the worker clips it again to MAX_CONTEXT_LENGTH around the selection. */
const RAW_CONTEXT_LENGTH = 1200
// Sentence ends: ASCII . ! ? and the full-width forms (written as escapes: CJK literals are UI copy).
const SENTENCE_END = /[.!?\u3002\uff01\uff1f]/

/**
 * The sentence containing `text` inside `block`, plus one sentence on each side, at most
 * RAW_CONTEXT_LENGTH characters. Falls back to the start of the block when `text` is not found.
 */
export function sentenceAround(block: string, text: string): string {
  const flat = block.replace(/\s+/g, ' ').trim()
  const needle = text.replace(/\s+/g, ' ').trim()
  const at = flat.indexOf(needle)
  if (at < 0) return flat.slice(0, RAW_CONTEXT_LENGTH)
  let start = at
  for (let ends = 0; start > 0; start--) {
    if (SENTENCE_END.test(flat[start - 1]) && ++ends === 2) break
  }
  let end = at + needle.length
  for (let ends = 0; end < flat.length; end++) {
    if (SENTENCE_END.test(flat[end]) && ++ends === 2) {
      end++
      break
    }
  }
  const window = flat.slice(start, end).trim()
  if (window.length <= RAW_CONTEXT_LENGTH) return window
  const from = Math.max(0, at - start - Math.floor((RAW_CONTEXT_LENGTH - needle.length) / 2))
  return window.slice(from, from + RAW_CONTEXT_LENGTH)
}

/** Nearest ancestor of the selection that is not laid out inline. */
function blockOf(range: Range): HTMLElement | null {
  let node: Node | null = range.commonAncestorContainer
  while (node && !(node instanceof HTMLElement)) node = node.parentNode
  let el = node as HTMLElement | null
  while (el && el !== document.body) {
    if (!getComputedStyle(el).display.startsWith('inline')) return el
    el = el.parentElement
  }
  return el
}

/** Context for `text` selected by `range`; `text` itself when the block has nothing to read. */
export function selectionContext(range: Range, text: string): string {
  const block = blockOf(range)
  const raw = block?.innerText ?? ''
  return raw.trim() ? sentenceAround(raw, text) : text
}
