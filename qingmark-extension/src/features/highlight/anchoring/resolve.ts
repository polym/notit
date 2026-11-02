// Anchor restoration (architecture.md D7). Pure function of (index, anchor):
// 1. Position: index.text.slice(start, end) === exact -> hit.
// 2. Quote: score every occurrence of exact with sim(prefix) + sim(suffix) + proximity(start); take the
//    best one only when score >= ANCHOR_MIN_SCORE and it leads the runner-up by >= ANCHOR_MIN_LEAD.
//    Otherwise the match is ambiguous and nothing is rendered (never mark the wrong instance).
// 3. Both fail -> null (lost for this pass).
// Thresholds were tuned on the 30-snapshot corpus in Story 4.5 (values recorded in architecture.md D7).
import type { TextAnchor } from '../../../core/model/index.ts'
import type { TextIndex, TextOffsets } from './text-index.ts'

/**
 * Minimum quote score for a candidate to be accepted. Tuned on the corpus (Story 4.5): correct unique
 * quotes whose context changed (relative timestamps, reranked rows) score 0.88-0.91, while quotes whose
 * context is entirely gone score 0.49-0.56 (proximity only) and must stay unresolved.
 */
export const ANCHOR_MIN_SCORE = 0.75
/** Minimum score lead of the best quote candidate over the runner-up (unchanged by tuning: corpus leads are >= 1.0). */
export const ANCHOR_MIN_LEAD = 0.2
/** Weight of the proximity term: a candidate at the stored start gets this much, one a full text length away gets 0. */
export const ANCHOR_PROXIMITY_WEIGHT = 0.5

export type ResolveMethod = 'position' | 'quote'

export interface ResolvedOffsets extends TextOffsets {
  method: ResolveMethod
}

export interface ResolvedAnchor {
  range: Range
  method: ResolveMethod
}

/** Anchor fields used for restoration; legacy rows without offsets pass start/end as null. */
export type AnchorQuery = Pick<TextAnchor, 'exact' | 'prefix' | 'suffix'> & {
  start: number | null
  end: number | null
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

/**
 * Share of the stored prefix that matches the text right before the candidate (0..1). An empty stored
 * prefix scores 1 only when `actual` is also empty; quoteScore makes `actual` non-empty away from the
 * text start for describe() anchors, so an empty prefix acts as a "quote is at the start" check.
 */
export function prefixSimilarity(stored: string, actual: string): number {
  if (stored.length === 0) return actual.length === 0 ? 1 : 0
  return commonSuffixLength(stored, actual) / stored.length
}

/** Share of the stored suffix that matches the text right after the candidate (0..1). */
export function suffixSimilarity(stored: string, actual: string): number {
  if (stored.length === 0) return actual.length === 0 ? 1 : 0
  return commonPrefixLength(stored, actual) / stored.length
}

/** Proximity term: ANCHOR_PROXIMITY_WEIGHT * (1 - min(|delta| / textLength, 1)); 0 without a stored start. */
export function proximity(candidate: number, stored: number | null, textLength: number): number {
  if (stored === null) return 0
  const delta = Math.abs(candidate - stored)
  return ANCHOR_PROXIMITY_WEIGHT * (1 - Math.min(textLength === 0 ? 1 : delta / textLength, 1))
}

/** Quote score of an occurrence of `anchor.exact` starting at `candidate` in `text`. */
export function quoteScore(text: string, anchor: AnchorQuery, candidate: number): number {
  const end = candidate + anchor.exact.length
  // Anchors from describe() (start !== null) store an empty prefix/suffix only when the quote touched a
  // text boundary. Read at least one char of context so an empty stored side matches only a candidate at
  // that same boundary instead of giving every candidate a free 1.0. Legacy queries (start === null) keep
  // the neutral window so an empty context never penalizes them.
  const minWindow = anchor.start !== null ? 1 : 0
  const prefixWindow = Math.max(anchor.prefix.length, minWindow)
  const suffixWindow = Math.max(anchor.suffix.length, minWindow)
  const before = text.slice(Math.max(0, candidate - prefixWindow), candidate)
  const after = text.slice(end, end + suffixWindow)
  return (
    prefixSimilarity(anchor.prefix, before) +
    suffixSimilarity(anchor.suffix, after) +
    proximity(candidate, anchor.start, text.length)
  )
}

/** Offset-level restoration on an index text. Pure, usable without a DOM. */
export function resolveOffsets(text: string, anchor: AnchorQuery): ResolvedOffsets | null {
  const { exact, start, end } = anchor
  if (exact.length === 0) return null
  if (start !== null && end !== null && start >= 0 && end <= text.length && text.slice(start, end) === exact) {
    return { start, end, method: 'position' }
  }
  let best = -1
  let bestScore = -Infinity
  let secondScore = -Infinity
  for (let at = text.indexOf(exact); at !== -1; at = text.indexOf(exact, at + 1)) {
    const score = quoteScore(text, anchor, at)
    if (score > bestScore) {
      secondScore = bestScore
      bestScore = score
      best = at
    } else if (score > secondScore) {
      secondScore = score
    }
  }
  if (best === -1 || bestScore < ANCHOR_MIN_SCORE) return null
  // Compare with a tiny epsilon so floating point noise does not decide ties at exactly the lead.
  if (bestScore - secondScore < ANCHOR_MIN_LEAD - 1e-9) return null
  return { start: best, end: best + exact.length, method: 'quote' }
}

/** Restores `anchor` against `index`: the Range of the matched text and how it was found, or null. */
export function resolveAnchor(index: TextIndex, anchor: AnchorQuery): ResolvedAnchor | null {
  const hit = resolveOffsets(index.text, anchor)
  if (!hit) return null
  const range = index.offsetsToRange(hit.start, hit.end)
  return range ? { range, method: hit.method } : null
}
