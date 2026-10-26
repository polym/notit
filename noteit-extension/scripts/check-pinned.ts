// Fails when any dependency in package.json is not pinned to an exact version.
// Usage: node scripts/check-pinned.ts [path/to/package.json]
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const DEP_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const

// Exact semver only: MAJOR.MINOR.PATCH with optional prerelease/build metadata.
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/

const pkgPath = resolve(process.argv[2] ?? 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>

const violations: string[] = []
for (const field of DEP_FIELDS) {
  const deps = pkg[field] as Record<string, string> | undefined
  if (!deps) continue
  for (const [name, spec] of Object.entries(deps)) {
    if (!EXACT_VERSION.test(spec)) {
      violations.push(`${field}: ${name}@${spec}`)
    }
  }
}

if (violations.length > 0) {
  console.error(`check-pinned: non-exact versions in ${pkgPath}:`)
  for (const v of violations) console.error(`  - ${v}`)
  process.exit(1)
}

console.log(`check-pinned: all dependency versions in ${pkgPath} are exact`)
