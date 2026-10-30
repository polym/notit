// translate/* request handlers (spec "selection translation"). The provider is reached only from
// here, so the API key never leaves the service worker. fetch, storage and the cache are injectable
// for tests; translateHandlers is the production wiring.
import { HandlerError, type Handlers } from '../../../core/messaging/index.ts'
import { MAX_CONTEXT_LENGTH, MAX_TEXT_LENGTH, singleWord } from '../shared/classify.ts'
import type { TranslateRequests } from '../shared/protocol.ts'
import { cacheKey, createCache, type TranslateCache } from './cache.ts'
import { getTranslateConfig, resolveInput, setTranslateConfig, toView } from './config.ts'
import { translate, type FetchFn, type Query } from './provider.ts'

export interface TranslateDeps {
  fetch: FetchFn
  cache: TranslateCache
}

/** Cuts `context` to MAX_CONTEXT_LENGTH characters, keeping `text` inside the window when it is there. */
export function clipContext(context: string, text: string): string {
  const c = context.replace(/\s+/g, ' ').trim()
  if (c.length <= MAX_CONTEXT_LENGTH) return c
  const at = c.indexOf(text)
  if (at < 0) return c.slice(0, MAX_CONTEXT_LENGTH)
  const start = Math.max(0, Math.min(at - Math.floor((MAX_CONTEXT_LENGTH - text.length) / 2), c.length - MAX_CONTEXT_LENGTH))
  return c.slice(start, start + MAX_CONTEXT_LENGTH)
}

function query(rawText: unknown, rawContext: unknown): Query {
  if (typeof rawText !== 'string' || rawText.trim() === '') throw new HandlerError('bad_request', 'empty text')
  const text = rawText.replace(/\s+/g, ' ').trim()
  if (text.length > MAX_TEXT_LENGTH) throw new HandlerError('bad_request', 'text too long')
  const context = clipContext(typeof rawContext === 'string' ? rawContext : '', text) || text
  const word = singleWord(text)
  return word ? { mode: 'word', word, context } : { mode: 'text', text, context }
}

export function createTranslateHandlers(deps: TranslateDeps): Handlers<TranslateRequests> {
  const inflight = new Map<string, AbortController>()

  return {
    async 'translate/lookup'(req) {
      const q = query(req?.text, req?.context)
      const config = await getTranslateConfig()
      if (!config) throw new HandlerError('not_configured', 'no translation provider configured')
      const key = cacheKey(q.mode, q.mode === 'word' ? q.word : q.text, q.context)
      const cached = await deps.cache.get(key)
      if (cached) return cached
      const controller = new AbortController()
      const id = typeof req.requestId === 'string' ? req.requestId : null
      if (id) inflight.set(id, controller)
      try {
        const result = await translate(deps.fetch, config, q, controller.signal)
        await deps.cache.set(key, result)
        return result
      } finally {
        if (id) inflight.delete(id)
      }
    },
    async 'translate/cancel'(req) {
      inflight.get(req?.requestId)?.abort('cancelled')
    },
    async 'translate/getConfig'() {
      return toView(await getTranslateConfig())
    },
    async 'translate/saveConfig'(req) {
      const config = await resolveInput(req)
      await setTranslateConfig(config)
      return toView(config)
    },
    async 'translate/testConfig'(req) {
      const config = await resolveInput(req)
      await translate(deps.fetch, config, { mode: 'word', word: 'test', context: 'This is a test.' })
      return { reachable: true as const }
    },
    async 'translate/openSettings'(_req, sender) {
      // Chrome keeps the card click's user gesture across this message; without chrome.sidePanel
      // (Arc) or a window the request fails quietly and the card stays as it is.
      const windowId = sender?.tab?.windowId
      if (windowId === undefined || !globalThis.chrome?.sidePanel) throw new HandlerError('bad_request', 'no side panel for the sender')
      await chrome.sidePanel.open({ windowId })
    },
  }
}

export const translateHandlers = createTranslateHandlers({
  fetch: (input, init) => fetch(input, init),
  cache: createCache(),
})
