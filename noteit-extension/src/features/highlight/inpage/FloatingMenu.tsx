/** @jsxImportSource preact */
// floating-menu (DESIGN.md / EXPERIENCE.md, Story 3.13): a pill with four named color-chips (yellow
// first) and a round accent comment button. A chip click creates the highlight in that color. The
// comment button turns the pill into a card with the comment-editor below; while it is open a chip
// click only picks the color, and Cmd/Ctrl+Enter or the save button creates the highlight with its
// comment. Esc closes the menu, or cancels the editor when it is open.
// Selection translation (another feature) injects `renderTranslation`: a translate toggle in the
// same row that opens the translate section below the row, above the editor. Both can be open; the
// editor can then take over the translation. The expanded menu keeps the side it opened on and grows
// away from the selection.
import type { ComponentChildren } from 'preact'
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ColorName } from '../../../core/model/index.ts'
import { strings } from '../../../ui/strings.ts'
import { OVERLAY_GAP_PX, placeOverlay, type OverlayRect } from '../../../ui/inpage/index.ts'
import { COLOR_ORDER, ColorChip, CommentEditor, CommentIcon, IconButton, TranslateIcon } from '../../../ui/inpage/primitives/index.ts'

/** Height assumed for the expanded menu when picking the side it grows on (editor + a result). */
const EXPANDED_HEIGHT_PX = 280
/** Width of the expanded menu (FLOATING_MENU_CSS .nt-floating-menu-open). */
const EXPANDED_WIDTH_PX = 384

export interface FloatingMenuProps {
  /** Selection rect in viewport coordinates (updated while the page scrolls). */
  anchor: OverlayRect
  onPick: (color: ColorName, comment: string | null) => void
  onClose: () => void
  /**
   * Injected by the content script (another feature); the toggle shows only when given. Called while
   * the section is open; `onResult` receives the text the editor can insert (null until a result).
   */
  renderTranslation?: (onResult: (insertable: string | null) => void) => ComponentChildren
}

export function FloatingMenu({ anchor, onPick, onClose, renderTranslation }: FloatingMenuProps) {
  const [editing, setEditing] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [insertable, setInsertable] = useState<string | null>(null)
  const [color, setColor] = useState<ColorName>('yellow')
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  // Side picked when the menu expands from the pill; kept while it stays expanded.
  const [side, setSide] = useState<'above' | 'below'>('above')
  const expanded = editing || translating

  // Q65: above the selection, flipped below when there is no room. Expanded, the side is picked once
  // for the expanded height and kept, so loading -> result or opening the editor never flips it.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const place = () => {
      const size = { width: el.offsetWidth, height: el.offsetHeight }
      const p = placeOverlay(anchor, size, viewport, 'above')
      let top = p.top
      if (expanded) top = side === 'above' ? anchor.top - OVERLAY_GAP_PX - size.height : anchor.top + anchor.height + OVERLAY_GAP_PX
      setPosition({ left: p.left, top })
    }
    place()
    // The translate section changes height on its own (loading -> result).
    const observer = new ResizeObserver(place)
    observer.observe(el)
    return () => observer.disconnect()
  }, [anchor, expanded, side])

  // Esc while focus is still on the host page (right after selecting) is handled by the window
  // capture guard in floating-menu-controller.ts (installFloatingMenuKeyGuard).

  // Picks the side for the expanded height before the pill expands (Q65 rules, expanded size).
  const expandFromPill = () => {
    if (expanded) return
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    setSide(placeOverlay(anchor, { width: EXPANDED_WIDTH_PX, height: EXPANDED_HEIGHT_PX }, viewport, 'above').side)
  }

  const toggleEditing = () => {
    if (!editing) expandFromPill()
    setEditing(!editing)
  }

  const pickChip = (picked: ColorName) => {
    if (editing) setColor(picked)
    else onPick(picked, null)
  }

  const toggleTranslation = () => {
    if (translating) setInsertable(null)
    else expandFromPill()
    setTranslating(!translating)
  }

  // Keys inside the menu (Esc on a focused button) stay inside the Shadow root.
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  // mousedown default would move focus and drop the page selection before the click.
  const keepSelection = (e: MouseEvent) => e.preventDefault()

  return (
    <div
      ref={ref}
      class={`nt-overlay nt-floating-menu ${expanded ? 'nt-card nt-floating-menu-open' : 'nt-pill'}`}
      data-noteit-menu=""
      role="toolbar"
      aria-label={strings.floatingMenuLabel}
      style={{
        left: `${position?.left ?? 0}px`,
        top: `${position?.top ?? 0}px`,
        visibility: position ? 'visible' : 'hidden',
      }}
      onKeyDown={onKeyDown}
    >
      <div class="nt-floating-menu-row" onMouseDown={keepSelection}>
        {COLOR_ORDER.map((c) => (
          <ColorChip key={c} color={c} selected={editing && c === color} onSelect={pickChip} />
        ))}
        <IconButton label={strings.commentButton} variant="accent" pressed={editing} onClick={toggleEditing}>
          <CommentIcon />
        </IconButton>
        {renderTranslation && (
          <IconButton label={strings.translateButton} pressed={translating} onClick={toggleTranslation}>
            <TranslateIcon />
          </IconButton>
        )}
      </div>
      {renderTranslation && translating && (
        <div class="nt-floating-menu-section" onMouseDown={keepSelection}>
          {renderTranslation(setInsertable)}
        </div>
      )}
      {editing && (
        <div class="nt-floating-menu-section">
          <CommentEditor
            onSave={(value) => onPick(color, value || null)}
            onCancel={() => setEditing(false)}
            insert={translating && insertable ? { label: strings.translateInsert, text: insertable } : undefined}
          />
        </div>
      )}
    </div>
  )
}

/** Component CSS of the floating menu (on top of the shared primitives). */
export const FLOATING_MENU_CSS = `
.nt-floating-menu-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.nt-floating-menu-open {
  width: 384px;
  max-width: calc(100vw - 16px);
}
/* All buttons stay on one row: 4 chips + comment + translate fit in 384px. */
.nt-floating-menu-open .nt-floating-menu-row {
  flex-wrap: nowrap;
  gap: 6px;
}
.nt-floating-menu-section {
  margin-top: 10px;
}
.nt-floating-menu-section + .nt-floating-menu-section {
  padding-top: 10px;
  border-top: 1px solid var(--nt-hover);
}
.nt-round-soft[aria-pressed='true'] {
  background: color-mix(in srgb, var(--nt-primary) 14%, var(--nt-background));
  color: var(--nt-primary);
}
`
