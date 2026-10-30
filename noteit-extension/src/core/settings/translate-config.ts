// Translation provider config (spec "selection translation"). Local only, never synced, and kept
// across sign-out and the first sign-in wipe. The value is returned raw: features/translate
// validates it before use, so a hand-edited entry cannot slip through.
import { STORAGE_KEYS } from './keys.ts'

export interface StoredTranslateConfig {
  baseUrl: unknown
  model: unknown
  apiKey: unknown
}

export async function getStoredTranslateConfig(): Promise<StoredTranslateConfig | null> {
  const key = STORAGE_KEYS.translateConfig
  const value: unknown = (await chrome.storage.local.get(key))[key]
  if (typeof value !== 'object' || value === null) return null
  const { baseUrl, model, apiKey } = value as Record<string, unknown>
  return { baseUrl, model, apiKey }
}

export async function setStoredTranslateConfig(config: { baseUrl: string; model: string; apiKey: string }): Promise<void> {
  await chrome.storage.local.set({
    [STORAGE_KEYS.translateConfig]: { baseUrl: config.baseUrl, model: config.model, apiKey: config.apiKey, savedAt: Date.now() },
  })
}
