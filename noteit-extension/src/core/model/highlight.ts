// Highlight data model (architecture.md D4).

export type ColorName = 'yellow' | 'orange' | 'blue' | 'green'

/** Every stored color name, in display order (yellow first, the default). */
export const COLOR_NAMES: readonly ColorName[] = ['yellow', 'orange', 'blue', 'green']

/** True for a stored color name; inbound data is validated with this, never with a local list. */
export const isColorName = (value: unknown): value is ColorName =>
  typeof value === 'string' && (COLOR_NAMES as readonly string[]).includes(value)

/** W3C TextPosition + TextQuote. Offsets are positions in the TextIndex (architecture.md D7). */
export interface TextAnchor {
  start: number
  end: number
  exact: string
  /** Up to 32 characters before the quote. */
  prefix: string
  /** Up to 32 characters after the quote. */
  suffix: string
}

export interface HighlightRecord {
  /** crypto.randomUUID(); legacy ids are kept. */
  id: string
  userId: string
  canonicalUrl: string
  siteKey: string
  /** Raw href at creation time. */
  url: string
  text: string
  color: ColorName
  comment: string | null
  /** null for legacy rows without offsets. */
  anchor: TextAnchor | null
  pageTitle: string | null
  favicon: string | null
  /** ms since epoch, set once. */
  createdAt: number
  /** ms since epoch, LWW clock (D1). */
  editedAt: number
  /** Device that produced editedAt. */
  deviceId: string
  /** Soft delete timestamp in ms. */
  deletedAt: number | null
  schemaVersion: 1
}

/**
 * Shape stored by the pre-M1 code in chrome.storage.local under "highlights".
 * Kept until the storage switch (Stories 2.6-2.8) and the migration script (Story 2.20).
 */
export interface LegacyHighlight {
  id: string
  text: string
  url: string
  color: string
  timestamp: number
  start?: number
  length?: number
  context?: {
    prefix: string
    suffix: string
    offset: number
  }
  xpath?: string
  comment?: string
  pageTitle?: string
  favicon?: string
}

export interface LegacyStorageSchema {
  highlights: LegacyHighlight[]
  /** URLs where the extension was manually enabled. */
  enabledSites?: string[]
}
