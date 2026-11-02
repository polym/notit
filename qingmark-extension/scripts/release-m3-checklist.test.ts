import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PerfReport } from '../tests/perf/perf.ts'
import type { SpikeReport } from '../tests/spike/spike.ts'
import type { ReleaseFacts } from './release-m1-checklist.ts'
import { EDGE_SMOKE, KEY_FLOW_E2E, smokeMinutes } from './release-m2-checklist.ts'
import {
  DROP_LEGACY_SQL,
  M2_RELEASE_TAG,
  M3_CORPUS_MIN_RATE,
  M3_SMOKE,
  M3_SMOKE_EXTRA,
  M3_SMOKE_SKIPPED,
  checkEvidence,
  formatChecklist,
  hasM2Release,
  legacyConsistencySql,
  type CorpusSummary,
  type M3Evidence,
} from './release-m3-checklist.ts'

const root = resolve(import.meta.dirname, '..')
const spike = JSON.parse(readFileSync(resolve(root, 'tests/spike/spike-report.json'), 'utf8')) as SpikeReport

function facts(overrides: Partial<ReleaseFacts> = {}): ReleaseFacts {
  return { packageVersion: '1.1.0', manifestVersion: '1.1.0', existingTags: ['v0.0.1', 'v1.0.0'], scanStatus: 0, backupRows: null, ...overrides }
}

function corpus(rate: number): CorpusSummary {
  return {
    engine: 'anchor-resolve+mark-renderer',
    categories: { 'long-article': { eligible: 10, correct: 10, rate: 1 } },
    overall: { snapshots: 30, eligible: 100, correct: Math.round(rate * 100), sourceGone: 2, rate },
  }
}

function perf(overBudget = false): PerfReport {
  return {
    generatedAt: '2026-10-21T00:00:00.000Z',
    engine: 'mark',
    iterations: 20,
    results: [{ metric: 'colorToHighlight', mode: 'online', samples: [1], p95: overBudget ? 120 : 1, budget: 100, overBudget }],
  }
}

function evidence(overrides: Partial<M3Evidence> = {}): M3Evidence {
  return { corpus: corpus(0.963), spike, perf: perf(), m2Released: true, ...overrides }
}

describe('M3 release checklist', () => {
  it('uses the same corpus gate as the corpus runner', () => {
    // runner.ts uses DOM types, so it is read as text instead of imported under tsconfig.node.json.
    const runner = readFileSync(resolve(root, 'tests/corpus/runner.ts'), 'utf8')
    expect(runner).toContain(`export const CORPUS_MIN_RATE = ${M3_CORPUS_MIN_RATE}\n`)
  })

  it('keeps the Edge smoke test within 30 minutes and reuses the M2 steps', () => {
    expect(M3_SMOKE_SKIPPED.every((s) => s !== undefined && EDGE_SMOKE.includes(s))).toBe(true)
    expect(M3_SMOKE.slice(0, EDGE_SMOKE.length - M3_SMOKE_SKIPPED.length)).toEqual(
      EDGE_SMOKE.filter((s) => !M3_SMOKE_SKIPPED.includes(s)),
    )
    expect(M3_SMOKE.slice(-M3_SMOKE_EXTRA.length)).toEqual(M3_SMOKE_EXTRA)
    expect(M3_SMOKE_EXTRA.length).toBeGreaterThan(0)
    expect(smokeMinutes(M3_SMOKE)).toBeLessThanOrEqual(30)
  })

  it('passes the evidence gates on the committed spike report', () => {
    expect(checkEvidence(evidence())).toEqual([])
  })

  it('fails the gates on missing reports, a low corpus rate, an over-budget metric or no M2 release', () => {
    expect(checkEvidence(evidence({ corpus: null, spike: null, perf: null }))).toHaveLength(3)
    expect(checkEvidence(evidence({ corpus: corpus(M3_CORPUS_MIN_RATE - 0.01) }))[0]).toContain('below 95.0%')
    expect(checkEvidence(evidence({ perf: perf(true) }))[0]).toContain('exceeds the 100ms budget')
    expect(checkEvidence(evidence({ spike: { ...spike, automatedPass: false } }))[0]).toContain('spike')
    expect(checkEvidence(evidence({ m2Released: false }))[0]).toContain(M2_RELEASE_TAG)
  })

  it('detects the M2 release tag', () => {
    expect(hasM2Release(['v0.0.1'])).toBe(false)
    expect(hasM2Release(['v0.0.1', M2_RELEASE_TAG])).toBe(true)
  })

  it('prints evidence, gates, E5 tag, smoke test and E7 in order', () => {
    const text = formatChecklist(facts(), evidence(), [])
    expect(text).toContain('result: READY')
    expect(text).toContain('corpus (anchor-resolve+mark-renderer): 96.3%')
    for (const c of spike.criteria) expect(text).toContain(`${c.id} ${c.pass ? 'pass' : 'FAIL'}`)
    expect(text).toContain('default renderer: mark')
    expect(text).toContain('colorToHighlight / online: p95 1ms')
    for (const file of KEY_FLOW_E2E) expect(text).toContain(file)
    expect(text).toContain('npm run test:perf -- --absolute')
    expect(text).toContain('git tag v1.1.0 && git push origin v1.1.0')
    for (const step of M3_SMOKE) expect(text).toContain(step.action)
    for (const sql of legacyConsistencySql()) expect(text).toContain(sql)
    expect(text).toContain(DROP_LEGACY_SQL)
    // Gates before the tag, the tag before the smoke test, the smoke test before the E7 decision.
    expect(text.indexOf('npm run verify')).toBeLessThan(text.indexOf('git tag'))
    expect(text.indexOf('git tag')).toBeLessThan(text.indexOf('Edge smoke test'))
    expect(text.indexOf('Edge smoke test')).toBeLessThan(text.indexOf('E7 decision'))
    // The read-only checks come before the drop, which is gated on the SC-1 trial.
    expect(text.indexOf('SC-1 one-week trial')).toBeLessThan(text.indexOf(DROP_LEGACY_SQL))
    expect(text.indexOf(legacyConsistencySql()[0])).toBeLessThan(text.indexOf(DROP_LEGACY_SQL))
  })

  it('keeps the E7 SQL limited to read-only checks plus the single legacy drop', () => {
    for (const sql of legacyConsistencySql()) {
      if (sql.startsWith('--')) continue
      expect(sql).toMatch(/^select /)
    }
    expect(DROP_LEGACY_SQL).toBe('drop table if exists public.highlights_legacy;')
  })

  it('marks the result NOT READY with the failures and never embeds credentials', () => {
    const text = formatChecklist(facts(), evidence({ corpus: null }), ['tests/corpus/corpus-report.json missing'])
    expect(text).toContain('result: NOT READY\n  - tests/corpus/corpus-report.json missing')
    expect(text).toContain('- corpus: missing')
    expect(text).not.toMatch(/eyJ[\w-]+\.[\w-]+\./)
    expect(text).not.toMatch(/sb_secret_\w/)
  })
})
