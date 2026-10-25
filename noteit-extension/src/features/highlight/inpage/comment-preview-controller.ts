// Mounts the read-only comment preview into the page's Shadow host (Story 3.14). One preview at a
// time, registered with the page-wide overlay manager. The preview never replaces another open
// overlay (floating menu, popover): hovering a highlight must not close what the user is working in.
import { h, render } from 'preact'
import { mountShadowHost, overlayManager, type OverlayRect } from '../../../ui/inpage/index.ts'
import { PRIMITIVES_CSS } from '../../../ui/inpage/primitives/index.ts'
import { COMMENT_PREVIEW_CSS, CommentPreview } from './CommentPreview.tsx'

let sheet: CSSStyleSheet | null = null
let open: {
  container: HTMLElement
  overlay: { close(): void }
  key: string
  anchor: OverlayRect
  comment: string
} | null = null

/**
 * Shows `comment` next to `anchor` (viewport coordinates). `key` identifies the hovered highlight so
 * moving between its spans keeps the same preview. Returns false when nothing was shown.
 */
export function showCommentPreview(key: string, anchor: OverlayRect, comment: string): boolean {
  if (open?.key === key) {
    // Same highlight: keep the preview, but re-render when the stored comment changed.
    if (open.comment !== comment) {
      open.comment = comment
      render(h(CommentPreview, { anchor: open.anchor, comment }), open.container)
    }
    return true
  }
  const active = overlayManager.active
  if (active !== null && active !== open?.overlay) return false
  const shadow = mountShadowHost()
  if (!shadow) return false
  sheet = shadow.adoptStyles(sheet ?? `${PRIMITIVES_CSS}${COMMENT_PREVIEW_CSS}`)
  hideCommentPreview()

  const container = document.createElement('div')
  shadow.root.append(container)
  const overlay = {
    close() {
      render(null, container)
      container.remove()
      if (open?.overlay === overlay) open = null
    },
  }
  open = { container, overlay, key, anchor, comment }
  overlayManager.open(overlay)
  render(h(CommentPreview, { anchor, comment }), container)
  return true
}

export function hideCommentPreview(): void {
  if (open) overlayManager.close(open.overlay)
}

/**
 * Keeps the open preview in line with the stored record of `key` (sync edits from the side panel or
 * another tab): re-renders a changed comment, closes the preview when the comment is gone.
 */
export function refreshCommentPreview(key: string, comment: string | null | undefined): void {
  if (open?.key !== key) return
  if (!comment) {
    hideCommentPreview()
    return
  }
  showCommentPreview(key, open.anchor, comment)
}

/** Key of the highlight whose preview is open, or null. */
export function openCommentPreviewKey(): string | null {
  return open?.key ?? null
}
