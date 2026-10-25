// Service worker handlers for highlight commands (architecture.md D4 single writer, D6).
// Every write goes through core/db/write (record + outbox in one transaction) and emits
// db/changed after the transaction has committed.
import { HandlerError, emit, type Handlers } from '../../../core/messaging/index.ts'
import { canonicalUrl, siteKey } from '../../../core/url/index.ts'
import { read } from '../../../core/db/read.ts'
import { write } from '../../../core/db/write.ts'
import { dbErrorCode } from '../../../core/db/errors.ts'
import { getDeviceId, setSiteOverride } from '../../../core/settings/index.ts'
import { log, readLogs } from '../../../core/log/index.ts'
import { readSyncStatus } from '../../../core/sync/background/status.ts'
import { isColorName, type HighlightRecord, type TextAnchor } from '../../../core/model/index.ts'
import type {
  AnchorRequests,
  CreateHighlightReq,
  DebugRequests,
  HighlightEvents,
  HighlightPatch,
  HighlightRequests,
  SiteRequests,
} from '../shared/protocol.ts'
import { updateActiveBadges } from './badge.ts'
import { broadcastCleared, broadcastCommitted, broadcastSiteChanged } from './broadcast.ts'
import { isSiteEnabled } from './site-state.ts'
import { flashInTab, openRecordTab } from './nav.ts'
import { isSignedIn, requireAuth } from './auth-gate.ts'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PATCH_KEYS: ReadonlySet<string> = new Set(['color', 'comment'])

