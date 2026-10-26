// Drift check: every effect value is transcribed verbatim from the DESIGN.md frontmatter.
// {colors.x} references in the frontmatter are written as var(--nt-x) in effects.ts.
import { expect, it } from 'vitest'
import designMarkdown from './design-frontmatter.md?raw'
import { effects } from './effects.ts'

const FRONTMATTER_KEYS: Record<keyof typeof effects, [component: string, key: string]> = {
  floatingMenuShadow: ['floating-menu', 'shadow'],
  colorDotBorder: ['color-dot', 'dot-border'],
  colorDotSelectedRing: ['color-dot', 'selected-ring'],
  commentPreviewShadow: ['comment-preview', 'shadow'],
  dialogShadow: ['logout-confirm', 'shadow'],
  scrim: ['logout-confirm', 'scrim'],
}

const resolveColorRefs = (value: string) => value.replace(/\{colors\.([a-z0-9-]+)\}/g, 'var(--nt-$1)')

it.each(Object.entries(FRONTMATTER_KEYS))('%s matches components.%s', (name, [component, key]) => {
  const block = new RegExp(`\\n  ${component}:\\n((?:    .*\\n)+)`).exec(designMarkdown)
  expect(block, component).not.toBeNull()
  const line = new RegExp(`^    ${key}: '([^']*)'`, 'm').exec(block![1])
  expect(line, `${component}.${key}`).not.toBeNull()
  expect(resolveColorRefs(line![1])).toBe(effects[name as keyof typeof effects])
})
