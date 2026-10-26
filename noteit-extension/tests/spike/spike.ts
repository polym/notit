// Renderer spike (Story 4.6, architecture.md D7 "M3 spike"): measurement types, the S1-S7 pass rules and
// the merge of the per-engine runs into tests/spike/spike-report.json. Pure functions, unit tested.
// tests/spike/renderer.spike.ts measures one engine (the one dist/ was built with) and writes
// spike-results/<engine>.json; scripts/run-spike.ts builds both engines and calls mergeSpikeRuns.
import { join, resolve } from 'node:path'

/** Per-engine runs and screenshots (gitignored; Playwright clears test-results/ on every run). */
export const SPIKE_RESULTS_DIR = join(resolve(import.meta.dirname, '../..'), 'spike-results')

export const SPIKE_ENGINES = ['mark', 'highlight-api'] as const
export type SpikeEngine = (typeof SPIKE_ENGINES)[number]

/** Budgets of the pass rules (architecture.md "M3 spike" table, NFR4 / NFR2). */
export const SPIKE_MIN_CORPUS_RATE = 0.95
export const SPIKE_MAX_LONG_TASK_MS = 50
export const SPIKE_MAX_COLOR_P95_MS = 100
export const SPIKE_REAPPEAR_MS = 1000
export const SPIKE_FLASH_MS = 1200
/** Accepted flash duration window around SPIKE_FLASH_MS (timer and polling jitter). */
export const SPIKE_FLASH_TOLERANCE_MS = 300
/** Largest host layout shift (px) that still counts as "no layout change". */
export const SPIKE_LAYOUT_TOLERANCE_PX = 0.5

export interface SpikeRun {
  engine: SpikeEngine
  generatedAt: string
  /** S1: renderer-agnostic corpus classification (no ids; painted ranges matched by text and place). */
  corpus: { eligible: number; correct: number; rate: number; perCategory: Record<string, { eligible: number; correct: number }> }
  /** S2: hover and click checks on adjacent / overlapping / cross-element highlights. */
  hitTest: { checks: number; correct: number; failures: string[] }
  /** S3: commented and plain highlights rendered differently (screenshot comparison in Chromium). */
  underline: { differs: boolean; screenshots: string[] }
  /** S4: flash observed and how long it lasted. */
  flash: { observed: boolean; durationMs: number | null }
  /** S5: worst reappear time (ms) of the virtual-list rounds; null when one never reappeared. */
  virtualList: { rounds: number; worstReappearMs: number | null; textCorrect: boolean }
  /** S6: longest task during a 50-highlight restore and color -> visible p95. */
  perf: { restoreLongestTaskMs: number; colorToVisibleP95Ms: number; colorSamples: number }
  /** S7: largest host element rect change (px) with vs without highlights. */
  layout: { maxShiftPx: number; elements: number }
}

export type SpikeId = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7'

export interface SpikeCriterion {
  id: SpikeId
  title: string
  /** highlight-api measurement against the rule; mark is shown for comparison. */
  measured: Record<SpikeEngine, unknown>
  pass: boolean
  notes?: string
}

export interface ManualItem {
  id: SpikeId
  title: string
  status: 'pending' | 'confirmed'
  owner: 'Polym'
  instructions: string
}

export interface SpikeReport {
  generatedAt: string
  candidate: 'highlight-api'
  baseline: 'mark'
  browser: string
  criteria: SpikeCriterion[]
  /** All automated criteria pass (manual items are not part of this). */
  automatedPass: boolean
  manual: ManualItem[]
}

/** p95 by nearest rank; NaN for no samples. */
export function p95(samples: number[]): number {
  if (samples.length === 0) return Number.NaN
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]
}

