// Static import-graph check: supabase-js lives only in the service worker (core/auth, Story 2.14);
// the side panel and content script reach it only through auth/* messages.
import { describe, expect, it } from 'vitest'

// Raw sources of every module under src/, keyed by root-relative path ("/src/...").
const SOURCES = import.meta.glob<string>(['/src/**/*.ts', '/src/**/*.tsx', '!/src/**/*.test.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(?\s*['"]([^'"]+)['"]/g

function collect(entry: string): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop() as string
    if (files.has(file)) continue
    const resolved = [file, `${file}.ts`, `${file}.tsx`, `${file}/index.ts`].find((f) => SOURCES[f] !== undefined)
    if (resolved === undefined) throw new Error(`unresolved module ${file}`)
    if (files.has(resolved)) continue
    const source = SOURCES[resolved]
    files.add(resolved)
    for (const m of source.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2]
      // Stylesheets (side panel Tailwind entry, Story 3.1) have no JS imports to follow.
      if (spec.endsWith('.css')) continue
      if (spec.startsWith('.')) queue.push(new URL(spec, `file://${resolved}`).pathname)
      else packages.add(spec)
    }
  }
  return { files, packages }
}

describe('entries/background', () => {
  it('creates the Supabase client in the service worker graph', () => {
    const { files, packages } = collect('/src/entries/background/index.ts')
    expect(files.size).toBeGreaterThan(5)
    expect(packages.has('@supabase/supabase-js')).toBe(true)
    expect(packages.has('dexie')).toBe(true)
  })

  it.each(['/src/entries/sidepanel/main.tsx', '/src/content/index.ts'])('%s does not import @supabase/*', (entry) => {
    const { files, packages } = collect(entry)
    expect(files.size).toBeGreaterThan(2)
    expect([...packages].filter((p) => p.startsWith('@supabase/'))).toEqual([])
  })
})
