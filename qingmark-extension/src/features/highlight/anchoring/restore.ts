// Restore pass (architecture.md D7): one TextIndex per pass, every record resolved against it.
// Records without an anchor (legacy rows) are matched by their saved text through the quote path.
import type { HighlightRecord } from '../../../core/model/index.ts'
import { resolveAnchor, type AnchorQuery, type ResolveMethod } from './resolve.ts'
import type { TextIndex } from './text-index.ts'

/** Restoration query of a record; legacy rows (anchor = null) use `text` as the quote, no offsets. */
export function anchorQuery(record: Pick<HighlightRecord, 'anchor' | 'text'>): AnchorQuery {
  return record.anchor ?? { exact: record.text, prefix: '', suffix: '', start: null, end: null }
}

export interface RestoredRecord {
  record: HighlightRecord
  range: Range
  method: ResolveMethod
  start: number
}

/**
 * Resolves every record against `index`, ordered by start offset. The Ranges are live: paint them
 * together with Renderer.paintAll, which fixes every Range's offsets before the DOM is split.
 */
export function resolveRecords(index: TextIndex, records: Iterable<HighlightRecord>): RestoredRecord[] {
  const out: RestoredRecord[] = []
  for (const record of records) {
    const hit = resolveAnchor(index, anchorQuery(record))
    if (!hit) continue
    out.push({ record, range: hit.range, method: hit.method, start: index.rangeToOffsets(hit.range).start })
  }
  return out.sort((a, b) => a.start - b.start)
}
