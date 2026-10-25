// The single Supabase client of the extension; created lazily in the service worker only
// (architecture.md "Authentication & Security"). The side panel and content scripts talk to it
// through auth/* messages and never create a client themselves.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { STORAGE_KEYS, getStoredSupabaseConfig } from '../settings/index.ts'
import { validateSupabaseConfig, type ConfigSource, type SupabaseConfig } from './config.ts'
import { chromeLocalStorageAdapter } from './storage-adapter.ts'

/** Build-time config (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY, public values); null when missing. */
export function buildSupabaseConfig(): SupabaseConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (typeof url !== 'string' || url === '' || typeof anonKey !== 'string' || anonKey === '') return null
  return { url, anonKey }
}

export interface ActiveConfig {
  config: SupabaseConfig | null
  source: ConfigSource
}

/**
 * The config in use: one saved on the login page wins over the build-time one. A saved entry that
 * no longer validates (hand-edited, or rules tightened since) is ignored rather than trusted.
 */
export async function activeSupabaseConfig(): Promise<ActiveConfig> {
  const stored = await getStoredSupabaseConfig()
  if (stored) {
    const checked = validateSupabaseConfig(stored)
    if (checked.ok) return { config: checked.config, source: 'user' }
  }
  const build = buildSupabaseConfig()
  return build ? { config: build, source: 'build' } : { config: null, source: 'none' }
}

let client: SupabaseClient | null = null
let clientKey: string | null = null

/** Returns the client for the active config (rebuilt when the config changed), or null without one. */
export async function getSupabase(): Promise<SupabaseClient | null> {
  const { config } = await activeSupabaseConfig()
  if (!config) return null
  const key = `${config.url}\n${config.anonKey}`
  if (client && clientKey === key) return client
  client = createClient(config.url, config.anonKey, {
    auth: {
      storage: chromeLocalStorageAdapter,
      storageKey: STORAGE_KEYS.sbAuth,
      // Timers die with the service worker; session.ts refreshes on demand instead.
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })
  clientKey = key
  return client
}
