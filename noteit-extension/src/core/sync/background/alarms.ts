// Push scheduling (architecture.md "Sync Algorithm": push, "Timing"). A 1.5s setTimeout debounce is
// only an optimisation; the 'sync-push' alarm (30s, the Chrome minimum) guarantees the push still
// happens when the service worker is terminated before the timer fires.

export const PUSH_ALARM = 'sync-push'
export const PUSH_DEBOUNCE_MS = 1500
/** chrome.alarms minimum delay (30s). */
export const PUSH_ALARM_DELAY_MINUTES = 0.5

export interface PushScheduler {
  /** Debounces a push and (re)arms the fallback alarm. */
  schedule(): void
  /** Arms only the fallback alarm (retry after a failed or partial push); default delay 30s. */
  armAlarm(delayMs?: number): void
  /** Clears the fallback alarm (outbox empty). */
  clearAlarm(): Promise<void>
  /** Drops the pending debounce timer and the fallback alarm (sign-out). */
  cancel(): Promise<void>
  /** Registers the alarm listener; call once at service worker start. */
  listen(): void
}

export function createPushScheduler(run: () => Promise<void>): PushScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null

  const armAlarm = (delayMs?: number): void => {
    const delayInMinutes = delayMs === undefined ? PUSH_ALARM_DELAY_MINUTES : Math.max(delayMs / 60_000, PUSH_ALARM_DELAY_MINUTES)
    // Re-creating an alarm with the same name replaces it.
    void Promise.resolve(chrome.alarms.create(PUSH_ALARM, { delayInMinutes })).catch(
      (error: unknown) => console.error('[NoteIt] sync-push alarm failed:', error),
    )
  }

  const clearAlarm = async (): Promise<void> => {
    try {
      await chrome.alarms.clear(PUSH_ALARM)
    } catch (error) {
      console.error('[NoteIt] sync-push alarm clear failed:', error)
    }
  }

  return {
    schedule() {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void run()
      }, PUSH_DEBOUNCE_MS)
      armAlarm()
    },
    armAlarm,
    clearAlarm,
    async cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
      await clearAlarm()
    },
    listen() {
      chrome.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name === PUSH_ALARM) void run()
      })
    },
  }
}

export const PULL_ALARM = 'sync-pull'
/** Periodic pull (architecture.md "Pull": every 5 minutes). */
export const PULL_ALARM_PERIOD_MINUTES = 5
/** tabs.onActivated pulls at most once per this window [proxy]. */
export const TAB_PULL_THROTTLE_MS = 30_000

/**
 * Creates the periodic pull alarm unless it already exists. Re-creating it on every worker wake
 * would restart the period, so a worker woken more often than every 5 minutes would never see it.
 */
export async function ensurePullAlarm(): Promise<void> {
  try {
    const existing = await chrome.alarms.get(PULL_ALARM)
    if (!existing) await chrome.alarms.create(PULL_ALARM, { periodInMinutes: PULL_ALARM_PERIOD_MINUTES })
  } catch (error) {
    console.error('[NoteIt] sync-pull alarm failed:', error)
  }
}

/** Removes the periodic pull alarm (sign-out); the next sign-in creates it again. */
export async function clearPullAlarm(): Promise<void> {
  try {
    await chrome.alarms.clear(PULL_ALARM)
  } catch (error) {
    console.error('[NoteIt] sync-pull alarm clear failed:', error)
  }
}

/** Runs `run` on the pull alarm. Call once at service worker start. */
export function listenPullAlarm(run: () => void): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === PULL_ALARM) run()
  })
}

/**
 * Leading-edge throttle: the first call runs `fn`, further calls within `windowMs` are dropped.
 * The window lives in memory, so a restarted worker may pull once more (harmless).
 */
export function throttle(fn: () => void, windowMs: number, now: () => number = Date.now): () => void {
  let last = -Infinity
  return () => {
    const t = now()
    if (t - last < windowMs) return
    last = t
    fn()
  }
}
