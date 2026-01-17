---
story_key: 1-2-core-highlighting-engine
status: ready-for-dev
sprint: 1
feature: Core Highlighting Engine
---

# Story: Core Highlighting Engine (MVP)

## Context
Implement the core functionality: detecting text selection, highlighting it using `mark.js`, and saving the data to `chrome.storage.local`. This is the MVP of the extension.

## Acceptance Criteria
- [x] `IHighlight` interface defined in `src/shared/types.ts`
- [x] `HighlightManager` implemented to wrap `mark.js` operations
- [x] `SelectionManager` implemented to detect user selection and trigger save
- [x] Selected text is visually highlighted on the page
- [x] Highlight data is saved to `chrome.storage.local`
- [x] Verification: Selecting text on a page results in a new entry in storage (visible in DevTools)

## Tasks

### 1. Shared Types
- [x] Create `src/shared/types.ts`
- [x] Define `IHighlight` interface (id, text, url, color, timestamp, xpath/context)
- [x] Define `IStorageSchema` interface

### 2. Highlight Manager
- [x] Create `src/content/HighlightManager.ts`
- [x] Implement `highlight(range: Range, id: string, color: string)` using `mark.js`
- [x] Implement `remove(id: string)`

### 3. Selection Manager
- [x] Create `src/content/SelectionManager.ts`
- [x] Implement `mouseup` listener to detect selection
- [x] Implement logic to create `IHighlight` object from selection
- [x] Call `HighlightManager` to render visual highlight
- [x] Save `IHighlight` to `chrome.storage.local`

### 4. Integration
- [x] Update `src/content/index.ts` to initialize Managers
- [x] Manual Test: Verify flow on a real web page

## Dev Agent Record
### Debug Log
- [x] Initial creation
- [x] Fixed TypeScript errors: `HTMLElement` casting, `import type`, unused variables.


### Completion Notes
- [ ] None
