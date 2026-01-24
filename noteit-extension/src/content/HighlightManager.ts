import Mark from 'mark.js';
import type { IHighlight } from '../shared/types';

export class HighlightManager {
  private markInstance: Mark;

  constructor() {
    this.markInstance = new Mark(document.body);
    this.injectStyles();
  }

  private injectStyles() {
    // Inject CSS for comment highlights
    const styleId = 'noteit-highlight-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .noteit-highlight {
        cursor: pointer;
        padding: 2px 4px !important;
        border-radius: 3px !important;
        transition: opacity 0.2s ease !important;
        box-decoration-break: clone !important;
        -webkit-box-decoration-break: clone !important;
        position: relative;
      }
      .noteit-highlight:hover {
        opacity: 0.8 !important;
      }
      .noteit-with-comment {
        text-decoration: underline !important;
        text-decoration-style: dashed !important;
        text-decoration-color: #000 !important;
        text-decoration-thickness: 2px !important;
        text-underline-offset: 4px !important;
      }
      .noteit-comment-tooltip {
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%) translateY(-8px);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 13px;
        line-height: 1.4;
        max-width: 300px;
        word-wrap: break-word;
        white-space: pre-wrap;
        z-index: 2147483647;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s ease;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }
      .noteit-comment-tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        transform: translateX(-50%);
        border: 6px solid transparent;
        border-top-color: rgba(0, 0, 0, 0.9);
      }
      .noteit-highlight:hover .noteit-comment-tooltip {
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  public loadAll(highlights: IHighlight[]) {
    console.log(`[NoteIt] HighlightManager.loadAll called with ${highlights.length} highlights`);
    
    // First, manually remove all existing highlight elements to ensure clean state
    const existingHighlights = document.querySelectorAll('.noteit-highlight');
    console.log(`[NoteIt] Removing ${existingHighlights.length} existing highlight elements`);
    existingHighlights.forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        // Move all child nodes out of the highlight span
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
        // Remove the empty highlight span
        parent.removeChild(el);
      }
    });
    
    // Normalize text nodes to merge adjacent text nodes
    document.body.normalize();
    
    // Then use mark.js unmark to ensure clean state
    this.markInstance.unmark({
      className: 'noteit-highlight',
      done: () => {
        console.log('[NoteIt] Mark.js unmark completed, applying new highlights');
        // Small delay to ensure DOM is stable
        setTimeout(() => {
          highlights.forEach((h) => {
            this.highlight(h);
          });
        }, 50);
      }
    });
  }

  public highlight(highlight: IHighlight) {
    const { text, id, color, start, length, comment } = highlight;
    console.log(`[NoteIt] Attempting to highlight:`, { id, text: text.substring(0, 50), start, length });

    let matchCount = 0;

    // Prioritize range-based highlighting for precision (only highlights the exact selected instance)
    if (start != null && length != null && typeof start === 'number' && typeof length === 'number') {
      console.log(`[NoteIt] Using range-based highlighting for precise positioning`);
      this.markInstance.markRanges([{ start, length }], {
        className: `noteit-highlight-${id}`,
        each: (element: Element) => {
          matchCount++;
          const el = element as HTMLElement;
          el.style.setProperty('background-color', color, 'important');
          el.dataset.highlightId = id;
          el.classList.add('noteit-highlight');
          if (comment) {
            el.classList.add('noteit-with-comment');
            this.attachCommentTooltip(el, comment);
          }
        },
        done: () => {
          console.log(`[NoteIt] Range-based highlight completed for ${id}, matches: ${matchCount}`);
          if (matchCount === 0) {
            console.warn(`[NoteIt] Range-based highlighting failed for ${id}, falling back to text matching`);
            // Fallback to text-based if range fails (e.g., DOM changed)
            this.highlightByText(text, id, color, comment);
          }
        },
      });
    } else {
      console.log(`[NoteIt] No position data available, using text-based matching (may highlight duplicates)`);
      this.highlightByText(text, id, color, comment);
    }
  }

  /**
   * Highlight text using text matching (may match multiple instances)
   * This is used as a fallback when position data is not available
   */
  private highlightByText(text: string, id: string, color: string, comment?: string) {
    let matchCount = 0;
    this.markInstance.mark(text, {
      className: `noteit-highlight-${id}`,
      each: (element: Element) => {
        matchCount++;
        const el = element as HTMLElement;
        el.style.setProperty('background-color', color, 'important');
        el.dataset.highlightId = id;
        el.classList.add('noteit-highlight');
        if (comment) {
          el.classList.add('noteit-with-comment');
          this.attachCommentTooltip(el, comment);
        }
      },
      separateWordSearch: false,
      accuracy: 'partially',
      acrossElements: true,
      iframes: true,
      caseSensitive: false,
      ignoreJoiners: true,
      done: (markedCount: number) => {
        console.log(`[NoteIt] Text-based highlight completed for ${id}, matches: ${markedCount}`);
        if (markedCount === 0) {
          console.warn(`[NoteIt] Failed to find text for highlight ${id}:`, text.substring(0, 100));
        }
      },
      noMatch: () => {
        console.error(`[NoteIt] No match found for highlight ${id}:`, text.substring(0, 100));
      },
    });
  }

  private attachCommentTooltip(element: HTMLElement, comment: string) {
    // Only attach tooltip to the first element with this highlight (avoid duplicates)
    if (element.querySelector('.noteit-comment-tooltip')) {
      return;
    }
    
    const tooltip = document.createElement('div');
    tooltip.className = 'noteit-comment-tooltip';
    tooltip.textContent = comment;
    element.appendChild(tooltip);
  }

  public remove(id: string) {
    // This is a bit tricky with mark.js as unmark usually takes the text.
    // But we can find the elements by class or data attribute and unwrap them.
    // mark.js doesn't have a direct "unmark by id" unless we use ranges.
    // For MVP, let's try to find the elements and unwrap them manually or use unmark with the text if we had it.
    // Actually, we can use the 'unmark' method with options.
    
    const elements = document.querySelectorAll(`[data-highlight-id="${id}"]`);
    elements.forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        parent.normalize(); // Merge text nodes
      }
    });
  }
}
