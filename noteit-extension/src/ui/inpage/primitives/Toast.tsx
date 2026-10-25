/** @jsxImportSource preact */
// undo-toast, in-page variant (DESIGN.md "Components", EXPERIENCE Q57 / Q60): a dark {colors.foreground}
// pill with the message and a white pill action button. In the page it sits at the former popover
// position (the caller passes that point). The caller owns the live region and the timer.
import { effects } from '../../tokens/index.ts'

export interface ToastProps {
  /** Top-left corner in viewport coordinates. */
  left: number
  top: number
  message: string
  actionLabel: string
  onAction: () => void
}

export function Toast({ left, top, message, actionLabel, onAction }: ToastProps) {
  return (
    <div class="nt-overlay nt-toast" data-noteit-toast="" style={{ left: `${left}px`, top: `${top}px` }}>
      <span>{message}</span>
      <button type="button" class="nt-toast-action" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  )
}

/** Component CSS of the in-page toast. */
export const TOAST_CSS = `
.nt-toast {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 14px;
  height: 42px;
  padding: 0 6px 0 18px;
  white-space: nowrap;
  border-radius: var(--nt-radius-full);
  background: var(--nt-foreground);
  color: var(--nt-primary-foreground);
  font-family: var(--nt-font-family);
  font-size: var(--nt-body-font-size);
  box-shadow: ${effects.floatingMenuShadow};
}
.nt-toast-action {
  all: unset;
  box-sizing: border-box;
  height: 30px;
  padding: 0 16px;
  display: inline-flex;
  align-items: center;
  border-radius: var(--nt-radius-full);
  background: var(--nt-background);
  color: var(--nt-foreground);
  font-weight: 600;
  cursor: pointer;
}
.nt-toast-action:focus-visible {
  /* undo-toast action-focus-ring: the toast is dark, so the default ring would not show. */
  outline: 2px solid var(--nt-ring-inverse);
  outline-offset: 2px;
}
`
