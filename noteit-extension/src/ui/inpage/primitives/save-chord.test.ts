// comment-editor save chord (DESIGN.md comment-editor): Cmd/Ctrl+Enter saves, nothing else does.
import { describe, expect, it } from 'vitest'
import { isSaveChord } from './save-chord.ts'

describe('isSaveChord', () => {
  it('accepts Cmd+Enter and Ctrl+Enter only', () => {
    expect(isSaveChord({ key: 'Enter', metaKey: true, ctrlKey: false })).toBe(true)
    expect(isSaveChord({ key: 'Enter', metaKey: false, ctrlKey: true })).toBe(true)
    expect(isSaveChord({ key: 'Enter', metaKey: false, ctrlKey: false })).toBe(false)
    expect(isSaveChord({ key: 'a', metaKey: true, ctrlKey: false })).toBe(false)
  })
})
