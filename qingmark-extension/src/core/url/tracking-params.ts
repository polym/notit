// Query parameters removed by canonicalUrl (EXPERIENCE.md "Page and site identity", Q3).
// Entries ending in "*" are prefixes; all other entries match the parameter name exactly.
export const TRACKING_PARAMS: readonly string[] = [
  'utm_*',
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'igshid',
  'ref_src',
  'spm',
]

/** Returns true when the (decoded) query parameter name is a tracking parameter. */
export function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase()
  return TRACKING_PARAMS.some((p) => (p.endsWith('*') ? key.startsWith(p.slice(0, -1)) : key === p))
}
