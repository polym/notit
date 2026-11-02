import type { TranslateResult } from '../shared/protocol.ts'

/** One line a comment can take over: the translation, or "lemma pos sense" for a word. */
export function insertableText(result: TranslateResult): string {
  if (result.mode === 'text') return result.translation
  return [result.lemma, result.pos, result.sense].filter(Boolean).join(' ')
}
