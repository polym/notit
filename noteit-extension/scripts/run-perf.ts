// Runs the Playwright perf project. `--absolute` (npm run test:perf -- --absolute) switches the gate from
// "no regression > 20% over tests/perf/baseline.json" to the NFR1-NFR4 absolute budgets; Playwright
// rejects unknown flags, so it is translated to PERF_ABSOLUTE=1. Other arguments pass through.
// CI (CI=true, set by GitHub Actions) always uses the absolute budgets: its runners are slower than
// the machine that recorded the baseline, and verify.yml must run the same command as scripts/verify.ts.
import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const absolute = args.includes('--absolute') || process.env.CI === 'true'
const passThrough = args.filter((a) => a !== '--absolute')

const result = spawnSync('npx', ['playwright', 'test', '--project=perf', ...passThrough], {
  stdio: 'inherit',
  env: { ...process.env, ...(absolute ? { PERF_ABSOLUTE: '1' } : {}) },
})
process.exit(result.status ?? 1)
