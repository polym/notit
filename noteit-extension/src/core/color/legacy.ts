// Legacy color value -> ColorName mapping (architecture.md Q50).
// Shared by the migration script and every legacy read path; do not duplicate.
import type { ColorName } from '../model/index.ts'

type Rgb = readonly [number, number, number]

interface LegacyColor {
  hex: string
  rgb: Rgb
  name: ColorName
}

/** The five legacy palette values. #e1bee7 (old "comment" purple) maps to yellow. */
export const LEGACY_COLORS: readonly LegacyColor[] = [
  { hex: '#ffeb3b', rgb: [0xff, 0xeb, 0x3b], name: 'yellow' },
  { hex: '#a5d6a7', rgb: [0xa5, 0xd6, 0xa7], name: 'green' },
  { hex: '#90caf9', rgb: [0x90, 0xca, 0xf9], name: 'blue' },
  { hex: '#ef9a9a', rgb: [0xef, 0x9a, 0x9a], name: 'orange' },
  { hex: '#e1bee7', rgb: [0xe1, 0xbe, 0xe7], name: 'yellow' },
]

const FALLBACK: ColorName = 'yellow'

// rgb(r, g, b) or rgba(r, g, b, a) with integer channels; alpha is ignored.
const RGB_PATTERN = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+%?\s*)?\)$/

function parseRgb(value: string): Rgb | null {
  const match = RGB_PATTERN.exec(value)
  if (!match) return null
  const channels = [Number(match[1]), Number(match[2]), Number(match[3])] as const
  return channels.every((c) => c <= 255) ? channels : null
}

function nearest(rgb: Rgb): ColorName {
  let best = LEGACY_COLORS[0]
  let bestDistance = Infinity
  for (const candidate of LEGACY_COLORS) {
    const distance =
      (rgb[0] - candidate.rgb[0]) ** 2 + (rgb[1] - candidate.rgb[1]) ** 2 + (rgb[2] - candidate.rgb[2]) ** 2
    // Strict comparison keeps the earlier palette entry on ties, so results are deterministic.
    if (distance < bestDistance) {
      best = candidate
      bestDistance = distance
    }
  }
  return best.name
}

/**
 * Map a legacy stored color value to a ColorName.
 * Exact legacy hex values map directly (case-insensitive); rgb()/rgba() values map to the
 * nearest legacy value by RGB Euclidean distance; anything else returns 'yellow'.
 */
export function legacyColorToName(value: string | null | undefined): ColorName {
  if (typeof value !== 'string') return FALLBACK
  const normalized = value.trim().toLowerCase()
  if (normalized === '') return FALLBACK
  const exact = LEGACY_COLORS.find((c) => c.hex === normalized)
  if (exact) return exact.name
  const rgb = parseRgb(normalized)
  return rgb ? nearest(rgb) : FALLBACK
}

/**
 * CSS color used to paint a ColorName with the legacy in-page renderer (first legacy palette
 * entry with that name). Only the pre-M2 UI needs this; M2 paints from design tokens.
 */
export function legacyHexForName(name: ColorName): string {
  const entry = LEGACY_COLORS.find((c) => c.name === name)
  return entry ? entry.hex : LEGACY_COLORS[0].hex
}
