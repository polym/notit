import { describe, expect, it } from 'vitest'
import { insertableText } from './insertable.ts'

describe('insertableText', () => {
  it('takes the translation of a text result', () => {
    expect(insertableText({ mode: 'text', translation: 'x' })).toBe('x')
  })

  it('joins lemma, part of speech and sense of a word, skipping empty parts', () => {
    const word = { mode: 'word' as const, word: 'banks', lemma: 'bank', ipa: { us: null, uk: null }, sense: 's', otherSenses: [] }
    expect(insertableText({ ...word, pos: 'n.' })).toBe('bank n. s')
    expect(insertableText({ ...word, pos: '' })).toBe('bank s')
  })
})
