// undo-toast (DESIGN.md "Components", EXPERIENCE Q57 / Q60): one line (strings.deleted + strings.undo), dark
// {colors.foreground} background with white text, 6px 12px padding, the action an underlined 500-weight
// text button. In the side panel it sits bottom center, 16px from the bottom. The live region stays
// mounted so screen readers announce the message when it appears (aria-live="polite").
// The caller owns visibility and the 5 second timer.
import { strings } from '../../strings.ts'

export function UndoToast({
  open,
  message,
  actionLabel,
  onAction,
}: {
  open: boolean
  message: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="undo-toast-region"
      className="pointer-events-none fixed inset-x-0 flex justify-center"
      style={{ bottom: '16px', zIndex: 50 }}
    >
      {open && (
        <div
          data-testid="undo-toast"
          className="pointer-events-auto flex items-center whitespace-nowrap bg-foreground text-primary-foreground"
          style={{
            gap: '6px',
            padding: '6px 12px',
            borderRadius: 'var(--nt-radius)',
            fontSize: 'var(--nt-meta-font-size)',
            lineHeight: 'var(--nt-meta-line-height)',
          }}
        >
          <span>{message}</span>
          <span aria-hidden="true" style={{ opacity: 0.6 }}>
            {strings.separator.trim()}
          </span>
          <button
            type="button"
            onClick={onAction}
            className="bg-transparent p-0 text-primary-foreground underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring-inverse"
            style={{ fontSize: 'inherit', lineHeight: 'inherit', fontWeight: 500, textUnderlineOffset: '2px' }}
          >
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  )
}
