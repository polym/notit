/** @jsxImportSource preact */
// comment-preview (DESIGN.md / EXPERIENCE.md, Story 3.14): read-only comment shown while a commented
// highlight is hovered. A white speech bubble 6px below the highlight (flipped above when there is no
// room, Q65); the corner toward the highlight is the tail. A small accent title sits above the text.
// No button or input of any kind.
import { useLayoutEffect, useRef, useState } from 'preact/hooks'
import { effects } from '../../../ui/tokens/index.ts'
import { strings } from '../../../ui/strings.ts'
import { placeOverlay, type OverlayRect } from '../../../ui/inpage/index.ts'

export interface CommentPreviewProps {
  /** Highlight rect in viewport coordinates. */
  anchor: OverlayRect
  comment: string
}

interface Position {
  left: number
  top: number
  side: 'above' | 'below'
}

export function CommentPreview({ anchor, comment }: CommentPreviewProps) {
  const [position, setPosition] = useState<Position | null>(null)
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
    setPosition({ left: p.left, top: p.top, side: p.side })
  }, [anchor, comment])

  return (
    <div
      ref={ref}
      class="nt-comment-preview"
      data-noteit-preview=""
      data-side={position?.side ?? 'below'}
      // The title is drawn by CSS from this attribute, so the element's text is the comment alone.
      data-title={strings.commentPreviewTitle}
      role="tooltip"
      style={{
        left: `${position?.left ?? 0}px`,
        top: `${position?.top ?? 0}px`,
        visibility: position ? 'visible' : 'hidden',
      }}
    >
      {comment}
    </div>
  )
}

/** Component CSS of the comment preview (on top of the shared primitives). */
export const COMMENT_PREVIEW_CSS = `
.nt-comment-preview {
  position: fixed;
  pointer-events: none;
  box-sizing: border-box;
  max-width: 280px;
  padding: 10px 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--nt-font-family);
  font-size: var(--nt-body-font-size);
  line-height: var(--nt-body-line-height);
  color: var(--nt-foreground);
  background: var(--nt-background);
  border-radius: 16px;
  box-shadow: ${effects.commentPreviewShadow};
}
.nt-comment-preview[data-side='below'] {
  border-top-left-radius: 4px;
}
.nt-comment-preview[data-side='above'] {
  border-bottom-left-radius: 4px;
}
.nt-comment-preview::before {
  content: attr(data-title);
  display: block;
  margin-bottom: 2px;
  font-size: var(--nt-caption-font-size);
  line-height: var(--nt-caption-line-height);
  font-weight: 600;
  color: var(--nt-primary);
}
`
