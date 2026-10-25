// Local database (architecture.md D4): Dexie, database name "noteit", version(1).
// Nothing has shipped with this database yet, so all tables live in version(1) with no upgrade path.
import { Dexie, type EntityTable } from 'dexie'
import type { HighlightRecord } from '../model/highlight.ts'
import type { LogRecord } from '../log/types.ts'

export const DB_NAME = 'noteit'

/** One pending upload per highlight id (D4). */
export interface OutboxItem {
  id: string
  editedAt: number
  attempts: number
  lastError?: string
}

/** Present only while a highlight could not be anchored on its page (Q54). */
export interface AnchorStatusRecord {
  id: string
  status: 'lost'
  checkedAt: number
}

export type MetaKey = 'userId' | 'pullCursor' | 'lastSyncAt' | 'schemaVersion' | 'clockOffsetMs' | 'syncRetry'

export interface MetaRecord {
  key: MetaKey
  value: string | number | null
}

export type NoteitDb = Dexie & {
  highlights: EntityTable<HighlightRecord, 'id'>
  outbox: EntityTable<OutboxItem, 'id'>
  anchorStatus: EntityTable<AnchorStatusRecord, 'id'>
  meta: EntityTable<MetaRecord, 'key'>
  logs: EntityTable<LogRecord, 'seq'>
}

function createDb(): NoteitDb {
  const db = new Dexie(DB_NAME) as NoteitDb
  db.version(1).stores({
    highlights: 'id, canonicalUrl, siteKey, createdAt, [canonicalUrl+deletedAt]',
    outbox: 'id',
    anchorStatus: 'id',
    meta: 'key',
    logs: '++seq, ts',
  })
  return db
}

let instance: NoteitDb | null = null

/** Lazily opened singleton so importing this module has no IndexedDB side effects. */
export function getDb(): NoteitDb {
  instance ??= createDb()
  return instance
}
