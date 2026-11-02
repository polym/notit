// page-group (DESIGN.md "Components", Story 3.7, Q66): one collapsible row per page. Header: 12px
// disclosure chevron (right when collapsed, down when expanded), 14px favicon (globe icon when it is
// missing or fails to load), page title (body, one line) and item-count. The whole row toggles; with
// focus on the row, ArrowLeft collapses and ArrowRight expands. Items follow article order.
import { useState, type KeyboardEvent } from 'react'
import { strings } from '../../../ui/strings.ts'
import type { ItemActions } from './actions.ts'
import { HighlightItem } from './HighlightItem.tsx'
import type { PageGroupData } from './page-groups.ts'

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      data-testid="group-chevron"
      style={{ transform: expanded ? 'rotate(90deg)' : undefined, transition: 'transform 120ms ease' }}
    >
      <path d="M6 3.5l4.5 4.5L6 12.5" />
    </svg>
  )
}

function GlobeIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" data-testid="favicon-fallback">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M1.5 8h13M8 1.5c-2.2 2.4-2.2 10.6 0 13M8 1.5c2.2 2.4 2.2 10.6 0 13" />
    </svg>
  )
}

/** Stored favicon URL (never fetched by the extension itself, #15); the globe when absent or broken. */
function Favicon({ src }: { src: string | null }) {
  // Remembers which URL failed so a new URL is tried again.
  const [failed, setFailed] = useState<string | null>(null)
  if (!src || failed === src) return <GlobeIcon />
  return <img src={src} alt="" width={14} height={14} data-testid="favicon" onError={() => setFailed(src)} style={{ borderRadius: 'var(--nt-radius-xs)' }} />
}

export function PageGroup({
  group,
  expanded,
  onExpandedChange,
  lost,
  actions,
}: {
  group: PageGroupData
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  lost: ReadonlySet<string>
  actions: ItemActions
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      onExpandedChange(false)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      onExpandedChange(true)
    }
  }
  return (
    <div data-testid="page-group" data-page-key={group.key} data-expanded={expanded ? 'true' : 'false'}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => onExpandedChange(!expanded)}
        onKeyDown={onKeyDown}
        data-testid="page-group-header"
        className="flex w-full items-center bg-transparent text-left text-foreground hover:bg-hover focus-visible:outline-2 focus-visible:outline-ring"
        style={{ gap: 'var(--nt-space-2)', padding: 'var(--nt-space-row-y) var(--nt-space-row-x)', borderRadius: 'var(--nt-radius)' }}
      >
        <span aria-hidden="true" className="flex shrink-0 text-muted-foreground">
          <Chevron expanded={expanded} />
        </span>
        <span aria-hidden="true" className="flex shrink-0 items-center justify-center text-muted-foreground" style={{ width: '14px', height: '14px' }}>
          <Favicon src={group.favicon} />
        </span>
        <span
          data-testid="page-group-title"
          className="min-w-0 flex-1 truncate"
          title={group.title}
          style={{ fontSize: 'var(--nt-body-font-size)', lineHeight: 'var(--nt-body-line-height)', fontWeight: 'var(--nt-body-font-weight)' }}
        >
          {group.title}
        </span>
        <span
          data-testid="item-count"
          className="shrink-0 text-muted-foreground"
          style={{ fontSize: 'var(--nt-meta-font-size)', lineHeight: 'var(--nt-meta-line-height)' }}
        >
          {strings.itemCount(group.highlights.length)}
        </span>
      </button>
      {expanded && (
        <ul aria-label={group.title} data-testid="highlight-list" style={{ margin: '0 0 0 var(--nt-space-list-x)' }}>
          {group.highlights.map((h) => (
            <HighlightItem key={h.id} highlight={h} lost={lost.has(h.id)} actions={actions} />
          ))}
        </ul>
      )}
    </div>
  )
}
