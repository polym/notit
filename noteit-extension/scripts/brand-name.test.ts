// Brand guard for the NoteIt -> QingMark rename: no tracked file may use the old name, except for the
// identifiers listed in ALLOWED, each of which is kept on purpose.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(import.meta.dirname, '../..')

/** Tracked paths that are not scanned. */
const EXCLUDED_PATHS = [
  // Planning history and the BMAD framework keep their original wording.
  /^_bmad(-output)?\//,
  // Past test reports describe the product as it was named then.
  /^test-reports\//,
  // Captured web pages used as anchoring test input, not product copy.
  /^noteit-extension\/tests\/corpus\/[^/]+\/page\.html$/,
  // Generated copy of the historical UX DESIGN.md frontmatter (scripts/sync-design-frontmatter.ts).
  /^noteit-extension\/src\/ui\/tokens\/design-frontmatter\.md$/,
  /\.(png|jpe?g|gif|ico|webp|woff2?|zip)$/,
]

/** Old-name occurrences that are allowed, with the reason each one is kept. */
const ALLOWED: { pattern: RegExp; reason: string }[] = [
  { pattern: /noteit-extension/g, reason: 'directory name; renamed in its own follow-up change' },
  { pattern: /github\.com\/polym\/notit\b|\/notit\.git|cd notit\//g, reason: 'repository name; renamed on GitHub after this change' },
  { pattern: /ux-noteit-/g, reason: 'path of the gitignored UX planning artifacts' },
  { pattern: /noteit\/local-ids/g, reason: 'persisted export kind; older export files must still parse' },
  { pattern: /data-noteit-inlined/g, reason: 'attribute baked into the committed corpus pages' },
  { pattern: /(['"])noteit\1/g, reason: 'IndexedDB database name; renaming would orphan local data' },
  { pattern: /NoteIt era/g, reason: 'comments explaining the kept identifiers above' },
]

const OLD_NAME = /note\s?it|notit/i

function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8' })
  return out.split('\n').filter((path) => path !== '' && !EXCLUDED_PATHS.some((re) => re.test(path)))
}

describe('brand name', () => {
  it('uses QingMark everywhere except the allowed identifiers', () => {
    const hits: string[] = []
    for (const path of trackedFiles()) {
      const lines = readFileSync(resolve(REPO_ROOT, path), 'utf8').split('\n')
      lines.forEach((line, index) => {
        const rest = ALLOWED.reduce((text, { pattern }) => text.replace(pattern, ''), line)
        if (OLD_NAME.test(rest)) hits.push(`${path}:${index + 1}: ${line.trim()}`)
      })
    }
    expect(hits).toEqual([])
  })
})
