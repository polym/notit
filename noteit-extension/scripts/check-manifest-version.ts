// Asserts the built dist/manifest.json is MV3 and its version matches package.json.
// Usage: node scripts/check-manifest-version.ts (run after `vite build`)
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
const manifestPath = resolve('dist/manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
  manifest_version: number
  version: string
}

const errors: string[] = []
if (manifest.manifest_version !== 3) {
  errors.push(`manifest_version is ${manifest.manifest_version}, expected 3`)
}
if (manifest.version !== pkg.version) {
  errors.push(`manifest version ${manifest.version} != package.json version ${pkg.version}`)
}

if (errors.length > 0) {
  console.error(`check-manifest-version: ${manifestPath}`)
  for (const e of errors) console.error(`  - ${e}`)
  process.exit(1)
}

console.log(`check-manifest-version: MV3, version ${manifest.version} matches package.json`)
