// Highlight module control row (DESIGN.md "Layout & Spacing" row 4): view-segmented-control
// (current page / all sites) on the left, item-count on the right.
import { strings } from '../../../ui/strings.ts'

export type HighlightViewId = 'current' | 'websites'

const VIEWS: ReadonlyArray<{ id: HighlightViewId; label: string }> = [
  { id: 'current', label: strings.viewCurrentPage },
  { id: 'websites', label: strings.viewAllSites },
]

export function ViewControls({
  view,
  onChange,
  count,
}: {
  view: HighlightViewId
  onChange: (view: HighlightViewId) => void
  /** null hides item-count. */
  count: number | null
}) {
  return (
    <div
      data-testid="view-controls"
      // Sticky so the view switch stays reachable from any scroll position (each view keeps its own).
      className="sticky top-0 z-10 flex items-center justify-between bg-canvas"
      style={{ padding: 'var(--nt-space-2) var(--nt-space-header-x) var(--nt-space-1)' }}
    >
      <div
        role="group"
        aria-label={strings.viewSwitch}
        data-testid="view-segmented-control"
        className="inline-flex bg-muted"
        style={{ padding: 'var(--nt-space-0-5)', borderRadius: 'var(--nt-radius)' }}
      >
        {VIEWS.map((v) => {
          const active = v.id === view
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(v.id)}
              className={`focus-visible:outline-2 focus-visible:outline-ring ${
                active ? 'bg-background text-foreground' : 'bg-transparent text-muted-foreground'
              }`}
              style={{
                padding: '1px 10px',
                borderRadius: 'var(--nt-radius-sm)',
                boxShadow: active ? '0 0 0 1px var(--nt-border-strong)' : undefined,
                fontSize: 'var(--nt-label-font-size)',
                fontWeight: 'var(--nt-label-font-weight)',
                lineHeight: 'var(--nt-label-line-height)',
              }}
            >
              {v.label}
            </button>
          )
        })}
      </div>
      {count !== null && (
        <span
          data-testid="item-count"
          className="text-muted-foreground"
          style={{ fontSize: 'var(--nt-meta-font-size)', lineHeight: 'var(--nt-meta-line-height)' }}
        >
          {strings.itemCount(count)}
        </span>
      )}
    </div>
  )
}
