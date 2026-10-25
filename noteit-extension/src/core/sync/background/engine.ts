// Sync engine wiring for the service worker (architecture.md "Sync Algorithm"). Push (2.16) and
// pull (2.17) share one serialized runner; failed pushes retry with backoff and drive syncStatus
// (2.18, status.ts).
import { getAuthState, onAuthChanged, setBeforeSignInHook, setSignedInHook, setSignOutHook, withSession } from '../../auth/index.ts'
import { read } from '../../db/read.ts'
import { write } from '../../db/write.ts'
import { flushLogs, log } from '../../log/index.ts'
import { clearSiteOverrides, removeLegacyKeys } from '../../settings/index.ts'
import type { ErrorCode } from '../../messaging/index.ts'
import type { HighlightRecord } from '../../model/index.ts'
import { clearPullAlarm, createPushScheduler, ensurePullAlarm, listenPullAlarm, TAB_PULL_THROTTLE_MS, throttle } from './alarms.ts'
import { pullAll } from './pull.ts'
import { loadClockOffset, PUSH_BATCH_SIZE, pushAll } from './push.ts'
import { supabasePullPage, supabaseRpc } from './rpc.ts'
import { backoffDelayMs, broadcastStatus, readSyncStatus, recordFailure, recordSuccess, resetBackoff, setSyncing } from './status.ts'
import type { SyncStatus } from '../protocol.ts'

export interface SyncEngineOptions {
  /** Called with records a push or pull wrote from server rows (post-commit notifications). */
  onApplied?: (records: HighlightRecord[]) => void
  /** Called after a sign-out or first sign-in wipe emptied the local database (page/clear, badges). */
  onWiped?: () => void
}

let running: Promise<void> | null = null
let pushRequested = false
let pullRequested = false
let onApplied: (records: HighlightRecord[]) => void = () => {}
let onWiped: () => void = () => {}
/**
 * Number of holders (a sign-in in progress, a reconcile, a sign-out wipe) that own the database;
 * while above zero, runs stop and wait. A counter, so overlapping holders never release each other.
 */
let pauseDepth = 0

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown'
}

/** Push failures after which a pull would fail the same way, so the pull is skipped. */
const PULL_BLOCKING_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>(['unauthenticated', 'network'])

/**
 * Counts a failed push: attempts++ / lastError on the batch that was sent, one more consecutive
 * failure, and the push alarm re-armed with the backoff delay. Signed out waits for the next
 * sign-in instead of polling.
 */
async function recordPushFailure(error: { code: ErrorCode; message: string }): Promise<void> {
  const batch = await read.outboxBatch(PUSH_BATCH_SIZE)
  // An empty outbox only made the clock-refresh call: nothing is waiting to sync, so the failure
  // neither counts toward the error state nor arms the backoff push alarm.
  if (batch.length === 0) return
  await write.markOutboxFailed(
    batch.map((i) => i.id),
    error.code,
  )
  const retry = await recordFailure(error)
  if (error.code !== 'unauthenticated') scheduler.armAlarm(backoffDelayMs(retry.backoffStep))
}

/** Returned from inside withSession when the session's user is not the local data's account. */
const ACCOUNT_MISMATCH = Symbol('account-mismatch')

/**
 * Defense in depth for the first sign-in wipe (FR39): local rows and outbox belong to meta.userId,
 * so they are never sent with, or merged under, another account's session.
 */
async function sameAccount(sessionUserId: string): Promise<boolean> {
  return (await read.getMeta('userId')) === sessionUserId
}

/** One push; null when it succeeded, otherwise the error code. Re-arms or clears the push alarm. */
async function pushOnce(): Promise<ErrorCode | null> {
  const result = await withSession(async (supabase, session) =>
    (await sameAccount(session.user.id)) ? pushAll(supabaseRpc(supabase)) : ACCOUNT_MISMATCH,
  )
  if (!result.ok) {
    log.warn('sync', 'push.failed', { code: result.error.code })
    await recordPushFailure(result.error)
    return result.error.code
  }
  const summary = result.data
  if (summary === ACCOUNT_MISMATCH) {
    // Not a push failure: nothing was sent. The pending sign-in reconcile owns what happens next.
    log.warn('sync', 'push.skipped', { code: 'accountMismatch' })
    return 'unauthenticated'
  }
  await recordSuccess()
  if (summary.applied.length > 0) onApplied(summary.applied)
  if ((await read.outboxCount()) > 0) scheduler.armAlarm()
  else await scheduler.clearAlarm()
  return null
}

