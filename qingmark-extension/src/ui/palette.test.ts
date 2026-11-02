// Shared highlight palette (DESIGN.md "Colors"): order, text names, solid and overlay tokens.
import { describe, expect, it } from 'vitest'
import { COLOR_NAMES } from '../core/model/index.ts'
import { colors } from './tokens/index.ts'
import { strings } from './strings.ts'
import { COLOR_ORDER, colorLabel, overlayColor, solidColorVar, solidToken } from './palette.ts'

describe('palette', () => {
  it('orders the dots yellow first (DESIGN.md floating-menu), same list as the data model', () => {
    expect(COLOR_ORDER).toEqual(['yellow', 'orange', 'blue', 'green'])
    expect(COLOR_ORDER).toBe(COLOR_NAMES)
  })

  it('names every color', () => {
    expect(COLOR_ORDER.map(colorLabel)).toEqual([strings.colorYellow, strings.colorOrange, strings.colorBlue, strings.colorGreen])
  })

  it('paints marks with the overlay tokens and dots with the solid tokens', () => {
    for (const c of COLOR_ORDER) {
      expect(overlayColor(c)).toBe(colors[`highlight-${c}`])
      expect(overlayColor(c, true)).toBe(colors[`highlight-${c}-on-dark`])
      expect(solidToken(c)).toBe(`highlight-${c}-solid`)
      expect(solidColorVar(c)).toBe(`var(--nt-highlight-${c}-solid)`)
    }
  })

  it('falls back to yellow for unknown names', () => {
    expect(overlayColor('purple')).toBe(colors['highlight-yellow'])
    expect(overlayColor('purple', true)).toBe(colors['highlight-yellow-on-dark'])
    expect(colorLabel('')).toBe(strings.colorYellow)
  })
})
