// Proves that every architecture lint rule is active.
// Each file in tests/lint-fixtures/src starts with a header comment:
//   // expect: none                 -> no lint messages at all
//   // expect: error <ruleId>       -> only <ruleId>, reported as an error
//   // expect: warn <ruleId>        -> only <ruleId>, reported as a warning
// Usage: node scripts/test-lint-rules.ts
import { readFileSync, globSync } from 'node:fs'
import { resolve } from 'node:path'
import { ESLint } from 'eslint'

const FIXTURE_ROOT = resolve('tests/lint-fixtures')
const HEADER = /^\/\/ expect: (none|(error|warn) (\S+))\s*$/m

const files = globSync('src/**/*.{ts,tsx}', { cwd: FIXTURE_ROOT }).map((f) => resolve(FIXTURE_ROOT, f)).sort()
if (files.length === 0) {
  console.error('test:lint-rules: no fixtures found')
  process.exit(1)
}

// Fixtures are globally ignored by `npm run lint`; lint them here explicitly.
const eslint = new ESLint({ ignore: false })
const results = await eslint.lintFiles(files)

const failures: string[] = []
const covered = new Set<string>()
for (const result of results) {
  const rel = result.filePath.slice(FIXTURE_ROOT.length + 1)
  const header = HEADER.exec(readFileSync(result.filePath, 'utf8'))
  if (!header) {
    failures.push(`${rel}: missing "// expect:" header`)
    continue
  }
  const actual = result.messages.map((m) => `${m.severity === 2 ? 'error' : 'warn'} ${m.ruleId ?? `fatal: ${m.message}`}`)
  if (header[1] === 'none') {
    if (actual.length > 0) failures.push(`${rel}: expected no messages, got [${actual.join(', ')}]`)
    continue
  }
  const expected = `${header[2]} ${header[3]}`
  if (actual.length === 0 || actual.some((a) => a !== expected)) {
    failures.push(`${rel}: expected only "${expected}", got [${actual.join(', ')}]`)
    continue
  }
  covered.add(header[3])
}

// Every restricted rule required by architecture.md must have at least one passing fixture.
const REQUIRED_RULES = [
  'boundaries/dependencies',
  'no-restricted-imports',
  'no-restricted-syntax',
  '@typescript-eslint/no-explicit-any',
  '@typescript-eslint/no-floating-promises',
  'noteit/no-raw-url-compare',
  'noteit/no-import-cycle',
  'noteit/no-raw-color',
  'noteit/no-cjk-literal',
  'noteit/no-raw-text-offset',
]
for (const rule of REQUIRED_RULES) {
  if (!covered.has(rule)) failures.push(`rule ${rule}: no passing fixture`)
}

if (failures.length > 0) {
  console.error(`test:lint-rules: ${failures.length} failure(s)`)
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`test:lint-rules: ${results.length} fixtures passed, rules covered: ${[...covered].sort().join(', ')}`)
