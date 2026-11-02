// Message catalogue of core/auth (architecture.md D5 / D6). Type-only: safe to import anywhere.
import type { ConfigSource, SupabaseConfig } from './config.ts'

/** The active Supabase server as the side panel may see it: never the anon key. */
export interface ServerConfigState {
  url: string | null
  source: ConfigSource
  hasBuildDefault: boolean
}

export interface AuthState {
  signedIn: boolean
  email: string | null
}

export type AuthRequests = {
  'auth/login': { req: { email: string; password: string }; res: AuthState }
  'auth/logout': { req: void; res: void }
  'auth/getState': { req: void; res: AuthState }
  /** Outbox size, asked before sign-out to warn about unsynced highlights (FR29). */
  'auth/getPendingCount': { req: void; res: { pending: number } }
  /** Login page server settings (spec "login-supabase-config"); set and reset only while signed out. */
  'auth/getConfig': { req: void; res: ServerConfigState }
  'auth/setConfig': { req: SupabaseConfig; res: { url: string; source: 'user' } }
  'auth/resetConfig': { req: void; res: { url: string | null; source: 'build' | 'none' } }
  'auth/testConfig': { req: SupabaseConfig; res: { reachable: true } }
}

export type AuthEvents = {
  'auth/changed': AuthState
}
