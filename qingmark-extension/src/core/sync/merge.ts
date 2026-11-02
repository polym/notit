// LWW comparison (architecture.md D1). The same rule runs server side in sync_push;
// both are checked against tests/fixtures/lww-cases.json.
import type { HighlightRecord } from '../model/index.ts'

/** The fields that decide which version of a record is kept. */
export type LwwKey = Pick<HighlightRecord, 'editedAt' | 'deviceId'>

/**
 * True when `a` beats `b`: (editedAt, deviceId) compared lexicographically, strictly greater.
 * Ties keep `b` (the stored version). A delete is an ordinary edit: deletedAt plays no part.
 * deviceId is compared by UTF-16 code unit, which equals sync_push's collate "C" for ASCII ids.
 */
export function wins(a: LwwKey, b: LwwKey): boolean {
  if (a.editedAt !== b.editedAt) return a.editedAt > b.editedAt
  return a.deviceId > b.deviceId
}

/** What a pull does with one remote row (architecture.md "Sync Algorithm": pull). */
export type MergeAction = 'insert' | 'overwrite' | 'keep'

/**
 * insert: no local row; overwrite: the remote row beats the local one (any pending outbox item for
 * the id is dropped); keep: the local row is equal or newer (a pending local edit is never
 * overwritten, FR33). Remote writes never enter the outbox (FR36).
 */
export function mergeAction(remote: LwwKey, local: LwwKey | undefined): MergeAction {
  if (!local) return 'insert'
  return wins(remote, local) ? 'overwrite' : 'keep'
}
