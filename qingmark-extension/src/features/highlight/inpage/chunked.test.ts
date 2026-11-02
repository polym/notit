import { describe, expect, it } from 'vitest'
import { CHUNK_BUDGET_MS, CHUNK_MAX_ITEMS, runChunked } from './chunked.ts'

/** Records which slice each item ran in. */
function harness(clockStep = 0) {
  let slice = 0
  let clock = 0
  const sliceOf: number[] = []
  return {
    sliceOf,
    get yields() {
      return slice
    },
    yieldFn: async () => {
      slice++
    },
    now: () => (clock += clockStep),
    work: () => {
      sliceOf.push(slice)
    },
  }
}

describe('runChunked', () => {
  it('runs at most CHUNK_MAX_ITEMS items per slice', async () => {
    const h = harness()
    const items = Array.from({ length: CHUNK_MAX_ITEMS * 2 + 3 }, (_, i) => i)
    expect(await runChunked(items, h.work, { yieldFn: h.yieldFn, now: h.now })).toBe(true)
    expect(h.sliceOf).toHaveLength(items.length)
    expect(h.yields).toBe(3)
    for (let s = 1; s <= 3; s++) expect(h.sliceOf.filter((x) => x === s).length).toBeLessThanOrEqual(CHUNK_MAX_ITEMS)
  })

  it('yields once a slice has used CHUNK_BUDGET_MS', async () => {
    // Every clock read advances half the budget: a slice fits two items at most.
    const h = harness(CHUNK_BUDGET_MS / 2)
    expect(await runChunked([1, 2, 3, 4, 5, 6], h.work, { yieldFn: h.yieldFn, now: h.now })).toBe(true)
    expect(h.yields).toBeGreaterThanOrEqual(3)
    for (let s = 1; s <= h.yields; s++) expect(h.sliceOf.filter((x) => x === s).length).toBeLessThanOrEqual(2)
  })

  it('always makes progress even when one item exceeds the budget', async () => {
    const h = harness(CHUNK_BUDGET_MS * 10)
    expect(await runChunked([1, 2, 3], h.work, { yieldFn: h.yieldFn, now: h.now })).toBe(true)
    expect(h.sliceOf).toEqual([1, 2, 3])
  })

  it('stops before the next slice once cancelled', async () => {
    const h = harness()
    let done = 0
    const items = Array.from({ length: 25 }, (_, i) => i)
    const finished = await runChunked(items, () => done++, { yieldFn: h.yieldFn, now: h.now, cancelled: () => done >= CHUNK_MAX_ITEMS })
    expect(finished).toBe(false)
    expect(done).toBe(CHUNK_MAX_ITEMS)
  })

  it('falls back to setTimeout when requestIdleCallback is missing', async () => {
    expect(typeof (globalThis as { requestIdleCallback?: unknown }).requestIdleCallback).toBe('undefined')
    let done = 0
    expect(await runChunked([1, 2], () => done++)).toBe(true)
    expect(done).toBe(2)
  })
})
