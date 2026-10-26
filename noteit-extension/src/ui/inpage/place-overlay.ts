// Overlay placement rules (Q65, EXPERIENCE.md "In-page overlays", architecture.md D10):
// - floating menu: above the selection, flipped below when there is not enough room above;
// - comment preview / highlight popover: 6px below the highlight, flipped above when there is not
//   enough room below.
// The result never intersects the anchor rect and never leaves the viewport horizontally.
// Pure function: all inputs are viewport (client) coordinates, no DOM access.

export interface OverlayRect {
  left: number
  top: number
  width: number
  height: number
}

export interface OverlaySize {
  width: number
  height: number
}

export interface Viewport {
  width: number
  height: number
}

/** 'above' for the floating menu, 'below' for the comment preview and highlight popover. */
export type OverlayPreference = 'above' | 'below'

export interface Placement extends OverlayRect {
  side: 'above' | 'below'
}

/** Gap between the anchor and the overlay (DESIGN.md comment-preview: 6px below the highlight). */
export const OVERLAY_GAP_PX = 6
/** Minimum distance kept between the overlay and the left / right viewport edges. */
export const VIEWPORT_MARGIN_PX = 8

/**
 * Places an overlay next to `anchor`. The preferred side is used when the overlay fits between the
 * anchor and the viewport edge; otherwise the other side is used when it fits there; when neither
 * side fits, the side with more room wins (the overlay may then leave the viewport vertically, but
 * it still never covers the anchor).
 */
export function placeOverlay(
  anchor: OverlayRect,
  size: OverlaySize,
  viewport: Viewport,
  prefer: OverlayPreference = 'above',
): Placement {
  const roomAbove = anchor.top - OVERLAY_GAP_PX
  const roomBelow = viewport.height - (anchor.top + anchor.height) - OVERLAY_GAP_PX
  const fitsAbove = size.height <= roomAbove
  const fitsBelow = size.height <= roomBelow

  let side: 'above' | 'below'
  if (prefer === 'above') side = fitsAbove || (!fitsBelow && roomAbove >= roomBelow) ? 'above' : 'below'
  else side = fitsBelow || (!fitsAbove && roomBelow >= roomAbove) ? 'below' : 'above'

  const top =
    side === 'above' ? anchor.top - OVERLAY_GAP_PX - size.height : anchor.top + anchor.height + OVERLAY_GAP_PX

  // Centered on the anchor, then clamped into the viewport (left edge wins when the overlay is wider
  // than the viewport).
  const centered = anchor.left + anchor.width / 2 - size.width / 2
  const maxLeft = viewport.width - VIEWPORT_MARGIN_PX - size.width
  const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(centered, maxLeft))

  return { left, top, width: size.width, height: size.height, side }
}

/** True when two rects share any area (touching edges do not count). */
export function rectsIntersect(a: OverlayRect, b: OverlayRect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height
}
