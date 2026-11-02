// Every chrome.storage.local key used by the extension (architecture.md "Chrome storage key").
// No other file may write a storage key literal; import from here instead.
export const STORAGE_KEYS = {
  /** Stable per-install id used as the LWW tie-breaker; generated once, kept on sign-out. */
  deviceId: 'deviceId',
  /** Record<siteKey, 'on' | 'off'>; local only, never synced (D8). */
  siteOverrides: 'siteOverrides',
  /** Supabase session, read and written only by core/auth/storage-adapter.ts (D5). */
  sbAuth: 'sb-auth',
  /** Supabase {url, anonKey, savedAt} saved on the login page; overrides the build-time config. */
  supabaseConfig: 'supabaseConfig',
  /**
   * Translation provider {baseUrl, apiKey, model, savedAt}; local only, never synced, kept across
   * sign-out (it belongs to the device, not the account). Read only by the service worker.
   */
  translateConfig: 'translateConfig',
  /** chrome.storage.session mirror of the translation LRU cache; cleared when the browser restarts. */
  translateCache: 'translateCache',
  /** Legacy keys from the pre-M1 extension; deleted by the first sign-in wipe (FR39). */
  legacyHighlights: 'highlights',
  legacyEnabledSites: 'enabledSites',
} as const

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS]
