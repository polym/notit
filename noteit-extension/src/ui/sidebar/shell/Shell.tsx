// Side panel module container (Story 3.3, FR25, NFR24). Layout follows DESIGN.md option A:
// header -> module tab row -> content. The shell knows modules only through SidebarModule, and the
// header's left side only as an injected component (headerStart).
// Story 3.10: the header account button opens the account-panel in place of the content area with the
// module tabs hidden; pressing it again or the back button goes back. The module stays mounted (hidden) so its
// view, scroll groups and edits survive the round trip.
import { useState, type FC } from 'react'
import { AccountPanel } from './AccountPanel.tsx'
import { useAuth } from './auth.ts'
import { Header } from './Header.tsx'
import { panelId, tabId } from './ids.ts'
import { ModuleTabs } from './ModuleTabs.tsx'
import { useSidebarOpened, useSyncStatus } from './sync.ts'
import type { SidebarModule } from './types.ts'

/** `settings` is injected device settings (e.g. translation) shown at the bottom of the account panel. */
export function Shell({ modules, headerStart, settings }: { modules: readonly SidebarModule[]; headerStart?: FC; settings?: FC }) {
  const [activeId, setActiveId] = useState(() => modules[0]?.id ?? '')
  const [accountOpen, setAccountOpen] = useState(false)
  const active = modules.find((m) => m.id === activeId) ?? modules[0]
  const sync = useSyncStatus()
  const { state: auth } = useAuth()
  useSidebarOpened()

  return (
    <div data-testid="sidebar-shell" className="flex min-h-screen flex-col bg-canvas text-foreground font-sans">
      <Header start={headerStart} sync={sync} accountOpen={accountOpen} onToggleAccount={() => setAccountOpen((v) => !v)} />
      {accountOpen && <AccountPanel email={auth?.email ?? null} sync={sync} onBack={() => setAccountOpen(false)} settings={settings} />}
      {active && (
        <>
          <ModuleTabs modules={modules} activeId={active.id} onSelect={setActiveId} hidden={accountOpen} />
          <main
            id={panelId(active.id)}
            role="tabpanel"
            aria-labelledby={tabId(active.id)}
            data-testid="module-content"
            hidden={accountOpen}
            className="flex-1"
          >
            <active.View />
          </main>
        </>
      )}
    </div>
  )
}
