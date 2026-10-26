// Supabase connection config entered on the login page (spec "login-supabase-config"). Pure and
// free of supabase-js and chrome APIs, so the side panel form and the service worker handlers share
// the same rules.

export interface SupabaseConfig {
  url: string
  anonKey: string
}

/** Where the active config came from: saved on the login page, injected at build time, or nothing. */
export type ConfigSource = 'user' | 'build' | 'none'

export type ConfigUrlError = 'invalid' | 'insecure'
export type ConfigKeyError = 'missing' | 'invalid' | 'secret'
export interface ConfigErrors {
  url?: ConfigUrlError
  anonKey?: ConfigKeyError
}

export type ConfigValidation = { ok: true; config: SupabaseConfig } | { ok: false; errors: ConfigErrors }

const MAX_KEY_LENGTH = 512
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

function checkUrl(raw: unknown): { url: string } | { error: ConfigUrlError } {
  if (typeof raw !== 'string') return { error: 'invalid' }
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return { error: 'invalid' }
  }
  const secure = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname))
  if (!secure) return { error: 'insecure' }
  return { url: parsed.origin + parsed.pathname.replace(/\/+$/, '') }
}

/** The `role` claim of a JWT, or null when the value is not a decodable JWT. */
function jwtRole(token: string): string | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const json = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
    const payload: unknown = JSON.parse(json)
    if (payload && typeof payload === 'object' && 'role' in payload && typeof payload.role === 'string') return payload.role
    return null
  } catch {
    return null
  }
}

function checkKey(raw: unknown): { anonKey: string } | { error: ConfigKeyError } {
  if (typeof raw !== 'string' || raw.trim() === '') return { error: 'missing' }
  const key = raw.trim()
  if (key.length > MAX_KEY_LENGTH) return { error: 'invalid' }
  // Never store a key that bypasses row level security in the browser.
  if (key.startsWith('sb_secret_')) return { error: 'secret' }
  const role = jwtRole(key)
  if (role !== null && role !== 'anon') return { error: 'secret' }
  return { anonKey: key }
}

/** Validates and normalizes a config from untrusted input (form fields or a message payload). */
export function validateSupabaseConfig(input: { url: unknown; anonKey: unknown }): ConfigValidation {
  const url = checkUrl(input.url)
  const key = checkKey(input.anonKey)
  if ('url' in url && 'anonKey' in key) return { ok: true, config: { url: url.url, anonKey: key.anonKey } }
  const errors: ConfigErrors = {}
  if ('error' in url) errors.url = url.error
  if ('error' in key) errors.anonKey = key.error
  return { ok: false, errors }
}
