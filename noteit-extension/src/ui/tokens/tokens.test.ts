// Drift and contrast checks for the design tokens (Story 3.1, NFR21).
import { describe, expect, it } from 'vitest'
// Committed copy of the DESIGN.md frontmatter (_bmad-output/ is gitignored); kept in sync by
// scripts/sync-design-frontmatter.ts and checked by scripts/sync-design-frontmatter.test.ts.
import designMarkdown from './design-frontmatter.md?raw'
import { colors, fontFamily, rounded, spacing, typography } from './tokens.ts'
import { contrastRatio } from './contrast.ts'
import { cssVarsText, ntVars, shadcnVars, tailwindThemeCss } from './css-vars.ts'

type Tree = { [key: string]: Tree | string }

/** Scalar value of a YAML line: a single-quoted string, or the text before an inline comment. */
function scalar(raw: string): string {
  const text = raw.trim()
  if (text.startsWith("'")) {
    const end = text.indexOf("'", 1)
    return text.slice(1, end)
  }
  const comment = text.search(/\s#/)
  return (comment === -1 ? text : text.slice(0, comment)).trim()
}

function unquoteKey(key: string): string {
  return key.replace(/^'(.*)'$/, '$1')
}

/**
 * Minimal parser for the DESIGN.md frontmatter: nested block mappings with 2-space indentation and
 * scalar values. Lists (sources) are skipped; nothing else in the frontmatter needs more than this.
 */
function parseFrontmatter(markdown: string): Tree {
  const match = /^---\n([\s\S]*?)\n---/.exec(markdown)
  if (!match) throw new Error('DESIGN.md: frontmatter not found')
  const root: Tree = {}
  const stack: { indent: number; node: Tree }[] = [{ indent: -1, node: root }]
  for (const line of match[1].split('\n')) {
    if (/^\s*(#|$)/.test(line) || /^\s*- /.test(line)) continue
    const m = /^( *)('[^']*'|[^:]+):(.*)$/.exec(line)
    if (!m) continue
    const indent = m[1].length
    while (stack[stack.length - 1].indent >= indent) stack.pop()
    const parent = stack[stack.length - 1].node
    const key = unquoteKey(m[2].trim())
    const value = scalar(m[3])
    if (value === '') {
      const child: Tree = {}
      parent[key] = child
      stack.push({ indent, node: child })
    } else {
      parent[key] = value
    }
  }
  return root
}

function section(tree: Tree, key: string): Tree {
  const node = tree[key]
  if (typeof node !== 'object') throw new Error(`DESIGN.md: missing section ${key}`)
  return node
}

const design = parseFrontmatter(designMarkdown)

describe('tokens.ts matches the DESIGN.md frontmatter', () => {
  it('colors', () => {
    expect(colors).toEqual(section(design, 'colors'))
  })

  it('typography', () => {
    const expected = section(design, 'typography')
    const bodyFont = section(expected, 'body').fontFamily
    expect(fontFamily).toBe(bodyFont)
    const resolved = Object.fromEntries(
      Object.entries(expected).map(([name, t]) => {
        const entry = { ...(t as Tree) }
        if (entry.fontFamily === '{typography.body.fontFamily}') entry.fontFamily = bodyFont
        return [name, entry]
      }),
    )
    expect(typography).toEqual(resolved)
  })

  it('rounded', () => {
    expect(rounded).toEqual(section(design, 'rounded'))
  })

  it('spacing', () => {
    expect(spacing).toEqual(section(design, 'spacing'))
  })
})

describe('contrast (NFR21)', () => {
  const pairs: [fg: keyof typeof colors, bg: keyof typeof colors, min: number][] = [
    ['foreground', 'background', 4.5],
    ['foreground', 'hover', 4.5],
    ['foreground', 'selected', 4.5],
    ['muted-foreground', 'background', 4.5],
    ['muted-foreground', 'hover', 4.5],
    ['muted-foreground', 'selected', 4.5],
    ['subtle-foreground', 'background', 4.5],
    ['subtle-foreground', 'hover', 4.5],
    // Side panel surface.
    ['foreground', 'canvas', 4.5],
    ['muted-foreground', 'canvas', 4.5],
    ['subtle-foreground', 'canvas', 4.5],
    ['primary-foreground', 'primary', 4.5],
    ['warning', 'background', 3],
    // Focus rings are non-text UI: 3:1 against the surface they sit on.
    ['ring', 'background', 3],
    ['ring', 'hover', 3],
    ['ring', 'canvas', 3],
    ['ring-inverse', 'foreground', 3],
  ]
  it.each(pairs)('%s on %s >= %d:1', (fg, bg, min) => {
    expect(contrastRatio(colors[fg], colors[bg])).toBeGreaterThanOrEqual(min)
  })

})

describe('css-vars', () => {
  it('declares one --nt-* variable per color token, with the token value', () => {
    const vars = ntVars()
    for (const [name, value] of Object.entries(colors)) expect(vars[`--nt-${name}`]).toBe(value)
  })

  it('declares typography, radius and spacing variables', () => {
    const vars = ntVars()
    expect(vars['--nt-font-family']).toBe(fontFamily)
    expect(vars['--nt-body-font-size']).toBe('13px')
    expect(vars['--nt-group-heading-font-weight']).toBe('600')
    expect(vars['--nt-radius']).toBe('8px')
    expect(vars['--nt-radius-xs']).toBe('4px')
    expect(vars['--nt-radius-lg']).toBe('18px')
    expect(vars['--nt-space-0-5']).toBe('2px')
    expect(vars['--nt-space-panel-width']).toBe('360px')
    for (const name of Object.keys(vars)) expect(name).toMatch(/^--nt-[a-z0-9-]+$/)
  })

  it('shadcn and Tailwind theme only reference variables, never raw values', () => {
    for (const value of Object.values(shadcnVars())) expect(value).toMatch(/^var\(--nt-[a-z0-9-]+\)$/)
    const theme = tailwindThemeCss()
    expect(theme.startsWith('@theme inline {')).toBe(true)
    for (const line of theme.split('\n').filter((l) => l.includes(':'))) {
      expect(line).toMatch(/: var\(--[a-z0-9-]+\);$/)
    }
    expect(theme).toContain('--color-background: var(--background);')
    expect(theme).toContain('--color-highlight-yellow: var(--nt-highlight-yellow);')
    expect(theme).toContain('--radius-md: var(--nt-radius-md);')
  })

  it('renders a stylesheet for a selector', () => {
    const host = cssVarsText(':host')
    expect(host.startsWith(':host {\n')).toBe(true)
    expect(host).toContain('  --nt-warning: #B7791F;')
    expect(host).not.toContain('--background:')
    expect(cssVarsText(':root', { shadcn: true })).toContain('  --background: var(--nt-background);')
  })
})
