// Public surface of core/auth for the service worker. Pages and content scripts import only
// ./protocol.ts (types), so supabase-js stays out of their bundles.
export { authHandlers } from './handlers.ts'
export { getAuthState, onAuthChanged, setBeforeSignInHook, setSignedInHook, setSignOutHook, withSession, REFRESH_MARGIN_MS } from './session.ts'
export type { BeforeSignInHook, SignedInHook, SignOutHook } from './session.ts'
export type { AuthEvents, AuthRequests, AuthState } from './protocol.ts'
