// Story 3.3 module boundary check (FR25, NFR24): adding a side panel module must not change
// src/features/highlight. The fake second module lives only under tests/sidebar/features/fake and is
// injected by tests/sidebar/shell.browser.test.tsx. This script snapshots src/features/highlight
// (relative path + SHA-256 of every file, tracked or not) before and after that browser test and fails
// if the snapshot differs, or if the fake module leaked into src/features. The assertion is tied to the
// act of adding the fake module, so it holds on a clean checkout as well as on a dirty working tree.
// Usage: node scripts/check-highlight-untouched.ts
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(import.meta.dirname, '..')
const HIGHLIGHT_DIR = join(ROOT, 'src/features/highlight')
const FAKE_MODULE_DIR = join(ROOT, 'tests/sidebar/features/fake')
const LEAKED_FAKE_DIR = join(ROOT, 'src/features/fake')
const BOUNDARY_TEST = 'tests/sidebar/shell.browser.test.tsx'

/** Sorted `path sha256` lines for every file under dir. */
export function snapshotDir(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) {
        const hash = createHash('sha256').update(readFileSync(full)).digest('hex')
        out.push(`${relative(dir, full)} ${hash}`)
      }
    }
  }
  walk(dir)
  return out.sort()
}

/** Lines present in only one of the two snapshots, prefixed with - (before) or + (after). */
export function diffSnapshots(before: string[], after: string[]): string[] {
  const a = new Set(before)
  const b = new Set(after)
  return [...before.filter((l) => !b.has(l)).map((l) => `- ${l}`), ...after.filter((l) => !a.has(l)).map((l) => `+ ${l}`)]
}

function fail(message: string): number {
  console.error(`check-highlight-untouched: ${message}`)
  return 1
}

function main(): number {
  if (!existsSync(HIGHLIGHT_DIR)) return fail(`${HIGHLIGHT_DIR} does not exist`)
  if (!existsSync(join(FAKE_MODULE_DIR, 'index.ts'))) return fail(`fake module missing at ${FAKE_MODULE_DIR}`)
  if (existsSync(LEAKED_FAKE_DIR)) return fail('fake module must live under tests/, found src/features/fake')

  const before = snapshotDir(HIGHLIGHT_DIR)
  const run = spawnSync('npx', ['vitest', 'run', '--project', 'browser', BOUNDARY_TEST], {
    cwd: ROOT,
    stdio: 'inherit',
  })
  if (run.status !== 0) return fail(`${BOUNDARY_TEST} failed`)
  const after = snapshotDir(HIGHLIGHT_DIR)

  const changes = diffSnapshots(before, after)
  if (changes.length) return fail(`src/features/highlight changed while adding the fake module:\n${changes.join('\n')}`)
  if (existsSync(LEAKED_FAKE_DIR)) return fail('fake module leaked into src/features/fake')

  console.log(`check-highlight-untouched: src/features/highlight unchanged (${after.length} files) with the fake module added`)
  return 0
}

// Only run when executed directly, so tests can import the helpers.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main())
}
