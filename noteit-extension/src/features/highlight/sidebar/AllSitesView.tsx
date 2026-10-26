// All-sites view (Story 3.7, FR21, Q52, Q66): control row with the total item-count, then
// date-group-heading (today / yesterday / this week / earlier; empty buckets hidden) and page groups.
// Only the most recent page group starts expanded; the user's choices are kept while the view stays
// mounted (HighlightView keeps it mounted across view switches). More rows load when the end of the
// list scrolls into view. No loading skeleton: nothing is listed until the first local query resolves.
import { useEffect, useMemo, useRef, useState } from 'react'
import { strings } from '../../../ui/strings.ts'
import type { DateBucket } from '../../../ui/format/time.ts'
import type { ItemActions } from './actions.ts'
import { groupAllSites } from './page-groups.ts'
import { PageGroup } from './PageGroup.tsx'
import { useAllSites } from './useAllSites.ts'
import { ViewControls, type HighlightViewId } from './ViewControls.tsx'

const BUCKET_LABEL: Record<DateBucket, string> = {
  today: strings.dateToday,
  yesterday: strings.dateYesterday,
  thisWeek: strings.dateThisWeek,
  earlier: strings.dateEarlier,
}

/** Calls onVisible when the sentinel scrolls into view (infinite scroll). */
function LoadMoreSentinel({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onVisible()
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [onVisible])
  return <div ref={ref} data-testid="all-sites-load-more" style={{ height: '1px' }} />
}

export function AllSitesView({ onViewChange, actions }: { onViewChange: (view: HighlightViewId) => void; actions: ItemActions }) {
  const data = useAllSites()
  const buckets = useMemo(() => groupAllSites(data.rows, data.now), [data.rows, data.now])
  // Explicit expand / collapse choices by page key; everything else follows the default.
  const [choices, setChoices] = useState<ReadonlyMap<string, boolean>>(new Map())
  // The default-expanded group is fixed when the list first has data, so a new highlight on another
  // page does not move it.
  const [defaultKey, setDefaultKey] = useState<string | null>(null)
  const firstKey = buckets[0]?.groups[0]?.key ?? null
  // If the pinned group is gone (all its highlights deleted), fall back to the current first group.
  const defaultPresent =
    defaultKey !== null && buckets.some(({ groups }) => groups.some((g) => g.key === defaultKey))
  const effectiveDefault = defaultPresent ? defaultKey : firstKey
  if (effectiveDefault !== null && effectiveDefault !== defaultKey) setDefaultKey(effectiveDefault)

  const isExpanded = (key: string) => choices.get(key) ?? key === effectiveDefault
  const setExpanded = (key: string, expanded: boolean) =>
    setChoices((prev) => new Map(prev).set(key, expanded))

  const empty = data.loaded && buckets.length === 0
  return (
    <section data-testid="all-sites-view">
      <ViewControls view="websites" onChange={onViewChange} count={data.loaded ? data.total : null} />
      {empty && (
        <div
          data-testid="empty-all-sites"
          className="text-muted-foreground"
          style={{ padding: '20px var(--nt-space-3)', fontSize: 'var(--nt-meta-font-size)' }}
        >
          {strings.emptyAllSites}
        </div>
      )}
      {buckets.map(({ bucket, groups }) => (
        <section key={bucket} data-testid="date-group" data-bucket={bucket} aria-labelledby={`noteit-date-${bucket}`}>
          <h3
            id={`noteit-date-${bucket}`}
            data-testid="date-group-heading"
            className="text-muted-foreground"
            style={{
              margin: 0,
              padding: 'var(--nt-space-2) var(--nt-space-row-x) var(--nt-space-1)',
              fontSize: 'var(--nt-group-heading-font-size)',
              lineHeight: 'var(--nt-group-heading-line-height)',
              fontWeight: 'var(--nt-group-heading-font-weight)',
            }}
          >
            {BUCKET_LABEL[bucket]}
          </h3>
          <div style={{ margin: '0 var(--nt-space-list-x)' }}>
            {groups.map((g) => (
              <PageGroup
                key={g.key}
                group={g}
                expanded={isExpanded(g.key)}
                onExpandedChange={(expanded) => setExpanded(g.key, expanded)}
                lost={data.lost}
                actions={actions}
              />
            ))}
          </div>
        </section>
      ))}
      {data.hasMore && <LoadMoreSentinel onVisible={data.loadMore} />}
    </section>
  )
}
