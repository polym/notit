// Highlight palette shared by the side panel (React), the in-page overlays (Preact) and the host-page
// renderers (DESIGN.md "Colors"): colors are stored by name, painted from the tokens, and always carry
// their text name. Framework-free so both UI trees import the same module. The color-dot border and
// selected ring live in tokens/effects.ts with the other component effects.
import { COLOR_NAMES, isColorName, type ColorName } from '../core/model/index.ts'
import { colors, ntColor } from './tokens/index.ts'
import { strings } from './strings.ts'

/** Color dot order everywhere (DESIGN.md floating-menu: yellow first). */
export const COLOR_ORDER: readonly ColorName[] = COLOR_NAMES

const LABEL: Record<ColorName, string> = {
  yellow: strings.colorYellow,
  orange: strings.colorOrange,
  blue: strings.colorBlue,
  green: strings.colorGreen,
}

/** Unknown values fall back to the default color, like the legacy mapping (Q50). */
const known = (color: string): ColorName => (isColorName(color) ? color : 'yellow')

/** Text name of a color (hover name and accessible name). */
export const colorLabel = (color: string): string => LABEL[known(color)]

/** Solid color token name (highlight-*-solid) for dots and sidebar color marks. */
export const solidToken = (color: string) => `highlight-${known(color)}-solid` as const

/** var(--nt-highlight-*-solid) reference, for inline styles inside either UI tree. */
export const solidColorVar = (color: string): string => ntColor(solidToken(color))

/**
 * Transparent overlay color painted on the host page (highlight-*, or highlight-*-on-dark on a dark
 * host). A literal value, not a CSS variable: marks live in the host document, outside the trees that
 * declare --nt-*.
 */
export const overlayColor = (color: string, onDark = false): string => {
  const c = known(color)
  return onDark ? colors[`highlight-${c}-on-dark`] : colors[`highlight-${c}`]
}
