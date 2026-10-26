// sync-status and sync-error-popover (Story 3.10, FR37, Q68; DESIGN.md "sync-status", "sync-error-popover").
// Empty outbox: a quiet icon only. Pending items: strings.syncPending(N) next to the icon. Failure: the icon turns
// {colors.warning}; clicking opens a popover with one line of reason (errorText) and a retry button.
// Esc or a click outside closes it; once a retry succeeds the state leaves 'error' and it closes.
// State changes are announced through a polite live region. Sync failure never touches the badge.
import { useEffect, useRef, useState } from 'react'
import type { SyncStatus as SyncStatusValue } from '../../../core/sync/protocol.ts'
import { errorText, strings } from '../../strings.ts'
import { effects } from '../../tokens/index.ts'
import { Button } from '../components/button.tsx'
import { SyncIcon } from './icons.tsx'
import { syncDescription, type SyncStatusState } from './sync.ts'

function failureReason(status: SyncStatusValue): string {
  return errorText(status.lastError?.code ?? 'internal')
}

export function SyncStatus({ sync }: { sync: SyncStatusState }) {
  const { status, retrying, retry } = sync
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const failed = status?.state === 'error'
  const pending = status?.pending ?? 0
  const popoverOpen = open && failed

  // Reset the open flag once the failure (and any retry) is over, so the next failure needs a fresh click.
  // Adjusted during render rather than in an effect (react.dev "storing information from previous renders").
  const active = failed || retrying
  const [prevActive, setPrevActive] = useState(active)
  if (active !== prevActive) {
    setPrevActive(active)
    if (!active) setOpen(false)
  }

  // The popover unmounts when a retry moves the state out of 'error' while focus is on its retry button;
  // hand focus back to the trigger instead of letting it drop to <body>.
  const wasOpen = useRef(false)
  useEffect(() => {
    const closed = wasOpen.current && !popoverOpen
    wasOpen.current = popoverOpen
    if (!closed) return
    if (document.activeElement === null || document.activeElement === document.body) buttonRef.current?.focus()
  }, [popoverOpen])

  // Esc or a pointer press outside closes the popover.
  useEffect(() => {
    if (!popoverOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [popoverOpen])

  const description = syncDescription(status)

  return (
    <div ref={rootRef} className="relative flex">
      <button
        ref={buttonRef}
        type="button"
        data-testid="sync-status"
        data-state={failed ? 'error' : pending > 0 ? 'pending' : 'idle'}
        aria-label={strings.syncStatusLabel(description)}
        aria-haspopup={failed ? 'dialog' : undefined}
        aria-expanded={failed ? popoverOpen : undefined}
        onClick={() => {
          if (failed) setOpen((v) => !v)
        }}
        className={`inline-flex items-center rounded bg-transparent text-muted-foreground hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring ${
          failed ? 'cursor-pointer' : 'cursor-default'
        }`}
        style={{ height: 22, minWidth: 22, gap: 3, padding: '0 4px', border: 0 }}
      >
        <span data-testid="sync-status-icon" className={`flex ${failed ? 'text-warning' : ''}`}>
          <SyncIcon />
        </span>
        {pending > 0 && (
          <span
            data-testid="sync-status-pending"
            style={{
              fontSize: 'var(--nt-caption-font-size)',
              fontWeight: 'var(--nt-caption-font-weight)',
              lineHeight: 'var(--nt-caption-line-height)',
            }}
          >
            {strings.syncPending(pending)}
          </span>
        )}
      </button>

      <span role="status" aria-live="polite" data-testid="sync-status-live" className="sr-only">
        {description}
      </span>

      {popoverOpen && status && (
        <div
          role="dialog"
          aria-label={strings.syncDetails}
          data-testid="sync-error-popover"
          className="absolute right-0 flex items-center whitespace-nowrap border border-border-strong bg-background text-foreground"
          style={{
            top: 'calc(100% + 6px)',
            zIndex: 40,
            gap: 'var(--nt-space-2)',
            padding: '6px 6px 6px 10px',
            borderRadius: 'var(--nt-radius-md)',
            boxShadow: effects.floatingMenuShadow,
            fontSize: 'var(--nt-meta-font-size)',
            lineHeight: 'var(--nt-meta-line-height)',
          }}
        >
          <span data-testid="sync-error-reason">{failureReason(status)}</span>
          <Button variant="outline" onClick={() => void retry()} disabled={retrying} aria-busy={retrying} style={{ height: 24, padding: '0 10px' }}>
            {strings.syncRetry}
          </Button>
        </div>
      )}
    </div>
  )
}
