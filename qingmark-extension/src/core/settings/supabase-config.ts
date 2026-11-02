// Supabase config saved on the login page (spec "login-supabase-config"). Local only, never synced,
// and kept across sign-out and the first sign-in wipe; only "restore default" removes it. The value
// is returned raw: core/auth validates it before use, so a hand-edited entry cannot slip through.
import { STORAGE_KEYS } from './keys.ts'

export interface StoredSupabaseConfig {
  url: unknown
  anonKey: unknown
}

export async function getStoredSupabaseConfig(): Promise<StoredSupabaseConfig | null> {
  const key = STORAGE_KEYS.supabaseConfig
  const items = await chrome.storage.local.get(key)
  const value: unknown = items[key]
  if (typeof value !== 'object' || value === null) return null
  const { url, anonKey } = value as Record<string, unknown>
  return { url, anonKey }
}

export async function setStoredSupabaseConfig(config: { url: string; anonKey: string }): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.supabaseConfig]: { url: config.url, anonKey: config.anonKey, savedAt: Date.now() } })
}

export async function clearStoredSupabaseConfig(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.supabaseConfig)
}
