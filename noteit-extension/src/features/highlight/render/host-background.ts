// Dark host detection (DESIGN.md components.highlight-mark.dark-host): a highlight is painted with the
// highlight-*-on-dark overlay when what shows behind it is dark. This reads the host page's computed
// background, never a color NoteIt stored itself (architecture.md #6 forbids reading our own colors back
// from the DOM; the host page's own styles are outside that rule).
import { luminanceFromRgb } from '../../../ui/tokens/index.ts'

/** Relative luminance below which a host background counts as dark (DESIGN.md dark-host). */
export const DARK_HOST_LUMINANCE = 0.2

export interface ParsedColor {
  r: number
  g: number
  b: number
  alpha: number
}

// Computed colors always come back as rgb() / rgba(), comma or space separated.
const COMPUTED_COLOR = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/

/** First rgb() / rgba() color in a computed style value (a background-color, or a gradient's first stop). */
export function parseComputedColor(css: string): ParsedColor | null {
  const m = COMPUTED_COLOR.exec(css)
  if (!m) return null
  const raw = m[4]
  const alpha = raw === undefined ? 1 : raw.endsWith('%') ? parseFloat(raw) / 100 : parseFloat(raw)
  return { r: parseFloat(m[1]), g: parseFloat(m[2]), b: parseFloat(m[3]), alpha }
}

const isDark = (c: ParsedColor) => luminanceFromRgb(c.r, c.g, c.b) < DARK_HOST_LUMINANCE

/** Answers per element for one paint or restyle pass, so marks sharing ancestors walk them once. */
export type DarkHostCache = Map<Element, boolean>

/**
 * True when the first ancestor of `start` with an opaque background is dark. A gradient background is
 * judged by its first color stop; a url() image cannot be judged and is skipped. With no opaque
 * background anywhere, the browser canvas shows, which is dark only under a dark color-scheme.
 */
export function isOnDarkHost(start: Element | null, cache: DarkHostCache = new Map()): boolean {
  const visited: Element[] = []
  let result: boolean | undefined
  for (let el = start; el; el = el.parentElement) {
    const known = cache.get(el)
    if (known !== undefined) {
      result = known
      break
    }
    visited.push(el)
    const style = getComputedStyle(el)
    const background = parseComputedColor(style.backgroundColor)
    if (background && background.alpha >= 0.5) {
      result = isDark(background)
      break
    }
    if (style.backgroundImage.includes('gradient(')) {
      const stop = parseComputedColor(style.backgroundImage)
      if (stop && stop.alpha >= 0.5) {
        result = isDark(stop)
        break
      }
    }
  }
  if (result === undefined) result = canvasIsDark()
  for (const el of visited) cache.set(el, result)
  return result
}

function canvasIsDark(): boolean {
  const scheme = getComputedStyle(document.documentElement).colorScheme || ''
  if (!scheme.includes('dark')) return false
  // "light dark" follows the user's preference; "dark" alone is always dark.
  return !scheme.includes('light') || window.matchMedia('(prefers-color-scheme: dark)').matches
}
