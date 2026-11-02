import { afterEach, describe, expect, it } from 'vitest'
import { CLOCK_OFFSET_THRESHOLD_MS, estimateClockOffset, getClockOffset, setClockOffset, setNowForTests, stamp } from './index.ts'

describe('core/clock stamp', () => {
  afterEach(() => {
    setNowForTests(null)
    setClockOffset(0)
  })

  it('returns now + offset when there is no previous stamp', () => {
    setNowForTests(() => 1_000)
    expect(stamp()).toBe(1_000)
    expect(stamp(null)).toBe(1_000)
    setClockOffset(500)
    expect(stamp(undefined)).toBe(1_500)
  })

  it('stays above prev when the local clock is behind it', () => {
    setNowForTests(() => 1_000)
    expect(stamp(5_000)).toBe(5_001)
    expect(stamp(5_000)).toBeGreaterThan(5_000)
  })

  it('is strictly increasing for consecutive stamps in the same millisecond', () => {
    setNowForTests(() => 42)
    const a = stamp()
    const b = stamp(a)
    const c = stamp(b)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
  })

  it('applies the clock offset before comparing with prev', () => {
    setNowForTests(() => 1_000)
    setClockOffset(10_000)
    expect(stamp(5_000)).toBe(11_000)
    setClockOffset(-900)
    expect(stamp(50)).toBe(100)
  })

  it('ignores non-finite offsets', () => {
    setClockOffset(Number.NaN)
    expect(getClockOffset()).toBe(0)
  })
})

describe('core/clock estimateClockOffset', () => {
  it('uses the round-trip midpoint and clamps small offsets to 0', () => {
    expect(estimateClockOffset(1_100, 1_000, 1_200)).toBe(0)
    expect(estimateClockOffset(1_100 + CLOCK_OFFSET_THRESHOLD_MS, 1_000, 1_200)).toBe(0)
    expect(estimateClockOffset(1_101 + CLOCK_OFFSET_THRESHOLD_MS, 1_000, 1_200)).toBe(CLOCK_OFFSET_THRESHOLD_MS + 1)
    expect(estimateClockOffset(1_100 - 3_600_000, 1_000, 1_200)).toBe(-3_600_000)
  })
})
