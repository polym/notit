// LWW edit clock (architecture.md D1).
// stamp() is synchronous so it can run inside a Dexie transaction without breaking auto-commit.
// The offset is held in memory; the sync engine (Story 2.16+) loads it from meta.clockOffsetMs on
// service worker start and persists updates.

/** Offsets smaller than this are treated as noise and ignored (D1 "clock clamp"). */
export const CLOCK_OFFSET_THRESHOLD_MS = 60_000

let clockOffsetMs = 0
let nowFn: () => number = () => Date.now()

/** Returns editedAt = max(now + clockOffsetMs, prevEditedAt + 1). */
export function stamp(prevEditedAt?: number | null): number {
  const now = nowFn() + clockOffsetMs
  return prevEditedAt == null ? now : Math.max(now, prevEditedAt + 1)
}

export function getClockOffset(): number {
  return clockOffsetMs
}

export function setClockOffset(offsetMs: number): void {
  clockOffsetMs = Number.isFinite(offsetMs) ? offsetMs : 0
}

/**
 * Estimates the offset from a server timestamp using the round-trip midpoint.
 * Returns 0 unless the absolute offset exceeds CLOCK_OFFSET_THRESHOLD_MS.
 */
export function estimateClockOffset(serverNowMs: number, requestStartMs: number, responseEndMs: number): number {
  const localMid = requestStartMs + (responseEndMs - requestStartMs) / 2
  const offset = Math.round(serverNowMs - localMid)
  return Math.abs(offset) > CLOCK_OFFSET_THRESHOLD_MS ? offset : 0
}

/** Test hook: replace the time source (pass null to restore Date.now). */
export function setNowForTests(fn: (() => number) | null): void {
  nowFn = fn ?? (() => Date.now())
}

export const clock = { stamp, getClockOffset, setClockOffset, estimateClockOffset }
