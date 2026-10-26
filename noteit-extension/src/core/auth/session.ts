// Session access for every Supabase call in the service worker (architecture.md D5 and
// "Process Patterns": auth). Tokens are refreshed on demand because autoRefreshToken is off.
import { isAuthError, isAuthRetryableFetchError, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { HandlerError, emit, err, ok, type ErrorCode, type Result } from '../messaging/index.ts'
import { log } from '../log/index.ts'
import { STORAGE_KEYS } from '../settings/keys.ts'
import { getSupabase } from './client.ts'
import { chromeLocalStorageAdapter } from './storage-adapter.ts'
import type { AuthEvents, AuthState } from './protocol.ts'

/** Refresh when the access token expires within this window. */
export const REFRESH_MARGIN_MS = 60_000

const SIGNED_OUT: AuthState = { signedIn: false, email: null }

type AuthListener = (state: AuthState) => void
const listeners = new Set<AuthListener>()

/**
 * Runs before a password sign-in stores the new session; resolves with a release callback that
 * login() calls once the sign-in settled (failed, or succeeded and was reconciled). The sync engine
 * pauses its runs here so no run sends the old account's outbox with the new account's session.
 */
export type BeforeSignInHook = () => Promise<() => void>
/** Runs after a successful password sign-in, before it is announced (first sign-in wipe, FR39). */
export type SignedInHook = (userId: string) => Promise<void>
/** Wraps a user sign-out: must call signOut() and may wipe local data around it (FR29). */
export type SignOutHook = (signOut: () => Promise<void>) => Promise<void>

let beforeSignInHook: BeforeSignInHook = async () => () => {}
let signedInHook: SignedInHook = async () => {}
let signOutHook: SignOutHook = (signOut) => signOut()

/** Installs the before-sign-in hook (the sync engine pauses its runs). */
export function setBeforeSignInHook(hook: BeforeSignInHook): void {
  beforeSignInHook = hook
}

/** Installs the sign-in hook (the sync engine reconciles the local database with the account). */
export function setSignedInHook(hook: SignedInHook): void {
  signedInHook = hook
}

/** Installs the sign-out hook (the sync engine wipes local data). */
export function setSignOutHook(hook: SignOutHook): void {
  signOutHook = hook
}

/**
 * Subscribes to sign-in changes inside the service worker. chrome.runtime.sendMessage never reaches
 * the sender's own context, so the SW cannot hear its own auth/changed broadcast. Returns an unsubscribe.
 */
export function onAuthChanged(listener: AuthListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emitChanged(state: AuthState): void {
  void emit<AuthEvents>('auth/changed', state)
  for (const listener of listeners) {
    try {
      listener(state)
    } catch (error) {
      console.error('[NoteIt] auth listener failed:', error)
    }
  }
}

/** Maps a supabase-js auth error (or anything thrown) to an ErrorCode. */
export function authErrorCode(error: unknown): ErrorCode {
  if (isAuthRetryableFetchError(error)) {
    // Status 0 means the request never got an answer (offline, DNS, CORS).
    return error.status === 0 || error.status === undefined ? 'network' : 'server'
  }
  if (isAuthError(error)) {
    const status = error.status ?? 0
    if (status >= 500) return 'server'
    if (status === 400 || status === 401 || status === 403 || status === 422) return 'unauthenticated'
    if (status === 0) return 'network'
    return 'bad_request'
  }
  return 'internal'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Signs out locally and announces it; local highlight data is never touched here. */
async function dropSession(supabase: SupabaseClient, reason: string): Promise<void> {
  log.warn('auth', 'signedOut', { code: reason })
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // Handled below: the stored session is removed either way.
  }
  // signOut keeps the stored session when its revoke call fails (offline); remove it explicitly.
  try {
    await chromeLocalStorageAdapter.removeItem(STORAGE_KEYS.sbAuth)
  } catch {
    // Nothing else can be done; the next getSession finds whatever is left.
  }
  emitChanged(SIGNED_OUT)
}

/** Returns a session that stays valid for at least REFRESH_MARGIN_MS, refreshing when needed. */
async function freshSession(supabase: SupabaseClient): Promise<Result<Session>> {
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    const code = authErrorCode(error)
    if (code === 'network' || code === 'server') return err(code, error.message)
    await dropSession(supabase, 'getSession')
    return err('unauthenticated', error.message)
  }
  const session = data.session
  if (!session) {
    emitChanged(SIGNED_OUT)
    return err('unauthenticated', 'no session')
  }
  const expiresAtMs = (session.expires_at ?? 0) * 1000
  if (expiresAtMs - Date.now() > REFRESH_MARGIN_MS) return ok(session)

  const refreshed = await supabase.auth.refreshSession(session)
  if (refreshed.error || !refreshed.data.session) {
    const code = refreshed.error ? authErrorCode(refreshed.error) : 'unauthenticated'
    // A transient failure keeps the session; the caller retries later.
    if (code === 'network' || code === 'server') return err(code, refreshed.error?.message ?? 'refresh failed')
    await dropSession(supabase, 'refresh')
    return err('unauthenticated', refreshed.error?.message ?? 'refresh returned no session')
  }
  return ok(refreshed.data.session)
}

/**
 * Runs fn with the shared client and a fresh session. Every Supabase call in the service worker
 * goes through here; an `unauthenticated` outcome is always announced as auth/changed {signedIn:false}.
 */
export async function withSession<T>(
  fn: (supabase: SupabaseClient, session: Session) => Promise<T>,
): Promise<Result<T>> {
  const supabase = await getSupabase()
  if (!supabase) return err('not_configured', 'no Supabase config')
  const session = await freshSession(supabase)
  if (!session.ok) return session
  try {
    return ok(await fn(supabase, session.data))
  } catch (e) {
    const code = e instanceof HandlerError ? e.code : authErrorCode(e)
    if (code === 'unauthenticated') emitChanged(SIGNED_OUT)
    return err(code, errorMessage(e))
  }
}

/** Reads the raw stored session; null when absent or unreadable. */
async function storedSession(): Promise<{ refresh_token?: unknown; user?: { email?: unknown } } | null> {
  try {
    const raw = await chromeLocalStorageAdapter.getItem(STORAGE_KEYS.sbAuth)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as { refresh_token?: unknown; user?: { email?: unknown } }) : null
  } catch {
    return null
  }
}

