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
      }
      .noteit-highlight:hover {
        opacity: 0.8 !important;
      }
      .noteit-with-comment {
        border-bottom: 2px solid #666 !important;
        padding-bottom: 3px !important;
      }
    `;
    document.head.appendChild(style);
  }

  public loadAll(highlights: IHighlight[]) {
    // Optional: Clear existing specific highlights or just rely on idempotency if we had it.
    // For now, to prevent double wrapping if called repeatedly, we should probably unmark all first
    // provided we are doing a full refresh.
    this.markInstance.unmark({
      className: 'noteit-highlight',
      done: () => {
        highlights.forEach((h) => {
          this.highlight(h);
        });
      }
    });
  }

  public highlight(highlight: IHighlight) {
    const { text, id, color, start, length, comment } = highlight;

    if (start !== undefined && length !== undefined) {
      this.markInstance.markRanges([{ start, length }], {
        className: `noteit-highlight-${id}`,
        each: (element: Element) => {
          const el = element as HTMLElement;
          el.style.backgroundColor = color;
          el.dataset.highlightId = id;
          el.classList.add('noteit-highlight');
          if (comment) {
            el.classList.add('noteit-with-comment');
          }
        },
      });
    } else {
      this.markInstance.mark(text, {
        className: `noteit-highlight-${id}`,
        each: (element: Element) => {
          const el = element as HTMLElement;
          el.style.setProperty('background-color', color, 'important');
          el.dataset.highlightId = id;
          el.classList.add('noteit-highlight');
          if (comment) {
            el.classList.add('noteit-with-comment');
          }
        },
        separateWordSearch: false,
        accuracy: 'partially',
        acrossElements: true,
        iframes: true,
      });
    }
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
