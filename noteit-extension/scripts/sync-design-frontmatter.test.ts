// The committed DESIGN.md frontmatter copy must match the UX source when it is present (Story 3.1).
// In CI _bmad-output/ is absent (gitignored), so the comparison is skipped there.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DESIGN_MD, extractFrontmatter, FRONTMATTER_COPY } from './sync-design-frontmatter.ts'

describe('design-frontmatter.md', () => {
  it('is committed and starts with a frontmatter block', () => {
    expect(readFileSync(FRONTMATTER_COPY, 'utf8')).toMatch(/^---\n[\s\S]*?\n---\n/)
  })

  it.skipIf(!existsSync(DESIGN_MD))('matches the DESIGN.md frontmatter', () => {
    expect(readFileSync(FRONTMATTER_COPY, 'utf8')).toBe(extractFrontmatter(readFileSync(DESIGN_MD, 'utf8')))
  })

  it('rejects a document without frontmatter', () => {
    expect(() => extractFrontmatter('# no frontmatter\n')).toThrow(/frontmatter not found/)
  })
})
