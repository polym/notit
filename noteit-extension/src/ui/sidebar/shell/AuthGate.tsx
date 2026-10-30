// Side panel auth gate (Story 3.4, FR26, FR27): signed out shows only the login form, without the
// header, site toggle or module tabs. Children (the shell) mount only with a session, so signing in
// opens the first module in its default view (highlight: "current page").
// Spec "login-supabase-config" (variant A) adds the server row under the form; without any config
// the row is forced open, a notice explains why and the form is disabled.
import type { FC, ReactNode } from 'react'
import { strings } from '../../strings.ts'
import { useAuth, useServerConfig } from './auth.ts'
import { LoginForm } from './LoginForm.tsx'
import { ServerSettings } from './ServerSettings.tsx'

/** `settings` is injected device settings (e.g. translation) shown under the server row while signed out. */
export function AuthGate({ children, settings: Settings }: { children: ReactNode; settings?: FC }) {
  const { state, setState } = useAuth()
  const { config, setConfig } = useServerConfig(state?.signedIn === false)
  // Render nothing until the first auth/getState answer, so the form never flashes for a session.
  if (state === null) return null
  if (!state.signedIn) {
    const noServer = config?.source === 'none'
    return (
      <div className="min-h-screen bg-canvas text-foreground font-sans">
        {noServer && (
          <p
            role="note"
            data-testid="server-none-notice"
            // Neutral fill: DESIGN.md keeps {colors.warning} for the sync failure icon.
            className="m-0 bg-muted text-foreground"
            style={{
              margin: 'var(--nt-space-3) var(--nt-space-header-x) 0',
              padding: 'var(--nt-space-2) var(--nt-space-2-5)',
              borderRadius: 'var(--nt-radius-md)',
              fontSize: 'var(--nt-meta-font-size)',
              lineHeight: 'var(--nt-meta-line-height)',
            }}
          >
            {strings.serverNoneNotice}
          </p>
        )}
        <LoginForm onSignedIn={setState} disabled={noServer} />
        {/* key resets the row (draft fields, open state) whenever the active server changes. */}
        {config && <ServerSettings key={`${config.source}:${config.url ?? ''}`} config={config} onChange={setConfig} />}
        {Settings && <Settings />}
      </div>
    )
  }
  return <>{children}</>
}
