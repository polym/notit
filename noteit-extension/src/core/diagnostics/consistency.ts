// SC-1 manual consistency check (architecture.md "Diagnostics"): the shape of the local id export
// written by debug.html and the pure comparison used by scripts/verify-consistency.ts.
// The export carries only {id, editedAt, deletedAt}: no text, comment or URL ever leaves the device.

export const LOCAL_ID_EXPORT_KIND = 'noteit/local-ids'

export interface LocalIdEntry {
  id: string
  editedAt: number
  /** Soft delete timestamp in ms; null for live highlights. */
  deletedAt: number | null
}

export interface LocalIdExport {
  kind: typeof LOCAL_ID_EXPORT_KIND
  version: 1
  /** ms since epoch. */
  exportedAt: number
  entries: LocalIdEntry[]
}

export function buildLocalIdExport(entries: readonly LocalIdEntry[], exportedAt: number): LocalIdExport {
  // Copy field by field so nothing but the three allowed fields can end up in the file.
  const clean = entries
    .map((e) => ({ id: e.id, editedAt: e.editedAt, deletedAt: e.deletedAt }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { kind: LOCAL_ID_EXPORT_KIND, version: 1, exportedAt, entries: clean }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Validates a parsed export file; throws with a short reason on anything unexpected. */
export function parseLocalIdExport(value: unknown): LocalIdExport {
  if (!isObject(value) || value.kind !== LOCAL_ID_EXPORT_KIND || value.version !== 1) {
    throw new Error('not a NoteIt local id export (kind / version)')
  }
  if (typeof value.exportedAt !== 'number' || !Array.isArray(value.entries)) {
    throw new Error('export needs exportedAt and entries')
  }
  const entries = value.entries.map((raw: unknown, i: number): LocalIdEntry => {
    if (
      !isObject(raw) ||
      typeof raw.id !== 'string' ||
      raw.id === '' ||
      typeof raw.editedAt !== 'number' ||
      !(raw.deletedAt === null || typeof raw.deletedAt === 'number')
    ) {
      throw new Error(`entry ${i} needs id, editedAt and deletedAt`)
    }
    return { id: raw.id, editedAt: raw.editedAt, deletedAt: raw.deletedAt }
  })
  return { kind: LOCAL_ID_EXPORT_KIND, version: 1, exportedAt: value.exportedAt, entries }
}

/**
 * One row of the cloud snapshot (`select id, canonical_url, text, anchor, edited_at, deleted_at`
 * under the user's own session). Text and anchor are only used in memory to find duplicates.
 */
export interface CloudRow {
  id: string
  canonical_url: string
  text: string
  anchor: { start: number; end: number } | null
  edited_at: number
  deleted_at: number | null
}

export interface DeviceReport {
  name: string
  /** Cloud ids absent on this device. */
  missingLocally: string[]
  /** Device ids absent in the cloud. */
  missingInCloud: string[]
  /** Ids present on both sides whose editedAt or deletedAt differ. */
  mismatched: string[]
}

export interface ConsistencyReport {
  /** Sum of missingLocally + missingInCloud over every device. */
  missing: number
  /** Live cloud rows beyond the first of each same-text same-position group. */
  duplicates: number
  /** Sum of mismatched over every device (reported, not part of the 0 / 0 verdict). */
  mismatched: number
  devices: DeviceReport[]
  /** Ids of each duplicate group (two or more ids). */
  duplicateGroups: string[][]
}

/**
 * Same page, same text, same position. Rows without an anchor (e.g. migrated legacy rows) have
 * an unknown position, which is never "the same position", so they get no key and never count
 * as duplicates.
 */
function duplicateKey(row: CloudRow): string | null {
  if (row.anchor === null) return null
  return JSON.stringify([row.canonical_url, row.text, row.anchor.start, row.anchor.end])
}

export function compareConsistency(
  devices: ReadonlyArray<{ name: string; export: LocalIdExport }>,
  cloud: readonly CloudRow[],
): ConsistencyReport {
  const cloudById = new Map(cloud.map((r) => [r.id, r]))
  const reports = devices.map(({ name, export: exp }): DeviceReport => {
    const localById = new Map(exp.entries.map((e) => [e.id, e]))
    const missingLocally = cloud.filter((r) => !localById.has(r.id)).map((r) => r.id)
    const missingInCloud = exp.entries.filter((e) => !cloudById.has(e.id)).map((e) => e.id)
    const mismatched = exp.entries
      .filter((e) => {
        const r = cloudById.get(e.id)
        return r !== undefined && (r.edited_at !== e.editedAt || r.deleted_at !== e.deletedAt)
      })
      .map((e) => e.id)
    return { name, missingLocally: missingLocally.sort(), missingInCloud: missingInCloud.sort(), mismatched: mismatched.sort() }
  })

  const groups = new Map<string, string[]>()
  for (const row of cloud) {
    if (row.deleted_at !== null) continue
    const key = duplicateKey(row)
    if (key === null) continue
    const ids = groups.get(key)
    if (ids) ids.push(row.id)
    else groups.set(key, [row.id])
  }
  const duplicateGroups = [...groups.values()].filter((ids) => ids.length > 1).map((ids) => ids.sort())

  return {
    missing: reports.reduce((n, r) => n + r.missingLocally.length + r.missingInCloud.length, 0),
    duplicates: duplicateGroups.reduce((n, ids) => n + ids.length - 1, 0),
    mismatched: reports.reduce((n, r) => n + r.mismatched.length, 0),
    devices: reports,
    duplicateGroups,
  }
}
