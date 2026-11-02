// Anchor description (architecture.md D7): every highlight stores its TextIndex position plus the quote
// and its surrounding context, so resolveAnchor can fall back to quote matching when the page changes.
import type { TextAnchor } from '../../../core/model/index.ts'
import type { TextIndex } from './text-index.ts'

/** Number of characters kept on each side of the quote as prefix / suffix. */
export const ANCHOR_CONTEXT_LENGTH = 32

/** Builds the anchor for `text.slice(start, end)` of an index text. Pure, usable without a DOM. */
export function describeOffsets(text: string, start: number, end: number): TextAnchor {
  return {
    start,
    end,
    exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - ANCHOR_CONTEXT_LENGTH), start),
    suffix: text.slice(end, end + ANCHOR_CONTEXT_LENGTH),
  }
}

/** Describes a DOM Range against `index`: TextIndex offsets, exact quote and 32-character context. */
export function describe(index: TextIndex, range: Range): TextAnchor {
  const { start, end } = index.rangeToOffsets(range)
  return describeOffsets(index.text, start, end)
}

/**
 * Anchor for a user selection: the Range is mapped through `index`, then leading and trailing
 * whitespace of the indexed text is trimmed off. Null when nothing but whitespace is selected.
 */
export function describeSelection(index: TextIndex, range: Range): TextAnchor | null {
  const { text } = index
  let { start, end } = index.rangeToOffsets(range)
  while (start < end && /\s/.test(text[start])) start++
  while (end > start && /\s/.test(text[end - 1])) end--
  return end > start ? describeOffsets(text, start, end) : null
}
