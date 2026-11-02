// Manual per-site enable overrides (architecture.md D8). Keys are siteKey() values from core/url.
// Stored locally only; writes happen in the service worker (single writer rule).
import { STORAGE_KEYS } from './keys.ts'

export type SiteOverride = 'on' | 'off'
export type SiteOverrides = Record<string, SiteOverride>

function sanitize(value: unknown): SiteOverrides {
  const out: SiteOverrides = {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return out
  for (const [site, state] of Object.entries(value)) {
    if (state === 'on' || state === 'off') out[site] = state
  }
  return out
}

export async function getSiteOverrides(): Promise<SiteOverrides> {
  const key = STORAGE_KEYS.siteOverrides
  const items = await chrome.storage.local.get(key)
  return sanitize(items[key])
}

export async function getSiteOverride(siteKey: string): Promise<SiteOverride | null> {
  const all = await getSiteOverrides()
  return Object.hasOwn(all, siteKey) ? all[siteKey] : null
}

// Serializes writes: setSiteOverride is a read-modify-write, so overlapping calls from
// concurrent SW message handlers would otherwise lose updates (last write wins).
let chain: Promise<void> = Promise.resolve()

function enqueue(op: () => Promise<void>): Promise<void> {
  const p = chain.then(op)
  // Keep the chain alive after a failed op; the caller still sees the rejection via p.
  chain = p.catch(() => {})
  return p
}

/** Sets the override for one site; null removes it (back to the "has highlights" default). */
export function setSiteOverride(siteKey: string, state: SiteOverride | null): Promise<void> {
  return enqueue(async () => {
    const all = await getSiteOverrides()
    if (state === null) delete all[siteKey]
    else all[siteKey] = state
    await chrome.storage.local.set({ [STORAGE_KEYS.siteOverrides]: all })
  })
}

/**
 * Removes the pre-M1 keys (highlights, enabledSites) left by the legacy extension (first sign-in
 * wipe, FR39). Serialized with override writes because the wipe also clears siteOverrides.
 */
export function removeLegacyKeys(): Promise<void> {
  return enqueue(async () => {
    await chrome.storage.local.remove([STORAGE_KEYS.legacyHighlights, STORAGE_KEYS.legacyEnabledSites])
  })
}

/** Removes every override (sign-out and first sign-in wipe). */
export function clearSiteOverrides(): Promise<void> {
  return enqueue(async () => {
    await chrome.storage.local.remove(STORAGE_KEYS.siteOverrides)
  })
}
