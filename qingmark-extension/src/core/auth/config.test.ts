import { describe, expect, it } from 'vitest'
import { validateSupabaseConfig } from './config.ts'

// A JWT whose payload is {"role": role}; the signature is irrelevant to validation.
function jwt(role: string): string {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role, iss: 'supabase' })}.sig`
}

describe('validateSupabaseConfig', () => {
  it('accepts an https project with an anon JWT and trims the trailing slash', () => {
    expect(validateSupabaseConfig({ url: ' https://abcd.supabase.co/ ', anonKey: jwt('anon') })).toEqual({
      ok: true,
      config: { url: 'https://abcd.supabase.co', anonKey: jwt('anon') },
    })
  })

  it('accepts a publishable key and http only on localhost / 127.0.0.1', () => {
    expect(validateSupabaseConfig({ url: 'http://127.0.0.1:54321', anonKey: 'sb_publishable_x' }).ok).toBe(true)
    expect(validateSupabaseConfig({ url: 'http://localhost:54321', anonKey: 'sb_publishable_x' }).ok).toBe(true)
    expect(validateSupabaseConfig({ url: 'http://example.com', anonKey: 'sb_publishable_x' })).toEqual({
      ok: false,
      errors: { url: 'insecure' },
    })
  })

  it('rejects a malformed URL and a non-http scheme', () => {
    expect(validateSupabaseConfig({ url: 'abcd.supabase.co', anonKey: 'sb_publishable_x' })).toEqual({
      ok: false,
      errors: { url: 'invalid' },
    })
    expect(validateSupabaseConfig({ url: 'ftp://abcd.supabase.co', anonKey: 'sb_publishable_x' })).toEqual({
      ok: false,
      errors: { url: 'insecure' },
    })
  })

  it('rejects secret and service_role keys, an empty key and an oversized key', () => {
    const url = 'https://abcd.supabase.co'
    expect(validateSupabaseConfig({ url, anonKey: 'sb_secret_abc' })).toEqual({ ok: false, errors: { anonKey: 'secret' } })
    expect(validateSupabaseConfig({ url, anonKey: jwt('service_role') })).toEqual({ ok: false, errors: { anonKey: 'secret' } })
    expect(validateSupabaseConfig({ url, anonKey: '  ' })).toEqual({ ok: false, errors: { anonKey: 'missing' } })
    expect(validateSupabaseConfig({ url, anonKey: 'x'.repeat(513) })).toEqual({ ok: false, errors: { anonKey: 'invalid' } })
  })

  it('reports both fields at once and tolerates non-string input', () => {
    expect(validateSupabaseConfig({ url: 42, anonKey: undefined })).toEqual({
      ok: false,
      errors: { url: 'invalid', anonKey: 'missing' },
    })
  })
})
