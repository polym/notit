// Classification of IndexedDB / Dexie failures into messaging error codes.
import type { ErrorCode } from '../messaging/types.ts'

const QUOTA_NAMES = new Set(['QuotaExceededError', 'QuotaExceeded'])

/**
 * Returns true when the error (or an error it wraps) is a storage quota failure.
 * Dexie wraps the native DOMException in AbortError / its own classes via `inner` or `cause`.
 */
export function isQuotaError(e: unknown): boolean {
  let current: unknown = e
  for (let depth = 0; depth < 5 && typeof current === 'object' && current !== null; depth++) {
    const { name, inner, cause } = current as { name?: unknown; inner?: unknown; cause?: unknown }
    if (typeof name === 'string' && QUOTA_NAMES.has(name)) return true
    current = inner ?? cause
  }
  return false
}

/** Maps a database failure to 'quota' or 'internal'. */
export function dbErrorCode(e: unknown): Extract<ErrorCode, 'quota' | 'internal'> {
  return isQuotaError(e) ? 'quota' : 'internal'
}
