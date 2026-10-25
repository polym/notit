// Supabase auth storage backed by chrome.storage.local (architecture.md D5, #21, NFR14).
// The session never enters the synced storage area, so it does not follow the browser account.
// This is the only file outside core/settings allowed to touch chrome.storage.local.
import type { SupportedStorage } from '@supabase/supabase-js'

export const chromeLocalStorageAdapter: SupportedStorage = {
  async getItem(key: string): Promise<string | null> {
    const items = await chrome.storage.local.get(key)
    const value = items[key]
    return typeof value === 'string' ? value : null
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value })
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key)
  },
}
