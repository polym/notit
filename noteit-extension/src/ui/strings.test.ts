// UI copy checks (Story 3.2, FR43): every error code has calm Chinese text, and every fixed
// "Do" entry of the EXPERIENCE.md Voice table is available in strings.ts.
import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from '../core/messaging/types.ts'
import { errorText, strings } from './strings.ts'
// Committed copy of the Voice table "Do" column; kept in sync by scripts/sync-experience-voice.ts.
import voiceMarkdown from './voice-do.md?raw'

const HAN = /\p{Script=Han}/u
const EXCLAMATION = /[!\uFF01]/
const EMOJI = /\p{Extended_Pictographic}/u

/** Sample arguments for parameterized copy; the Voice table uses 3 as its example count. */
const SAMPLE_COUNT = 3

function candidates(): Set<string> {
  const out = new Set<string>()
  for (const value of Object.values(strings)) {
    if (typeof value === 'string') out.add(value)
    else out.add((value as (n: number) => string)(SAMPLE_COUNT))
  }
  for (const code of ERROR_CODES) out.add(errorText(code))
  return out
}

function voiceEntries(): string[] {
  return voiceMarkdown
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2))
}

describe('errorText', () => {
  it.each(ERROR_CODES)('returns calm Chinese text for %s', (code) => {
    const text = errorText(code)
    expect(text.trim().length).toBeGreaterThan(0)
    expect(text).toMatch(HAN)
    expect(text).not.toMatch(EXCLAMATION)
    expect(text).not.toMatch(EMOJI)
  })
})

describe('Voice and Tone coverage', () => {
  const known = candidates()
  const entries = voiceEntries()

  it('has entries to check', () => {
    expect(entries.length).toBeGreaterThan(0)
  })

  it.each(entries)('strings.ts provides "%s"', (entry) => {
    // A composite row ("text · action") is covered when each part is its own entry.
    const parts = entry.split(strings.separator)
    const covered = known.has(entry) || parts.every((part) => known.has(part))
    expect(covered, `missing copy: ${entry}`).toBe(true)
  })
})
