// logout-confirm (Story 3.10, FR29, Q64; DESIGN.md "logout-confirm"): shadcn AlertDialog look with tokens
// swapped in, without Radix (none is pinned in architecture.md). White box, 1px border-strong, rounded-md,
// 14px 14px 12px padding, two outline buttons (no red). A rgba(15,15,15,.2) scrim covers the panel.
// Cancel, Esc or a click on the scrim closes it ([ASSUMPTION] in EXPERIENCE.md); focus stays inside.
// While sign-out is in flight (busy) none of them can close it, because the request cannot be stopped;
// buttons use aria-disabled instead of disabled so focus never drops out of the dialog.
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { strings } from '../../strings.ts'
import { effects } from '../../tokens/index.ts'
import { Button } from '../components/button.tsx'

const TEXT_ID = 'nt-logout-confirm-text'

export function LogoutConfirm({
  pending,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: number
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => previous?.focus()
  }, [])

  const cancel = () => {
    if (!busy) onCancel()
  }
  const confirm = () => {
    if (!busy) onConfirm()
  }

  // Esc cancels (unless busy); Tab cycles between the two buttons.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancel()
      return
    }
    if (event.key !== 'Tab') return
    const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    if (buttons.length === 0) return
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      data-testid="logout-confirm-scrim"
      onClick={cancel}
      className="fixed inset-0 flex items-center justify-center"
      style={{ background: effects.scrim, zIndex: 60, padding: 'var(--nt-space-header-x)' }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-describedby={TEXT_ID}
        aria-label={strings.logout}
        data-testid="logout-confirm"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        className="border border-border-strong bg-background text-foreground"
        style={{
          maxWidth: 300,
          padding: '14px 14px 12px',
          borderRadius: 'var(--nt-radius-md)',
          boxShadow: effects.dialogShadow,
        }}
      >
        <p
          id={TEXT_ID}
          className="m-0"
          style={{
            marginBottom: 'var(--nt-space-3)',
            fontSize: 'var(--nt-body-font-size)',
            lineHeight: 'var(--nt-body-line-height)',
          }}
        >
          {strings.logoutConfirm(pending)}
        </p>
        <div className="flex justify-end" style={{ gap: 'var(--nt-space-2)' }}>
          <Button
            ref={cancelRef}
            variant="outline"
            onClick={cancel}
            aria-disabled={busy || undefined}
            className={busy ? 'cursor-not-allowed opacity-60' : ''}
            style={{ height: 28, padding: '0 12px' }}>
            {strings.logoutCancel}
          </Button>
          <Button
            variant="outline"
            onClick={confirm}
            aria-disabled={busy || undefined}
            aria-busy={busy}
            className={busy ? 'cursor-not-allowed opacity-60' : ''}
            style={{ height: 28, padding: '0 12px' }}>
            {strings.logout}
          </Button>
        </div>
      </div>
    </div>
  )
}
