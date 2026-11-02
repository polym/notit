// Push half of the sync engine (architecture.md "Sync Algorithm": push, D1 clock clamp, D2).
// Service worker only. The RPC is injected so tests can run two engines against one backend.
import { read } from '../../db/read.ts'
import { write, type PushOutcome } from '../../db/write.ts'
import { estimateClockOffset, setClockOffset } from '../../clock/index.ts'
import { log } from '../../log/index.ts'
import type { HighlightRecord } from '../../model/index.ts'
import { parseRemoteRow, toPushRow, type PushRow } from '../mapping.ts'

/** Outbox items sent per sync_push call. */
export const PUSH_BATCH_SIZE = 100

/** Raw sync_push answer: {now_ms, rows}. */
export interface SyncPushResponse {
  now_ms: unknown
  rows: unknown
}

export type SyncPushRpc = (rows: PushRow[]) => Promise<SyncPushResponse>

export interface PushSummary {
  /** Records sent to the server. */
  pushed: number
  /** Outbox items removed. */
  cleared: number
  /** Records overwritten locally by a newer server row. */
  applied: HighlightRecord[]
  /** sync_push calls made (one call is made even with an empty outbox, for the clock). */
  calls: number
}

export interface PushOptions {
  /** Time source for the round-trip clock estimate (tests). */
  now?: () => number
}

function remoteRowsById(raw: unknown): Map<string, HighlightRecord> {
  const rows = Array.isArray(raw) ? raw : []
  const out = new Map<string, HighlightRecord>()
  for (const row of rows) {
    const parsed = parseRemoteRow(row)
    if (parsed) out.set(parsed.id, parsed)
  }
  return out
}

/** Updates and persists clockOffsetMs from a sync_push now_ms (|offset| <= 60s counts as 0). */
async function syncClock(serverNow: unknown, startedAt: number, endedAt: number): Promise<void> {
  if (typeof serverNow !== 'number' || !Number.isFinite(serverNow)) return
  const offset = estimateClockOffset(serverNow, startedAt, endedAt)
  setClockOffset(offset)
  await write.setMeta('clockOffsetMs', offset)
}

/**
 * Pushes one batch: the first PUSH_BATCH_SIZE outbox items and their current records.
 * Outbox items whose record no longer exists are sent as nothing and stay for diagnosis.
 * Throws when the RPC fails; the outbox is then untouched.
 */
export async function pushBatch(rpc: SyncPushRpc, options: PushOptions = {}): Promise<Omit<PushSummary, 'calls'>> {
  const now = options.now ?? Date.now
  const items = await read.outboxBatch(PUSH_BATCH_SIZE)
  const records = await read.byIds(items.map((i) => i.id))
  const snapshots = records.filter((r): r is HighlightRecord => r !== undefined)

  const startedAt = now()
  const response = await rpc(snapshots.map(toPushRow))
  const endedAt = now()
  await syncClock(response?.now_ms, startedAt, endedAt)

  const remote = remoteRowsById(response?.rows)
  const outcomes: PushOutcome[] = snapshots.map((snapshot) => ({ snapshot, remote: remote.get(snapshot.id) ?? null }))
  const missing = outcomes.filter((o) => o.remote === null).length
  if (missing > 0) log.warn('sync', 'push.missingRows', { count: missing })
  const { cleared, applied } = await write.applyPushResult(outcomes)
  return { pushed: snapshots.length, cleared: cleared.length, applied }
}

/**
 * Pushes until the outbox is empty or a batch makes no progress (items edited during the push,
 * or rows the server did not return, are left for the next run). Always makes at least one call
 * so the clock offset is refreshed. Records lastSyncAt on success.
 */
export async function pushAll(rpc: SyncPushRpc, options: PushOptions = {}): Promise<PushSummary> {
  const summary: PushSummary = { pushed: 0, cleared: 0, applied: [], calls: 0 }
  for (;;) {
    const batch = await pushBatch(rpc, options)
    summary.calls++
    summary.pushed += batch.pushed
    summary.cleared += batch.cleared
    summary.applied.push(...batch.applied)
    if (batch.cleared === 0 || (await read.outboxCount()) === 0) break
  }
  await write.setMeta('lastSyncAt', (options.now ?? Date.now)())
  log.info('sync', 'push.done', { count: summary.pushed, clearedCount: summary.cleared, callCount: summary.calls })
  return summary
}

/** Loads the persisted clock offset into core/clock (service worker start). */
export async function loadClockOffset(): Promise<void> {
  const stored = await read.getMeta('clockOffsetMs')
  if (typeof stored === 'number') setClockOffset(stored)
}