export function evaluateCriteria(runs: Record<SpikeEngine, SpikeRun>): SpikeCriterion[] {
  const api = runs['highlight-api']
  const mark = runs.mark
  const both = <T>(pick: (r: SpikeRun) => T): Record<SpikeEngine, T> => ({ mark: pick(mark), 'highlight-api': pick(api) })
  const flashOk = (r: SpikeRun) =>
    r.flash.observed && r.flash.durationMs !== null && Math.abs(r.flash.durationMs - SPIKE_FLASH_MS) <= SPIKE_FLASH_TOLERANCE_MS
  return [
    {
      id: 'S1',
      title: `corpus recovery >= ${SPIKE_MIN_CORPUS_RATE * 100}% and not below MarkRenderer`,
      measured: both((r) => r.corpus),
      pass: api.corpus.rate >= SPIKE_MIN_CORPUS_RATE && api.corpus.rate >= mark.corpus.rate,
    },
    {
      id: 'S2',
      title: 'hover / click hit 100% on adjacent, overlapping and cross-element highlights',
      measured: both((r) => r.hitTest),
      pass: api.hitTest.checks > 0 && api.hitTest.correct === api.hitTest.checks,
    },
    {
      id: 'S3',
      title: 'dotted underline of commented highlights visible in ::highlight() (Chrome screenshot)',
      measured: both((r) => r.underline),
      pass: api.underline.differs,
      notes: 'Chrome (Playwright Chromium) only; the Edge comparison is a manual item.',
    },
    {
      id: 'S4',
      title: `flash via noteit-flash for ${SPIKE_FLASH_MS}ms`,
      measured: both((r) => r.flash),
      pass: flashOk(api),
    },
    {
      id: 'S5',
      title: `virtual list scrolled out / back repaints correctly within ${SPIKE_REAPPEAR_MS}ms`,
      measured: both((r) => r.virtualList),
      pass:
        api.virtualList.rounds > 0 &&
        api.virtualList.textCorrect &&
        api.virtualList.worstReappearMs !== null &&
        api.virtualList.worstReappearMs <= SPIKE_REAPPEAR_MS,
    },
    {
      id: 'S6',
      title: `restore long task <= ${SPIKE_MAX_LONG_TASK_MS}ms and color -> visible p95 <= ${SPIKE_MAX_COLOR_P95_MS}ms`,
      measured: both((r) => r.perf),
      pass:
        api.perf.colorSamples > 0 &&
        api.perf.restoreLongestTaskMs <= SPIKE_MAX_LONG_TASK_MS &&
        api.perf.colorToVisibleP95Ms <= SPIKE_MAX_COLOR_P95_MS,
    },
    {
      id: 'S7',
      title: 'host getBoundingClientRect unchanged by painting',
      measured: both((r) => r.layout),
      pass: api.layout.elements > 0 && api.layout.maxShiftPx <= SPIKE_LAYOUT_TOLERANCE_PX,
    },
  ]
}

export const MANUAL_ITEMS: ManualItem[] = [
  {
    id: 'S3',
    title: 'Edge screenshot comparison of the commented dotted underline',
    status: 'pending',
    owner: 'Polym',
    instructions:
      'During the Edge smoke test, load a VITE_RENDERER=highlight-api build, add one highlight with a comment and one without, ' +
      'and confirm the commented one shows the dotted underline like in Chrome (Chromium screenshots in spike-results/).',
  },
]

export function mergeSpikeRuns(runs: Record<SpikeEngine, SpikeRun>, browser: string, now = new Date()): SpikeReport {
  const criteria = evaluateCriteria(runs)
  return {
    generatedAt: now.toISOString(),
    candidate: 'highlight-api',
    baseline: 'mark',
    browser,
    criteria,
    automatedPass: criteria.every((c) => c.pass),
    manual: MANUAL_ITEMS,
  }
}

export function formatSpikeReport(report: SpikeReport): string {
  const lines = [`renderer spike (${report.browser}): automated ${report.automatedPass ? 'PASS' : 'FAIL'}`]
  for (const c of report.criteria) lines.push(`  ${c.id} ${c.pass ? 'pass' : 'FAIL'}  ${c.title}`)
  for (const m of report.manual) lines.push(`  ${m.id} manual (${m.status}, ${m.owner})  ${m.title}`)
  return lines.join('\n')
}

export interface RendererDecision {
  renderer: SpikeEngine
  reasons: string[]
}

/**
 * Story 4.7 decision rule (architecture.md "M3 Spike Result"): switch the default to highlight-api only
 * when every automated criterion passes, every manual item is confirmed and M2 has been released.
 * Anything else keeps mark as the default; HighlightApiRenderer stays behind VITE_RENDERER.
 */
export function decideRenderer(report: SpikeReport, m2Released: boolean): RendererDecision {
  const reasons: string[] = []
  for (const c of report.criteria) if (!c.pass) reasons.push(`${c.id} automated criterion failed`)
  for (const m of report.manual) if (m.status !== 'confirmed') reasons.push(`${m.id} manual item ${m.status} (${m.owner})`)
  if (!m2Released) reasons.push('M2 release tag missing (E5)')
  return { renderer: reasons.length === 0 ? report.candidate : report.baseline, reasons }
}
