// Renderer spike runner (Story 4.6): builds dist/ once per VITE_RENDERER value (mark, highlight-api),
// runs the Playwright spike project against each build, merges the two runs into
// tests/spike/spike-report.json (S1-S7 pass / fail, S3 Edge as a manual item) and finally rebuilds the
// default (mark) dist/ so later suites test the shipped engine. Criteria failures are data, not errors:
// the exit code is non-zero only when a build or a measurement run fails.
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SPIKE_ENGINES, SPIKE_RESULTS_DIR, formatSpikeReport, mergeSpikeRuns, type SpikeEngine, type SpikeRun } from '../tests/spike/spike.ts'

const ROOT = resolve(import.meta.dirname, '..')
const REPORT_PATH = join(ROOT, 'tests/spike/spike-report.json')

function run(command: string, args: string[], env: Record<string, string>): boolean {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } })
  return result.status === 0
}

const build = (engine: SpikeEngine) => run('npm', ['run', 'build'], { VITE_RENDERER: engine })

function main(): number {
  rmSync(SPIKE_RESULTS_DIR, { recursive: true, force: true })
  const runs = {} as Record<SpikeEngine, SpikeRun>
  let failed = false
  for (const engine of SPIKE_ENGINES) {
    console.log(`\n[spike] ${engine}: build`)
    if (!build(engine)) {
      failed = true
      break
    }
    console.log(`[spike] ${engine}: measure`)
    if (!run('npx', ['playwright', 'test', '--project=spike'], { SPIKE_ENGINE: engine })) {
      failed = true
      break
    }
    runs[engine] = JSON.parse(readFileSync(join(SPIKE_RESULTS_DIR, `${engine}.json`), 'utf8')) as SpikeRun
  }
  console.log('\n[spike] restore the default (mark) build')
  if (!build('mark')) failed = true
  if (failed) {
    console.error('[spike] a build or measurement run failed; spike-report.json not written')
    return 1
  }
  const report = mergeSpikeRuns(runs, 'Playwright Chromium (Chrome for Testing)')
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`)
  console.log(`\n${formatSpikeReport(report)}\nwrote ${REPORT_PATH}`)
  return 0
}

process.exit(main())
