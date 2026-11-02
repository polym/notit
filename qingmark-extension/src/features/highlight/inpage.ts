// Content script public surface of the highlight feature (Stories 3.13, 3.14, 3.15). Kept apart from index.ts so the
// service worker graph never reaches Preact or the in-page UI.
export {
  hideFloatingMenu,
  installFloatingMenuKeyGuard,
  isFloatingMenuOpen,
  isInsideFloatingMenu,
  repositionFloatingMenu,
  showFloatingMenu,
  type DismissReason,
  type FloatingMenuHandlers,
} from './inpage/floating-menu-controller.ts'
export {
  hideCommentPreview,
  openCommentPreviewKey,
  refreshCommentPreview,
  showCommentPreview,
} from './inpage/comment-preview-controller.ts'
export {
  hideHighlightPopover,
  isInsideHighlightPopover,
  openHighlightPopoverKey,
  refreshHighlightPopover,
  repositionHighlightPopover,
  showHighlightPopover,
  type HighlightPopoverHandlers,
} from './inpage/highlight-popover-controller.ts'
export { UNDO_TOAST_MS, hideUndoToast, showUndoToast } from './inpage/undo-toast-controller.ts'
export { createTextIndex, type TextIndex } from './anchoring/text-index.ts'
export { describeSelection } from './anchoring/describe.ts'
export { resolveAnchor } from './anchoring/resolve.ts'
export { anchorQuery, resolveRecords, type RestoredRecord } from './anchoring/restore.ts'
export { HIGHLIGHT_FLASH_MS, type HighlightStyle, type Renderer, type RendererRect } from './render/renderer.ts'
export { MarkRenderer } from './render/mark-renderer.ts'
export { HighlightApiRenderer } from './render/highlight-api-renderer.ts'
export { BUILD_RENDERER, createRenderer, type RendererKind } from './render/create-renderer.ts'
export { OBSERVER_DEBOUNCE_MS, OBSERVER_MAX_WAIT_MS, PageObserver, type PageObserverOptions } from './inpage/observer.ts'
export { CHUNK_BUDGET_MS, CHUNK_MAX_ITEMS, runChunked, yieldToPage } from './inpage/chunked.ts'
export { runRestorePass, type RestorePassOptions, type RestorePassResult } from './inpage/restore-pass.ts'
