// UI-only time formatting (architecture.md "Format Patterns": times are epoch ms everywhere and are
// formatted only here). Date buckets of the all-sites view (Story 3.7, FR21, Q52): today, yesterday,
// this week (from Monday 00:00 local time), earlier. Boundaries use the local calendar day.

export type DateBucket = 'today' | 'yesterday' | 'thisWeek' | 'earlier'

/** Display order of the buckets, newest first. */
export const DATE_BUCKETS: readonly DateBucket[] = ['today', 'yesterday', 'thisWeek', 'earlier']

/** Local midnight of the day containing ts. */
function startOfDay(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Local midnight `days` calendar days before the day of ts (DST-safe: uses the calendar, not 24h steps). */
function daysBefore(ts: number, days: number): number {
  const d = new Date(startOfDay(ts))
  d.setDate(d.getDate() - days)
  return d.getTime()
}

/** Local Monday 00:00 of the week containing ts. */
export function startOfWeek(ts: number): number {
  const day = new Date(ts).getDay() // 0 = Sunday
  return daysBefore(ts, (day + 6) % 7)
}

/**
 * Bucket of a timestamp relative to now. Future timestamps (clock skew) count as today. On a Monday the
 * week starts today, so "this week" is empty; on a Tuesday yesterday is Monday and wins over "this week".
 */
export function dateBucket(ts: number, now: number): DateBucket {
  const today = startOfDay(now)
  if (ts >= today) return 'today'
  if (ts >= daysBefore(now, 1)) return 'yesterday'
  if (ts >= startOfWeek(now)) return 'thisWeek'
  return 'earlier'
}

/**
 * Groups items into date buckets by `latestOf(item)`, keeping the input order inside each bucket.
 * Empty buckets are left out; the result follows DATE_BUCKETS order.
 */
export function groupByDateBucket<T>(
  items: readonly T[],
  latestOf: (item: T) => number,
  now: number,
): Array<{ bucket: DateBucket; items: T[] }> {
  const byBucket = new Map<DateBucket, T[]>()
  for (const item of items) {
    const bucket = dateBucket(latestOf(item), now)
    const list = byBucket.get(bucket)
    if (list) list.push(item)
    else byBucket.set(bucket, [item])
  }
  return DATE_BUCKETS.filter((b) => byBucket.has(b)).map((bucket) => ({ bucket, items: byBucket.get(bucket)! }))
}

/** Absolute local date and time, used for the account-panel "last sync" value. */
export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString()
}
