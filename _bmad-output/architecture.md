# Architecture & Components

## System Overview

NoteIt follows the standard Chrome Extension Manifest V3 architecture with three main execution environments:

1.  **Content Script** (`src/content`): Runs in the context of the web page. Responsible for detecting selections, rendering highlights, and interacting with the DOM.
2.  **Service Worker** (`src/background`): Event-driven background process. Manages context menus, keyboard commands, and coordinates messages between components.
3.  **Side Panel** (`src/sidepanel`): A React application running in the browser's side panel. Provides the UI for listing, searching, and managing saved highlights.

## Component Interaction

### Highlighting Flow
1.  **User Action**: User selects text and clicks the floating menu color or uses a shortcut.
2.  **SelectionManager**: `src/content/SelectionManager.ts` captures the selection range and calculates the text offset relative to the document body.
3.  **Highlight Creation**: A unique `IHighlight` object is created.
4.  **Visual Rendering**: `HighlightManager.ts` uses `mark.js` to wrap the text nodes in a `<mark>` element with specific styles.
5.  **Storage**: The highlight data is saved to `chrome.storage.local`.

### Restoration Flow
1.  **Page Load**: Content script initializes.
2.  **Fetch**: Queries `chrome.storage.local` for all highlights.
3.  **Filter**: Filters highlights matching the current URL.
4.  **Render**: Passes data to `HighlightManager` to re-apply visual markers.

## Key Modules

### Content Script
- **`SelectionManager`**: Handles `mouseup` events, displays the Floating Menu, and calculates DOM offsets for robust anchoring.
- **`HighlightManager`**: Wrapper around `mark.js`. Handles the actual DOM manipulation to apply/remove styles.
- **`FloatingMenu`**: (Inferred) UI component injected into the DOM for color selection near the text cursor.

### Background Service
- **`index.ts`**: Sets up the Side Panel behavior, Context Menu (`Trigger Highlight`), and Keyboard Shortcuts.

### Shared
- **`types.ts`**: Defines the contract for data structures shared between UI, Content, and Background (e.g., `IHighlight`).

## External Libraries
- **mark.js**: Used for robust text finding and highlighting within the DOM.
- **uuid**: Generates unique IDs for highlights.
- **Supabase JS**: Client library for optional cloud synchronization.
