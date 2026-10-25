import { afterEach, describe, expect, it } from 'vitest'
import { describeSelection } from '../anchoring/describe.ts'
import { resolveAnchor } from '../anchoring/resolve.ts'
import { resolveRecords } from '../anchoring/restore.ts'
import { createTextIndex } from '../anchoring/text-index.ts'
import type { HighlightRecord } from '../../../core/model/index.ts'
import { overlayColor } from '../../../ui/palette.ts'
import { colors } from '../../../ui/tokens/index.ts'
import { MarkRenderer } from './mark-renderer.ts'

const STYLE = { color: 'yellow', commented: false } as const

afterEach(() => {
  document.body.replaceChildren()
})

const paintedText = (id: string) =>
  Array.from(document.querySelectorAll(`mark[data-noteit-id="${id}"]`))
    .map((m) => m.textContent)
    .join('')

/** Indexed text of a Range (TextIndex baseline, never Range.toString()). */
const indexedText = (range: Range) => {
  const index = createTextIndex()
  const { start, end } = index.rangeToOffsets(range)
  return index.text.slice(start, end)
}

function record(id: string, exact: string, anchor: HighlightRecord['anchor'] = null): HighlightRecord {
  return {
    id,
    userId: 'u',
    canonicalUrl: 'https://example.test/',
    siteKey: 'example.test',
    url: 'https://example.test/',
    text: exact,
    color: 'yellow',
    comment: null,
    anchor,
    pageTitle: null,
    favicon: null,
    createdAt: 0,
    editedAt: 0,
    deviceId: 'd',
    deletedAt: null,
    schemaVersion: 1,
  }
}

const FIXTURE =
  '<article><p id="a">Opening words <script>var hidden = "script text";</script>with <b>bold part</b> and</p>' +
  '<style>p { color: red }</style><noscript>noscript text</noscript><template><p>template text</p></template>' +
  '<textarea>form text</textarea><p id="b">closing <i>italic</i> sentence here.</p></article>'

