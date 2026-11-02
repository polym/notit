// sidebar-header (DESIGN.md "Layout & Spacing", option A row 2). The left side is a slot the entry
// fills (the highlight site toggle, Story 3.6) so the shell never imports a feature; without it the
// app name is shown. The right side holds sync-status and the single account button (Story 3.10, Q61),
// 2px apart.
import type { FC } from 'react'
import { strings } from '../../strings.ts'
import { AccountIcon } from './icons.tsx'
import { SyncStatus } from './SyncStatus.tsx'
import type { SyncStatusState } from './sync.ts'

export function Header({
  start: Start,
  sync,
  accountOpen,
  onToggleAccount,
}: {
  start?: FC
  sync: SyncStatusState
  accountOpen: boolean
  onToggleAccount: () => void
}) {
  return (
    <header
      data-testid="sidebar-header"
      className="flex items-center justify-between border-b border-border bg-canvas text-body-secondary"
      style={{
        padding: 'var(--nt-space-header-y) var(--nt-space-header-x)',
        fontSize: 'var(--nt-meta-font-size)',
        lineHeight: 'var(--nt-meta-line-height)',
      }}
    >
      {Start ? <Start /> : <span>{strings.appName}</span>}
      <span className="flex items-center" style={{ gap: 'var(--nt-space-0-5)' }}>
        <SyncStatus sync={sync} />
        <button
          type="button"
          data-testid="account-button"
          aria-label={strings.account}
          aria-pressed={accountOpen}
          onClick={onToggleAccount}
          className={`inline-flex items-center justify-center rounded text-muted-foreground hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
            accountOpen ? 'bg-selected' : 'bg-transparent'
          }`}
          style={{ width: 22, height: 22, padding: 0, border: 0 }}
        >
          <AccountIcon />
        </button>
      </span>
    </header>
  )
}
