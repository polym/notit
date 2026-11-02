import { describe, expect, it } from 'vitest'
import { GENERATED_HEADER, localEnvFile, writeDecision } from './write-local-env.ts'

describe('write-local-env', () => {
  it('maps API_URL and ANON_KEY to the VITE_ variables', () => {
    const out = localEnvFile('API_URL="http://127.0.0.1:54321"\nANON_KEY="anon-key"\nDB_URL="x"\n')
    expect(out).toContain('VITE_SUPABASE_URL=http://127.0.0.1:54321')
    expect(out).toContain('VITE_SUPABASE_ANON_KEY=anon-key')
    expect(out).not.toContain('DB_URL')
  })

  it('throws when the stack did not report both values', () => {
    expect(() => localEnvFile('API_URL="http://127.0.0.1:54321"\n')).toThrow()
  })

  it('never overwrites a hand-written .env.local without --force', () => {
    const next = localEnvFile('API_URL="http://127.0.0.1:54321"\nANON_KEY="anon-key"\n')
    const own = 'VITE_SUPABASE_URL=https://example.test\nVITE_SUPABASE_ANON_KEY=dev\n'
    expect(writeDecision(own, next, false)).toBe('refuse')
    expect(writeDecision(own, next, true)).toBe('write')
  })

  it('writes when the file is absent or was generated earlier, and skips identical contents', () => {
    const next = localEnvFile('API_URL="http://127.0.0.1:54321"\nANON_KEY="anon-key"\n')
    expect(writeDecision(null, next, false)).toBe('write')
    expect(writeDecision(`${GENERATED_HEADER}\nVITE_SUPABASE_URL=old\n`, next, false)).toBe('write')
    expect(writeDecision(next, next, false)).toBe('unchanged')
  })
})
