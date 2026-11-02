// Side panel module contract (architecture.md "Architectural Boundaries", FR25, NFR24).
// The shell renders whatever modules it is given; it never imports a feature. A new module is a new
// features/<name>/ plus one line in entries/sidepanel.
import type { FC } from 'react'

export interface SidebarModule {
  /** Stable id, used for DOM ids and test ids. */
  id: string
  /** Tab label, from ui/strings.ts. */
  label: string
  /** Line icon shown before the label; decorative (the label names the tab). */
  icon: FC
  /** Module content, rendered in the shell content area while the tab is selected. */
  View: FC
}
