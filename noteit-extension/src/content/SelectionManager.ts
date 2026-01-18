import { v4 as uuidv4 } from 'uuid';
import { HighlightManager } from './HighlightManager';
import { FloatingMenu } from './FloatingMenu';
import type { IHighlight } from '../shared/types';

export class SelectionManager {
  private highlightManager: HighlightManager;
  private floatingMenu: FloatingMenu;
  private currentSelectionRange: Range | null = null;

  constructor(highlightManager: HighlightManager) {
    this.highlightManager = highlightManager;
    this.floatingMenu = new FloatingMenu(this.handleColorSelect.bind(this));
    this.init();
  }

  private init() {
    document.addEventListener('mouseup', this.handleMouseUp.bind(this));
    // Use capture phase to handle clicks before they reach the menu
    document.addEventListener('mousedown', this.handleMouseDown.bind(this), true);
  }

  private handleMouseDown(e: MouseEvent) {
    // Check if click is inside the floating menu's host element
    const target = e.target as HTMLElement;
    const menuHost = document.querySelector('[data-noteit-menu]');
    
    if (menuHost && menuHost.contains(target)) {
      // Click is inside menu, don't hide
      return;
    }
    
    // Click outside menu, hide it
    this.floatingMenu.remove();
  }

  private async handleMouseUp() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      return;
    }

    console.log('[NoteIt] Text selected:', text.substring(0, 50));

    this.currentSelectionRange = selection.getRangeAt(0).cloneRange();
    const rect = this.currentSelectionRange.getBoundingClientRect();
    
    // Show menu above the selection
    const x = rect.left + window.scrollX;
    const y = rect.top + window.scrollY - 40; // 40px above
    
    console.log('[NoteIt] Showing menu at:', x, y);
    this.floatingMenu.show(x, y);
  }

  public async triggerHighlight() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }
    const text = selection.toString().trim();
    if (!text) return;

    this.currentSelectionRange = selection.getRangeAt(0).cloneRange();
    // Default color for shortcuts/context menu
    await this.handleColorSelect('#ffeb3b');
  }

  private getSelectionOffset(range: Range): number {
    let start = 0;
    const iterator = document.createNodeIterator(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (node.parentNode) {
            const parent = node.parentNode as HTMLElement;
            const tag = parent.tagName;
            // Match mark.js default exclusions
            if (['SCRIPT', 'STYLE', 'TITLE', 'HEAD', 'HTML', 'META', 'NOSCRIPT'].includes(tag)) {
              return NodeFilter.FILTER_REJECT;
            }
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let currentNode: Node | null;
    while ((currentNode = iterator.nextNode())) {
      if (currentNode === range.startContainer) {
        start += range.startOffset;
        break;
      }
      start += currentNode.textContent?.length || 0;
    }
    return start;
  }

  private async handleColorSelect(color: string, comment?: string) {
    if (!this.currentSelectionRange) return;

    const text = this.currentSelectionRange.toString();
    const id = uuidv4();
    const url = window.location.href;
    const timestamp = Date.now();

    const start = this.getSelectionOffset(this.currentSelectionRange);
    const length = text.length;

    const highlight: IHighlight = {
      id,
      text,
      url,
      color,
      timestamp,
      start,
      length,
      ...(comment && { comment }), // Add comment if provided
    };

    console.log('[NoteIt] Creating highlight:', highlight);

    // 1. Visual Highlight
    this.highlightManager.highlight(highlight);

    // 2. Save to Storage
    await this.saveHighlight(highlight);

    // Clear selection
    window.getSelection()?.removeAllRanges();
    this.currentSelectionRange = null;
  }

  private async saveHighlight(highlight: IHighlight) {
    try {
      const result = await chrome.storage.local.get('highlights');
      const highlights = (result.highlights as IHighlight[]) || [];
      highlights.push(highlight);
      await chrome.storage.local.set({ highlights });
      console.log('[NoteIt] Saved to storage:', highlights.length);
    } catch (error) {
      console.error('[NoteIt] Failed to save highlight:', error);
    }
  }
}
