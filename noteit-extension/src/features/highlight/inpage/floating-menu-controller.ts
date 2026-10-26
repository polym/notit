// Mounts the floating menu into the page's Shadow host (Story 3.13). One menu at a time, registered
// with the page-wide overlay manager so any other overlay closes it.
import { h, render } from 'preact'
import type { ColorName } from '../../../core/model/index.ts'
import { HOST_TAG, mountShadowHost, overlayManager, type OverlayRect } from '../../../ui/inpage/index.ts'
import { PRIMITIVES_CSS, isSaveChord } from '../../../ui/inpage/primitives/index.ts'
import { FLOATING_MENU_CSS, FloatingMenu } from './FloatingMenu.tsx'
import { hideHighlightPopover, openHighlightPopoverKey } from './highlight-popover-controller.ts'

export interface FloatingMenuHandlers {
  onPick: (color: ColorName, comment: string | null) => void
  /**
   * Called when the menu closes without a pick. `explicit` is an Esc dismissal by the user; `other`
   * covers an outside click, a replacement menu or another overlay taking over.
   */
  onDismiss?: (reason: DismissReason) => void
}

export type DismissReason = 'explicit' | 'other'

let sheet: CSSStyleSheet | null = null
let open: { container: HTMLElement; overlay: { close(): void }; dismiss: (reason: DismissReason) => void } | null =
  null

/** Opens the menu next to `anchor` (viewport coordinates); replaces a menu that is already open. */
export function showFloatingMenu(anchor: OverlayRect, handlers: FloatingMenuHandlers): boolean {
  const shadow = mountShadowHost()
  if (!shadow) return false
  sheet = shadow.adoptStyles(sheet ?? `${PRIMITIVES_CSS}${FLOATING_MENU_CSS}`)
  hideFloatingMenu()

  const container = document.createElement('div')
  shadow.root.append(container)
  let picked = false
  let reason: DismissReason = 'other'
  const overlay = {
    close() {
      render(null, container)
      container.remove()
      if (open?.overlay === overlay) open = null
      if (!picked) handlers.onDismiss?.(reason)
    },
  }
  const dismiss = (why: DismissReason) => {
    reason = why
    overlayManager.close(overlay)
  }
  open = { container, overlay, dismiss }
  overlayManager.open(overlay)
  render(
    h(FloatingMenu, {
      anchor,
      onPick: (color, comment) => {
        picked = true
        overlayManager.close(overlay)
        handlers.onPick(color, comment)
      },
      onClose: () => dismiss('explicit'),
    }),
    container,
  )
  return true
}

export function hideFloatingMenu(reason: DismissReason = 'other'): void {
  open?.dismiss(reason)
}

export function isFloatingMenuOpen(): boolean {
  return open !== null
}

/** True when the event happened inside the open menu (events from the Shadow root are retargeted). */
export function isInsideFloatingMenu(event: Event): boolean {
  return open !== null && event.composedPath().includes(open.container)
}

/** Marks a key event re-dispatched inside the Shadow root, so the guard does not handle it twice. */
const REDISPATCHED = new WeakSet<Event>()
let guardInstalled = false

/**
 * Installs one window keydown listener in the capture phase (Story 3.13 AC: the host page's keydown
 * listeners never receive Esc or the save chord meant for the menu). Call it once, as early as
 * possible in the content script: window capture listeners run in registration order, so it runs
 * before every page capture listener registered after it (and before all page bubble listeners).
 *
 * Known limit: the content script runs at document_end, so a window capture keydown listener the
 * page registered before injection still runs first and cannot be prevented from seeing the key.
 *
 * - Esc with focus on the page while the menu or the highlight popover (Story 3.15) is open:
 *   stopped and closes it.
 * - Esc or the save chord from inside the Shadow host: stopped here, then re-dispatched as a
 *   non-composed copy on the original target, so it reaches the Preact handlers inside the shadow
 *   root but never leaves it.
 */
export function installFloatingMenuKeyGuard(win: Window = window): void {
  if (guardInstalled) return
  guardInstalled = true
  win.addEventListener(
    'keydown',
    (e) => {
      if (REDISPATCHED.has(e)) return
      const isEsc = e.key === 'Escape'
      if (!isEsc && !isSaveChord(e)) return
      const path = e.composedPath()
      const host = path.find((node) => node instanceof Element && node.localName === HOST_TAG)
      if (!host) {
        const popoverOpen = openHighlightPopoverKey() !== null
        if (!isEsc || (!open && !popoverOpen)) return
        e.preventDefault()
        e.stopImmediatePropagation()
        if (popoverOpen) hideHighlightPopover({ restoreFocus: true })
        else hideFloatingMenu('explicit')
        return
      }
      e.preventDefault()
      e.stopImmediatePropagation()
      // The first path entry is the real target inside the shadow root (composedPath is unretargeted
      // for listeners that see the whole path).
      const target = path[0]
      if (!(target instanceof Node) || target === host) return
      const copy = new KeyboardEvent('keydown', {
        key: e.key,
        code: e.code,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
        repeat: e.repeat,
        bubbles: true,
        cancelable: true,
        composed: false,
      })
      REDISPATCHED.add(copy)
      target.dispatchEvent(copy)
    },
    true,
  )
}
