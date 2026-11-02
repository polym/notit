import { describe, expect, it } from 'vitest'
import type { TextAnchor as Anchor } from '../../../core/model/index.ts'
import { sortForPage } from './order.ts'

const anchorAt = (start: number): Anchor => ({ start, end: start + 5, exact: 'x', prefix: '', suffix: '' })

type Item = { id: string; anchor: Anchor | null; createdAt: number }

describe('sortForPage', () => {
  it('puts positioned highlights first by anchor.start ascending', () => {
    const items: Item[] = [
      { id: 'c', anchor: anchorAt(300), createdAt: 1 },
      { id: 'a', anchor: anchorAt(10), createdAt: 3 },
      { id: 'b', anchor: anchorAt(120), createdAt: 2 },
    ]
    expect(sortForPage(items).map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('puts highlights without a position after them by createdAt ascending', () => {
    const items: Item[] = [
      { id: 'late', anchor: null, createdAt: 50 },
      { id: 'pos2', anchor: anchorAt(20), createdAt: 90 },
      { id: 'early', anchor: null, createdAt: 5 },
      { id: 'pos1', anchor: anchorAt(0), createdAt: 99 },
    ]
    expect(sortForPage(items).map((i) => i.id)).toEqual(['pos1', 'pos2', 'early', 'late'])
  })

  it('breaks equal start offsets by createdAt and does not mutate the input', () => {
    const items: Item[] = [
      { id: 'second', anchor: anchorAt(7), createdAt: 20 },
      { id: 'first', anchor: anchorAt(7), createdAt: 10 },
    ]
    const copy = [...items]
    expect(sortForPage(items).map((i) => i.id)).toEqual(['first', 'second'])
    expect(items).toEqual(copy)
  })

  it('returns an empty list for no highlights', () => {
    expect(sortForPage([])).toEqual([])
  })
})
