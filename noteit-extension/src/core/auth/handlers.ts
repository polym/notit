// Service worker handlers for auth/* requests (architecture.md D5 / D6).
import { HandlerError, type Handlers } from '../messaging/index.ts'
import { clearStoredSupabaseConfig, setStoredSupabaseConfig } from '../settings/index.ts'
import type { AuthRequests } from './protocol.ts'
import { activeSupabaseConfig, buildSupabaseConfig } from './client.ts'
import { validateSupabaseConfig, type SupabaseConfig } from './config.ts'
import { getAuthState, login, logout, switchServer } from './session.ts'
import { read } from '../db/read.ts'

const MAX_FIELD_LENGTH = 512
/** Upper bound for the login page connection test, so a black-holed host does not hang the form. */
const TEST_TIMEOUT_MS = 8_000

function isCredential(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_FIELD_LENGTH
}

function checkedConfig(req: unknown): SupabaseConfig {
  const { url, anonKey } = (req ?? {}) as { url?: unknown; anonKey?: unknown }
  const result = validateSupabaseConfig({ url, anonKey })
  if (!result.ok) throw new HandlerError('bad_request', `invalid config: ${Object.keys(result.errors).join(', ')}`)
  return result.config
}

/** One unauthenticated read of the candidate server's auth settings: reachable and key accepted. */
async function probe(config: SupabaseConfig): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${config.url}/auth/v1/settings`, {
      headers: { apikey: config.anonKey },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    })
  } catch {
    throw new HandlerError('network', 'server unreachable')
  }
  if (response.ok) return
  if (response.status === 401 || response.status === 403) throw new HandlerError('unauthenticated', 'key rejected')
  if (response.status >= 500) throw new HandlerError('server', `status ${response.status}`)
  // A host that answers but is not a Supabase project (404 and friends).
  throw new HandlerError('network', `status ${response.status}`)
}

export const authHandlers: Handlers<AuthRequests> = {
  async 'auth/login'(req) {
    const { email, password } = (req ?? {}) as { email?: unknown; password?: unknown }
    if (!isCredential(email) || !isCredential(password)) {
      throw new HandlerError('bad_request', 'email and password are required')
    }
    const result = await login(email.trim(), password)
    if (!result.ok) throw new HandlerError(result.error.code, result.error.message)
    return result.data
  },
  async 'auth/logout'() {
    await logout()
  },
  async 'auth/getState'() {
    return getAuthState()
  },
  async 'auth/getPendingCount'() {
    return { pending: await read.outboxCount() }
  },
  async 'auth/getConfig'() {
    const { config, source } = await activeSupabaseConfig()
    return { url: config?.url ?? null, source, hasBuildDefault: buildSupabaseConfig() !== null }
  },
  async 'auth/setConfig'(req) {
    const config = checkedConfig(req)
    await switchServer(() => setStoredSupabaseConfig(config))
    return { url: config.url, source: 'user' as const }
  },
  async 'auth/resetConfig'() {
    await switchServer(clearStoredSupabaseConfig)
    const { config, source } = await activeSupabaseConfig()
    return { url: config?.url ?? null, source: source === 'build' ? ('build' as const) : ('none' as const) }
  },
  async 'auth/testConfig'(req) {
    await probe(checkedConfig(req))
    return { reachable: true as const }
  },
}