function badRequest(message: string): never {
  throw new HandlerError('bad_request', message)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isNullableString(v: unknown): v is string | null {
  return v === null || typeof v === 'string'
}

function isAnchor(v: unknown): v is TextAnchor {
  return (
    isObject(v) &&
    Number.isFinite(v.start) &&
    Number.isFinite(v.end) &&
    typeof v.exact === 'string' &&
    typeof v.prefix === 'string' &&
    typeof v.suffix === 'string'
  )
}

function requireId(req: unknown): string {
  if (!isObject(req) || typeof req.id !== 'string' || req.id === '') badRequest('id is required')
  return req.id
}

function validateCreate(req: unknown): CreateHighlightReq {
  if (!isObject(req)) badRequest('request must be an object')
  const { id, url, text, color, comment, anchor, pageTitle, favicon } = req
  if (typeof id !== 'string' || !UUID_RE.test(id)) badRequest('id must be a UUID')
  if (typeof url !== 'string') badRequest('url must be a string')
  if (typeof text !== 'string' || text === '') badRequest('text must be a non-empty string')
  if (!isColorName(color)) badRequest('color must be a color name')
  if (!isNullableString(comment)) badRequest('comment must be a string or null')
  if (anchor !== null && !isAnchor(anchor)) badRequest('anchor must be a TextAnchor or null')
  if (!isNullableString(pageTitle)) badRequest('pageTitle must be a string or null')
  if (!isNullableString(favicon)) badRequest('favicon must be a string or null')
  return { id, url, text, color, comment, anchor, pageTitle, favicon }
}

/** Accepts only {color?, comment?}; undefined keys are dropped so they never overwrite fields. */
function validatePatch(patch: unknown): HighlightPatch {
  if (!isObject(patch)) badRequest('patch must be an object')
  const out: HighlightPatch = {}
  for (const [key, value] of Object.entries(patch)) {
    if (!PATCH_KEYS.has(key)) badRequest(`patch field not allowed: ${key}`)
    if (value === undefined) continue
    if (key === 'color') {
      if (!isColorName(value)) badRequest('color must be a color name')
      out.color = value
    } else {
      if (!isNullableString(value)) badRequest('comment must be a string or null')
      out.comment = value
    }
  }
  if (Object.keys(out).length === 0) badRequest('patch is empty')
  return out
}

/** Runs a database write; storage failures become 'quota' / 'internal' HandlerErrors. */
async function guardDb<T>(op: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (e) {
    const code = dbErrorCode(e)
    log.error('highlight', `${op}.failed`, { code })
    throw new HandlerError(code, e instanceof Error ? e.message : String(e))
  }
}

// Awaited before every write that stamps editedAt; the SW entry wires the sync engine's clock-ready
// promise here so the persisted clock offset is loaded before the first stamp after a worker wake.
let beforeLocalWrite: () => Promise<void> = () => Promise.resolve()

/** Sets the hook awaited before each stamped local write (entries/background: clock ready). */
export function setBeforeLocalWrite(next: () => Promise<void>): void {
  beforeLocalWrite = next
}

/** Waits for beforeLocalWrite (failures are logged, not fatal), then runs the write via guardDb. */
async function stampedWrite<T>(op: string, run: () => Promise<T>): Promise<T> {
  try {
    await beforeLocalWrite()
  } catch (error) {
    console.error('[NoteIt] before-write hook failed:', error)
  }
  return guardDb(op, run)
}

// Called after every local commit that added an outbox item; the SW entry wires the sync engine
// here so this feature never imports core/sync (and so supabase-js) itself.
let afterLocalCommit: () => void = () => {}

/** Sets the hook run after each local highlight commit (entries/background: schedule a push). */
export function setAfterLocalCommit(next: () => void): void {
  afterLocalCommit = next
}

/** db/changed for the side panel, page/sync and badges for tabs, for records committed by anyone. */
export function notifyCommitted(records: HighlightRecord[]): void {
  if (records.length === 0) return
  void emit<HighlightEvents>('db/changed', { ids: records.map((r) => r.id) })
  void broadcastCommitted(records)
}

/** After a local wipe: the side panel re-queries (db/changed) and every tab drops its renders. */
export function notifyWiped(): void {
  void emit<HighlightEvents>('db/changed', { ids: [] })
  void broadcastCleared()
}

/** Post-commit notifications for a local edit, then the push hook. */
function changed(record: HighlightRecord): HighlightRecord {
  notifyCommitted([record])
  try {
    afterLocalCommit()
  } catch (error) {
    console.error('[NoteIt] after-commit hook failed:', error)
  }
  return record
}

function orNotFound(record: HighlightRecord | null, id: string): HighlightRecord {
  if (!record) throw new HandlerError('not_found', `highlight not found: ${id}`)
  return record
}

type HighlightWriteRequests = Omit<HighlightRequests, 'page/getState'>

// Every highlight/* write command sits behind the login gate (FR27): signed out -> unauthenticated.
const highlightWriteHandlers: Handlers<HighlightWriteRequests> = requireAuth<HighlightWriteRequests>({
  async 'highlight/create'(raw) {
    const req = validateCreate(raw)
    const canonical = canonicalUrl(req.url)
    const site = siteKey(req.url)
    if (canonical === null || site === null) badRequest('url must be http(s)')
    const deviceId = await getDeviceId()
    // The existence check runs inside the write transaction, so concurrent creates with the
    // same id insert once and only the inserting call emits db/changed.
    const { record, created } = await stampedWrite('create', () =>
      write.insertIfAbsent(
        {
          ...req,
          // userId is filled once auth exists (Story 2.14); local-only rows carry ''.
          userId: '',
          canonicalUrl: canonical,
          siteKey: site,
          createdAt: Date.now(),
          deletedAt: null,
          schemaVersion: 1,
        },
        deviceId,
      ),
    )
    if (!created) {
      // Idempotent retry: only a live record for the same page and text counts as the same create.
      if (record.deletedAt === null && record.canonicalUrl === canonical && record.text === req.text) return record
      badRequest('id already exists for a different or deleted highlight')
    }
    log.info('highlight', 'create', { id: record.id })
    return changed(record)
  },

  async 'highlight/update'(req) {
    const id = requireId(req)
    const patch = validatePatch(isObject(req) ? req.patch : undefined)
    const deviceId = await getDeviceId()
    const record = orNotFound(await stampedWrite('update', () => write.update(id, patch, deviceId)), id)
    return changed(record)
  },

  async 'highlight/delete'(req) {
    const id = requireId(req)
    const deviceId = await getDeviceId()
    const record = orNotFound(await stampedWrite('delete', () => write.softDelete(id, deviceId)), id)
    log.info('highlight', 'delete', { id })
    return changed(record)
  },

  async 'highlight/restore'(req) {
    const id = requireId(req)
    const deviceId = await getDeviceId()
    const record = orNotFound(await stampedWrite('restore', () => write.restore(id, deviceId)), id)
    log.info('highlight', 'restore', { id })
    return changed(record)
  },
})

export const highlightHandlers: Handlers<HighlightRequests> = {
  async 'page/getState'(req) {
    const url = isObject(req) && typeof req.url === 'string' ? req.url : ''
    const canonical = canonicalUrl(url)
    const site = siteKey(url)
    if (canonical === null || site === null) badRequest('url must be http(s)')
    const [enabled, highlights, signedIn] = await Promise.all([
      isSiteEnabled(site),
      read.byCanonicalUrl(canonical),
      isSignedIn(),
    ])
    return { canonicalUrl: canonical, siteKey: site, enabled, signedIn, highlights }
  },
  ...highlightWriteHandlers,
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

/** Writes or deletes anchorStatus rows and tells the side panel when the set changed. */
async function recordAnchors(found: string[], lost: string[]): Promise<void> {
  const changedIds = await guardDb('anchor', () => write.applyAnchorReport(found, lost, Date.now()))
  if (lost.length > 0) log.info('anchor', 'lost', { count: lost.length })
  if (changedIds.length > 0) void emit<HighlightEvents>('db/changed', { ids: changedIds })
}

export const anchorHandlers: Handlers<AnchorRequests> = {
  async 'anchor/report'(req) {
    if (!isObject(req) || typeof req.canonicalUrl !== 'string') badRequest('canonicalUrl is required')
    if (!isStringArray(req.found) || !isStringArray(req.lost)) badRequest('found and lost must be string arrays')
    // Only records of the reported page are touched, so one page cannot mark another page's rows.
    const onPage = new Set((await read.byCanonicalUrl(req.canonicalUrl)).map((r) => r.id))
    await recordAnchors(
      req.found.filter((id) => onPage.has(id)),
      req.lost.filter((id) => onPage.has(id)),
    )
  },

  async 'nav/jumpTo'(req) {
    const id = requireId(req)
    const record = await read.byId(id)
    if (!record || record.deletedAt !== null) throw new HandlerError('not_found', `highlight not found: ${id}`)
    const tabId = await openRecordTab(record)
    if (tabId === undefined) return { result: 'lost' }
    const answer = await flashInTab(tabId, id)
    if (answer?.found) {
      await recordAnchors([id], [])
      return { result: 'flashed' }
    }
    // Only a content answer on an enabled site is an anchoring verdict; a closed site renders
    // nothing and a missing content script says nothing about the page text.
    if (answer && (await isSiteEnabled(record.siteKey))) await recordAnchors([], [id])
    return { result: 'lost' }
  },
}

export const siteHandlers: Handlers<SiteRequests> = {
  async 'site/setEnabled'(req) {
    if (!isObject(req) || typeof req.siteKey !== 'string' || req.siteKey === '') badRequest('siteKey is required')
    if (typeof req.enabled !== 'boolean') badRequest('enabled must be a boolean')
    await setSiteOverride(req.siteKey, req.enabled ? 'on' : 'off')
    // A disabled site shows an empty badge (FR23); open tabs of the site and the side panel follow the
    // switch (FR18), wherever it was flipped.
    void updateActiveBadges()
    void broadcastSiteChanged({ siteKey: req.siteKey, enabled: req.enabled })
  },
}

export const debugHandlers: Handlers<DebugRequests> = {
  async 'debug/dump'() {
    const [ids, outbox, logs, syncStatus] = await Promise.all([read.allIds(), read.outboxItems(), readLogs(), readSyncStatus()])
    return { ids, outbox, syncStatus, logs }
  },
}
