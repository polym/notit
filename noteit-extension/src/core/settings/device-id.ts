// Per-install device id (architecture.md D1/D4). Generated on first use, persisted in
// chrome.storage.local and never cleared on sign-out.
import { STORAGE_KEYS } from './keys.ts'

let pending: Promise<string> | null = null

async function loadOrCreate(): Promise<string> {
  const key = STORAGE_KEYS.deviceId
  const items = await chrome.storage.local.get(key)
  const existing = items[key]
  if (typeof existing === 'string' && existing.length > 0) return existing
  const id = crypto.randomUUID()
  await chrome.storage.local.set({ [key]: id })
  return id
}

/** Returns the device id, creating and persisting it on the first call. */
export function getDeviceId(): Promise<string> {
  // Memoize the in-flight promise so concurrent first calls cannot generate two ids.
  pending ??= loadOrCreate().catch((e: unknown) => {
    pending = null
    throw e
  })
  return pending
}

/** Test hook: forget the memoized value so the next call reads storage again. */
export function resetDeviceIdCache(): void {
  pending = null
}
