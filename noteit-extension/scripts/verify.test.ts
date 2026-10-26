// Workflow lint for .github/workflows (Story 1.11): verify.yml must run the same gate steps, in the same
// order, as scripts/verify.ts, and must not depend on any hosted Supabase credentials.
// actionlint is not a dependency, so the workflow is checked with a small line-based reader that only
// understands the subset of YAML these workflows use (block mappings and `- name:` / `run:` step items).
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stepCommand, VERIFY_STEPS } from './verify.ts'

const WORKFLOWS = resolve(import.meta.dirname, '../../.github/workflows')
const VERIFY_YML = resolve(WORKFLOWS, 'verify.yml')
const RELEASE_YML = resolve(WORKFLOWS, 'release.yml')

/** Order required by the Story 1.11 acceptance criteria. */
const EXPECTED_ORDER = [
  'npm ci',
  'npm run lint',
  'npm run typecheck',
  'npm run test:unit',
  'npm run test:browser',
  'npm run test:module-boundary',
  'npm run db:start',
  'npm run db:reset',
  'npm run env:local',
  'npm run test:integration',
  'npm run build',
  'npm run scan:dist',
  'npm run test:e2e',
  'npm run test:corpus',
  'npm run test:perf',
]

// A gate command is `npm ci` or `npm run <script>`; other steps (checkout, browser install, packaging) are setup.
const GATE_COMMAND = /^npm (?:ci|run [\w:-]+)$/

interface WorkflowStep {
  name?: string
  run?: string
  uses?: string
}

function stripComment(line: string): string {
  // Workflows here never use `#` inside quoted values, so a ` #` starts a comment.
  const idx = line.indexOf(' #')
  return (idx >= 0 ? line.slice(0, idx) : line).trimEnd()
}

function unquote(value: string): string {
  return value.trim().replace(/^(['"])(.*)\1$/, '$2')
}

/** Steps of every `steps:` block, in file order. Multi-line `run: |` blocks are joined with newlines. */
function readSteps(yaml: string): WorkflowStep[] {
  const steps: WorkflowStep[] = []
  const lines = yaml.split('\n').map(stripComment)
  const indentOf = (l: string) => l.length - l.trimStart().length
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*steps:$/.test(lines[i])) continue
    const blockIndent = indentOf(lines[i])
    let current: WorkflowStep | undefined
    for (i++; i < lines.length; i++) {
      const line = lines[i]
      if (!line.trim()) continue
      const indent = indentOf(line)
      if (indent <= blockIndent) {
        i--
        break
      }
      if (line.trimStart().startsWith('- ')) {
        current = {}
        steps.push(current)
      }
      const field = /^\s*(?:- )?(name|run|uses):\s*(.*)$/.exec(line)
      if (!current || !field) continue
      const [, key, raw] = field
      if (key === 'run' && raw.trim() === '|') {
        const block: string[] = []
        while (i + 1 < lines.length && (!lines[i + 1].trim() || indentOf(lines[i + 1]) > indent)) {
          block.push(lines[++i].trim())
        }
        current.run = block.filter(Boolean).join('\n')
      } else {
        current[key as keyof WorkflowStep] = unquote(raw)
      }
    }
  }
  return steps
}

/** Value lines of a top-level block such as `on:`, with indentation kept. */
function topLevelBlock(yaml: string, key: string): string[] {
  const lines = yaml.split('\n')
  const start = lines.findIndex((l) => l.startsWith(`${key}:`))
  if (start < 0) return []
  const block: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() && !line.startsWith(' ')) break
    if (stripComment(line).trim()) block.push(stripComment(line))
  }
  return block
}

describe('scripts/verify.ts', () => {
  it('runs the gate steps in the required order', () => {
    expect(VERIFY_STEPS.map(stepCommand)).toEqual(EXPECTED_ORDER)
  })
})

describe('.github/workflows/verify.yml', () => {
  const yaml = readFileSync(VERIFY_YML, 'utf8')
  const steps = readSteps(yaml)

  it('runs exactly the gate steps of scripts/verify.ts, in the same order', () => {
    const gate = steps.map((s) => s.run ?? '').filter((run) => GATE_COMMAND.test(run))
    expect(gate).toEqual(VERIFY_STEPS.map(stepCommand))
  })

  it('names each gate step after the verify.ts step', () => {
    const gateSteps = steps.filter((s) => GATE_COMMAND.test(s.run ?? ''))
    expect(gateSteps.map((s) => s.name)).toEqual(VERIFY_STEPS.map((s) => s.name))
  })

  it('triggers on pull requests and pushes to main', () => {
    const on = topLevelBlock(yaml, 'on')
    expect(on).toContain('  pull_request:')
    expect(on).toContain('  push:')
    expect(on.filter((l) => /^\s+branches:/.test(l)).every((l) => /\[\s*main\s*\]/.test(l))).toBe(true)
    expect(on.some((l) => /^\s+tags:/.test(l))).toBe(false)
  })

  it('uses Node 24 from noteit-extension/.nvmrc', () => {
    const setup = steps.find((s) => s.uses?.startsWith('actions/setup-node@'))
    expect(setup).toBeDefined()
    expect(yaml).toMatch(/node-version-file:\s*noteit-extension\/\.nvmrc/)
    expect(readFileSync(resolve(import.meta.dirname, '../.nvmrc'), 'utf8').trim()).toMatch(/^24(\.|$)/)
  })

  it('needs no hosted Supabase credentials', () => {
    expect(yaml).not.toMatch(/\$\{\{\s*(secrets|vars)\./)
    expect(yaml).not.toMatch(/supabase\.co|service_role|sb_secret_|SUPABASE_ACCESS_TOKEN/)
  })

  it('installs the Playwright browser before any browser test', () => {
    const runs = steps.map((s) => s.run ?? '')
    const install = runs.findIndex((r) => /playwright install/.test(r))
    expect(install).toBeGreaterThan(-1)
    expect(install).toBeLessThan(runs.indexOf('npm run test:browser'))
  })
})

describe('other workflows', () => {
  it('build.yml is merged into verify.yml and removed', () => {
    expect(existsSync(resolve(WORKFLOWS, 'build.yml'))).toBe(false)
  })

  it('release.yml only runs on version tags', () => {
    const on = topLevelBlock(readFileSync(RELEASE_YML, 'utf8'), 'on')
    const events = on.filter((l) => /^ {2}\w/.test(l)).map((l) => l.trim())
    expect(events).toEqual(['push:'])
    expect(on.some((l) => /^\s+tags:/.test(l))).toBe(true)
    expect(on.some((l) => /^\s+branches:/.test(l))).toBe(false)
  })
})
