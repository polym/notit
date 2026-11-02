// Chunked restore pass (architecture.md D7 "dynamic pages" + "main thread budget", FR11, NFR4).
// One TextIndex per pass. Records are resolved in slices (resolution never touches the DOM), then the
// hits are painted in slices from the last one in the document to the first: painting splits text
// nodes only at and after a highlight's own start, so the live Ranges of the hits before it keep
// their boundaries. Overlapping hits are painted together in one Renderer.paintAll call.
import type { HighlightRecord } from '../../../core/model/index.ts'
import { anchorQuery } from '../anchoring/restore.ts'
import { resolveAnchor } from '../anchoring/resolve.ts'
import { createTextIndex, type TextIndex } from '../anchoring/text-index.ts'
import type { HighlightStyle, PaintItem, Renderer } from '../render/renderer.ts'
import { runChunked, type ChunkOptions } from './chunked.ts'

export interface RestorePassOptions extends ChunkOptions {
  renderer: Renderer
  /** Current style of a record at paint time; null when it was removed meanwhile (not painted). */
  styleOf: (id: string) => HighlightStyle | null
  /** Called with every TextIndex the pass builds (tests and the build counter). */
  onIndexBuilt?: (index: TextIndex) => void
  root?: HTMLElement
}

export interface RestorePassResult {
  /** Records whose anchor resolved on this pass. */
  resolved: number
  /** Records painted on this pass. */
  painted: number
  /** False when the pass was cancelled before it finished. */
  completed: boolean
}

interface Hit {
  id: string
  /** The record's exact quote; the Range must still cover it at paint time. */
  exact: string
  range: Range
  start: number
  end: number
}

/** Groups hits (sorted by start) into runs of overlapping hits. */
function clusters(hits: Hit[]): Hit[][] {
  const out: Hit[][] = []
  let end = -1
  for (const hit of hits) {
    const last = out[out.length - 1]
    if (last && hit.start < end) {
      last.push(hit)
      end = Math.max(end, hit.end)
    } else {
      out.push([hit])
      end = hit.end
    }
  }
  return out
}

/** A Range is still paintable while both boundaries sit in the observed document. */
function usable(range: Range, root: Node): boolean {
  return range.startContainer.isConnected && range.endContainer.isConnected && root.contains(range.startContainer) && root.contains(range.endContainer)
}

/**
 * Text a Range covers, in TextIndex terms (excluded text left out). Host mutations between the resolve
 * and paint slices can change it while the boundaries stay connected.
 */
function rangeText(range: Range): string {
  const ancestor = range.commonAncestorContainer
  const scope = ancestor.nodeType === Node.TEXT_NODE ? (ancestor.parentNode ?? ancestor) : ancestor
  const index = createTextIndex(scope)
  const { start, end } = index.rangeToOffsets(range)
  return index.text.slice(start, end)
}

/**
 * Resolves `records` against one fresh TextIndex and paints the hits, both in chunks. The caller
 * decides which records to pass (all of them after a clear, or only the ones not painted).
 */
export async function runRestorePass(records: readonly HighlightRecord[], options: RestorePassOptions): Promise<RestorePassResult> {
  const { renderer, styleOf, onIndexBuilt } = options
  const root = options.root ?? document.body
  const result: RestorePassResult = { resolved: 0, painted: 0, completed: false }
  if (records.length === 0) {
    result.completed = !(options.cancelled?.() ?? false)
    return result
  }
  const index = createTextIndex(root)
  onIndexBuilt?.(index)

  const hits: Hit[] = []
  const resolvedAll = await runChunked(
    records,
    (record) => {
      const hit = resolveAnchor(index, anchorQuery(record))
      if (!hit) return
      const { start, end } = index.rangeToOffsets(hit.range)
      hits.push({ id: record.id, exact: anchorQuery(record).exact, range: hit.range, start, end })
    },
    options,
  )
  result.resolved = hits.length
  if (!resolvedAll) return result

  hits.sort((a, b) => a.start - b.start || a.end - b.end)
  const groups = clusters(hits).reverse()
  result.completed = await runChunked(
    groups,
    (group) => {
      const items: PaintItem[] = []
      for (const hit of group) {
        const style = styleOf(hit.id)
        // A hit whose text changed since resolve stays unpainted; the next incremental pass retries it.
        if (style === null || !usable(hit.range, root) || rangeText(hit.range) !== hit.exact) continue
        items.push({ id: hit.id, range: hit.range, style })
      }
      if (items.length === 0) return
      renderer.paintAll(items)
      result.painted += items.filter((item) => renderer.isPainted(item.id)).length
    },
    options,
  )
  return result
}
