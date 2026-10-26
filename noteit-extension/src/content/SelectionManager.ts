import type { ColorName, HighlightRecord } from '../core/model';
import {
  createTextIndex,
  describeSelection,
  type Renderer,
  hideCommentPreview,
  hideFloatingMenu,
  hideHighlightPopover,
  hideUndoToast,
  isInsideFloatingMenu,
  isInsideHighlightPopover,
  openCommentPreviewKey,
  openHighlightPopoverKey,
  refreshHighlightPopover,
  repositionHighlightPopover,
  showCommentPreview,
  showFloatingMenu,
  showHighlightPopover,
  showUndoToast,
} from '../features/highlight/inpage.ts';
import { HOST_TAG, type OverlayRect } from '../ui/inpage/index.ts';
import type { ErrorCode, Result } from '../core/messaging';
import type { CreateHighlightReq } from '../features/highlight/index.ts';
import { errorText } from '../ui/strings.ts';
import { client } from './client';
import { isExtensionEnabled, isSignedIn, pageRecords } from './state';
import { generateId } from './id';

const ERROR_LINE_ID = 'noteit-error-line';
const ERROR_LINE_MS = 4000;

export class SelectionManager {
  private renderer: Renderer;
  private currentSelectionRange: Range | null = null;
  private justClosedMenu: boolean = false;

  constructor(renderer: Renderer) {
    this.renderer = renderer;
    this.init();
  }

  private onMenuClose() {
    // Set flag to prevent immediate reopening
    this.justClosedMenu = true;
    setTimeout(() => {
      this.justClosedMenu = false;
    }, 100);
  }

  private init() {
    document.addEventListener('mouseup', this.handleMouseUp.bind(this));
    // Use capture phase to handle clicks before they reach the menu
    document.addEventListener('mousedown', this.handleMouseDown.bind(this), true);
    // Hovering a commented highlight shows the read-only comment preview (Story 3.14, #14).
    document.addEventListener('mouseover', this.handleMouseOver.bind(this));
    document.addEventListener('mouseout', this.handleMouseOut.bind(this));
    // Highlight API paints no elements, so mouseover never fires on entering a highlight; hit test on
    // pointer moves instead (one per animation frame).
    if (!this.renderer.paintsElements) {
      document.addEventListener('mousemove', this.handleMouseMove.bind(this), { passive: true });
    }
    // Clicking a highlight opens the highlight popover (Story 3.15, FR5, Q39).
    document.addEventListener('click', this.handleClick.bind(this));
    // The preview is fixed-positioned next to the highlight; a scroll would leave it behind. The
    // popover may hold unsaved input, so it follows its highlight instead of closing.
    window.addEventListener('scroll', () => {
      hideCommentPreview();
      this.schedulePopoverReposition();
    }, { capture: true, passive: true });
    window.addEventListener('resize', () => this.schedulePopoverReposition(), { passive: true });
  }

  private repositionFrame: number | null = null;

  private schedulePopoverReposition() {
    if (openHighlightPopoverKey() === null || this.repositionFrame !== null) return;
    this.repositionFrame = requestAnimationFrame(() => {
      this.repositionFrame = null;
      const key = openHighlightPopoverKey();
      if (key === null) return;
      const rect = this.renderer.boundingRect(key);
      if (rect) repositionHighlightPopover(rect);
      else hideHighlightPopover();
    });
  }

  private handleMouseDown(e: MouseEvent) {
    // Clicks inside a menu or popover keep it open; any other click closes it (unsaved input dropped).
    if (!isInsideFloatingMenu(e)) hideFloatingMenu();
    if (!isInsideHighlightPopover(e)) hideHighlightPopover();
    hideCommentPreview();
  }

  private handleClick(e: MouseEvent) {
    // Login gate (FR27): no popover while signed out or with the site off.
    if (!isExtensionEnabled() || !isSignedIn()) return;
    if (e.button !== 0 || this.isFromOverlay(e)) return;
    // The end of a drag selection inside a highlight is not a click on it.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;
    const id = this.renderer.hitTest(e.clientX, e.clientY);
    if (!id) return;
    // The popover is filled from the stored record, never from the DOM.
    const record = pageRecords.get(id);
    if (!record) return;
    const anchor = this.renderer.boundingRect(id);
    if (!anchor) return;
    showHighlightPopover(id, anchor, { color: record.color, comment: record.comment }, {
      onPickColor: (color) => void this.updateRecord(id, { color }),
      onSaveComment: (comment) => {
        const next = comment === '' ? null : comment;
        if ((pageRecords.get(id)?.comment ?? null) === next) return;
        void this.updateRecord(id, { comment: next });
      },
      onDelete: (rect) => void this.deleteWithUndo(id, rect),
    });
  }

