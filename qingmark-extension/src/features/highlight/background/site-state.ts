// Site enable state (architecture.md D8, FR18, FR19). Keys are siteKey() values, so the switch
// applies to a whole site (www.example.com and example.com share one key) and never to a full URL.
// Overrides live only in chrome.storage.local and never enter a sync payload.
// site/setEnabled stays in handlers.ts: badge.ts imports this file, so importing badge here would form a cycle.
import { read } from '../../../core/db/read.ts'
import { getSiteOverride, setSiteOverride, type SiteOverride } from '../../../core/settings/index.ts'

/** D8: enabled = override 'on' || (override !== 'off' && hasHighlights(siteKey)). */
export function siteEnabledRule(override: SiteOverride | null, hasHighlights: boolean): boolean {
  return override === 'on' || (override !== 'off' && hasHighlights)
}

export async function isSiteEnabled(siteKey: string): Promise<boolean> {
  const override = await getSiteOverride(siteKey)
  // The db is read only when the override does not decide on its own.
  if (override !== null) return siteEnabledRule(override, false)
  return siteEnabledRule(null, await read.hasLiveForSite(siteKey))
}

/**
 * Writes 'on' when the site is not enabled yet (shortcut / context menu on a closed site, Q41, Q58).
 * Returns true when it wrote the override, so the caller can broadcast site/changed.
 */
export async function ensureSiteEnabled(siteKey: string): Promise<boolean> {
  if (await isSiteEnabled(siteKey)) return false
  await setSiteOverride(siteKey, 'on')
  return true
}
