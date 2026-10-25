import { describe, expect, it } from 'vitest'
import { ANCHOR_CONTEXT_LENGTH, describeOffsets } from './describe.ts'
import {
  ANCHOR_MIN_LEAD,
  ANCHOR_MIN_SCORE,
  ANCHOR_PROXIMITY_WEIGHT,
  type AnchorQuery,
  proximity,
  quoteScore,
  resolveOffsets,
} from './resolve.ts'

const BASE =
  'The first paragraph introduces the topic at some length. ' +
  'Here the important sentence lives in the middle of the page. ' +
  'The closing paragraph wraps everything up for the reader.'

function anchorFor(text: string, exact: string, from = 0) {
  const start = text.indexOf(exact, from)
  expect(start).toBeGreaterThanOrEqual(0)
  return describeOffsets(text, start, start + exact.length)
}

describe('describeOffsets', () => {
  it('stores offsets, the exact quote and up to ANCHOR_CONTEXT_LENGTH characters of context', () => {
    const a = anchorFor(BASE, 'important sentence')
    expect(BASE.slice(a.start, a.end)).toBe('important sentence')
    expect(a.exact).toBe('important sentence')
    expect(a.prefix).toHaveLength(ANCHOR_CONTEXT_LENGTH)
    expect(a.suffix).toHaveLength(ANCHOR_CONTEXT_LENGTH)
    expect(BASE.slice(a.start - ANCHOR_CONTEXT_LENGTH, a.end + ANCHOR_CONTEXT_LENGTH)).toBe(a.prefix + a.exact + a.suffix)
  })

  it('truncates context at the text boundaries', () => {
    const a = describeOffsets(BASE, 0, 3)
    expect(a.prefix).toBe('')
    expect(a.suffix).toBe(BASE.slice(3, 3 + ANCHOR_CONTEXT_LENGTH))
  })
})

