// Mounts the highlight popover into the page's Shadow host (Story 3.15). One popover at a time,
// registered with the page-wide overlay manager, so opening it closes the floating menu and the
// comment preview. Focus moves into the popover when it opens and returns to the element that had it
// when the popover closes through its own actions (Esc, save, delete); an outside click leaves focus
// where the click put it, and a focus target that is gone is not forced.
import { h, render } from 'preact'
import type { ColorName } from '../../../core/model/index.ts'
import { HOST_TAG, mountShadowHost, overlayManager, type OverlayRect } from '../../../ui/inpage/index.ts'
import { PRIMITIVES_CSS } from '../../../ui/inpage/primitives/index.ts'
import { HIGHLIGHT_POPOVER_CSS, HighlightPopover } from './HighlightPopover.tsx'

export interface HighlightPopoverHandlers {
  onPickColor: (color: ColorName) => void
  /** Trimmed editor value; the popover is already closed. */
  onSaveComment: (comment: string) => void
  /** `rect` is where the popover was (viewport coordinates); the popover is already closed. */
  onDelete: (rect: OverlayRect) => void
}

interface OpenPopover {
  key: string
  container: HTMLElement
  overlay: { close(): void }
  anchor: OverlayRect
  color: ColorName
  comment: string
  handlers: HighlightPopoverHandlers
  /** Element focused before the popover opened. */
  returnFocus: HTMLElement | null
  /** Set by the popover's own close paths; an outside click leaves it false. */
  restoreFocus: boolean
}

let sheet: CSSStyleSheet | null = null
let open: OpenPopover | null = null

/** The page element that has focus, ignoring the Shadow host itself and <body>. */
function focusedPageElement(): HTMLElement | null {
  const el = document.activeElement
  if (!(el instanceof HTMLElement) || el === document.body || el.localName === HOST_TAG) return null
  return el
}

function renderOpen(state: OpenPopover): void {
  render(
    h(HighlightPopover, {
      anchor: state.anchor,
      color: state.color,
      comment: state.comment,
      onPickColor: (color) => state.handlers.onPickColor(color),
      onSaveComment: (comment) => {
        closeOwn(state)
        state.handlers.onSaveComment(comment)
      },
      onDelete: () => {
        const box = state.container.firstElementChild?.getBoundingClientRect()
        const rect = box
          ? { left: box.left, top: box.top, width: box.width, height: box.height }
          : { ...state.anchor, top: state.anchor.top + state.anchor.height }
        closeOwn(state)
        state.handlers.onDelete(rect)
      },
      onClose: () => closeOwn(state),
    }),
    state.container,
  )
}

/** Closes through the popover's own action: focus goes back to where it was. */
function closeOwn(state: OpenPopover): void {
  state.restoreFocus = true
  overlayManager.close(state.overlay)
}

/**
 * Opens the popover for highlight `key` below `anchor` (viewport coordinates); replaces any open
 * overlay, including a popover of another highlight. False when the Shadow host is unavailable.
 */
export function showHighlightPopover(
  key: string,
  anchor: OverlayRect,
  record: { color: ColorName; comment: string | null },
  handlers: HighlightPopoverHandlers,
): boolean {
  const shadow = mountShadowHost()
  if (!shadow) return false
  sheet = shadow.adoptStyles(sheet ?? `${PRIMITIVES_CSS}${HIGHLIGHT_POPOVER_CSS}`)
  const returnFocus = focusedPageElement()
  hideHighlightPopover()

  const container = document.createElement('div')
  shadow.root.append(container)
  const state: OpenPopover = {
    key,
    container,
    anchor,
    color: record.color,
    comment: record.comment ?? '',
    handlers,
    returnFocus,
    restoreFocus: false,
    overlay: {
      close() {
        render(null, container)
        container.remove()
        if (open === state) open = null
        const target = state.returnFocus
        if (state.restoreFocus && target?.isConnected) target.focus({ preventScroll: true })
      },
    },
  }
  open = state
  overlayManager.open(state.overlay)
  renderOpen(state)
  return true
}

/** Closes the popover without saving; `restoreFocus` returns focus as the popover's own Esc does. */
export function hideHighlightPopover(options: { restoreFocus?: boolean } = {}): void {
  if (!open) return
  open.restoreFocus = options.restoreFocus ?? false
  overlayManager.close(open.overlay)
}

/** Follows a stored color change of the open popover's highlight (the editor input is kept). */
export function refreshHighlightPopover(key: string, color: ColorName): void {
  if (open?.key !== key || open.color === color) return
  open.color = color
  renderOpen(open)
}

/** Moves the open popover next to its highlight's new rect (scroll, reflow). */
export function repositionHighlightPopover(anchor: OverlayRect): void {
  if (!open) return
  open.anchor = anchor
  renderOpen(open)
}

/** Key of the highlight whose popover is open, or null. */
export function openHighlightPopoverKey(): string | null {
  return open?.key ?? null
}

/** True when the event happened inside the open popover (events from the Shadow root are retargeted). */
export function isInsideHighlightPopover(event: Event): boolean {
  return open !== null && event.composedPath().includes(open.container)
}
