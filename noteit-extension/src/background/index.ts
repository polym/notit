console.log('[NoteIt] Service Worker Loaded');

import type { IHighlight } from '../shared/types';

// Setup side panel behavior - keep the default behavior
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: unknown) => console.error(error));

// Update badge with highlight count for current tab
const updateBadge = async (tabId: number, url: string) => {
  try {
    const result = await chrome.storage.local.get('highlights');
    const highlights = (result.highlights as IHighlight[]) || [];
    const count = highlights.filter(h => h.url === url).length;
    
    if (count > 0) {
      await chrome.action.setBadgeText({ 
        text: count.toString(), 
        tabId 
      });
      await chrome.action.setBadgeBackgroundColor({ 
        color: '#4caf50', 
        tabId 
      });
    } else {
      await chrome.action.setBadgeText({ text: '', tabId });
    }
  } catch (error) {
    console.error('[NoteIt] Failed to update badge:', error);
  }
};

// Listen for tab updates (navigation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    updateBadge(tabId, tab.url);
  }
});

// Listen for tab activation (switching tabs)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      updateBadge(activeInfo.tabId, tab.url);
    }
  } catch (error) {
    console.error('[NoteIt] Failed to update badge on tab activation:', error);
  }
});

// Listen for storage changes (highlights added/removed)
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName === 'local' && changes.highlights) {
    // Update badge for all tabs
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (tab.id && tab.url) {
          updateBadge(tab.id, tab.url);
        }
      }
    } catch (error) {
      console.error('[NoteIt] Failed to update badges after storage change:', error);
    }
  }
});

// Create Context Menu
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'noteit-highlight',
    title: 'Highlight Selection',
    contexts: ['selection'],
  });
  
  chrome.contextMenus.create({
    id: 'noteit-toggle',
    title: 'Toggle NoteIt for this site',
    contexts: ['page'],
  });
});

// Handle Context Menu Click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'noteit-highlight' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_HIGHLIGHT' });
  }
  if (info.menuItemId === 'noteit-toggle' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'TOGGLE_EXTENSION' });
  }
});

// Handle Keyboard Shortcuts
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'highlight-selection' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { action: 'TRIGGER_HIGHLIGHT' });
  }
});


