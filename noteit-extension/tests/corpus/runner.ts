// Anchoring corpus runner (architecture.md "Testing & CI Architecture", SC-2).
// For every snapshot in tests/corpus/<name>/ (page.html + expected.json):
//   1. open the page with no stored highlights and compute the seed the engine would store for each
//      expected highlight (what a user selecting that text would have produced);
//   2. store the seeds, reopen the page and let the engine restore them;
//   3. collect the rendered marks and classify each highlight as correct / wrong / missing.
// A highlight is correct only when its marks spell exactly the expected text, all marks sit inside the
// expected scope element, and they start at the expected occurrence. `sourceGone` highlights are seeded
// (their text no longer exists on the page) but are excluded from the denominator.
// The functions run inside the page (`*InPage`) must stay self-contained: Playwright serializes them.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CORPUS_CATEGORIES = ['long-article', 'docs-site', 'ad-dense', 'inline-script', 'virtual-list'] as const
export type CorpusCategory = (typeof CORPUS_CATEGORIES)[number]

export interface ExpectedHighlight {
  id: string
  /** Exact text the user selected (as window.getSelection().toString() would report it). */
  text: string
  /** CSS selector of the element that contains the highlight on the page. */
  scope: string
  /** 0-based occurrence of `text` inside `scope` (default 0). */
  occurrence?: number
  /** The source text is gone from the page; not counted in the recovery rate. */
  sourceGone?: boolean
  /** For sourceGone entries: the stored offset points at the start of this element (where the text used to be). */
  seedBefore?: string
  note?: string
}

export interface ExpectedFile {
  name: string
  category: CorpusCategory
  source: { url: string; license: string; retrieved: string; notes?: string }
  highlights: ExpectedHighlight[]
}

export interface Snapshot {
  name: string
  dir: string
  expected: ExpectedFile
}

/** What the legacy engine stores for a highlight (subset of src/core/model LegacyHighlight). */
export interface Seed {
  id: string
  text: string
  start: number
  length: number
  context: { prefix: string; suffix: string; offset: number }
}

export type Outcome = 'correct' | 'wrong' | 'missing' | 'source-gone'

export interface HighlightResult {
  id: string
  outcome: Outcome
  /** Why a highlight is not correct (or, for source-gone, whether marks were rendered anyway). */
  detail?: string
}

export interface SnapshotResult {
  name: string
  category: CorpusCategory
  eligible: number
  correct: number
  sourceGone: number
  rate: number
  highlights: HighlightResult[]
}

export interface Aggregate {
  snapshots: number
  eligible: number
  correct: number
  sourceGone: number
  rate: number
}

export interface CorpusReport {
  generatedAt: string
  engine: string
  snapshots: SnapshotResult[]
  /** Per-category totals, in CORPUS_CATEGORIES order (categories without snapshots are omitted). */
  categories: Partial<Record<CorpusCategory, Aggregate>>
  overall: Aggregate
}

export interface CorpusBaseline {
  engine: string
  overall: { eligible: number; correct: number; rate: number }
  /** Recorded for review only; not gated. Absent in baselines written before Story 1.8. */
  categories?: Partial<Record<CorpusCategory, { eligible: number; correct: number; rate: number }>>
  snapshots: Record<string, { eligible: number; correct: number; rate: number }>
}

/** Loads every directory that has both page.html and expected.json, sorted by name. */
export function loadSnapshots(corpusDir: string): Snapshot[] {
  return readdirSync(corpusDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join(corpusDir, d.name))
    .filter((dir) => existsSync(join(dir, 'page.html')) && existsSync(join(dir, 'expected.json')))
    .sort()
    .map((dir) => {
      const expected = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8')) as ExpectedFile
      validateExpected(expected, dir)
      return { name: expected.name, dir, expected }
    })
}

export function validateExpected(expected: ExpectedFile, where: string): void {
  const problems: string[] = []
  if (!expected.name || !where.endsWith(expected.name)) problems.push('name must match the directory name')
  if (!CORPUS_CATEGORIES.includes(expected.category)) problems.push(`unknown category ${String(expected.category)}`)
  if (!expected.source?.url || !expected.source.license) problems.push('source.url and source.license are required')
  if (!Array.isArray(expected.highlights) || expected.highlights.length === 0) problems.push('highlights must be non-empty')
  const ids = new Set<string>()
  for (const h of expected.highlights ?? []) {
    if (ids.has(h.id)) problems.push(`duplicate id ${h.id}`)
    ids.add(h.id)
    if (!h.text || !h.scope) problems.push(`${h.id}: text and scope are required`)
    if (h.sourceGone && !h.seedBefore) problems.push(`${h.id}: sourceGone entries need seedBefore`)
  }
  if (problems.length > 0) throw new Error(`${where}/expected.json: ${problems.join('; ')}`)
}

