// Translation provider config (spec "selection translation"). Local only, never synced, kept across
// sign-out. The API key is read only here, in the service worker; the side panel gets a masked view.
import { HandlerError } from '../../../core/messaging/index.ts'
import { getStoredTranslateConfig, setStoredTranslateConfig } from '../../../core/settings/index.ts'
import type { TranslateConfigInput, TranslateConfigView } from '../shared/protocol.ts'

export const DEFAULT_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_MODEL = 'deepseek-flash'

const MAX_KEY_LENGTH = 512
const MAX_MODEL_LENGTH = 128
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

export interface TranslateConfig {
  baseUrl: string
  model: string
  apiKey: string
}

/** Normalized https base URL (http only for localhost), without a trailing slash; null when invalid. */
export function normalizeBaseUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return null
  }
  const secure = parsed.protocol === 'https:' || (parsed.protocol === 'http:' && LOCAL_HOSTS.has(parsed.hostname))
  if (!secure || parsed.search || parsed.hash) return null
  return parsed.origin + parsed.pathname.replace(/\/+$/, '')
}

function checkModel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const model = raw.trim()
  return model && model.length <= MAX_MODEL_LENGTH ? model : null
}

function checkKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim()
  return key && key.length <= MAX_KEY_LENGTH && !/\s/.test(key) ? key : null
}

/** The saved config; a hand-edited or partial entry yields null so lookups report not_configured. */
export async function getTranslateConfig(): Promise<TranslateConfig | null> {
  const raw = await getStoredTranslateConfig()
  if (!raw) return null
  const baseUrl = normalizeBaseUrl(raw.baseUrl)
  const model = checkModel(raw.model)
  const apiKey = checkKey(raw.apiKey)
  return baseUrl && model && apiKey ? { baseUrl, model, apiKey } : null
}

export function toView(config: TranslateConfig | null): TranslateConfigView {
  if (!config) return { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, hasKey: false, keyHint: null }
  return { baseUrl: config.baseUrl, model: config.model, hasKey: true, keyHint: config.apiKey.slice(-4) }
}

/**
 * Validates the panel input; an empty apiKey falls back to the saved key. Throws bad_request for
 * an invalid field and not_configured when there is no key at all.
 */
export async function resolveInput(input: TranslateConfigInput): Promise<TranslateConfig> {
  const baseUrl = normalizeBaseUrl(input?.baseUrl)
  if (!baseUrl) throw new HandlerError('bad_request', 'invalid base URL')
  const model = checkModel(input?.model)
  if (!model) throw new HandlerError('bad_request', 'invalid model')
  const given = typeof input?.apiKey === 'string' && input.apiKey.trim() !== ''
  const apiKey = given ? checkKey(input.apiKey) : ((await getTranslateConfig())?.apiKey ?? null)
  if (given && !apiKey) throw new HandlerError('bad_request', 'invalid API key')
  if (!apiKey) throw new HandlerError('not_configured', 'no API key')
  return { baseUrl, model, apiKey }
}

export async function setTranslateConfig(config: TranslateConfig): Promise<void> {
  await setStoredTranslateConfig(config)
}
