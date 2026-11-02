// Last known scroll position of each rendered highlight, so a jump can bring back one that a virtual
// list (x.com threads) unmounted: scrolling its container there makes the page render the post again,
// and the next restore pass paints the highlight.

interface Spot {
  /** Nearest scrollable ancestor; null for the document. */
  container: Element | null
  /** Top of the highlight in the container's (or the document's) scroll coordinates. */
  top: number
}

/** Nearest ancestor of `node` that scrolls vertically, or null when only the document does. */
export function scrollParent(node: Node): Element | null {
  for (let el = node instanceof Element ? node : node.parentElement; el; el = el.parentElement) {
    if (el === document.body || el === document.documentElement) return null
    const { overflowY } = getComputedStyle(el)
    if ((overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') && el.scrollHeight > el.clientHeight) return el
  }
  return null
}

export class ScrollMemory {
  private readonly spots = new Map<string, Spot>()

  /** Records where highlight `id` is; `rectTop` is its viewport top, `node` a node inside it. */
  remember(id: string, node: Node, rectTop: number): void {
    const container = scrollParent(node)
    const top = container
      ? rectTop - container.getBoundingClientRect().top + container.scrollTop
      : rectTop + window.scrollY
    this.spots.set(id, { container, top })
  }

  /** Scrolls to the last known spot of `id` (centered); false when none is known or its container is gone. */
  restore(id: string): boolean {
    const spot = this.spots.get(id)
    if (!spot) return false
    if (spot.container) {
      if (!spot.container.isConnected) return false
      spot.container.scrollTo({ top: Math.max(0, spot.top - spot.container.clientHeight / 2), behavior: 'instant' })
    } else {
      window.scrollTo({ top: Math.max(0, spot.top - window.innerHeight / 2), behavior: 'instant' })
    }
    return true
  }

  clear(): void {
    this.spots.clear()
  }
}