/**
 * Current sign-in state. Never emits. getSession may try a refresh when the access token is about
 * to expire; a transient (network / server) failure there keeps the user signed in as long as a
 * refresh token is still stored (D5: only an invalid refresh token means signed out).
 */
export async function getAuthState(): Promise<AuthState> {
  const supabase = await getSupabase()
  if (!supabase) return SIGNED_OUT
  const { data, error } = await supabase.auth.getSession()
  if (error) {
    const code = authErrorCode(error)
    if (code !== 'network' && code !== 'server') return SIGNED_OUT
    const stored = await storedSession()
    if (typeof stored?.refresh_token !== 'string' || stored.refresh_token === '') return SIGNED_OUT
    const email = stored.user?.email
    return { signedIn: true, email: typeof email === 'string' ? email : null }
  }
  if (!data.session) return SIGNED_OUT
  return { signedIn: true, email: data.session.user.email ?? null }
}

/** Email + password sign-in (FR26). Signup is disabled server-side (Story 2.12). */
export async function login(email: string, password: string): Promise<Result<AuthState>> {
  const supabase = await getSupabase()
  if (!supabase) return err('not_configured', 'no Supabase config')
  let release: (() => void) | null = null
  try {
    // Stop sync runs before signInWithPassword stores the new session: until the sign-in hook has
    // reconciled meta.userId, a run would push the previous account's outbox to the new account.
    release = await beforeSignInHook()
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session) {
      const code = error ? authErrorCode(error) : 'unauthenticated'
      log.info('auth', 'loginFailed', { code })
      return err(code, error?.message ?? 'no session')
    }
    try {
      await signedInHook(data.session.user.id)
    } catch (hookError) {
      // A sign-in whose local reconciliation failed must not run against the old account's data.
      log.error('auth', 'signedInHook.failed', { code: hookError instanceof Error ? hookError.name : 'unknown' })
      await dropSession(supabase, 'signedInHook')
      return err('internal', errorMessage(hookError))
    }
    const state: AuthState = { signedIn: true, email: data.session.user.email ?? email }
    log.info('auth', 'signedIn')
    // Release before announcing, so the sign-in pull requested by auth/changed listeners can run.
    release()
    release = null
    emitChanged(state)
    return ok(state)
  } catch (e) {
    return err(authErrorCode(e), errorMessage(e))
  } finally {
    // Failure paths: resume runs (the old session, if any, is still the stored one).
    release?.()
  }
}

/**
 * Changes the Supabase server (spec "login-supabase-config"). Only allowed while signed out, so no
 * account's local data is synced to another project; any session left from the previous server is
 * removed before the config is written. A different project means a different user id, so the
 * first sign-in wipe (FR39) still separates the two servers' data.
 */
export async function switchServer(write: () => Promise<void>): Promise<void> {
  if ((await getAuthState()).signedIn) throw new HandlerError('bad_request', 'sign out before changing the server')
  await chromeLocalStorageAdapter.removeItem(STORAGE_KEYS.sbAuth)
  await write()
}

/**
 * User sign-out (architecture.md "Sign-out wipe"). The installed sign-out hook removes the session
 * through the callback and wipes local data around it. A dropped session (refresh failure) never
 * comes through here, so it keeps local data (D5).
 */
export async function logout(): Promise<void> {
  const supabase = await getSupabase()
  if (!supabase) return
  await signOutHook(() => dropSession(supabase, 'logout'))
}
