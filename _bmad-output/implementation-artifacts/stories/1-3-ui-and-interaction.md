---
story_key: 1-3-ui-and-interaction
status: ready-for-dev
sprint: 1
feature: UI and Interaction
---

# Story: UI and Interaction

## Context
Implement the user interface components: a Floating Menu for immediate highlighting actions and a Side Panel for managing history. Establish two-way communication between the Side Panel and Content Script.

## Acceptance Criteria
- [x] `useHighlights` hook implemented in React, syncing with `chrome.storage.local`
- [x] Side Panel displays a list of saved highlights
- [x] Floating Menu (Shadow DOM) appears on text selection instead of auto-highlighting
- [x] Clicking a color in Floating Menu triggers highlight and save
- [x] Clicking "Delete" in Side Panel removes the highlight from the page and storage
- [x] Message passing implemented for "DELETE" action

## Tasks

### 1. Side Panel Logic
- [x] Create `src/sidepanel/hooks/useHighlights.ts`
- [x] Implement `useHighlights` to listen to `chrome.storage.onChanged`
- [x] Create `src/sidepanel/components/HighlightList.tsx`
- [x] Update `src/sidepanel/App.tsx` to use the list

### 2. Floating Menu (Shadow DOM)
- [x] Create `src/content/FloatingMenu.ts`
- [x] Implement Shadow DOM injection and cleanup
- [x] Add color buttons
- [x] Update `SelectionManager` to show menu instead of auto-saving

### 3. Message Passing & Deletion
- [x] Implement `DELETE_HIGHLIGHT` message handler in `src/content/index.ts`
- [x] Update `HighlightManager` to support removal by ID (using `mark.js` ranges or DOM manipulation)
- [x] Add delete button to `HighlightList` items that sends message to active tab
- [x] Ensure storage is updated upon deletion

## Dev Agent Record
### Debug Log
- [x] Initial creation
- [x] Fixed TypeScript errors: unused variables, type imports.


### Completion Notes
- [ ] None
