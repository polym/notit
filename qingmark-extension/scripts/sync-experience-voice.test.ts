// The committed Voice "Do" copy must match the UX source when it is present (Story 3.2).
// In CI _bmad-output/ is absent (gitignored), so the comparison is skipped there.
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EXPERIENCE_MD, extractVoiceDo, parseVoiceCopy, renderVoiceCopy, VOICE_COPY } from './sync-experience-voice.ts'

describe('voice-do.md', () => {
  it('is committed and lists at least one entry', () => {
    expect(parseVoiceCopy(readFileSync(VOICE_COPY, 'utf8')).length).toBeGreaterThan(0)
  })

  it.skipIf(!existsSync(EXPERIENCE_MD))('matches the EXPERIENCE.md Voice and Tone table', () => {
    expect(readFileSync(VOICE_COPY, 'utf8')).toBe(renderVoiceCopy(extractVoiceDo(readFileSync(EXPERIENCE_MD, 'utf8'))))
  })

  it('extracts the Do column and round-trips through the copy format', () => {
    const md = '## Voice and Tone\n\n| Do | Don\'t |\n|---|---|\n| A · B | x |\n| C | y |\n\n## Next\n'
    expect(extractVoiceDo(md)).toEqual(['A · B', 'C'])
    expect(parseVoiceCopy(renderVoiceCopy(['A · B', 'C']))).toEqual(['A · B', 'C'])
  })

  it('rejects a document without the section', () => {
    expect(() => extractVoiceDo('# nothing\n')).toThrow(/not found/)
  })
})
