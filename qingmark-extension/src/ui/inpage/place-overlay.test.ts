import { describe, expect, it } from 'vitest'
import { OVERLAY_GAP_PX, VIEWPORT_MARGIN_PX, placeOverlay, rectsIntersect, type OverlayRect } from './place-overlay.ts'

const viewport = { width: 1000, height: 800 }
const menu = { width: 140, height: 28 }
const popover = { width: 220, height: 120 }

describe('placeOverlay: floating menu (prefers above)', () => {
  it('goes above the selection when there is room', () => {
    const anchor = { left: 400, top: 300, width: 200, height: 20 }
    const p = placeOverlay(anchor, menu, viewport, 'above')
    expect(p.side).toBe('above')
    expect(p.top).toBe(anchor.top - OVERLAY_GAP_PX - menu.height)
    expect(rectsIntersect(p, anchor)).toBe(false)
  })

  it('flips below when the room above is not enough', () => {
    const anchor = { left: 400, top: 20, width: 200, height: 20 }
    const p = placeOverlay(anchor, menu, viewport, 'above')
    expect(p.side).toBe('below')
    expect(p.top).toBe(anchor.top + anchor.height + OVERLAY_GAP_PX)
    expect(rectsIntersect(p, anchor)).toBe(false)
  })
})

describe('placeOverlay: preview / popover (prefers below)', () => {
  it('goes 6px below the highlight when there is room', () => {
    const anchor = { left: 400, top: 300, width: 200, height: 20 }
    const p = placeOverlay(anchor, popover, viewport, 'below')
    expect(p.side).toBe('below')
    expect(p.top).toBe(anchor.top + anchor.height + 6)
    expect(rectsIntersect(p, anchor)).toBe(false)
  })

  it('flips above when the room below is not enough', () => {
    const anchor = { left: 400, top: 700, width: 200, height: 20 }
    const p = placeOverlay(anchor, popover, viewport, 'below')
    expect(p.side).toBe('above')
    expect(p.top + p.height).toBe(anchor.top - OVERLAY_GAP_PX)
    expect(rectsIntersect(p, anchor)).toBe(false)
  })

  it('picks the side with more room when neither fits, still without covering the anchor', () => {
    const anchor = { left: 400, top: 60, width: 200, height: 640 }
    const p = placeOverlay(anchor, popover, viewport, 'below')
    expect(p.side).toBe('below')
    expect(rectsIntersect(p, anchor)).toBe(false)
  })
})

describe('placeOverlay: horizontal clamping', () => {
  it('centers on the anchor', () => {
    const anchor = { left: 400, top: 300, width: 200, height: 20 }
    const p = placeOverlay(anchor, menu, viewport)
    expect(p.left + p.width / 2).toBe(anchor.left + anchor.width / 2)
  })

  it('stays inside the left edge', () => {
    const p = placeOverlay({ left: 0, top: 300, width: 10, height: 20 }, popover, viewport)
    expect(p.left).toBe(VIEWPORT_MARGIN_PX)
  })

  it('stays inside the right edge', () => {
    const p = placeOverlay({ left: 990, top: 300, width: 10, height: 20 }, popover, viewport)
    expect(p.left + p.width).toBe(viewport.width - VIEWPORT_MARGIN_PX)
  })
})

describe('placeOverlay: invariants over random inputs', () => {
  // Deterministic LCG so failures are reproducible.
  let seed = 12345
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed / 2 ** 31
  }

  it('never intersects the anchor and never leaves the viewport horizontally', () => {
    for (let i = 0; i < 2000; i++) {
      const vp = { width: 320 + Math.floor(rand() * 1600), height: 240 + Math.floor(rand() * 1000) }
      const anchor: OverlayRect = {
        left: Math.floor(rand() * vp.width),
        top: Math.floor(rand() * vp.height),
        width: 1 + Math.floor(rand() * 400),
        height: 1 + Math.floor(rand() * 200),
      }
      const size = { width: 20 + Math.floor(rand() * 280), height: 20 + Math.floor(rand() * 200) }
      for (const prefer of ['above', 'below'] as const) {
        const p = placeOverlay(anchor, size, vp, prefer)
        expect(rectsIntersect(p, anchor), JSON.stringify({ vp, anchor, size, prefer, p })).toBe(false)
        expect(p.left).toBeGreaterThanOrEqual(0)
        expect(p.left + p.width).toBeLessThanOrEqual(vp.width)
      }
    }
  })
})

describe('rectsIntersect', () => {
  it('treats touching edges as not intersecting', () => {
    expect(rectsIntersect({ left: 0, top: 0, width: 10, height: 10 }, { left: 10, top: 0, width: 5, height: 5 })).toBe(false)
    expect(rectsIntersect({ left: 0, top: 0, width: 10, height: 10 }, { left: 9, top: 9, width: 5, height: 5 })).toBe(true)
  })
})
