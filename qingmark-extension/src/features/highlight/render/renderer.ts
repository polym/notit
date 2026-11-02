// Renderer interface (architecture.md D7 "Renderer"). Callers resolve anchors to Ranges through the
// TextIndex and hand them to a Renderer; they never touch the painted DOM themselves, so the engine
// (mark.js today, CSS Custom Highlight API after the M3 spike) can change without changing callers.
import type { ColorName } from '../../../core/model/index.ts'

export interface HighlightStyle {
  color: ColorName
  /** Has a comment: drawn with the dotted underline (DESIGN.md highlight-mark-commented). */
  commented: boolean
}

/** Rectangle in viewport coordinates. */
export interface RendererRect {
  left: number
  top: number
  width: number
  height: number
}

/** highlight-flash duration (DESIGN.md "Components"). */
export const HIGHLIGHT_FLASH_MS = 1200

export interface PaintItem {
  id: string
  range: Range
  style: HighlightStyle
}

export interface Renderer {
  /**
   * True when painting inserts host elements (mark.js). The CSS Custom Highlight API paints no
   * elements, so pointer events never enter a highlight and hover needs mousemove hit tests.
   */
  readonly paintsElements: boolean
  /** Paints `range` as highlight `id`. Painting an id that is already painted replaces it. */
  paint(id: string, range: Range, style: HighlightStyle): void
  /**
   * Paints several highlights in one pass. Every Range is read before any of them is painted, so
   * overlapping Ranges (live, split by painting) keep their text whatever the order.
   */
  paintAll(items: Iterable<PaintItem>): void
  remove(id: string): void
  /** Removes every highlight. */
  clear(): void
  /** highlight-flash for HIGHLIGHT_FLASH_MS; false if `id` is not painted. */
  flash(id: string): boolean
  /** Id of the highlight under the viewport point, or null. */
  hitTest(x: number, y: number): string | null
  /** True when a MutationRecord was caused by this renderer's own painting. */
  isOwnMutation(record: MutationRecord): boolean

  // Helpers used by the in-page UI (popover anchor, jump, repaint without re-resolving).
  /** Changes the style of a painted highlight; no-op when it is not painted. */
  restyle(id: string, style: HighlightStyle): void
  isPainted(id: string): boolean
  /** Union of the highlight's client rects, or null when nothing visible is painted. */
  boundingRect(id: string): RendererRect | null
  /** Scrolls the highlight to the middle of the viewport; false when it is not painted. */
  scrollIntoView(id: string): boolean
}
