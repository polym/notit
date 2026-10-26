// unsupported-notice (Story 3.11, FR44; DESIGN.md "unsupported-notice"): a fixed bar at the top of the
// side panel on a {colors.hover} background with a 1px {colors.border} outline, {rounded.DEFAULT} corners
// and meta type. It cannot be dismissed (EXPERIENCE.md [ASSUMPTION]).
// SupportGate shows only this notice when chrome.sidePanel is missing (Arc); nothing else renders.
import type { ReactNode } from 'react'
import { strings } from '../../strings.ts'
import { sidePanelSupported } from './support.ts'

export function UnsupportedNotice() {
  return (
    <div
      role="note"
      data-testid="unsupported-notice"
      className="sticky top-0 border border-border bg-hover text-foreground"
      style={{
        margin: 'var(--nt-space-2)',
        padding: 'var(--nt-space-2) var(--nt-space-3)',
        borderRadius: 'var(--nt-radius)',
        fontSize: 'var(--nt-meta-font-size)',
        lineHeight: 'var(--nt-meta-line-height)',
        fontWeight: 'var(--nt-meta-font-weight)',
      }}
    >
      {strings.browserUnsupported}
    </div>
  )
}

export function SupportGate({ children, supported = sidePanelSupported() }: { children: ReactNode; supported?: boolean }) {
  if (!supported) {
    return (
      <main className="min-h-screen bg-canvas text-foreground font-sans">
        <UnsupportedNotice />
      </main>
    )
  }
  return <>{children}</>
}