export function summarizeSnapshot(snapshot: Snapshot, highlights: HighlightResult[]): SnapshotResult {
  const eligible = highlights.filter((h) => h.outcome !== 'source-gone').length
  const correct = highlights.filter((h) => h.outcome === 'correct').length
  return {
    name: snapshot.name,
    category: snapshot.expected.category,
    eligible,
    correct,
    sourceGone: highlights.length - eligible,
    rate: eligible === 0 ? 1 : correct / eligible,
    highlights,
  }
}

function aggregate(snapshots: SnapshotResult[]): Aggregate {
  const eligible = snapshots.reduce((n, s) => n + s.eligible, 0)
  const correct = snapshots.reduce((n, s) => n + s.correct, 0)
  const sourceGone = snapshots.reduce((n, s) => n + s.sourceGone, 0)
  return { snapshots: snapshots.length, eligible, correct, sourceGone, rate: eligible === 0 ? 1 : correct / eligible }
}

export function buildReport(engine: string, snapshots: SnapshotResult[], now = new Date()): CorpusReport {
  const categories: Partial<Record<CorpusCategory, Aggregate>> = {}
  for (const category of CORPUS_CATEGORIES) {
    const members = snapshots.filter((s) => s.category === category)
    if (members.length > 0) categories[category] = aggregate(members)
  }
  return { generatedAt: now.toISOString(), engine, snapshots, categories, overall: aggregate(snapshots) }
}

export function toBaseline(report: CorpusReport): CorpusBaseline {
  return {
    engine: report.engine,
    overall: { eligible: report.overall.eligible, correct: report.overall.correct, rate: report.overall.rate },
    categories: Object.fromEntries(
      Object.entries(report.categories).map(([name, c]) => [name, { eligible: c.eligible, correct: c.correct, rate: c.rate }]),
    ),
    snapshots: Object.fromEntries(
      report.snapshots.map((s) => [s.name, { eligible: s.eligible, correct: s.correct, rate: s.rate }]),
    ),
  }
}

const RATE_EPSILON = 1e-9

/** SC-2 / NFR9: from M3 on the corpus must recover at least this share of eligible highlights. */
export const CORPUS_MIN_RATE = 0.95

/** Returns the reasons the report misses the corpus gate (empty when it passes). */
export function checkCorpusGate(report: CorpusReport, minRate = CORPUS_MIN_RATE): string[] {
  const failures: string[] = []
  if (report.overall.rate < minRate - RATE_EPSILON) {
    failures.push(
      `overall recovery rate ${formatRate(report.overall.rate)} (${report.overall.correct}/${report.overall.eligible}) ` +
        `is below the required ${formatRate(minRate)}`,
    )
  }
  return failures
}

export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

export function formatReport(report: CorpusReport): string {
  const lines = report.snapshots.map(
    (s) =>
      `  ${s.name.padEnd(20)} ${formatRate(s.rate).padStart(6)}  ${s.correct}/${s.eligible} correct` +
      (s.sourceGone ? `, ${s.sourceGone} sourceGone excluded` : ''),
  )
  lines.push('  by category:')
  for (const [name, c] of Object.entries(report.categories)) {
    lines.push(
      `  ${name.padEnd(20)} ${formatRate(c.rate).padStart(6)}  ${c.correct}/${c.eligible} correct over ${c.snapshots} snapshots` +
        (c.sourceGone ? `, ${c.sourceGone} sourceGone excluded` : ''),
    )
  }
  const o = report.overall
  lines.push(`  ${'overall'.padEnd(20)} ${formatRate(o.rate).padStart(6)}  ${o.correct}/${o.eligible} correct over ${o.snapshots} snapshots`)
  return `corpus (${report.engine}):\n${lines.join('\n')}`
}

// ---------------------------------------------------------------------------------------------
// In-page functions (serialized by Playwright; no references to module scope).

export interface SeedRequest {
  highlights: ExpectedHighlight[]
  contextLength: number
}

