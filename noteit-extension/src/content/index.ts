console.log('[NoteIt] Content Script Loaded');

import { HighlightManager } from './HighlightManager';
import { SelectionManager } from './SelectionManager';

import type { IHighlight } from '../shared/types';

// Initialize Managers
const highlightManager = new HighlightManager();
const selectionManager = new SelectionManager(highlightManager);

// Flag to prevent observer from triggering during our own operations
let isLoadingHighlights = false;

// Extension enabled state for current site
let isExtensionEnabled = false;

// Export getter for extension state (for SelectionManager)
export const getExtensionEnabled = () => isExtensionEnabled;

// Create status indicator UI
const createStatusIndicator = () => {
  const indicator = document.createElement('div');
  indicator.id = 'noteit-status-indicator';
  indicator.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    padding: 8px 16px;
    background: rgba(0, 0, 0, 0.8);
    color: white;
    border-radius: 20px;
    font-size: 12px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    z-index: 999999;
    cursor: pointer;
    transition: opacity 0.3s, transform 0.3s;
    opacity: 0;
    transform: translateY(-10px);
    pointer-events: none;
  `;
  
  indicator.addEventListener('click', () => {
    const currentUrl = window.location.href;
    if (isExtensionEnabled) {
      disableExtension(currentUrl);
    } else {
      enableExtension(currentUrl);
    }
  });
  
  document.body.appendChild(indicator);
  return indicator;
};

// Update status indicator
const updateStatusIndicator = (enabled: boolean) => {
  let indicator = document.getElementById('noteit-status-indicator') as HTMLElement;
  if (!indicator) {
    indicator = createStatusIndicator();
  }
  
  indicator.textContent = enabled ? '✓ NoteIt Enabled' : '✗ NoteIt Disabled';
  indicator.style.background = enabled ? 'rgba(34, 197, 94, 0.9)' : 'rgba(239, 68, 68, 0.9)';
  indicator.style.opacity = '1';
  indicator.style.transform = 'translateY(0)';
  indicator.style.pointerEvents = 'auto';
  
  // Hide after 3 seconds
  setTimeout(() => {
    indicator.style.opacity = '0';
    indicator.style.transform = 'translateY(-10px)';
    setTimeout(() => {
      indicator.style.pointerEvents = 'none';
    }, 300);
  }, 3000);
};

// Check if current site has any highlights
const checkIfSiteHasHighlights = async (url: string): Promise<boolean> => {
  try {
    const result = await chrome.storage.local.get('highlights');
    const allHighlights = (result.highlights as IHighlight[]) || [];
    return allHighlights.some(h => h.url === url);
  } catch (error) {
    console.error('[NoteIt] Failed to check highlights:', error);
    return false;
  }
};

// Check if extension is enabled for current site
const checkExtensionEnabled = async (url: string): Promise<boolean> => {
  try {
    const result = await chrome.storage.local.get('enabledSites');
    const enabledSites = (result.enabledSites as string[]) || [];
    return enabledSites.includes(url);
  } catch (error) {
    console.error('[NoteIt] Failed to check enabled sites:', error);
    return false;
  }
};

// Enable extension for current site
const enableExtension = async (url: string) => {
  try {
    const result = await chrome.storage.local.get('enabledSites');
    const enabledSites = (result.enabledSites as string[]) || [];
    if (!enabledSites.includes(url)) {
      enabledSites.push(url);
      await chrome.storage.local.set({ enabledSites });
    }
    isExtensionEnabled = true;
    console.log('[NoteIt] Extension enabled for:', url);
    updateStatusIndicator(true);
    await loadHighlights();
  } catch (error) {
    console.error('[NoteIt] Failed to enable extension:', error);
  }
};

// Disable extension for current site
const disableExtension = async (url: string) => {
  try {
    const result = await chrome.storage.local.get('enabledSites');
    const enabledSites = (result.enabledSites as string[]) || [];
    const index = enabledSites.indexOf(url);
    if (index > -1) {
      enabledSites.splice(index, 1);
      await chrome.storage.local.set({ enabledSites });
    }
    isExtensionEnabled = false;
    console.log('[NoteIt] Extension disabled for:', url);
    updateStatusIndicator(false);
    // Clear all highlights from the page
    highlightManager.clearAll();
  } catch (error) {
    console.error('[NoteIt] Failed to disable extension:', error);
  }
};

// Load saved highlights
const loadHighlights = async () => {
  if (isLoadingHighlights) {
    console.log('[NoteIt] loadHighlights already in progress, skipping...');
    return;
  }
  
  // Only load highlights if extension is enabled for this site
  if (!isExtensionEnabled) {
    console.log('[NoteIt] Extension disabled for this site, skipping highlight load');
    return;
  }
  
  isLoadingHighlights = true;
  try {
    const result = await chrome.storage.local.get('highlights');
    const allHighlights = (result.highlights as IHighlight[]) || [];
    const currentUrl = window.location.href;
    
    console.log(`[NoteIt] loadHighlights called, total highlights: ${allHighlights.length}, currentUrl: ${currentUrl}`);
    
    // Simple URL matching (ignoring hash/query if needed, but strict for now)
    const pageHighlights = allHighlights.filter((h) => h.url === currentUrl);
    
    console.log(`[NoteIt] Found ${pageHighlights.length} highlights for current page`);
    if (pageHighlights.length > 0) {
      console.log('[NoteIt] Highlight details:', pageHighlights.map(h => ({ id: h.id, text: h.text.substring(0, 30), url: h.url })));
      highlightManager.loadAll(pageHighlights);
    }
  } catch (error) {
    console.error('[NoteIt] Failed to load highlights:', error);
  } finally {
    // Reset flag after a small delay to ensure all DOM operations complete
    setTimeout(() => {
      isLoadingHighlights = false;
    }, 100);
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
  // Skip if we're currently loading highlights
  if (isLoadingHighlights) {
    return;
  }

  // Skip if we're creating a new highlight
  if ((window as any).__noteit_creating_highlight__) {
    console.log('[NoteIt] Skip reload - creating new highlight');
    return;
  }

  // Filter out mutations that are purely our own highlight changes
  const isOurMutation = mutations.every(mutation => {
    // Check added nodes
    const addedAreOurs = Array.from(mutation.addedNodes).every(node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return true;
      const el = node as HTMLElement;
      // Filter out our highlight spans and floating menu
      return el.classList.contains('noteit-highlight') || 
             el.hasAttribute('data-noteit-menu') ||
             el.getAttribute('id')?.startsWith('noteit-') ||
             false;
    });

    // Check removed nodes (when unmarking)
    // When mark.js unmarks, it unwraps, so it removes the span and adds text.
    // The removed node will be our span.
    const removedAreOurs = Array.from(mutation.removedNodes).every(node => {
      if (node.nodeType !== Node.ELEMENT_NODE) return true;
      const el = node as HTMLElement;
      return el.classList.contains('noteit-highlight') ||
             el.hasAttribute('data-noteit-menu') ||
             el.getAttribute('id')?.startsWith('noteit-') ||
             false;
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
  document.addEventListener('DOMContentLoaded', async () => {
    const currentUrl = window.location.href;
    
    // Check if site has highlights or is manually enabled
    const hasHighlights = await checkIfSiteHasHighlights(currentUrl);
    const manuallyEnabled = await checkExtensionEnabled(currentUrl);
    
    if (hasHighlights || manuallyEnabled) {
      console.log('[NoteIt] Auto-enabling extension (hasHighlights:', hasHighlights, ', manuallyEnabled:', manuallyEnabled, ')');
      await enableExtension(currentUrl);
    } else {
      console.log('[NoteIt] Extension disabled by default for this site');
    }
    
    observer.observe(document.body, observeOptions);
  });
} else {
  (async () => {
    const currentUrl = window.location.href;
    
    // Check if site has highlights or is manually enabled
    const hasHighlights = await checkIfSiteHasHighlights(currentUrl);
    const manuallyEnabled = await checkExtensionEnabled(currentUrl);
    
    if (hasHighlights || manuallyEnabled) {
      console.log('[NoteIt] Auto-enabling extension (hasHighlights:', hasHighlights, ', manuallyEnabled:', manuallyEnabled, ')');
      await enableExtension(currentUrl);
    } else {
      console.log('[NoteIt] Extension disabled by default for this site');
    }
    
    observer.observe(document.body, observeOptions);
  })();
}

// Listen for messages from Side Panel & Background
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === 'DELETE_HIGHLIGHT' && message.id) {
    console.log('[NoteIt] Received DELETE_HIGHLIGHT:', message.id);
    highlightManager.remove(message.id);
  }
  if (message.action === 'TRIGGER_HIGHLIGHT') {
    console.log('[NoteIt] Received TRIGGER_HIGHLIGHT');
    // Auto-enable extension when user creates a highlight
    const currentUrl = window.location.href;
    enableExtension(currentUrl).then(() => {
      selectionManager.triggerHighlight();
    });
  }
  if (message.action === 'TOGGLE_EXTENSION') {
    console.log('[NoteIt] Received TOGGLE_EXTENSION');
    const currentUrl = window.location.href;
    if (isExtensionEnabled) {
      disableExtension(currentUrl);
    } else {
      enableExtension(currentUrl);
    }
  }
  if (message.action === 'GET_EXTENSION_STATE') {
    console.log('[NoteIt] Received GET_EXTENSION_STATE, current state:', isExtensionEnabled);
    // Send back the current state synchronously
    sendResponse({ enabled: isExtensionEnabled });
    return true; // Required to keep the message channel open for async response
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

// Listen for reload event from SelectionManager
document.addEventListener('noteit-reload-highlights', () => {
  console.log('[NoteIt] Received reload highlights event');
  loadHighlights();
});

console.log('[NoteIt] Managers Initialized');
