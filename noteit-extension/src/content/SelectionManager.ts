import { v4 as uuidv4 } from 'uuid';
import { HighlightManager } from './HighlightManager';
import { FloatingMenu } from './FloatingMenu';
import type { IHighlight } from '../shared/types';
import { getExtensionEnabled } from './index';

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
    // Add hover listener for existing highlights
    document.addEventListener('mouseover', this.handleMouseOver.bind(this));
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

  private handleMouseOver(e: MouseEvent) {
    // Don't show edit menu if extension is disabled
    if (!getExtensionEnabled()) {
      return;
    }
    
    const target = e.target as HTMLElement;
    
    // Check if hovering over a highlight
    if (target.classList && target.classList.contains('noteit-highlight')) {
      const rect = target.getBoundingClientRect();
      const x = rect.left;
      const y = rect.top - 40; // 40px above, using viewport coordinates
      
      this.floatingMenu.showEditMode(x, y, target, this.updateHighlight.bind(this));
    }
  }

  private async handleMouseUp() {
    // Don't show menu if extension is disabled
    if (!getExtensionEnabled()) {
      return;
    }
    
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
      console.log('[NoteIt] Existing highlight detected, edit menu already shown on hover');
      // Edit menu is already shown on hover, do nothing
      return;
    }
    
    const rect = this.currentSelectionRange.getBoundingClientRect();
    
    // Show menu above the selection, using viewport coordinates
    const x = rect.left;
    const y = rect.top - 40; // 40px above
    
    console.log('[NoteIt] Showing menu at:', x, y);
    this.floatingMenu.show(x, y);
  }

  private getExistingHighlightInSelection(selection: Selection): HTMLElement | null {
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    
    // Check if the selection itself or its parent is a highlight
    let element = container.nodeType === Node.ELEMENT_NODE 
      ? container as HTMLElement 
      : container.parentElement;
    
    while (element) {
      if (element.classList && element.classList.contains('noteit-highlight')) {
        return element;
      }
      // Don't traverse beyond body
      if (element === document.body) break;
      element = element.parentElement;
    }
    
    return null;
  }

  private async updateHighlight(highlightElement: HTMLElement, color: string, comment?: string) {
    const highlightId = highlightElement.dataset.highlightId;
    if (!highlightId) return;

    console.log('[NoteIt] Updating highlight:', highlightId);

    // Set flag to prevent observer from triggering during update
    (window as any).__noteit_creating_highlight__ = true;

    try {
      const result = await chrome.storage.local.get('highlights');
      const highlights = (result.highlights as IHighlight[]) || [];
      const index = highlights.findIndex(h => h.id === highlightId);
      
      if (index !== -1) {
        // Update the highlight data
        highlights[index] = {
          ...highlights[index],
          color,
          ...(comment !== undefined && { comment }),
        };
        
        await chrome.storage.local.set({ highlights });
        console.log('[NoteIt] Highlight updated in storage');
        
        // Update all elements with this highlight ID (there may be multiple spans for one highlight)
        const elements = document.querySelectorAll(`[data-highlight-id="${highlightId}"]`);
        console.log(`[NoteIt] Updating ${elements.length} elements with new color`);
        
        elements.forEach((el) => {
          const element = el as HTMLElement;
          // Update color
          element.style.setProperty('background-color', color, 'important');
          
          // Handle comment changes
          if (comment !== undefined) {
            if (comment) {
              // Add or update comment
              element.classList.add('noteit-with-comment');
              // Remove old tooltip if exists
              const oldTooltip = element.querySelector('.noteit-comment-tooltip');
              if (oldTooltip) {
                oldTooltip.remove();
              }
              // Add new tooltip
              const tooltip = document.createElement('div');
              tooltip.className = 'noteit-comment-tooltip';
              tooltip.textContent = comment;
              element.appendChild(tooltip);
            } else {
              // Remove comment
              element.classList.remove('noteit-with-comment');
              const tooltip = element.querySelector('.noteit-comment-tooltip');
              if (tooltip) {
                tooltip.remove();
              }
            }
          }
        });
      }
    } catch (error) {
      console.error('[NoteIt] Failed to update highlight:', error);
    } finally {
      // Reset flag after update completes
      setTimeout(() => {
        (window as any).__noteit_creating_highlight__ = false;
      }, 100);
    }
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

  private async handleColorSelect(color: string, comment?: string) {
    if (!this.currentSelectionRange) return;

    const text = this.currentSelectionRange.toString().trim();
    if (!text) return;
    
    const id = uuidv4();
    const url = window.location.href;
    const timestamp = Date.now();

    // Get page metadata
    const pageTitle = document.title || new URL(url).hostname;
    
    // Get favicon
    let favicon = '';
    const linkElements = document.querySelectorAll('link[rel*="icon"]');
    if (linkElements.length > 0) {
      const iconLink = linkElements[0] as HTMLLinkElement;
      favicon = iconLink.href;
    } else {
      // Fallback to default favicon location
      const urlObj = new URL(url);
      favicon = `${urlObj.origin}/favicon.ico`;
    }

    // Validate favicon accessibility
    favicon = await this.validateFavicon(favicon);

    // Calculate precise position to ensure only the selected instance is highlighted
    const start = this.getSelectionOffset(this.currentSelectionRange);
    const length = text.length;

    const highlight: IHighlight = {
      id,
      text,
      url,
      color,
      timestamp,
      pageTitle,
      favicon,
      start,
      length,
      ...(comment && { comment }), // Add comment if provided
    };

    console.log('[NoteIt] Creating highlight:', highlight);

    // Set loading flag to prevent observer from triggering reload
    (window as any).__noteit_creating_highlight__ = true;

    // 1. Visual Highlight
    this.highlightManager.highlight(highlight);

    // 2. Save to Storage
    await this.saveHighlight(highlight);

    // Reset flag after a delay
    setTimeout(() => {
      (window as any).__noteit_creating_highlight__ = false;
    }, 500);

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

  /**
   * Calculate the character offset of the range start position
   * relative to the document body text content
   */
  private getSelectionOffset(range: Range): number {
    const preRange = document.createRange();
    preRange.selectNodeContents(document.body);
    preRange.setEnd(range.startContainer, range.startOffset);
    const offset = preRange.toString().length;
    preRange.detach();
    return offset;
  }

  /**
   * Validate if a favicon URL is accessible
   * Uses Image object to test loading - this works reliably even with CORS restrictions
   * Returns the URL if accessible, empty string if not
   */
  private async validateFavicon(faviconUrl: string): Promise<string> {
    if (!faviconUrl) return '';
    
    return new Promise((resolve) => {
      const img = new Image();
      const timeout = setTimeout(() => {
        img.src = ''; // Cancel loading
        console.warn('[NoteIt] Favicon validation timeout:', faviconUrl);
        resolve(''); // Timeout = not accessible
      }, 3000); // 3 second timeout
      
      img.onload = () => {
        clearTimeout(timeout);
        console.log('[NoteIt] Favicon validated successfully:', faviconUrl);
        resolve(faviconUrl); // Successfully loaded
      };
      
      img.onerror = () => {
        clearTimeout(timeout);
        console.warn('[NoteIt] Favicon not accessible:', faviconUrl);
        resolve(''); // Failed to load
      };
      
      img.src = faviconUrl; // Start loading
    });
  }
}