/** One pull of every page above the cursor. A failure is retried by the next trigger. */
async function pullOnce(): Promise<void> {
  const result = await withSession(async (supabase, session) =>
    (await sameAccount(session.user.id)) ? pullAll(supabasePullPage(supabase)) : ACCOUNT_MISMATCH,
  )
  if (!result.ok) {
    log.warn('sync', 'pull.failed', { code: result.error.code })
    return
  }
  const summary = result.data
  if (summary === ACCOUNT_MISMATCH) {
    log.warn('sync', 'pull.skipped', { code: 'accountMismatch' })
    return
  }
  if (summary.applied.length > 0) onApplied(summary.applied)
}

/**
 * Runs requested work one run at a time: a push, and when a pull was requested, a push followed by
 * the pull (architecture.md "Pull": push first to reduce round-trip conflicts). Requests made
 * during a run are served by exactly one more run afterwards.
 */
function run(): Promise<void> {
  if (running) return running
  running = (async () => {
    setSyncing(true)
    void broadcastStatus()
    try {
      while (pauseDepth === 0 && (pushRequested || pullRequested)) {
        // Signed out: nothing can reach the server, and a failed attempt would write logs into a
        // freshly wiped database. Pending items wait for the next sign-in, which requests a run.
        if (!(await getAuthState()).signedIn) {
          pushRequested = false
          pullRequested = false
          break
        }
        const pull = pullRequested
        pushRequested = false
        pullRequested = false
        try {
          const pushError = await pushOnce()
          // Offline or signed out would fail the pull the same way; the next trigger pulls again.
          // Any other push failure (server, bad row) must not block pulls: LWW merge keeps newer
          // pending local rows, so pulling with a non-empty outbox is safe.
          if (pull && (pushError === null || !PULL_BLOCKING_CODES.has(pushError))) await pullOnce()
        } catch (error) {
          log.error('sync', 'run.crashed', { code: errorName(error) })
          try {
            await recordPushFailure({ code: 'internal', message: errorName(error) })
          } catch {
            scheduler.armAlarm()
          }
        }
      }
    } finally {
      running = null
      setSyncing(false)
      void broadcastStatus()
    }
  })()
  return running
}

function runPush(): Promise<void> {
  pushRequested = true
  return run()
}

const scheduler = createPushScheduler(runPush)

let clockLoaded: Promise<void> | null = null

/**
 * Resolves once the persisted clock offset (meta.clockOffsetMs) has been loaded, so the first edit
 * after a worker wake is stamped with it (D1 rule 2). Never rejects: a failed load keeps offset 0.
 */
export function clockReady(): Promise<void> {
  clockLoaded ??= loadClockOffset().catch((error: unknown) => {
    log.error('sync', 'clock.load.failed', { code: errorName(error) })
  })
  return clockLoaded
}

/** Schedules a push after a local commit (debounce + alarm fallback); the pending count changed. */
export function schedulePush(): void {
  scheduler.schedule()
  void broadcastStatus()
}

/** Pushes now and resolves when done (tests). */
export function pushNow(): Promise<void> {
  return runPush()
}

/** sync/retry: resets the backoff, pushes now and answers with the resulting status. */
export async function retryNow(): Promise<SyncStatus> {
  await resetBackoff()
  await runPush()
  // A run already in progress may have been joined; wait for the follow-up run it queued.
  while (running) await running
  return readSyncStatus()
}

export { readSyncStatus } from './status.ts'

/** Pushes, then pulls every page above the cursor; resolves when done. */
export function pullNow(): Promise<void> {
  pullRequested = true
  return run()
}

