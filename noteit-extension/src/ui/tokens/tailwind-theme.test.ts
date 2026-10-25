// The side panel stylesheet wires the token theme into Tailwind 4 (Story 3.1).
// Vitest stubs CSS imports (even ?raw) in the unit project, so the stylesheets are read from disk.
// tsconfig.app.json has no Node types; this test file opts in explicitly.
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { compile } from 'tailwindcss'
import { describe, expect, it } from 'vitest'
import { tailwindThemeCss } from './css-vars.ts'

const stylesCss = readFileSync(new URL('../sidebar/styles.css', import.meta.url), 'utf8')
const tailwindIndexCss = readFileSync(createRequire(import.meta.url).resolve('tailwindcss/index.css'), 'utf8')

async function compileStyles(candidates: string[]): Promise<string> {
  const compiler = await compile(stylesCss, {
    base: '/',
    // styles.css only imports the package entry, which is self-contained (no nested @import).
    async loadStylesheet(id: string, base: string) {
      if (id !== 'tailwindcss') throw new Error(`unexpected stylesheet import: ${id}`)
      return { path: 'tailwindcss/index.css', base, content: tailwindIndexCss }
    },
  })
  return compiler.build(candidates)
}

describe('ui/sidebar/styles.css', () => {
  it('imports Tailwind and embeds exactly the generated @theme block', () => {
    expect(stylesCss).toContain('@import "tailwindcss";')
    const start = stylesCss.indexOf('@theme inline {')
    expect(start).toBeGreaterThan(-1)
    expect(stylesCss.slice(start)).toBe(tailwindThemeCss())
  })

  it('token utilities resolve to the CSS variables', async () => {
    const out = await compileStyles([
      'bg-background',
      'text-muted-foreground',
      'bg-highlight-yellow',
      'rounded-md',
      'font-sans',
    ])
    expect(out).toMatch(/\.bg-background\s*\{\s*background-color:\s*var\(--background\);/)
    expect(out).toMatch(/\.text-muted-foreground\s*\{\s*color:\s*var\(--muted-foreground\);/)
    expect(out).toMatch(/\.bg-highlight-yellow\s*\{\s*background-color:\s*var\(--nt-highlight-yellow\);/)
    expect(out).toMatch(/\.rounded-md\s*\{\s*border-radius:\s*var\(--nt-radius-md\);/)
    expect(out).toMatch(/\.font-sans\s*\{\s*font-family:\s*var\(--nt-font-family\);/)
  })
})
