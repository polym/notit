// Word vs. text decision for a selection (spec "selection translation"). Pure, shared by the
// content script (card copy) and the service worker (which prompt to use).

/** Longest selection the worker translates; longer ones are refused as bad_request. */
export const MAX_TEXT_LENGTH = 2000
/** Context sent to the model is cut to this many characters around the selection. */
export const MAX_CONTEXT_LENGTH = 600

// One English word: letters with inner hyphens or apostrophes ("well-known", "don't").
const WORD_RE = /^[A-Za-z]+(?:['’-][A-Za-z]+)*$/
// Punctuation and quotes a sloppy selection picks up at either end.
const EDGE_RE = /^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu

export type SelectionMode = 'word' | 'text'

/** Trims whitespace and edge punctuation; returns the word when what is left is one English word. */
export function singleWord(text: string): string | null {
  const trimmed = text.replace(EDGE_RE, '')
  return WORD_RE.test(trimmed) ? trimmed : null
}

export function classify(text: string): SelectionMode {
  return singleWord(text) === null ? 'text' : 'word'
}
