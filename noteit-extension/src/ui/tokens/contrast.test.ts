// WCAG luminance and contrast helpers (NFR21). Token pair checks live in tokens.test.ts.
import { describe, expect, it } from 'vitest'
import { contrastRatio, luminanceFromRgb, relativeLuminance } from './contrast.ts'

describe('contrast', () => {
  it('computes known WCAG ratios', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5)
    expect(contrastRatio('#FFF', '#FFFFFF')).toBeCloseTo(1, 5)
  })

  it('gives the same luminance from channels and from hex', () => {
    expect(luminanceFromRgb(255, 255, 255)).toBe(1)
    expect(luminanceFromRgb(0, 0, 0)).toBe(0)
    expect(luminanceFromRgb(30, 30, 30)).toBeCloseTo(relativeLuminance('#1E1E1E'), 10)
    expect(luminanceFromRgb(300, -5, 0)).toBe(luminanceFromRgb(255, 0, 0))
  })

  it('rejects non-hex input', () => {
    expect(() => relativeLuminance('rgb(0,0,0)')).toThrow()
  })
})