  /** Writes a patch through the service worker and repaints from the returned record (no optimism). */
  private async updateRecord(id: string, patch: { color?: ColorName; comment?: string | null }): Promise<void> {
    const result = await client.send('highlight/update', { id, patch });
    if (!result.ok) {
      console.error('[NoteIt] Failed to update highlight:', result.error.code);
      return;
    }
    // The highlight left this page while the write was in flight (navigation, reload, removal).
    if (!pageRecords.has(id)) return;
    pageRecords.set(result.data.id, result.data);
    this.renderer.restyle(result.data.id, { color: result.data.color, commented: Boolean(result.data.comment) });
    refreshHighlightPopover(result.data.id, result.data.color);
  }

  /**
   * Delete from the popover (FR7, Q57, Q60): the soft delete goes through the service worker, the
   * highlight leaves this page, and "deleted · undo" shows here for 5 seconds. Undo clears the soft
   * delete; page/sync brings the highlight back in every tab and the side panel.
   */
  private async deleteWithUndo(id: string, at: OverlayRect): Promise<void> {
    const result = await client.send('highlight/delete', { id });
    if (!result.ok) {
      console.error('[NoteIt] Failed to delete highlight:', result.error.code);
      return;
    }
    this.renderer.remove(id);
    pageRecords.delete(id);
    showUndoToast(at, () => {
      void client.send('highlight/restore', { id }).then((restored) => {
        if (!restored.ok) console.error('[NoteIt] Failed to restore highlight:', restored.error.code);
      });
    });
  }

  /** Closes the popover and the undo toast (site switched off, signed out, data wiped). */
  public hideOverlays() {
    hideHighlightPopover();
    hideUndoToast();
  }

  /** True for events that come from NoteIt's own overlays in the Shadow host. */
  private isFromOverlay(e: Event): boolean {
    return e.composedPath().some((node) => node instanceof Element && node.localName === HOST_TAG);
  }

  private handleMouseOver(e: MouseEvent) {
    // No preview while the extension is disabled or signed out (login gate, FR27)
    if (!isExtensionEnabled() || !isSignedIn()) {
      hideCommentPreview();
      return;
    }
    const id = this.renderer.hitTest(e.clientX, e.clientY);
    if (!id) return;
    // The preview content comes from the stored record, never from the DOM.
    const comment = pageRecords.get(id)?.comment;
    if (!comment) {
      hideCommentPreview();
      return;
    }
    const rect = this.renderer.boundingRect(id);
    if (rect) showCommentPreview(id, rect, comment);
  }

  private moveFrame: number | null = null;
  private lastMove: MouseEvent | null = null;

  private handleMouseMove(e: MouseEvent) {
    this.lastMove = e;
    if (this.moveFrame !== null) return;
    this.moveFrame = requestAnimationFrame(() => {
      this.moveFrame = null;
      const move = this.lastMove;
      if (!move || this.isFromOverlay(move)) return;
      const key = openCommentPreviewKey();
      const id = this.renderer.hitTest(move.clientX, move.clientY);
      if (id === key) return;
      if (key !== null) hideCommentPreview();
      if (id !== null) this.handleMouseOver(move);
    });
  }

  private handleMouseOut(e: MouseEvent) {
    const key = openCommentPreviewKey();
    if (key === null) return;
    // Moving between marks of the same highlight keeps the preview.
    if (e.relatedTarget instanceof Node && this.renderer.hitTest(e.clientX, e.clientY) === key) return;
    hideCommentPreview();
  }

  private async handleMouseUp(e: MouseEvent) {
    // Don't show menu if extension is disabled or signed out (login gate, FR27)
    if (!isExtensionEnabled() || !isSignedIn()) {
      return;
    }
    
    // Don't show menu if it was just closed
    if (this.justClosedMenu) {
      return;
    }

    // A click inside a menu (dot, comment button, editor) must not reopen the selection menu.
    if (this.isFromOverlay(e)) return;
    
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      return;
    }

    console.log('[NoteIt] Text selected:', text.substring(0, 50));

    // Clone the range and trim whitespace
    const range = selection.getRangeAt(0).cloneRange();
    
    // Trim leading whitespace
    while (range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset < range.startContainer.textContent!.length) {
      const char = range.startContainer.textContent![range.startOffset];
      if (!/\s/.test(char)) break;
      range.setStart(range.startContainer, range.startOffset + 1);
    }
    
    // Trim trailing whitespace
    while (range.endContainer.nodeType === Node.TEXT_NODE && range.endOffset > 0) {
      const char = range.endContainer.textContent![range.endOffset - 1];
      if (!/\s/.test(char)) break;
      range.setEnd(range.endContainer, range.endOffset - 1);
    }
    
