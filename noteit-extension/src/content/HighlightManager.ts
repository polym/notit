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

    // Strategy 1: precise character-offset positioning (fastest, exact instance)
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
            console.warn(`[NoteIt] Range-based highlighting failed for ${id}, trying context-based anchoring`);
            // Strategy 2: context-based anchoring using prefix/suffix
            this.highlightByContext(highlight).then((success) => {
              if (!success) {
                console.warn(`[NoteIt] Context-based anchoring failed for ${id}, falling back to text matching`);
                // Strategy 3: fuzzy text search (may match multiple instances)
                this.highlightByText(text, id, color, comment);
              }
            });
          }
        },
      });
    } else {
      // No position data — try context first, then plain text
      console.log(`[NoteIt] No position data, trying context-based anchoring`);
      this.highlightByContext(highlight).then((success) => {
        if (!success) {
          console.log(`[NoteIt] No context data or no match, using text-based matching (may highlight duplicates)`);
          this.highlightByText(text, id, color, comment);
        }
      });
    }
  }

  /**
   * Strategy 2: context-based anchoring.
   *
   * Searches all occurrences of the highlight text in the page, then scores each
   * candidate by how closely the surrounding characters match the stored prefix/suffix.
   * The candidate with the highest score is re-anchored with markRanges so that
   * only one exact instance is highlighted — even when character offsets have shifted
   * due to dynamic content changes (ads, SPA navigation, lazy loading, etc.).
   *
   * Returns true if a highlight was successfully applied.
   */
  private async highlightByContext(highlight: IHighlight): Promise<boolean> {
    const { text, id, color, comment, context } = highlight;
    if (!context || (!context.prefix && !context.suffix)) return false;

    const { prefix, suffix } = context;

    // Use the same text representation that mark.js and Range.toString() use:
    // the concatenation of all text-node contents under document.body.
    const bodyText = document.body.textContent || '';
    const lowerBody = bodyText.toLowerCase();
    const lowerText = text.toLowerCase();

    // Find all candidate positions and score by context similarity
    const candidates: { pos: number; score: number }[] = [];
    let searchPos = 0;

    while (true) {
      const pos = lowerBody.indexOf(lowerText, searchPos);
      if (pos === -1) break;

      const actualPrefix = bodyText.slice(Math.max(0, pos - prefix.length), pos);
      const actualSuffix = bodyText.slice(pos + text.length, pos + text.length + suffix.length);

      const score =
        this.scorePrefixMatch(prefix, actualPrefix) +
        this.scoreSuffixMatch(suffix, actualSuffix);

      candidates.push({ pos, score });
      searchPos = pos + 1;
    }

    if (candidates.length === 0) return false;

    // Pick the best-matching candidate
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];

    // Require at least 25% combined match quality (out of max 2.0)
    if (best.score < 0.5) {
      console.warn(`[NoteIt] Context match quality too low (${best.score.toFixed(2)}) for ${id}`);
      return false;
    }

    console.log(
      `[NoteIt] Context-based anchoring for ${id}: best pos=${best.pos}, score=${best.score.toFixed(2)}, candidates=${candidates.length}`
    );

    return new Promise((resolve) => {
      let matched = false;
      this.markInstance.markRanges([{ start: best.pos, length: text.length }], {
        className: `noteit-highlight-${id}`,
        each: (element: Element) => {
          matched = true;
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
          console.log(`[NoteIt] Context-based highlight ${matched ? 'succeeded' : 'failed'} for ${id}`);
          resolve(matched);
        },
      });
    });
  }

  /**
   * Score how well the prefix (text before the selection) matches.
   * Compares characters outward from the selection boundary (right-aligned).
   * Returns a value in [0, 1].
   */
  private scorePrefixMatch(stored: string, actual: string): number {
    if (!stored) return 1;
    if (!actual) return 0;
    const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
    const a = norm(stored);
    const b = norm(actual);
    let matches = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[a.length - 1 - i] === b[b.length - 1 - i]) matches++;
    }
    return matches / Math.max(a.length, b.length, 1);
  }

  /**
   * Score how well the suffix (text after the selection) matches.
   * Compares characters outward from the selection boundary (left-aligned).
   * Returns a value in [0, 1].
   */
  private scoreSuffixMatch(stored: string, actual: string): number {
    if (!stored) return 1;
    if (!actual) return 0;
    const norm = (s: string) => s.replace(/\s+/g, ' ').toLowerCase();
    const a = norm(stored);
    const b = norm(actual);
    let matches = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      if (a[i] === b[i]) matches++;
    }
    return matches / Math.max(a.length, b.length, 1);
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

  public clearAll() {
    // Remove all highlights from the page
    const elements = document.querySelectorAll('.noteit-highlight');
    elements.forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(el.textContent || ''), el);
        parent.normalize();
      }
    });
    console.log('[NoteIt] Cleared all highlights from page');
  }
}
