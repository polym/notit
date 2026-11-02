// Pull half of the sync engine (architecture.md "Sync Algorithm": pull, D3 cursor).
// Service worker only. The page fetcher is injected so tests can drive it without Supabase.
import { read } from '../../db/read.ts'
import { write } from '../../db/write.ts'
import { log } from '../../log/index.ts'
import type { HighlightRecord } from '../../model/index.ts'
import { parseRemoteRow } from '../mapping.ts'

/** Rows requested per page: `server_seq > cursor order by server_seq limit 500`. */
export const PULL_PAGE_SIZE = 500

/** Fetches up to `limit` raw rows with server_seq > cursor, ordered by server_seq. Throws on failure. */
export type PullPageFetch = (cursor: number, limit: number) => Promise<unknown[]>

export interface PullSummary {
  /** Pages fetched (including the last, short one). */
  pages: number
  /** Raw rows received. */
  received: number
  /** Records inserted or overwritten locally. */
  applied: HighlightRecord[]
  /** Outbox items dropped because a newer remote row replaced the pending local edit. */
  cleared: number
  /** meta.pullCursor after the pull. */
  cursor: number
}

/** server_seq of a raw row (bigint may arrive as a number or a numeric string); null if invalid. */
function serverSeq(raw: unknown): number | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = (raw as Record<string, unknown>).server_seq
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v
  if (typeof v === 'string' && /^\d+$/.test(v)) {
    const n = Number(v)
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

/** The stored pull cursor (0 when unset). */
export async function pullCursor(): Promise<number> {
  const stored = await read.getMeta('pullCursor')
  return typeof stored === 'number' && Number.isFinite(stored) ? stored : 0
}

/**
 * Pulls every row above meta.pullCursor, one page at a time. Each page is merged and the cursor
 * advanced in one transaction, so a failure (thrown by fetch or the write) leaves the cursor at the
 * last fully applied page and the next pull resumes there. Rows that fail validation are skipped
 * (parseRemoteRow logs them) but still advance the cursor, so one bad row cannot stall the pull.
 */
export async function pullAll(fetchPage: PullPageFetch): Promise<PullSummary> {
  const summary: PullSummary = { pages: 0, received: 0, applied: [], cleared: 0, cursor: await pullCursor() }
  for (;;) {
    const raw = await fetchPage(summary.cursor, PULL_PAGE_SIZE)
    summary.pages++
    summary.received += raw.length
    let next = summary.cursor
    const records: HighlightRecord[] = []
    for (const row of raw) {
      const seq = serverSeq(row)
      if (seq !== null && seq > next) next = seq
      const parsed = parseRemoteRow(row)
      if (parsed) records.push(parsed)
    }
    if (raw.length > 0 && next === summary.cursor) {
      // Rows without a usable server_seq cannot move the cursor; stop instead of looping forever.
      log.warn('sync', 'pull.noProgress', { count: raw.length })
      break
    }
    if (raw.length > 0) {
      const { applied, cleared } = await write.applyPullPage(records, next)
      summary.applied.push(...applied)
      summary.cleared += cleared.length
      summary.cursor = next
    }
    if (raw.length < PULL_PAGE_SIZE) break
  }
  log.info('sync', 'pull.done', { count: summary.received, appliedCount: summary.applied.length, pageCount: summary.pages })
  return summary
}
