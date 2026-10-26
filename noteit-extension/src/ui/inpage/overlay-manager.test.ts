import { describe, expect, it, vi } from 'vitest'
import { OverlayManager, type Overlay } from './overlay-manager.ts'

const overlay = () => ({ close: vi.fn<() => void>() })

describe('OverlayManager', () => {
  it('closes the first overlay when a second one opens', () => {
    const manager = new OverlayManager()
    const first = overlay()
    const second = overlay()
    manager.open(first)
    manager.open(second)
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(second.close).not.toHaveBeenCalled()
    expect(manager.active).toBe(second)
  })

  it('does not close an overlay that is opened again', () => {
    const manager = new OverlayManager()
    const first = overlay()
    manager.open(first)
    manager.open(first)
    expect(first.close).not.toHaveBeenCalled()
  })

  it('ignores close() for an overlay that is no longer open', () => {
    const manager = new OverlayManager()
    const first = overlay()
    const second = overlay()
    manager.open(first)
    manager.open(second)
    manager.close(first)
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(manager.isOpen(second)).toBe(true)
  })

  it('closeAll closes the open overlay once', () => {
    const manager = new OverlayManager()
    const first = overlay()
    manager.open(first)
    manager.closeAll()
    manager.closeAll()
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(manager.active).toBeNull()
  })

  it('lets a closing overlay re-enter the manager', () => {
    const manager = new OverlayManager()
    const first: Overlay = { close: () => manager.close(first) }
    const second = overlay()
    manager.open(first)
    manager.open(second)
    expect(manager.active).toBe(second)
  })
})
