/** @jsxImportSource preact */
// highlight-popover (DESIGN.md / EXPERIENCE.md, Story 3.15): opened by clicking a highlight on the page.
// A card with the four color-chips (the current color selected) and the comment-editor prefilled from
// the record; the editor footer leads with a quiet round delete button. A chip click changes the
// color at once; Cmd/Ctrl+Enter or the save button saves the comment; Esc closes and drops the
// unsaved input. Placed 6px below the highlight, flipped above when there is no room (Q65).
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import type { ColorName } from '../../../core/model/index.ts'
import { strings } from '../../../ui/strings.ts'
import { placeOverlay, type OverlayRect } from '../../../ui/inpage/index.ts'
import { COLOR_ORDER, ColorChip, CommentEditor, DeleteIcon, IconButton } from '../../../ui/inpage/primitives/index.ts'

export interface HighlightPopoverProps {
  /** Highlight rect in viewport coordinates. */
  anchor: OverlayRect
  color: ColorName
  /** Stored comment; only the initial editor value (later record changes never overwrite typing). */
  comment: string
  onPickColor: (color: ColorName) => void
  onSaveComment: (comment: string) => void
  onDelete: () => void
  onClose: () => void
}

export function HighlightPopover({
  anchor,
  color,
  comment,
  onPickColor,
  onSaveComment,
  onDelete,
  onClose,
}: HighlightPopoverProps) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const p = placeOverlay(
      anchor,
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      'below',
    )
    setPosition({ left: p.left, top: p.top })
  }, [anchor])

  // Keys inside the popover (Esc on a focused button) stay inside the Shadow root.
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
      class="nt-overlay nt-card nt-highlight-popover"
      data-noteit-popover=""
      role="dialog"
      aria-label={strings.highlightPopoverLabel}
      style={{
        left: `${position?.left ?? 0}px`,
        top: `${position?.top ?? 0}px`,
        visibility: position ? 'visible' : 'hidden',
      }}
      onKeyDown={onKeyDown}
    >
      <div class="nt-chips">
        {COLOR_ORDER.map((c) => (
          <ColorChip key={c} color={c} selected={c === color} onSelect={onPickColor} />
        ))}
      </div>
      {/* Esc inside the editor closes the whole popover (EXPERIENCE: nothing to go back to). */}
      <CommentEditor
        initial={comment}
        onSave={onSaveComment}
        onCancel={onClose}
        leading={
          <IconButton label={strings.deleteHighlight} onClick={onDelete}>
            <DeleteIcon />
          </IconButton>
        }
      />
    </div>
  )
}

/** Component CSS of the highlight popover (on top of the shared primitives). */
export const HIGHLIGHT_POPOVER_CSS = `
.nt-highlight-popover {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 330px;
}
`
