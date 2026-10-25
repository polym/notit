// Runs the full verification gate locally in the same order as .github/workflows/verify.yml (NFR23,
// architecture.md "Testing & CI Architecture"). Stops at the first failing step.
// Usage:
//   node scripts/verify.ts               -> npm ci, then every gate step
//   node scripts/verify.ts --no-install  -> skip npm ci (reuse the current node_modules)
// The local Supabase stack is started (no-op when already running) and reset; it is left running afterwards.
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface VerifyStep {
  name: string
  /** Arguments passed to `npm`. */
  npmArgs: string[]
}

/** Gate order shared with verify.yml; scripts/verify.test.ts asserts the workflow matches it. */
export const VERIFY_STEPS: readonly VerifyStep[] = [
  { name: 'install', npmArgs: ['ci'] },
  { name: 'lint', npmArgs: ['run', 'lint'] },
  { name: 'typecheck', npmArgs: ['run', 'typecheck'] },
  { name: 'test:unit', npmArgs: ['run', 'test:unit'] },
  { name: 'test:browser', npmArgs: ['run', 'test:browser'] },
  // Story 3.3: src/features/highlight must stay unchanged when a second side panel module is added.
  { name: 'test:module-boundary', npmArgs: ['run', 'test:module-boundary'] },
  { name: 'supabase start', npmArgs: ['run', 'db:start'] },
  { name: 'db reset', npmArgs: ['run', 'db:reset'] },
  // Points the following build at the local stack (VITE_SUPABASE_* in .env.local) for the E2E tests.
  { name: 'env:local', npmArgs: ['run', 'env:local'] },
  { name: 'test:integration', npmArgs: ['run', 'test:integration'] },
  { name: 'build', npmArgs: ['run', 'build'] },
  { name: 'scan:dist', npmArgs: ['run', 'scan:dist'] },
  { name: 'test:e2e', npmArgs: ['run', 'test:e2e'] },
  { name: 'test:corpus', npmArgs: ['run', 'test:corpus'] },
  { name: 'test:perf', npmArgs: ['run', 'test:perf'] },
]

/** The shell command a step runs, as written in verify.yml. */
export function stepCommand(step: VerifyStep): string {
  return ['npm', ...step.npmArgs].join(' ')
}

function main(argv: string[]): number {
  const skipInstall = argv.includes('--no-install')
  const steps = VERIFY_STEPS.filter((s) => !(skipInstall && s.name === 'install'))
  const timings: string[] = []

  for (const step of steps) {
    console.log(`\n[verify] ${step.name}: ${stepCommand(step)}`)
    const started = Date.now()
    const result = spawnSync('npm', step.npmArgs, { stdio: 'inherit' })
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    const ok = result.status === 0
    timings.push(`${ok ? 'PASS' : 'FAIL'}  ${step.name} (${seconds}s)`)
    if (!ok) {
      console.error(`\n[verify] failed at "${step.name}"`)
      console.error(timings.join('\n'))
      return result.status ?? 1
    }
  }

  console.log(`\n[verify] all ${steps.length} steps passed`)
  console.log(timings.join('\n'))
  return 0
}

// Only run when executed directly, so the unit test can import VERIFY_STEPS.
// import.meta.main needs Node 24.2+, but engines allows 24.0, so compare argv[1] like scan-dist.ts.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)))
}
