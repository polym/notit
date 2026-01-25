console.log('[NoteIt] Service Worker Loaded');

// Setup side panel behavior - keep the default behavior
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error: unknown) => console.error(error));

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


