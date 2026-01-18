# Tech-Spec: Text Comments & Implicit Highlighting

**Created:** January 17, 2026
**Status:** ✅ Completed

## Overview

### Problem Statement
Users currently can only highlight text. To capture thoughts or insights, they need a way to attach textual comments to these highlights without a disjointed workflow.

### Solution
Integrate a "Comment" feature into the floating selection menu. When a comment is added, the text is automatically highlighted (Implicit Highlighting). Comments will be visually distinguished (e.g., via dashed underline) and accessible via the Side Panel.

### Scope (In/Out)

**In Scope:**
- Update `IHighlight` interface to include `comment` field.
- Enhance `FloatingMenu` to support comment input.
- Update `SelectionManager` to handle comment creation logic.
- Update `HighlightManager` to render visually distinct styles for commented highlights.
- Update `Side Panel` to display and edit comments.
- Update Storage logic to persist comments.

**Out Scope:**
- Cloud sync (Supabase) schema migration (assuming schema-less or basic JSON storage for now).
- Complex rich text editor for comments (plain text only).
- On-hover tooltips for comments (MVP relies on Side Panel for viewing).

## Context for Development

### Codebase Patterns
- **Content Scripts**: Use `ShadowDOM` for UI injection (`FloatingMenu`) to avoid style conflicts.
- **Event Handling**: `SelectionManager` orchestrates DOM events and delegates to UI/Logic managers.
- **Data Flow**: `Content Script` -> `Chrome Storage` -> `Side Panel` (via React state/storage listeners).
- **Libraries**: `mark.js` is used for rendering. It supports custom classes which we will leverage.

### Files to Reference
- `src/shared/types.ts`: Core data models.
- `src/content/FloatingMenu.ts`: Needs UI revamp for input.
- `src/content/HighlightManager.ts`: Needs CSS/Class logic update.
- `src/content/SelectionManager.ts`: Needs to handle the new "Add Comment" action.
- `src/sidepanel/components/HighlightList.tsx`: Needs to show comment text.

### Technical Decisions
1.  **Floating Menu Interaction**:
    - Add a "Note" icon/button to the existing color strip.
    - On click, replace color strip with a simple `<textarea>` and "Save" button within the same Shadow DOM.
    - On Save, trigger the highlight creation with a default color (e.g., Yellow) + the comment.
2.  **Visual Distinction**:
    - Use `mark.js`'s `className` option to add a specific class `noteit-highlight-comment`.
    - CSS: Add `border-bottom: 2px dashed #666` (or similar) to this class in `src/content/index.ts` (Dynamic CSS injection) or inline styles. *Decision: Use ClassName and inject a style tag in HighlighManager for cleaner separation.*

## Implementation Plan

### Tasks

- [x] **Task 1: Data Model Update**
    - Modify `src/shared/types.ts` to add `comment?: string` to `IHighlight`.

- [x] **Task 2: Floating Menu Enhancement**
    - Update `src/content/FloatingMenu.ts` to render a "Comment" button.
    - Implement "Input Mode" in `FloatingMenu` (Textarea + Save/Cancel).
    - Update callback signature to support `(color: string, comment?: string)`.

- [x] **Task 3: Selection Logic Update**
    - Update `src/content/SelectionManager.ts` to handle the new callback signature.
    - Ensure `triggerHighlight` captures the comment if present.

- [x] **Task 4: Highlighting Rendering Update**
    - Update `src/content/HighlightManager.ts` to check for `comment`.
    - Logic: If `comment` exists, add specific class (e.g., `noteit-with-comment`) or style (dashed underline).
    - Inject necessary CSS for the visual indicator.

- [x] **Task 5: Side Panel Update**
    - Update `src/sidepanel/components/HighlightList.tsx` to render the comment text below the quote.
    - (Optional) visual indicator in the list for items with comments.

### Acceptance Criteria

- [ ] **AC 1: Add Comment flow**
    - Given I select text and click the "Note" icon, I see an input box.
    - When I type "Test Note" and click Save, the menu closes, text is highlighted, and saved.
- [ ] **AC 2: Data Persistence**
    - The saved highlight object in `chrome.storage.local` contains the `comment` field.
- [ ] **AC 3: Visual Distinction**
    - Highlights with comments look different (e.g. underline) than those without.
- [ ] **AC 4: Side Panel Display**
    - The Side Panel displays the saved comment association with the highlight.

## Additional Context

### Testing Strategy
- Manual testing via `chrome://extensions` (Load Unpacked).
- Verify Storage via DevTools -> Application -> Storage -> Local.
