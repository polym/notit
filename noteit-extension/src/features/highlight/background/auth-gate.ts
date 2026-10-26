// Login gate of the highlight feature (architecture.md D5 "login gate", FR27, Q47).
// The sign-in source is injected by the service worker entry, so this feature never imports
// core/auth (and so supabase-js) itself; until it is set, everyone counts as signed out.
import { HandlerError, type Handlers, type RequestMap } from '../../../core/messaging/index.ts'

type SignedInSource = () => Promise<boolean>

let source: SignedInSource = async () => false
// Last known answer, for callers that must not await (chrome.sidePanel.open needs the user gesture).
// null until the first read finishes (a command can wake the worker before that).
let cached: boolean | null = null
// Called when a read finds a state that differs from the known one (for example a session that
// expired or was revoked without core/auth emitting auth/changed), so open tabs can be told.
let changeListener: ((signedIn: boolean) => void) | null = null

/** Sets the function that reads the current sign-in state (entries/background wires core/auth). */
export function setSignedInSource(next: SignedInSource): void {
  source = next
}

/** Sets the listener for sign-in changes found by isSignedIn() (entries/background broadcasts them). */
export function setSignedInChangeListener(next: ((signedIn: boolean) => void) | null): void {
  changeListener = next
}

/** Reads the current sign-in state and refreshes the cached value. Errors count as signed out. */
export async function isSignedIn(): Promise<boolean> {
  let value: boolean
  try {
    value = await source()
  } catch (error) {
    console.error('[NoteIt] Failed to read sign-in state:', error)
    value = false
  }
  const previous = cached
  cached = value
  // The first read only warms the cache: tabs got their state from page/getState already.
  if (previous !== null && previous !== value) changeListener?.(value)
  return value
}

/** Last known sign-in state without awaiting; null before the first read finished. */
export function cachedSignedIn(): boolean | null {
  return cached
}

/** Records a sign-in change pushed by core/auth (auth/changed); null forgets it (tests). */
export function setCachedSignedIn(value: boolean | null): void {
  cached = value
}

/** Wraps every handler so it answers `unauthenticated` while signed out, before it runs. */
export function requireAuth<M extends RequestMap>(handlers: Handlers<M>): Handlers<M> {
  const wrapped: Record<string, (req: unknown, sender: chrome.runtime.MessageSender) => Promise<unknown>> = {}
  for (const [type, handler] of Object.entries(handlers) as Array<
    [string, (req: unknown, sender: chrome.runtime.MessageSender) => Promise<unknown>]
  >) {
    wrapped[type] = async (req, sender) => {
      if (!(await isSignedIn())) throw new HandlerError('unauthenticated', 'sign in to create or edit highlights')
      return handler(req, sender)
    }
  }
  return wrapped as Handlers<M>
}
