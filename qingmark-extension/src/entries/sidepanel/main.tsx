// Side panel entry: composition only (architecture.md "Project Structure & Boundaries").
// The shell receives its modules here; adding a module is one more item in MODULES.
// AuthGate shows only the login form while signed out (Story 3.4). The header left side is the
// highlight site toggle (Story 3.6). SupportGate shows only the unsupported-notice when
// chrome.sidePanel is missing, e.g. in Arc (Story 3.11).
import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthGate, Shell, SupportGate, type SidebarModule } from '../../ui/sidebar/shell/index.ts'
import { SiteToggle, highlightModule } from '../../features/highlight/sidebar.ts'
import { TranslateSettings } from '../../features/translate/sidebar.ts'
import { installRootCssVars } from '../../ui/tokens/index.ts'
// Tailwind 4 with the token theme (Story 3.1); side panel only.
import '../../ui/sidebar/styles.css'

const MODULES: readonly SidebarModule[] = [highlightModule]

// Design tokens as --nt-* and shadcn CSS variables on :root (Story 3.1).
installRootCssVars()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SupportGate>
      {/* Translation settings are per device: reachable signed out (login page) and signed in (account panel). */}
      <AuthGate settings={TranslateSettings}>
        <Shell modules={MODULES} headerStart={SiteToggle} settings={TranslateSettings} />
      </AuthGate>
    </SupportGate>
  </React.StrictMode>,
)
