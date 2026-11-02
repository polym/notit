// In-page overlay mutual exclusion (EXPERIENCE.md: at most one in-page overlay at a time; the
// floating menu and the highlight popover exclude each other). DOM-agnostic: an overlay is anything
// that can close itself.

export interface Overlay {
  /** Removes the overlay. Called at most once by the manager. */
  close(): void
}

export class OverlayManager {
  private current: Overlay | null = null

  /** Opens `overlay`, closing the one that is currently open (if it is a different overlay). */
  open(overlay: Overlay): void {
    if (this.current === overlay) return
    this.closeCurrent()
    this.current = overlay
  }

  /** Closes `overlay` when it is the open one; a stale handle is ignored. */
  close(overlay: Overlay): void {
    if (this.current !== overlay) return
    this.closeCurrent()
  }

  /** Closes whatever is open. */
  closeAll(): void {
    this.closeCurrent()
  }

  isOpen(overlay: Overlay): boolean {
    return this.current === overlay
  }

  get active(): Overlay | null {
    return this.current
  }

  private closeCurrent(): void {
    const previous = this.current
    // Cleared first so an overlay whose close() re-enters the manager sees nothing open.
    this.current = null
    previous?.close()
  }
}

/** The page-wide manager shared by every in-page feature. */
export const overlayManager = new OverlayManager()