/**
 * Keeps new runs from starting, waits until no run is in progress, and resolves with an idempotent
 * release. The last release starts a run for requests made while paused (such as the sign-in pull).
 */
async function pauseRuns(): Promise<() => void> {
  pauseDepth += 1
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    pauseDepth -= 1
    if (pauseDepth === 0 && (pushRequested || pullRequested)) void run()
  }
  try {
    while (running) await running
  } catch (error) {
    release()
    throw error
  }
  return release
}

/**
 * First sign-in wipe (architecture.md, FR39): when meta.userId is absent or names another account,
 * every table is emptied, the legacy keys and siteOverrides are removed, and meta is reseeded with
 * {userId, pullCursor: 0}. The same account signing in again (after a refresh failure) keeps its
 * data and outbox. Returns whether a wipe happened.
 */
export async function reconcileAccount(userId: string): Promise<boolean> {
  if ((await read.getMeta('userId')) === userId) return false
  await flushLogs()
  await write.wipeAll(userId)
  await Promise.all([removeLegacyKeys(), clearSiteOverrides()])
  return true
}

/** Sign-in hook: reconciles the account before login answers, so no write races the wipe. */
async function onSignedIn(userId: string): Promise<void> {
  const release = await pauseRuns()
  let wiped = false
  try {
    wiped = await reconcileAccount(userId)
  } finally {
    release()
  }
  if (wiped) {
    log.info('sync', 'firstSignIn.wiped')
    onWiped()
  }
  void ensurePullAlarm()
}

/**
 * Sign-out wipe (architecture.md, FR29, NFR17): stop sync work, sign out, then empty every table
 * and remove siteOverrides. sb-auth is removed by signOut; deviceId is kept.
 */
async function onSignOut(signOut: () => Promise<void>): Promise<void> {
  const release = await pauseRuns()
  try {
    await Promise.all([scheduler.cancel(), clearPullAlarm()])
    await signOut()
    // Log writes queued so far (signedOut) land before the wipe, never after it.
    await flushLogs()
    await write.wipeAll()
    await clearSiteOverrides()
    pushRequested = false
    pullRequested = false
  } finally {
    release()
  }
  onWiped()
  void broadcastStatus()
}

/** Pull trigger for tabs.onActivated: at most one pull per 30s. */
const pullOnTabActivated = throttle(() => void pullNow(), TAB_PULL_THROTTLE_MS)

/**
 * Starts the engine: loads the clock offset, listens for the push / pull alarms, tab switches and
 * sign-in changes, and on worker start pushes the outbox and pulls (when signed in). Resolves when
 * the startup run is done (tests); never rejects.
 */
export function startSyncEngine(options: SyncEngineOptions = {}): Promise<void> {
  if (options.onApplied) onApplied = options.onApplied
  if (options.onWiped) onWiped = options.onWiped
  setBeforeSignInHook(pauseRuns)
  setSignedInHook(onSignedIn)
  setSignOutHook(onSignOut)
  scheduler.listen()
  listenPullAlarm(() => void pullNow())
  void ensurePullAlarm()
  chrome.tabs.onActivated.addListener(() => pullOnTabActivated())
  onAuthChanged((state) => {
    // A sign-in pushes what is pending and pulls the account's rows.
    if (state.signedIn) void pullNow()
  })
  return (async () => {
    try {
      await clockReady()
      if (!(await getAuthState()).signedIn) return
      await reconcileStoredSession()
      await pullNow()
    } catch (error) {
      log.error('sync', 'start.failed', { code: errorName(error) })
    }
  })()
}

/**
 * A session stored before meta.userId existed (or left over from an interrupted sign-in) never went
 * through the sign-in reconcile, so sameAccount would block every run. Runs the same pause, wipe and
 * reseed path as a sign-in (FR39). When the session cannot be read (offline), the next start retries.
 */
async function reconcileStoredSession(): Promise<void> {
  const session = await withSession(async (_supabase, s) => s.user.id)
  if (!session.ok) return
  if ((await read.getMeta('userId')) !== session.data) await onSignedIn(session.data)
}