describe('MarkRenderer', () => {
  it('paints exactly the text resolveAnchor returns on the same TextIndex (random ranges)', () => {
    document.body.innerHTML = FIXTURE
    const renderer = new MarkRenderer()
    const base = createTextIndex()
    let seed = 7
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n)
    for (let i = 0; i < 25; i++) {
      const a = rand(base.text.length)
      const b = rand(base.text.length)
      // Rebuild every round: remove() merges text nodes back, so older indexes point at detached nodes.
      const index = createTextIndex()
      expect(index.text).toBe(base.text)
      const range = index.offsetsToRange(Math.min(a, b), Math.max(a, b) + 1)!
      const anchor = describeSelection(index, range)
      if (!anchor) continue
      const hit = resolveAnchor(createTextIndex(), anchor)
      expect(hit).not.toBeNull()
      // Read before painting: the Range is live and mark.js splits its boundary nodes.
      const resolvedText = indexedText(hit!.range)
      renderer.paint('h', hit!.range, STYLE)
      expect(paintedText('h')).toBe(anchor.exact)
      expect(paintedText('h')).toBe(resolvedText)
      renderer.remove('h')
      expect(document.querySelectorAll('mark').length).toBe(0)
    }
    // Excluded text was never wrapped and the page text is back to its original shape.
    expect(createTextIndex().text).toBe(base.text)
  })

  it('skips inline script text so offsets match on pages with body scripts', () => {
    document.body.innerHTML = FIXTURE
    const renderer = new MarkRenderer()
    const index = createTextIndex()
    const at = index.text.indexOf('with bold')
    const range = index.offsetsToRange(at, at + 'with bold'.length)!
    renderer.paint('s', range, STYLE)
    expect(paintedText('s')).toBe('with bold')
    expect(document.querySelector('script mark')).toBeNull()
  })

  it('restores several records (anchored and legacy) in one pass', () => {
    document.body.innerHTML = FIXTURE
    const index = createTextIndex()
    const anchorOf = (exact: string) => {
      const at = index.text.indexOf(exact)
      return describeSelection(index, index.offsetsToRange(at, at + exact.length)!)
    }
    const records = [
      record('r1', 'Opening words', anchorOf('Opening words')),
      record('r2', 'bold part and', anchorOf('bold part and')),
      record('r3', 'italic sentence'),
    ]
    const renderer = new MarkRenderer()
    renderer.paintAll(resolveRecords(createTextIndex(), records).map((hit) => ({ id: hit.record.id, range: hit.range, style: STYLE })))
    expect(paintedText('r1')).toBe('Opening words')
    expect(paintedText('r2')).toBe('bold part and')
    expect(paintedText('r3')).toBe('italic sentence')
    renderer.clear()
    expect(document.querySelectorAll('mark').length).toBe(0)
  })

  it('restores partly overlapping records and records sharing a start offset in one pass', () => {
    document.body.innerHTML = '<p>alpha beta gamma delta epsilon</p>'
    const index = createTextIndex()
    const anchorAt = (start: number, end: number) => describeSelection(index, index.offsetsToRange(start, end)!)
    const records = [
      // Partly overlapping: A = [0,10], B = [6,16].
      record('A', 'alpha beta', anchorAt(0, 10)),
      record('B', 'beta gamma', anchorAt(6, 16)),
      // Same start, the longer one listed first: C = [17,30], D = [17,22].
      record('C', 'delta epsilon', anchorAt(17, 30)),
      record('D', 'delta', anchorAt(17, 22)),
    ]
    const hits = resolveRecords(createTextIndex(), records)
    expect(hits).toHaveLength(4)
    // Resolved text per id, read before any paint (the Ranges are live).
    const resolved = new Map(hits.map((hit) => [hit.record.id, indexedText(hit.range)]))
    const renderer = new MarkRenderer()
    renderer.paintAll(hits.map((hit) => ({ id: hit.record.id, range: hit.range, style: STYLE })))
    for (const id of ['A', 'B', 'C', 'D']) {
      expect(renderer.isPainted(id)).toBe(true)
      expect(paintedText(id)).toBe(resolved.get(id))
    }
    expect(paintedText('A')).toBe('alpha beta')
    expect(paintedText('B')).toBe('beta gamma')
    expect(paintedText('C')).toBe('delta epsilon')
    expect(paintedText('D')).toBe('delta')
    renderer.clear()
    expect(document.body.innerHTML).toBe('<p>alpha beta gamma delta epsilon</p>')
  })

  it('hitTest finds the highlight under a point; flash and restyle work; isOwnMutation sees its own changes', async () => {
    document.body.innerHTML = '<p id="t">Some text to highlight here.</p>'
    const renderer = new MarkRenderer()
    const own: boolean[] = []
    const observer = new MutationObserver((records) => own.push(...records.map((r) => renderer.isOwnMutation(r))))
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true })
    const index = createTextIndex()
    const at = index.text.indexOf('highlight')
    renderer.paint('x', index.offsetsToRange(at, at + 9)!, STYLE)
    const rect = renderer.boundingRect('x')!
    expect(renderer.hitTest(rect.left + rect.width / 2, rect.top + rect.height / 2)).toBe('x')
    expect(renderer.hitTest(rect.left + rect.width + 200, rect.top + rect.height / 2)).toBeNull()
    expect(renderer.flash('x')).toBe(true)
    expect(renderer.flash('missing')).toBe(false)
    renderer.restyle('x', { color: 'blue', commented: true })
    expect(document.querySelector('mark')!.classList.contains('noteit-commented')).toBe(true)
    renderer.remove('x')
    await new Promise((r) => setTimeout(r, 0))
    expect(own.length).toBeGreaterThan(0)
    expect(own.every(Boolean)).toBe(true)
    own.length = 0
    // A page change is not ours.
    document.getElementById('t')!.append(document.createElement('span'))
    await new Promise((r) => setTimeout(r, 0))
    observer.disconnect()
    expect(own).toEqual([false])
  })

  it('paints the on-dark overlay when the nearest opaque background is dark', () => {
    document.body.innerHTML =
      '<p id="light">Light paragraph text.</p>' +
      '<div style="background: rgb(30, 30, 30)"><p id="dark">Dark paragraph <span style="background: rgba(255, 255, 255, 0.1)">nested</span> text.</p></div>'
    const renderer = new MarkRenderer()
    const index = createTextIndex()
    const range = (word: string) => {
      const at = index.text.indexOf(word)
      return index.offsetsToRange(at, at + word.length)!
    }
    renderer.paintAll([
      { id: 'l', range: range('Light'), style: STYLE },
      { id: 'd', range: range('Dark'), style: STYLE },
      // A mostly transparent ancestor is skipped; the dark block behind it decides.
      { id: 'n', range: range('nested'), style: STYLE },
    ])
    const bg = (id: string) => document.querySelector<HTMLElement>(`mark[data-noteit-id="${id}"]`)!.style.backgroundColor
    const expected = (hex: string) => {
      const probe = document.createElement('i')
      probe.style.backgroundColor = hex
      return probe.style.backgroundColor
    }
    expect(bg('l')).toBe(expected(overlayColor('yellow')))
    expect(bg('d')).toBe(expected(overlayColor('yellow', true)))
    expect(bg('n')).toBe(expected(overlayColor('yellow', true)))
  })

  it('repaints marks when the host switches theme, and colors the comment marker on dark', async () => {
    document.body.innerHTML = '<p>Theme switch text.</p>'
    const renderer = new MarkRenderer()
    const index = createTextIndex()
    const at = index.text.indexOf('switch')
    renderer.paint('t', index.offsetsToRange(at, at + 6)!, { color: 'blue', commented: true })
    const mark = () => document.querySelector<HTMLElement>('mark[data-noteit-id="t"]')!
    const probe = (value: string, prop: 'backgroundColor' | 'color') => {
      const el = document.createElement('i')
      el.style[prop] = value
      return el.style[prop]
    }
    const marker = () => mark().style.getPropertyValue('--noteit-marker')
    expect(mark().style.backgroundColor).toBe(probe(overlayColor('blue'), 'backgroundColor'))
    expect(marker()).toBe(colors['comment-marker'])
    expect(mark().classList.contains('noteit-last')).toBe(true)
    expect(getComputedStyle(mark(), '::after').content).not.toBe('none')
    try {
      document.body.style.backgroundColor = 'rgb(28, 28, 30)'
      await new Promise((r) => setTimeout(r, 0))
      expect(mark().style.backgroundColor).toBe(probe(overlayColor('blue', true), 'backgroundColor'))
      expect(marker()).toBe(colors['comment-marker-on-dark'])
      document.body.style.backgroundColor = ''
      await new Promise((r) => setTimeout(r, 0))
      expect(mark().style.backgroundColor).toBe(probe(overlayColor('blue'), 'backgroundColor'))
      expect(marker()).toBe(colors['comment-marker'])
    } finally {
      document.body.style.backgroundColor = ''
    }
  })
})
