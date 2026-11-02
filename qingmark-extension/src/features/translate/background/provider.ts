// OpenAI-compatible chat completions client for selection translation (spec "selection translation").
// fetch is injected so tests drive every provider answer. Errors leave as HandlerError codes only;
// UI text maps from the code (ui/strings.ts errorText).
import { HandlerError, type ErrorCode } from '../../../core/messaging/index.ts'
import type { TextResult, WordResult } from '../shared/protocol.ts'
import type { TranslateConfig } from './config.ts'

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>

export const REQUEST_TIMEOUT_MS = 15_000
const MAX_TOKENS = { word: 300, text: 1200 } as const
const MAX_OTHER_SENSES = 3

const WORD_PROMPT = `You are an English-Chinese dictionary. Given an English word and the sentence it appears in, answer in json with exactly these keys:
{"lemma": string, "ipa": {"us": string|null, "uk": string|null}, "pos": string, "sense": string, "otherSenses": string[]}
- lemma: dictionary form of the word.
- ipa: IPA of the lemma without slashes.
- pos: part of speech as used in the sentence, short English abbreviation (n., v., adj., adv., ...).
- sense: concise Simplified Chinese meaning as used in this sentence.
- otherSenses: up to 3 other common Simplified Chinese meanings, may be empty.
Example json: {"lemma": "run", "ipa": {"us": "rʌn", "uk": "rʌn"}, "pos": "v.", "sense": "<Chinese for 'to manage'>", "otherSenses": ["<Chinese for 'to jog'>", "<Chinese for 'to operate'>"]}`

const TEXT_PROMPT = `You are a translator. Translate the given English text into natural Simplified Chinese, using the surrounding context to resolve meaning. Answer in json with exactly one key.
Example json: {"translation": "<the Simplified Chinese translation>"}`

/** HTTP status of the provider -> error code (DeepSeek: 401 auth, 402 balance, 429 rate limit). */
export function statusCode(status: number): ErrorCode {
  if (status === 401 || status === 403) return 'unauthenticated'
  if (status === 402 || status === 429) return 'quota'
  if (status >= 500) return 'server'
  return 'bad_request'
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/** Strips the slashes or brackets a model sometimes wraps IPA in. */
function ipa(value: unknown): string | null {
  const s = str(value)
  return s ? s.replace(/^[/[]+|[/\]]+$/g, '').trim() || null : null
}

export function parseWord(content: string, word: string): WordResult | null {
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  const sense = str(o.sense)
  if (!sense) return null
  const ipaObj = typeof o.ipa === 'object' && o.ipa !== null ? (o.ipa as Record<string, unknown>) : {}
  const others = Array.isArray(o.otherSenses) ? o.otherSenses.map(str).filter((s): s is string => s !== null) : []
  return {
    mode: 'word',
    word,
    lemma: str(o.lemma) ?? word,
    ipa: { us: ipa(ipaObj.us), uk: ipa(ipaObj.uk) },
    pos: str(o.pos) ?? '',
    sense,
    otherSenses: others.filter((s) => s !== sense).slice(0, MAX_OTHER_SENSES),
  }
}

export function parseText(content: string): TextResult | null {
  try {
    const raw: unknown = JSON.parse(content)
    const translation = typeof raw === 'object' && raw !== null ? str((raw as Record<string, unknown>).translation) : null
    return translation ? { mode: 'text', translation } : null
  } catch {
    return null
  }
}

export type Query = { mode: 'word'; word: string; context: string } | { mode: 'text'; text: string; context: string }

function body(config: TranslateConfig, q: Query): string {
  const user = q.mode === 'word' ? `word: ${q.word}\nsentence: ${q.context}` : `text: ${q.text}\ncontext: ${q.context}`
  return JSON.stringify({
    model: config.model,
    temperature: 0.2,
    max_tokens: MAX_TOKENS[q.mode],
    response_format: { type: 'json_object' },
    // DeepSeek models think by default; other OpenAI-compatible providers reject unknown fields.
    ...(new URL(config.baseUrl).hostname.endsWith('deepseek.com') ? { thinking: { type: 'disabled' } } : {}),
    messages: [
      { role: 'system', content: q.mode === 'word' ? WORD_PROMPT : TEXT_PROMPT },
      { role: 'user', content: user },
    ],
  })
}

/** One round trip; resolves to the message content (possibly empty). */
async function complete(fetchFn: FetchFn, config: TranslateConfig, q: Query, signal: AbortSignal): Promise<string> {
  let res: Response
  try {
    res = await fetchFn(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
      body: body(config, q),
      signal,
    })
  } catch (e) {
    if (signal.aborted && signal.reason === 'cancelled') throw new HandlerError('bad_request', 'cancelled')
    throw new HandlerError('network', e instanceof Error ? e.message : String(e))
  }
  if (!res.ok) throw new HandlerError(statusCode(res.status), `provider answered HTTP ${res.status}`)
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new HandlerError('server', 'provider answered a non-JSON body')
  }
  const content = (json as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content
  return typeof content === 'string' ? content : ''
}

/**
 * Translates `q`. JSON mode may answer empty or off-schema content now and then, so one retry
 * follows; a second miss is bad_request. `signal` aborted with reason 'cancelled' rejects with
 * bad_request 'cancelled'; the timeout rejects with network.
 */
export async function translate(
  fetchFn: FetchFn,
  config: TranslateConfig,
  q: Query,
  cancel?: AbortSignal,
): Promise<WordResult | TextResult> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const signal = cancel ? AbortSignal.any([cancel, timeout]) : timeout
  for (let attempt = 0; attempt < 2; attempt++) {
    const content = await complete(fetchFn, config, q, signal)
    const result = q.mode === 'word' ? parseWord(content, q.word) : parseText(content)
    if (result) return result
  }
  throw new HandlerError('bad_request', 'provider answered unusable content')
}
