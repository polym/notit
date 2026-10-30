// LRU of translation results (spec "selection translation"): repeated lookups of the same text in
// the same context skip the provider. Held in memory and mirrored to chrome.storage.session so it
// survives service worker restarts; the browser restart clears it. Never written to disk.
import { STORAGE_KEYS } from '../../../core/settings/index.ts'
import type { TranslateResult } from '../shared/protocol.ts'

export const CACHE_SIZE = 200

/** FNV-1a 32-bit; enough to tell contexts apart in a 200-entry cache. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export function cacheKey(mode: string, text: string, context: string): string {
  return `${mode}:${text.toLowerCase()}:${hash(context)}`
}

export interface TranslateCache {
  get(key: string): Promise<TranslateResult | null>
  set(key: string, value: TranslateResult): Promise<void>
}

/**
 * Storage is injectable for tests (null keeps the cache in memory only). Omitted, it is
 * chrome.storage.session, resolved on first use so importing this module never touches chrome.
 */
export function createCache(area?: chrome.storage.StorageArea | null): TranslateCache {
  // Map keeps insertion order: the first key is the least recently used.
  let entries: Map<string, TranslateResult> | null = null
  let storage: chrome.storage.StorageArea | null = null

  async function load(): Promise<Map<string, TranslateResult>> {
    if (entries) return entries
    storage = area === undefined ? (globalThis.chrome?.storage?.session ?? null) : area
    entries = new Map()
    if (!storage) return entries
    try {
      const raw: unknown = (await storage.get(STORAGE_KEYS.translateCache))[STORAGE_KEYS.translateCache]
      if (Array.isArray(raw)) for (const [k, v] of raw as [string, TranslateResult][]) entries.set(k, v)
    } catch (e) {
      console.warn('[NoteIt] translate cache not restored', e)
    }
    return entries
  }

  async function persist(map: Map<string, TranslateResult>): Promise<void> {
    if (!storage) return
    try {
      await storage.set({ [STORAGE_KEYS.translateCache]: [...map] })
    } catch (e) {
      console.warn('[NoteIt] translate cache not saved', e)
    }
  }

  return {
    async get(key) {
      const map = await load()
      const value = map.get(key)
      if (!value) return null
      map.delete(key)
      map.set(key, value)
      return value
    },
    async set(key, value) {
      const map = await load()
      map.delete(key)
      map.set(key, value)
      while (map.size > CACHE_SIZE) map.delete(map.keys().next().value as string)
      await persist(map)
    },
  }
}
