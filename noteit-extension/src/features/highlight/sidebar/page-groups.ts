// Page groups of the all-sites view (Story 3.7, FR21, Q52): one group per canonicalUrl, ordered by
// the group's newest highlight (createdAt). Each whole group lands in the date bucket of its newest
// highlight and is never split across buckets. Items inside a group follow article order.
import type { HighlightRecord } from '../../../core/model/index.ts'
import { groupByDateBucket, type DateBucket } from '../../../ui/format/time.ts'
import { sortForPage } from './order.ts'

export interface PageGroupData {
  /** canonicalUrl shared by every item. */
  key: string
  title: string
  favicon: string | null
  /** createdAt of the newest item. */
  latest: number
  /** Article order. */
  highlights: HighlightRecord[]
}

/** Host name for display; keys that do not parse are shown as they are. */
const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** Page groups newest first. Title and favicon come from the newest item that has one. */
export function pageGroups(rows: readonly HighlightRecord[]): PageGroupData[] {
  const byKey = new Map<string, HighlightRecord[]>()
  for (const r of rows) {
    const list = byKey.get(r.canonicalUrl)
    if (list) list.push(r)
    else byKey.set(r.canonicalUrl, [r])
  }
  const groups: PageGroupData[] = []
  for (const [key, items] of byKey) {
    const newestFirst = [...items].sort((a, b) => b.createdAt - a.createdAt)
    groups.push({
      key,
      title: newestFirst.find((h) => h.pageTitle)?.pageTitle || hostOf(newestFirst[0].url),
      favicon: newestFirst.find((h) => h.favicon)?.favicon ?? null,
      latest: newestFirst[0].createdAt,
      highlights: sortForPage(items),
    })
  }
  return groups.sort((a, b) => b.latest - a.latest || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/** Date buckets (newest first, empty ones left out), each holding whole page groups newest first. */
export function groupAllSites(
  rows: readonly HighlightRecord[],
  now: number,
): Array<{ bucket: DateBucket; groups: PageGroupData[] }> {
  return groupByDateBucket(pageGroups(rows), (g) => g.latest, now).map(({ bucket, items }) => ({ bucket, groups: items }))
}
