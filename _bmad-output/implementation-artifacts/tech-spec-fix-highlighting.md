# Tech-Spec: Fix Highlighting Persistence & Navigation

**Created:** 2026-01-19
**Status:** Ready for Development

## Overview

### Problem Statement
1.  **Navigation Failure**: Clicking a highlight in the sidepanel does not scroll the target element into view, and does not bring the tab to focus if it's not active.
2.  **Persistence Failure**: Reloading the page causes highlights to disappear because the content script runs before SPA content renders.

### Solution
1.  **Robust Navigation**: Update sidepanel logic to focus the target tab before sending the message.
2.  **Dynamic Content Support**: Update content script to use `MutationObserver` to detect when content loads and apply highlights dynamically.

### Scope (In/Out)
*   **In**: `src/content/index.ts`, `src/sidepanel/hooks/useHighlights.ts`
*   **Out**: Backend (Supabase), Authenticated logic.

## Context for Development

### Codebase Patterns
*   **Content Script**: Uses `mark.js` for highlighting. Initializes via `DOMContentLoaded`.
*   **Messaging**: `chrome.runtime.onMessage` for events.
*   **Sidepane**: React hook `useHighlights` manages interactions.

### Technical Decisions
1.  **MutationObserver**: Used in `content/index.ts` to watch for text node additions in `body`. This ensures highlights apply even on slow-loading SPAs. We will debounce this to avoid performance performance hits.
2.  **Tab Activation**: Explicitly call `chrome.tabs.update(tabId, { active: true })` ensures the user sees the jump.

## Implementation Plan

### Tasks

- [ ] **Task 1: Update Sidepanel Jump Logic**
    - Modify `src/sidepanel/hooks/useHighlights.ts`.
    - In `jumpToHighlight`, activate the tab (`chrome.tabs.update`).
    - Handle case where `chrome.tabs.query` might miss strict URL matches (optional refinement).

- [ ] **Task 2: Implement Dynamic Highlighting in Content Script**
    - Modify `src/content/index.ts`.
    - Use `MutationObserver` to watch `document.body` for `childList` and `subtree`.
    - Debounce the `highlightManager.loadAll` call or specific highlight checks.
    - Re-apply highlights when new content matches.

- [ ] **Task 3: Improve Scroll Handler**
    - In `src/content/index.ts`, when `SCROLL_TO_HIGHLIGHT` is received:
        - If element not found, retry highlighting before failing.

### Acceptance Criteria

- [ ] **AC 1**: Clicking a highlight in sidepanel switches to that tab (if open) and scrolls the text into view.
- [ ] **AC 2**: Refreshing a page (especially an SPA) automatically restores highlights once the text renders.
- [ ] **AC 3**: Highlighting does not cause browser freeze (performance check on mutation observer).

## Additional Context

### Testing Strategy
*   **Manual**: Test on a simple HTML page vs. a React-heavy page.
*   **Manual**: Open Sidepanel, click highlight on a background tab, verify switch + scroll.
