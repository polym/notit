// Single source of truth for "same page" and "same site" (FR16, FR17).
// Every caller must use these functions instead of comparing raw URLs.
import { isTrackingParam } from './tracking-params.ts'

export { TRACKING_PARAMS, isTrackingParam } from './tracking-params.ts'

function parseHttpUrl(url: string): URL | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null
}

function paramName(pair: string): string {
  const raw = pair.split('=', 1)[0].replace(/\+/g, ' ')
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Page identity: the URL without hash and tracking parameters. Other query parameters keep
 * their original order and encoding; an empty query leaves no "?". The host name is lowercased
 * by URL parsing. Returns null for non-http(s) or unparsable URLs.
 */
export function canonicalUrl(url: string): string | null {
  const parsed = parseHttpUrl(url)
  if (!parsed) return null
  // Filter the raw search string rather than URLSearchParams so untouched pairs are not re-encoded.
  const kept = parsed.search
    .slice(1)
    .split('&')
    .filter((pair) => pair !== '' && !isTrackingParam(paramName(pair)))
  const query = kept.length > 0 ? `?${kept.join('&')}` : ''
  return `${parsed.origin}${parsed.pathname}${query}`
}

/**
 * Site identity: the host name with a leading "www." removed. Other subdomains are distinct
 * sites. Returns null for non-http(s) or unparsable URLs.
 */
export function siteKey(url: string): string | null {
  const parsed = parseHttpUrl(url)
  if (!parsed) return null
  return parsed.hostname.replace(/^www\./, '')
}
