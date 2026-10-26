// account-panel (Story 3.10, FR28, FR29, Q38, Q61; DESIGN.md "account-panel"). Replaces the content area
// while the module tabs are hidden. Read-only rows: signed-in email, last sync time, pending count; a
// strings.logout outline button at the bottom. With pending items sign-out asks first (logout-confirm);
// otherwise it signs out at once. Sign-out success arrives as auth/changed, which shows the login form.
import { useState, type ReactNode } from 'react'
import { strings } from '../../strings.ts'
import { formatDateTime } from '../../format/time.ts'
import { Button } from '../components/button.tsx'
import { authClient, useServerConfig } from './auth.ts'
import { LogoutConfirm } from './LogoutConfirm.tsx'
import type { SyncStatusState } from './sync.ts'

function Row({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div className="flex flex-col border-b border-border" style={{ padding: 'var(--nt-space-2) var(--nt-space-header-x)' }}>
      <span
        className="text-muted-foreground"
        style={{ fontSize: 'var(--nt-meta-font-size)', lineHeight: 'var(--nt-meta-line-height)' }}
      >
        {label}
      </span>
      <span
        data-testid={testId}
        className="overflow-hidden text-ellipsis whitespace-nowrap text-foreground"
        style={{ fontSize: 'var(--nt-body-font-size)', lineHeight: 'var(--nt-body-line-height)' }}
      >
        {children}
      </span>
    </div>
  )
}

export function AccountPanel({ email, sync, onBack }: { email: string | null; sync: SyncStatusState; onBack: () => void }) {
  const { status } = sync
  const [confirmCount, setConfirmCount] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const logout = async () => {
    setBusy(true)
    const result = await authClient.send('auth/logout', undefined)
    setBusy(false)
    setConfirmCount(null)
    if (!result.ok) console.warn('[NoteIt] auth/logout failed:', result.error.code)
  }

  const requestLogout = async () => {
    // Ask the worker at click time: the status shown may be a few events old.
    const result = await authClient.send('auth/getPendingCount', undefined)
    const pending = result.ok ? result.data.pending : (status?.pending ?? 0)
    if (pending > 0) setConfirmCount(pending)
    else await logout()
  }

  const lastSyncAt = status?.lastSyncAt ?? null

  // Read-only server row (spec "login-supabase-config"): changing it needs a sign-out first.
  const { config: server } = useServerConfig(true)

  return (
    <section data-testid="account-panel" aria-label={strings.account} className="flex flex-col">
      <div className="flex items-center border-b border-border" style={{ padding: 'var(--nt-space-1) var(--nt-space-1-5)' }}>
        <button
          type="button"
          data-testid="account-back"
          onClick={onBack}
          className="inline-flex items-center rounded bg-transparent text-muted-foreground hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
          style={{
            gap: 2,
            height: 22,
            padding: '0 4px',
            border: 0,
            fontSize: 'var(--nt-label-font-size)',
            fontWeight: 'var(--nt-label-font-weight)',
            lineHeight: 'var(--nt-label-line-height)',
          }}
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3L5 8l5 5" />
          </svg>
          {strings.accountBack}
        </button>
      </div>
      <Row label={strings.accountEmail} testId="account-email">
        {email ?? ''}
      </Row>
      <Row label={strings.accountServer} testId="account-server">
        {server?.url ?? ''}
      </Row>
      <Row label={strings.accountLastSync} testId="account-last-sync">
        {lastSyncAt === null ? strings.accountNeverSynced : formatDateTime(lastSyncAt)}
      </Row>
      <Row label={strings.accountPending} testId="account-pending">
        {status?.pending ?? 0}
      </Row>
      <div style={{ padding: 'var(--nt-space-3) var(--nt-space-header-x)' }}>
        <Button
          variant="outline"
          data-testid="account-logout"
          onClick={() => void requestLogout()}
          disabled={busy}
          style={{ height: 28, padding: '0 12px' }}
        >
          {strings.logout}
        </Button>
      </div>
      {confirmCount !== null && (
        <LogoutConfirm pending={confirmCount} busy={busy} onCancel={() => setConfirmCount(null)} onConfirm={() => void logout()} />
      )}
    </section>
  )
}