describe('resolveOffsets', () => {
  it('hits by position when the text at the stored offsets still equals exact', () => {
    const a = anchorFor(BASE, 'important sentence')
    expect(resolveOffsets(BASE, a)).toEqual({ start: a.start, end: a.end, method: 'position' })
  })

  it('finds the quote after text is inserted before it', () => {
    const a = anchorFor(BASE, 'important sentence')
    const inserted = 'A brand new lead paragraph was added by the site. '
    const changed = inserted + BASE
    expect(resolveOffsets(changed, a)).toEqual({ start: a.start + inserted.length, end: a.end + inserted.length, method: 'quote' })
  })

  it('picks the only occurrence whose context matches among three', () => {
    const text =
      'Alpha section opens with a remark: note this. Then alpha ends. ' +
      'Beta section is the one we highlighted: note this. Then beta ends. ' +
      'Gamma section closes with a remark: note this. Then gamma ends.'
    const a = anchorFor(text, 'note this', text.indexOf('Beta'))
    const changed = 'Inserted. ' + text
    expect(changed.split('note this')).toHaveLength(4)
    const hit = resolveOffsets(changed, a)
    expect(hit).toEqual({ start: a.start + 'Inserted. '.length, end: a.end + 'Inserted. '.length, method: 'quote' })
    expect(quoteScore(changed, a, hit!.start)).toBeGreaterThanOrEqual(ANCHOR_MIN_SCORE)
  })

  it('returns null when two candidates score within ANCHOR_MIN_LEAD of each other', () => {
    const filler = 'x'.repeat(40)
    const text = filler + 'SAME' + filler + 'SAME' + filler
    const first = text.indexOf('SAME')
    const second = text.indexOf('SAME', first + 1)
    // Stored start points nowhere useful, so only proximity separates the two identical contexts.
    const a: AnchorQuery = { ...describeOffsets(text, first, first + 4), start: first + 1, end: first + 5 }
    const lead = quoteScore(text, a, first) - quoteScore(text, a, second)
    expect(lead).toBeGreaterThan(0)
    expect(lead).toBeLessThan(ANCHOR_MIN_LEAD)
    expect(resolveOffsets(text, a)).toBeNull()
  })

  it('returns null for identical candidates of a legacy anchor without offsets', () => {
    const filler = 'y'.repeat(40)
    const text = filler + 'SAME' + filler + 'SAME' + filler
    const a: AnchorQuery = { exact: 'SAME', prefix: filler.slice(-32), suffix: filler.slice(0, 32), start: null, end: null }
    expect(resolveOffsets(text, a)).toBeNull()
  })

  it('resolves a unique legacy quote without offsets', () => {
    const a = anchorFor(BASE, 'important sentence')
    const legacy: AnchorQuery = { exact: a.exact, prefix: a.prefix, suffix: a.suffix, start: null, end: null }
    expect(resolveOffsets(BASE, legacy)).toEqual({ start: a.start, end: a.end, method: 'quote' })
  })

  it('returns null when the quote was deleted', () => {
    const a = anchorFor(BASE, 'important sentence')
    expect(resolveOffsets(BASE.replace('important sentence', 'rewritten words'), a)).toBeNull()
  })

  it('resolves a unique quote whose context partly changed and whose offset moved (tuned ANCHOR_MIN_SCORE)', () => {
    // Timeline-style change: a relative timestamp before the quote ages and a new row is prepended.
    const original = 'Ink Daily @inkdaily · 1h It is distinguished from dip pens by an ink reservoir. Paper Trails @papertrails · 2h The pen draws ink.'
    const a = anchorFor(original, 'It is distinguished from dip pens by an ink reservoir.')
    const changed = 'New Poster @newposter · now Fresh post text here. Ink Daily @inkdaily · 3h It is distinguished from dip pens by an ink reservoir. Paper Trails @papertrails · 4h The pen draws ink.'
    const at = changed.indexOf(a.exact)
    const score = quoteScore(changed, a, at)
    expect(score).toBeGreaterThanOrEqual(ANCHOR_MIN_SCORE)
    expect(score).toBeLessThan(2)
    expect(resolveOffsets(changed, a)).toEqual({ start: at, end: at + a.exact.length, method: 'quote' })
  })

  it('returns null when the only occurrence lost its context', () => {
    const a = anchorFor(BASE, 'important sentence')
    const changed = 'Totally unrelated words around an important sentence, nothing else matches here at all.'
    expect(quoteScore(changed, a, changed.indexOf(a.exact))).toBeLessThan(ANCHOR_MIN_SCORE)
    expect(resolveOffsets(changed, a)).toBeNull()
  })

  it('returns null when a quote stored at index 0 now appears mid-text with unrelated context', () => {
    const a = describeOffsets('foo bar baz', 0, 3)
    expect(a.prefix).toBe('')
    const changed = 'X foo qq'
    expect(quoteScore(changed, a, changed.indexOf('foo'))).toBeLessThan(ANCHOR_MIN_SCORE)
    expect(resolveOffsets(changed, a)).toBeNull()
  })

  it('returns null when a quote stored at the end of the text now appears mid-text with unrelated context', () => {
    const original = 'alpha beta foo'
    const a = describeOffsets(original, original.length - 3, original.length)
    expect(a.suffix).toBe('')
    const changed = 'zz foo qqqqq'
    expect(quoteScore(changed, a, changed.indexOf('foo'))).toBeLessThan(ANCHOR_MIN_SCORE)
    expect(resolveOffsets(changed, a)).toBeNull()
  })

  it('still resolves a quote stored at the end of the text when it remains at the end', () => {
    const original = 'alpha beta foo'
    const a = describeOffsets(original, original.length - 3, original.length)
    const changed = 'Intro. ' + original
    expect(resolveOffsets(changed, a)).toEqual({ start: changed.length - 3, end: changed.length, method: 'quote' })
  })

  it('returns null for an empty quote', () => {
    expect(resolveOffsets(BASE, describeOffsets(BASE, 5, 5))).toBeNull()
  })
})

describe('proximity', () => {
  it('is ANCHOR_PROXIMITY_WEIGHT at the stored start and decays to 0 one text length away', () => {
    expect(proximity(10, 10, 100)).toBe(ANCHOR_PROXIMITY_WEIGHT)
    expect(proximity(110, 10, 100)).toBe(0)
    expect(proximity(10, null, 100)).toBe(0)
  })
})
