import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DEFAULT_RENDERER } from '../../src/features/highlight/render/create-renderer.ts'
import {
  SPIKE_FLASH_MS,
  SPIKE_MAX_COLOR_P95_MS,
  SPIKE_MAX_LONG_TASK_MS,
  SPIKE_MIN_CORPUS_RATE,
  decideRenderer,
  formatSpikeReport,
  mergeSpikeRuns,
  p95,
  type SpikeEngine,
  type SpikeReport,
  type SpikeRun,
} from './spike.ts'

function run(engine: SpikeEngine, patch: Partial<SpikeRun> = {}): SpikeRun {
  return {
    engine,
    generatedAt: '2026-01-01T00:00:00.000Z',
    corpus: { eligible: 100, correct: 96, rate: 0.96, perCategory: {} },
    hitTest: { checks: 10, correct: 10, failures: [] },
    underline: { differs: true, screenshots: [] },
    flash: { observed: true, durationMs: SPIKE_FLASH_MS },
    virtualList: { rounds: 4, worstReappearMs: 400, textCorrect: true },
    perf: { restoreLongestTaskMs: 0, colorToVisibleP95Ms: 20, colorSamples: 10 },
    layout: { maxShiftPx: 0, elements: 5 },
    ...patch,
  }
}

const merge = (api: Partial<SpikeRun> = {}, mark: Partial<SpikeRun> = {}) =>
  mergeSpikeRuns({ mark: run('mark', mark), 'highlight-api': run('highlight-api', api) }, 'chromium', new Date(0))
const status = (report: ReturnType<typeof merge>) => Object.fromEntries(report.criteria.map((c) => [c.id, c.pass]))

describe('renderer spike report', () => {
  it('passes every criterion when the candidate meets the rules', () => {
    const report = merge()
    expect(report.criteria.map((c) => c.id)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'])
    expect(report.automatedPass).toBe(true)
    expect(report.manual).toEqual([expect.objectContaining({ id: 'S3', status: 'pending', owner: 'Polym' })])
    expect(report.criteria[0].measured).toHaveProperty('mark')
    expect(formatSpikeReport(report)).toContain('automated PASS')
  })

  it('S1 fails below the floor or below MarkRenderer', () => {
    const low = SPIKE_MIN_CORPUS_RATE - 0.01
    expect(status(merge({ corpus: { eligible: 100, correct: 94, rate: low, perCategory: {} } })).S1).toBe(false)
    expect(status(merge({}, { corpus: { eligible: 100, correct: 99, rate: 0.99, perCategory: {} } })).S1).toBe(false)
  })

  it('each other criterion fails on its own rule', () => {
    expect(status(merge({ hitTest: { checks: 10, correct: 9, failures: ['x'] } })).S2).toBe(false)
    expect(status(merge({ hitTest: { checks: 0, correct: 0, failures: [] } })).S2).toBe(false)
    expect(status(merge({ underline: { differs: false, screenshots: [] } })).S3).toBe(false)
    expect(status(merge({ flash: { observed: false, durationMs: null } })).S4).toBe(false)
    expect(status(merge({ flash: { observed: true, durationMs: 300 } })).S4).toBe(false)
    expect(status(merge({ virtualList: { rounds: 4, worstReappearMs: null, textCorrect: true } })).S5).toBe(false)
    expect(status(merge({ virtualList: { rounds: 4, worstReappearMs: 1500, textCorrect: true } })).S5).toBe(false)
    expect(status(merge({ perf: { restoreLongestTaskMs: SPIKE_MAX_LONG_TASK_MS + 1, colorToVisibleP95Ms: 1, colorSamples: 5 } })).S6).toBe(false)
    expect(status(merge({ perf: { restoreLongestTaskMs: 0, colorToVisibleP95Ms: SPIKE_MAX_COLOR_P95_MS + 1, colorSamples: 5 } })).S6).toBe(false)
    expect(status(merge({ layout: { maxShiftPx: 2, elements: 5 } })).S7).toBe(false)
    expect(merge({ layout: { maxShiftPx: 2, elements: 5 } }).automatedPass).toBe(false)
  })

  it('p95 uses the nearest rank', () => {
    expect(p95([])).toBeNaN()
    expect(p95([5])).toBe(5)
    expect(p95(Array.from({ length: 20 }, (_, i) => i + 1))).toBe(19)
  })
})

describe('renderer decision (Story 4.7)', () => {
  const confirmed = (report: SpikeReport): SpikeReport => ({
    ...report,
    manual: report.manual.map((m) => ({ ...m, status: 'confirmed' as const })),
  })

  it('switches to highlight-api only when automated, manual and release gates all pass', () => {
    expect(decideRenderer(confirmed(merge()), true)).toEqual({ renderer: 'highlight-api', reasons: [] })
  })

  it('keeps mark while the Edge manual item is pending', () => {
    const decision = decideRenderer(merge(), true)
    expect(decision.renderer).toBe('mark')
    expect(decision.reasons).toEqual(['S3 manual item pending (Polym)'])
  })

  it('keeps mark when an automated criterion fails or M2 is not released', () => {
    const failed = merge({ perf: { restoreLongestTaskMs: SPIKE_MAX_LONG_TASK_MS + 1, colorToVisibleP95Ms: 20, colorSamples: 10 } })
    expect(decideRenderer(confirmed(failed), true)).toEqual({ renderer: 'mark', reasons: ['S6 automated criterion failed'] })
    expect(decideRenderer(confirmed(merge()), false).renderer).toBe('mark')
  })

  it('DEFAULT_RENDERER matches the decision for the committed spike report', () => {
    const report = JSON.parse(readFileSync(new URL('./spike-report.json', import.meta.url), 'utf8')) as SpikeReport
    expect(report.automatedPass).toBe(true)
    // M2 release state is not observable from the repo snapshot alone; the manual gate already decides.
    expect(decideRenderer(report, true).renderer).toBe(DEFAULT_RENDERER)
  })
})
