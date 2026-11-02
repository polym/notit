// sentenceAround (spec "selection translation"): the model sees the sentence of the selection plus
// one neighbour on each side, never the whole block.
import { describe, expect, it } from 'vitest'
import { sentenceAround } from './context.ts'

describe('sentenceAround', () => {
  const block = 'First one. We sat on the bank of the river. Then we left. Much later, nothing happened.'

  it('keeps the sentence of the selection and one sentence on each side', () => {
    expect(sentenceAround(block, 'bank')).toBe('First one. We sat on the bank of the river. Then we left.')
  })

  it('stops at the block start and end', () => {
    expect(sentenceAround('We sat on the bank.', 'bank')).toBe('We sat on the bank.')
  })

  it('collapses whitespace in the block and the selection', () => {
    expect(sentenceAround('We  sat\n on the\tbank of   the river.', 'the\nbank')).toBe('We sat on the bank of the river.')
  })

  it('treats full-width sentence ends like ASCII ones', () => {
    // Built from code points: the lint rule keeps CJK characters out of literals.
    const [stop, bang, ask] = [0x3002, 0xff01, 0xff1f].map((c) => String.fromCharCode(c))
    const mixed = `A${stop}B is the bank here${bang}C${ask}D.`
    expect(sentenceAround(mixed, 'bank')).toBe(`A${stop}B is the bank here${bang}C${ask}`)
  })

  it('falls back to the start of the block when the selection is not in it', () => {
    expect(sentenceAround(block, 'missing')).toBe(block)
  })

  it('caps a long window at 1200 characters around the selection', () => {
    const long = `${'word '.repeat(400)}target ${'word '.repeat(400)}`
    const out = sentenceAround(long, 'target')
    expect(out.length).toBeLessThanOrEqual(1200)
    expect(out).toContain('target')
  })
})
