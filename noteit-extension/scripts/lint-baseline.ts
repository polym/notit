// Tracks lint warning counts so they can only decrease.
// Usage:
//   node scripts/lint-baseline.ts           -> fail if any (file, rule) warning count exceeds lint-baseline.json
//   node scripts/lint-baseline.ts --update  -> rewrite lint-baseline.json from the current lint result
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { ESLint } from 'eslint'

type Counts = Record<string, Record<string, number>>
interface Baseline {
  total: number
  byRule: Record<string, number>
  byFile: Counts
}

const BASELINE_PATH = resolve('lint-baseline.json')
const update = process.argv.includes('--update')

const results = await new ESLint().lintFiles(['.'])

const byFile: Counts = {}
const byRule: Record<string, number> = {}
let total = 0
let errors = 0
for (const result of results) {
  const file = relative(process.cwd(), result.filePath).split('\\').join('/')
  for (const m of result.messages) {
    if (m.severity === 2 || m.fatal) {
      errors++
      continue
    }
    const rule = m.ruleId ?? 'unknown'
    byFile[file] ??= {}
    byFile[file][rule] = (byFile[file][rule] ?? 0) + 1
    byRule[rule] = (byRule[rule] ?? 0) + 1
    total++
  }
}

if (errors > 0) {
  console.error(`lint-baseline: ${errors} lint error(s); run "npx eslint ." for details`)
  process.exit(1)
}

const sortKeys = <T>(obj: Record<string, T>): Record<string, T> =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
const current: Baseline = {
  total,
  byRule: sortKeys(byRule),
  byFile: sortKeys(Object.fromEntries(Object.entries(byFile).map(([f, r]) => [f, sortKeys(r)]))),
}

if (update) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`lint-baseline: wrote ${total} warning(s) to lint-baseline.json`)
  process.exit(0)
}

if (!existsSync(BASELINE_PATH)) {
  console.error('lint-baseline: lint-baseline.json missing; run "npm run lint:baseline:update"')
  process.exit(1)
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline
const increases: string[] = []
for (const [file, rules] of Object.entries(current.byFile)) {
  for (const [rule, count] of Object.entries(rules)) {
    const allowed = baseline.byFile[file]?.[rule] ?? 0
    if (count > allowed) increases.push(`${file} ${rule}: ${count} > baseline ${allowed}`)
  }
}

if (increases.length > 0) {
  console.error('lint-baseline: warning count increased (warnings may only decrease):')
  for (const i of increases) console.error(`  - ${i}`)
  process.exit(1)
}

const note = total < baseline.total ? ' (below baseline; run "npm run lint:baseline:update" to lock in)' : ''
console.log(`lint-baseline: ${total} warning(s), baseline ${baseline.total}${note}`)
