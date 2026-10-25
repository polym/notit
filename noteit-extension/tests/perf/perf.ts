// Performance report helpers (architecture.md "Testing & CI Architecture", SC-3 + NFR1-NFR4).
// Pure functions only: the Playwright spec (budgets.perf.ts) collects samples, this module turns them
// into perf-report.json, a baseline, and pass / fail decisions.

export const PERF_METRICS = ['selectionToMenu', 'colorToHighlight', 'sidepanelList', 'restoreLongTask'] as const
export type PerfMetric = (typeof PERF_METRICS)[number]

export const PERF_MODES = ['online', 'offline'] as const
export type PerfMode = (typeof PERF_MODES)[number]

/** Absolute p95 budgets in ms (NFR1-NFR4). */
export const ABSOLUTE_BUDGETS_MS: Record<PerfMetric, number> = {
  selectionToMenu: 100, // NFR1
  colorToHighlight: 100, // NFR2
  sidepanelList: 300, // NFR3 (5,000 local records, 50 on the current page)
  restoreLongTask: 50, // NFR4 (longest main-thread task while 50 highlights are restored)
}

export const METRIC_DESCRIPTIONS: Record<PerfMetric, string> = {
  selectionToMenu: 'select text -> floating menu visible',
  colorToHighlight: 'click color -> highlight visible',
  sidepanelList: 'open side panel -> list visible (5,000 records, 50 on page)',
  restoreLongTask: 'longest long task while restoring 50 highlights',
}

/** A regression is a p95 more than 20% above the reference (architecture.md Testing & CI, perf row). */
export const REGRESSION_RATIO = 1.2
/**
 * Minimum reference per metric for the 20% rule. The reference is max(baseline p95, this floor), so a
 * near-zero baseline does not turn the gate into a zero-tolerance gate on timer jitter. restoreLongTask
 * uses its absolute budget: PerformanceObserver('longtask') only reports tasks of 50 ms or more, so a
 * sample is either 0 or >= 50 and a baseline of 0 has no meaningful 20% band.
 */
export const REGRESSION_MIN_BASE_MS: Record<PerfMetric, number> = {
  selectionToMenu: 10,
  colorToHighlight: 10,
  sidepanelList: 10,
  restoreLongTask: ABSOLUTE_BUDGETS_MS.restoreLongTask,
}

/** The p95 a result is compared against: the baseline, raised to the metric's minimum reference. */
export function regressionReference(metric: PerfMetric, base: number): number {
  return Math.max(base, REGRESSION_MIN_BASE_MS[metric])
}

export interface MetricResult {
  metric: PerfMetric
  mode: PerfMode
  samples: number[]
  p95: number
  budget: number
  overBudget: boolean
}

export interface PerfReport {
  generatedAt: string
  engine: string
  iterations: number
  results: MetricResult[]
}

export interface PerfBaseline {
  engine: string
  /** p95 in ms per metric and mode. */
  p95: Record<PerfMetric, Record<PerfMode, number>>
}

/** Nearest-rank percentile (p in (0, 100]). */
export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) throw new Error('percentile of an empty sample set')
  if (!(p > 0 && p <= 100)) throw new Error(`percentile out of range: ${p}`)
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[rank - 1]
}

export function round(ms: number): number {
  return Math.round(ms * 10) / 10
}

export function summarizeMetric(metric: PerfMetric, mode: PerfMode, samples: number[]): MetricResult {
  const p95 = round(percentile(samples, 95))
  const budget = ABSOLUTE_BUDGETS_MS[metric]
  return { metric, mode, samples: samples.map(round), p95, budget, overBudget: p95 > budget }
}

export function buildPerfReport(engine: string, iterations: number, results: MetricResult[], now = new Date()): PerfReport {
  return { generatedAt: now.toISOString(), engine, iterations, results }
}

export function toPerfBaseline(report: PerfReport): PerfBaseline {
  const p95 = {} as PerfBaseline['p95']
  for (const metric of PERF_METRICS) {
    const byMode = {} as Record<PerfMode, number>
    for (const mode of PERF_MODES) {
      const result = report.results.find((r) => r.metric === metric && r.mode === mode)
      if (!result) throw new Error(`report has no result for ${metric} / ${mode}`)
      byMode[mode] = result.p95
    }
    p95[metric] = byMode
  }
  return { engine: report.engine, p95 }
}

/** Returns why the report regressed against the baseline (empty when it passes). */
export function compareToPerfBaseline(report: PerfReport, baseline: PerfBaseline): string[] {
  const failures: string[] = []
  for (const result of report.results) {
    const base = baseline.p95[result.metric]?.[result.mode]
    if (base === undefined) {
      failures.push(`${result.metric} / ${result.mode}: missing from the baseline; run "npm run baseline:update"`)
      continue
    }
    const reference = regressionReference(result.metric, base)
    if (result.p95 > reference * REGRESSION_RATIO) {
      const floor = reference === base ? '' : ` (minimum reference ${reference}ms)`
      failures.push(
        `${result.metric} / ${result.mode}: p95 ${result.p95}ms regressed more than 20% over the baseline ${base}ms${floor}`,
      )
    }
  }
  return failures
}

/** Returns the results that exceed their absolute budget (NFR1-NFR4). */
export function compareToBudgets(report: PerfReport): string[] {
  return report.results
    .filter((r) => r.overBudget)
    .map((r) => `${r.metric} / ${r.mode}: p95 ${r.p95}ms exceeds the ${r.budget}ms budget`)
}

export function formatPerfReport(report: PerfReport): string {
  const lines = report.results.map(
    (r) =>
      `  ${r.metric.padEnd(18)} ${r.mode.padEnd(8)} p95 ${`${r.p95}ms`.padStart(9)}  budget ${`${r.budget}ms`.padStart(6)}` +
      (r.overBudget ? '  OVER BUDGET' : ''),
  )
  return `perf (${report.engine}, ${report.iterations} iterations per metric and mode):\n${lines.join('\n')}`
}
