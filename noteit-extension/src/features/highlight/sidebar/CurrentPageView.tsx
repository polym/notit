// Current page view (Story 3.5, FR20, NFR3): control row, page title row (caption, one line), then the
// page's highlights in article order. No loading skeleton: nothing is listed until the first local
// query resolves, which is fast enough to skip a placeholder (EXPERIENCE "no cold-start skeleton").
// Story 3.6 empty states: site off (strings.siteOff + strings.siteTurnOn, item-count hidden, Q67), unsupported page
// (item-count hidden) and no highlights yet (shortcut hint for the platform).
import type { ReactNode } from 'react'
import { Button } from '../../../ui/sidebar/components/button.tsx'
import { strings } from '../../../ui/strings.ts'
import type { ItemActions } from './actions.ts'
import { HighlightItem } from './HighlightItem.tsx'
import type { CurrentPage } from './useCurrentPage.ts'
import type { SiteState } from './useSiteState.ts'
import { ViewControls, type HighlightViewId } from './ViewControls.tsx'

/** macOS shows the symbol shortcut; Windows / Linux show Ctrl+Shift+H (manifest suggested keys). */
const isMac = (): boolean => /mac/i.test(navigator.platform || navigator.userAgent)

function EmptyState({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-start text-muted-foreground"
      style={{ padding: '20px var(--nt-space-3)', gap: 'var(--nt-space-2)', fontSize: 'var(--nt-meta-font-size)' }}
    >
      {children}
    </div>
  )
}

export function CurrentPageView({
  page,
  site,
  onViewChange,
  actions,
}: {
  page: CurrentPage
  site: SiteState
  onViewChange: (view: HighlightViewId) => void
  actions: ItemActions
}) {
  const { highlights, lost } = page
  // Nothing is listed until both the site state and the page query have answered (no skeleton).
  const loaded = page.loaded && site.status !== 'loading'
  const showList = loaded && site.status === 'on'
  return (
    <section data-testid="current-page-view">
      <ViewControls view="current" onChange={onViewChange} count={showList ? highlights.length : null} />
      {page.title && (
        <div
          data-testid="page-title"
          className="truncate text-muted-foreground"
          title={page.title}
          style={{
            padding: '0 var(--nt-space-header-x) var(--nt-space-1)',
            fontSize: 'var(--nt-caption-font-size)',
            lineHeight: 'var(--nt-caption-line-height)',
          }}
        >
          {page.title}
        </div>
      )}
      {site.status === 'unsupported' && (
        <EmptyState testId="page-unsupported">
          <span>{strings.pageUnsupported}</span>
        </EmptyState>
      )}
      {loaded && site.status === 'off' && (
        <EmptyState testId="site-off">
          <span>{strings.siteOff}</span>
          <Button variant="outline" onClick={() => void site.setEnabled(true)} style={{ padding: '3px 10px' }}>
            {strings.siteTurnOn}
          </Button>
        </EmptyState>
      )}
      {showList &&
        (highlights.length === 0 ? (
          <EmptyState testId="empty-current-page">
            <span>{isMac() ? strings.emptyCurrentPage : strings.emptyCurrentPageCtrl}</span>
          </EmptyState>
        ) : (
          <ul aria-label={strings.highlightList} data-testid="highlight-list" style={{ margin: '0 var(--nt-space-list-x)' }}>
            {highlights.map((h) => (
              <HighlightItem
                key={h.id}
                highlight={h}
                lost={lost.has(h.id)}
                actions={actions}
              />
            ))}
          </ul>
        ))}
    </section>
  )
}
