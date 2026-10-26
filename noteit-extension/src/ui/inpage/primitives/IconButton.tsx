/** @jsxImportSource preact */
// icon-button (DESIGN.md "Components"): 30px round button. "accent" is the filled {colors.primary}
// comment button of the floating menu; "soft" is the quiet canvas button (highlight-popover delete:
// {colors.subtle-foreground}, no red, undo is the safety net).
import type { ComponentChildren } from 'preact'

export interface IconButtonProps {
  label: string
  onClick: () => void
  pressed?: boolean
  variant?: 'accent' | 'soft'
  children: ComponentChildren
}

export function IconButton({ label, onClick, pressed, variant = 'soft', children }: IconButtonProps) {
  return (
    <button type="button" class={`nt-round nt-round-${variant}`} aria-label={label} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  )
}

/** Line trash icon (mockups/key-in-page-overlays.html, highlight-popover delete). */
export function DeleteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
    </svg>
  )
}

/** Line comment icon (mockups/key-in-page-overlays.html). */
export function CommentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">
      <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />
    </svg>
  )
}
