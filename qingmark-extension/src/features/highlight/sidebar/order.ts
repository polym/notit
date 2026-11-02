// Current page order (Story 3.5, FR20): highlights with an anchor by anchor.start ascending, then the
// ones without a position by createdAt ascending (PRD proxy decision: keeps the legacy behavior).
import type { HighlightRecord } from '../../../core/model/index.ts'

type Orderable = Pick<HighlightRecord, 'anchor' | 'createdAt'>

export function byArticleOrder(a: Orderable, b: Orderable): number {
  if (a.anchor && b.anchor) return a.anchor.start - b.anchor.start || a.createdAt - b.createdAt
  if (a.anchor) return -1
  if (b.anchor) return 1
  return a.createdAt - b.createdAt
}

/** Sorted copy; the input is left untouched. */
export function sortForPage<T extends Orderable>(items: readonly T[]): T[] {
  return [...items].sort(byArticleOrder)
}
