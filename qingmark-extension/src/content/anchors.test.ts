import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AnchorTracker, sameText } from './anchors.ts'
import type { AnchorReport } from '../features/highlight/index.ts'

describe('content AnchorTracker', () => {
  let rendered: Set<string>
  let busy: boolean
  let reports: AnchorReport[]
  let tracker: AnchorTracker

  beforeEach(() => {
    vi.useFakeTimers()
    rendered = new Set()
    busy = false
    reports = []
    tracker = new AnchorTracker({
      expectedIds: () => ['a', 'b'],
      isRendered: (id) => rendered.has(id),
      isBusy: () => busy,
      canonicalUrl: () => 'https://example.com/p',
      send: (r) => reports.push(r),
      windowMs: 3000,
    })
  })
  afterEach(() => vi.useRealTimers())

  it('reports found at once and lost only after the window, each verdict once', () => {
    rendered.add('a')
    tracker.afterRender()
    expect(reports).toEqual([{ canonicalUrl: 'https://example.com/p', found: ['a'], lost: [] }])
    vi.advanceTimersByTime(2999)
    expect(reports).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(reports[1]).toEqual({ canonicalUrl: 'https://example.com/p', found: [], lost: ['b'] })
    tracker.afterRender()
    expect(reports).toHaveLength(2)
  })

  it('a retry inside the window that renders the highlight never reports it lost', () => {
    tracker.afterRender()
    expect(reports).toEqual([])
    vi.advanceTimersByTime(1500)
    rendered.add('a').add('b')
    tracker.afterRender()
    vi.advanceTimersByTime(5000)
    expect(reports).toEqual([{ canonicalUrl: 'https://example.com/p', found: ['a', 'b'], lost: [] }])
  })

  it('a highlight found after the window is reported found', () => {
    tracker.afterRender()
    vi.advanceTimersByTime(3000)
    expect(reports.at(-1)?.lost).toEqual(['a', 'b'])
    rendered.add('b')
    tracker.afterRender()
    expect(reports.at(-1)).toMatchObject({ found: ['b'], lost: [] })
  })

  it('waits for a running render pass before deciding', () => {
    tracker.afterRender()
    busy = true
    vi.advanceTimersByTime(3000)
    expect(reports).toEqual([])
    rendered.add('a')
    busy = false
    vi.advanceTimersByTime(100)
    expect(reports).toEqual([{ canonicalUrl: 'https://example.com/p', found: ['a'], lost: ['b'] }])
  })

  it('reset closes the window and forgets verdicts', () => {
    tracker.afterRender()
    tracker.reset()
    vi.advanceTimersByTime(5000)
    expect(reports).toEqual([])
  })

  it('skipping the tracker during a load pass avoids a spurious lost; the load pass still reports', () => {
    // Mirrors applyPageSync in index.ts: the sync path calls afterRender only outside a load pass.
    let loadPass = false
    const afterSyncRender = () => {
      if (!loadPass) tracker.afterRender()
    }
    rendered.add('a')
    rendered.add('b')
    tracker.afterRender()
    vi.advanceTimersByTime(3000)
    expect(reports).toHaveLength(1)
    // A mutation-driven reload has unwrapped every highlight and is still running.
    busy = true
    loadPass = true
    rendered.clear()
    afterSyncRender()
    expect(reports).toHaveLength(1)
    // The load pass re-renders only 'a', clears its pass flag and evaluates while still busy.
    rendered.add('a')
    loadPass = false
    tracker.afterRender()
    expect(reports.at(-1)).toEqual({ canonicalUrl: 'https://example.com/p', found: [], lost: ['b'] })
    // A sync render outside a load pass is evaluated.
    busy = false
    rendered.add('b')
    afterSyncRender()
    expect(reports.at(-1)).toEqual({ canonicalUrl: 'https://example.com/p', found: ['b'], lost: [] })
  })
})

describe('sameText', () => {
  it('accepts the saved text, ignoring whitespace differences', () => {
    expect(sameText('quick brown fox', 'quick brown fox')).toBe(true)
    expect(sameText('first block second', 'first block\nsecond')).toBe(true)
  })

  it('rejects other text at the same offsets', () => {
    expect(sameText('This post was deleted by', 'Marginal notes are conversations')).toBe(false)
    expect(sameText('quick brown', 'quick brown fox')).toBe(false)
  })
})
