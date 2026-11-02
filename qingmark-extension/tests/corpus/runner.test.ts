import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildReport,
  checkCorpusGate,
  CORPUS_MIN_RATE,
  loadSnapshots,
  summarizeSnapshot,
  toBaseline,
  validateExpected,
  CORPUS_CATEGORIES,
  type CorpusCategory,
  type ExpectedFile,
  type Snapshot,
} from './runner.ts'

function snapshot(name: string, category: CorpusCategory = 'long-article'): Snapshot {
  return {
    name,
    dir: `/corpus/${name}`,
    expected: {
      name,
      category,
      source: { url: 'https://example.org', license: 'CC0', retrieved: '2026-10-18' },
      highlights: [],
    },
  }
}

describe('summarizeSnapshot', () => {
  it('excludes sourceGone highlights from the denominator', () => {
    const s = summarizeSnapshot(snapshot('a'), [
      { id: '1', outcome: 'correct' },
      { id: '2', outcome: 'wrong' },
      { id: '3', outcome: 'missing' },
      { id: '4', outcome: 'correct' },
      { id: '5', outcome: 'source-gone' },
    ])
    expect(s).toMatchObject({ eligible: 4, correct: 2, sourceGone: 1, rate: 0.5 })
  })
})

describe('buildReport / checkCorpusGate', () => {
  const a = summarizeSnapshot(snapshot('a'), [
    { id: '1', outcome: 'correct' },
    { id: '2', outcome: 'wrong' },
  ])
  const b = summarizeSnapshot(snapshot('b'), [
    { id: '1', outcome: 'correct' },
    { id: '2', outcome: 'correct' },
    { id: '3', outcome: 'source-gone' },
  ])
  const report = buildReport('test', [a, b], new Date('2026-10-18T00:00:00Z'))

  it('aggregates the overall recovery rate over eligible highlights', () => {
    expect(report.overall).toEqual({ snapshots: 2, eligible: 4, correct: 3, sourceGone: 1, rate: 0.75 })
  })

  it('aggregates per category and records categories in the baseline', () => {
    const c = summarizeSnapshot(snapshot('c', 'docs-site'), [{ id: '1', outcome: 'missing' }])
    const r = buildReport('test', [a, b, c])
    expect(Object.keys(r.categories)).toEqual(['long-article', 'docs-site'])
    expect(r.categories['long-article']).toEqual({ snapshots: 2, eligible: 4, correct: 3, sourceGone: 1, rate: 0.75 })
    expect(r.categories['docs-site']).toEqual({ snapshots: 1, eligible: 1, correct: 0, sourceGone: 0, rate: 0 })
    expect(toBaseline(r).categories).toEqual({
      'long-article': { eligible: 4, correct: 3, rate: 0.75 },
      'docs-site': { eligible: 1, correct: 0, rate: 0 },
    })
  })

  it('passes at or above CORPUS_MIN_RATE and fails below it', () => {
    expect(CORPUS_MIN_RATE).toBe(0.95)
    // report is 3/4 = 75%.
    expect(checkCorpusGate(report)).toHaveLength(1)
    expect(checkCorpusGate(report, 0.75)).toEqual([])
    const perfect = buildReport('test', [b])
    expect(checkCorpusGate(perfect)).toEqual([])
  })

  it('applies the gate to the overall rate with sourceGone excluded', () => {
    const ok = summarizeSnapshot(snapshot('ok'), [
      ...Array.from({ length: 19 }, (_, i) => ({ id: `c${i}`, outcome: 'correct' as const })),
      { id: 'm', outcome: 'missing' },
      { id: 'g', outcome: 'source-gone' },
    ])
    expect(checkCorpusGate(buildReport('test', [ok]))).toEqual([])
    const low = summarizeSnapshot(snapshot('low'), [
      ...Array.from({ length: 18 }, (_, i) => ({ id: `c${i}`, outcome: 'correct' as const })),
      { id: 'm1', outcome: 'missing' },
      { id: 'm2', outcome: 'wrong' },
    ])
    expect(checkCorpusGate(buildReport('test', [low]))).toHaveLength(1)
  })
})

describe('validateExpected', () => {
  const base: ExpectedFile = snapshot('x').expected
  it('rejects sourceGone entries without seedBefore and duplicate ids', () => {
    expect(() =>
      validateExpected(
        {
          ...base,
          highlights: [
            { id: '1', text: 't', scope: 'p', sourceGone: true },
            { id: '1', text: 't', scope: 'p' },
          ],
        },
        '/corpus/x',
      ),
    ).toThrow(/seedBefore.*duplicate id 1|duplicate id 1.*seedBefore/)
  })
})

describe('committed corpus', () => {
  const snapshots = loadSnapshots(resolve(import.meta.dirname))

  it('has the 30 M3 snapshots (PRD TEA-1, Story 4.5) with at least 6 per category', () => {
    expect(snapshots).toHaveLength(30)
    for (const category of CORPUS_CATEGORIES) {
      expect(snapshots.filter((s) => s.expected.category === category).length, category).toBeGreaterThanOrEqual(6)
    }
  })

  it('has at least 3 expected highlights per snapshot and sourceGone entries in at least 2 snapshots', () => {
    for (const s of snapshots) expect(s.expected.highlights.length, s.name).toBeGreaterThanOrEqual(3)
    expect(snapshots.filter((s) => s.expected.highlights.some((h) => h.sourceGone)).length).toBeGreaterThanOrEqual(2)
  })
})
