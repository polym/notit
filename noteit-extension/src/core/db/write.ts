// Local writes (architecture.md D4, single writer). Import only from service worker code.
// Every mutation stamps editedAt (D1) and writes the record plus its outbox item in one rw
// transaction, so "saved" means the transaction committed (NFR5).
import { getDb } from './schema.ts'
import { stamp } from '../clock/index.ts'
import type { HighlightRecord } from '../model/highlight.ts'
import type { MetaKey, MetaRecord } from './schema.ts'
import { mergeAction, wins } from '../sync/merge.ts'

/** Fields the writer owns; callers supply everything else. */
export type HighlightDraft = Omit<HighlightRecord, 'editedAt' | 'deviceId'>

/**
 * Inserts or replaces a record. createdAt of an existing row is preserved.
 * deviceId is passed in because chrome.storage cannot be awaited inside a Dexie transaction.
 */
export function upsert(draft: HighlightDraft, deviceId: string): Promise<HighlightRecord> {
  const db = getDb()
  return db.transaction('rw', db.highlights, db.outbox, async () => {
    const prev = await db.highlights.get(draft.id)
    const editedAt = stamp(prev?.editedAt)
    const next: HighlightRecord = { ...draft, createdAt: prev?.createdAt ?? draft.createdAt, editedAt, deviceId }
    await db.highlights.put(next)
    await db.outbox.put({ id: next.id, editedAt, attempts: 0 })
    return next
  })
}

/**
 * Inserts the record only when no row with its id exists. The existence check and the write
 * share one rw transaction, so concurrent calls with the same id produce exactly one insert.
 * When the id already exists the stored row is returned unchanged with created = false.
 */
export function insertIfAbsent(
  draft: HighlightDraft,
  deviceId: string,
): Promise<{ record: HighlightRecord; created: boolean }> {
  const db = getDb()
  return db.transaction('rw', db.highlights, db.outbox, async () => {
    const prev = await db.highlights.get(draft.id)
    if (prev) return { record: prev, created: false }
    const editedAt = stamp()
    const next: HighlightRecord = { ...draft, editedAt, deviceId }
    await db.highlights.put(next)
    await db.outbox.put({ id: next.id, editedAt, attempts: 0 })
    return { record: next, created: true }
  })
}

async function mutate(
  id: string,
  deviceId: string,
  change: (prev: HighlightRecord, editedAt: number) => Partial<HighlightRecord>,
): Promise<HighlightRecord | null> {
  const db = getDb()
  return db.transaction('rw', db.highlights, db.outbox, async () => {
    const prev = await db.highlights.get(id)
    if (!prev) return null
    const editedAt = stamp(prev.editedAt)
    const next: HighlightRecord = { ...prev, ...change(prev, editedAt), editedAt, deviceId }
    await db.highlights.put(next)
    await db.outbox.put({ id, editedAt, attempts: 0 })
    return next
  })
}

/** Applies a partial update to an existing record; returns null when the id does not exist. */
export function update(
  id: string,
  patch: Partial<Pick<HighlightRecord, 'color' | 'comment'>>,
  deviceId: string,
): Promise<HighlightRecord | null> {
  return mutate(id, deviceId, () => patch)
}

/** Soft delete: deletedAt = editedAt. Returns null when the id does not exist. */
export function softDelete(id: string, deviceId: string): Promise<HighlightRecord | null> {
  return mutate(id, deviceId, (_prev, editedAt) => ({ deletedAt: editedAt }))
}

/** Clears deletedAt with a fresh stamp. Returns null when the id does not exist. */
export function restore(id: string, deviceId: string): Promise<HighlightRecord | null> {
  return mutate(id, deviceId, () => ({ deletedAt: null }))
}

/**
 * Applies one anchor report (Q54): lost ids get or refresh a {status:'lost'} row, found ids lose
 * theirs. Ids without a highlight record are ignored. Returns the ids whose row was added or
 * removed (a refreshed checkedAt alone is not a change).
 */
export function applyAnchorReport(found: string[], lost: string[], checkedAt: number): Promise<string[]> {
  const db = getDb()
  return db.transaction('rw', db.highlights, db.anchorStatus, async () => {
    const changed: string[] = []
    const ids = [...new Set([...found, ...lost])]
    const [records, rows] = await Promise.all([db.highlights.bulkGet(ids), db.anchorStatus.bulkGet(ids)])
    const known = new Set(records.filter((r) => r !== undefined).map((r) => r.id))
    const present = new Set(rows.filter((r) => r !== undefined).map((r) => r.id))
    const lostSet = new Set(lost)
    for (const id of found) {
      // A report listing an id as both found and lost keeps the lost verdict.
      if (lostSet.has(id) || !present.has(id)) continue
      await db.anchorStatus.delete(id)
      changed.push(id)
    }
    for (const id of lostSet) {
      if (!known.has(id)) continue
      await db.anchorStatus.put({ id, status: 'lost', checkedAt })
      if (!present.has(id)) changed.push(id)
    }
    return changed
  })
}

/** One pushed record: the snapshot that was sent and the row the server holds now (null if absent). */
export interface PushOutcome {
  snapshot: HighlightRecord
  remote: HighlightRecord | null
}

