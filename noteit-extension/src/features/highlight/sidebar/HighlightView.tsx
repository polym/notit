// Highlight module View (Story 3.5; site state from Story 3.6; all-sites view from Story 3.7). Owns the
// view switch and the active tab. Both views stay mounted once shown (the inactive one is hidden), so
// collapse state survives a switch; the window scroll position is saved per view and restored on switch
// (EXPERIENCE "view-segmented-control"). Story 3.8: item actions and the side panel undo-toast live
// here so both views share one toast.
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { UndoToast } from '../../../ui/sidebar/shell/index.ts'
import { strings } from '../../../ui/strings.ts'
import { jumpTo, setColor, setComment, type ItemActions } from './actions.ts'
import { useUndoDelete } from './useUndoDelete.ts'
import { useActiveTab, useCurrentPage } from './useCurrentPage.ts'
import { useSiteState } from './useSiteState.ts'
import { AllSitesView } from './AllSitesView.tsx'
import { CurrentPageView } from './CurrentPageView.tsx'
import type { HighlightViewId } from './ViewControls.tsx'

export function HighlightView() {
  const [view, setView] = useState<HighlightViewId>('current')
  // The all-sites view mounts on first use so opening the panel reads only the current page.
  const [allSitesMounted, setAllSitesMounted] = useState(false)
  const scrollByView = useRef<Record<HighlightViewId, number>>({ current: 0, websites: 0 })
  const rootRef = useRef<HTMLDivElement>(null)
  // Set when the switch was made from the segmented control that is about to be hidden.
  const refocusSegment = useRef(false)
  const tab = useActiveTab()
  const page = useCurrentPage(tab.url, tab.tabTitle)
  const site = useSiteState(tab.url)
  const { pendingId, deleteWithUndo, undo } = useUndoDelete()
  const actions = useMemo<ItemActions>(
    () => ({
      onJumpTo: (id) => void jumpTo(id),
      onDelete: deleteWithUndo,
      onSetColor: (id, color) => void setColor(id, color),
      onSaveComment: setComment,
    }),
    [deleteWithUndo],
  )

  const switchTo = (next: HighlightViewId) => {
    if (next === view) return
    scrollByView.current[view] = window.scrollY
    refocusSegment.current = rootRef.current?.contains(document.activeElement) ?? false
    if (next === 'websites') setAllSitesMounted(true)
    setView(next)
  }

  // Restore the saved position of the view just shown, before paint. Story 3.11: each view has its own
  // segmented control, so the button that was pressed gets hidden; focus moves to the pressed button of
  // the view just shown instead of dropping to <body>.
  useLayoutEffect(() => {
    window.scrollTo(0, scrollByView.current[view])
    if (!refocusSegment.current) return
    refocusSegment.current = false
    rootRef.current
      ?.querySelector<HTMLButtonElement>(`[data-view="${view}"] [data-testid="view-segmented-control"] [aria-pressed="true"]`)
      ?.focus({ preventScroll: true })
  }, [view, allSitesMounted])

  return (
    <div data-testid="highlight-module" ref={rootRef}>
      <div data-view="current" hidden={view !== 'current'}>
        <CurrentPageView page={page} site={site} onViewChange={switchTo} actions={actions} />
      </div>
      {allSitesMounted && (
        <div data-view="websites" hidden={view !== 'websites'}>
          <AllSitesView onViewChange={switchTo} actions={actions} />
        </div>
      )}
      <UndoToast open={pendingId !== null} message={strings.deleted} actionLabel={strings.undo} onAction={undo} />
    </div>
  )
}
