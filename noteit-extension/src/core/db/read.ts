// Read-only queries over the local database (architecture.md D4, D12).
// Safe to import from the sidebar; all writes go through core/db/write in the service worker.
import { getDb, type MetaKey, type MetaRecord, type OutboxItem } from './schema.ts'

export type { OutboxItem } from './schema.ts'
import type { HighlightRecord } from '../model/highlight.ts'

/** Live (not soft-deleted) highlights for one canonical URL, oldest first. */
export async function byCanonicalUrl(canonicalUrl: string): Promise<HighlightRecord[]> {
  // IndexedDB cannot index null, so live rows are selected via the canonicalUrl index and filtered.
  const rows = await getDb().highlights.where('canonicalUrl').equals(canonicalUrl).toArray()
  return rows.filter((r) => r.deletedAt === null).sort((a, b) => a.createdAt - b.createdAt)
}

/** Newest live highlights by createdAt (descending), walking the createdAt index. */
export function recent(limit: number): Promise<HighlightRecord[]> {
  return getDb()
    .highlights.orderBy('createdAt')
    .reverse()
    .filter((r) => r.deletedAt === null)
    .limit(limit)
    .toArray()
}

/** Live highlights of the given canonical URLs, in no particular order (all-sites page groups). */
export async function byCanonicalUrls(canonicalUrls: readonly string[]): Promise<HighlightRecord[]> {
  if (canonicalUrls.length === 0) return []
  const rows = await getDb().highlights.where('canonicalUrl').anyOf([...canonicalUrls]).toArray()
  return rows.filter((r) => r.deletedAt === null)
}

/** Number of live highlights (all-sites item-count). */
export function liveCount(): Promise<number> {
  return getDb().highlights.filter((r) => r.deletedAt === null).count()
}

/** One record by id, including soft-deleted ones. */
export function byId(id: string): Promise<HighlightRecord | undefined> {
  return getDb().highlights.get(id)
}

/** Every highlight id, including soft-deleted ones (diagnostics). */
export async function allIds(): Promise<string[]> {
  return (await getDb().highlights.toCollection().primaryKeys()) as string[]
}

/** id, editedAt and deletedAt of every highlight, including soft-deleted ones, by id (diagnostics export). */
export async function idList(): Promise<Array<Pick<HighlightRecord, 'id' | 'editedAt' | 'deletedAt'>>> {
  const rows = await getDb().highlights.orderBy('id').toArray()
  return rows.map((r) => ({ id: r.id, editedAt: r.editedAt, deletedAt: r.deletedAt }))
}

/** Whether a site has at least one live highlight (D8 "hasHighlights"). */
export async function hasLiveForSite(siteKey: string): Promise<boolean> {
  const first = await getDb()
    .highlights.where('siteKey')
    .equals(siteKey)
    .filter((r) => r.deletedAt === null)
    .first()
  return first !== undefined
}

export function outboxItems(): Promise<OutboxItem[]> {
  return getDb().outbox.toArray()
}

/** The first `limit` outbox items in id order (push batches). */
export function outboxBatch(limit: number): Promise<OutboxItem[]> {
  return getDb().outbox.orderBy('id').limit(limit).toArray()
}

/** Records for the given ids, in the same order (undefined where missing). */
export function byIds(ids: string[]): Promise<Array<HighlightRecord | undefined>> {
  return getDb().highlights.bulkGet(ids)
}

/** One meta value; undefined when unset. */
export async function getMeta(key: MetaKey): Promise<MetaRecord['value'] | undefined> {
  return (await getDb().meta.get(key))?.value
}

export function outboxCount(): Promise<number> {
  return getDb().outbox.count()
}

/** Ids of highlights that could not be anchored the last time their page was checked (Q54). */
export async function lostIds(): Promise<string[]> {
  return (await getDb().anchorStatus.toCollection().primaryKeys()) as string[]
}

export const read = {
  byCanonicalUrl,
  recent,
  byCanonicalUrls,
  liveCount,
  byId,
  allIds,
  idList,
  hasLiveForSite,
  outboxItems,
  outboxBatch,
  byIds,
  getMeta,
  outboxCount,
  lostIds,
}
