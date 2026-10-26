import { describe, expect, it } from 'vitest'
import {
  PERF_METRICS,
  PERF_MODES,
  buildPerfReport,
  compareToBudgets,
  compareToPerfBaseline,
  percentile,
  summarizeMetric,
  toPerfBaseline,
  type MetricResult,
  type PerfMetric,
} from './perf.ts'

function fullReport(p95: (metric: PerfMetric) => number) {
  const results: MetricResult[] = []
  for (const metric of PERF_METRICS) {
    for (const mode of PERF_MODES) results.push(summarizeMetric(metric, mode, [p95(metric)]))
  }
  return buildPerfReport('test', 1, results, new Date(0))
}

describe('percentile', () => {
  it('uses the nearest rank', () => {
    const samples = Array.from({ length: 20 }, (_, i) => i + 1)
    expect(percentile(samples, 95)).toBe(19)
    expect(percentile(samples, 100)).toBe(20)
    expect(percentile([7], 95)).toBe(7)
  })

  it('does not depend on input order', () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3)
  })

  it('rejects empty samples', () => {
    expect(() => percentile([], 95)).toThrow()
  })
})

describe('summarizeMetric', () => {
  it('flags results over the absolute budget', () => {
    expect(summarizeMetric('selectionToMenu', 'online', [101]).overBudget).toBe(true)
    expect(summarizeMetric('selectionToMenu', 'online', [100]).overBudget).toBe(false)
    expect(summarizeMetric('sidepanelList', 'offline', [250]).overBudget).toBe(false)
  })
})

describe('compareToPerfBaseline', () => {
  const baseline = toPerfBaseline(fullReport(() => 50))

  it('passes within 20%', () => {
    expect(compareToPerfBaseline(fullReport(() => 60), baseline)).toEqual([])
  })

  it('fails when any metric regresses more than 20%', () => {
    const report = fullReport((m) => (m === 'sidepanelList' ? 61 : 50))
    const failures = compareToPerfBaseline(report, baseline)
    expect(failures).toHaveLength(2)
    expect(failures[0]).toContain('sidepanelList')
  })

  it('applies the 20% rule to the per-metric minimum reference for near-zero baselines', () => {
    const tiny = toPerfBaseline(fullReport(() => 0.5))
    // selectionToMenu / colorToHighlight / sidepanelList reference 10ms, so 12ms passes and 12.1ms fails.
    const at = (ms: number) => fullReport((m) => (m === 'restoreLongTask' ? 0 : ms))
    expect(compareToPerfBaseline(at(12), tiny)).toEqual([])
    const failures = compareToPerfBaseline(at(12.1), tiny)
    expect(failures).toHaveLength(6)
    expect(failures[0]).toContain('minimum reference 10ms')
  })

  it('compares restoreLongTask against max(baseline, absolute budget)', () => {
    const zero = toPerfBaseline(fullReport(() => 0))
    const restore = (ms: number) => fullReport((m) => (m === 'restoreLongTask' ? ms : 0))
    // A single incidental 50-60ms long task does not fail a 0ms baseline.
    expect(compareToPerfBaseline(restore(60), zero)).toEqual([])
    expect(compareToPerfBaseline(restore(60.1), zero)).toHaveLength(2)
    // Above the budget the baseline itself is the reference.
    const high = toPerfBaseline(fullReport((m) => (m === 'restoreLongTask' ? 100 : 0)))
    expect(compareToPerfBaseline(restore(120), high)).toEqual([])
    expect(compareToPerfBaseline(restore(121), high)).toHaveLength(2)
  })

  it('fails when the baseline lacks a result', () => {
    const partial = toPerfBaseline(fullReport(() => 50))
    delete (partial.p95 as Partial<typeof partial.p95>).restoreLongTask
    expect(compareToPerfBaseline(fullReport(() => 50), partial)).toHaveLength(2)
  })
})

describe('compareToBudgets', () => {
  it('lists every result over its absolute budget', () => {
    const report = fullReport((m) => (m === 'restoreLongTask' ? 80 : 10))
    expect(compareToBudgets(report)).toEqual([
      'restoreLongTask / online: p95 80ms exceeds the 50ms budget',
      'restoreLongTask / offline: p95 80ms exceeds the 50ms budget',
    ])
  })
})
