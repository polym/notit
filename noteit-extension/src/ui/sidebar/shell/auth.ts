// Sign-in state for the shell: asked from the service worker (auth/getState) and kept current
// through auth/changed events. The panel never creates a Supabase client (architecture.md D5).
import { useEffect, useState } from 'react'
import { createClient, onEvent } from '../../../core/messaging/index.ts'
import type { AuthEvents, AuthRequests, AuthState, ServerConfigState } from '../../../core/auth/protocol.ts'

export const authClient = createClient<AuthRequests>()

/** state is null while the first auth/getState answer is pending. */
export function useAuth(): { state: AuthState | null; setState: (next: AuthState) => void } {
  const [state, setState] = useState<AuthState | null>(null)

  useEffect(() => {
    let active = true
    const unsubscribe = onEvent<AuthEvents>({
      'auth/changed': (next) => setState(next),
    })
    void authClient.send('auth/getState', undefined).then((result) => {
      if (!active) return
      setState(result.ok ? result.data : { signedIn: false, email: null })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return { state, setState }
}

/**
 * Active Supabase server (auth/getConfig), asked when `enabled` turns true. config stays null while
 * pending or when the worker cannot answer, and the login page then shows no server row.
 */
export function useServerConfig(enabled: boolean): {
  config: ServerConfigState | null
  setConfig: (next: ServerConfigState) => void
} {
  const [config, setConfig] = useState<ServerConfigState | null>(null)

  useEffect(() => {
    if (!enabled) return
    let active = true
    void authClient.send('auth/getConfig', undefined).then((result) => {
      if (active && result.ok) setConfig(result.data)
    })
    return () => {
      active = false
    }
  }, [enabled])

  return { config, setConfig }
}
