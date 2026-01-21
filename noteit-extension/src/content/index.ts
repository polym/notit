console.log('[NoteIt] Content Script Loaded');

import { HighlightManager } from './HighlightManager';
import { SelectionManager } from './SelectionManager';

import type { IHighlight } from '../shared/types';

// Initialize Managers
const highlightManager = new HighlightManager();
const selectionManager = new SelectionManager(highlightManager);

// Load saved highlights
const loadHighlights = async () => {
  try {
    const result = await chrome.storage.local.get('highlights');
    const allHighlights = (result.highlights as IHighlight[]) || [];
    const currentUrl = window.location.href;
    
    // Simple URL matching (ignoring hash/query if needed, but strict for now)
    const pageHighlights = allHighlights.filter((h) => h.url === currentUrl);
    
    if (pageHighlights.length > 0) {
      console.log(`[NoteIt] Restoring ${pageHighlights.length} highlights`);
      highlightManager.loadAll(pageHighlights);
    }
  } catch (error) {
    console.error('[NoteIt] Failed to load highlights:', error);
  }
};

// Debounce helper
function debounce(func: Function, wait: number) {
  let timeout: any;
  return function executedFunction(...args: any[]) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Observe DOM changes for SPA support
const observeOptions = {
  childList: true,
  subtree: true
};

const debouncedLoad = debounce(() => {
  loadHighlights();
}, 500);

const observer = new MutationObserver((mutations) => {
  // Filter out mutations that are purely our own highlight changes
  const isOurMutation = mutations.every(mutation => {
    // Check added nodes
    const addedAreOurs = Array.from(mutation.addedNodes).every(node => {
      // If it is an element element and has our class, it's ours.
      return node.nodeType === Node.ELEMENT_NODE && 
             (node as HTMLElement).classList.contains('noteit-highlight');
    });

    // Check removed nodes (when unmarking)
    // When mark.js unmarks, it unwraps, so it removes the span and adds text.
    // The removed node will be our span.
    const removedAreOurs = Array.from(mutation.removedNodes).every(node => {
        return node.nodeType === Node.ELEMENT_NODE && 
               (node as HTMLElement).classList.contains('noteit-highlight');
    });
    
    // If we are modifying textNodes inside our spans... messy.
    // Simple heuristic: If we see ANY 'noteit-highlight' class involved, we assume it's us?
    // No, that might miss valid changes happening alongside.
    
    // Better: If the ONLY added nodes are ours.
    if (mutation.addedNodes.length > 0 && !addedAreOurs) return false;
    if (mutation.removedNodes.length > 0 && !removedAreOurs) return false;
    
    return true; 
  });

  if (!isOurMutation) {
    // Only trigger if significant nodes added (and they aren't ours)
    const hasAddedNodes = mutations.some(m => m.addedNodes.length > 0);
    if (hasAddedNodes) {
      debouncedLoad();
    }
  }
});

// Wait for DOM to be ready before loading highlights
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    loadHighlights();
    observer.observe(document.body, observeOptions);
  });
} else {
  loadHighlights();
  observer.observe(document.body, observeOptions);
}

// Listen for messages from Side Panel & Background
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'DELETE_HIGHLIGHT' && message.id) {
    console.log('[NoteIt] Received DELETE_HIGHLIGHT:', message.id);
    highlightManager.remove(message.id);
  }
  if (message.action === 'TRIGGER_HIGHLIGHT') {
    console.log('[NoteIt] Received TRIGGER_HIGHLIGHT');
    selectionManager.triggerHighlight();
  }
  if (message.action === 'SCROLL_TO_HIGHLIGHT' && message.id) {
    console.log('[NoteIt] Received SCROLL_TO_HIGHLIGHT:', message.id);
    
    const scrollToElement = () => {
        const element = document.querySelector(`[data-highlight-id="${message.id}"]`) as HTMLElement;
        if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        // Flash the highlight to make it more visible
        element.style.transition = 'opacity 0.3s';
        element.style.opacity = '0.3';
        setTimeout(() => {
            element.style.opacity = '1';
        }, 300);
        console.log('[NoteIt] Scrolled to highlight:', message.id);
        return true;
        }
        return false;
    };

    if (!scrollToElement()) {
        console.warn('[NoteIt] Highlight element not found initially, retrying load...');
        // Force a re-load and try again after a short delay
        loadHighlights().then(() => {
            setTimeout(() => {
                if (!scrollToElement()) {
                     console.error('[NoteIt] Failed to scroll to highlight after retry:', message.id);
                }
            }, 500);
        });
    }
  }
});

console.log('[NoteIt] Managers Initialized');