/**
 * Computes the seed for each expected highlight the same way src/content/SelectionManager.ts does:
 * start = Range(body start -> selection start).toString().length, context = 64 chars around it.
 */
export function computeSeedsInPage(request: SeedRequest): Seed[] | string {
  const bodyText = (node: Node, offset: number, fromStart: boolean): string => {
    const r = document.createRange()
    r.selectNodeContents(document.body)
    if (fromStart) r.setEnd(node, offset)
    else r.setStart(node, offset)
    return r.toString()
  }
  const seeds: Seed[] = []
  for (const h of request.highlights) {
    const scope = document.querySelector(h.sourceGone ? (h.seedBefore ?? '') : h.scope)
    if (!scope) return `${h.id}: selector not found at seed time`
    let startNode: Node = scope
    let startOffset = 0
    let endNode: Node = scope
    let endOffset = 0
    if (!h.sourceGone) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      let full = ''
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        nodes.push(n as Text)
        full += (n as Text).data
      }
      let index = -1
      for (let i = 0; i <= (h.occurrence ?? 0); i++) {
        index = full.indexOf(h.text, index + 1)
        if (index === -1) return `${h.id}: occurrence ${h.occurrence ?? 0} of the text not found in scope at seed time`
      }
      const locate = (pos: number, preferNext: boolean): [Node, number] => {
        let acc = 0
        for (const n of nodes) {
          const len = n.data.length
          if (pos < acc + len || (!preferNext && pos === acc + len)) return [n, pos - acc]
          acc += len
        }
        const last = nodes[nodes.length - 1]
        return [last, last.data.length]
      }
      ;[startNode, startOffset] = locate(index, true)
      ;[endNode, endOffset] = locate(index + h.text.length, false)
    }
    const pre = bodyText(startNode, startOffset, true)
    const post = bodyText(endNode, endOffset, false)
    seeds.push({
      id: h.id,
      text: h.text,
      start: pre.length,
      length: h.text.length,
      context: { prefix: pre.slice(-request.contextLength), suffix: post.slice(0, request.contextLength), offset: pre.length },
    })
  }
  return seeds
}

/** Signature of the rendered marks; the runner waits until it stops changing. */
export function markSignatureInPage(): string {
  return Array.from(document.querySelectorAll('[data-noteit-id]'))
    .map((el) => `${(el as HTMLElement).dataset.noteitId}:${el.textContent}`)
    .join('|')
}

/** Classifies each expected highlight against the marks currently rendered by the legacy engine. */
export function classifyInPage(highlights: ExpectedHighlight[]): HighlightResult[] {
  return highlights.map((h): HighlightResult => {
    const marks = Array.from(document.querySelectorAll(`[data-noteit-id="${CSS.escape(h.id)}"]`))
    if (h.sourceGone) {
      return { id: h.id, outcome: 'source-gone', detail: marks.length ? `rendered ${marks.length} spurious mark(s)` : 'nothing rendered' }
    }
    if (marks.length === 0) return { id: h.id, outcome: 'missing' }
    const scope = document.querySelector(h.scope)
    if (!scope) return { id: h.id, outcome: 'wrong', detail: 'scope not found on the restored page' }
    if (!marks.every((m) => scope.contains(m))) return { id: h.id, outcome: 'wrong', detail: 'mark outside the expected scope' }
    const joined = marks.map((m) => m.textContent ?? '').join('')
    if (joined !== h.text) return { id: h.id, outcome: 'wrong', detail: `marked text differs: ${JSON.stringify(joined.slice(0, 80))}` }
    const scopeRange = document.createRange()
    scopeRange.selectNodeContents(scope)
    const full = scopeRange.toString()
    let expectedIndex = -1
    for (let i = 0; i <= (h.occurrence ?? 0); i++) {
      expectedIndex = full.indexOf(h.text, expectedIndex + 1)
      if (expectedIndex === -1) return { id: h.id, outcome: 'wrong', detail: 'expected occurrence not present on the restored page' }
    }
    const before = document.createRange()
    before.selectNodeContents(scope)
    before.setEndBefore(marks[0])
    const actualIndex = before.toString().length
    if (actualIndex !== expectedIndex) {
      return { id: h.id, outcome: 'wrong', detail: `marked occurrence at ${actualIndex}, expected ${expectedIndex}` }
    }
    return { id: h.id, outcome: 'correct' }
  })
}
