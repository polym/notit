// Dark host detection helpers (DESIGN.md components.highlight-mark.dark-host). DOM walking is covered by
// mark-renderer.browser.test.ts; this file checks parsing and that the threshold matches DESIGN.md.
import { describe, expect, it } from 'vitest'
import designMarkdown from '../../../ui/tokens/design-frontmatter.md?raw'
import { DARK_HOST_LUMINANCE, parseComputedColor } from './host-background.ts'

describe('parseComputedColor', () => {
  it('reads comma and space separated computed colors', () => {
    expect(parseComputedColor('rgb(255, 255, 255)')).toEqual({ r: 255, g: 255, b: 255, alpha: 1 })
    expect(parseComputedColor('rgba(0, 0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, alpha: 0 })
    expect(parseComputedColor('rgb(30 30 30 / 50%)')).toEqual({ r: 30, g: 30, b: 30, alpha: 0.5 })
  })

  it('finds the first stop of a gradient', () => {
    expect(parseComputedColor('linear-gradient(rgb(28, 28, 30), rgb(255, 255, 255))')).toEqual({ r: 28, g: 28, b: 30, alpha: 1 })
  })

  it('returns null without a color', () => {
    expect(parseComputedColor('transparent')).toBeNull()
    expect(parseComputedColor('none')).toBeNull()
  })
})

it('uses the luminance threshold written in DESIGN.md', () => {
  const line = /^\s+dark-host: '([^']*)'/m.exec(designMarkdown)
  expect(line).not.toBeNull()
  expect(line![1]).toContain(`< ${DARK_HOST_LUMINANCE}`)
})