/** Ids touched by reconciliation: outbox items removed, and records overwritten by the remote row. */
export interface PushReconcile {
  cleared: string[]
  applied: HighlightRecord[]
}

/**
 * Reconciles one sync_push batch (architecture.md "Push") in a single rw transaction:
 * - accepted (remote equals the snapshot): drop the outbox item unless the record was edited
 *   again meanwhile; fill in the server userId without restamping;
 * - rejected (remote differs): apply the remote row when it wins LWW against the current local
 *   record, then drop the outbox item. A local edit made during the push that beats the remote
 *   row keeps its outbox item so it is pushed next;
 * - remote missing (invalid or absent row): keep the outbox item for the next attempt.
 * Remote writes never enter the outbox (FR36).
 */
export function applyPushResult(outcomes: PushOutcome[]): Promise<PushReconcile> {
  const db = getDb()
  return db.transaction('rw', db.highlights, db.outbox, async () => {
    const cleared: string[] = []
    const applied: HighlightRecord[] = []
    for (const { snapshot, remote } of outcomes) {
      if (!remote) continue
      const [local, item] = await Promise.all([db.highlights.get(snapshot.id), db.outbox.get(snapshot.id)])
      const editedSince = item !== undefined && item.editedAt !== snapshot.editedAt
      const accepted = remote.editedAt === snapshot.editedAt && remote.deviceId === snapshot.deviceId
      if (accepted) {
        if (local && local.userId !== remote.userId) await db.highlights.put({ ...local, userId: remote.userId })
        if (!editedSince && item) {
          await db.outbox.delete(snapshot.id)
          cleared.push(snapshot.id)
        }
        continue
      }
      if (!local || wins(remote, local)) {
        await db.highlights.put(remote)
        applied.push(remote)
        if (item) {
          await db.outbox.delete(snapshot.id)
          cleared.push(snapshot.id)
        }
      } else if (!editedSince && item) {
        // The server kept a version that does not beat ours yet differs from the snapshot; nothing
        // newer is pending locally, so the item is done (the next pull reconciles the record).
        await db.outbox.delete(snapshot.id)
        cleared.push(snapshot.id)
      }
    }
    return { cleared, applied }
  })
}

/** Records written by one pull page and the ids whose pending outbox item a newer remote row replaced. */
export interface PullApply {
  applied: HighlightRecord[]
  cleared: string[]
}

/**
 * Merges one pull page (architecture.md "Pull", D3) in a single rw transaction and advances
 * meta.pullCursor to `cursor` in the same transaction, so a failed page leaves the cursor where it
 * was. Per row: absent locally -> insert; remote wins LWW -> overwrite and drop the id's outbox
 * item; otherwise keep the local row (pending local edits survive, FR33). Remote writes never
 * enter the outbox (FR36).
 */
export function applyPullPage(remote: HighlightRecord[], cursor: number): Promise<PullApply> {
  const db = getDb()
  return db.transaction('rw', db.highlights, db.outbox, db.meta, async () => {
    const applied: HighlightRecord[] = []
    const cleared: string[] = []
    for (const row of remote) {
      const local = await db.highlights.get(row.id)
      const action = mergeAction(row, local)
      if (action === 'keep') continue
      await db.highlights.put(row)
      applied.push(row)
      if (action === 'overwrite' && (await db.outbox.get(row.id))) {
        await db.outbox.delete(row.id)
        cleared.push(row.id)
      }
    }
    await db.meta.put({ key: 'pullCursor', value: cursor })
    return { applied, cleared }
  })
}

/**
 * Counts a failed push attempt on the given outbox items (architecture.md "Retry and backoff":
 * attempts++, lastError). Items removed or re-stamped meanwhile are updated only if present.
 */
export function markOutboxFailed(ids: string[], code: string): Promise<void> {
  const db = getDb()
  return db.transaction('rw', db.outbox, async () => {
    for (const item of await db.outbox.bulkGet(ids)) {
      if (item) await db.outbox.put({ ...item, attempts: item.attempts + 1, lastError: code })
    }
  })
}

/** Writes one meta value (clockOffsetMs, lastSyncAt, ...). */
export async function setMeta(key: MetaKey, value: MetaRecord['value']): Promise<void> {
  await getDb().meta.put({ key, value })
}

/**
 * Empties every table in one rw transaction (architecture.md "Sign-out wipe" / "First sign-in
 * wipe"). With a userId the meta table is reseeded with {userId, pullCursor: 0} in the same
 * transaction, so a worker terminated midway never leaves a wiped database without its owner.
 * Tables are cleared instead of db.delete(): an open side panel connection would block the delete.
 */
export function wipeAll(userId?: string): Promise<void> {
  const db = getDb()
  return db.transaction('rw', [db.highlights, db.outbox, db.anchorStatus, db.meta, db.logs], async () => {
    await Promise.all([db.highlights.clear(), db.outbox.clear(), db.anchorStatus.clear(), db.meta.clear(), db.logs.clear()])
    if (userId !== undefined) {
      await db.meta.bulkPut([
        { key: 'userId', value: userId },
        { key: 'pullCursor', value: 0 },
      ])
    }
  })
}

export const write = { upsert, insertIfAbsent, update, softDelete, restore, applyAnchorReport, applyPushResult, applyPullPage, markOutboxFailed, setMeta, wipeAll }
