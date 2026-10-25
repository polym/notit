/** @jsxImportSource preact */
// floating-menu (DESIGN.md / EXPERIENCE.md, Story 3.13): a pill with four named color-chips (yellow
// first) and a round accent comment button. A chip click creates the highlight in that color. The
// comment button turns the pill into a card with the comment-editor below; while it is open a chip
// click only picks the color, and Cmd/Ctrl+Enter or the save button creates the highlight with its
// comment. Esc closes the menu, or cancels the editor when it is open.
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ColorName } from '../../../core/model/index.ts'
import { strings } from '../../../ui/strings.ts'
import { placeOverlay, type OverlayRect } from '../../../ui/inpage/index.ts'
import { COLOR_ORDER, ColorChip, CommentEditor, CommentIcon, IconButton } from '../../../ui/inpage/primitives/index.ts'

export interface FloatingMenuProps {
  /** Selection rect in viewport coordinates. */
  anchor: OverlayRect
  onPick: (color: ColorName, comment: string | null) => void
  onClose: () => void
}

export function FloatingMenu({ anchor, onPick, onClose }: FloatingMenuProps) {
  const [editing, setEditing] = useState(false)
  const [color, setColor] = useState<ColorName>('yellow')
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // Q65: above the selection, flipped below when there is no room; re-placed when the editor opens.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const p = placeOverlay(
      anchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      'above',
    )
    setPosition({ left: p.left, top: p.top })
  }, [anchor, editing])

  // Esc while focus is still on the host page (right after selecting) is handled by the window
  // capture guard in floating-menu-controller.ts (installFloatingMenuKeyGuard).

  const pickChip = (picked: ColorName) => {
    if (editing) setColor(picked)
    else onPick(picked, null)
  }

  // Keys inside the menu (Esc on a focused button) stay inside the Shadow root.
  const onKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      ref={ref}
      class={`nt-overlay nt-floating-menu ${editing ? 'nt-card nt-floating-menu-open' : 'nt-pill'}`}
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
      {/* mousedown default would move focus and drop the page selection before the click. */}
      <div class="nt-floating-menu-row" onMouseDown={(e) => e.preventDefault()}>
        {COLOR_ORDER.map((c) => (
          <ColorChip key={c} color={c} selected={editing && c === color} onSelect={pickChip} />
        ))}
        <IconButton label={strings.commentButton} variant="accent" pressed={editing} onClick={() => setEditing(!editing)}>
          <CommentIcon />
        </IconButton>
      </div>
      {editing && (
        <div class="nt-floating-menu-editor">
          <CommentEditor onSave={(value) => onPick(color, value || null)} onCancel={() => setEditing(false)} />
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
  width: 360px;
}
.nt-floating-menu-open .nt-floating-menu-row {
  flex-wrap: wrap;
  gap: 6px;
}
.nt-floating-menu-editor {
  margin-top: 10px;
}
`
