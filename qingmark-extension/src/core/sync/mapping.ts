// camelCase <-> snake_case mapping between HighlightRecord and public.highlights rows
// (architecture.md "TS data" and "Inbound validation"). This is the only place that converts.
// Remote rows are validated by hand (no schema library [proxy]).
import { log } from '../log/index.ts'
import { isColorName, type ColorName, type HighlightRecord, type TextAnchor } from '../model/index.ts'

/** A sync_push payload row. user_id and server_seq are owned by the server. */
export interface PushRow {
  id: string
  canonical_url: string
  site_key: string
  url: string
  text: string
  color: ColorName
  comment: string | null
  anchor: TextAnchor | null
  page_title: string | null
  favicon: string | null
  created_at: number
  edited_at: number
  device_id: string
  deleted_at: number | null
}

export function toPushRow(record: HighlightRecord): PushRow {
  return {
    id: record.id,
    canonical_url: record.canonicalUrl,
    site_key: record.siteKey,
    url: record.url,
    text: record.text,
    color: record.color,
    comment: record.comment,
    anchor: record.anchor,
    page_title: record.pageTitle,
    favicon: record.favicon,
    created_at: record.createdAt,
    edited_at: record.editedAt,
    device_id: record.deviceId,
    deleted_at: record.deletedAt,
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === 'string'
}

/** bigint columns arrive as JSON numbers; accept numeric strings too (PostgREST may stringify). */
function toMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isSafeInteger(v)) return v
  if (typeof v === 'string' && /^-?\d+$/.test(v)) {
    const n = Number(v)
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

function parseAnchor(v: unknown): TextAnchor | null | undefined {
  if (v === null || v === undefined) return null
  if (
    isObject(v) &&
    Number.isFinite(v.start) &&
    Number.isFinite(v.end) &&
    typeof v.exact === 'string' &&
    typeof v.prefix === 'string' &&
    typeof v.suffix === 'string'
  ) {
    return { start: v.start as number, end: v.end as number, exact: v.exact, prefix: v.prefix, suffix: v.suffix }
  }
  return undefined
}

/** Field name of the first invalid column, or null when the row is valid. */
function invalidField(row: Record<string, unknown>): string | null {
  for (const key of ['id', 'user_id', 'canonical_url', 'site_key', 'url', 'text', 'device_id'] as const) {
    if (typeof row[key] !== 'string' || (key === 'id' && row[key] === '')) return key
  }
  if (!isColorName(row.color)) return 'color'
  for (const key of ['comment', 'page_title', 'favicon'] as const) {
    if (!isNullableString(row[key])) return key
  }
  if (parseAnchor(row.anchor) === undefined) return 'anchor'
  if (toMs(row.created_at) === null) return 'created_at'
  if (toMs(row.edited_at) === null) return 'edited_at'
  if (row.deleted_at !== null && toMs(row.deleted_at) === null) return 'deleted_at'
  return null
}

/**
 * Validates a row returned by Supabase and converts it to a HighlightRecord.
 * Returns null (and logs a warn entry without content) for rows with missing or invalid fields.
 */
export function parseRemoteRow(raw: unknown): HighlightRecord | null {
  if (!isObject(raw)) {
    log.warn('sync', 'remoteRow.invalid', { code: 'not_object' })
    return null
  }
  const bad = invalidField(raw)
  if (bad !== null) {
    const id = typeof raw.id === 'string' ? raw.id : undefined
    log.warn('sync', 'remoteRow.invalid', { code: `field:${bad}`, ...(id ? { id } : {}) })
    return null
  }
  return {
    id: raw.id as string,
    userId: raw.user_id as string,
    canonicalUrl: raw.canonical_url as string,
    siteKey: raw.site_key as string,
    url: raw.url as string,
    text: raw.text as string,
    color: raw.color as ColorName,
    comment: raw.comment as string | null,
    anchor: parseAnchor(raw.anchor) ?? null,
    pageTitle: raw.page_title as string | null,
    favicon: raw.favicon as string | null,
    createdAt: toMs(raw.created_at) as number,
    editedAt: toMs(raw.edited_at) as number,
    deviceId: raw.device_id as string,
    deletedAt: raw.deleted_at === null ? null : (toMs(raw.deleted_at) as number),
    schemaVersion: 1,
  }
}