    this.currentSelectionRange = range;
    
    // Check if selection contains existing highlight
    const existingHighlight = this.getExistingHighlightInSelection(selection);
    if (existingHighlight) {
      // Editing an existing highlight happens in the sidebar (and in the click popover, Story 3.15).
      return;
    }
    
    const rect = this.currentSelectionRange.getBoundingClientRect();
    // Story 3.13: Preact floating menu in the Shadow host, placed by placeOverlay (Q65).
    showFloatingMenu(
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      {
        onPick: (color, comment) => void this.handleColorSelect(color, comment ?? undefined),
        // Only an explicit Esc blocks the next mouseup; an outside click or a replacement menu must
        // not swallow the selection that follows it.
        onDismiss: (reason) => {
          if (reason === 'explicit') this.onMenuClose();
        },
      },
    );
  }

  /** True when the selection starts and ends inside one painted highlight. */
  private getExistingHighlightInSelection(selection: Selection): boolean {
    const range = selection.getRangeAt(0);
    const at = (rect: DOMRect | undefined) => (rect ? this.renderer.hitTest(rect.left + 1, rect.top + rect.height / 2) : null);
    const rects = range.getClientRects();
    const first = at(rects[0]);
    return first !== null && first === at(rects[rects.length - 1]);
  }

  /**
   * Creates a highlight of `color` from the current selection (shortcut / context menu).
   * Resolves to null when nothing is selected; otherwise to the create Result.
   */
  public async triggerHighlight(color: ColorName = 'yellow'): Promise<Result<HighlightRecord> | null> {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = selection.toString().trim();
    if (!text) return null;

    this.currentSelectionRange = selection.getRangeAt(0).cloneRange();
    hideFloatingMenu();
    return this.handleColorSelect(color);
  }

  private async handleColorSelect(color: ColorName, comment?: string): Promise<Result<HighlightRecord> | null> {
    const range = this.currentSelectionRange;
    if (!range) return null;

    const url = window.location.href;
    // Creation and restoration share one TextIndex baseline (architecture.md D7). describeSelection
    // returns null for a blank selection; record.text is the indexed text, never Range.toString()
    // (which would include script / style / textarea text the TextIndex excludes).
    const index = createTextIndex();
    const anchor = describeSelection(index, range);
    if (!anchor) return null;
    const text = anchor.exact;
    const paintRange = index.offsetsToRange(anchor.start, anchor.end);
    const req: CreateHighlightReq = {
      id: generateId(),
      url,
      text,
      color,
      comment: comment || null,
      anchor,
      pageTitle: document.title || new URL(url).hostname,
      // FR9 / #15: only the URL string from the page's <link>; the extension never fetches it.
      favicon: this.faviconUrl(),
    };
    const errorRect = range.getBoundingClientRect();

    // Clear selection
    window.getSelection()?.removeAllRanges();
    this.currentSelectionRange = null;

    // 1. Optimistic paint (architecture.md "Process Patterns": create path only).
    if (paintRange) this.renderer.paint(req.id, paintRange, { color, commented: Boolean(req.comment) });

    // 2. Persist through the service worker; roll the paint back on failure.
    const result = await client.send('highlight/create', req);
    if (!result.ok) {
      console.error('[NoteIt] Failed to save highlight:', result.error.code);
      this.renderer.remove(req.id);
      this.showError(errorRect, result.error.code);
      return result;
    }
    pageRecords.set(result.data.id, result.data);
    return result;
  }

  private faviconUrl(): string | null {
    const link = document.querySelector<HTMLLinkElement>('link[rel*="icon"]');
    return link?.href ? link.href : null;
  }

  /** One line of error text at the given position; removed after a few seconds. */
  private showError(rect: DOMRect, code: ErrorCode) {
    document.getElementById(ERROR_LINE_ID)?.remove();
    const line = document.createElement('div');
    line.id = ERROR_LINE_ID;
    line.setAttribute('role', 'alert');
    line.textContent = errorText(code);
    line.style.cssText = `
      position: fixed;
      left: ${Math.max(8, rect.left)}px;
      top: ${Math.max(8, rect.top - 36)}px;
      max-width: 360px;
      padding: 6px 10px;
      background: rgba(255, 255, 255, 0.98);
      color: #b42318;
      border: 1px solid rgba(0, 0, 0, 0.1);
      border-radius: 6px;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
      z-index: 2147483647;
    `;
    document.body.appendChild(line);
    setTimeout(() => line.remove(), ERROR_LINE_MS);
  }
}
