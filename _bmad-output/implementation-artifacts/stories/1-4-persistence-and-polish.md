---
story_key: 1-4-persistence-and-polish
status: ready-for-dev
sprint: 1
feature: Persistence and Polish
---

# Story: Persistence and Polish

## Context
Ensure highlights persist across page reloads by restoring them from storage. Add browser integration features (Context Menu, Shortcuts) for better usability.

## Acceptance Criteria
- [x] Highlights are automatically restored when the page loads
- [x] Only highlights for the current URL are restored
- [x] Context Menu "Highlight Selection" triggers a highlight
- [x] Keyboard Shortcut (`Ctrl+Shift+H` / `Command+Shift+H`) triggers a highlight
- [x] `HighlightManager` handles batch loading of highlights

## Tasks

### 1. Persistence Logic
- [x] Update `HighlightManager` to add `loadAll(highlights: IHighlight[])`
- [x] Update `src/content/index.ts` to:
    - [x] Get current URL
    - [x] Fetch highlights from `chrome.storage.local`
    - [x] Filter by URL
    - [x] Call `highlightManager.loadAll()`

### 2. Background Features (Context Menu & Shortcuts)
- [x] Update `manifest.json` to define `commands` (`_execute_action` or custom)
- [x] Update `src/background/index.ts`:
    - [x] Create Context Menu on install (`chrome.contextMenus.create`)
    - [x] Listen for `chrome.contextMenus.onClicked`
    - [x] Listen for `chrome.commands.onCommand`
    - [x] Send `TRIGGER_HIGHLIGHT` message to active tab

### 3. Content Script Handling
- [x] Update `SelectionManager` (or `index.ts`) to listen for `TRIGGER_HIGHLIGHT`
- [x] Implement logic to highlight current selection when triggered via background (simulating the manual selection flow but skipping the menu if desired, or showing menu. Let's auto-highlight for shortcuts/context menu for speed).

## Dev Agent Record
### Debug Log
- [x] Initial creation
- [x] Implemented `loadAll` in `HighlightManager`.
- [x] Implemented `triggerHighlight` in `SelectionManager`.


### Completion Notes
- [ ] None
