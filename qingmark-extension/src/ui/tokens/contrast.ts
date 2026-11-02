// WCAG 2.x relative luminance and contrast ratio (NFR21). relativeLuminance / contrastRatio take opaque
// hex token values; luminanceFromRgb takes 0-255 channels, for callers that already parsed a color.

function channel(byte: number): number {
  const c = Math.min(255, Math.max(0, byte)) / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** Relative luminance of 0-255 sRGB channels. */
export function luminanceFromRgb(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** Relative luminance of a #RGB or #RRGGBB color. */
export function relativeLuminance(hex: string): number {
  let h = hex.replace(/^#/, '')
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`relativeLuminance: expected opaque hex color, got ${hex}`)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return luminanceFromRgb(r, g, b)
}

/** Contrast ratio between two opaque colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
