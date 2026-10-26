// Sync status and retry backoff (architecture.md "Sync Algorithm": retry and backoff, status).
// The retry state lives in meta.syncRetry so a service worker terminated between two attempts
// keeps counting consecutive failures. No supabase-js here: feature code (debug/dump) reads it.
import { read } from '../../db/read.ts'
import { write } from '../../db/write.ts'
import { emit, type ErrorCode, type ResultError } from '../../messaging/index.ts'
import type { SyncEvents, SyncStatus } from '../protocol.ts'

/** Delay before retry n (1-based) after consecutive failures: 30s / 1m / 2m / 5m, capped. */
export const BACKOFF_STEPS_MS = [30_000, 60_000, 120_000, 300_000] as const
/** Consecutive failures after which the state is 'error' (auth failures are 'error' at once). */
export const ERROR_AFTER_FAILURES = 3

export interface RetryState {
  /** Consecutive failed pushes (drives the 'error' state). */
  failures: number
  /** Position in BACKOFF_STEPS_MS; sync/retry resets it without forgetting the failures. */
  backoffStep: number
  lastError: ResultError | null
}

const INITIAL: RetryState = { failures: 0, backoffStep: 0, lastError: null }

/** Backoff delay for a backoff step (1 = first retry). Steps past the table stay at the cap. */
export function backoffDelayMs(step: number): number {
  const index = Math.min(Math.max(step, 1), BACKOFF_STEPS_MS.length) - 1
  return BACKOFF_STEPS_MS[index]
}

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && value.length > 0
}

function parseRetry(raw: unknown): RetryState {
  if (typeof raw !== 'string') return { ...INITIAL }
  try {
    const value = JSON.parse(raw) as Partial<Record<keyof RetryState, unknown>>
    const count = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : 0)
    const e = value.lastError as { code?: unknown; message?: unknown } | null | undefined
    const lastError =
      e && isErrorCode(e.code) ? { code: e.code, message: typeof e.message === 'string' ? e.message : '' } : null
    return { failures: count(value.failures), backoffStep: count(value.backoffStep), lastError }
  } catch {
    return { ...INITIAL }
  }
}

export async function loadRetry(): Promise<RetryState> {
  return parseRetry(await read.getMeta('syncRetry'))
}

async function saveRetry(state: RetryState): Promise<void> {
  await write.setMeta('syncRetry', JSON.stringify(state))
}

/** Counts one failed push; returns the new state (its backoffStep picks the next delay). */
export async function recordFailure(error: ResultError): Promise<RetryState> {
  const prev = await loadRetry()
  const next: RetryState = { failures: prev.failures + 1, backoffStep: prev.backoffStep + 1, lastError: error }
  await saveRetry(next)
  return next
}

/** A successful push clears failures, backoff and the last error. */
export async function recordSuccess(): Promise<void> {
  const prev = await loadRetry()
  if (prev.failures === 0 && prev.backoffStep === 0 && prev.lastError === null) return
  await saveRetry({ ...INITIAL })
}

/** sync/retry: the next failure waits the first backoff step again. Failures keep counting. */
export async function resetBackoff(): Promise<void> {
  const prev = await loadRetry()
  if (prev.backoffStep === 0) return
  await saveRetry({ ...prev, backoffStep: 0 })
}

/** Whether a retry state is shown as 'error'. */
export function isErrorState(retry: RetryState): boolean {
  if (retry.failures === 0) return false
  return retry.failures >= ERROR_AFTER_FAILURES || retry.lastError?.code === 'unauthenticated'
}

let syncing = false

/** Marks a sync run as started / finished (in memory: a terminated worker is not syncing). */
export function setSyncing(value: boolean): void {
  syncing = value
}

export async function readSyncStatus(): Promise<SyncStatus> {
  const [pending, lastSync, retry] = await Promise.all([read.outboxCount(), read.getMeta('lastSyncAt'), loadRetry()])
  const status: SyncStatus = {
    state: syncing ? 'syncing' : isErrorState(retry) ? 'error' : 'idle',
    pending,
    lastSyncAt: typeof lastSync === 'number' ? lastSync : null,
  }
  if (retry.lastError) status.lastError = retry.lastError
  return status
}

/** Broadcasts sync/status to extension pages (side panel). Never rejects. */
export async function broadcastStatus(): Promise<void> {
  try {
    await emit<SyncEvents>('sync/status', await readSyncStatus())
  } catch {
    // Status reads are best effort; the side panel asks again with sync/getStatus.
  }
}
