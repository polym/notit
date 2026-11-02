// Main-thread budget for restoration (architecture.md D7 "main thread budget", NFR4): work runs in
// slices of at most CHUNK_BUDGET_MS or CHUNK_MAX_ITEMS items, and yields to the page between slices
// through requestIdleCallback (setTimeout 0 where it is missing).

/** Longest time one slice may run before it yields. */
export const CHUNK_BUDGET_MS = 8
/** Most items one slice may process before it yields. */
export const CHUNK_MAX_ITEMS = 10
/** requestIdleCallback timeout: background tabs and busy pages still make progress. */
const IDLE_TIMEOUT_MS = 100

/** Waits for the next idle period (or the next task where requestIdleCallback is missing). */
export function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS })
    else setTimeout(resolve, 0)
  })
}

export interface ChunkOptions {
  /** Checked before every slice; true stops the run (the remaining items are skipped). */
  cancelled?: () => boolean
  /** Waits between slices (tests inject a counter). */
  yieldFn?: () => Promise<void>
  /** Clock in milliseconds (tests inject a fake one). */
  now?: () => number
}

/**
 * Calls `work` for every item in order, in slices of at most CHUNK_MAX_ITEMS items or CHUNK_BUDGET_MS.
 * The first slice starts after a yield as well, so a caller never blocks the task it was called from.
 * Resolves false when cancelled before the last item, true otherwise.
 */
export async function runChunked<T>(items: readonly T[], work: (item: T) => void, options: ChunkOptions = {}): Promise<boolean> {
  const { cancelled = () => false, yieldFn = yieldToPage, now = () => performance.now() } = options
  let i = 0
  while (i < items.length) {
    await yieldFn()
    if (cancelled()) return false
    const started = now()
    let done = 0
    while (i < items.length && done < CHUNK_MAX_ITEMS && (done === 0 || now() - started < CHUNK_BUDGET_MS)) {
      work(items[i])
      i++
      done++
    }
  }
  return !cancelled()
}
