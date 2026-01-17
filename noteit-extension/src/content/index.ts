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

loadHighlights();

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
    const element = document.querySelector(`[data-highlight-id="${message.id}"]`) as HTMLElement;
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      console.warn('[NoteIt] Highlight element not found for id:', message.id);
    }
  }
});

console.log('[NoteIt] Managers Initialized');
