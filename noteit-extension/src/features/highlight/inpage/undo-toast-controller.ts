// In-page undo toast (Story 3.15, EXPERIENCE Q57 / Q60): after a delete from the highlight popover,
// "deleted · undo" shows at the former popover position for 5 seconds, in this tab only. It is not
// one of the mutually exclusive overlays: opening a menu or popover must not take the undo away.
// The aria-live region stays mounted once created so screen readers announce each new toast.
import { h, render } from 'preact'
import { mountShadowHost, type OverlayRect } from '../../../ui/inpage/index.ts'
import { TOAST_CSS, Toast } from '../../../ui/inpage/primitives/index.ts'
import { VIEWPORT_MARGIN_PX } from '../../../ui/inpage/place-overlay.ts'
import { strings } from '../../../ui/strings.ts'

/** undo-toast duration (DESIGN.md components.undo-toast.duration). */
export const UNDO_TOAST_MS = 5000

let sheet: CSSStyleSheet | null = null
let region: HTMLElement | null = null
let timer: ReturnType<typeof setTimeout> | null = null

function clearTimer(): void {
  if (timer !== null) clearTimeout(timer)
  timer = null
}

/** Shows the undo toast at `at` (viewport coordinates); a newer toast replaces the current one. */
export function showUndoToast(at: OverlayRect, onUndo: () => void): boolean {
  const shadow = mountShadowHost()
  if (!shadow) return false
  sheet = shadow.adoptStyles(sheet ?? TOAST_CSS)
  if (!region || !region.isConnected) {
    region = document.createElement('div')
    region.setAttribute('role', 'status')
    region.setAttribute('aria-live', 'polite')
    region.dataset.noteitToastRegion = ''
    shadow.root.append(region)
  }
  clearTimer()
  const draw = (left: number, top: number) =>
    render(
      h(Toast, {
        left,
        top,
        message: strings.deleted,
        actionLabel: strings.undo,
        onAction: () => {
          hideUndoToast()
          onUndo()
        },
      }),
      region!,
    )
  draw(at.left, at.top)
  // Kept inside the viewport once its real size is known.
  const box = region.firstElementChild?.getBoundingClientRect()
  if (box) {
    const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(at.left, window.innerWidth - VIEWPORT_MARGIN_PX - box.width))
    const top = Math.max(VIEWPORT_MARGIN_PX, Math.min(at.top, window.innerHeight - VIEWPORT_MARGIN_PX - box.height))
    if (left !== at.left || top !== at.top) draw(left, top)
  }
  timer = setTimeout(hideUndoToast, UNDO_TOAST_MS)
  return true
}

export function hideUndoToast(): void {
  clearTimer()
  if (region) render(null, region)
}
