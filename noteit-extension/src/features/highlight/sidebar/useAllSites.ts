// All-sites data (Story 3.7, FR21, architecture.md "Performance"): the newest live highlights by
// createdAt (first screen 200, more on scroll), widened to every live highlight of the pages they
// belong to so a page group is never shown with only part of its items. Re-queries on db/changed.
import { useCallback, useEffect, useState } from 'react'
import type { HighlightRecord } from '../../../core/model/index.ts'
import { read } from '../../../core/db/read.ts'
import { useQuery } from '../../../ui/sidebar/hooks/useQuery.ts'

export const ALL_SITES_PAGE_SIZE = 200

const EMPTY: HighlightRecord[] = []

/** Milliseconds until the next local midnight (plus a small margin past the boundary). */
function msUntilNextMidnight(): number {
  const now = new Date()
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return next.getTime() - now.getTime() + 1000
}

/**
 * Counter that increments at every local midnight, so date buckets (today / yesterday / this week)
 * are recomputed while the panel stays open. Week boundaries also fall on a midnight.
 */
function useDayKey(): number {
  const [dayKey, setDayKey] = useState(0)
  useEffect(() => {
    const timer = setTimeout(() => setDayKey((k) => k + 1), msUntilNextMidnight())
    return () => clearTimeout(timer)
  }, [dayKey])
  return dayKey
}
const NO_IDS: ReadonlySet<string> = new Set()

export interface AllSites {
  rows: HighlightRecord[]
  /** Reference time for the date buckets (time of the last query). */
  now: number
  /** Live highlights in total (item-count). */
  total: number | null
  /** False until the first query has resolved. */
  loaded: boolean
  /** More highlights exist past the loaded window. */
  hasMore: boolean
  loadMore: () => void
  lost: ReadonlySet<string>
}

export function useAllSites(): AllSites {
  const [limit, setLimit] = useState(ALL_SITES_PAGE_SIZE)
  const dayKey = useDayKey()
  const page = useQuery(async () => {
    // Date buckets are computed against the time of the query (kept out of render for purity).
    const now = Date.now()
    const newest = await read.recent(limit)
    const keys = [...new Set(newest.map((r) => r.canonicalUrl))]
    return { limit, now, rows: await read.byCanonicalUrls(keys), hasMore: newest.length === limit }
  }, [limit, dayKey])
  const total = useQuery(() => read.liveCount(), [])
  const lost = useQuery(async () => new Set(await read.lostIds()), [])
  // A request for the next window is pending until the result for the current limit arrives.
  const hasMore = page.data !== undefined && page.data.limit === limit && page.data.hasMore
  const loadMore = useCallback(() => setLimit((l) => l + ALL_SITES_PAGE_SIZE), [])

  return {
    rows: page.data?.rows ?? EMPTY,
    now: page.data?.now ?? 0,
    total: total.data ?? null,
    loaded: page.data !== undefined,
    hasMore,
    loadMore,
    lost: lost.data ?? NO_IDS,
  }
}
